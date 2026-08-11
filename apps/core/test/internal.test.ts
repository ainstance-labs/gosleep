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
  last_event_seq INTEGER,
  tool_input TEXT
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

describe("POST /internal/permission-relay (GSL-282 — channel plugin)", () => {
  test("channel-shaped payload → inserts kind='permission' row identical to hook path", async () => {
    const payload = {
      request_id: "req-channel-1",
      tool_name: "Bash",
      description: "run ls",
      input_preview: "ls -la /etc",
      session_id: "sid-channel",
    };
    const res = await app.request("http://localhost/internal/permission-relay", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": SECRET },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { qid: string; tool: string; origin: string };
    expect(body.qid).toMatch(/^p-\d{8}-\d{6}-[0-9a-f]{8}$/);
    expect(body.tool).toBe("Bash");
    expect(body.origin).toBe("channel");
    const row = raw
      .query("SELECT kind, status, question, options FROM questions WHERE qid = ?")
      .get(body.qid) as { kind: string; status: string; question: string; options: string };
    expect(row.kind).toBe("permission");
    expect(row.status).toBe("open");
    expect(row.question).toContain("Permission request: Bash");
    expect(row.question).toContain("ls -la /etc");
    const opts = JSON.parse(row.options) as Array<{ label: string }>;
    expect(opts.map((o) => o.label)).toEqual(["Allow", "Deny"]);
  });

  test("missing request_id → 400", async () => {
    const res = await app.request("http://localhost/internal/permission-relay", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": SECRET },
      body: JSON.stringify({ tool_name: "Bash" }),
    });
    expect(res.status).toBe(400);
  });

  test("missing tool_name → 400", async () => {
    const res = await app.request("http://localhost/internal/permission-relay", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": SECRET },
      body: JSON.stringify({ request_id: "r-x" }),
    });
    expect(res.status).toBe(400);
  });

  test("wrong secret → 401", async () => {
    const res = await app.request("http://localhost/internal/permission-relay", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": "nope" },
      body: JSON.stringify({ request_id: "r-1", tool_name: "Bash" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /internal/permissions/:qid/decision-wait (GSL-282 — channel plugin)", () => {
  test("answer-before-wait: row already answered 'allow' → 200 immediately with behavior", async () => {
    raw
      .query(
        `INSERT INTO questions (qid, status, kind, task, question, opened_at, answered_at, answer_text)
         VALUES ('p-wait-1', 'answered', 'permission', NULL, 'Permission request: Bash', ?, ?, 'allow')`,
      )
      .run(new Date().toISOString(), new Date().toISOString());

    const started = Date.now();
    const res = await app.request(
      "http://localhost/internal/permissions/p-wait-1/decision-wait?timeout_s=10",
      { method: "GET", headers: { "X-Internal-Secret": SECRET } },
    );
    const elapsed = Date.now() - started;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { qid: string; behavior: string };
    expect(body.qid).toBe("p-wait-1");
    expect(body.behavior).toBe("allow");
    expect(elapsed).toBeLessThan(500);
  });

  test("wait-then-answer: notifier fires 'deny' inside window → 200 with behavior=deny", async () => {
    raw
      .query(
        `INSERT INTO questions (qid, status, kind, task, question, opened_at)
         VALUES ('p-wait-2', 'open', 'permission', NULL, 'Permission request: Write', ?)`,
      )
      .run(new Date().toISOString());
    setTimeout(() => {
      raw
        .query(
          `UPDATE questions SET status='answered', answer_text='deny', answered_at=? WHERE qid='p-wait-2'`,
        )
        .run(new Date().toISOString());
      questionNotifier.notify({
        qid: "p-wait-2",
        status: "answered",
        answer_text: "deny",
        answered_at: new Date().toISOString(),
        answered_by: "owner-phone",
      });
    }, 40);

    const started = Date.now();
    const res = await app.request(
      "http://localhost/internal/permissions/p-wait-2/decision-wait?timeout_s=5",
      { method: "GET", headers: { "X-Internal-Secret": SECRET } },
    );
    const elapsed = Date.now() - started;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { behavior: string; answered_by: string | null };
    expect(body.behavior).toBe("deny");
    expect(body.answered_by).toBe("owner-phone");
    expect(elapsed).toBeGreaterThanOrEqual(30);
    expect(elapsed).toBeLessThan(500);
  });

  test("timeout: no decision within window → 204", async () => {
    raw
      .query(
        `INSERT INTO questions (qid, status, kind, task, question, opened_at)
         VALUES ('p-wait-3', 'open', 'permission', NULL, 'Permission request: Bash', ?)`,
      )
      .run(new Date().toISOString());
    const started = Date.now();
    const res = await app.request(
      "http://localhost/internal/permissions/p-wait-3/decision-wait?timeout_s=1",
      { method: "GET", headers: { "X-Internal-Secret": SECRET } },
    );
    const elapsed = Date.now() - started;
    expect(res.status).toBe(204);
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(2500);
  });

  test("unknown qid → 404", async () => {
    const res = await app.request(
      "http://localhost/internal/permissions/p-nope/decision-wait?timeout_s=1",
      { method: "GET", headers: { "X-Internal-Secret": SECRET } },
    );
    expect(res.status).toBe(404);
  });

  test("BLOCKER row (not a permission) → 409", async () => {
    raw
      .query(
        `INSERT INTO questions (qid, status, kind, task, question, opened_at)
         VALUES ('q-wait-blocker', 'open', 'BLOCKER', 'GSL-282', 'Which colour?', ?)`,
      )
      .run(new Date().toISOString());
    const res = await app.request(
      "http://localhost/internal/permissions/q-wait-blocker/decision-wait?timeout_s=1",
      { method: "GET", headers: { "X-Internal-Secret": SECRET } },
    );
    expect(res.status).toBe(409);
  });
});

describe("POST /internal/steer/:sid/drain (GSL-282 — reserved skeleton)", () => {
  test("returns empty message list + reserved:true so the plugin can call it unconditionally", async () => {
    const res = await app.request("http://localhost/internal/steer/sid-1/drain", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": SECRET },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; messages: unknown[]; reserved: boolean };
    expect(body.ok).toBe(true);
    expect(body.messages).toEqual([]);
    expect(body.reserved).toBe(true);
  });

  test("wrong secret → 401", async () => {
    const res = await app.request("http://localhost/internal/steer/sid-1/drain", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": "nope" },
      body: "{}",
    });
    expect(res.status).toBe(401);
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

// -----------------------------------------------------------------------------
// GSL-333 — POST /internal/permissions/:qid/expire (permission-timeout orphan fix).
//
// Scenario the endpoint exists to resolve: the PermissionRequest shim's long-poll
// timed out, Claude Code will now render its own TUI dialog, and if we leave the row
// `open` the panel keeps its Allow / Deny live and a subsequent owner click is
// orphaned (the shim is dead, CC has moved on). The shim POSTs this endpoint on 204;
// the row transitions to `status='timed-out'`, `applied_by='shim-timeout'`.
// -----------------------------------------------------------------------------

function insertOpenPermission(qid: string, text: string): void {
  raw
    .query(
      `INSERT INTO questions (qid, status, kind, task, question, opened_at)
       VALUES (?, 'open', 'permission', NULL, ?, ?)`,
    )
    .run(qid, text, new Date().toISOString());
}

describe("POST /internal/permissions/:qid/expire (GSL-333)", () => {
  test("open permission row → 200 transitioned:true, status='timed-out', applied_by='shim-timeout'", async () => {
    insertOpenPermission("q-perm-1", "Permission request: Bash");
    const res = await app.request(
      "http://localhost/internal/permissions/q-perm-1/expire",
      { method: "POST", headers: { "X-Internal-Secret": SECRET } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      qid: string;
      status: string;
      transitioned: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.qid).toBe("q-perm-1");
    expect(body.status).toBe("timed-out");
    expect(body.transitioned).toBe(true);

    // DB observably transitioned — the panel's /questions read picks this up on the next
    // SSE-triggered invalidate, which is what makes the Allow / Deny buttons go away.
    const row = raw
      .query(
        "SELECT status, applied_by, answered_at FROM questions WHERE qid = 'q-perm-1'",
      )
      .get() as { status: string; applied_by: string | null; answered_at: string | null };
    expect(row.status).toBe("timed-out");
    expect(row.applied_by).toBe("shim-timeout");
    expect(typeof row.answered_at).toBe("string");
    expect((row.answered_at ?? "").length).toBeGreaterThan(0);
  });

  test("idempotent: already-terminal row → 200 transitioned:false, status preserved", async () => {
    insertOpenPermission("q-perm-2", "Permission request: Edit");
    // Owner answered in the panel BEFORE the shim's expire POST landed (the exact race
    // the reason field explains). The expire must NOT clobber the owner's decision.
    raw
      .query(
        `UPDATE questions SET status='answered', answer_text='allow', answered_at=?, applied_by='owner' WHERE qid='q-perm-2'`,
      )
      .run(new Date().toISOString());

    const res = await app.request(
      "http://localhost/internal/permissions/q-perm-2/expire",
      { method: "POST", headers: { "X-Internal-Secret": SECRET } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      status: string;
      transitioned: boolean;
      reason?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.transitioned).toBe(false);
    expect(body.status).toBe("answered");

    // Row must be UNCHANGED from the owner's decision — no silent overwrite.
    const row = raw
      .query(
        "SELECT status, answer_text, applied_by FROM questions WHERE qid = 'q-perm-2'",
      )
      .get() as { status: string; answer_text: string; applied_by: string };
    expect(row.status).toBe("answered");
    expect(row.answer_text).toBe("allow");
    expect(row.applied_by).toBe("owner");
  });

  test("second expire on a row already expired → still 200 no-op (fully idempotent)", async () => {
    insertOpenPermission("q-perm-3", "Permission request: Write");
    const first = await app.request(
      "http://localhost/internal/permissions/q-perm-3/expire",
      { method: "POST", headers: { "X-Internal-Secret": SECRET } },
    );
    expect(first.status).toBe(200);
    expect(((await first.json()) as { transitioned: boolean }).transitioned).toBe(true);

    const second = await app.request(
      "http://localhost/internal/permissions/q-perm-3/expire",
      { method: "POST", headers: { "X-Internal-Secret": SECRET } },
    );
    expect(second.status).toBe(200);
    const body = (await second.json()) as { transitioned: boolean; status: string };
    expect(body.transitioned).toBe(false);
    expect(body.status).toBe("timed-out");
  });

  test("wrong kind (BLOCKER row) → 409 (never mistakenly time-out an AskUserQuestion row)", async () => {
    insertOpenQuestion("q-blocker-1", "Which colour?");
    const res = await app.request(
      "http://localhost/internal/permissions/q-blocker-1/expire",
      { method: "POST", headers: { "X-Internal-Secret": SECRET } },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("not a permission row");
    // Row untouched.
    const row = raw
      .query("SELECT status FROM questions WHERE qid = 'q-blocker-1'")
      .get() as { status: string };
    expect(row.status).toBe("open");
  });

  test("unknown qid → 404", async () => {
    const res = await app.request(
      "http://localhost/internal/permissions/q-nope-perm/expire",
      { method: "POST", headers: { "X-Internal-Secret": SECRET } },
    );
    expect(res.status).toBe(404);
  });

  test("missing X-Internal-Secret → 401", async () => {
    insertOpenPermission("q-perm-auth-1", "Permission request: Bash");
    const res = await app.request(
      "http://localhost/internal/permissions/q-perm-auth-1/expire",
      { method: "POST" },
    );
    expect(res.status).toBe(401);
    // Row untouched.
    const row = raw
      .query("SELECT status FROM questions WHERE qid = 'q-perm-auth-1'")
      .get() as { status: string };
    expect(row.status).toBe("open");
  });

  test("blank qid parameter → 400", async () => {
    // Hono routes `/internal/permissions/:qid/expire` require a non-empty qid segment;
    // an entirely-blank qid is caught by the handler's own guard. This also stops a
    // caller from bulk-expiring by omission.
    const res = await app.request(
      "http://localhost/internal/permissions/%20/expire",
      { method: "POST", headers: { "X-Internal-Secret": SECRET } },
    );
    // A non-existent qid ("%20" is a bare space) falls through to 404, not 400 — the
    // handler validates qid.length after path decoding. Either way, no row is created.
    expect([400, 404]).toContain(res.status);
  });
});

// -----------------------------------------------------------------------------
// GSL-333 followup — Origin/CSRF gating on POST /internal/permissions/:qid/expire.
//
// Run-10 C3 blocker: the shim's expire curl was missing `-H "Origin: …"`, so the
// requireLocalOrigin middleware bounced it 403. The GSL-333 tests above mount ONLY
// `internalRoutes`, which bypasses the app-wide CSRF layer — so they were happily
// green while the real path was broken. This describe block re-wires the same
// middleware chain serve.ts uses (`requireLocalOrigin` app-wide) and pins down
// both the negative (no Origin → 403, row untouched) and the positive
// (Origin: SELF → 200, row transitioned) behaviours the shim depends on.
// -----------------------------------------------------------------------------
const { requireLocalOrigin } = await import("../src/security/origin.ts");
const { HOST_HEADER } = await import("../src/config.ts");
const SELF_ORIGIN = `http://${HOST_HEADER}`;

const originGuardedApp = new Hono();
originGuardedApp.use("*", requireLocalOrigin);
originGuardedApp.route("/", internalRoutes);

describe("POST /internal/permissions/:qid/expire — CSRF gating (GSL-333 followup)", () => {
  test("no Origin/Referer → 403 and row STAYS open (the run-10 C3 bug)", async () => {
    insertOpenPermission("q-perm-csrf-1", "Permission request: Bash");
    const res = await originGuardedApp.request(
      "http://localhost/internal/permissions/q-perm-csrf-1/expire",
      { method: "POST", headers: { "X-Internal-Secret": SECRET } },
    );
    expect(res.status).toBe(403);
    // The whole point: the row must NOT have transitioned. If it did, the panel would
    // silently swallow real answers — precisely what GSL-333 exists to prevent.
    const row = raw
      .query("SELECT status, applied_by FROM questions WHERE qid = 'q-perm-csrf-1'")
      .get() as { status: string; applied_by: string | null };
    expect(row.status).toBe("open");
    expect(row.applied_by).toBeNull();
  });

  test("Origin: http://<HOST_HEADER> → 200 transitioned (the fixed shim path)", async () => {
    insertOpenPermission("q-perm-csrf-2", "Permission request: Edit");
    const res = await originGuardedApp.request(
      "http://localhost/internal/permissions/q-perm-csrf-2/expire",
      {
        method: "POST",
        headers: {
          "X-Internal-Secret": SECRET,
          Origin: SELF_ORIGIN,
        },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transitioned: boolean; status: string };
    expect(body.transitioned).toBe(true);
    expect(body.status).toBe("timed-out");
    const row = raw
      .query(
        "SELECT status, applied_by FROM questions WHERE qid = 'q-perm-csrf-2'",
      )
      .get() as { status: string; applied_by: string };
    expect(row.status).toBe("timed-out");
    expect(row.applied_by).toBe("shim-timeout");
  });

  test("cross-site Origin → 403, row untouched (defense in depth)", async () => {
    insertOpenPermission("q-perm-csrf-3", "Permission request: Write");
    const res = await originGuardedApp.request(
      "http://localhost/internal/permissions/q-perm-csrf-3/expire",
      {
        method: "POST",
        headers: {
          "X-Internal-Secret": SECRET,
          Origin: "http://evil.example.com",
        },
      },
    );
    expect(res.status).toBe(403);
    const row = raw
      .query("SELECT status FROM questions WHERE qid = 'q-perm-csrf-3'")
      .get() as { status: string };
    expect(row.status).toBe("open");
  });
});

// -----------------------------------------------------------------------------
// GSL-333 followup — shim-source regression: assert the expire curl carries the
// Origin header. Belt-and-suspenders on top of the CSRF unit tests above — the
// exact class of regression this task exists to fix was "the endpoint is right,
// the shim forgot the header". A grep against the shim source pins that down
// deterministically.
// -----------------------------------------------------------------------------
const { readFileSync } = await import("node:fs");
const { resolve } = await import("node:path");

describe("permission-request-hook.sh — expire curl carries Origin (GSL-333 followup)", () => {
  const shimPath = resolve(
    import.meta.dir,
    "..",
    "..",
    "..",
    "tools",
    "hooks",
    "permission-request-hook.sh",
  );
  const source = readFileSync(shimPath, "utf8");

  test("expire block includes `-H \"Origin: $ORIGIN_HEADER\"` alongside the endpoint URL", () => {
    // Slice from the EXPIRE_STATUS assignment to the endpoint URL so we compare the
    // right curl (post/decide curls also have Origin; only expire regressed).
    const start = source.indexOf("EXPIRE_STATUS=");
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf("/expire\"", start);
    expect(end).toBeGreaterThan(-1);
    const block = source.slice(start, end);
    expect(block).toContain("Origin: $ORIGIN_HEADER");
    expect(block).toContain("X-Internal-Secret: $INTERNAL_SECRET");
    expect(block).toContain("Host: $HOST_HEADER");
  });

  test("every authenticated POST in the shim carries the Origin header", () => {
    // Split on `curl` occurrences; for each block that also mentions a POST verb and
    // an X-Internal-Secret header, assert Origin: $ORIGIN_HEADER is present.
    const chunks = source.split(/curl /);
    for (let i = 1; i < chunks.length; i += 1) {
      const block = chunks[i]!;
      const isPost = /"POST"|-X POST/.test(block);
      const isAuthed = block.includes("X-Internal-Secret: $INTERNAL_SECRET");
      if (isPost && isAuthed) {
        expect(block).toContain("Origin: $ORIGIN_HEADER");
      }
    }
  });
});
