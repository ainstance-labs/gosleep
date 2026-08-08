// @gosleep/core — startup reconciler (GSL-263).
//
// Runs ONCE at server boot, before the tail indexer starts its live sweeps. Walks every row
// in `ingest_state` and compares the stored `last_sha256_prefix` against the current first-4KB
// hash of the file on disk. On mismatch the cursor is wiped so the next tail sweep re-reads
// the file from offset 0 — the events/decisions dedup indexes absorb the overlap, and any new
// or corrected rows land in SQLite.
//
// Why we need this (target-arch R36): the owner (or a rebase) may edit / truncate a JSONL out
// of band while the server was down. Without a fingerprint check, `last_ingested_offset` would
// still point into the OLD (possibly larger) file — the tail would skip the beginning and miss
// the corrected lines forever.

import type { OpenedDb } from "../db/client.ts";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { REPO_ROOT, clearCursor, sha256First4kPrefix } from "./process.ts";

export interface ReconcileReport {
  scanned: number;
  reset: number;
  missing: number;
  ok: number;
  elapsedMs: number;
  mismatches: string[];
}

function log(event: string, extra: Record<string, unknown> = {}): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...extra }));
}

/**
 * Compare every ingest_state cursor against the file it tracks. Cursors whose file's fingerprint
 * changed are cleared so the next tail sweep re-reads from offset 0. Cursors whose file is
 * missing entirely are LEFT ALONE (the file may reappear — a `git checkout` between branches,
 * for example, might temporarily remove a day-file that a later commit re-creates).
 */
export function reconcileCursors(db: OpenedDb): ReconcileReport {
  const started = Date.now();
  const rows = db.raw
    .query("SELECT file_path, last_sha256_prefix FROM ingest_state")
    .all() as Array<{ file_path: string; last_sha256_prefix: string }>;

  const mismatches: string[] = [];
  let reset = 0;
  let missing = 0;
  let ok = 0;

  for (const r of rows) {
    const abs = resolve(REPO_ROOT, r.file_path);
    if (!existsSync(abs)) {
      missing += 1;
      continue;
    }
    const currentPrefix = sha256First4kPrefix(abs);
    if (currentPrefix !== r.last_sha256_prefix) {
      clearCursor(db, r.file_path);
      mismatches.push(r.file_path);
      reset += 1;
    } else {
      ok += 1;
    }
  }

  const report: ReconcileReport = {
    scanned: rows.length,
    reset,
    missing,
    ok,
    elapsedMs: Date.now() - started,
    mismatches,
  };
  log("reconcile.done", report as unknown as Record<string, unknown>);
  return report;
}
