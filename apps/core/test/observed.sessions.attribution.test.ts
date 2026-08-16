// @gosleep/core — /observed/sessions attribution (GSL-396, E2E run-02 M-1).
//
// GSL-391 (run-01 m3) fixed the parent-cwd false-glue on /fleet via a per-pane ranked join
// (exact-cwd > deepest > pid-present > updated_at DESC). The /observed page was still
// re-deriving attribution client-side in apps/web/src/screens/Observed.tsx L235-241 with a
// weaker `.find(p => p.pane_current_path.startsWith(s.cwd_project_root))`. Result: a session
// whose cwd is the repo ROOT gets glued to the first pane whose cwd is any descendant — the
// exact defect the E2E run-02 fixture reproduced (`gosleep-66` card lists the fixture pane
// under `.claude/worktrees/e2e02` even though gosleep-66 lives in the main tree).
//
// This suite pins the fix at the server: /observed/sessions now projects `tmux_pane_ref`
// and `attribution` using the same ranked SQL block as /fleet. The client can drop its
// glue and consume `s.tmux_pane_ref` directly.
//
// Layout mirrors apps/core/test/fleet.projection.test.ts — scratch in-memory DB, mock
// db/client, hit the actual /observed/sessions Hono route.

import { beforeAll, describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Hono } from "hono";

import * as schema from "../src/db/schema.ts";
import type { OpenedDb } from "../src/db/client.ts";

const raw = new Database(":memory:");
raw.exec("PRAGMA journal_mode = MEMORY;");
raw.exec(`CREATE TABLE agent_sessions (
  session_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  pid INTEGER,
  model TEXT,
  cwd TEXT NOT NULL,
  cycle INTEGER,
  context_pct INTEGER,
  current_tool TEXT,
  current_intent TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT,
  last_pr_url TEXT,
  last_pr_at TEXT,
  project_slug TEXT,
  cwd_project_root TEXT,
  observed_only INTEGER NOT NULL DEFAULT 0
);`);
raw.exec(`CREATE TABLE tmux_panes (
  pane_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  session_name TEXT NOT NULL,
  window_id TEXT NOT NULL,
  pane_pid INTEGER NOT NULL,
  pane_current_path TEXT,
  pane_current_command TEXT,
  pane_title TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  misses INTEGER NOT NULL DEFAULT 0
);`);
raw.exec(`CREATE TABLE session_control (
  session_id TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'observer',
  source TEXT NOT NULL DEFAULT 'runtime',
  activated_at TEXT,
  activated_by TEXT,
  deactivated_at TEXT,
  shim_registered INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_at TEXT,
  last_heartbeat_pid INTEGER
);`);

const scratchDb = drizzle(raw, { schema });
const openedDb: OpenedDb = { db: scratchDb, raw, path: ":memory:" };

process.env.GOSLEEP_BEARER_TOKEN = "test-bearer";

mock.module("../src/db/client.ts", () => ({
  getDb: () => openedDb,
  openDatabase: () => openedDb,
  defaultDbPath: () => ":memory:",
  schema,
}));

const { observedRoutes } = await import("../src/routes/observed.ts");
const { requireLocalHost } = await import("../src/security/host.ts");

const app = new Hono();
app.use("*", requireLocalHost);
app.route("/", observedRoutes);

function req(path: string): Request {
  return new Request(`http://127.0.0.1:7331${path}`, {
    headers: {
      Host: "127.0.0.1:7331",
      Authorization: "Bearer test-bearer",
    },
  });
}

describe("/observed/sessions attribution (GSL-396, E2E run-02 M-1)", () => {
  test("parent-cwd session does NOT get glued to a deeper (worktree) pane", async () => {
    // The E2E run-02 fixture reproduces the defect: session `gosleep-66` cwd = main repo
    // root; pane cwd = `.claude/worktrees/e2e02`; the Observed page glued the two together
    // via a naive `startsWith` join. Server-side ranking sends the pane to the deeper
    // (worktree) session — the parent gets NULL for THIS pane.
    raw.exec("DELETE FROM agent_sessions");
    raw.exec("DELETE FROM tmux_panes");
    // Winner — the fixture worktree session (exact-cwd match).
    raw
      .query(
        `INSERT INTO agent_sessions
           (session_id, name, kind, pid, cwd, status, started_at, updated_at,
            project_slug, cwd_project_root, observed_only)
         VALUES ('e2e02-1f', 'e2e02-fixture', 'interactive', 56412,
                 '/repo/gosleep/.claude/worktrees/e2e02', 'active',
                 '2026-08-16T22:00:00Z', '2026-08-16T22:05:00Z',
                 'worktree', '/repo/gosleep/.claude/worktrees/e2e02', 1)`,
      )
      .run();
    // Ghost — a repo-root session (this is `gosleep-66` in the E2E fixture).
    raw
      .query(
        `INSERT INTO agent_sessions
           (session_id, name, kind, pid, cwd, status, started_at, updated_at,
            project_slug, cwd_project_root, observed_only)
         VALUES ('gosleep-66', 'observed:gosleep', 'interactive', 42722,
                 '/repo/gosleep', 'active',
                 '2026-08-16T21:00:00Z', '2026-08-16T21:00:10Z',
                 'gosleep', '/repo/gosleep', 1)`,
      )
      .run();
    // The pane whose path is the deeper worktree — belongs to the fixture, NOT the parent.
    raw
      .query(
        `INSERT INTO tmux_panes(pane_id, session_id, session_name, window_id, pane_pid,
                                 pane_current_path, pane_current_command, pane_title,
                                 first_seen, last_seen, misses)
         VALUES ('%444', '$1', 'e2e02-fixture', '@51', 56412,
                 '/repo/gosleep/.claude/worktrees/e2e02',
                 '2.1.233', 'e2e02', '2026-08-16T00:00:00Z', '2026-08-16T00:00:10Z', 0)`,
      )
      .run();

    const res = await app.fetch(req("/observed/sessions"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessions: Array<{
        session_id: string;
        tmux_pane_ref: string | null;
        attribution?: string | null;
      }>;
    };
    const fixture = body.sessions.find((s) => s.session_id === "e2e02-1f");
    const parent = body.sessions.find((s) => s.session_id === "gosleep-66");
    expect(fixture).toBeDefined();
    expect(parent).toBeDefined();

    // The fixture wins the deeper pane.
    expect(fixture!.tmux_pane_ref).toBe("e2e02-fixture:@51.%444");
    expect(fixture!.attribution).toBe("heuristic");

    // The parent-cwd session gets NULL for THIS pane — no glue.
    expect(parent!.tmux_pane_ref).toBeNull();
    expect(parent!.attribution).toBeNull();
  });

  test("empty tmux table → every row has null tmux_pane_ref (no glue)", async () => {
    raw.exec("DELETE FROM agent_sessions");
    raw.exec("DELETE FROM tmux_panes");
    raw
      .query(
        `INSERT INTO agent_sessions
           (session_id, name, kind, pid, cwd, status, started_at, updated_at,
            project_slug, cwd_project_root, observed_only)
         VALUES ('sess-alone', 'alone', 'interactive', NULL, '/repo/alone', 'idle',
                 '2026-08-16T00:00:00Z', '2026-08-16T00:00:10Z',
                 'alone', '/repo/alone', 1)`,
      )
      .run();
    const res = await app.fetch(req("/observed/sessions"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessions: Array<{ tmux_pane_ref: string | null; attribution?: string | null }>;
    };
    expect(body.sessions.length).toBe(1);
    expect(body.sessions[0]!.tmux_pane_ref).toBeNull();
    expect(body.sessions[0]!.attribution).toBeNull();
  });

  test("exact-cwd match: pane attributes to the session whose cwd IS the pane's path", async () => {
    raw.exec("DELETE FROM agent_sessions");
    raw.exec("DELETE FROM tmux_panes");
    raw
      .query(
        `INSERT INTO agent_sessions
           (session_id, name, kind, pid, cwd, status, started_at, updated_at,
            project_slug, cwd_project_root, observed_only)
         VALUES ('sess-exact', 'exact', 'interactive', 3333, '/tmp/x', 'active',
                 '2026-08-16T00:00:00Z', '2026-08-16T00:00:10Z',
                 'x', '/tmp/x', 1)`,
      )
      .run();
    raw
      .query(
        `INSERT INTO tmux_panes(pane_id, session_id, session_name, window_id, pane_pid,
                                 pane_current_path, pane_current_command, pane_title,
                                 first_seen, last_seen, misses)
         VALUES ('%9', '$0', 'exact-shell', '@0', 3333, '/tmp/x', 'bash', 'x',
                 '2026-08-16T00:00:00Z', '2026-08-16T00:00:10Z', 0)`,
      )
      .run();
    const res = await app.fetch(req("/observed/sessions"));
    const body = (await res.json()) as {
      sessions: Array<{ session_id: string; tmux_pane_ref: string | null }>;
    };
    const row = body.sessions.find((s) => s.session_id === "sess-exact");
    expect(row!.tmux_pane_ref).toBe("exact-shell:@0.%9");
  });

  test("dedup at API boundary — one session that wins many panes still surfaces once", async () => {
    raw.exec("DELETE FROM agent_sessions");
    raw.exec("DELETE FROM tmux_panes");
    raw
      .query(
        `INSERT INTO agent_sessions
           (session_id, name, kind, pid, cwd, status, started_at, updated_at,
            project_slug, cwd_project_root, observed_only)
         VALUES ('sess-multi', 'multi', 'interactive', 999, '/multi/proj', 'active',
                 '2026-08-16T00:00:00Z', '2026-08-16T00:00:10Z', 'proj', '/multi/proj', 0)`,
      )
      .run();
    for (let i = 0; i < 3; i += 1) {
      raw
        .query(
          `INSERT INTO tmux_panes(pane_id, session_id, session_name, window_id, pane_pid,
                                    pane_current_path, pane_current_command, pane_title,
                                    first_seen, last_seen, misses)
           VALUES (?, '$1', 'multi-shell', ?, 999,
                   ?, 'bash', 'multi', '2026-08-16T00:00:00Z',
                   '2026-08-16T00:00:10Z', 0)`,
        )
        .run(`%${800 + i}`, `@${i}`, `/multi/proj/sub${i}`);
    }
    const res = await app.fetch(req("/observed/sessions"));
    const body = (await res.json()) as {
      sessions: Array<{ session_id: string; tmux_pane_ref: string | null }>;
    };
    const rows = body.sessions.filter((s) => s.session_id === "sess-multi");
    expect(rows.length).toBe(1);
    expect(rows[0]?.tmux_pane_ref).not.toBeNull();
  });
});
