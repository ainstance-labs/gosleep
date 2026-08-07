// @gosleep/core — fleet-poll worker (GSL-276 / rev-3 addendum Delta 8.1).
//
// Runs on the same Bun.serve process as the read routes. On a fixed cadence (default 4 s,
// range 3–5 s per the Jira description), it:
//
//   1. Calls `@gosleep/runner-adapter#listClaudeAgents` — spawn `claude agents --json`, parse.
//   2. Diffs the roster against the `agent_sessions` table:
//        * new session_id → INSERT (started_at from the CLI's `startedAt` epoch ms, ended_at NULL)
//        * seen session_id → UPDATE status + updated_at (and any fresh non-null field the CLI
//          reports; the poller NEVER clears context_pct / current_tool because those come from
//          the PreToolUse shim, not the CLI).
//        * missing session_id (present last tick, absent now) → UPDATE ended_at + status='ended'.
//   3. Emits a single `agent_sessions.updated` SSE fan-out per change set (INSERT / UPDATE /
//      END). The broadcaster's normal `event` channel is reused with type='agent_sessions.updated'
//      so the web client's SseProvider can invalidate the /fleet query without new plumbing.
//
// FAILURE MODES.
//   * `listClaudeAgents` returned ok=false → log ONE line, DO NOT touch the DB. A CLI hiccup
//     must not fire spurious ended_at across the whole fleet.
//   * A row disappears while ended_at is NULL → set ended_at + status='ended'.
//   * A row re-appears after ended_at was set → the UPSERT overwrites ended_at back to NULL
//     and stamps a fresh updated_at (the harness DID spawn a new session with a new session_id;
//     but if the same session_id somehow came back — unlikely with UUIDs — we treat it as a
//     legitimate resurrection, not a duplicate).
//
// The worker owns NO in-process state beyond its interval timer + a controller. Everything else
// is DB-backed so a restart resumes cleanly. `stop()` clears the interval and awaits any
// in-flight tick.

import { listClaudeAgents, type ClaudeAgent } from "@gosleep/runner-adapter";
import type { OpenedDb } from "../db/client.ts";
import { broadcaster } from "../sse/broadcaster.ts";

export interface FleetPollOptions {
  /** Poll interval in ms (default 4000, range 3000-5000 per the Jira scope). */
  intervalMs?: number;
  /** Override the CLI (test hook — pass a script that prints canned JSON). */
  claudeBin?: string;
  /** Test hook: replace the CLI-list function entirely (bypasses spawn). */
  lister?: () => Promise<{ ok: boolean; agents: ClaudeAgent[]; reason: string }>;
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
export function reconcileRoster(db: OpenedDb, roster: ClaudeAgent[]): FleetChangeSummary {
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

  // Wrap the whole reconcile in a transaction so a mid-batch failure rolls back — a partial
  // fleet is worse than a stale one.
  const applyAll = db.raw.transaction(() => {
    for (const a of roster) {
      const existingRow = existingById.get(a.session_id);
      const startedIso = new Date(a.started_at_epoch_ms).toISOString();
      const cycle = parseCycleFromName(a.name);
      if (existingRow === undefined) {
        // INSERT. context_pct / current_tool / model / current_intent start NULL — the shim
        // + a future settings-parse fill them in when they arrive.
        db.raw
          .query(
            `INSERT INTO agent_sessions
               (session_id, name, kind, pid, model, cwd, cycle, context_pct,
                current_tool, current_intent, status, started_at, updated_at, ended_at)
             VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, ?, ?, ?, NULL)`,
          )
          .run(
            a.session_id,
            a.name,
            a.kind,
            a.pid,
            a.cwd,
            cycle,
            a.status,
            startedIso,
            ts,
          );
        inserted += 1;
      } else {
        // UPDATE. NEVER clear context_pct / current_tool / current_intent / model here — those
        // come from the shim, not the CLI. The CLI does own status + pid + cwd.
        db.raw
          .query(
            `UPDATE agent_sessions SET
               name = ?, kind = ?, pid = ?, cwd = ?, cycle = COALESCE(?, cycle),
               status = ?, updated_at = ?, ended_at = NULL
             WHERE session_id = ?`,
          )
          .run(a.name, a.kind, a.pid, a.cwd, cycle, a.status, ts, a.session_id);
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
  const lister =
    opts.lister ??
    (async () => {
      const r = await listClaudeAgents(
        opts.claudeBin !== undefined ? { claudeBin: opts.claudeBin } : {},
      );
      return { ok: r.ok, agents: r.agents, reason: r.reason };
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
