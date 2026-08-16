// @gosleep/core — /fleet projection unit tests (GSL-276).
//
// Boots a scratch DB with the agent_sessions table, mocks the db/client.ts module the read
// route imports, then hits GET /fleet via the actual Hono app. Same pattern as
// test/internal.test.ts. What we pin down:
//
//   1. Empty DB → 200 with empty sessions + totals all zero.
//   2. Populated DB → session objects surface every column; sort is live-first, then
//      updated_at DESC.
//   3. Totals — agents_total/live/busy — count what they say.

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
// GSL-356 — /fleet now LEFT JOINs tmux_panes so this test needs the observer-mode table
// available (an empty table lets the JOIN succeed and yield NULL tmux_pane_ref per row).
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
// Provide the tables /status expects (only needed if /status is exercised — /fleet does not
// touch these, but /bundle does; we're testing /fleet only here). heartbeat is joined into
// /fleet's totals.
raw.exec(`CREATE TABLE heartbeat (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  cycle INTEGER,
  context_pct INTEGER,
  open_workers INTEGER,
  extra TEXT
);`);
// GSL-361 (observer mode phase B) — /fleet LEFT JOINs session_control for per-session control
// state. Scratch DB must include the table or the query 500s.
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

// Provide a dev-env Bearer so requireBearer passes without a real Keychain.
process.env.GOSLEEP_BEARER_TOKEN = "test-bearer";

mock.module("../src/db/client.ts", () => ({
  getDb: () => openedDb,
  openDatabase: () => openedDb,
  defaultDbPath: () => ":memory:",
  schema,
}));

const { readRoutes } = await import("../src/routes/read.ts");
const { requireLocalHost } = await import("../src/security/host.ts");

const app = new Hono();
app.use("*", requireLocalHost);
app.route("/", readRoutes);

function insertSession(row: {
  session_id: string;
  name: string;
  status: string;
  updated_at: string;
  ended_at?: string | null;
  context_pct?: number | null;
  current_tool?: string | null;
}): void {
  raw
    .query(
      `INSERT INTO agent_sessions
         (session_id, name, kind, pid, cwd, status, context_pct, current_tool,
          started_at, updated_at, ended_at)
       VALUES (?, ?, 'interactive', 1234, '/tmp', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.session_id,
      row.name,
      row.status,
      row.context_pct ?? null,
      row.current_tool ?? null,
      row.updated_at,
      row.updated_at,
      row.ended_at ?? null,
    );
}

function req(path: string): Request {
  return new Request(`http://127.0.0.1:7331${path}`, {
    headers: {
      Host: "127.0.0.1:7331",
      Authorization: "Bearer test-bearer",
    },
  });
}

describe("GET /fleet projection", () => {
  test("empty DB → 200 + empty sessions + zeroed totals", async () => {
    // Ensure the table is empty
    raw.exec("DELETE FROM agent_sessions");
    raw.exec("DELETE FROM heartbeat");
    const res = await app.fetch(req("/fleet"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Array.isArray(body.sessions)).toBe(true);
    expect((body.sessions as unknown[]).length).toBe(0);
    expect(body.count).toBe(0);
    expect(body.totals).toEqual({
      agents_total: 0,
      agents_live: 0,
      agents_busy: 0,
      heartbeat_context_pct: null,
    });
  });

  test("populated DB → sessions + totals + sort order (live first, updated DESC)", async () => {
    raw.exec("DELETE FROM agent_sessions");
    raw.exec("DELETE FROM heartbeat");

    insertSession({
      session_id: "sid-old-ended",
      name: "gosleep-70",
      status: "ended",
      updated_at: "2026-08-07T10:00:00.000Z",
      ended_at: "2026-08-07T10:00:00.000Z",
    });
    insertSession({
      session_id: "sid-busy-newer",
      name: "gosleep-75",
      status: "busy",
      updated_at: "2026-08-07T12:00:00.000Z",
      context_pct: 42,
      current_tool: "Bash",
    });
    insertSession({
      session_id: "sid-idle-older",
      name: "gosleep-74",
      status: "idle",
      updated_at: "2026-08-07T11:00:00.000Z",
    });
    raw
      .query("INSERT INTO heartbeat (ts, cycle, context_pct, open_workers) VALUES (?, ?, ?, ?)")
      .run("2026-08-07T12:00:00.000Z", 206, 33, 3);

    const res = await app.fetch(req("/fleet"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessions: Array<Record<string, unknown>>;
      count: number;
      totals: Record<string, unknown>;
    };
    expect(body.count).toBe(3);
    expect(body.sessions.length).toBe(3);
    // Live-first, then updated DESC → busy-newer, idle-older, then ended row last.
    expect(body.sessions[0]?.session_id).toBe("sid-busy-newer");
    expect(body.sessions[1]?.session_id).toBe("sid-idle-older");
    expect(body.sessions[2]?.session_id).toBe("sid-old-ended");
    // Totals reflect the three rows.
    expect(body.totals.agents_total).toBe(3);
    expect(body.totals.agents_live).toBe(2);
    expect(body.totals.agents_busy).toBe(1);
    expect(body.totals.heartbeat_context_pct).toBe(33);
    // Hook-owned fields propagate.
    const busy = body.sessions[0];
    if (busy === undefined) throw new Error("expected busy session");
    expect(busy.context_pct).toBe(42);
    expect(busy.current_tool).toBe("Bash");
  });

  test("requires Bearer", async () => {
    const res = await app.fetch(
      new Request("http://127.0.0.1:7331/fleet", {
        headers: { Host: "127.0.0.1:7331" },
      }),
    );
    expect(res.status).toBe(401);
  });

  test("GSL-356 — observer_only + tmux_pane_ref + project_slug surface on /fleet rows", async () => {
    raw.exec("DELETE FROM agent_sessions");
    raw.exec("DELETE FROM tmux_panes");
    raw.exec("DELETE FROM heartbeat");
    // Native gosleep row (observed_only=0) + observed scratch-repo row (observed_only=1).
    raw
      .query(
        `INSERT INTO agent_sessions
           (session_id, name, kind, pid, cwd, status, started_at, updated_at,
            project_slug, cwd_project_root, observed_only)
         VALUES (?, ?, 'interactive', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("sid-native", "gosleep-99", 4444, "/repo/gosleep", "idle", "2026-08-16T00:00:00Z", "2026-08-16T00:00:05Z", "gosleep", "/repo/gosleep", 0);
    raw
      .query(
        `INSERT INTO agent_sessions
           (session_id, name, kind, pid, cwd, status, started_at, updated_at,
            project_slug, cwd_project_root, observed_only)
         VALUES (?, ?, 'interactive', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("sid-observed", "observed:scratch", "interactive" as unknown as number, "/tmp/scratch", "active", "2026-08-16T00:00:00Z", "2026-08-16T00:00:10Z", "scratch", "/tmp/scratch", 1);
    // Fixup the pid arg (bind order) — the 3rd ? was 'kind' text; use a proper INSERT below.
    raw.exec("DELETE FROM agent_sessions WHERE session_id = 'sid-observed'");
    raw
      .query(
        `INSERT INTO agent_sessions
           (session_id, name, kind, pid, cwd, status, started_at, updated_at,
            project_slug, cwd_project_root, observed_only)
         VALUES ('sid-observed', 'observed:scratch', 'interactive', 5555, '/tmp/scratch', 'active', '2026-08-16T00:00:00Z', '2026-08-16T00:00:10Z', 'scratch', '/tmp/scratch', 1)`,
      )
      .run();
    // A tmux pane whose pane_pid matches the observed session's pid — should surface as ref.
    raw
      .query(
        `INSERT INTO tmux_panes(pane_id, session_id, session_name, window_id, pane_pid,
                                 pane_current_path, pane_current_command, pane_title,
                                 first_seen, last_seen, misses)
         VALUES ('%9', '$0', 'obs-shell', '@0', 5555, '/tmp/scratch', 'claude', 'claude-code',
                 '2026-08-16T00:00:00Z', '2026-08-16T00:00:10Z', 0)`,
      )
      .run();

    const res = await app.fetch(req("/fleet"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessions: Array<{
        session_id: string;
        project_slug: string | null;
        cwd_project_root: string | null;
        observed_only: boolean;
        tmux_pane_ref: string | null;
      }>;
    };
    const observed = body.sessions.find((s) => s.session_id === "sid-observed");
    const native = body.sessions.find((s) => s.session_id === "sid-native");
    expect(observed).toBeDefined();
    expect(native).toBeDefined();
    expect(observed!.observed_only).toBe(true);
    expect(observed!.project_slug).toBe("scratch");
    expect(observed!.cwd_project_root).toBe("/tmp/scratch");
    expect(observed!.tmux_pane_ref).toBe("obs-shell:@0.%9");
    // GSL-359 primacy swap: when BOTH heuristic and pidtree would match (pane_current_path
    // under cwd_project_root AND pane_pid == agent_sessions.pid), the heuristic wins because
    // it is now the primary path — pidtree is a fallback that only fires when the heuristic
    // missed. The pane_ref is identical either way; only the attribution tag flips.
    expect((observed as unknown as { attribution?: string }).attribution).toBe("heuristic");
    expect(native!.observed_only).toBe(false);
    expect(native!.project_slug).toBe("gosleep");
    expect(native!.tmux_pane_ref).toBeNull(); // no pane with pid=4444
  });

  test("GSL-359 pidtree fallback: fires when heuristic missed (pane_current_path not under cwd) but pane_pid matches", async () => {
    raw.exec("DELETE FROM agent_sessions");
    raw.exec("DELETE FROM tmux_panes");
    raw.exec("DELETE FROM heartbeat");
    // Session with a resolved pid (the GSL-359 opt-in populated it) whose cwd_project_root
    // is not any pane's current path — the heuristic path misses entirely. The pidtree path
    // must fill in via pane_pid == pid.
    raw
      .query(
        `INSERT INTO agent_sessions
           (session_id, name, kind, pid, cwd, status, started_at, updated_at,
            project_slug, cwd_project_root, observed_only)
         VALUES ('sid-pidonly', 'observed:pidonly', 'interactive', 8888, '/tmp/pidonly',
                 'active', '2026-08-16T00:00:00Z', '2026-08-16T00:00:10Z',
                 'pidonly', '/tmp/pidonly', 1)`,
      )
      .run();
    // Pane whose pane_pid matches the session but whose pane_current_path is somewhere
    // ELSE (shell cd-ed away from the project root, or the pane is in an unrelated dir).
    raw
      .query(
        `INSERT INTO tmux_panes(pane_id, session_id, session_name, window_id, pane_pid,
                                 pane_current_path, pane_current_command, pane_title,
                                 first_seen, last_seen, misses)
         VALUES ('%13', '$2', 'wander-shell', '@1', 8888, '/somewhere/else', 'claude',
                 'wander', '2026-08-16T00:00:00Z', '2026-08-16T00:00:10Z', 0)`,
      )
      .run();
    const res = await app.fetch(req("/fleet"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessions: Array<{ session_id: string; tmux_pane_ref: string | null; attribution?: string | null }>;
    };
    const row = body.sessions.find((s) => s.session_id === "sid-pidonly");
    expect(row).toBeDefined();
    expect(row!.tmux_pane_ref).toBe("wander-shell:@1.%13");
    expect(row!.attribution).toBe("pidtree");
  });

  test("M1 fallback: cwd-prefix heuristic fires when pid walk failed (session pid=null)", async () => {
    raw.exec("DELETE FROM agent_sessions");
    raw.exec("DELETE FROM tmux_panes");
    raw.exec("DELETE FROM heartbeat");
    // Session with NULL pid — the sessions collector could not resolve owning pane via lsof.
    raw
      .query(
        `INSERT INTO agent_sessions
           (session_id, name, kind, pid, cwd, status, started_at, updated_at,
            project_slug, cwd_project_root, observed_only)
         VALUES ('sid-noped', 'observed:heur', 'interactive', NULL, '/tmp/heur-repo',
                 'active', '2026-08-16T00:00:00Z', '2026-08-16T00:00:10Z',
                 'heur-repo', '/tmp/heur-repo', 1)`,
      )
      .run();
    // A pane whose pane_current_path is under the session's cwd_project_root — the fallback
    // heuristic must match it.
    raw
      .query(
        `INSERT INTO tmux_panes(pane_id, session_id, session_name, window_id, pane_pid,
                                 pane_current_path, pane_current_command, pane_title,
                                 first_seen, last_seen, misses)
         VALUES ('%42', '$1', 'heur-shell', '@0', 7777, '/tmp/heur-repo/src', 'bash', 'heur',
                 '2026-08-16T00:00:00Z', '2026-08-16T00:00:10Z', 0)`,
      )
      .run();

    const res = await app.fetch(req("/fleet"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessions: Array<{
        session_id: string;
        tmux_pane_ref: string | null;
        attribution?: string | null;
      }>;
    };
    const row = body.sessions.find((s) => s.session_id === "sid-noped");
    expect(row).toBeDefined();
    // Heuristic hit — the pane_ref surfaced via cwd-prefix even though pid was NULL.
    expect(row!.tmux_pane_ref).toBe("heur-shell:@0.%42");
    expect(row!.attribution).toBe("heuristic");
  });

  test("GSL-373 M1 — heuristic must not match sibling directories that share a string prefix", async () => {
    // Verifier live-proved the bug: two sessions in a fake HOME, native cwd `/…/fake-repo`
    // and observed cwd `/…/fake-repo-sibling`, plus a pane whose pane_current_path was
    // `/…/fake-repo-sibling/subdir`. The old `LIKE cwd || '%'` matched BOTH — the sibling
    // (correct) and the native session (WRONG, path just STARTS WITH `/…/fake-repo`).
    //
    // The fix uses `= cwd OR LIKE cwd || '/%'` — the trailing separator prevents the
    // sibling from spilling across the boundary, and the equality alternate keeps the
    // root itself (pane cwd == session cwd) attributable.
    //
    // This regression test asserts three things at once:
    //   1. `/fake-repo-sibling/subdir` attributes ONLY to sess-sibling (was: also to sess-native).
    //   2. `/fake-repo` (exact match) attributes to sess-root (equality branch of the fix).
    //   3. `/fake-repo/nested/deeper` attributes to sess-root (LIKE '/%' branch).
    raw.exec("DELETE FROM agent_sessions");
    raw.exec("DELETE FROM tmux_panes");
    raw.exec("DELETE FROM heartbeat");
    // Native session whose cwd is `/fake-repo` — historical prefix collision candidate.
    raw
      .query(
        `INSERT INTO agent_sessions
           (session_id, name, kind, pid, cwd, status, started_at, updated_at,
            project_slug, cwd_project_root, observed_only)
         VALUES ('sess-native', 'observed:native', 'interactive', NULL, '/fake-repo',
                 'active', '2026-08-16T00:00:00Z', '2026-08-16T00:00:10Z',
                 'fake-repo', '/fake-repo', 0)`,
      )
      .run();
    // Observed sibling session at `/fake-repo-sibling` — the pane below is genuinely its.
    raw
      .query(
        `INSERT INTO agent_sessions
           (session_id, name, kind, pid, cwd, status, started_at, updated_at,
            project_slug, cwd_project_root, observed_only)
         VALUES ('sess-sibling', 'observed:sibling', 'interactive', NULL, '/fake-repo-sibling',
                 'active', '2026-08-16T00:00:01Z', '2026-08-16T00:00:11Z',
                 'fake-repo-sibling', '/fake-repo-sibling', 1)`,
      )
      .run();
    // A third session that owns pane matching its cwd EXACTLY (equality-branch coverage)
    // AND owns a strict sub-path pane (LIKE '/%'-branch coverage).
    raw
      .query(
        `INSERT INTO agent_sessions
           (session_id, name, kind, pid, cwd, status, started_at, updated_at,
            project_slug, cwd_project_root, observed_only)
         VALUES ('sess-root', 'observed:root', 'interactive', NULL, '/fake-root',
                 'active', '2026-08-16T00:00:02Z', '2026-08-16T00:00:12Z',
                 'fake-root', '/fake-root', 1)`,
      )
      .run();
    // Pane #1 — the sibling's genuine pane. Path is `/fake-repo-sibling/subdir` which STARTS
    // WITH `/fake-repo` but is not under it. Old code attributed this to sess-native too.
    raw
      .query(
        `INSERT INTO tmux_panes(pane_id, session_id, session_name, window_id, pane_pid,
                                 pane_current_path, pane_current_command, pane_title,
                                 first_seen, last_seen, misses)
         VALUES ('%77', '$1', 'sibling-shell', '@0', 9001, '/fake-repo-sibling/subdir',
                 'bash', 'sibling', '2026-08-16T00:00:00Z', '2026-08-16T00:00:10Z', 0)`,
      )
      .run();
    // Pane #2 — pane_current_path EQUALS sess-root cwd_project_root exactly.
    raw
      .query(
        `INSERT INTO tmux_panes(pane_id, session_id, session_name, window_id, pane_pid,
                                 pane_current_path, pane_current_command, pane_title,
                                 first_seen, last_seen, misses)
         VALUES ('%88', '$1', 'root-shell', '@0', 9002, '/fake-root',
                 'bash', 'root', '2026-08-16T00:00:00Z', '2026-08-16T00:00:10Z', 0)`,
      )
      .run();
    // Pane #3 — strict sub-path of sess-root cwd (LIKE '/%' branch).
    raw
      .query(
        `INSERT INTO tmux_panes(pane_id, session_id, session_name, window_id, pane_pid,
                                 pane_current_path, pane_current_command, pane_title,
                                 first_seen, last_seen, misses)
         VALUES ('%89', '$1', 'root-shell', '@1', 9003, '/fake-root/nested/deeper',
                 'bash', 'root', '2026-08-16T00:00:00Z', '2026-08-16T00:00:10Z', 0)`,
      )
      .run();

    const res = await app.fetch(req("/fleet"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessions: Array<{
        session_id: string;
        tmux_pane_ref: string | null;
        attribution?: string | null;
      }>;
    };
    const native = body.sessions.find((s) => s.session_id === "sess-native");
    const sibling = body.sessions.find((s) => s.session_id === "sess-sibling");
    const root = body.sessions.find((s) => s.session_id === "sess-root");
    expect(native).toBeDefined();
    expect(sibling).toBeDefined();
    expect(root).toBeDefined();

    // The bug: sess-native must NOT be attributed to the sibling's pane. Under the old
    // predicate `LIKE cwd || '%'` this expected null was WRONG — the sibling's pane
    // ('/fake-repo-sibling/subdir') matched because it starts with '/fake-repo'.
    expect(native!.tmux_pane_ref).toBeNull();
    expect(native!.attribution).toBeNull();

    // The sibling's genuine pane still attributes correctly.
    expect(sibling!.tmux_pane_ref).toBe("sibling-shell:@0.%77");
    expect(sibling!.attribution).toBe("heuristic");

    // Equality + strict-sub-path branches: sess-root sees SOME pane (MAX picks one — the
    // point is that both branches of the OR fire, not which pane wins).
    expect(root!.tmux_pane_ref).not.toBeNull();
    expect(root!.attribution).toBe("heuristic");
    expect(["root-shell:@0.%88", "root-shell:@1.%89"]).toContain(root!.tmux_pane_ref!);
  });
});
