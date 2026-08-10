// @gosleep/core — fleet-poll worker (GSL-276 / rev-3 addendum Delta 8.1; migrated to
// SessionAdapter seam in GSL-281).
//
// Runs on the same Bun.serve process as the read routes. On a fixed cadence (default 4 s,
// range 3–5 s per the Jira description), it:
//
//   1. Calls `sessionAdapter.listSessions()` — the seam that today shells to the Claude Code
//      CLI via `@gosleep/runner-adapter`. A future provider swap replaces the adapter, not
//      this worker.
//   2. Diffs the roster against the `agent_sessions` table:
//        * new session_id → INSERT (started_at from the adapter's `started_at_epoch_ms`,
//          ended_at NULL).
//        * seen session_id → UPDATE status + updated_at (and any fresh non-null field the
//          adapter reports; the poller NEVER clears context_pct / current_tool because those
//          come from the PreToolUse shim, not the adapter listing).
//        * missing session_id (present last tick, absent now) → UPDATE ended_at + status='ended'.
//   3. Emits a single `agent_sessions.updated` SSE fan-out per change set (INSERT / UPDATE /
//      END). The broadcaster's normal `event` channel is reused with type='agent_sessions.updated'
//      so the web client's SseProvider can invalidate the /fleet query without new plumbing.
//
// FAILURE MODES.
//   * `sessionAdapter.listSessions` returned ok=false → log ONE line, DO NOT touch the DB.
//     A provider hiccup must not fire spurious ended_at across the whole fleet.
//   * A row disappears while ended_at is NULL → set ended_at + status='ended'.
//   * A row re-appears after ended_at was set → the UPSERT overwrites ended_at back to NULL
//     and stamps a fresh updated_at (the harness DID spawn a new session with a new session_id;
//     but if the same session_id somehow came back — unlikely with UUIDs — we treat it as a
//     legitimate resurrection, not a duplicate).
//
// The worker owns NO in-process state beyond its interval timer + a controller. Everything else
// is DB-backed so a restart resumes cleanly. `stop()` clears the interval and awaits any
// in-flight tick.

import type { SessionAdapter, SessionSummary } from "@gosleep/runner-adapter";

import { getSessionAdapter } from "../adapter/session.ts";
import { modelCache } from "../adapter/model-resolver.ts";
import type { OpenedDb } from "../db/client.ts";
import { broadcaster } from "../sse/broadcaster.ts";

export interface FleetPollOptions {
  /** Poll interval in ms (default 4000, range 3000-5000 per the Jira scope). */
  intervalMs?: number;
  /** Override the SessionAdapter (test hook — pass a fake with a canned `listSessions`). */
  adapter?: SessionAdapter;
  /** Test hook: replace the listing function entirely, bypassing the adapter. */
  lister?: () => Promise<{ ok: boolean; agents: SessionSummary[]; reason: string }>;
  /** Emit fan-out on change (default: broadcaster.emit). */
  onChange?: (changes: FleetChangeSummary) => void;
}

export interface FleetChangeSummary {
  inserted: number;
  updated: number;
  ended: number;
  totalLive: number;
  ts: string;
}

export interface FleetPollController {
  stop(): Promise<void>;
  /** Force one poll now, awaiting completion. Test-friendly. */
  poll(): Promise<FleetChangeSummary>;
}

interface DbRow {
  session_id: string;
  ended_at: string | null;
  status: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function log(event: string, extra: Record<string, unknown> = {}): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: nowIso(), event, ...extra }));
}

/**
 * Try to derive a cycle number from the harness's session name convention
 * (`gosleep-<cycle>` — a two-digit shift number). Returns null when the pattern does not match
 * (a fresh cli session, a different naming scheme, etc.). The value is a hint for the Fleet
 * screen sort order, NOT a semantic key.
 */
function parseCycleFromName(name: string): number | null {
  const m = /-(\d+)$/.exec(name);
  if (m === null || m[1] === undefined) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Apply one poll's roster to the DB. Returns the change summary the caller broadcasts on SSE.
 * Exported for the unit tests — they call it directly with a canned roster.
 */
export function reconcileRoster(db: OpenedDb, roster: SessionSummary[]): FleetChangeSummary {
  const ts = nowIso();
  const seenIds = new Set(roster.map((a) => a.session_id));

  // Snapshot the current rows we care about — small, cheap.
  const existing = db.raw
    .query("SELECT session_id, ended_at, status FROM agent_sessions")
    .all() as DbRow[];
  const existingById = new Map<string, DbRow>(existing.map((r) => [r.session_id, r]));

  let inserted = 0;
  let updated = 0;
  let ended = 0;

  // GSL-290 — clear the per-tick model cache at the top of each reconcile so a mid-day
  // settings.json edit is picked up on the next tick. The cache is per-cwd; same-cwd
  // sessions in the roster hit the cache after the first read.
  modelCache.startTick();

  // Wrap the whole reconcile in a transaction so a mid-batch failure rolls back — a partial
  // fleet is worse than a stale one.
  const applyAll = db.raw.transaction(() => {
    for (const a of roster) {
      const existingRow = existingById.get(a.session_id);
      const startedIso = new Date(a.started_at_epoch_ms).toISOString();
      const cycle = parseCycleFromName(a.name);
      // GSL-290 — best-effort model resolution: read the Claude Code settings hierarchy for
      // the session's cwd. Null when no candidate declared a model — we don't fabricate; the
      // Fleet card renders "unknown" and moves on.
      // GSL-321 — key on session_id so `--model haiku` overrides land per session, not
      // whatever cached settings.json value the last same-cwd session ended up with. The
      // resolver tries the session transcript first (honest per-session `--model` result)
      // and falls back to the settings hierarchy only when no assistant turn has landed.
      const resolvedModel = modelCache.get(a.session_id, a.cwd);
      if (existingRow === undefined) {
        // INSERT. Model is best-effort; context_pct / current_tool / current_intent start
        // NULL and are populated later by the PreToolUse shim's tool-observed path (see
        // `/internal/agents/tool-observed`) when it lands per the runbook § 8.
        db.raw
          .query(
            `INSERT INTO agent_sessions
               (session_id, name, kind, pid, model, cwd, cycle, context_pct,
                current_tool, current_intent, status, started_at, updated_at, ended_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, NULL)`,
          )
          .run(
            a.session_id,
            a.name,
            a.kind,
            a.pid,
            resolvedModel,
            a.cwd,
            cycle,
            a.status,
            startedIso,
            ts,
          );
        inserted += 1;
      } else {
        // UPDATE. NEVER clear context_pct / current_tool / current_intent here — those come
        // from the shim, not the CLI. Model gets a COALESCE upgrade: keep whatever the
        // existing row has if the resolver returned null (a mid-day settings edit that
        // *removes* the model field must not clobber a good value), but DO overwrite when
        // the resolver returned a non-null value — the operator may have switched models.
        db.raw
          .query(
            `UPDATE agent_sessions SET
               name = ?, kind = ?, pid = ?, cwd = ?, cycle = COALESCE(?, cycle),
               model = COALESCE(?, model),
               status = ?, updated_at = ?, ended_at = NULL
             WHERE session_id = ?`,
          )
          .run(
            a.name,
            a.kind,
            a.pid,
            a.cwd,
            cycle,
            resolvedModel,
            a.status,
            ts,
            a.session_id,
          );
        updated += 1;
      }
    }
    // Mark disappeared rows as ended — but only if they weren't already ended.
    for (const r of existing) {
      if (seenIds.has(r.session_id)) continue;
      if (r.ended_at !== null && r.status === "ended") continue;
      db.raw
        .query(
          `UPDATE agent_sessions SET status = 'ended', ended_at = ?, updated_at = ?
           WHERE session_id = ?`,
        )
        .run(ts, ts, r.session_id);
      ended += 1;
    }
  });
  applyAll();

  return { inserted, updated, ended, totalLive: seenIds.size, ts };
}

/**
 * Start the fleet-poll worker. Kicks off an initial poll on the same tick so the /fleet
 * endpoint has SOMETHING immediately (not empty state until interval fires).
 */
export function startFleetPoll(db: OpenedDb, opts: FleetPollOptions = {}): FleetPollController {
  const intervalMs = opts.intervalMs ?? 4_000;
  const adapter = opts.adapter ?? getSessionAdapter();
  const lister =
    opts.lister ??
    (async () => {
      const r = await adapter.listSessions();
      return { ok: r.ok, agents: r.sessions, reason: r.reason };
    });

  let polling = false;
  let stopped = false;

  const emitChange = opts.onChange ?? ((summary) => {
    // Reuse the events broadcaster with a synthetic event row so browsers already subscribed to
    // the SSE stream pick this up in SseProvider without new plumbing. `seq: 0` marks the row
    // as non-persistent — the SSE consumer keys off the type, not the seq.
    broadcaster.emit({
      seq: 0,
      day: summary.ts.slice(0, 10),
      ts: summary.ts,
      src: "core",
      actor: "fleet-poll",
      task: null,
      type: "agent_sessions.updated",
      payload: {
        inserted: summary.inserted,
        updated: summary.updated,
        ended: summary.ended,
        totalLive: summary.totalLive,
      },
      ingested_from: null,
    });
  });

  const poll = async (): Promise<FleetChangeSummary> => {
    polling = true;
    try {
      const listing = await lister();
      if (!listing.ok) {
        log("fleet.poll.skipped", { reason: listing.reason });
        return { inserted: 0, updated: 0, ended: 0, totalLive: 0, ts: nowIso() };
      }
      const summary = reconcileRoster(db, listing.agents);
      if (summary.inserted > 0 || summary.updated > 0 || summary.ended > 0) {
        emitChange(summary);
        log("fleet.poll.done", summary as unknown as Record<string, unknown>);
      }
      return summary;
    } catch (err) {
      log("fleet.poll.error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return { inserted: 0, updated: 0, ended: 0, totalLive: 0, ts: nowIso() };
    } finally {
      polling = false;
    }
  };

  // Kick off an initial poll — do NOT await, we want start() to return synchronously.
  void poll();

  const timer = setInterval(() => {
    if (stopped) return;
    void poll();
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();

  log("fleet.poll.started", { interval_ms: intervalMs });

  return {
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(timer);
      // Drain any in-flight poll.
      while (polling) {
        await new Promise<void>((r) => setTimeout(r, 20));
      }
    },
    async poll(): Promise<FleetChangeSummary> {
      return await poll();
    },
  };
}
