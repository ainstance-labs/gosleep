// @gosleep/core — /observed/* read routes (GSL-355 under GSL-350 phase 14).
//
// All Bearer-gated. Reads the observer-mode projection tables written by the collectors:
//
//   GET /observed/tmux         Snapshot of the tmux_panes table (last-seen desc, capped 500).
//   GET /observed/sessions     Machine-wide Claude sessions snapshot with observed_only flag.
//   GET /observed/projects     Project projection (colour, hide-list-aware pseudonym).
//   GET /observed/events       Latest observed_events; ?since, ?limit, ?project filters.
//   GET /observed/collectors   Inventory of registered collectors: cadence, events_today,
//                              write_attempts (must stay 0 — R14.1), last_error, disabled.

import { Hono } from "hono";

import { requireBearer } from "../security/bearer.ts";
import { getDb } from "../db/client.ts";
import { listCollectors } from "../observed/sentinel.ts";
import { listProjects } from "../observed/projects.ts";

export const observedRoutes = new Hono();

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

// -----------------------------------------------------------------------------
// /observed/tmux
// -----------------------------------------------------------------------------

interface TmuxRow {
  pane_id: string;
  session_id: string;
  session_name: string;
  window_id: string;
  pane_pid: number;
  pane_current_path: string | null;
  pane_current_command: string | null;
  pane_title: string | null;
  first_seen: string;
  last_seen: string;
  misses: number;
}

observedRoutes.get("/observed/tmux", requireBearer, (c) => {
  const rows = getDb()
    .raw.query(
      "SELECT pane_id, session_id, session_name, window_id, pane_pid, pane_current_path, " +
        "pane_current_command, pane_title, first_seen, last_seen, misses FROM tmux_panes " +
        "ORDER BY last_seen DESC LIMIT 500",
    )
    .all() as TmuxRow[];
  return c.json({ panes: rows, count: rows.length });
});

// -----------------------------------------------------------------------------
// /observed/sessions — machine-wide Claude session snapshot
// -----------------------------------------------------------------------------

interface SessionRow {
  session_id: string;
  name: string;
  model: string | null;
  cwd: string;
  status: string;
  project_slug: string | null;
  cwd_project_root: string | null;
  observed_only: number;
  started_at: string;
  updated_at: string;
  ended_at: string | null;
  // GSL-361 (observer mode phase B) — per-session control-registry projection joined from
  // session_control. NULLs mean "no row" — the Observed card renders `observer + Take
  // disabled` in that case (R15.7 fallback).
  control_state: string | null;
  control_source: string | null;
  shim_registered: number | null;
}

observedRoutes.get("/observed/sessions", requireBearer, (c) => {
  const rows = getDb()
    .raw.query(
      "SELECT a.session_id, a.name, a.model, a.cwd, a.status, a.project_slug, a.cwd_project_root, " +
        "a.observed_only, a.started_at, a.updated_at, a.ended_at, " +
        "sc.state AS control_state, sc.source AS control_source, sc.shim_registered AS shim_registered " +
        "FROM agent_sessions a " +
        "LEFT JOIN session_control sc ON sc.session_id = a.session_id " +
        "ORDER BY (a.ended_at IS NULL) DESC, a.updated_at DESC LIMIT 500",
    )
    .all() as SessionRow[];
  return c.json({
    sessions: rows.map((r) => ({
      session_id: r.session_id,
      name: r.name,
      model: r.model,
      cwd: r.cwd,
      status: r.status,
      project_slug: r.project_slug,
      cwd_project_root: r.cwd_project_root,
      observed_only: r.observed_only === 1,
      started_at: r.started_at,
      updated_at: r.updated_at,
      ended_at: r.ended_at,
      // GSL-361 — control state defaults to observer when no session_control row exists.
      control_state:
        r.control_state === "controlled" ? "controlled" : "observer",
      control_source: r.control_source ?? null,
      shim_registered: r.shim_registered === 1,
      env_locked:
        r.control_state === "controlled" && r.control_source === "env",
    })),
    count: rows.length,
  });
});

// -----------------------------------------------------------------------------
// /observed/projects
// -----------------------------------------------------------------------------

observedRoutes.get("/observed/projects", requireBearer, (c) => {
  const rows = listProjects();
  return c.json({
    projects: rows.map((r) => ({
      ...r,
      display_name: r.hidden && r.pseudonym !== null ? r.pseudonym : r.project_slug,
    })),
    count: rows.length,
  });
});

// -----------------------------------------------------------------------------
// /observed/events — cross-project timeline
// -----------------------------------------------------------------------------

interface ObservedEventRow {
  seq: number;
  ts: string;
  project_slug: string | null;
  kind: string;
  source: string;
  payload_json: string | null;
}

observedRoutes.get("/observed/events", requireBearer, (c) => {
  const since = parsePositiveInt(c.req.query("since"), 0, Number.MAX_SAFE_INTEGER);
  const limit = parsePositiveInt(c.req.query("limit"), 200, 500);
  const project = c.req.query("project");

  const params: (string | number)[] = [since];
  let sql =
    "SELECT seq, ts, project_slug, kind, source, payload_json FROM observed_events " +
    "WHERE seq > ?";
  if (project !== undefined && project.length > 0) {
    sql += " AND project_slug = ?";
    params.push(project);
  }
  sql += " ORDER BY seq DESC LIMIT ?";
  params.push(limit);

  const rows = getDb().raw.query(sql).all(...params) as ObservedEventRow[];
  return c.json({
    events: rows.map((r) => ({
      seq: r.seq,
      ts: r.ts,
      project_slug: r.project_slug,
      kind: r.kind,
      source: r.source,
      payload: parseJsonSafe(r.payload_json),
    })),
    count: rows.length,
    since,
    limit,
  });
});

// -----------------------------------------------------------------------------
// /observed/collectors — inventory + write-attempt counters (R14.1)
// -----------------------------------------------------------------------------

observedRoutes.get("/observed/collectors", requireBearer, (c) => {
  const rows = listCollectors();
  return c.json({
    collectors: rows,
    count: rows.length,
    write_attempts_total: rows.reduce((n, r) => n + r.write_attempts, 0),
  });
});
