// @gosleep/core — regression: cross-tab SSE fan-out on permission decide (GSL-312).
//
// QA run 04 MAJOR#1: `POST /actions/permissions/decide` used to write only to SQLite +
// wake the paused shim. It did NOT emit a broadcaster event, so a second dashboard tab
// kept rendering the permission row as OPEN with active Allow/Deny buttons for 6+ seconds
// after the first tab decided.
//
// This test pins down the fan-out: after a successful decide, the in-process broadcaster
// (the same singleton the tail indexer + fleet-poll worker feed) MUST see exactly one
// `question.answered` message whose payload carries the qid/decision/kind. The SseProvider
// on the browser side invalidates ["core","questions"] on any `question.*` type — proving
// the emit here is the fix.

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Hono } from "hono";

import * as schema from "../src/db/schema.ts";
import type { OpenedDb } from "../src/db/client.ts";

// Fresh in-memory DB with the minimal schema the decide path touches.
const raw = new Database(":memory:");
raw.exec("PRAGMA journal_mode = MEMORY;");
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
raw.exec(`CREATE TABLE server_intents (
  intent_id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT,
  params TEXT
);`);
const scratchDb = drizzle(raw, { schema });
const openedDb: OpenedDb = { db: scratchDb, raw, path: ":memory:" };

mock.module("../src/db/client.ts", () => ({
  getDb: () => openedDb,
  openDatabase: () => openedDb,
  defaultDbPath: () => ":memory:",
  schema,
}));

// Stub the SessionAdapter so its side effects (spawning wake latches) never touch a real
// runtime. We only care about the broadcaster path here.
mock.module("../src/adapter/session.ts", () => ({
  getSessionAdapter: () => ({
    deliverAnswer: () => {},
    listSessions: async () => ({ ok: true, sessions: [] }),
  }),
}));

// Load broadcaster before the route so `broadcaster.subscribe` inside the test observes the
// same singleton the route emits to.
const { broadcaster } = await import("../src/sse/broadcaster.ts");
const { actionsRoutes } = await import("../src/routes/actions.ts");

const app = new Hono();
app.route("/", actionsRoutes);

const BEARER = "test-bearer-decide-sse-42";

beforeAll(() => {
  process.env.GOSLEEP_BEARER_TOKEN = BEARER;
});
afterAll(() => {
  delete process.env.GOSLEEP_BEARER_TOKEN;
});
beforeEach(() => {
  raw.exec("DELETE FROM questions");
  raw.exec("DELETE FROM server_intents");
});

function insertOpenPermission(qid: string): void {
  raw
    .query(
      `INSERT INTO questions (qid, status, kind, task, question, opened_at)
       VALUES (?, 'open', 'permission', 'GSL-312', ?, ?)`,
    )
    .run(qid, `permission fixture ${qid}`, new Date().toISOString());
}

interface CapturedMessage {
  kind: string;
  id: number | null;
  event: string;
  data: unknown;
}

function captureBroadcaster(): { messages: CapturedMessage[]; stop: () => void } {
  const messages: CapturedMessage[] = [];
  const stop = broadcaster.subscribe((msg) => {
    messages.push(msg as CapturedMessage);
  });
  return { messages, stop };
}

describe("POST /actions/permissions/decide — SSE fan-out (GSL-312)", () => {
  test("emits exactly one question.answered event with decision + kind in payload", async () => {
    insertOpenPermission("p-decide-sse-1");
    const cap = captureBroadcaster();
    try {
      const res = await app.request("http://localhost/actions/permissions/decide", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${BEARER}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "test-decide-sse-1",
        },
        body: JSON.stringify({ qid: "p-decide-sse-1", decision: "allow" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; result: { decision: string } };
      expect(body.ok).toBe(true);
      expect(body.result.decision).toBe("allow");

      const answered = cap.messages.filter(
        (m) => m.kind === "event" && m.event === "question.answered",
      );
      expect(answered).toHaveLength(1);
      const payload = (answered[0]!.data as { payload: Record<string, unknown> }).payload;
      expect(payload.qid).toBe("p-decide-sse-1");
      expect(payload.kind).toBe("permission");
      expect(payload.decision).toBe("allow");
      expect(payload.applied_by).toBe("owner");
      expect(typeof payload.answered_at).toBe("string");
    } finally {
      cap.stop();
    }
  });

  test("does not double-emit on cached idempotent replay", async () => {
    insertOpenPermission("p-decide-sse-2");
    const first = await app.request("http://localhost/actions/permissions/decide", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${BEARER}`,
        "Content-Type": "application/json",
        "Idempotency-Key": "test-decide-sse-2",
      },
      body: JSON.stringify({ qid: "p-decide-sse-2", decision: "deny" }),
    });
    expect(first.status).toBe(200);

    // Second identical POST → withTimeline replays the cached outcome. The action fn must
    // NOT run twice, so the broadcaster must NOT observe a second event.
    const cap = captureBroadcaster();
    try {
      const second = await app.request("http://localhost/actions/permissions/decide", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${BEARER}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "test-decide-sse-2",
        },
        body: JSON.stringify({ qid: "p-decide-sse-2", decision: "deny" }),
      });
      expect(second.status).toBe(200);
      const body = (await second.json()) as { ok: boolean; cached: boolean };
      expect(body.ok).toBe(true);
      expect(body.cached).toBe(true);

      const answered = cap.messages.filter(
        (m) => m.kind === "event" && m.event === "question.answered",
      );
      expect(answered).toHaveLength(0);
    } finally {
      cap.stop();
    }
  });

  // GSL-333 (run 09 finding #7). The expire endpoint transitions an orphaned permission
  // row from `open` to `timed-out`; the existing decide guard (`status !== 'open'`) must
  // then refuse a subsequent panel Allow / Deny so the shim-timeout path never gets
  // silently overwritten. This test pins the composition end to end.
  test("timed-out row rejects a subsequent /actions/permissions/decide (409)", async () => {
    insertOpenPermission("p-decide-sse-3");
    // Simulate the shim's expire POST landing FIRST.
    raw
      .query(
        `UPDATE questions
           SET status = 'timed-out', answered_at = ?, applied_by = 'shim-timeout'
         WHERE qid = 'p-decide-sse-3'`,
      )
      .run(new Date().toISOString());

    // Owner then clicked Allow in the panel (race the fix exists to catch). Must NOT
    // silently overwrite the shim-timeout state.
    const res = await app.request("http://localhost/actions/permissions/decide", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${BEARER}`,
        "Content-Type": "application/json",
        "Idempotency-Key": "test-decide-sse-3",
      },
      body: JSON.stringify({ qid: "p-decide-sse-3", decision: "allow" }),
    });
    expect(res.status).toBe(409);

    // Row unchanged.
    const row = raw
      .query(
        "SELECT status, applied_by, answer_text FROM questions WHERE qid = 'p-decide-sse-3'",
      )
      .get() as { status: string; applied_by: string; answer_text: string | null };
    expect(row.status).toBe("timed-out");
    expect(row.applied_by).toBe("shim-timeout");
    expect(row.answer_text).toBeNull();
  });
});
