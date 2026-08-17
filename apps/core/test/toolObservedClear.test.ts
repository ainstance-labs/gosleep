// @gosleep/core — /internal/agents/tool-observed clear-path unit tests (GSL-401).
//
// Run-03 finding m1: after AskUserQuestion terminates, agent_sessions.current_tool /
// current_intent stay pinned to "AskUserQuestion" / "AskUserQuestion pending owner answer"
// indefinitely, because the tool-observed feeder only fires on PreToolUse and
// flushPendingObservations UPDATEs current_intent via COALESCE (never NULLs it).
//
// The fix extends POST /internal/agents/tool-observed with a {clear:true} body that
// enqueues a clear-observation; on flush the row's current_tool AND current_intent are
// set to NULL. These tests boot the actual Hono app with the actual internal routes,
// against a scratch in-memory SQLite that includes agent_sessions.
//
// Red-first: BEFORE the fix, the POST returns 400 ("session_id and tool required" — no
// tool in the body) and the row's current_tool / current_intent are unchanged. AFTER the
// fix, the POST returns 200 and the flush NULLs both columns.

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Hono } from "hono";

import * as schema from "../src/db/schema.ts";
import type { OpenedDb } from "../src/db/client.ts";

// One scratch database for the whole file. agent_sessions is what the flush touches;
// questions is needed because the internal routes module imports helpers that reference
// it (a missing table would break other tests in the same process — not just this one).
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
raw.exec(`CREATE TABLE questions (
  qid TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'BLOCKER',
  task TEXT,
  question TEXT NOT NULL,
  options TEXT,
  opened_at TEXT NOT NULL,
  answered_at TEXT,
  answer_text TEXT,
  resolved_at TEXT,
  applied TEXT,
  applied_by TEXT,
  applied_rule_ref TEXT,
  defer_until TEXT,
  last_event_seq INTEGER,
  tool_input TEXT
);`);

const scratchDb = drizzle(raw, { schema });
const openedDb: OpenedDb = { db: scratchDb, raw, path: ":memory:" };

mock.module("../src/db/client.ts", () => ({
  getDb: () => openedDb,
  openDatabase: () => openedDb,
  defaultDbPath: () => ":memory:",
  schema,
}));

const { internalRoutes, stopToolObservedFlush } = await import(
  "../src/routes/internal.ts"
);

const app = new Hono();
app.route("/", internalRoutes);

const SECRET = "test-secret-tool-observed-clear-42";
const HOST_HEADER = "127.0.0.1:7331";

function setSecret(v: string): void {
  if (v.length === 0) delete process.env.GOSLEEP_INTERNAL_SECRET;
  else process.env.GOSLEEP_INTERNAL_SECRET = v;
}

beforeAll(() => {
  setSecret(SECRET);
});
afterAll(() => {
  setSecret("");
  // Stop the flush timer so a lingering interval does not keep the test process alive
  // after this file finishes. `stopToolObservedFlush` also drains one last time.
  stopToolObservedFlush();
});
beforeEach(() => {
  raw.exec("DELETE FROM agent_sessions");
});

/** Post an observation to `/internal/agents/tool-observed` with the standard headers the
 *  requireInternalSecret + requireLocalOrigin middleware want. */
async function postObservation(body: Record<string, unknown>): Promise<Response> {
  return await app.request(
    "http://" + HOST_HEADER + "/internal/agents/tool-observed",
    {
      method: "POST",
      headers: {
        "Host": HOST_HEADER,
        "Origin": "http://" + HOST_HEADER,
        "Content-Type": "application/json",
        "X-Internal-Secret": SECRET,
      },
      body: JSON.stringify(body),
    },
  );
}

/** Read one row's current_tool + current_intent — the two fields the fix targets. */
function readSessionToolIntent(sessionId: string): {
  current_tool: string | null;
  current_intent: string | null;
} | null {
  const row = raw
    .query(
      "SELECT current_tool, current_intent FROM agent_sessions WHERE session_id = ?",
    )
    .get(sessionId) as
    | { current_tool: string | null; current_intent: string | null }
    | null
    | undefined;
  return row === undefined || row === null ? null : row;
}

function insertObservedSession(
  sessionId: string,
  tool: string | null,
  intent: string | null,
): void {
  const now = new Date().toISOString();
  raw
    .query(
      `INSERT INTO agent_sessions
        (session_id, name, kind, cwd, current_tool, current_intent,
         status, started_at, updated_at)
       VALUES (?, ?, 'unknown', '/tmp', ?, ?, 'observed', ?, ?)`,
    )
    .run(sessionId, sessionId, tool, intent, now, now);
}

describe("POST /internal/agents/tool-observed — clear path (GSL-401)", () => {
  test("clear:true on a session with a pending AskUserQuestion NULLs current_tool AND current_intent", async () => {
    const sid = "sess-clear-1";
    insertObservedSession(
      sid,
      "AskUserQuestion",
      "AskUserQuestion pending owner answer",
    );

    // Sanity — pre-flush state matches the run-03 finding.
    const before = readSessionToolIntent(sid);
    expect(before?.current_tool).toBe("AskUserQuestion");
    expect(before?.current_intent).toBe("AskUserQuestion pending owner answer");

    const res = await postObservation({ session_id: sid, clear: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; cleared?: boolean };
    expect(body.ok).toBe(true);
    expect(body.cleared).toBe(true);

    // Force the debounce flush so we do not depend on the 1 s interval firing during the
    // test window (deterministic; matches the pattern the shutdown handler uses).
    stopToolObservedFlush();

    const after = readSessionToolIntent(sid);
    expect(after).not.toBeNull();
    expect(after?.current_tool).toBeNull();
    expect(after?.current_intent).toBeNull();
  });

  test("clear:true on an UNKNOWN session_id is a no-op — no row inserted, no error", async () => {
    const sid = "sess-clear-nonexistent";
    // Confirm the row doesn't exist first.
    expect(readSessionToolIntent(sid)).toBeNull();

    const res = await postObservation({ session_id: sid, clear: true });
    expect(res.status).toBe(200);
    stopToolObservedFlush();

    // Still absent — a clear on an unknown session must NEVER create a placeholder row
    // (the row semantics only make sense once the fleet poller or a normal observation
    // has established the session).
    expect(readSessionToolIntent(sid)).toBeNull();
  });

  test("clear:true requires session_id (400 without it)", async () => {
    const res = await postObservation({ clear: true });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe("string");
  });

  test("non-clear POST (backwards compat) still requires session_id AND tool", async () => {
    // Pre-existing contract: an observation without a tool is 400. The clear-flag path
    // must not weaken that contract.
    const res = await postObservation({ session_id: "sess-x" });
    expect(res.status).toBe(400);
  });

  test("normal observation still writes current_tool + current_intent (COALESCE preserves unchanged intent)", async () => {
    // Sanity: a clear-flagged POST must not accidentally regress the normal write path.
    const sid = "sess-normal-1";
    insertObservedSession(sid, null, null);
    const res = await postObservation({
      session_id: sid,
      tool: "Bash",
      intent: "run smoke",
    });
    expect(res.status).toBe(200);
    stopToolObservedFlush();
    const after = readSessionToolIntent(sid);
    expect(after?.current_tool).toBe("Bash");
    expect(after?.current_intent).toBe("run smoke");
  });
});
