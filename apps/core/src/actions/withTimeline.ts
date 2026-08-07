// @gosleep/core — withTimeline: server_intents ledger + persistent idempotency (GSL-268).
//
// Every POST /actions/* endpoint is wrapped in this helper. It closes three requirements
// simultaneously (target-architecture rev-2 section 6.2 + red-team finding "in-memory idempotency
// is not durable"):
//
//   1. AUDIT TRAIL. Each request lands as a `server_intents` row: `pending` on entry, `ok` or
//      `fail` on exit, with the endpoint, started_at, finished_at, and the JSON body of both
//      the input and the outcome. A crash after `pending` before `ok` leaves an `orphan` row
//      the reconciler can spot and heal.
//
//   2. PERSISTENT IDEMPOTENCY. `Idempotency-Key` header → `intent_id` primary key. A second
//      POST with the same key gets the ORIGINAL body back — never runs the action again. This
//      survives a process restart (the row is on disk, not in memory), which is exactly the
//      red-team objection to the target-arch's "in-memory Idempotency-Map" v1.
//
//   3. WITHTIMELINE contract for the caller. The action's fn() is handed a per-request context
//      and returns a JSON-serializable result. This module owns the ledger writes; the caller
//      owns the domain mutation. Errors thrown inside fn() are recorded as `fail` with the
//      message, but the raised exception still bubbles so the route can return an appropriate
//      HTTP status.
//
// Params column schema (bespoke to this task — the `params` JSON column existed already, we
// just standardise its shape):
//   { input:   <the request body>,
//     result?: <success payload — set on 'ok' finish>,
//     error?:  <string — set on 'fail' finish>,
//     httpStatus?: <server's response status on cached replay> }
//
// A cached replay (`state.replay = true`) writes NOTHING back to the ledger — the second POST
// is a no-op for the audit trail; the client just re-reads the first call's outcome.

import { randomUUID } from "node:crypto";
import type { OpenedDb } from "../db/client.ts";

export interface IntentInput {
  intentId: string;
  endpoint: string;
  input: Record<string, unknown>;
}

export interface IntentOutcome<T> {
  intentId: string;
  cached: boolean;
  ok: boolean;
  result?: T;
  error?: string;
  /** ISO ts when the ORIGINAL run finished. Populated on cached replay for the audit line. */
  finishedAt?: string;
}

interface StoredParams {
  input: Record<string, unknown>;
  result?: unknown;
  error?: string;
  httpStatus?: number;
}

interface IntentRow {
  intent_id: string;
  endpoint: string;
  started_at: string;
  finished_at: string | null;
  status: string | null;
  params: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Header-friendly intent id extractor. RFC-style Idempotency-Key values (opaque strings) win;
 * otherwise mint a fresh UUID so the audit trail is dense.
 *
 * Rejects an empty string or a value longer than 128 chars (a malformed header is safer to
 * replace than to trust — a 10 KB Idempotency-Key would bloat the ledger every write).
 */
export function resolveIntentId(headerValue: string | undefined): string {
  if (typeof headerValue !== "string") return randomUUID();
  const trimmed = headerValue.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return randomUUID();
  // Restrict to ASCII printable to keep the ledger greppable.
  if (!/^[\x21-\x7e]+$/.test(trimmed)) return randomUUID();
  return trimmed;
}

function readIntent(db: OpenedDb, intentId: string): IntentRow | null {
  const row = db.raw
    .query(
      `SELECT intent_id, endpoint, started_at, finished_at, status, params
       FROM server_intents WHERE intent_id = ?`,
    )
    .get(intentId) as IntentRow | undefined;
  return row ?? null;
}

function insertPending(
  db: OpenedDb,
  intentId: string,
  endpoint: string,
  input: Record<string, unknown>,
): void {
  const params: StoredParams = { input };
  db.raw
    .query(
      `INSERT INTO server_intents (intent_id, endpoint, started_at, finished_at, status, params)
       VALUES (?, ?, ?, NULL, 'pending', ?)`,
    )
    .run(intentId, endpoint, nowIso(), JSON.stringify(params));
}

function finalizeIntent(
  db: OpenedDb,
  intentId: string,
  status: "ok" | "fail",
  input: Record<string, unknown>,
  finishedAt: string,
  patch: { result?: unknown; error?: string; httpStatus?: number },
): void {
  const params: StoredParams = { input, ...patch };
  db.raw
    .query(
      `UPDATE server_intents
       SET status = ?, finished_at = ?, params = ?
       WHERE intent_id = ?`,
    )
    .run(status, finishedAt, JSON.stringify(params), intentId);
}

/**
 * Attempt an idempotent-replay early-exit. On a hit returns the cached outcome; on a miss
 * returns null and the caller proceeds to insert the pending row and run fn.
 *
 * Behavior by prior status:
 *   - 'ok':      replay with the stored result (no re-run).
 *   - 'fail':    replay with the stored error (same failure, no retry — clients rotate the
 *                Idempotency-Key to retry, per standard REST idempotency semantics).
 *   - 'pending': treat as still-in-flight; return a marker so the route can 409 the caller.
 *                (The per-endpoint mutex in mutex.ts prevents two concurrent runs of the SAME
 *                endpoint anyway; this branch matters when the client double-posts to two
 *                DIFFERENT endpoints with the same key — a misuse we surface, not swallow.)
 */
function tryReplay<T>(row: IntentRow, endpoint: string): IntentOutcome<T> | null {
  if (row.endpoint !== endpoint) {
    // A key reused across endpoints is a client bug; refuse the replay and return an error so
    // the route can respond 409 rather than pretending the prior outcome applies here.
    return {
      intentId: row.intent_id,
      cached: true,
      ok: false,
      error: `Idempotency-Key ${row.intent_id} previously used against ${row.endpoint}, not ${endpoint}`,
      finishedAt: row.finished_at ?? undefined,
    };
  }
  const params = row.params !== null && row.params.length > 0
    ? (JSON.parse(row.params) as StoredParams)
    : { input: {} };
  if (row.status === "ok") {
    return {
      intentId: row.intent_id,
      cached: true,
      ok: true,
      result: params.result as T | undefined,
      finishedAt: row.finished_at ?? undefined,
    };
  }
  if (row.status === "fail") {
    return {
      intentId: row.intent_id,
      cached: true,
      ok: false,
      error: params.error ?? "prior request failed",
      finishedAt: row.finished_at ?? undefined,
    };
  }
  // status='pending' or NULL — in-flight, refuse.
  return {
    intentId: row.intent_id,
    cached: true,
    ok: false,
    error: "in-flight",
  };
}

/**
 * Wrap an action mutation. See module-level comment for the semantics.
 *
 * Return contract:
 *   - `outcome.cached === true` means a prior run's result was replayed; the route should
 *     return 200 (or whatever the prior httpStatus was — kept for future extension).
 *   - `outcome.ok === false && outcome.cached === false && outcome.error === "in-flight"` is
 *     never returned by this function — the per-endpoint mutex serializes calls so a genuine
 *     in-flight collision can only happen on a key reused across endpoints; that surfaces
 *     inside tryReplay above.
 *   - When fn() throws, the ledger row lands as 'fail' with the error message and the throw
 *     propagates so the route responds with an appropriate 4xx/5xx status.
 */
export async function withTimeline<T>(
  db: OpenedDb,
  intent: IntentInput,
  fn: (ctx: IntentInput) => Promise<T>,
): Promise<IntentOutcome<T>> {
  const existing = readIntent(db, intent.intentId);
  if (existing !== null) {
    const replay = tryReplay<T>(existing, intent.endpoint);
    if (replay !== null) return replay;
  }
  insertPending(db, intent.intentId, intent.endpoint, intent.input);
  try {
    const result = await fn(intent);
    finalizeIntent(db, intent.intentId, "ok", intent.input, nowIso(), { result });
    return {
      intentId: intent.intentId,
      cached: false,
      ok: true,
      result,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finalizeIntent(db, intent.intentId, "fail", intent.input, nowIso(), { error: message });
    // Do NOT swallow the throw — the route decides the HTTP status (404 for missing question,
    // 409 for bad state, 500 for anything else).
    throw err;
  }
}
