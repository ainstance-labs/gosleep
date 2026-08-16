// GSL-380 — live scratch-tmux smoke for the submit-task executor.
//
// Boots an in-memory DB (with the three tables the executor reads), seeds one controlled
// session pointing at a REAL tmux pane, runs `submitTask`, and verifies the body landed
// via `tmux capture-pane`. Never targets any tmux pane you did not create — the caller
// passes the target pane ref and session_name as env vars; the smoke asserts the prefix
// starts with `gsl378-` before doing anything.
//
// Usage:
//   tmux new-session -d -s gsl378-target 'bash --noprofile --norc'
//   PANE_REF=$(tmux list-panes -t gsl378-target \
//     -F '#{session_name}:#{window_id}.#{pane_id}')
//   bun apps/core/scripts/smoke/submit-live-smoke.ts "$PANE_REF"
//   tmux kill-session -t gsl378-target
//
// This is NOT part of `gate.sh`. It's a scratch-tmux smoke you run by hand when touching
// `apps/core/src/sessions/submit.ts`. Emits one JSON summary line at the end.

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/db/schema.ts";
import { submitTask } from "../../src/sessions/submit.ts";
import type { OpenedDb } from "../../src/db/client.ts";
import { spawn as bunSpawn } from "bun";

async function tmuxCapture(paneRef: string): Promise<string> {
  const p = bunSpawn({ cmd: ["tmux", "capture-pane", "-t", paneRef, "-p"], stdout: "pipe" });
  const out = await new Response(p.stdout).text();
  await p.exited;
  return out;
}

async function main(): Promise<void> {
  const paneRef = process.argv[2];
  if (paneRef === undefined || paneRef.length === 0) {
    console.error(JSON.stringify({ event: "smoke.usage", note: "pass pane_ref as argv[1]" }));
    process.exit(2);
  }
  if (!paneRef.startsWith("gsl378-")) {
    console.error(
      JSON.stringify({
        event: "smoke.refuse",
        reason: "pane_ref does not start with 'gsl378-' — refusing to send to a foreign pane",
        pane_ref: paneRef,
      }),
    );
    process.exit(2);
  }

  // The `session_name:window_id.pane_id` triple — parse to store the pane row in tmux_panes.
  const colon = paneRef.indexOf(":");
  const dot = paneRef.lastIndexOf(".");
  if (colon < 0 || dot < colon) {
    console.error(JSON.stringify({ event: "smoke.parse.fail", pane_ref: paneRef }));
    process.exit(2);
  }
  const sessName = paneRef.slice(0, colon);
  const windowId = paneRef.slice(colon + 1, dot);
  const paneId = paneRef.slice(dot + 1);
  const cwd_project_root = process.cwd();

  const raw = new Database(":memory:");
  raw.exec(`CREATE TABLE session_control (
    session_id TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'observer',
    source TEXT NOT NULL DEFAULT 'runtime',
    activated_at TEXT, activated_by TEXT, deactivated_at TEXT,
    shim_registered INTEGER NOT NULL DEFAULT 0,
    last_heartbeat_at TEXT, last_heartbeat_pid INTEGER
  );`);
  raw.exec(`CREATE TABLE agent_sessions (
    session_id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
    pid INTEGER, model TEXT, cwd TEXT NOT NULL, cycle INTEGER, context_pct INTEGER,
    current_tool TEXT, current_intent TEXT, status TEXT NOT NULL,
    started_at TEXT NOT NULL, updated_at TEXT NOT NULL, ended_at TEXT,
    last_pr_url TEXT, last_pr_at TEXT,
    project_slug TEXT, cwd_project_root TEXT,
    observed_only INTEGER NOT NULL DEFAULT 0
  );`);
  raw.exec(`CREATE TABLE tmux_panes (
    pane_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, session_name TEXT NOT NULL,
    window_id TEXT NOT NULL, pane_pid INTEGER NOT NULL,
    pane_current_path TEXT, pane_current_command TEXT, pane_title TEXT,
    first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, misses INTEGER NOT NULL DEFAULT 0
  );`);
  const db = drizzle(raw, { schema });
  const opened: OpenedDb = { db, raw, path: ":memory:" };

  const nowIso = new Date().toISOString();
  raw
    .query(
      `INSERT INTO session_control (session_id, state, source, shim_registered, activated_at, activated_by)
       VALUES ('gsl378-smoke', 'controlled', 'runtime', 1, ?, 'owner-web')`,
    )
    .run(nowIso);
  raw
    .query(
      `INSERT INTO agent_sessions (session_id, name, kind, cwd, cwd_project_root,
                                   status, started_at, updated_at)
       VALUES ('gsl378-smoke', 'smoke', 'interactive', ?, ?, 'idle', ?, ?)`,
    )
    .run(cwd_project_root, cwd_project_root, nowIso, nowIso);
  raw
    .query(
      `INSERT INTO tmux_panes (pane_id, session_id, session_name, window_id, pane_pid,
                               pane_current_path, pane_current_command, pane_title,
                               first_seen, last_seen, misses)
       VALUES (?, 'tmux-1', ?, ?, 99999, ?, 'bash', 'bash', ?, ?, 0)`,
    )
    .run(paneId, sessName, windowId, cwd_project_root, nowIso, nowIso);

  const stamp = `SUBMIT-${Date.now().toString(36)}`;
  const body = `# ${stamp} — smoke line`;

  const r = await submitTask(opened, {
    session_id: "gsl378-smoke",
    body,
    framing: "none",
  });

  // Give tmux a beat to render the line + Enter into the pane buffer.
  await new Promise((res) => setTimeout(res, 250));
  const captured = await tmuxCapture(paneRef);
  const landed = captured.includes(stamp);

  console.log(
    JSON.stringify({
      event: "smoke.result",
      pane_ref: paneRef,
      outcome: r.outcome,
      body_len: r.body_len,
      body_sha256: r.body_sha256,
      landed_in_pane: landed,
      capture_tail: captured.split("\n").slice(-6).join("\\n"),
    }),
  );
  process.exit(r.outcome === "delivered" && landed ? 0 : 1);
}

await main();
