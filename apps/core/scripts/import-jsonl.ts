// @gosleep/core — one-shot importer: docs/lab/*.jsonl → SQLite (GSL-262).
//
// Thin CLI wrapper around the shared indexer processors in `src/indexer/process.ts` (GSL-263
// extraction). This script is idempotent — a second run is a no-op (proved by counts + the
// event `ingested_from` dedup index + questions upserts + decisions PK dedup).
//
// Sources (target-arch section 4.5, chronicler semantics ported to TS):
//   1. docs/lab/events/*.jsonl              → events        (INSERT OR IGNORE on `ingested_from`)
//   2. docs/lab/questions/queue.jsonl        → questions     (re-folded every run; INSERT OR REPLACE)
//      docs/lab/questions/archive.jsonl                        (queue wins on qid collision)
//   3. docs/lab/decisions/log.jsonl          → decisions     (INSERT OR IGNORE on `did`)
//   4. docs/lab/supervision/heartbeat.jsonl  → heartbeat     (offset-tracked in ingest_state; append-only)
//
// Every file's cursor lives in `ingest_state`: byte offset consumed + sha256 of the first 4 KB.
// A non-append rewrite (rebase / truncate) flips the fingerprint, forcing a full re-read; the
// dedup indexes absorb the overlap. See `src/indexer/process.ts` for the row-level logic.
//
// Usage:
//   bun apps/core/scripts/import-jsonl.ts                      # normal, incremental via ingest_state
//   bun apps/core/scripts/import-jsonl.ts --reset-offsets      # ignore ingest_state, re-read from 0
//   GOSLEEP_DB_PATH=/tmp/scratch.db bun apps/core/scripts/import-jsonl.ts   # hermetic tests
//
// Output: one JSON line per file (`import.file.done`) with counts and elapsed_ms, and a
// terminal summary line (`import.summary`) with the grand totals.

import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { openDatabase, type OpenedDb } from "../src/db/client.ts";
import {
  EVENTS_DIR,
  QUESTIONS_QUEUE,
  QUESTIONS_ARCHIVE,
  DECISIONS_LOG,
  HEARTBEAT_LOG,
  assertSchemaPresent,
  processDecisionsFile,
  processEventsFile,
  processHeartbeatFile,
  processQuestions,
} from "../src/indexer/process.ts";

const args = new Set(process.argv.slice(2));
const RESET_OFFSETS = args.has("--reset-offsets");

function nowIso(): string {
  return new Date().toISOString();
}
function log(event: string, extra: Record<string, unknown> = {}): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: nowIso(), event, ...extra }));
}

function existsPath(p: string): boolean {
  return existsSync(p);
}

function listEventFiles(): string[] {
  if (!existsPath(EVENTS_DIR)) return [];
  return readdirSync(EVENTS_DIR)
    .filter((n) => n.endsWith(".jsonl"))
    .sort() // filenames are YYYY-MM-DD.jsonl → lex-sort == chronological
    .map((n) => join(EVENTS_DIR, n));
}

function totals(db: OpenedDb): Record<string, number> {
  const t: Record<string, number> = {};
  for (const table of ["events", "questions", "decisions", "heartbeat", "ingest_state"]) {
    const row = db.raw.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
    t[table] = row.n;
  }
  return t;
}

async function main(): Promise<void> {
  const startedAll = Date.now();
  const db = openDatabase();
  log("import.start", { db: db.path, reset_offsets: RESET_OFFSETS });

  try {
    assertSchemaPresent(db);
  } catch (err) {
    log("import.error.no_schema", { error: err instanceof Error ? err.message : String(err) });
    db.raw.close();
    process.exit(2);
  }

  const before = totals(db);
  const onParseWarn = (file: string, line: number, error: string): void => {
    log("import.parse.warn", { file, line, error });
  };
  const opts = { resetOffsets: RESET_OFFSETS, onParseWarn };

  let eventFiles = 0;
  let eventsInserted = 0;
  let eventsSkipped = 0;
  for (const abs of listEventFiles()) {
    const c = await processEventsFile(db, abs, opts);
    eventFiles += 1;
    eventsInserted += c.inserted;
    eventsSkipped += c.skippedDedup;
    log("import.file.done", c as unknown as Record<string, unknown>);
  }

  let questionsWritten = 0;
  let questionsFolded = 0;
  if (existsPath(QUESTIONS_QUEUE) || existsPath(QUESTIONS_ARCHIVE)) {
    const qc = await processQuestions(db, opts);
    questionsWritten = qc.written;
    questionsFolded = qc.foldedQids;
    log("import.file.done", qc as unknown as Record<string, unknown>);
  }

  let decisionsInserted = 0;
  let decisionsSkipped = 0;
  if (existsPath(DECISIONS_LOG)) {
    const dc = await processDecisionsFile(db, DECISIONS_LOG, opts);
    decisionsInserted = dc.inserted;
    decisionsSkipped = dc.skippedDedup;
    log("import.file.done", dc as unknown as Record<string, unknown>);
  }

  let heartbeatInserted = 0;
  if (existsPath(HEARTBEAT_LOG)) {
    const hc = await processHeartbeatFile(db, HEARTBEAT_LOG, opts);
    heartbeatInserted = hc.inserted;
    log("import.file.done", hc as unknown as Record<string, unknown>);
  }

  const after = totals(db);
  const elapsedMs = Date.now() - startedAll;
  const delta = Object.fromEntries(
    Object.keys(after).map((k) => [k, (after[k] ?? 0) - (before[k] ?? 0)] as const),
  );
  log("import.summary", {
    event_files: eventFiles,
    events_inserted: eventsInserted,
    events_skipped_dedup: eventsSkipped,
    questions_folded: questionsFolded,
    questions_written: questionsWritten,
    decisions_inserted: decisionsInserted,
    decisions_skipped_dedup: decisionsSkipped,
    heartbeat_inserted: heartbeatInserted,
    totals_before: before,
    totals_after: after,
    delta,
    elapsed_ms: elapsedMs,
  });

  db.raw.close();
}

// Guard so the script runs only when invoked directly. When imported (tests), main() stays inert.
if (import.meta.main) {
  await main();
}
