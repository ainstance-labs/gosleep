// @gosleep/core — manual per-file rebuild (GSL-263).
//
// Wipes the cursor for a single JSONL and re-processes the whole file from offset 0. Called by
//   - the operator via `POST /actions/chronicler/rebuild` (future task);
//   - the reconciler when it detects a mismatch (see `reconcile.ts`) — done implicitly by
//     clearing the cursor and letting the next tail sweep re-read; `rebuildFile()` here just
//     packages the same idea as a synchronous callable for CLI use.
//
// A rebuild is SAFE ANY TIME: `INSERT OR IGNORE` on the events unique index means the second
// read of a line is a no-op; the questions upsert is idempotent by qid; decisions dedup by did.
// Only heartbeat inserts unconditionally — a rebuild after a truncate would double-count. That
// is why heartbeat is called out here: use rebuild with care against the heartbeat file.

import { basename } from "node:path";

import type { OpenedDb } from "../db/client.ts";
import {
  DECISIONS_LOG,
  EVENTS_DIR,
  HEARTBEAT_LOG,
  QUESTIONS_ARCHIVE,
  QUESTIONS_QUEUE,
  clearCursor,
  ingestKey,
  processDecisionsFile,
  processEventsFile,
  processHeartbeatFile,
  processQuestions,
} from "./process.ts";

export type RebuildKind = "events" | "questions" | "decisions" | "heartbeat";

export interface RebuildResult {
  kind: RebuildKind;
  file: string;
  counts: Record<string, unknown>;
}

function classify(absPath: string): RebuildKind {
  if (absPath.startsWith(EVENTS_DIR) || absPath.endsWith(".jsonl") && absPath.includes("/events/")) {
    return "events";
  }
  if (absPath === QUESTIONS_QUEUE || absPath === QUESTIONS_ARCHIVE) return "questions";
  if (absPath === DECISIONS_LOG) return "decisions";
  if (absPath === HEARTBEAT_LOG) return "heartbeat";
  throw new Error(`rebuild: unrecognized file path — ${absPath}`);
}

/**
 * Rebuild a single file: clear its cursor, then re-run the appropriate processor. Returns the
 * counts for logging/telemetry.
 */
export async function rebuildFile(db: OpenedDb, absPath: string): Promise<RebuildResult> {
  const kind = classify(absPath);
  clearCursor(db, ingestKey(absPath));

  if (kind === "events") {
    const counts = await processEventsFile(db, absPath);
    return { kind, file: basename(absPath), counts: counts as unknown as Record<string, unknown> };
  }
  if (kind === "decisions") {
    const counts = await processDecisionsFile(db, absPath);
    return { kind, file: basename(absPath), counts: counts as unknown as Record<string, unknown> };
  }
  if (kind === "heartbeat") {
    const counts = await processHeartbeatFile(db, absPath);
    return { kind, file: basename(absPath), counts: counts as unknown as Record<string, unknown> };
  }
  // questions: clear BOTH cursors then process the fold once.
  clearCursor(db, ingestKey(QUESTIONS_QUEUE));
  clearCursor(db, ingestKey(QUESTIONS_ARCHIVE));
  const counts = await processQuestions(db);
  return { kind, file: "questions/{queue,archive}.jsonl", counts: counts as unknown as Record<string, unknown> };
}
