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
  ended_at TEXT
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
});
