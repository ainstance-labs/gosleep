// @gosleep/core — tail JSONL → SQLite indexer (GSL-263).
//
// The continuous counterpart to the one-shot importer (`scripts/import-jsonl.ts`, GSL-262). Watches
// the four canonical JSONL sources under `docs/lab/` and drains new lines into SQLite as they
// arrive, invoking the SSE broadcaster once per newly-inserted `events` row.
//
// Signal + fallback (target-arch step 5, risk R35 — macOS FSEvents delay of up to ~10 seconds):
//   1. `fs.watch(dir)` — primary. On any change under a watched dir, the file gets a
//      DEBOUNCED enqueue (the same file might rename+create when the writer uses temp+rename).
//   2. Periodic full sweep — every `POLL_INTERVAL_MS` (default 10 s) every watched file is
//      processed unconditionally. This insures against a missed FSEvent (documented Bun bug on
//      Tahoe 26.x + a class of external editors that flush without triggering FSEvents).
//
// The two signals are DEDUP'D at the file-processor layer: `processEventsFile` uses
// `ingest_state.last_ingested_offset` as its cursor, so processing a file that has not grown
// since the last pass is a no-op (opens+seeks EOF, cursor unchanged). This makes the poll safe
// to run at 10 s without spending CPU on a quiet system.
//
// The events dir is NEW-FILE-AWARE: a `readdirSync` runs on every sweep so a fresh
// `YYYY-MM-DD.jsonl` created at UTC midnight is picked up within the poll interval. The three
// static files (questions queue/archive, decisions/log.jsonl, supervision/heartbeat.jsonl)
// have their own single-file watches.
//
// Rev-3 addendum Delta 3 (2026-08-07) — TRANSCRIPT TAIL = ENRICHMENT ONLY. This indexer does
// NOT watch `~/.claude/projects/**/session_*.jsonl`. The transcript is post-hoc context for a
// separate enrichment worker, never a live SSE signal.

import { existsSync, mkdirSync, readdirSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname, join } from "node:path";

import type { OpenedDb } from "../db/client.ts";
import { broadcaster } from "../sse/broadcaster.ts";
import {
  DECISIONS_LOG,
  EVENTS_DIR,
  HEARTBEAT_LOG,
  QUESTIONS_ARCHIVE,
  QUESTIONS_QUEUE,
  processDecisionsFile,
  processEventsFile,
  processHeartbeatFile,
  processQuestions,
  type EventRow,
} from "./process.ts";

export interface TailOptions {
  pollIntervalMs?: number;
  /** Test-only: run a synchronous full sweep NOW and return counts. Auto-called on start. */
  emitToBroadcaster?: boolean;
  /** Test-only: override the events dir (defaults to docs/lab/events). */
  eventsDir?: string;
  /** Test-only: override the four static-file paths. */
  paths?: Partial<{
    questionsQueue: string;
    questionsArchive: string;
    decisions: string;
    heartbeat: string;
  }>;
  /** Fires once per event inserted this sweep. Defaults to broadcaster.emit (production). */
  onEventInserted?: (row: EventRow) => void;
}

export interface TailController {
  stop(): Promise<void>;
  /** Run a synchronous full sweep and wait for it to complete. Test-friendly. */
  sweep(): Promise<void>;
}

function log(event: string, extra: Record<string, unknown> = {}): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...extra }));
}

/**
 * Boot the tail indexer against an already-open db. Returns a controller for the caller
 * (serve.ts, tests) to stop watchers and flush pending sweeps on shutdown.
 */
export function startTailIndexer(db: OpenedDb, opts: TailOptions = {}): TailController {
  const pollIntervalMs = opts.pollIntervalMs ?? 10_000;
  const emit = opts.emitToBroadcaster === false ? undefined : (opts.onEventInserted ?? ((row) => broadcaster.emit(row)));
  const eventsDir = opts.eventsDir ?? EVENTS_DIR;
  const questionsQueue = opts.paths?.questionsQueue ?? QUESTIONS_QUEUE;
  const questionsArchive = opts.paths?.questionsArchive ?? QUESTIONS_ARCHIVE;
  const decisionsLog = opts.paths?.decisions ?? DECISIONS_LOG;
  const heartbeatLog = opts.paths?.heartbeat ?? HEARTBEAT_LOG;

  // Ensure the events dir exists — a fresh clone plus a `data/gosleep.db` restore may run
  // before the first lab-emit ever writes a JSONL. `fs.watch` on a missing dir throws.
  if (!existsSync(eventsDir)) {
    try {
      mkdirSync(eventsDir, { recursive: true });
    } catch {
      // If we cannot create it, the watcher setup below will log and disable that watcher.
    }
  }

  const parseWarn = (file: string, line: number, error: string): void => {
    log("tail.parse.warn", { file, line, error });
  };
  const commonOpts = { onParseWarn: parseWarn };

  let sweeping = false;
  let pendingSweep = false;

  const sweep = async (): Promise<void> => {
    if (sweeping) {
      pendingSweep = true;
      return;
    }
    sweeping = true;
    try {
      // 1. events/*.jsonl — enumerate every pass so a new day-file gets picked up.
      if (existsSync(eventsDir)) {
        const files = readdirSync(eventsDir)
          .filter((n) => n.endsWith(".jsonl"))
          .sort();
        for (const name of files) {
          const abs = join(eventsDir, name);
          try {
            const counts = await processEventsFile(db, abs, {
              ...commonOpts,
              onEventInserted: emit,
            });
            if (counts.inserted > 0 || counts.parseErrors > 0) {
              log("tail.events.done", counts as unknown as Record<string, unknown>);
            }
          } catch (err) {
            log("tail.events.error", {
              file: name,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      // 2. questions/*.jsonl — one process pass folds both queue + archive.
      if (existsSync(questionsQueue) || existsSync(questionsArchive)) {
        try {
          const qc = await processQuestions(db, commonOpts);
          if (qc.written > 0) log("tail.questions.done", qc as unknown as Record<string, unknown>);
        } catch (err) {
          log("tail.questions.error", { error: err instanceof Error ? err.message : String(err) });
        }
      }

      // 3. decisions/log.jsonl.
      if (existsSync(decisionsLog)) {
        try {
          const dc = await processDecisionsFile(db, decisionsLog, commonOpts);
          if (dc.inserted > 0) log("tail.decisions.done", dc as unknown as Record<string, unknown>);
        } catch (err) {
          log("tail.decisions.error", { error: err instanceof Error ? err.message : String(err) });
        }
      }

      // 4. supervision/heartbeat.jsonl.
      if (existsSync(heartbeatLog)) {
        try {
          const hc = await processHeartbeatFile(db, heartbeatLog, commonOpts);
          if (hc.inserted > 0) log("tail.heartbeat.done", hc as unknown as Record<string, unknown>);
        } catch (err) {
          log("tail.heartbeat.error", { error: err instanceof Error ? err.message : String(err) });
        }
      }
    } finally {
      sweeping = false;
      if (pendingSweep) {
        pendingSweep = false;
        // Coalesce: one more pass if signals arrived during processing.
        void sweep();
      }
    }
  };

  // Debounced sweep — collapse a burst of watch events into a single processing pass. 200 ms
  // is short enough to feel realtime (SSE latency claim is "within a second") and long enough
  // to absorb a temp+rename atomic-write pattern.
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleSweep = (): void => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void sweep();
    }, 200);
  };

  // Set up fs.watch on the events dir + each static file's parent dir. Watching the parent dir
  // (not the file itself) survives temp+rename atomic writes that would otherwise invalidate a
  // file-scoped watcher.
  const watchers: FSWatcher[] = [];
  const watchedDirs = new Set<string>();
  const watchDir = (dir: string): void => {
    if (watchedDirs.has(dir)) return;
    if (!existsSync(dir)) return;
    try {
      const w = watch(dir, { persistent: false }, (_eventType, _filename) => {
        scheduleSweep();
      });
      watchers.push(w);
      watchedDirs.add(dir);
    } catch (err) {
      log("tail.watch.error", { dir, error: err instanceof Error ? err.message : String(err) });
    }
  };
  watchDir(eventsDir);
  watchDir(dirname(questionsQueue));
  watchDir(dirname(decisionsLog));
  watchDir(dirname(heartbeatLog));

  const pollTimer = setInterval(() => {
    void sweep();
  }, pollIntervalMs);
  if (typeof pollTimer.unref === "function") pollTimer.unref();

  // Kick off an initial sweep so the DB catches up on any lines appended while the process was
  // dead. Do NOT await it here — we want start() to return immediately; a caller can await
  // `controller.sweep()` if it needs the guarantee (tests do).
  void sweep();

  log("tail.started", {
    events_dir: eventsDir,
    poll_ms: pollIntervalMs,
    static_files: [basename(questionsQueue), basename(questionsArchive), basename(decisionsLog), basename(heartbeatLog)],
  });

  return {
    async stop(): Promise<void> {
      clearInterval(pollTimer);
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // ignore
        }
      }
      // Drain any in-flight sweep.
      while (sweeping) {
        await new Promise<void>((r) => setTimeout(r, 50));
      }
    },
    async sweep(): Promise<void> {
      // Force a synchronous run: bypass the debounce and wait for completion.
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      await sweep();
      while (pendingSweep || sweeping) {
        await new Promise<void>((r) => setTimeout(r, 20));
      }
    },
  };
}

