// @gosleep/core — read-only route table (GSL-260, GSL-263).
//
// Endpoints in this file — all read-only, all served from SQLite via Drizzle-adjacent raw queries
// (Bun's `db.raw.query` is the fast path; Drizzle's TS types cover the schema types via
// `packages/schema` in a later task). Every non-healthz route is Bearer-gated.
//
//   GET /healthz    (no auth)          Liveness probe (launchd / smoke).           v1 GSL-260
//   GET /version    (Bearer)           Server + API versions.                     v1 GSL-260
//   GET /whoami     (Bearer)           Owner identity.                            v1 GSL-260
//   GET /status     (Bearer)           Row counts + last tail sweep + boot time.  v1 GSL-263
//   GET /questions  (Bearer)           `questions` table; ?status filter.         v1 GSL-263
//   GET /skills     (Bearer)           `skills` table.                            v1 GSL-263
//   GET /timeline   (Bearer)           Latest N events; ?limit, ?type, ?task.     v1 GSL-263
//   GET /tasks      (Bearer)           `tasks` cache from Jira sync.              v1 GSL-263
//   GET /cost       (Bearer)           Cost tallies from events (approximation).  v1 GSL-263
//   GET /fleet      (Bearer)           Per-session state — STUB pending GSL-276.  v1 GSL-263
//   GET /bundle     (Bearer)           All the above in one projection.           v1 GSL-263
//
// Rev-3 addendum Delta 8.1 — `/fleet` in this task is a STUB (returns `{sessions: []}` with a
// `note` naming the pending table). Full projection lands with GSL-276 which adds the
// `agent_sessions` table. Delta 7's `/metrics` full impl is GSL-280; the route is wired here
// as a stub that returns a minimal Prometheus exposition so scrapers do not 404.

import { Hono } from "hono";

import { SERVER_VERSION, API_VERSIONS, OWNER_NAME } from "../config.ts";
import { requireBearer } from "../security/bearer.ts";
import { getDb } from "../db/client.ts";
import { loadManifest } from "../manifest/parser.ts";
import { computeRunway } from "../runway.ts";
import { getDbSchemaVersion } from "../db/schemaVersion.ts";

export const readRoutes = new Hono();

// -----------------------------------------------------------------------------
// process boot timestamp — reported by /status
// -----------------------------------------------------------------------------
const BOOTED_AT = new Date().toISOString();

// -----------------------------------------------------------------------------
// /healthz + /version + /whoami — from GSL-260, unchanged
// -----------------------------------------------------------------------------

readRoutes.get("/healthz", (c) => c.json({ ok: true, service: "gosleep-core" }));

readRoutes.get("/version", requireBearer, (c) =>
  c.json({
    server_version: SERVER_VERSION,
    api_versions: API_VERSIONS,
    // GSL-294 — sha256 hash (first 16 hex chars) over the drizzle journal + every migration
    // .sql file, computed once at boot. The panel keys cache invalidation off this so a
    // rolling schema change is observable from the browser (target-arch §12 R34). Returns
    // "unavailable" when the drizzle dir isn't reachable and "unset" was intentionally
    // retired — a real value is preferable to the legacy placeholder.
    db_schema_version: getDbSchemaVersion(),
  }),
);

readRoutes.get("/whoami", requireBearer, (c) => c.json({ owner: OWNER_NAME }));

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function parsePositiveInt(raw: string | undefined, dflt: number, cap: number): number {
  if (raw === undefined) return dflt;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return dflt;
  return Math.min(n, cap);
}

function parseJsonSafe(s: string | null | undefined): unknown {
  if (s === null || s === undefined || s === "") return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function tableCount(name: string): number {
  const row = getDb().raw.query(`SELECT count(*) AS n FROM ${name}`).get() as { n: number };
  return row.n;
}

function maxSeq(): number {
  const row = getDb().raw.query("SELECT COALESCE(MAX(seq), 0) AS m FROM events").get() as { m: number };
  return row.m;
}

// -----------------------------------------------------------------------------
// /status
// -----------------------------------------------------------------------------

readRoutes.get("/status", requireBearer, (c) => {
  const counts = {
    events: tableCount("events"),
    questions: tableCount("questions"),
    decisions: tableCount("decisions"),
    tasks: tableCount("tasks"),
    skills: tableCount("skills"),
    heartbeat: tableCount("heartbeat"),
    server_intents: tableCount("server_intents"),
    ingest_state: tableCount("ingest_state"),
  };
  const lastIngest = getDb().raw
    .query("SELECT MAX(updated_at) AS ts FROM ingest_state")
    .get() as { ts: string | null };
  // GSL-289 — runway/binding-constraint composite for the Overview tile. Reads live
  // agent_sessions + open questions in the same DB in one call; NEVER throws (a DB read
  // failure inside computeRunway yields the empty-data shape).
  const runway = computeRunway(getDb());
  return c.json({
    booted_at: BOOTED_AT,
    now: new Date().toISOString(),
    counts,
    max_event_seq: maxSeq(),
    last_ingest_at: lastIngest.ts,
    runway,
  });
});

// -----------------------------------------------------------------------------
// /questions — folded question queue
// -----------------------------------------------------------------------------

interface QuestionRow {
  qid: string;
  status: string;
  kind: string;
  task: string | null;
  question: string;
  options: string | null;
  opened_at: string;
  answered_at: string | null;
  answer_text: string | null;
  resolved_at: string | null;
  applied: string | null;
  applied_by: string | null;
  applied_rule_ref: string | null;
  defer_until: string | null;
  last_event_seq: number | null;
}

readRoutes.get("/questions", requireBearer, (c) => {
  const status = c.req.query("status");
  const limit = parsePositiveInt(c.req.query("limit"), 200, 1000);
  const params: (string | number | null)[] = [];
  let where = "";
  if (status !== undefined && status.length > 0) {
    where = "WHERE status = ?";
    params.push(status);
  }
  const rows = getDb().raw
    .query(
      `SELECT qid, status, kind, task, question, options, opened_at, answered_at, answer_text,
              resolved_at, applied, applied_by, applied_rule_ref, defer_until, last_event_seq
       FROM questions ${where}
       ORDER BY opened_at DESC LIMIT ?`,
    )
    .all(...params, limit) as QuestionRow[];
  return c.json({
    questions: rows.map((r) => ({
      qid: r.qid,
      status: r.status,
      kind: r.kind,
      task: r.task,
      question: r.question,
      options: parseJsonSafe(r.options),
      opened_at: r.opened_at,
      answered_at: r.answered_at,
      answer_text: r.answer_text,
      resolved_at: r.resolved_at,
      applied: r.applied,
      applied_by: r.applied_by,
      applied_rule_ref: r.applied_rule_ref,
      defer_until: r.defer_until,
      last_event_seq: r.last_event_seq,
    })),
    count: rows.length,
  });
});

// -----------------------------------------------------------------------------
// /manifest — parsed rules for the Questions screen's rule-picker (GSL-277)
//
// Reads `docs/lab/decisions/manifest.md` on every hit. The file is small (<10 KB) and the parser
// is O(lines); no cache. This keeps the picker in sync with owner edits without a server restart.
// -----------------------------------------------------------------------------

readRoutes.get("/manifest", requireBearer, (c) => {
  try {
    const parsed = loadManifest();
    return c.json({
      path: parsed.path,
      bytes: parsed.bytes,
      mtime: parsed.mtime,
      count: parsed.rules.length,
      skipped: parsed.skipped,
      rules: parsed.rules,
    });
  } catch (err) {
    return c.json(
      {
        error: err instanceof Error ? err.message : String(err),
        rules: [],
        count: 0,
      },
      500,
    );
  }
});

// -----------------------------------------------------------------------------
// /skills — skill registry state
// -----------------------------------------------------------------------------

interface SkillRow {
  name: string;
  version: string;
  status: string;
  last_published_at: string | null;
  last_published_by: string | null;
  changelog: string;
}

readRoutes.get("/skills", requireBearer, (c) => {
  const rows = getDb().raw
    .query(
      `SELECT name, version, status, last_published_at, last_published_by, changelog
       FROM skills ORDER BY name ASC`,
    )
    .all() as SkillRow[];
  return c.json({
    skills: rows.map((r) => ({
      name: r.name,
      version: r.version,
      status: r.status,
      last_published_at: r.last_published_at,
      last_published_by: r.last_published_by,
      changelog: parseJsonSafe(r.changelog) ?? [],
    })),
    count: rows.length,
  });
});

// -----------------------------------------------------------------------------
// /timeline — latest N events, filterable by type/task
// -----------------------------------------------------------------------------

interface TimelineRow {
  seq: number;
  day: string;
  ts: string;
  src: string;
  actor: string;
  task: string | null;
  type: string;
  payload: string;
  supersedes_seq: number | null;
}

readRoutes.get("/timeline", requireBearer, (c) => {
  const limit = parsePositiveInt(c.req.query("limit"), 100, 1000);
  const type = c.req.query("type");
  const task = c.req.query("task");
  const params: (string | number | null)[] = [];
  const clauses: string[] = [];
  if (type !== undefined && type.length > 0) {
    clauses.push("type = ?");
    params.push(type);
  }
  if (task !== undefined && task.length > 0) {
    clauses.push("task = ?");
    params.push(task);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getDb().raw
    .query(
      `SELECT seq, day, ts, src, actor, task, type, payload, supersedes_seq
       FROM events ${where} ORDER BY seq DESC LIMIT ?`,
    )
    .all(...params, limit) as TimelineRow[];
  return c.json({
    events: rows.map((r) => ({
      seq: r.seq,
      day: r.day,
      ts: r.ts,
      src: r.src,
      actor: r.actor,
      task: r.task,
      type: r.type,
      payload: parseJsonSafe(r.payload),
      supersedes_seq: r.supersedes_seq,
    })),
    count: rows.length,
    max_seq: maxSeq(),
  });
});

// -----------------------------------------------------------------------------
// /tasks — Jira-cache projection
// -----------------------------------------------------------------------------

interface TaskRow {
  key: string;
  epic: string | null;
  status: string;
  title: string;
  labels: string | null;
  last_synced_at: string | null;
}

readRoutes.get("/tasks", requireBearer, (c) => {
  const epic = c.req.query("epic");
  const status = c.req.query("status");
  const params: (string | number | null)[] = [];
  const clauses: string[] = [];
  if (epic !== undefined && epic.length > 0) {
    clauses.push("epic = ?");
    params.push(epic);
  }
  if (status !== undefined && status.length > 0) {
    clauses.push("status = ?");
    params.push(status);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getDb().raw
    .query(
      `SELECT key, epic, status, title, labels, last_synced_at
       FROM tasks ${where} ORDER BY key ASC`,
    )
    .all(...params) as TaskRow[];
  return c.json({
    tasks: rows.map((r) => ({
      key: r.key,
      epic: r.epic,
      status: r.status,
      title: r.title,
      labels: parseJsonSafe(r.labels) ?? [],
      last_synced_at: r.last_synced_at,
    })),
    count: rows.length,
  });
});

// -----------------------------------------------------------------------------
// /cost — v1 approximation from events with type='cost.observed'
// -----------------------------------------------------------------------------

interface CostRow {
  seq: number;
  day: string;
  ts: string;
  payload: string;
}

readRoutes.get("/cost", requireBearer, (c) => {
  const limit = parsePositiveInt(c.req.query("limit"), 60, 365);
  // Aggregate on day for the last N days observed in events. The schema does not yet carry a
  // per-actor cost table; the v1 projection reads cost events by type prefix and returns the
  // raw records. A proper aggregation table lands with the fleet dashboard task.
  const rows = getDb().raw
    .query(
      `SELECT seq, day, ts, payload FROM events
       WHERE type LIKE 'cost.%' ORDER BY seq DESC LIMIT ?`,
    )
    .all(limit) as CostRow[];
  return c.json({
    cost_events: rows.map((r) => ({
      seq: r.seq,
      day: r.day,
      ts: r.ts,
      payload: parseJsonSafe(r.payload),
    })),
    count: rows.length,
    note: "v1 raw cost.* events; aggregation lands with fleet dashboard task",
  });
});

// -----------------------------------------------------------------------------
// /fleet — per-agent projection over `agent_sessions` (GSL-276 / Delta 8.1)
// -----------------------------------------------------------------------------

interface AgentSessionRow {
  session_id: string;
  name: string;
  kind: string;
  pid: number | null;
  model: string | null;
  cwd: string;
  cycle: number | null;
  context_pct: number | null;
  current_tool: string | null;
  current_intent: string | null;
  status: string;
  started_at: string;
  updated_at: string;
  ended_at: string | null;
}

readRoutes.get("/fleet", requireBearer, (c) => {
  // Sort: live sessions first, then by most-recently-updated. `ended` rows sink to the
  // bottom so the top of the Fleet screen is always the active fleet — but they're not
  // filtered out, so an owner can still see "who ended in the last hour" without a filter
  // dance. A future ?include=live query knob is easy to add if the row count ever grows past
  // the SPA's happy limit.
  const rows = getDb().raw
    .query(
      `SELECT session_id, name, kind, pid, model, cwd, cycle, context_pct, current_tool,
              current_intent, status, started_at, updated_at, ended_at
       FROM agent_sessions
       ORDER BY (ended_at IS NULL) DESC, updated_at DESC
       LIMIT 200`,
    )
    .all() as AgentSessionRow[];

  // Totals row for the /bundle + Fleet header. `agents_live` = rows without ended_at;
  // `agents_busy` = subset with status='busy'. The heartbeat scalar (`context_pct`) is joined
  // in as a legacy field so pre-Fleet-screen dashboards keep the same reading — but the
  // per-session table above is now the authoritative source per Delta 8.1.
  const heartbeat = getDb().raw
    .query(
      `SELECT context_pct FROM heartbeat
       ORDER BY seq DESC LIMIT 1`,
    )
    .get() as { context_pct: number | null } | undefined;

  const totals = {
    agents_total: rows.length,
    agents_live: rows.filter((r) => r.ended_at === null).length,
    agents_busy: rows.filter((r) => r.ended_at === null && r.status === "busy").length,
    heartbeat_context_pct: heartbeat?.context_pct ?? null,
  };

  return c.json({
    sessions: rows.map((r) => ({
      session_id: r.session_id,
      name: r.name,
      kind: r.kind,
      pid: r.pid,
      model: r.model,
      cwd: r.cwd,
      cycle: r.cycle,
      context_pct: r.context_pct,
      current_tool: r.current_tool,
      current_intent: r.current_intent,
      status: r.status,
      started_at: r.started_at,
      updated_at: r.updated_at,
      ended_at: r.ended_at,
    })),
    count: rows.length,
    totals,
  });
});

// -----------------------------------------------------------------------------
// /bundle — the "render_bundle.json" replacement (all projections in one)
// -----------------------------------------------------------------------------

readRoutes.get("/bundle", requireBearer, (c) => {
  const db = getDb();
  const questions = db.raw
    .query(
      `SELECT qid, status, kind, task, question, options, opened_at, answered_at, answer_text,
              resolved_at, applied, applied_by, applied_rule_ref, defer_until
       FROM questions ORDER BY opened_at DESC LIMIT 200`,
    )
    .all() as QuestionRow[];
  const skills = db.raw
    .query(
      `SELECT name, version, status, last_published_at, last_published_by, changelog
       FROM skills ORDER BY name ASC`,
    )
    .all() as SkillRow[];
  const timeline = db.raw
    .query(
      `SELECT seq, day, ts, src, actor, task, type, payload
       FROM events ORDER BY seq DESC LIMIT 200`,
    )
    .all() as TimelineRow[];
  const tasks = db.raw
    .query(
      `SELECT key, epic, status, title, labels, last_synced_at
       FROM tasks ORDER BY key ASC`,
    )
    .all() as TaskRow[];

  return c.json({
    generated_at: new Date().toISOString(),
    max_event_seq: maxSeq(),
    counts: {
      events: tableCount("events"),
      questions: tableCount("questions"),
      skills: tableCount("skills"),
      tasks: tableCount("tasks"),
    },
    questions: questions.map((r) => ({
      qid: r.qid,
      status: r.status,
      kind: r.kind,
      task: r.task,
      question: r.question,
      options: parseJsonSafe(r.options),
      opened_at: r.opened_at,
      answered_at: r.answered_at,
      answer_text: r.answer_text,
      resolved_at: r.resolved_at,
      applied: r.applied,
      applied_by: r.applied_by,
      applied_rule_ref: r.applied_rule_ref,
      defer_until: r.defer_until,
    })),
    skills: skills.map((r) => ({
      name: r.name,
      version: r.version,
      status: r.status,
      last_published_at: r.last_published_at,
      last_published_by: r.last_published_by,
      changelog: parseJsonSafe(r.changelog) ?? [],
    })),
    timeline: timeline.map((r) => ({
      seq: r.seq,
      day: r.day,
      ts: r.ts,
      src: r.src,
      actor: r.actor,
      task: r.task,
      type: r.type,
      payload: parseJsonSafe(r.payload),
    })),
    tasks: tasks.map((r) => ({
      key: r.key,
      epic: r.epic,
      status: r.status,
      title: r.title,
      labels: parseJsonSafe(r.labels) ?? [],
      last_synced_at: r.last_synced_at,
    })),
    fleet: {
      sessions: (getDb().raw
        .query(
          `SELECT session_id, name, kind, pid, model, cwd, cycle, context_pct, current_tool,
                  current_intent, status, started_at, updated_at, ended_at
           FROM agent_sessions
           ORDER BY (ended_at IS NULL) DESC, updated_at DESC
           LIMIT 200`,
        )
        .all() as AgentSessionRow[]).map((r) => ({
        session_id: r.session_id,
        name: r.name,
        kind: r.kind,
        pid: r.pid,
        model: r.model,
        cwd: r.cwd,
        cycle: r.cycle,
        context_pct: r.context_pct,
        current_tool: r.current_tool,
        current_intent: r.current_intent,
        status: r.status,
        started_at: r.started_at,
        updated_at: r.updated_at,
        ended_at: r.ended_at,
      })),
    },
  });
});
