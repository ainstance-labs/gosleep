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

// 'deferred' landed with GSL-278 (Delta 8.3); every other value has been in the vocabulary since
// day one. `applied_by` came in with GSL-277 (Delta 8.2). Both types stay a string union at the
// wire boundary so a future manifest-added state (e.g. 'awaiting-review') does not break the
// SDK — server drift becomes a caught SchemaError, not a NaN downstream.
export const QuestionStatus = z.enum([
  "open",
  "answered",
  "resolved",
  "superseded",
  "deferred",
]);
export type QuestionStatus = z.infer<typeof QuestionStatus>;

export const AppliedBy = z.enum(["owner", "manifest", "orchestrator"]);
export type AppliedBy = z.infer<typeof AppliedBy>;

export const QuestionRow = z.object({
  qid: z.string(),
  status: QuestionStatus.or(z.string()),
  kind: z.string(),
  task: z.string().nullable(),
  question: z.string(),
  options: z.unknown().nullable().optional(),
  opened_at: IsoTimestamp,
  answered_at: IsoTimestamp.nullable().optional(),
  answer_text: z.string().nullable().optional(),
  resolved_at: IsoTimestamp.nullable().optional(),
  applied: z.unknown().nullable().optional(),
  // GSL-277 provenance columns — nullable so a legacy row without provenance keeps parsing.
  applied_by: AppliedBy.or(z.string()).nullable().optional(),
  applied_rule_ref: z.string().nullable().optional(),
  // GSL-278 defer field — ISO-8601 or null (no timer).
  defer_until: IsoTimestamp.nullable().optional(),
  last_event_seq: Seq.nullable().optional(),
  // GSL-320 — for `kind='permission'` rows: the parsed `tool_input` object (Bash →
  // `{command, description?}`, Edit → `{file_path, old_string, new_string}`, Write →
  // `{file_path, content}`, MCP → `{tool, params, message?}`). Null on non-permission rows
  // and on legacy pre-GSL-320 rows. The panel renders it as a monospace preview so the
  // owner sees WHAT is being approved.
  tool_input: z.unknown().nullable().optional(),
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
  // T6 (GSL-255) — filesystem-derived enrichment. Optional for backwards compat with any
  // consumer that pinned to an older schema version.
  has_changes: z.boolean().optional(),
  local_exists: z.boolean().optional(),
  prod_exists: z.boolean().optional(),
  hash_local: z.string().optional(),
  hash_prod: z.string().optional(),
});
export type SkillRow = z.infer<typeof SkillRow>;

export const SkillsResponse = z.object({
  skills: z.array(SkillRow),
  count: z.number().int(),
});
export type SkillsResponse = z.infer<typeof SkillsResponse>;

// T6 (GSL-255) — GET /skills/:name/diff full drawer payload.
export const SkillDiffResponse = z.object({
  name: z.string(),
  hasChanges: z.boolean(),
  diffText: z.string(),
  diffBytes: z.number().int(),
  truncated: z.boolean(),
  hashLocal: z.string(),
  hashProd: z.string(),
  localExists: z.boolean(),
  prodExists: z.boolean(),
  computedAt: IsoTimestamp,
  changelog: z.unknown(),
});
export type SkillDiffResponse = z.infer<typeof SkillDiffResponse>;

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
// fleet (real projection landed GSL-276; STUB shape in GSL-263 stayed lenient
// so a later expansion did not break the SDK — every new field arrives as
// nullable / optional).
// -----------------------------------------------------------------------------

export const FleetSession = z.object({
  session_id: z.string(),
  name: z.string(),
  kind: z.string(),
  pid: z.number().int().nullable().optional(),
  model: z.string().nullable().optional(),
  cwd: z.string(),
  cycle: z.number().int().nullable().optional(),
  context_pct: z.number().int().nullable().optional(),
  current_tool: z.string().nullable().optional(),
  current_intent: z.string().nullable().optional(),
  status: z.string(),
  started_at: IsoTimestamp,
  updated_at: IsoTimestamp,
  ended_at: IsoTimestamp.nullable().optional(),
  // GSL-319 — most-recent GitHub PR URL observed for this session (and when). Null when the
  // session has not touched a PR yet. The Overview panel picks the newest across all live
  // sessions for its "Latest PR" card; Fleet renders it as a per-row chip.
  last_pr_url: z.string().nullable().optional(),
  last_pr_at: IsoTimestamp.nullable().optional(),
  // GSL-356 (observer mode phase A) — project attribution + observed-only marker + the
  // human-readable tmux pane reference joined from tmux_panes on pid correlation. The Fleet
  // screen renders `observed_only=true` cards with a muted badge and disables answer/decide
  // affordances (R14.3). NULLs mean "not yet attributed" — panel renders "—".
  project_slug: z.string().nullable().optional(),
  cwd_project_root: z.string().nullable().optional(),
  observed_only: z.boolean().optional(),
  tmux_pane_ref: z.string().nullable().optional(),
  // GSL-350 M1 follow-up — 'pidtree' (parent-PID walk hit a pane pid) | 'heuristic'
  // (cwd-prefix match on pane_current_path) | null (no pane matched at all). Panel tags
  // heuristic matches with a small hint so the operator knows it's not authoritative.
  attribution: z.string().nullable().optional(),
  // GSL-361 (observer mode phase B) — per-session control state joined from `session_control`.
  // Defaults on the wire: `control_state='observer', control_source=null, shim_registered=false`
  // for a session whose shim never checked in. `env_locked=true` iff (state='controlled' AND
  // source='env') — a UI convenience so the panel doesn't have to re-derive the pair.
  control_state: z.enum(["observer", "controlled"]).optional(),
  control_source: z.enum(["env", "runtime", "inherited"]).nullable().optional(),
  control_activated_at: IsoTimestamp.nullable().optional(),
  control_activated_by: z.string().nullable().optional(),
  shim_registered: z.boolean().optional(),
  env_locked: z.boolean().optional(),
});
export type FleetSession = z.infer<typeof FleetSession>;

export const FleetTotals = z.object({
  agents_total: z.number().int().nonnegative(),
  agents_live: z.number().int().nonnegative(),
  agents_busy: z.number().int().nonnegative(),
  heartbeat_context_pct: z.number().int().nullable(),
});
export type FleetTotals = z.infer<typeof FleetTotals>;

export const FleetResponse = z.object({
  sessions: z.array(FleetSession),
  count: z.number().int(),
  totals: FleetTotals.optional(),
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

/**
 * Runway clock (GSL-289 / PRD R5.1). One entry per independent exhaustion clock (context,
 * blockers, slots today; budget, quota-window, work-remaining land in later tickets). The
 * `hours_left` field is either the wall-clock hours until this clock exhausts, or null when
 * the clock has no data yet ("insufficient — do not fabricate").
 */
export const RunwayClock = z.object({
  hours_left: z.number().nullable(),
  readout: z.string(),
  extra: z.record(z.string(), z.union([z.number(), z.string(), z.null()])).optional(),
});
export type RunwayClock = z.infer<typeof RunwayClock>;

export const RunwayResult = z.object({
  hours_left: z.number().nullable(),
  binding: z.string().nullable(),
  live_agents: z.number().int(),
  clocks: z.object({
    context: RunwayClock,
    blockers: RunwayClock,
    slots: RunwayClock,
  }),
  computed_at: IsoTimestamp,
});
export type RunwayResult = z.infer<typeof RunwayResult>;

export const StatusResponse = z.object({
  booted_at: IsoTimestamp,
  now: IsoTimestamp,
  counts: StatusCounts,
  max_event_seq: Seq,
  last_ingest_at: IsoTimestamp.nullable(),
  // GSL-289 — optional so a v1.0 SDK talking to a mixed fleet doesn't SchemaError; new writers
  // always set it, older ones (none in tree today) simply omit.
  runway: RunwayResult.optional(),
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

// -----------------------------------------------------------------------------
// action responses (POST /actions/*, GSL-268)
//
// Every write endpoint returns a common envelope: {ok, intent_id, cached, result?, error?}.
// `intent_id` is the persisted Idempotency-Key echoed back so the caller can correlate the
// eventual SSE fan-out (question.answered / etc.) with the POST that caused it. `cached: true`
// means a prior POST with the same Idempotency-Key ran the action — the current request was a
// no-op replay of that outcome.
// -----------------------------------------------------------------------------

const LabToolTrace = z.object({
  rc: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  elapsedMs: z.number().int().nonnegative(),
});
export type LabToolTrace = z.infer<typeof LabToolTrace>;

export const AnswerActionResult = z.object({
  qid: z.string(),
  status: z.literal("answered"),
  answered_at: IsoTimestamp,
  answered_by: z.string(),
  channel: z.string(),
  labEmit: LabToolTrace,
});
export type AnswerActionResult = z.infer<typeof AnswerActionResult>;

export const ResolveActionResult = z.object({
  qid: z.string(),
  status: z.enum(["resolved", "auto-resolved", "answered-by-default"]).or(z.string()),
  resolved_at: IsoTimestamp,
  applied: z.string(),
  labEmit: LabToolTrace,
});
export type ResolveActionResult = z.infer<typeof ResolveActionResult>;

export const AckActionResult = z.object({
  ack_of_seq: z.number().int().positive(),
  actor: z.string(),
  note: z.string().nullable(),
  labLog: LabToolTrace,
});
export type AckActionResult = z.infer<typeof AckActionResult>;

export const TickActionResult = z.object({
  spawned: z.literal(true),
  carrier: z.string(),
  note: z.string(),
});
export type TickActionResult = z.infer<typeof TickActionResult>;

// -----------------------------------------------------------------------------
// manifest (GET /manifest, GSL-277)
// -----------------------------------------------------------------------------

export const ManifestRule = z.object({
  id: z.string(), // "manifest §N.bullet"
  section: z.number().int().positive(),
  bullet: z.string(),
  section_title: z.string(),
  body: z.string(),
  source_line: z.number().int().positive(),
});
export type ManifestRule = z.infer<typeof ManifestRule>;

export const ManifestResponse = z.object({
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  mtime: IsoTimestamp,
  count: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  rules: z.array(ManifestRule),
});
export type ManifestResponse = z.infer<typeof ManifestResponse>;

// -----------------------------------------------------------------------------
// apply-manifest action (GSL-277 — POST /actions/questions/apply-manifest)
// -----------------------------------------------------------------------------

export const ApplyManifestActionResult = z.object({
  qid: z.string(),
  status: z.literal("answered"),
  applied_by: z.literal("manifest"),
  applied_rule_ref: z.string(),
  answered_at: IsoTimestamp,
  answer_text: z.string(),
  rule: ManifestRule.pick({
    id: true,
    section: true,
    bullet: true,
    section_title: true,
    body: true,
  }),
  labEmit: LabToolTrace,
  labDecision: LabToolTrace,
});
export type ApplyManifestActionResult = z.infer<typeof ApplyManifestActionResult>;

export const ApplyManifestActionInput = z.object({
  qid: z.string().min(1),
  rule_ref: z.string().min(1),
  answer: z.string().optional(),
  by: z.string().optional(),
});
export type ApplyManifestActionInput = z.infer<typeof ApplyManifestActionInput>;

// -----------------------------------------------------------------------------
// defer action (GSL-278 — POST /actions/questions/defer)
// -----------------------------------------------------------------------------

export const DeferActionResult = z.object({
  qid: z.string(),
  status: z.literal("deferred"),
  defer_until: IsoTimestamp.nullable(),
  deferred_at: IsoTimestamp,
  labEmit: LabToolTrace,
});
export type DeferActionResult = z.infer<typeof DeferActionResult>;

export const DeferActionInput = z.object({
  qid: z.string().min(1),
  defer_until: IsoTimestamp.nullable().optional(),
  by: z.string().optional(),
});
export type DeferActionInput = z.infer<typeof DeferActionInput>;

// -----------------------------------------------------------------------------
// sync-tasks action (GSL-279 — POST /actions/tasks/sync)
//
// On-demand Jira reconciler tick. Returns the per-cycle summary (inserted / updated / total
// seen / which source served the snapshot / the changed key list). Optional `epic` scopes the
// JQL to a single epic subtree.
// -----------------------------------------------------------------------------

export const SyncTasksActionInput = z.object({
  epic: z.string().regex(/^GSL-\d+$/).nullable().optional(),
});
export type SyncTasksActionInput = z.infer<typeof SyncTasksActionInput>;

export const SyncTasksActionResult = z.object({
  inserted: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  ended: z.number().int().nonnegative(),
  totalSeen: z.number().int().nonnegative(),
  ts: IsoTimestamp,
  source: z.string(),
  changedKeys: z.array(z.string()),
  epic: z.string().nullable(),
});
export type SyncTasksActionResult = z.infer<typeof SyncTasksActionResult>;

/** Generic action response — parameterised on the result type. Use the specific `*Response`
 *  aliases below at each call site so schema drift is caught at the SDK boundary. */
function actionResponse<T extends z.ZodTypeAny>(result: T) {
  return z.object({
    ok: z.boolean(),
    intent_id: z.string(),
    cached: z.boolean().optional(),
    finished_at: IsoTimestamp.optional(),
    result: result.optional(),
    error: z.string().optional(),
  });
}

export const AnswerActionResponse = actionResponse(AnswerActionResult);
export type AnswerActionResponse = z.infer<typeof AnswerActionResponse>;

export const ResolveActionResponse = actionResponse(ResolveActionResult);
export type ResolveActionResponse = z.infer<typeof ResolveActionResponse>;

export const AckActionResponse = actionResponse(AckActionResult);
export type AckActionResponse = z.infer<typeof AckActionResponse>;

export const TickActionResponse = actionResponse(TickActionResult);
export type TickActionResponse = z.infer<typeof TickActionResponse>;

export const ApplyManifestActionResponse = actionResponse(ApplyManifestActionResult);
export type ApplyManifestActionResponse = z.infer<typeof ApplyManifestActionResponse>;

export const DeferActionResponse = actionResponse(DeferActionResult);
export type DeferActionResponse = z.infer<typeof DeferActionResponse>;

export const SyncTasksActionResponse = actionResponse(SyncTasksActionResult);
export type SyncTasksActionResponse = z.infer<typeof SyncTasksActionResponse>;

// -----------------------------------------------------------------------------
// snapshot action (GSL-298 — POST /actions/snapshot)
//
// Runs `apps/core/scripts/snapshot.sh` and returns the emitted path + kind. Label omitted →
// kind=daily (matches the launchd cron); label present → kind=manual (retained indefinitely).
// -----------------------------------------------------------------------------

export const SnapshotActionInput = z.object({
  label: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,64}$/)
    .nullable()
    .optional(),
});
export type SnapshotActionInput = z.infer<typeof SnapshotActionInput>;

export const SnapshotActionResult = z.object({
  kind: z.string(),
  path: z.string(),
  ts: IsoTimestamp,
  labSnapshot: LabToolTrace,
});
export type SnapshotActionResult = z.infer<typeof SnapshotActionResult>;

export const SnapshotActionResponse = actionResponse(SnapshotActionResult);
export type SnapshotActionResponse = z.infer<typeof SnapshotActionResponse>;

// -----------------------------------------------------------------------------
// permission decide (GSL-284 — POST /actions/permissions/decide)
//
// Owner-facing decision on a permission-kind question row (opened by
// `POST /internal/permissions/post`). Decision is boolean by contract; optional
// updated_message becomes the deny-path `permissionDecisionReason` at the shim.
// -----------------------------------------------------------------------------

export const PermissionDecision = z.enum(["allow", "deny"]);
export type PermissionDecision = z.infer<typeof PermissionDecision>;

export const DecidePermissionActionInput = z.object({
  qid: z.string().min(1),
  decision: PermissionDecision,
  updated_message: z.string().nullable().optional(),
  by: z.string().optional(),
});
export type DecidePermissionActionInput = z.infer<typeof DecidePermissionActionInput>;

export const DecidePermissionActionResult = z.object({
  qid: z.string(),
  status: z.literal("answered"),
  decision: PermissionDecision,
  answered_at: IsoTimestamp,
  answered_by: z.string(),
  applied_by: z.literal("owner"),
  updated_message: z.string().nullable(),
});
export type DecidePermissionActionResult = z.infer<typeof DecidePermissionActionResult>;

export const DecidePermissionActionResponse = actionResponse(DecidePermissionActionResult);
export type DecidePermissionActionResponse = z.infer<typeof DecidePermissionActionResponse>;

/** Client-side request bodies — kept minimal and typed so the SDK does not accept arbitrary
 *  extra fields the server will silently drop. */
export const AnswerActionInput = z.object({
  qid: z.string().min(1),
  answer: z.string().min(1),
  by: z.string().optional(),
  channel: z.string().optional(),
});
export type AnswerActionInput = z.infer<typeof AnswerActionInput>;

export const ResolveActionInput = z.object({
  qid: z.string().min(1),
  applied: z.string().min(1),
  early: z.boolean().optional(),
});
export type ResolveActionInput = z.infer<typeof ResolveActionInput>;

export const AckActionInput = z.object({
  seq: z.number().int().positive(),
  note: z.string().optional(),
  by: z.string().optional(),
});
export type AckActionInput = z.infer<typeof AckActionInput>;

export const TickActionInput = z.object({
  carrier: z.string().optional(),
});
export type TickActionInput = z.infer<typeof TickActionInput>;

// -----------------------------------------------------------------------------
// publish action (T5 GSL-286 + GSL-266 partial — POST /actions/skills/publish)
//
// Spawns `tools/skills/publish.sh <skill>` with a per-request GOSLEEP_WEB_TOKEN nonce so the
// CLI's owner-gate opens on the endpoint path. Returns the parsed skills.publish.done event
// the CLI prints on its final stdout line.
// -----------------------------------------------------------------------------

export const PublishSkillActionInput = z.object({
  skill: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  lesson: z.string().optional(),
  task: z.string().regex(/^GSL-\d+$/).optional(),
});
export type PublishSkillActionInput = z.infer<typeof PublishSkillActionInput>;

export const PublishSkillActionResult = z.object({
  skill: z.string(),
  task: z.string(),
  commit: z.string(),
  backup: z.string(),
  ts: IsoTimestamp,
  intent_id: z.string(),
  publishSpawn: z.object({
    rc: z.number().int(),
    elapsedMs: z.number().int(),
    stdout: z.string(),
    stderr: z.string(),
  }),
  cliEvent: z.unknown().nullable(),
});
export type PublishSkillActionResult = z.infer<typeof PublishSkillActionResult>;

export const PublishSkillActionResponse = actionResponse(PublishSkillActionResult);
export type PublishSkillActionResponse = z.infer<typeof PublishSkillActionResponse>;

// -----------------------------------------------------------------------------
// observer-mode responses (GSL-355 under GSL-350 phase 14)
// -----------------------------------------------------------------------------

export const TmuxPaneRow = z.object({
  pane_id: z.string(),
  session_id: z.string(),
  session_name: z.string(),
  window_id: z.string(),
  pane_pid: z.number().int(),
  pane_current_path: z.string().nullable(),
  pane_current_command: z.string().nullable(),
  pane_title: z.string().nullable(),
  first_seen: IsoTimestamp,
  last_seen: IsoTimestamp,
  misses: z.number().int(),
});
export type TmuxPaneRow = z.infer<typeof TmuxPaneRow>;

export const ObservedTmuxResponse = z.object({
  panes: z.array(TmuxPaneRow),
  count: z.number().int(),
});
export type ObservedTmuxResponse = z.infer<typeof ObservedTmuxResponse>;

export const ObservedSessionRow = z.object({
  session_id: z.string(),
  name: z.string(),
  model: z.string().nullable(),
  cwd: z.string(),
  status: z.string(),
  project_slug: z.string().nullable(),
  cwd_project_root: z.string().nullable(),
  observed_only: z.boolean(),
  started_at: IsoTimestamp,
  updated_at: IsoTimestamp,
  ended_at: IsoTimestamp.nullable(),
  // GSL-361 (observer mode phase B) — per-session control-registry projection.
  control_state: z.enum(["observer", "controlled"]).optional(),
  control_source: z.enum(["env", "runtime", "inherited"]).nullable().optional(),
  shim_registered: z.boolean().optional(),
  env_locked: z.boolean().optional(),
});
export type ObservedSessionRow = z.infer<typeof ObservedSessionRow>;

export const ObservedSessionsResponse = z.object({
  sessions: z.array(ObservedSessionRow),
  count: z.number().int(),
});
export type ObservedSessionsResponse = z.infer<typeof ObservedSessionsResponse>;

export const ObservedProjectRow = z.object({
  project_slug: z.string(),
  cwd_project_root: z.string().nullable(),
  session_count: z.number().int(),
  observed_only_count: z.number().int(),
  last_activity: IsoTimestamp.nullable(),
  hidden: z.boolean(),
  pseudonym: z.string().nullable(),
  colour_hsl: z.string(),
  display_name: z.string(),
});
export type ObservedProjectRow = z.infer<typeof ObservedProjectRow>;

export const ObservedProjectsResponse = z.object({
  projects: z.array(ObservedProjectRow),
  count: z.number().int(),
});
export type ObservedProjectsResponse = z.infer<typeof ObservedProjectsResponse>;

export const ObservedEventRow = z.object({
  seq: z.number().int(),
  ts: IsoTimestamp,
  project_slug: z.string().nullable(),
  kind: z.string(),
  source: z.string(),
  payload: z.unknown().nullable(),
});
export type ObservedEventRow = z.infer<typeof ObservedEventRow>;

export const ObservedEventsResponse = z.object({
  events: z.array(ObservedEventRow),
  count: z.number().int(),
  since: z.number().int(),
  limit: z.number().int(),
});
export type ObservedEventsResponse = z.infer<typeof ObservedEventsResponse>;

export const CollectorInventoryRow = z.object({
  name: z.string(),
  source: z.string(),
  cadence_ms: z.number().int(),
  last_tick_at: IsoTimestamp.nullable(),
  last_tick_ms: z.number().int().nullable(),
  last_error: z.string().nullable(),
  events_today: z.number().int(),
  write_attempts: z.number().int(),
  disabled: z.boolean(),
});
export type CollectorInventoryRow = z.infer<typeof CollectorInventoryRow>;

export const ObservedCollectorsResponse = z.object({
  collectors: z.array(CollectorInventoryRow),
  count: z.number().int(),
  write_attempts_total: z.number().int(),
});
export type ObservedCollectorsResponse = z.infer<typeof ObservedCollectorsResponse>;

// -----------------------------------------------------------------------------
// GSL-361 (observer mode phase B) — per-session control registry.
// -----------------------------------------------------------------------------

export const ControlState = z.enum(["observer", "controlled"]);
export type ControlState = z.infer<typeof ControlState>;

export const ControlSource = z.enum(["env", "runtime", "inherited"]);
export type ControlSource = z.infer<typeof ControlSource>;

/** Shape returned by `GET /sessions/:session_id/control`. Also embedded on Fleet cards under
 *  the `control_*` prefix (see FleetSession). `exists=false` means "no row" — the panel
 *  still renders it as `observer` but keeps "Take control" disabled with a tooltip. */
export const SessionControlRow = z.object({
  ok: z.literal(true).optional(),
  session_id: z.string(),
  state: ControlState,
  source: ControlSource.nullable(),
  activated_at: IsoTimestamp.nullable(),
  activated_by: z.string().nullable(),
  deactivated_at: IsoTimestamp.nullable(),
  shim_registered: z.boolean(),
  last_heartbeat_at: IsoTimestamp.nullable(),
  env_locked: z.boolean(),
  exists: z.boolean(),
});
export type SessionControlRow = z.infer<typeof SessionControlRow>;

export const ControlledSessionRow = z.object({
  session_id: z.string(),
  state: ControlState,
  source: ControlSource,
  activated_at: IsoTimestamp.nullable(),
  activated_by: z.string().nullable(),
  shim_registered: z.boolean(),
  last_heartbeat_at: IsoTimestamp.nullable(),
  env_locked: z.boolean(),
});
export type ControlledSessionRow = z.infer<typeof ControlledSessionRow>;

export const ControlledSessionsResponse = z.object({
  ok: z.literal(true).optional(),
  sessions: z.array(ControlledSessionRow),
  count: z.number().int(),
});
export type ControlledSessionsResponse = z.infer<typeof ControlledSessionsResponse>;

/** Input schema for POST /actions/sessions/:session_id/take-control and /release-control. */
export const ControlTransitionInput = z.object({
  session_id: z.string().min(1),
  by: z.string().optional(),
  channel: z.string().optional(),
});
export type ControlTransitionInput = z.infer<typeof ControlTransitionInput>;

/** Result payload nested inside the standard action-response envelope for take/release-control. */
export const ControlTransitionResult = z.object({
  session_id: z.string(),
  state: ControlState,
  source: ControlSource,
  activated_at: IsoTimestamp.nullable(),
  activated_by: z.string().nullable(),
  deactivated_at: IsoTimestamp.nullable(),
  shim_registered: z.boolean(),
  changed: z.boolean(),
  channel: z.string(),
  labLog: LabToolTrace.nullable(),
});
export type ControlTransitionResult = z.infer<typeof ControlTransitionResult>;

export const ControlTransitionResponse = actionResponse(ControlTransitionResult);
export type ControlTransitionResponse = z.infer<typeof ControlTransitionResponse>;
