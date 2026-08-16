// GSL-380 — live refusal-path smoke for the submit-task executor.
//
// Runs three refusal cases against a real tmux + real DB shape (in-memory), verifying that
// each case returns the correct outcome and sends nothing to any pane:
//   A. state='observer'          → 'released_mid_submit'
//   B. shim_registered=0         → 'released_mid_submit'
//   C. pane_ref resolves null    → 'pane_gone'  (test seeds a pane_current_path
//                                                that doesn't overlap cwd_project_root)
//
// Never sends keys to any pane; the executor short-circuits before spawn. Usage:
//   bun apps/core/scripts/smoke/submit-live-refusals.ts

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/db/schema.ts";
import { submitTask } from "../../src/sessions/submit.ts";
import type { OpenedDb } from "../../src/db/client.ts";

function bootScratchDb(): OpenedDb {
  const raw = new Database(":memory:");
  raw.exec("PRAGMA journal_mode = MEMORY;");
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
  return { db, raw, path: ":memory:" };
}

async function main(): Promise<void> {
  const results: Record<string, unknown> = {};

  // Case A: state='observer' -> 'released_mid_submit'
  {
    const opened = bootScratchDb();
    opened.raw
      .query(`INSERT INTO session_control (session_id, state, source, shim_registered) VALUES ('S-A', 'observer', 'runtime', 1)`)
      .run();
    const r = await submitTask(opened, { session_id: "S-A", body: "should not send", framing: "none" });
    results.A_observer = { outcome: r.outcome, sent: r.tmuxSendBody !== null };
  }

  // Case B: shim_registered=0 -> 'released_mid_submit'
  {
    const opened = bootScratchDb();
    opened.raw
      .query(`INSERT INTO session_control (session_id, state, source, shim_registered) VALUES ('S-B', 'controlled', 'runtime', 0)`)
      .run();
    const r = await submitTask(opened, { session_id: "S-B", body: "should not send", framing: "none" });
    results.B_shim_unregistered = { outcome: r.outcome, sent: r.tmuxSendBody !== null };
  }

  // Case C: pane_ref resolves null -> 'pane_gone'
  {
    const opened = bootScratchDb();
    opened.raw.query(`INSERT INTO session_control (session_id, state, source, shim_registered, activated_at, activated_by) VALUES ('S-C', 'controlled', 'runtime', 1, ?, 'owner-web')`).run(new Date().toISOString());
    opened.raw.query(`INSERT INTO agent_sessions (session_id, name, kind, cwd, cwd_project_root, status, started_at, updated_at) VALUES ('S-C', 's', 'interactive', '/nope', '/nope', 'idle', ?, ?)`).run(new Date().toISOString(), new Date().toISOString());
    // No matching pane row — pane_current_path is disjoint from cwd_project_root.
    opened.raw.query(`INSERT INTO tmux_panes (pane_id, session_id, session_name, window_id, pane_pid, pane_current_path, pane_current_command, pane_title, first_seen, last_seen, misses) VALUES ('%99', 't-1', 'gsl378-target', '@1', 12345, '/somewhere/else', 'bash', 'bash', ?, ?, 0)`).run(new Date().toISOString(), new Date().toISOString());
    const r = await submitTask(opened, { session_id: "S-C", body: "should not send", framing: "none" });
    results.C_pane_gone = { outcome: r.outcome, sent: r.tmuxSendBody !== null };
  }

  console.log(JSON.stringify({ event: "refusals.result", ...results }));
  const ok =
    (results.A_observer as { outcome: string; sent: boolean }).outcome === "released_mid_submit" &&
    (results.A_observer as { outcome: string; sent: boolean }).sent === false &&
    (results.B_shim_unregistered as { outcome: string; sent: boolean }).outcome === "released_mid_submit" &&
    (results.B_shim_unregistered as { outcome: string; sent: boolean }).sent === false &&
    (results.C_pane_gone as { outcome: string; sent: boolean }).outcome === "pane_gone" &&
    (results.C_pane_gone as { outcome: string; sent: boolean }).sent === false;
  process.exit(ok ? 0 : 1);
}

await main();
