// @gosleep/core — defer-reopen worker (GSL-278 / rev-3 addendum Delta 8.3).
//
// A tiny periodic worker that flips `status='deferred' AND defer_until <= now` rows back to
// `status='open'` and clears `defer_until`. Runs on the same Bun.serve process — see
// `apps/core/src/serve.ts` for wiring. Same shape as fleet-poll: interval timer + poll() +
// stop() that drains any in-flight tick.
//
// TWO INDEPENDENT WRITES per row that resurfaces (matches the dual-write discipline every other
// action follows):
//   1. `lab-emit reopen --re <qid> --by auto` — append a queue.jsonl patch record so the fold
//      converges to `status='open', defer_until=NULL`. Fail-open: shell failure logs a WARN
//      but does not abort the DB write. The tail indexer is idempotent and will re-flip if
//      it ever sees the JSONL patch land later.
//   2. Direct SQLite UPDATE — same guard clause + column set the action layer uses. Emits a
//      synthetic events row on the broadcaster so the web client's SSE stream nudges the query
//      cache without waiting for the tail sweep.
//
// Cadence is intentionally coarse (default 10 s). The Jira acceptance criterion "auto-reopens
// in 30 s" allows a 10 s tick to hit inside the window; a finer grain would burn CPU on an
// idle deck. Test hooks (`intervalMs`, `now()`, `onChange`) let a bun test drive one poll
// synchronously without a real timer.
//
// FAILURE MODES.
//   * A row with defer_until IS NULL (owner deferred without a timer) is IGNORED here — the
//     owner reopens by hand via POST /actions/questions/apply-manifest or /answer. The worker
//     never touches those rows so no owner intent is lost.
//   * A row already reopened between the SELECT and the UPDATE has `changes === 0` on the
//     UPDATE guard; we skip the shell write and move on. Idempotent.

import { spawnAwait, REPO_ROOT } from "../actions/spawn.ts";
import { broadcaster } from "../sse/broadcaster.ts";
import type { OpenedDb } from "../db/client.ts";

export interface DeferReopenOptions {
  /** Poll interval in ms (default 10_000; range 5–30 s reasonable). */
  intervalMs?: number;
  /** Injectable clock (tests). Returns the ISO-8601 string to compare against defer_until. */
  now?: () => string;
  /** Emit fan-out on change (default: broadcaster.emit). */
  onReopen?: (summary: DeferReopenSummary) => void;
  /** Test seam: skip the shell out-call for `lab-emit reopen`. Defaults to spawning it. */
  disableLabEmit?: boolean;
}

export interface DeferReopenSummary {
  reopened: number;
  ts: string;
  qids: string[];
}

export interface DeferReopenController {
  stop(): Promise<void>;
  /** Force one poll now, awaiting completion. Test-friendly. */
  poll(): Promise<DeferReopenSummary>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function log(event: string, extra: Record<string, unknown> = {}): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: nowIso(), event, ...extra }));
}

async function reopenOne(
  db: OpenedDb,
  qid: string,
  disableLabEmit: boolean,
): Promise<boolean> {
  // Step 1: mirror to JSONL via lab-emit reopen. Fail-open: WARN but proceed.
  if (!disableLabEmit) {
    const res = await spawnAwait({
      cmd: [
        "bash",
        `${REPO_ROOT}/tools/lab/lab-emit.sh`,
        "reopen",
        "--re",
        qid,
        "--by",
        "auto",
      ],
      timeoutMs: 5_000,
    });
    if (!res.ok) {
      log("defer_reopen.lab_emit_warn", {
        qid,
        rc: res.code,
        stderr: res.stderr.trim(),
      });
    }
  }

  // Step 2: direct UPDATE. Guarded by (status='deferred' AND defer_until IS NOT NULL) so a
  // race with the answer path — someone answers the deferred question between SELECT and
  // UPDATE — does not fire a spurious reopen.
  const upd = db.raw
    .query(
      `UPDATE questions
         SET status = 'open',
             defer_until = NULL
       WHERE qid = ? AND status = 'deferred' AND defer_until IS NOT NULL`,
    )
    .run(qid);
  return upd.changes > 0;
}

/**
 * Reconcile deferred rows once. Exposed for tests + `poll()` on the controller. Returns the
 * qids that were re-opened.
 */
export async function reconcileDeferred(
  db: OpenedDb,
  opts: DeferReopenOptions = {},
): Promise<DeferReopenSummary> {
  const nowFn = opts.now ?? nowIso;
  const disableLabEmit = opts.disableLabEmit === true;
  const ts = nowFn();

  const due = db.raw
    .query(
      `SELECT qid FROM questions
        WHERE status = 'deferred' AND defer_until IS NOT NULL AND defer_until <= ?`,
    )
    .all(ts) as Array<{ qid: string }>;

  const reopenedQids: string[] = [];
  for (const row of due) {
    const changed = await reopenOne(db, row.qid, disableLabEmit);
    if (changed) reopenedQids.push(row.qid);
  }

  if (reopenedQids.length > 0) {
    log("defer_reopen.done", { reopened: reopenedQids.length, qids: reopenedQids });
  }

  return { reopened: reopenedQids.length, ts, qids: reopenedQids };
}

/**
 * Start the defer-reopen worker. Fires one poll on start so a fresh boot with a row already
 * past its defer_until reopens immediately, not after the first tick.
 */
export function startDeferReopen(
  db: OpenedDb,
  opts: DeferReopenOptions = {},
): DeferReopenController {
  const intervalMs = opts.intervalMs ?? 10_000;

  let polling = false;
  let stopped = false;

  const emitChange = opts.onReopen ?? ((summary) => {
    // Fan out on the SSE bus so the web client's SseProvider invalidates /questions without
    // waiting for the JSONL tail sweep. seq=0 marks non-persistent — the client keys off the
    // event type, not the seq.
    broadcaster.emit({
      seq: 0,
      day: summary.ts.slice(0, 10),
      ts: summary.ts,
      src: "core",
      actor: "defer-reopen",
      task: null,
      type: "question.reopened",
      payload: { count: summary.reopened, qids: summary.qids },
      ingested_from: null,
    });
  });

  const poll = async (): Promise<DeferReopenSummary> => {
    polling = true;
    try {
      const summary = await reconcileDeferred(db, opts);
      if (summary.reopened > 0) emitChange(summary);
      return summary;
    } catch (err) {
      log("defer_reopen.error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return { reopened: 0, ts: nowIso(), qids: [] };
    } finally {
      polling = false;
    }
  };

  // Fire one poll immediately so a booted-up server with a due row does not sit for
  // intervalMs before reopening it.
  void poll();

  const timer = setInterval(() => {
    if (stopped) return;
    void poll();
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();

  log("defer_reopen.started", { interval_ms: intervalMs });

  return {
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(timer);
      while (polling) {
        await new Promise<void>((r) => setTimeout(r, 20));
      }
    },
    async poll(): Promise<DeferReopenSummary> {
      return await poll();
    },
  };
}
