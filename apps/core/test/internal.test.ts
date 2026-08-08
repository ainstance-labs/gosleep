// @gosleep/core — /internal/* long-poll unit tests (GSL-275).
//
// The four behaviours these tests pin down are exactly the four the ticket names as acceptance:
//
//   1. answer-before-wait  — the row is already `answered` when the long-poll opens: the
//                            response comes back immediately, no wait.
//   2. wait-then-answer    — the long-poll opens against an `open` row; a later notifier.notify()
//                            wakes it inside the timeout window; the response carries the answer.
//   3. timeout             — no answer arrives within the tiny test timeout; the server returns
//                            204 and the promise resolves without noise.
//   4. secret required     — with GOSLEEP_INTERNAL_SECRET unset the endpoint returns 503; with
//                            a wrong X-Internal-Secret it returns 401.
//
// These tests boot the actual Hono app with the actual internal routes. The DB is swapped for a
// scratch in-memory SQLite via Bun's `mock.module` — the route module then imports our mocked
// `db/client.ts` at module-eval time, so `getDb()` returns the scratch handle. The notifier is
// the real singleton — same code path production `doAnswer` fires against.

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Hono } from "hono";

import * as schema from "../src/db/schema.ts";
import type { OpenedDb } from "../src/db/client.ts";

// One scratch database for the whole file. Tests use fresh qids so nothing overlaps; the
// singleton pattern is what the route module expects, so we honour it.
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
  last_event_seq INTEGER
);`);
const scratchDb = drizzle(raw, { schema });
const openedDb: OpenedDb = { db: scratchDb, raw, path: ":memory:" };

// Swap the module BEFORE we import the routes. Bun's mock.module rebinds every subsequent
// import to the mock — so the route module's `getDb` becomes our closure.
mock.module("../src/db/client.ts", () => ({
  getDb: () => openedDb,
  openDatabase: () => openedDb,
  defaultDbPath: () => ":memory:",
  schema,
}));

// Now import the route + notifier — they see the mocked client.
const { internalRoutes } = await import("../src/routes/internal.ts");
const { questionNotifier } = await import("../src/questions/notifier.ts");

const app = new Hono();
app.route("/", internalRoutes);

function insertOpenQuestion(qid: string, text: string): void {
  raw
    .query(
      `INSERT INTO questions (qid, status, kind, task, question, opened_at)
       VALUES (?, 'open', 'BLOCKER', 'GSL-275', ?, ?)`,
    )
    .run(qid, text, new Date().toISOString());
}

function updateAnswered(qid: string, answer: string): void {
  raw
    .query(
      `UPDATE questions SET status='answered', answer_text=?, answered_at=? WHERE qid=?`,
    )
    .run(answer, new Date().toISOString(), qid);
}

function setSecret(v: string): void {
  if (v.length === 0) delete process.env.GOSLEEP_INTERNAL_SECRET;
  else process.env.GOSLEEP_INTERNAL_SECRET = v;
}

const SECRET = "test-secret-internal-42";

beforeAll(() => {
  setSecret(SECRET);
});
afterAll(() => {
  setSecret("");
});
beforeEach(() => {
  raw.exec("DELETE FROM questions");
});

describe("GET /internal/questions/:qid/answer-wait — long-poll behaviours", () => {
  test("answer-before-wait: row already answered → 200 immediately", async () => {
    insertOpenQuestion("q-1", "Which colour?");
    updateAnswered("q-1", "Blue");

    const started = Date.now();
    const res = await app.request(
      "http://localhost/internal/questions/q-1/answer-wait?timeout_s=10",
      { method: "GET", headers: { "X-Internal-Secret": SECRET } },
    );
    const elapsed = Date.now() - started;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { qid: string; answer_text: string; status: string };
    expect(body.qid).toBe("q-1");
    expect(body.answer_text).toBe("Blue");
    expect(body.status).toBe("answered");
    // Should be sub-second — the initial SELECT branch bypasses the wait loop.
    expect(elapsed).toBeLessThan(500);
  });

  test("wait-then-answer: notifier fires inside the window → 200 with answer", async () => {
    insertOpenQuestion("q-2", "Which animal?");

    // Fire the notifier ~50 ms into the wait — after subscribe, well before timeout.
    setTimeout(() => {
      updateAnswered("q-2", "Dog");
      questionNotifier.notify({
        qid: "q-2",
        status: "answered",
        answer_text: "Dog",
        answered_at: new Date().toISOString(),
        answered_by: "owner-web",
      });
    }, 50);

    const started = Date.now();
    const res = await app.request(
      "http://localhost/internal/questions/q-2/answer-wait?timeout_s=5",
      { method: "GET", headers: { "X-Internal-Secret": SECRET } },
    );
    const elapsed = Date.now() - started;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { answer_text: string };
    expect(body.answer_text).toBe("Dog");
    expect(elapsed).toBeLessThan(500);
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  test("timeout: no answer within window → 204 no content", async () => {
    insertOpenQuestion("q-3", "Which season?");

    const started = Date.now();
    const res = await app.request(
      "http://localhost/internal/questions/q-3/answer-wait?timeout_s=1",
      { method: "GET", headers: { "X-Internal-Secret": SECRET } },
    );
    const elapsed = Date.now() - started;
    expect(res.status).toBe(204);
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(2500);
  });

  test("unknown qid → 404", async () => {
    const res = await app.request(
      "http://localhost/internal/questions/q-nope/answer-wait?timeout_s=1",
      { method: "GET", headers: { "X-Internal-Secret": SECRET } },
    );
    expect(res.status).toBe(404);
  });

  test("terminal status other than answered (auto-resolved) returns immediately", async () => {
    insertOpenQuestion("q-4", "Which theme?");
    raw
      .query(
        `UPDATE questions SET status='auto-resolved', answer_text=?, resolved_at=? WHERE qid=?`,
      )
      .run("Dark", new Date().toISOString(), "q-4");

    const res = await app.request(
      "http://localhost/internal/questions/q-4/answer-wait?timeout_s=5",
      { method: "GET", headers: { "X-Internal-Secret": SECRET } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; answer_text: string };
    expect(body.status).toBe("auto-resolved");
    expect(body.answer_text).toBe("Dark");
  });
});

describe("POST /internal/permissions/post (GSL-284)", () => {
  test("valid PermissionRequest payload → 200, row inserted with kind='permission' and Allow/Deny options", async () => {
    const payload = {
      session_id: "sid-42",
      tool_use_id: "toolu_abc",
      tool_input: { tool: "Bash", params: { command: "ls" }, message: "read /etc" },
    };
    const res = await app.request("http://localhost/internal/permissions/post", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": SECRET,
      },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { qid: string; tool: string };
    expect(body.qid).toMatch(/^p-\d{8}-\d{6}-[0-9a-f]{8}$/);
    expect(body.tool).toBe("Bash");

    const row = raw
      .query("SELECT kind, status, question, options FROM questions WHERE qid = ?")
      .get(body.qid) as { kind: string; status: string; question: string; options: string };
    expect(row.kind).toBe("permission");
    expect(row.status).toBe("open");
    expect(row.question).toContain("Permission request: Bash");
    expect(row.question).toContain("read /etc");
    const opts = JSON.parse(row.options) as Array<{ label: string }>;
    expect(opts.map((o) => o.label)).toEqual(["Allow", "Deny"]);
  });

  test("missing tool → 400", async () => {
    const res = await app.request("http://localhost/internal/permissions/post", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": SECRET,
      },
      body: JSON.stringify({ session_id: "sid-x", tool_use_id: "u" }),
    });
    expect(res.status).toBe(400);
  });

  test("missing session_id → 400", async () => {
    const res = await app.request("http://localhost/internal/permissions/post", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": SECRET,
      },
      body: JSON.stringify({ tool_input: { tool: "Bash", params: {} } }),
    });
    expect(res.status).toBe(400);
  });

  test("wrong secret → 401", async () => {
    const res = await app.request("http://localhost/internal/permissions/post", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": "nope",
      },
      body: JSON.stringify({ session_id: "s", tool_input: { tool: "Bash" } }),
    });
    expect(res.status).toBe(401);
  });
});

describe("answer-wait carries kind + applied (GSL-284 field surface)", () => {
  test("permission row: wait returns kind='permission' and applied (deny reason)", async () => {
    // Insert a permission row + close it as denied via a direct UPDATE that also sets
    // the applied column (as doDecidePermission would).
    raw
      .query(
        `INSERT INTO questions (qid, status, kind, task, question, opened_at)
         VALUES ('p-fixture-1', 'open', 'permission', NULL, 'Permission request: Bash', ?)`,
      )
      .run(new Date().toISOString());
    raw
      .query(
        `UPDATE questions SET
           status='answered', answer_text='deny', answered_at=?,
           applied='rm -rf / is destructive', applied_by='owner' WHERE qid='p-fixture-1'`,
      )
      .run(new Date().toISOString());

    const res = await app.request(
      "http://localhost/internal/questions/p-fixture-1/answer-wait?timeout_s=1",
      { method: "GET", headers: { "X-Internal-Secret": SECRET } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      kind: string;
      answer_text: string;
      applied: string | null;
    };
    expect(body.kind).toBe("permission");
    expect(body.answer_text).toBe("deny");
    expect(body.applied).toBe("rm -rf / is destructive");
  });

  test("BLOCKER row: wait returns kind='BLOCKER' and applied=null (back-compat)", async () => {
    raw
      .query(
        `INSERT INTO questions (qid, status, kind, task, question, opened_at, answered_at, answer_text)
         VALUES ('q-fixture-2', 'answered', 'BLOCKER', 'GSL-284', 'Which colour?', ?, ?, 'Blue')`,
      )
      .run(new Date().toISOString(), new Date().toISOString());
    const res = await app.request(
      "http://localhost/internal/questions/q-fixture-2/answer-wait?timeout_s=1",
      { method: "GET", headers: { "X-Internal-Secret": SECRET } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: string; applied: string | null };
    expect(body.kind).toBe("BLOCKER");
    expect(body.applied).toBeNull();
  });
});

describe("secret required", () => {
  test("unset GOSLEEP_INTERNAL_SECRET → 503 (never silent-unauth)", async () => {
    setSecret("");
    try {
      const res = await app.request(
        "http://localhost/internal/questions/q-x/answer-wait?timeout_s=1",
        { method: "GET", headers: { "X-Internal-Secret": "anything" } },
      );
      expect(res.status).toBe(503);
    } finally {
      setSecret(SECRET);
    }
  });

  test("wrong X-Internal-Secret → 401", async () => {
    const res = await app.request(
      "http://localhost/internal/questions/q-x/answer-wait?timeout_s=1",
      { method: "GET", headers: { "X-Internal-Secret": "wrong-secret" } },
    );
    expect(res.status).toBe(401);
  });

  test("missing X-Internal-Secret header → 401", async () => {
    const res = await app.request(
      "http://localhost/internal/questions/q-x/answer-wait?timeout_s=1",
      { method: "GET" },
    );
    expect(res.status).toBe(401);
  });
});
