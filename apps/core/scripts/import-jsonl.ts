// @gosleep/core — one-shot importer: docs/lab/*.jsonl → SQLite (GSL-262).
//
// Reads the four historical JSONL logs into the eight-table SQLite schema from GSL-261,
// idempotently. A second run is a no-op (proved by counts + explicit event dedup key).
//
// Sources (target-arch section 4.5, with the exact chronicler semantics ported to TS):
//   1. docs/lab/events/*.jsonl              → events        (INSERT OR IGNORE on `ingested_from`)
//   2. docs/lab/questions/queue.jsonl        → questions     (re-folded every run; INSERT OR REPLACE)
//      docs/lab/questions/archive.jsonl                        (queue's folded record wins on qid clash —
//                                                              the chronicler contract, chronicler.py L1324)
//   3. docs/lab/decisions/log.jsonl          → decisions     (INSERT OR IGNORE on `did`)
//   4. docs/lab/supervision/heartbeat.jsonl  → heartbeat     (offset-tracked in ingest_state; append-only)
//
// After each file, `ingest_state` records the byte offset consumed and the sha256 of the file's
// first 4 KB. On subsequent runs, an unchanged file with a matching prefix is skipped from its
// stored offset; a mismatched prefix (non-append edit — rebase, truncate, historical hand-fix)
// triggers a full reread from offset 0, and the events unique index absorbs the duplicates.
//
// Fold logic for questions matches `tools/lab/lab-emit.sh::fold()` verbatim:
//   - A record with `id` is a base record. Its `seen_by` defaults to `[from]`.
//   - A record with `re` is a patch. It appends to `seen_by`, may overwrite `status`, and may
//     set any of `answer / answered_by / channel / applied / applied_by`.
//   - Later patches win. Base records overwrite each other by id (fresh id wins) — but new
//     bases are rare (the queue is one lifetime per qid).
//
// Usage:
//   bun apps/core/scripts/import-jsonl.ts                      # normal, incremental via ingest_state
//   bun apps/core/scripts/import-jsonl.ts --reset-offsets      # ignore ingest_state, re-read from 0
//   GOSLEEP_DB_PATH=/tmp/scratch.db bun apps/core/scripts/import-jsonl.ts   # hermetic tests
//
// Output: one JSON line per file (`import.file.done`) with counts and elapsed_ms, and a
// terminal summary line (`import.summary`) with the grand totals.

import { createReadStream, readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openDatabase, type OpenedDb } from "../src/db/client.ts";

// -----------------------------------------------------------------------------
// paths
// -----------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const LAB_ROOT = resolve(REPO_ROOT, "docs/lab");
const EVENTS_DIR = join(LAB_ROOT, "events");
const QUESTIONS_QUEUE = join(LAB_ROOT, "questions/queue.jsonl");
const QUESTIONS_ARCHIVE = join(LAB_ROOT, "questions/archive.jsonl");
const DECISIONS_LOG = join(LAB_ROOT, "decisions/log.jsonl");
const HEARTBEAT_LOG = join(LAB_ROOT, "supervision/heartbeat.jsonl");

// Filesystem path of each ingest_state row is the repo-relative form, so the log survives
// moves of the repo checkout to a new directory.
function ingestKey(absPath: string): string {
  const rel = absPath.startsWith(REPO_ROOT) ? absPath.slice(REPO_ROOT.length + 1) : absPath;
  return rel;
}

// -----------------------------------------------------------------------------
// CLI + logging
// -----------------------------------------------------------------------------

const args = new Set(process.argv.slice(2));
const RESET_OFFSETS = args.has("--reset-offsets");

function nowIso(): string {
  return new Date().toISOString();
}
function log(event: string, extra: Record<string, unknown> = {}): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: nowIso(), event, ...extra }));
}

// -----------------------------------------------------------------------------
// ingest_state helpers
// -----------------------------------------------------------------------------

interface FileState {
  offset: number;
  sha256Prefix: string;
}

function sha256First4kPrefix(absPath: string): string {
  // Read the first 4 KB (or the whole file if smaller). Empty files hash the empty string —
  // still a valid, comparable fingerprint.
  const size = statSync(absPath).size;
  const cap = Math.min(size, 4096);
  const buf = Buffer.alloc(cap);
  if (cap > 0) {
    // Sync read via fs.openSync/readSync — a Bun-friendly path with no async ceremony.
    const fs = require("node:fs") as typeof import("node:fs");
    const fd = fs.openSync(absPath, "r");
    try {
      fs.readSync(fd, buf, 0, cap, 0);
    } finally {
      fs.closeSync(fd);
    }
  }
  return createHash("sha256").update(buf).digest("hex");
}

function loadState(db: OpenedDb, key: string): FileState | null {
  if (RESET_OFFSETS) return null;
  const row = db.raw
    .query(
      "SELECT last_ingested_offset AS offset, last_sha256_prefix AS sha256Prefix FROM ingest_state WHERE file_path = ?",
    )
    .get(key) as FileState | undefined;
  return row ?? null;
}

function saveState(db: OpenedDb, key: string, offset: number, sha256Prefix: string): void {
  db.raw
    .query(
      `INSERT INTO ingest_state (file_path, last_ingested_offset, last_sha256_prefix, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(file_path) DO UPDATE SET
         last_ingested_offset = excluded.last_ingested_offset,
         last_sha256_prefix   = excluded.last_sha256_prefix,
         updated_at           = excluded.updated_at`,
    )
    .run(key, offset, sha256Prefix, nowIso());
}

// -----------------------------------------------------------------------------
// generic line streamer with byte-offset tracking
// -----------------------------------------------------------------------------

/**
 * Stream a JSONL file starting from `fromOffset`, yielding parsed records with their 1-indexed
 * line number in the FULL file (not from-offset), and the final consumed byte offset. The
 * offset counter increments by the byte-length of the raw line + 1 (the newline) — the same
 * accounting that append-only writers use, so `EOF byte length === sum of line lengths + 1s`.
 *
 * Bad JSON lines are logged as `import.parse.warn` and skipped; the offset still advances so
 * a persistent bad line does not become a permanent stall.
 */
interface LineRecord {
  lineNo: number;
  raw: string;
  byteLen: number;
}

async function* streamLinesFromOffset(absPath: string, fromOffset: number): AsyncGenerator<LineRecord> {
  const stream = createReadStream(absPath, { start: fromOffset, encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  // We need the line's byte length to advance the offset, but readline strips the terminator.
  // Re-encoding the payload as UTF-8 recovers the exact byte count sans the newline; the
  // consumer adds 1 for the terminator (POSIX \n).
  let lineNo = 0;
  // Approximate the file-global line number: pre-scan to `fromOffset` and count newlines. Skipping
  // this optimisation when fromOffset === 0 to avoid a redundant read.
  if (fromOffset > 0) {
    const preface = readFileSync(absPath).subarray(0, fromOffset).toString("utf8");
    lineNo = preface.split("\n").length - 1;
  }
  for await (const raw of rl) {
    lineNo += 1;
    const byteLen = Buffer.byteLength(raw, "utf8");
    yield { lineNo, raw, byteLen };
  }
}

// -----------------------------------------------------------------------------
// events importer
// -----------------------------------------------------------------------------

interface EventCounts {
  file: string;
  scanned: number;
  parseErrors: number;
  inserted: number;
  skippedDedup: number;
  elapsedMs: number;
  fromOffset: number;
  toOffset: number;
}

function deriveDay(record: Record<string, unknown>, fallbackBasename: string): string {
  if (typeof record.run_id === "string" && /^\d{4}-\d{2}-\d{2}/.test(record.run_id)) {
    return record.run_id.slice(0, 10);
  }
  if (typeof record.ts === "string" && /^\d{4}-\d{2}-\d{2}/.test(record.ts)) {
    return record.ts.slice(0, 10);
  }
  const base = fallbackBasename.replace(/\.jsonl$/, "");
  return /^\d{4}-\d{2}-\d{2}$/.test(base) ? base : "unknown";
}

async function importEventsFile(db: OpenedDb, absPath: string): Promise<EventCounts> {
  const key = ingestKey(absPath);
  const state = loadState(db, key);

  // sha256-check the first 4 KB: if the file's fingerprint changed, treat it as rebuilt and
  // re-read from offset 0 (the event dedup index absorbs the overlap).
  const currentPrefix = sha256First4kPrefix(absPath);
  let fromOffset = state?.offset ?? 0;
  if (state && state.sha256Prefix && state.sha256Prefix !== currentPrefix) {
    log("import.file.prefix_mismatch", { file: key, prev: state.sha256Prefix, curr: currentPrefix });
    fromOffset = 0;
  }

  const started = Date.now();
  const insertStmt = db.raw.query(
    `INSERT OR IGNORE INTO events
      (day, ts, src, actor, task, type, payload, supersedes_seq, ingested_from)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const basename = absPath.split("/").pop() ?? key;
  const relEvents = `events/${basename}`;
  let scanned = 0;
  let inserted = 0;
  let skippedDedup = 0;
  let parseErrors = 0;
  let currentOffset = fromOffset;

  // One transaction per file → drops the per-INSERT WAL flush cost dramatically AND makes
  // ingest_state's cursor update atomic with the data inserts (a mid-transaction crash rolls
  // both back, so the next run re-attempts the exact same slice). The whole file is small
  // (typical day ≤ 1 KB rows), so a single transaction is safe memory-wise.
  db.raw.exec("BEGIN");
  try {
    for await (const { lineNo, raw, byteLen } of streamLinesFromOffset(absPath, fromOffset)) {
      currentOffset += byteLen + 1;
      const trimmed = raw.trim();
      if (trimmed === "") continue;
      scanned += 1;
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(trimmed) as Record<string, unknown>;
      } catch (err) {
        parseErrors += 1;
        log("import.parse.warn", {
          file: relEvents,
          line: lineNo,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      const ts = typeof rec.ts === "string" ? rec.ts : "";
      const src = typeof rec.src === "string" ? rec.src : "unknown";
      const actor = typeof rec.actor === "string" ? rec.actor : "unknown";
      const task = typeof rec.task === "string" ? rec.task : null;
      const type = typeof rec.type === "string" ? rec.type : "unknown";
      if (ts === "") {
        parseErrors += 1;
        log("import.parse.warn", { file: relEvents, line: lineNo, error: "missing ts" });
        continue;
      }
      const day = deriveDay(rec, basename);
      const ingestedFrom = `jsonl:events/${basename}#${lineNo}`;
      const payload = JSON.stringify(rec);
      const res = insertStmt.run(day, ts, src, actor, task, type, payload, null, ingestedFrom);
      if (res.changes > 0) inserted += 1;
      else skippedDedup += 1;
    }
    saveState(db, key, currentOffset, currentPrefix);
    db.raw.exec("COMMIT");
  } catch (err) {
    db.raw.exec("ROLLBACK");
    throw err;
  }
  const elapsedMs = Date.now() - started;
  const counts: EventCounts = {
    file: relEvents,
    scanned,
    parseErrors,
    inserted,
    skippedDedup,
    elapsedMs,
    fromOffset,
    toOffset: currentOffset,
  };
  log("import.file.done", counts as unknown as Record<string, unknown>);
  return counts;
}

// -----------------------------------------------------------------------------
// questions fold (mirrors tools/lab/lab-emit.sh::fold())
// -----------------------------------------------------------------------------

interface FoldedQuestion {
  qid: string;
  ts: string;
  type: string;
  task: string | null;
  question: string;
  options: unknown;
  status: string;
  from: string;
  seen_by: string[];
  answer: string | null;
  answered_by: string | null;
  answered_at: string | null;
  channel: string | null;
  applied: string | null;
  applied_by: string | null;
  resolved_at: string | null;
  raw_history: Record<string, unknown>[];
}

function foldQuestionRecords(records: Record<string, unknown>[]): Map<string, FoldedQuestion> {
  const state = new Map<string, FoldedQuestion>();
  for (const r of records) {
    if (typeof r.id === "string") {
      const qid = r.id;
      const from = typeof r.from === "string" ? r.from : "?";
      const folded: FoldedQuestion = {
        qid,
        ts: typeof r.ts === "string" ? r.ts : "",
        type: typeof r.type === "string" ? r.type : "unknown",
        task: typeof r.task === "string" ? r.task : null,
        question: typeof r.question === "string" ? r.question : "",
        options: r.options ?? null,
        status: typeof r.status === "string" ? r.status : "open",
        from,
        seen_by: [from],
        answer: null,
        answered_by: null,
        answered_at: null,
        channel: null,
        applied: typeof r.applied === "string" ? r.applied : null,
        applied_by: typeof r.applied_by === "string" ? r.applied_by : null,
        resolved_at: null,
        raw_history: [r],
      };
      // A base record can also carry a terminal status straight from lab-emit (auto-resolved
      // in the archive is a common shape). Preserve `applied` if the base carried it.
      state.set(qid, folded);
      continue;
    }
    if (typeof r.re === "string" && state.has(r.re)) {
      const s = state.get(r.re)!;
      s.raw_history.push(r);
      const seen = typeof r.seen_by === "string" ? r.seen_by : null;
      if (seen && !s.seen_by.includes(seen)) s.seen_by.push(seen);
      if (typeof r.status === "string") {
        s.status = r.status;
        if (r.status === "resolved" && typeof r.ts === "string") s.resolved_at = r.ts;
      }
      if (typeof r.answer === "string") {
        s.answer = r.answer;
        if (typeof r.ts === "string" && s.answered_at === null) s.answered_at = r.ts;
      }
      if (typeof r.answered_by === "string") s.answered_by = r.answered_by;
      if (typeof r.channel === "string") s.channel = r.channel;
      if (typeof r.applied === "string") s.applied = r.applied;
      if (typeof r.applied_by === "string") s.applied_by = r.applied_by;
    }
    // Patches with a `re` we have never seen (dangling — archived base with in-queue patch) are
    // silently dropped, matching lab-emit's behaviour. In practice the archive is compacted;
    // this branch is exercised by tests, not production.
  }
  return state;
}

async function readAllJsonl(absPath: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const stream = createReadStream(absPath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNo = 0;
  for await (const raw of rl) {
    lineNo += 1;
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    try {
      out.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch (err) {
      log("import.parse.warn", {
        file: ingestKey(absPath),
        line: lineNo,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

interface QuestionCounts {
  file: string;
  queueRecords: number;
  archiveRecords: number;
  foldedQids: number;
  written: number;
  elapsedMs: number;
}

async function importQuestions(db: OpenedDb): Promise<QuestionCounts> {
  const started = Date.now();
  const queueExists = existsSyncPath(QUESTIONS_QUEUE);
  const archiveExists = existsSyncPath(QUESTIONS_ARCHIVE);
  const queueRecords = queueExists ? await readAllJsonl(QUESTIONS_QUEUE) : [];
  const archiveRecords = archiveExists ? await readAllJsonl(QUESTIONS_ARCHIVE) : [];

  // Chronicler contract (chronicler.py L1324): asks = queue ∪ archive, deduped by id,
  // queue's folded record wins because it is fresher. Implementation: fold each source
  // independently, then merge with queue overwriting archive on qid collision.
  const foldedArchive = foldQuestionRecords(archiveRecords);
  const foldedQueue = foldQuestionRecords(queueRecords);
  const merged = new Map<string, FoldedQuestion>();
  for (const [qid, q] of foldedArchive) merged.set(qid, q);
  for (const [qid, q] of foldedQueue) merged.set(qid, q); // queue wins

  const upsert = db.raw.query(
    `INSERT INTO questions
      (qid, status, kind, task, question, options, opened_at, answered_at, answer_text,
       resolved_at, applied, last_event_seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(qid) DO UPDATE SET
       status       = excluded.status,
       kind         = excluded.kind,
       task         = excluded.task,
       question     = excluded.question,
       options      = excluded.options,
       opened_at    = excluded.opened_at,
       answered_at  = excluded.answered_at,
       answer_text  = excluded.answer_text,
       resolved_at  = excluded.resolved_at,
       applied      = excluded.applied`,
  );

  let written = 0;
  db.raw.exec("BEGIN");
  try {
    for (const q of merged.values()) {
      upsert.run(
        q.qid,
        q.status,
        q.type,
        q.task,
        q.question,
        q.options === null || q.options === undefined ? null : JSON.stringify(q.options),
        q.ts,
        q.answered_at,
        q.answer,
        q.resolved_at,
        q.applied,
      );
      written += 1;
    }
    // ingest_state cursor update joins the same transaction as the upserts so a crash rolls
    // both back. The questions path re-reads the whole stream every run (fold order matters),
    // so offset does not gate the read — it is a marker for telemetry + the sha256 tripwire.
    for (const src of [QUESTIONS_QUEUE, QUESTIONS_ARCHIVE]) {
      if (!existsSyncPath(src)) continue;
      saveState(db, ingestKey(src), statSync(src).size, sha256First4kPrefix(src));
    }
    db.raw.exec("COMMIT");
  } catch (err) {
    db.raw.exec("ROLLBACK");
    throw err;
  }

  const elapsedMs = Date.now() - started;
  const counts: QuestionCounts = {
    file: "questions/queue.jsonl + archive.jsonl",
    queueRecords: queueRecords.length,
    archiveRecords: archiveRecords.length,
    foldedQids: merged.size,
    written,
    elapsedMs,
  };
  log("import.file.done", counts as unknown as Record<string, unknown>);
  return counts;
}

// -----------------------------------------------------------------------------
// decisions importer (PK-based dedup)
// -----------------------------------------------------------------------------

interface DecisionCounts {
  file: string;
  scanned: number;
  inserted: number;
  skippedDedup: number;
  parseErrors: number;
  elapsedMs: number;
  fromOffset: number;
  toOffset: number;
}

async function importDecisionsFile(db: OpenedDb, absPath: string): Promise<DecisionCounts> {
  const key = ingestKey(absPath);
  const state = loadState(db, key);
  const currentPrefix = sha256First4kPrefix(absPath);
  let fromOffset = state?.offset ?? 0;
  if (state && state.sha256Prefix !== currentPrefix) {
    log("import.file.prefix_mismatch", { file: key });
    fromOffset = 0;
  }
  const started = Date.now();

  const insertStmt = db.raw.query(
    `INSERT OR IGNORE INTO decisions (did, ts, kind, subject, body, last_event_seq)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  );

  let scanned = 0;
  let inserted = 0;
  let skippedDedup = 0;
  let parseErrors = 0;
  let currentOffset = fromOffset;

  db.raw.exec("BEGIN");
  try {
    for await (const { lineNo, raw, byteLen } of streamLinesFromOffset(absPath, fromOffset)) {
      currentOffset += byteLen + 1;
      const trimmed = raw.trim();
      if (trimmed === "") continue;
      scanned += 1;
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(trimmed) as Record<string, unknown>;
      } catch (err) {
        parseErrors += 1;
        log("import.parse.warn", {
          file: key,
          line: lineNo,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      const did = typeof rec.id === "string" ? rec.id : null;
      if (!did) {
        parseErrors += 1;
        log("import.parse.warn", { file: key, line: lineNo, error: "missing id" });
        continue;
      }
      const ts = typeof rec.ts === "string" ? rec.ts : "";
      const kind = typeof rec.type === "string" ? rec.type : null;
      const subject = typeof rec.task === "string" ? rec.task : null;
      const res = insertStmt.run(did, ts, kind, subject, JSON.stringify(rec));
      if (res.changes > 0) inserted += 1;
      else skippedDedup += 1;
    }
    saveState(db, key, currentOffset, currentPrefix);
    db.raw.exec("COMMIT");
  } catch (err) {
    db.raw.exec("ROLLBACK");
    throw err;
  }

  const elapsedMs = Date.now() - started;
  const counts: DecisionCounts = {
    file: key,
    scanned,
    inserted,
    skippedDedup,
    parseErrors,
    elapsedMs,
    fromOffset,
    toOffset: currentOffset,
  };
  log("import.file.done", counts as unknown as Record<string, unknown>);
  return counts;
}

// -----------------------------------------------------------------------------
// heartbeat importer (append-only, offset-tracked, no natural PK)
// -----------------------------------------------------------------------------

interface HeartbeatCounts {
  file: string;
  scanned: number;
  inserted: number;
  parseErrors: number;
  elapsedMs: number;
  fromOffset: number;
  toOffset: number;
}

async function importHeartbeatFile(db: OpenedDb, absPath: string): Promise<HeartbeatCounts> {
  const key = ingestKey(absPath);
  const state = loadState(db, key);
  const currentPrefix = sha256First4kPrefix(absPath);
  let fromOffset = state?.offset ?? 0;
  if (state && state.sha256Prefix !== currentPrefix) {
    log("import.file.prefix_mismatch", { file: key });
    fromOffset = 0;
  }
  const started = Date.now();

  const insertStmt = db.raw.query(
    `INSERT INTO heartbeat (ts, cycle, context_pct, open_workers, extra)
     VALUES (?, ?, ?, ?, ?)`,
  );

  let scanned = 0;
  let inserted = 0;
  let parseErrors = 0;
  let currentOffset = fromOffset;

  db.raw.exec("BEGIN");
  try {
    for await (const { lineNo, raw, byteLen } of streamLinesFromOffset(absPath, fromOffset)) {
      currentOffset += byteLen + 1;
      const trimmed = raw.trim();
      if (trimmed === "") continue;
      scanned += 1;
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(trimmed) as Record<string, unknown>;
      } catch (err) {
        parseErrors += 1;
        log("import.parse.warn", {
          file: key,
          line: lineNo,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      const ts = typeof rec.ts === "string" ? rec.ts : "";
      if (ts === "") {
        parseErrors += 1;
        log("import.parse.warn", { file: key, line: lineNo, error: "missing ts" });
        continue;
      }
      const cycle = typeof rec.cycle === "number" ? rec.cycle : null;
      const contextPct = typeof rec.context_pct === "number" ? rec.context_pct : null;
      const openWorkers = typeof rec.open_workers === "number" ? rec.open_workers : null;
      const extra: Record<string, unknown> = {};
      for (const k of Object.keys(rec)) {
        if (k === "ts" || k === "cycle" || k === "context_pct" || k === "open_workers") continue;
        extra[k] = rec[k];
      }
      insertStmt.run(ts, cycle, contextPct, openWorkers, JSON.stringify(extra));
      inserted += 1;
    }
    saveState(db, key, currentOffset, currentPrefix);
    db.raw.exec("COMMIT");
  } catch (err) {
    db.raw.exec("ROLLBACK");
    throw err;
  }

  const elapsedMs = Date.now() - started;
  const counts: HeartbeatCounts = {
    file: key,
    scanned,
    inserted,
    parseErrors,
    elapsedMs,
    fromOffset,
    toOffset: currentOffset,
  };
  log("import.file.done", counts as unknown as Record<string, unknown>);
  return counts;
}

// -----------------------------------------------------------------------------
// utilities + main
// -----------------------------------------------------------------------------

function existsSyncPath(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function listEventFiles(): string[] {
  if (!existsSyncPath(EVENTS_DIR)) return [];
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

  // Refuse to run if the schema has not been migrated (helpful message vs mystery SQL error).
  const rows = db.raw.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
  const tableNames = new Set(rows.map((r) => r.name));
  for (const need of ["events", "questions", "decisions", "heartbeat", "ingest_state"]) {
    if (!tableNames.has(need)) {
      log("import.error.no_schema", { missing: need });
      db.raw.close();
      process.exit(2);
    }
  }

  const before = totals(db);
  let eventFiles = 0;
  let eventsInserted = 0;
  let eventsSkipped = 0;
  for (const abs of listEventFiles()) {
    const c = await importEventsFile(db, abs);
    eventFiles += 1;
    eventsInserted += c.inserted;
    eventsSkipped += c.skippedDedup;
  }

  let questionsWritten = 0;
  let questionsFolded = 0;
  if (existsSyncPath(QUESTIONS_QUEUE) || existsSyncPath(QUESTIONS_ARCHIVE)) {
    const qc = await importQuestions(db);
    questionsWritten = qc.written;
    questionsFolded = qc.foldedQids;
  }

  let decisionsInserted = 0;
  let decisionsSkipped = 0;
  if (existsSyncPath(DECISIONS_LOG)) {
    const dc = await importDecisionsFile(db, DECISIONS_LOG);
    decisionsInserted = dc.inserted;
    decisionsSkipped = dc.skippedDedup;
  }

  let heartbeatInserted = 0;
  if (existsSyncPath(HEARTBEAT_LOG)) {
    const hc = await importHeartbeatFile(db, HEARTBEAT_LOG);
    heartbeatInserted = hc.inserted;
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

await main();
