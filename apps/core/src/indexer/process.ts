// @gosleep/core — shared indexer processing (GSL-263).
//
// Reusable per-file processors used by BOTH the one-shot JSONL importer (`scripts/import-jsonl.ts`,
// GSL-262) AND the continuous tail indexer (`src/indexer/tail.ts`). Both paths must produce
// bit-identical rows for the same input lines, otherwise the cutover from importer to tail would
// dedupe imperfectly and the SSE broadcaster would fabricate spurious rows.
//
// Design contract:
//   - Every processor reads from `ingest_state.last_ingested_offset` (per file, keyed by repo-
//     relative path) and appends to that offset on success. A crash mid-file rolls back the whole
//     txn (BEGIN/COMMIT wraps both the row inserts AND the cursor update, per GSL-262).
//   - A sha256-first-4KB tripwire (`last_sha256_prefix`) detects non-append rewrites (rebase,
//     truncate). On mismatch the processor resets fromOffset to 0 and the events unique index
//     absorbs the dedup — the reconcile phase (`reconcile.ts`) uses the same fingerprint.
//   - Each processor accepts an optional `onEventInserted(row)` callback fired AFTER commit
//     with the newly-inserted `events` rows. The tail indexer wires this to the SSE broadcaster
//     so a live subscriber sees the row within one tick of it landing in SQLite. The importer
//     leaves the callback undefined (one-shot historical load — no live subscribers exist yet).
//
// Rev-3 addendum Delta 3 (2026-08-07) — TRANSCRIPT TAIL = ENRICHMENT ONLY. This module MUST NOT
// consume Claude Code transcript JSONL (`~/.claude/projects/**/session_*.jsonl`). Live signals
// come exclusively from lab-log hooks writing docs/lab/events/**. Transcripts are only touched
// by the post-hoc enrichment worker (a later task), never by tail or SSE broadcast.

import { createReadStream, readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { OpenedDb } from "../db/client.ts";

// -----------------------------------------------------------------------------
// paths (single source — importer script + tail indexer share these constants)
// -----------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "../../../..");
// `GOSLEEP_LAB_DIR` mirrors the same env that `tools/lab/lab-emit.sh` honors — both sides of
// the smoke setup (writer + tail) resolve to the same scratch dir so the live proof stays
// hermetic (no writes into the real docs/lab tree).
export const LAB_ROOT = process.env.GOSLEEP_LAB_DIR ?? resolve(REPO_ROOT, "docs/lab");
export const EVENTS_DIR = join(LAB_ROOT, "events");
export const QUESTIONS_QUEUE = join(LAB_ROOT, "questions/queue.jsonl");
export const QUESTIONS_ARCHIVE = join(LAB_ROOT, "questions/archive.jsonl");
export const DECISIONS_LOG = join(LAB_ROOT, "decisions/log.jsonl");
export const HEARTBEAT_LOG = join(LAB_ROOT, "supervision/heartbeat.jsonl");

/**
 * Repo-relative form of an absolute path — the key stored in `ingest_state.file_path`. A repo
 * move to a fresh checkout preserves the same key so cursors survive `git clone` into a new
 * directory.
 */
export function ingestKey(absPath: string): string {
  const root = REPO_ROOT;
  return absPath.startsWith(root) ? absPath.slice(root.length + 1) : absPath;
}

// -----------------------------------------------------------------------------
// small utilities
// -----------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * SHA-256 of the first 4 KB (or whole file if smaller). Empty files hash the empty string —
 * still a valid fingerprint for the tripwire.
 */
export function sha256First4kPrefix(absPath: string): string {
  const size = statSync(absPath).size;
  const cap = Math.min(size, 4096);
  const buf = Buffer.alloc(cap);
  if (cap > 0) {
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

export interface FileCursor {
  offset: number;
  sha256Prefix: string;
}

export function loadCursor(db: OpenedDb, key: string, resetOffsets: boolean = false): FileCursor | null {
  if (resetOffsets) return null;
  const row = db.raw
    .query(
      "SELECT last_ingested_offset AS offset, last_sha256_prefix AS sha256Prefix FROM ingest_state WHERE file_path = ?",
    )
    .get(key) as FileCursor | undefined;
  return row ?? null;
}

export function saveCursor(db: OpenedDb, key: string, offset: number, sha256Prefix: string): void {
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

/**
 * Delete a file's cursor row — the next process pass will read from offset 0. Used by
 * `reconcile.ts` + `rebuild.ts` when a full re-read is desired.
 */
export function clearCursor(db: OpenedDb, key: string): void {
  db.raw.query("DELETE FROM ingest_state WHERE file_path = ?").run(key);
}

// -----------------------------------------------------------------------------
// line streaming with byte-offset tracking
// -----------------------------------------------------------------------------

export interface LineRecord {
  lineNo: number;
  raw: string;
  byteLen: number;
}

/**
 * Stream a JSONL file starting from `fromOffset`, yielding parsed records with their 1-indexed
 * line number in the FULL file (not from-offset), and the byte-length of each raw line. The
 * caller adds 1 for the terminator to keep the offset counter in sync with append-only writers.
 */
export async function* streamLinesFromOffset(
  absPath: string,
  fromOffset: number,
): AsyncGenerator<LineRecord> {
  const stream = createReadStream(absPath, { start: fromOffset, encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNo = 0;
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

async function readAllJsonl(
  absPath: string,
  onParseWarn?: (line: number, err: string) => void,
): Promise<Record<string, unknown>[]> {
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
      onParseWarn?.(lineNo, err instanceof Error ? err.message : String(err));
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// events file processor
// -----------------------------------------------------------------------------

export interface EventCounts {
  file: string;
  scanned: number;
  parseErrors: number;
  inserted: number;
  skippedDedup: number;
  elapsedMs: number;
  fromOffset: number;
  toOffset: number;
}

/**
 * The event row shape yielded to the broadcaster subscriber (used by SSE).
 */
export interface EventRow {
  seq: number;
  day: string;
  ts: string;
  src: string;
  actor: string;
  task: string | null;
  type: string;
  payload: unknown;
  ingested_from: string | null;
}

export interface ProcessOptions {
  resetOffsets?: boolean;
  onParseWarn?: (file: string, line: number, err: string) => void;
  /** Fired AFTER commit, once per inserted event row (in seq order). */
  onEventInserted?: (row: EventRow) => void;
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

export async function processEventsFile(
  db: OpenedDb,
  absPath: string,
  opts: ProcessOptions = {},
): Promise<EventCounts> {
  const key = ingestKey(absPath);
  const state = loadCursor(db, key, opts.resetOffsets ?? false);
  const currentPrefix = sha256First4kPrefix(absPath);
  let fromOffset = state?.offset ?? 0;
  const prefixMismatch = state !== null && state.sha256Prefix !== currentPrefix;
  if (prefixMismatch) fromOffset = 0;
  const started = Date.now();

  const insertStmt = db.raw.query(
    `INSERT OR IGNORE INTO events
      (day, ts, src, actor, task, type, payload, supersedes_seq, ingested_from)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const basename = absPath.split("/").pop() ?? key;
  const relEvents = `events/${basename}`;
  const preMaxSeq = getMaxEventSeq(db);
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
        opts.onParseWarn?.(relEvents, lineNo, err instanceof Error ? err.message : String(err));
        continue;
      }
      const ts = typeof rec.ts === "string" ? rec.ts : "";
      const src = typeof rec.src === "string" ? rec.src : "unknown";
      const actor = typeof rec.actor === "string" ? rec.actor : "unknown";
      const task = typeof rec.task === "string" ? rec.task : null;
      const type = typeof rec.type === "string" ? rec.type : "unknown";
      if (ts === "") {
        parseErrors += 1;
        opts.onParseWarn?.(relEvents, lineNo, "missing ts");
        continue;
      }
      const day = deriveDay(rec, basename);
      const ingestedFrom = `jsonl:events/${basename}#${lineNo}`;
      const payload = JSON.stringify(rec);
      const res = insertStmt.run(day, ts, src, actor, task, type, payload, null, ingestedFrom);
      if (res.changes > 0) inserted += 1;
      else skippedDedup += 1;
    }
    saveCursor(db, key, currentOffset, currentPrefix);
    db.raw.exec("COMMIT");
  } catch (err) {
    db.raw.exec("ROLLBACK");
    throw err;
  }

  // Post-commit: emit each newly-inserted row to the subscriber, in seq order. Query is scoped
  // by (seq > preMaxSeq) which limits the read to just this batch even if the events table
  // grew concurrently (single writer contract — this process — means "concurrently" is
  // theoretical, but the query is still correct under pressure).
  if (opts.onEventInserted && inserted > 0) {
    const rows = db.raw
      .query(
        `SELECT seq, day, ts, src, actor, task, type, payload, ingested_from
         FROM events WHERE seq > ? ORDER BY seq ASC`,
      )
      .all(preMaxSeq) as Array<{
        seq: number;
        day: string;
        ts: string;
        src: string;
        actor: string;
        task: string | null;
        type: string;
        payload: string;
        ingested_from: string | null;
      }>;
    for (const r of rows) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(r.payload);
      } catch {
        parsed = r.payload;
      }
      opts.onEventInserted({
        seq: r.seq,
        day: r.day,
        ts: r.ts,
        src: r.src,
        actor: r.actor,
        task: r.task,
        type: r.type,
        payload: parsed,
        ingested_from: r.ingested_from,
      });
    }
  }

  return {
    file: relEvents,
    scanned,
    parseErrors,
    inserted,
    skippedDedup,
    elapsedMs: Date.now() - started,
    fromOffset,
    toOffset: currentOffset,
  };
}

function getMaxEventSeq(db: OpenedDb): number {
  const row = db.raw.query("SELECT COALESCE(MAX(seq), 0) AS m FROM events").get() as { m: number };
  return row.m;
}

// -----------------------------------------------------------------------------
// decisions file processor
// -----------------------------------------------------------------------------

export interface DecisionCounts {
  file: string;
  scanned: number;
  inserted: number;
  skippedDedup: number;
  parseErrors: number;
  elapsedMs: number;
  fromOffset: number;
  toOffset: number;
}

export async function processDecisionsFile(
  db: OpenedDb,
  absPath: string,
  opts: ProcessOptions = {},
): Promise<DecisionCounts> {
  const key = ingestKey(absPath);
  const state = loadCursor(db, key, opts.resetOffsets ?? false);
  const currentPrefix = sha256First4kPrefix(absPath);
  let fromOffset = state?.offset ?? 0;
  if (state !== null && state.sha256Prefix !== currentPrefix) fromOffset = 0;
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
        opts.onParseWarn?.(key, lineNo, err instanceof Error ? err.message : String(err));
        continue;
      }
      const did = typeof rec.id === "string" ? rec.id : null;
      if (!did) {
        parseErrors += 1;
        opts.onParseWarn?.(key, lineNo, "missing id");
        continue;
      }
      const ts = typeof rec.ts === "string" ? rec.ts : "";
      const kind = typeof rec.type === "string" ? rec.type : null;
      const subject = typeof rec.task === "string" ? rec.task : null;
      const res = insertStmt.run(did, ts, kind, subject, JSON.stringify(rec));
      if (res.changes > 0) inserted += 1;
      else skippedDedup += 1;
    }
    saveCursor(db, key, currentOffset, currentPrefix);
    db.raw.exec("COMMIT");
  } catch (err) {
    db.raw.exec("ROLLBACK");
    throw err;
  }

  return {
    file: key,
    scanned,
    inserted,
    skippedDedup,
    parseErrors,
    elapsedMs: Date.now() - started,
    fromOffset,
    toOffset: currentOffset,
  };
}

// -----------------------------------------------------------------------------
// heartbeat file processor
// -----------------------------------------------------------------------------

export interface HeartbeatCounts {
  file: string;
  scanned: number;
  inserted: number;
  parseErrors: number;
  elapsedMs: number;
  fromOffset: number;
  toOffset: number;
}

export async function processHeartbeatFile(
  db: OpenedDb,
  absPath: string,
  opts: ProcessOptions = {},
): Promise<HeartbeatCounts> {
  const key = ingestKey(absPath);
  const state = loadCursor(db, key, opts.resetOffsets ?? false);
  const currentPrefix = sha256First4kPrefix(absPath);
  let fromOffset = state?.offset ?? 0;
  if (state !== null && state.sha256Prefix !== currentPrefix) fromOffset = 0;
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
        opts.onParseWarn?.(key, lineNo, err instanceof Error ? err.message : String(err));
        continue;
      }
      const ts = typeof rec.ts === "string" ? rec.ts : "";
      if (ts === "") {
        parseErrors += 1;
        opts.onParseWarn?.(key, lineNo, "missing ts");
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
    saveCursor(db, key, currentOffset, currentPrefix);
    db.raw.exec("COMMIT");
  } catch (err) {
    db.raw.exec("ROLLBACK");
    throw err;
  }

  return {
    file: key,
    scanned,
    inserted,
    parseErrors,
    elapsedMs: Date.now() - started,
    fromOffset,
    toOffset: currentOffset,
  };
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
  applied_rule_ref: string | null;
  defer_until: string | null;
  resolved_at: string | null;
  raw_history: Record<string, unknown>[];
}

export function foldQuestionRecords(records: Record<string, unknown>[]): Map<string, FoldedQuestion> {
  const state = new Map<string, FoldedQuestion>();
  for (const r of records) {
    if (typeof r.id === "string") {
      const qid = r.id;
      const from = typeof r.from === "string" ? r.from : "?";
      state.set(qid, {
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
        applied_rule_ref: typeof r.applied_rule_ref === "string" ? r.applied_rule_ref : null,
        defer_until: typeof r.defer_until === "string" ? r.defer_until : null,
        resolved_at: null,
        raw_history: [r],
      });
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
      if (typeof r.applied_rule_ref === "string") s.applied_rule_ref = r.applied_rule_ref;
      // `defer_until` may be explicitly cleared on a reopen patch. A patch that carries the
      // key with an empty string (or an explicit null via JSON) resets the field — the fold
      // must reflect the erasure, not keep the stale value from an older patch.
      if ("defer_until" in r) {
        s.defer_until = typeof r.defer_until === "string" && r.defer_until.length > 0
          ? r.defer_until
          : null;
      }
    }
  }
  return state;
}

export interface QuestionCounts {
  file: string;
  queueRecords: number;
  archiveRecords: number;
  foldedQids: number;
  written: number;
  elapsedMs: number;
}

function existsSyncPath(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

export async function processQuestions(
  db: OpenedDb,
  opts: ProcessOptions = {},
): Promise<QuestionCounts> {
  const started = Date.now();
  const queueRecords = existsSyncPath(QUESTIONS_QUEUE)
    ? await readAllJsonl(QUESTIONS_QUEUE, (line, err) =>
        opts.onParseWarn?.(ingestKey(QUESTIONS_QUEUE), line, err),
      )
    : [];
  const archiveRecords = existsSyncPath(QUESTIONS_ARCHIVE)
    ? await readAllJsonl(QUESTIONS_ARCHIVE, (line, err) =>
        opts.onParseWarn?.(ingestKey(QUESTIONS_ARCHIVE), line, err),
      )
    : [];

  const foldedArchive = foldQuestionRecords(archiveRecords);
  const foldedQueue = foldQuestionRecords(queueRecords);
  const merged = new Map<string, FoldedQuestion>();
  for (const [qid, q] of foldedArchive) merged.set(qid, q);
  for (const [qid, q] of foldedQueue) merged.set(qid, q); // queue wins per chronicler contract

  const upsert = db.raw.query(
    `INSERT INTO questions
      (qid, status, kind, task, question, options, opened_at, answered_at, answer_text,
       resolved_at, applied, applied_by, applied_rule_ref, defer_until, last_event_seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(qid) DO UPDATE SET
       status           = excluded.status,
       kind             = excluded.kind,
       task             = excluded.task,
       question         = excluded.question,
       options          = excluded.options,
       opened_at        = excluded.opened_at,
       answered_at      = excluded.answered_at,
       answer_text      = excluded.answer_text,
       resolved_at      = excluded.resolved_at,
       applied          = excluded.applied,
       applied_by       = excluded.applied_by,
       applied_rule_ref = excluded.applied_rule_ref,
       defer_until      = excluded.defer_until`,
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
        q.applied_by,
        q.applied_rule_ref,
        q.defer_until,
      );
      written += 1;
    }
    // Update cursor for both source files so the tail indexer knows the last read boundary.
    for (const src of [QUESTIONS_QUEUE, QUESTIONS_ARCHIVE]) {
      if (!existsSyncPath(src)) continue;
      saveCursor(db, ingestKey(src), statSync(src).size, sha256First4kPrefix(src));
    }
    db.raw.exec("COMMIT");
  } catch (err) {
    db.raw.exec("ROLLBACK");
    throw err;
  }

  return {
    file: "questions/queue.jsonl + archive.jsonl",
    queueRecords: queueRecords.length,
    archiveRecords: archiveRecords.length,
    foldedQids: merged.size,
    written,
    elapsedMs: Date.now() - started,
  };
}

// -----------------------------------------------------------------------------
// schema-presence guard (shared by importer + tail startup)
// -----------------------------------------------------------------------------

const REQUIRED_TABLES = ["events", "questions", "decisions", "heartbeat", "ingest_state"] as const;

export function assertSchemaPresent(db: OpenedDb): void {
  const rows = db.raw
    .query("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as Array<{ name: string }>;
  const have = new Set(rows.map((r) => r.name));
  for (const need of REQUIRED_TABLES) {
    if (!have.has(need)) {
      throw new Error(`schema not migrated — missing table: ${need}`);
    }
  }
}
