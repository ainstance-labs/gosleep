// @gosleep/core — per-session control registry (GSL-361, observer mode phase B).
//
// Thin DB layer over `session_control`. Called by:
//   - the shim's `/internal/sessions/:id/control` fast lookup (GET),
//   - the shim's `/internal/sessions/:id/shim-heartbeat` first-invocation upsert (POST),
//   - the panel's `/sessions/:id/control` public read (GET, Bearer),
//   - the write endpoints `/actions/sessions/:id/take-control` and `/release-control`.
//
// Every writer is idempotent by (session_id, target-state): asking for `state=controlled` on a
// row that is already `controlled` returns the existing row rather than throwing. Actual
// idempotency for the panel-facing writes is enforced one layer up by the Idempotency-Key
// ledger in `actions/withTimeline.ts`.

import type { OpenedDb } from "../db/client.ts";

export type ControlState = "observer" | "controlled";
export type ControlSource = "env" | "runtime" | "inherited";

export interface ControlRow {
  session_id: string;
  state: ControlState;
  source: ControlSource;
  activated_at: string | null;
  activated_by: string | null;
  deactivated_at: string | null;
  shim_registered: boolean;
  last_heartbeat_at: string | null;
  last_heartbeat_pid: number | null;
}

/** Shape stored in SQLite (INTEGER for the boolean-ish column). */
interface RawRow {
  session_id: string;
  state: string;
  source: string;
  activated_at: string | null;
  activated_by: string | null;
  deactivated_at: string | null;
  shim_registered: number;
  last_heartbeat_at: string | null;
  last_heartbeat_pid: number | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toControlRow(r: RawRow): ControlRow {
  return {
    session_id: r.session_id,
    state: (r.state === "controlled" ? "controlled" : "observer") as ControlState,
    source:
      r.source === "env"
        ? "env"
        : r.source === "inherited"
          ? "inherited"
          : "runtime",
    activated_at: r.activated_at,
    activated_by: r.activated_by,
    deactivated_at: r.deactivated_at,
    shim_registered: r.shim_registered === 1,
    last_heartbeat_at: r.last_heartbeat_at,
    last_heartbeat_pid: r.last_heartbeat_pid,
  };
}

/** Fetch the row for a session_id or null. Cheap: single-row lookup by primary key. */
export function readControl(
  db: OpenedDb,
  sessionId: string,
): ControlRow | null {
  const row = db.raw
    .query(
      `SELECT session_id, state, source, activated_at, activated_by, deactivated_at,
              shim_registered, last_heartbeat_at, last_heartbeat_pid
       FROM session_control WHERE session_id = ?`,
    )
    .get(sessionId) as RawRow | undefined | null;
  if (row === undefined || row === null) return null;
  return toControlRow(row);
}

/**
 * Fast-path effective state for the shim's compound-OR gate. Returns 'controlled' iff a row
 * exists AND state='controlled'; anything else (missing row, state='observer') collapses to
 * 'observer'. Cheap enough to run on every shim invocation once every 1 s (per the shim's
 * in-process cache TTL).
 */
export function readEffectiveState(
  db: OpenedDb,
  sessionId: string,
): { state: ControlState; source: ControlSource | null; shim_registered: boolean } {
  const row = readControl(db, sessionId);
  if (row === null) {
    return { state: "observer", source: null, shim_registered: false };
  }
  return {
    state: row.state,
    source: row.source,
    shim_registered: row.shim_registered,
  };
}

export interface HeartbeatInput {
  session_id: string;
  pid: number | null;
  /** When the shim was launched under `GOSLEEP_WEB_QUESTIONS=1`, it stamps this true so the
   *  registry upserts state=controlled/source=env immediately (F15-S4, R15.3). */
  env_opt_in: boolean;
}

export interface HeartbeatResult {
  session_id: string;
  state: ControlState;
  source: ControlSource;
  shim_registered: boolean;
  env_locked: boolean;
  created: boolean;
}

/**
 * Register a shim's heartbeat (called on the FIRST shim invocation per session, and idempotently
 * on subsequent ones). Semantics:
 *   - A row is created if missing.
 *   - `shim_registered` flips to 1 unconditionally.
 *   - `last_heartbeat_at` + `last_heartbeat_pid` stamped from `nowIso()` / `input.pid`.
 *   - If `input.env_opt_in && row.state != 'controlled'`, upgrade to
 *     `state='controlled', source='env', activated_at=now, activated_by='shim-env'`.
 *   - If the row already exists with source='runtime' (owner took control from panel) and the
 *     shim reports env_opt_in=true, we DO NOT overwrite — the runtime control is at least as
 *     strong as the env flag; keep the existing source so the panel's Release button stays live.
 *   - Otherwise the row is left as-is (state='observer' or 'controlled/runtime').
 */
export function recordHeartbeat(
  db: OpenedDb,
  input: HeartbeatInput,
): HeartbeatResult {
  const existing = readControl(db, input.session_id);
  const nowTs = nowIso();
  if (existing === null) {
    // Fresh row. `state` starts as observer unless the shim brought an env flag.
    const state: ControlState = input.env_opt_in ? "controlled" : "observer";
    const source: ControlSource = input.env_opt_in ? "env" : "runtime";
    const activatedAt = input.env_opt_in ? nowTs : null;
    const activatedBy = input.env_opt_in ? "shim-env" : null;
    db.raw
      .query(
        `INSERT INTO session_control
           (session_id, state, source, activated_at, activated_by, deactivated_at,
            shim_registered, last_heartbeat_at, last_heartbeat_pid)
         VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?)`,
      )
      .run(
        input.session_id,
        state,
        source,
        activatedAt,
        activatedBy,
        nowTs,
        input.pid,
      );
    return {
      session_id: input.session_id,
      state,
      source,
      shim_registered: true,
      env_locked: state === "controlled" && source === "env",
      created: true,
    };
  }

  // Existing row. Rules:
  //   * Always mark shim as registered + refresh heartbeat.
  //   * env_opt_in only ESCALATES to controlled/env when the row is currently observer
  //     (never demotes a runtime-controlled row, never overwrites an env row).
  if (input.env_opt_in && existing.state === "observer") {
    db.raw
      .query(
        `UPDATE session_control
           SET state = 'controlled', source = 'env',
               activated_at = ?, activated_by = 'shim-env',
               deactivated_at = NULL,
               shim_registered = 1, last_heartbeat_at = ?, last_heartbeat_pid = ?
         WHERE session_id = ?`,
      )
      .run(nowTs, nowTs, input.pid, input.session_id);
    return {
      session_id: input.session_id,
      state: "controlled",
      source: "env",
      shim_registered: true,
      env_locked: true,
      created: false,
    };
  }

  db.raw
    .query(
      `UPDATE session_control
         SET shim_registered = 1, last_heartbeat_at = ?, last_heartbeat_pid = ?
       WHERE session_id = ?`,
    )
    .run(nowTs, input.pid, input.session_id);
  return {
    session_id: input.session_id,
    state: existing.state,
    source: existing.source,
    shim_registered: true,
    env_locked: existing.state === "controlled" && existing.source === "env",
    created: false,
  };
}

export interface TransitionInput {
  session_id: string;
  by: string;
}

export interface TransitionResult {
  session_id: string;
  state: ControlState;
  source: ControlSource;
  activated_at: string | null;
  activated_by: string | null;
  deactivated_at: string | null;
  shim_registered: boolean;
  changed: boolean;
}

/**
 * Take control. Refuses:
 *   - No row exists (no shim ever registered) — 409 upstream.
 *   - shim_registered=0 — same reason (R15.7).
 *   - Already controlled — returns changed:false (idempotent no-op).
 *
 * Escalates state='observer' → 'controlled', source='runtime'. Never changes an env-locked row.
 */
export function takeControl(
  db: OpenedDb,
  input: TransitionInput,
): TransitionResult {
  const existing = readControl(db, input.session_id);
  if (existing === null) {
    const err = new Error(
      `session_id ${input.session_id} not found in session_control — shim has never checked in`,
    );
    (err as Error & { httpStatus?: number }).httpStatus = 404;
    throw err;
  }
  if (!existing.shim_registered) {
    const err = new Error(
      `session ${input.session_id} has no registered shim — refusing take-control (R15.7)`,
    );
    (err as Error & { httpStatus?: number }).httpStatus = 409;
    throw err;
  }
  if (existing.state === "controlled") {
    // Idempotent replay. Env-locked rows also collapse here — the panel wouldn't have exposed
    // the button, but if a caller hits the endpoint directly the result is a no-op, not an
    // error (the state is already what the caller asked for).
    return {
      session_id: existing.session_id,
      state: existing.state,
      source: existing.source,
      activated_at: existing.activated_at,
      activated_by: existing.activated_by,
      deactivated_at: existing.deactivated_at,
      shim_registered: existing.shim_registered,
      changed: false,
    };
  }
  const nowTs = nowIso();
  db.raw
    .query(
      `UPDATE session_control
         SET state = 'controlled', source = 'runtime',
             activated_at = ?, activated_by = ?, deactivated_at = NULL
       WHERE session_id = ? AND state = 'observer'`,
    )
    .run(nowTs, input.by, input.session_id);
  return {
    session_id: input.session_id,
    state: "controlled",
    source: "runtime",
    activated_at: nowTs,
    activated_by: input.by,
    deactivated_at: null,
    shim_registered: true,
    changed: true,
  };
}

/**
 * Release control. Refuses:
 *   - No row — 404.
 *   - Env-locked (source='env', state='controlled') — 409 (R15.3, "not releasable from panel").
 *   - Already observer — returns changed:false (idempotent).
 */
export function releaseControl(
  db: OpenedDb,
  input: TransitionInput,
): TransitionResult {
  const existing = readControl(db, input.session_id);
  if (existing === null) {
    const err = new Error(
      `session_id ${input.session_id} not found in session_control`,
    );
    (err as Error & { httpStatus?: number }).httpStatus = 404;
    throw err;
  }
  if (existing.state === "controlled" && existing.source === "env") {
    const err = new Error(
      `session ${input.session_id} is env-locked; restart in a shell without GOSLEEP_WEB_QUESTIONS=1 to release`,
    );
    (err as Error & { httpStatus?: number }).httpStatus = 409;
    throw err;
  }
  if (existing.state === "observer") {
    return {
      session_id: existing.session_id,
      state: existing.state,
      source: existing.source,
      activated_at: existing.activated_at,
      activated_by: existing.activated_by,
      deactivated_at: existing.deactivated_at,
      shim_registered: existing.shim_registered,
      changed: false,
    };
  }
  const nowTs = nowIso();
  db.raw
    .query(
      `UPDATE session_control
         SET state = 'observer', source = 'runtime',
             deactivated_at = ?
       WHERE session_id = ? AND state = 'controlled' AND source != 'env'`,
    )
    .run(nowTs, input.session_id);
  return {
    session_id: input.session_id,
    state: "observer",
    source: "runtime",
    activated_at: existing.activated_at,
    activated_by: existing.activated_by,
    deactivated_at: nowTs,
    shim_registered: true,
    changed: true,
  };
}

/** List every row with state=controlled — used by /sessions?state=controlled and the panel. */
export function listControlled(db: OpenedDb): ControlRow[] {
  const rows = db.raw
    .query(
      `SELECT session_id, state, source, activated_at, activated_by, deactivated_at,
              shim_registered, last_heartbeat_at, last_heartbeat_pid
       FROM session_control WHERE state = 'controlled'
       ORDER BY COALESCE(activated_at, '') DESC`,
    )
    .all() as RawRow[];
  return rows.map(toControlRow);
}
