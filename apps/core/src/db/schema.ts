// @gosleep/core — SQLite schema v1 (GSL-261, extended GSL-276).
//
// Source: target-architecture rev-2 section 4.3 + rev-3 addendum Delta 8.1. Nine tables, each
// modeling one facet of the control-plane state. Drizzle-ORM sqliteTable definitions here are
// the SINGLE source of truth:
//   1. `drizzle-kit generate` reads THIS file to produce apps/core/drizzle/00XX_*.sql.
//   2. The runtime `scripts/migrate.ts` applies the generated SQL against data/gosleep.db.
//   3. `packages/schema` (future GSL-263) re-exports the inferred TS types for the SDK + web.
//
// Design rules encoded in this file:
//   - Every table lives in ONE place. Additive fields are the norm; per R28 (target-architecture
//     section 12), a DROP TABLE / DROP COLUMN requires an explicit `-- WARN:` annotation and a
//     smoke-guard override — never a silent rewrite.
//   - Timestamps are TEXT (ISO-8601 UTC). SQLite has no native timestamp type; storing ISO
//     strings keeps sort order correct without any TZ ambiguity. `text('day')` on events is the
//     'YYYY-MM-DD UTC' bucket used by chronicler's daily grouping — it duplicates ts but is
//     indexed cheaply for the fleet dashboards.
//   - JSON payloads use `{ mode: 'json' }` so Drizzle handles the JSON.parse/stringify round-trip.
//   - Cross-table references (events.supersedes_seq, questions.last_event_seq, decisions.last_event_seq)
//     are plain columns without SQL-level FK constraints. The historical JSONL import (GSL-262)
//     may seed events out of arrival order for compacted files; a hard FK would refuse the load.
//     Referential integrity is enforced in the tail indexer (GSL-263), not in the schema.
//   - Deltas the epic tracks separately are NOT here on purpose:
//       * per-agent fleet table  → landed GSL-276 (this file, `agent_sessions`).
//       * question provenance    → GSL-277 (applied_by + applied_rule_ref columns)
//       * `deferred` status enum → GSL-278
//     GSL-276 adds ONE additive table (`agent_sessions`) — no changes to the original eight.

import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Append-only fact log. Every hook / emit / poll-fill / chronicler / server event lands here
 * with a monotonically increasing `seq`. Nothing is ever UPDATEd or DELETEd — retroactive
 * corrections write a new row and set `supersedes_seq` to the row they invalidate.
 *
 * `ingested_from` is the deduplication key for the JSONL importer (GSL-262). A value like
 * `"jsonl:2026-08-03.jsonl#42"` uniquely identifies "line 42 of the 2026-08-03 events file";
 * a second run of the importer trips the `uq_events_ingested` unique index and no-ops.
 * Direct-write events (POST /internal/emit) leave `ingested_from` NULL and are exempt.
 *
 * The three composite indexes match the three question the fleet dashboard asks the log:
 *   - "what happened of type X across a window" (ix_type_ts)
 *   - "what happened for task GSL-N in order"   (ix_task_ts)
 *   - "what has actor W been doing"             (ix_actor_ts)
 * All three are (col, ts) so date-range scans do not require an extra sort.
 */
export const events = sqliteTable(
  "events",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    day: text("day").notNull(),
    ts: text("ts").notNull(),
    src: text("src").notNull(),
    actor: text("actor").notNull(),
    task: text("task"),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    supersedes_seq: integer("supersedes_seq"),
    ingested_from: text("ingested_from"),
  },
  (t) => [
    index("ix_events_type_ts").on(t.type, t.ts),
    index("ix_events_task_ts").on(t.task, t.ts),
    index("ix_events_actor_ts").on(t.actor, t.ts),
    uniqueIndex("uq_events_ingested").on(t.ingested_from),
  ],
);

/**
 * The question queue folded into one row per `qid`. Chronicler's Python `fold()` and lab-emit's
 * append-only patches (see tools/lab/lab-emit.sh) collapse into these fields; the TS port lives
 * in the GSL-262 importer. `status` is 'open' | 'answered' | 'resolved' | 'superseded'
 * (the 'deferred' state that the addendum names is filed under GSL-278 and NOT added here).
 *
 * `last_event_seq` is a soft back-reference to the events row that last mutated this question —
 * useful for SSE (`event: question.updated` piggybacks on the events broadcaster).
 */
export const questions = sqliteTable("questions", {
  qid: text("qid").primaryKey(),
  status: text("status").notNull(),
  kind: text("kind").notNull(),
  task: text("task"),
  question: text("question").notNull(),
  options: text("options", { mode: "json" }),
  opened_at: text("opened_at").notNull(),
  answered_at: text("answered_at"),
  answer_text: text("answer_text"),
  resolved_at: text("resolved_at"),
  applied: text("applied"),
  last_event_seq: integer("last_event_seq"),
});

/**
 * Materialized decision records: for each answered question, one row describing what was
 * decided, by whom (owner / orchestrator / manifest-rule), and against which question shape.
 * The `body` JSON is the full lab-emit decision record — kept verbatim so re-import from
 * archived JSONL is lossless.
 */
export const decisions = sqliteTable("decisions", {
  did: text("did").primaryKey(),
  ts: text("ts").notNull(),
  kind: text("kind"),
  subject: text("subject"),
  body: text("body", { mode: "json" }).notNull(),
  last_event_seq: integer("last_event_seq"),
});

/**
 * Cache of Jira Task state used by the Tasks screen. `epic` FK is stored as the parent Jira
 * key ('GSL-YYY'). `last_synced_at` NULL means "never reconciled" — the Jira sync worker
 * (future GSL-279) is expected to fill this.
 */
export const tasks = sqliteTable("tasks", {
  key: text("key").primaryKey(),
  epic: text("epic"),
  status: text("status").notNull(),
  title: text("title").notNull(),
  labels: text("labels", { mode: "json" }),
  last_synced_at: text("last_synced_at"),
});

/**
 * Skill registry state — `name` is the folder under `skill/<name>/`. `changelog` is a JSON
 * array of publication records (`{ ts, actor, version, note }`); each successful publish appends
 * one entry. Read by the Skills screen and by the "publish" action (first write button, GSL-266).
 */
export const skills = sqliteTable("skills", {
  name: text("name").primaryKey(),
  version: text("version").notNull(),
  status: text("status").notNull(),
  last_published_at: text("last_published_at"),
  last_published_by: text("last_published_by"),
  changelog: text("changelog", { mode: "json" }).notNull(),
});

/**
 * Supervisory heartbeats — one row per tick from watchdog / heartbeat / tick ledger. Sequence
 * is autoincrement so the tail indexer can resume from a persisted `last_ingested_offset`
 * without reasoning about wall-clock ties. `extra` catches non-canonical fields (status, pane,
 * note, and the ad-hoc keys future ticks add) so schema evolution does not require an ALTER.
 */
export const heartbeat = sqliteTable("heartbeat", {
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  ts: text("ts").notNull(),
  cycle: integer("cycle"),
  context_pct: integer("context_pct"),
  open_workers: integer("open_workers"),
  extra: text("extra", { mode: "json" }),
});

/**
 * Server-issued intents — the "did I fire this write endpoint successfully?" ledger. Every
 * POST /actions/* call inserts a `pending` row on entry and updates it to `ok` / `fail` on exit;
 * a crash between the two leaves `orphan` visible to the reconciler. Idempotency key = intent_id.
 */
export const server_intents = sqliteTable("server_intents", {
  intent_id: text("intent_id").primaryKey(),
  endpoint: text("endpoint").notNull(),
  started_at: text("started_at").notNull(),
  finished_at: text("finished_at"),
  status: text("status"),
  params: text("params", { mode: "json" }),
});

/**
 * Per-file cursor for the JSONL tail indexer. `last_ingested_offset` is the byte offset the
 * importer has already consumed. `last_sha256_prefix` is sha256 of the first 4 KB of the file —
 * a cheap tripwire against non-append edits (rebase, manual truncate). Together they let a
 * warm start pick up where it left off without re-hashing the whole log.
 */
export const ingest_state = sqliteTable("ingest_state", {
  file_path: text("file_path").primaryKey(),
  last_ingested_offset: integer("last_ingested_offset").notNull(),
  last_sha256_prefix: text("last_sha256_prefix").notNull(),
  updated_at: text("updated_at").notNull(),
});

/**
 * Per-agent fleet state (GSL-276 / rev-3 addendum Delta 8.1). One row per live Claude Code
 * agent session on this host, keyed by the harness's stable `session_id` (UUID from
 * `claude agents --json`). Owner requirement R4: "how many agents are running, what each is
 * doing, what its context %" — the row breaks that scalar heartbeat down per session.
 *
 * SOURCES that write this table:
 *   1. The fleet-poll worker (`apps/core/src/workers/fleet-poll.ts`) calls
 *      `claude agents --json` every 3–5 s through `@gosleep/runner-adapter#listClaudeAgents`,
 *      and UPSERTs each session row (creates on first sighting, updates status/updated_at on
 *      every tick, sets ended_at when a session disappears from the roster).
 *   2. The `POST /internal/agents/tool-observed` shim (fed by the PreToolUse Claude Code hook)
 *      updates `current_tool` and (optionally) `context_pct` at 1 s debounce per session.
 *      The hook is the ONLY source for context_pct — the CLI JSON does not carry it.
 *
 * COLUMNS. `session_id` is the primary key (a stable UUID; two consecutive spawns of the same
 * pane get different session_ids). `name` is the harness's human-readable label (e.g.
 * "gosleep-93"). `kind` is `interactive` | `background` per the CLI. `status` mirrors
 * `claude agents --json`'s status field ('busy'|'idle'|'waiting'|...); `ended` is stamped by
 * the poller when a row falls off the roster (that value is not in the CLI, it's an internal
 * convention meaning "poll saw the row disappear"). Nullable fields (`pid`, `model`, `cycle`,
 * `context_pct`, `current_tool`, `current_intent`, `ended_at`) may not be populated at INSERT
 * time — the CLI does not surface model/cycle, and the hook may never fire for a short-lived
 * session. The web Fleet screen tolerates every NULL by rendering "—".
 *
 * INDEXES. `ix_agent_sessions_status_updated` supports the /fleet projection's default sort
 * (active-first, latest-updated-first). `ix_agent_sessions_updated` supports "show me the
 * last-N-changed sessions" queries the SSE consumer may add later.
 */
export const agent_sessions = sqliteTable(
  "agent_sessions",
  {
    session_id: text("session_id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    pid: integer("pid"),
    model: text("model"),
    cwd: text("cwd").notNull(),
    cycle: integer("cycle"),
    context_pct: integer("context_pct"),
    current_tool: text("current_tool"),
    current_intent: text("current_intent"),
    status: text("status").notNull(),
    started_at: text("started_at").notNull(),
    updated_at: text("updated_at").notNull(),
    ended_at: text("ended_at"),
  },
  (t) => [
    index("ix_agent_sessions_status_updated").on(t.status, t.updated_at),
    index("ix_agent_sessions_updated").on(t.updated_at),
  ],
);

// Explicit re-export of the SQL tag so consumers can build raw fragments off the same drizzle
// instance without adding another import surface.
export { sql };
