// @gosleep/schema — shared zod schemas + TS types for @gosleep/core reads (GSL-265).
//
// Source of truth: apps/core/src/routes/read.ts (GSL-263) — every schema here mirrors one
// response payload from a v1 read endpoint. Both the SDK (@gosleep/sdk) and the web client
// (@gosleep/web) validate wire responses through these schemas so a server drift becomes a
// typed error, not a silent UI corruption.
//
// Rules encoded here:
//   - JSON columns are `z.unknown()` on the wire; consumers narrow to a domain type in the
//     UI layer if they need to. Servers stringify these columns already (see
//     apps/core/src/routes/read.ts `parseJsonSafe`).
//   - All timestamps are ISO-8601 strings — no Date parsing at the boundary, keep it lazy.
//   - Nothing here imports drizzle. This package must be safely consumable by the browser
//     bundle; drizzle-derived TS types re-export through `apps/core/src/db/schema.ts` where
//     they belong (server-only). The wire shape and the storage shape differ (JSON columns
//     round-trip through TEXT in SQLite but arrive as unknown on the client).

import { z } from "zod";

// -----------------------------------------------------------------------------
// primitive shapes
// -----------------------------------------------------------------------------

/** ISO-8601 UTC timestamp — validated shape-only, not converted to Date. */
export const IsoTimestamp = z.string().min(1);

/** UTC day bucket, e.g. "2026-08-07". */
export const UtcDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** Monotonic event sequence, autoincrement in SQLite (>= 1). */
export const Seq = z.number().int().nonnegative();

// -----------------------------------------------------------------------------
// events (GET /timeline, GET /events SSE data payload, GET /bundle.timeline)
// -----------------------------------------------------------------------------

export const EventRow = z.object({
  seq: Seq,
  day: UtcDay,
  ts: IsoTimestamp,
  src: z.string(),
  actor: z.string(),
  task: z.string().nullable(),
  type: z.string(),
  payload: z.unknown(),
  supersedes_seq: Seq.nullable().optional(),
});
export type EventRow = z.infer<typeof EventRow>;

export const TimelineResponse = z.object({
  events: z.array(EventRow),
  count: z.number().int(),
  max_seq: Seq,
});
export type TimelineResponse = z.infer<typeof TimelineResponse>;

// -----------------------------------------------------------------------------
// questions (GET /questions, GET /bundle.questions)
// -----------------------------------------------------------------------------

export const QuestionStatus = z.enum(["open", "answered", "resolved", "superseded"]);
export type QuestionStatus = z.infer<typeof QuestionStatus>;

export const QuestionRow = z.object({
  qid: z.string(),
  status: QuestionStatus.or(z.string()), // tolerate future 'deferred' from GSL-278
  kind: z.string(),
  task: z.string().nullable(),
  question: z.string(),
  options: z.unknown().nullable().optional(),
  opened_at: IsoTimestamp,
  answered_at: IsoTimestamp.nullable().optional(),
  answer_text: z.string().nullable().optional(),
  resolved_at: IsoTimestamp.nullable().optional(),
  applied: z.unknown().nullable().optional(),
  last_event_seq: Seq.nullable().optional(),
});
export type QuestionRow = z.infer<typeof QuestionRow>;

export const QuestionsResponse = z.object({
  questions: z.array(QuestionRow),
  count: z.number().int(),
});
export type QuestionsResponse = z.infer<typeof QuestionsResponse>;

// -----------------------------------------------------------------------------
// skills (GET /skills, GET /bundle.skills)
// -----------------------------------------------------------------------------

export const SkillRow = z.object({
  name: z.string(),
  version: z.string(),
  status: z.string(),
  last_published_at: IsoTimestamp.nullable().optional(),
  last_published_by: z.string().nullable().optional(),
  changelog: z.unknown(),
});
export type SkillRow = z.infer<typeof SkillRow>;

export const SkillsResponse = z.object({
  skills: z.array(SkillRow),
  count: z.number().int(),
});
export type SkillsResponse = z.infer<typeof SkillsResponse>;

// -----------------------------------------------------------------------------
// tasks (GET /tasks, GET /bundle.tasks)
// -----------------------------------------------------------------------------

export const TaskRow = z.object({
  key: z.string(),
  epic: z.string().nullable(),
  status: z.string(),
  title: z.string(),
  labels: z.array(z.string()).or(z.unknown()),
  last_synced_at: IsoTimestamp.nullable().optional(),
});
export type TaskRow = z.infer<typeof TaskRow>;

export const TasksResponse = z.object({
  tasks: z.array(TaskRow),
  count: z.number().int(),
});
export type TasksResponse = z.infer<typeof TasksResponse>;

// -----------------------------------------------------------------------------
// cost (GET /cost)
// -----------------------------------------------------------------------------

export const CostEvent = z.object({
  seq: Seq,
  day: UtcDay,
  ts: IsoTimestamp,
  payload: z.unknown(),
});
export type CostEvent = z.infer<typeof CostEvent>;

export const CostResponse = z.object({
  cost_events: z.array(CostEvent),
  count: z.number().int(),
  note: z.string().optional(),
});
export type CostResponse = z.infer<typeof CostResponse>;

// -----------------------------------------------------------------------------
// fleet (STUB in GSL-263, filled by GSL-276)
// -----------------------------------------------------------------------------

export const FleetSession = z.object({
  name: z.string(),
  model: z.string().nullable().optional(),
  cwd: z.string().nullable().optional(),
  cycle: z.number().int().nullable().optional(),
  context_pct: z.number().int().nullable().optional(),
  current_tool: z.string().nullable().optional(),
  current_intent: z.string().nullable().optional(),
  started_at: IsoTimestamp.optional(),
  updated_at: IsoTimestamp.optional(),
  ended_at: IsoTimestamp.nullable().optional(),
});
export type FleetSession = z.infer<typeof FleetSession>;

export const FleetResponse = z.object({
  sessions: z.array(FleetSession),
  count: z.number().int(),
  note: z.string().optional(),
});
export type FleetResponse = z.infer<typeof FleetResponse>;

// -----------------------------------------------------------------------------
// status (GET /status)
// -----------------------------------------------------------------------------

export const StatusCounts = z.object({
  events: z.number().int(),
  questions: z.number().int(),
  decisions: z.number().int(),
  tasks: z.number().int(),
  skills: z.number().int(),
  heartbeat: z.number().int(),
  server_intents: z.number().int(),
  ingest_state: z.number().int(),
});
export type StatusCounts = z.infer<typeof StatusCounts>;

export const StatusResponse = z.object({
  booted_at: IsoTimestamp,
  now: IsoTimestamp,
  counts: StatusCounts,
  max_event_seq: Seq,
  last_ingest_at: IsoTimestamp.nullable(),
});
export type StatusResponse = z.infer<typeof StatusResponse>;

// -----------------------------------------------------------------------------
// bundle (GET /bundle) — all-projections-in-one
// -----------------------------------------------------------------------------

export const BundleResponse = z.object({
  generated_at: IsoTimestamp,
  max_event_seq: Seq,
  counts: z.object({
    events: z.number().int(),
    questions: z.number().int(),
    skills: z.number().int(),
    tasks: z.number().int(),
  }),
  questions: z.array(QuestionRow),
  skills: z.array(SkillRow),
  timeline: z.array(EventRow),
  tasks: z.array(TaskRow),
});
export type BundleResponse = z.infer<typeof BundleResponse>;

// -----------------------------------------------------------------------------
// version (GET /version) + whoami (GET /whoami)
// -----------------------------------------------------------------------------

export const VersionResponse = z.object({
  server_version: z.string(),
  api_versions: z.array(z.string()),
  db_schema_version: z.string(),
});
export type VersionResponse = z.infer<typeof VersionResponse>;

export const WhoamiResponse = z.object({
  owner: z.string(),
});
export type WhoamiResponse = z.infer<typeof WhoamiResponse>;

// -----------------------------------------------------------------------------
// SSE event envelope — the JSON `data:` payload for every named `event:` frame.
// The `data:` shape mirrors EventRow for `event: <type>` frames and
// `{ new_day: string }` for `event: rotate` frames (see apps/core/src/routes/events.ts).
// -----------------------------------------------------------------------------

export const SseEventData = EventRow;
export type SseEventData = z.infer<typeof SseEventData>;

export const SseRotateData = z.object({
  new_day: UtcDay,
});
export type SseRotateData = z.infer<typeof SseRotateData>;
