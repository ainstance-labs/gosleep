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

  test("GSL-391 m3 — parent-cwd session loses the pane to the deeper (worktree) session", async () => {
    // The E2E run-01 fixture pane bound to THREE sessions at once: the real fixture
    // (cwd=.../worktrees/e2e01), the orchestrator (same cwd, no pid), and a repo-root
    // parent session (cwd=/…/gosleep) that "matched" only because the pane's path was
    // under the repo root. The fix ranks per pane: exact-cwd > deepest > pid-present >
    // updated_at DESC, then keeps only rank_per_pane = 1. Fewer ghosts, no NEW misses on
    // the sibling regression (already covered by the M1 test above).
    raw.exec("DELETE FROM agent_sessions");
    raw.exec("DELETE FROM tmux_panes");
    raw.exec("DELETE FROM heartbeat");
    // The one shared pane — pane_current_path is /gosleep/.claude/worktrees/e2e01, i.e.
    // exactly under the repo root AND exactly matching the two worktree-cwd sessions.
    raw
      .query(
        `INSERT INTO tmux_panes(pane_id, session_id, session_name, window_id, pane_pid,
                                 pane_current_path, pane_current_command, pane_title,
                                 first_seen, last_seen, misses)
         VALUES ('%431', '$1', 'e2e01-fixture', '@47', 24044,
                 '/gosleep/.claude/worktrees/e2e01',
                 'bash', 'e2e01', '2026-08-16T00:00:00Z', '2026-08-16T00:00:10Z', 0)`,
      )
      .run();
    // Winner: real fixture — exact cwd + has a pid, most recent updated_at.
    raw
      .query(
        `INSERT INTO agent_sessions
           (session_id, name, kind, pid, cwd, status, started_at, updated_at,
            project_slug, cwd_project_root, observed_only)
         VALUES ('53eb568b', 'e2e01-75', 'interactive', 24044,
                 '/gosleep/.claude/worktrees/e2e01', 'active',
                 '2026-08-16T20:00:00Z', '2026-08-16T20:05:00Z',
                 'worktree', '/gosleep/.claude/worktrees/e2e01', 0)`,
      )
      .run();
    // Ghost #1: orchestrator with the SAME cwd — but no pid, older updated_at.
    raw
      .query(
        `INSERT INTO agent_sessions
           (session_id, name, kind, pid, cwd, status, started_at, updated_at,
            project_slug, cwd_project_root, observed_only)
         VALUES ('5abd9a22', 'observed:gosleep', 'interactive', NULL,
                 '/gosleep/.claude/worktrees/e2e01', 'active',
                 '2026-08-16T18:00:00Z', '2026-08-16T18:00:10Z',
                 'worktree', '/gosleep/.claude/worktrees/e2e01', 1)`,
      )
      .run();
    // Ghost #2: repo-root parent — its cwd is an ANCESTOR of the pane's path. Under the
    // old rule this session was attributed to the fixture's pane; under the fix it loses
    // to the two deeper (worktree-cwd) sessions and gets NULL for THIS pane.
    raw
      .query(
        `INSERT INTO agent_sessions
           (session_id, name, kind, pid, cwd, status, started_at, updated_at,
            project_slug, cwd_project_root, observed_only)
         VALUES ('2e5a1372', 'observed:gosleep', 'interactive', 42722,
                 '/gosleep', 'active',
                 '2026-08-16T19:00:00Z', '2026-08-16T19:00:10Z',
                 'gosleep', '/gosleep', 1)`,
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
    // Dedup at the API boundary: each session appears exactly once, even though the JOIN
    // could otherwise emit multiple rows (many panes matching one session's ancestor cwd).
    const seen = new Set<string>();
    for (const s of body.sessions) {
      expect(seen.has(s.session_id)).toBe(false);
      seen.add(s.session_id);
    }
    const fixture = body.sessions.find((s) => s.session_id === "53eb568b");
    const orch = body.sessions.find((s) => s.session_id === "5abd9a22");
    const parent = body.sessions.find((s) => s.session_id === "2e5a1372");
    expect(fixture).toBeDefined();
    expect(orch).toBeDefined();
    expect(parent).toBeDefined();

    // The real fixture wins the shared pane — exact cwd + pid + most recent updated_at.
    expect(fixture!.tmux_pane_ref).toBe("e2e01-fixture:@47.%431");
    expect(fixture!.attribution).toBe("heuristic");

    // The orchestrator loses the shared pane (its cwd matches too, but it has no pid
    // and an older updated_at). It falls through to the pidtree fallback which is off
    // because pid is NULL → NULL pane_ref, no ghost bind.
    expect(orch!.tmux_pane_ref).toBeNull();
    expect(orch!.attribution).toBeNull();

    // The repo-root parent's cwd is a strict ancestor of the pane's path. Under the
    // per-pane ranking the two deeper (worktree-cwd) sessions win and the parent loses.
    // It has a pid (42722) but no pane matches it via pane_pid, so the pidtree fallback
    // yields NULL too. This is the exact "cwd is a PARENT of the pane's cwd" ghost the
    // E2E run-01 verifier surfaced.
    expect(parent!.tmux_pane_ref).toBeNull();
    expect(parent!.attribution).toBeNull();
  });

  test("GSL-391 m3 — two exact-cwd matches: session with a pid wins the tie", async () => {
    // Isolate the pid-tiebreak clause. Two sessions with the same cwd_project_root and
    // same updated_at — the one with a non-NULL pid wins the pane. Belt + braces for the
    // "real process beats an observed ghost sharing the same cwd" property.
    raw.exec("DELETE FROM agent_sessions");
    raw.exec("DELETE FROM tmux_panes");
    raw.exec("DELETE FROM heartbeat");
    raw
      .query(
        `INSERT INTO tmux_panes(pane_id, session_id, session_name, window_id, pane_pid,
                                 pane_current_path, pane_current_command, pane_title,
                                 first_seen, last_seen, misses)
         VALUES ('%200', '$1', 'work-shell', '@0', 12345,
                 '/work/proj', 'bash', 'work', '2026-08-16T00:00:00Z',
                 '2026-08-16T00:00:10Z', 0)`,
      )
      .run();
    raw
      .query(
        `INSERT INTO agent_sessions
           (session_id, name, kind, pid, cwd, status, started_at, updated_at,
            project_slug, cwd_project_root, observed_only)
         VALUES ('sess-alive', 'alive', 'interactive', 12345, '/work/proj', 'active',
                 '2026-08-16T00:00:00Z', '2026-08-16T00:00:10Z', 'proj', '/work/proj', 0)`,
      )
      .run();
    raw
      .query(
        `INSERT INTO agent_sessions
           (session_id, name, kind, pid, cwd, status, started_at, updated_at,
            project_slug, cwd_project_root, observed_only)
         VALUES ('sess-ghost', 'ghost', 'interactive', NULL, '/work/proj', 'active',
                 '2026-08-16T00:00:00Z', '2026-08-16T00:00:10Z', 'proj', '/work/proj', 1)`,
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
    const alive = body.sessions.find((s) => s.session_id === "sess-alive");
    const ghost = body.sessions.find((s) => s.session_id === "sess-ghost");
    expect(alive!.tmux_pane_ref).toBe("work-shell:@0.%200");
    // Ghost has no pid → pidtree fallback yields NULL → no misattribution.
    expect(ghost!.tmux_pane_ref).toBeNull();
  });

  test("GSL-391 m3 — a session that wins many panes appears exactly once in the response", async () => {
    // If a session's cwd matches multiple panes (multiple shells all rooted at the same
    // project), the LEFT JOIN could historically emit one row per matching pane_current_path.
    // The dedup at the API boundary ensures the response has one row per session_id
    // regardless of how many panes matched.
    raw.exec("DELETE FROM agent_sessions");
    raw.exec("DELETE FROM tmux_panes");
    raw.exec("DELETE FROM heartbeat");
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
    const res = await app.fetch(req("/fleet"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessions: Array<{ session_id: string; tmux_pane_ref: string | null }>;
    };
    const rows = body.sessions.filter((s) => s.session_id === "sess-multi");
    expect(rows.length).toBe(1);
    expect(rows[0]?.tmux_pane_ref).not.toBeNull();
  });
});
