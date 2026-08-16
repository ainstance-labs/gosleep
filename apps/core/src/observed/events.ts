// @gosleep/core — observed-events writer (GSL-355 under GSL-350 phase 14).
//
// Appends a row to `observed_events` and fires an `observed` SSE broadcast in one call. This
// is the ONLY sanctioned path from a collector into the events table — the sentinel wrapper
// (`sentinel.ts`, GSL-358) will trip on any direct write that goes around it.
//
// R14.4 enforced here: `source='hook'` is refused. Hooks belong to the gosleep timeline
// (`events` table), and are for gosleep-native sessions only. Refusing at the writer means a
// bug in a collector cannot silently pollute the observed timeline with hook-shaped rows.

import { getDb } from "../db/client.ts";
import { broadcaster, type ObservedEventPayload } from "../sse/broadcaster.ts";

export type ObservedSource = "tmux-list" | "transcript-mtime" | "fs-watcher" | "pidtree";

export type ObservedKind =
  | "session_appeared"
  | "session_idle"
  // GSL-375: emitted when the sessions collector purges a stale `agent_sessions`
  // row whose transcript.jsonl vanished from `~/.claude/projects/*` between ticks.
  // Payload: { session_id, transcript_path?, was_status, reason: "transcript_missing" }.
  | "session_ended"
  | "transcript_activity"
  | "git_head_moved"
  | "pane_appeared"
  | "pane_disappeared"
  | "work_topic_changed";

const ALLOWED_SOURCES: ReadonlySet<string> = new Set<ObservedSource>([
  "tmux-list",
  "transcript-mtime",
  "fs-watcher",
  "pidtree",
]);

export interface AppendObservedInput {
  ts?: string;
  project_slug: string | null;
  kind: ObservedKind;
  source: ObservedSource;
  payload?: unknown;
}

/**
 * Append + broadcast one observed event. Throws on `source='hook'` — the writer never lets a
 * hook-shaped row into the observed timeline. Returns the assigned seq for the caller's log.
 */
export function appendObservedEvent(input: AppendObservedInput): number {
  if (!ALLOWED_SOURCES.has(input.source)) {
    throw new Error(
      `observed_events refused source='${input.source}': only ${[...ALLOWED_SOURCES].join(", ")} allowed`,
    );
  }
  const ts = input.ts ?? new Date().toISOString();
  const payloadJson = input.payload === undefined ? null : JSON.stringify(input.payload);

  const db = getDb();
  const inserted = db.raw
    .query(
      "INSERT INTO observed_events(ts, project_slug, kind, source, payload_json) " +
        "VALUES(?, ?, ?, ?, ?) RETURNING seq",
    )
    .get(ts, input.project_slug, input.kind, input.source, payloadJson) as { seq: number };

  const wire: ObservedEventPayload = {
    seq: inserted.seq,
    ts,
    project_slug: input.project_slug,
    kind: input.kind,
    source: input.source,
    payload: input.payload ?? null,
  };
  broadcaster.emitObserved(wire);
  return inserted.seq;
}
