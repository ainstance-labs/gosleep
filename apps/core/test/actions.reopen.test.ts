// @gosleep/core — POST /actions/questions/reopen unit tests (GSL-392).
//
// Boots a scratch in-memory DB, mocks the db/client + spawn modules (so the endpoint's
// `lab-emit reopen` never touches the shell), and drives the endpoint end-to-end via the
// real Hono app. Pinned properties, one-per-test:
//
//   1. Missing qid → 400 `qid required` (input guard).
//   2. Unknown qid → 404 `question not found`.
//   3. Non-deferred (open) qid → 409 `cannot be reopened`.
//   4. Deferred qid → 200; row transitions to status='open', defer_until=NULL;
//      SSE `question.reopened` fans out for cross-tab invalidation.
//   5. Same Idempotency-Key replayed → cached=true, no double UPDATE.
//
// The five together cover the acceptance for E2E run-01 finding #4: a manual reopen path
// exists, refuses invalid state, and wakes the panel without waiting for the tail sweep.

import { beforeAll, describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Hono } from "hono";

import * as schema from "../src/db/schema.ts";
import type { OpenedDb } from "../src/db/client.ts";
import { broadcaster } from "../src/sse/broadcaster.ts";

const raw = new Database(":memory:");
raw.exec("PRAGMA journal_mode = MEMORY;");
raw.exec(`CREATE TABLE questions (
  qid TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  kind TEXT NOT NULL,
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

process.env.GOSLEEP_BEARER_TOKEN = "test-bearer";

mock.module("../src/db/client.ts", () => ({
  getDb: () => openedDb,
  openDatabase: () => openedDb,
  defaultDbPath: () => ":memory:",
  schema,
}));

// Stub the shell-out — the endpoint's dual-write should still succeed when spawn returns
// ok:true. A separate sad-path test would flip this to false to prove the endpoint
// surfaces the failure, but the acceptance for m4 is the happy path.
mock.module("../src/actions/spawn.ts", () => ({
  spawnAwait: async () => ({
    ok: true,
    code: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    elapsedMs: 5,
  }),
  spawnDetached: () => {},
  REPO_ROOT: "/tmp/scratch",
}));

const { actionsRoutes } = await import("../src/routes/actions.ts");
const { requireLocalHost } = await import("../src/security/host.ts");

const app = new Hono();
app.use("*", requireLocalHost);
app.route("/", actionsRoutes);

function req(body: Record<string, unknown>, headers: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1:7331/actions/questions/reopen", {
    method: "POST",
    headers: {
      Host: "127.0.0.1:7331",
      Authorization: "Bearer test-bearer",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function insertDeferred(qid: string, deferUntil: string | null = "2100-01-01T00:00:00Z"): void {
  raw
    .query(
      `INSERT INTO questions (qid, status, kind, question, opened_at, defer_until)
       VALUES (?, 'deferred', 'DECISION', 'test?', ?, ?)`,
    )
    .run(qid, "2026-08-16T00:00:00Z", deferUntil);
}

function insertOpen(qid: string): void {
  raw
    .query(
      `INSERT INTO questions (qid, status, kind, question, opened_at)
       VALUES (?, 'open', 'DECISION', 'test?', ?)`,
    )
    .run(qid, "2026-08-16T00:00:00Z");
}

describe("POST /actions/questions/reopen (GSL-392)", () => {
  beforeAll(() => {
    // Fresh table for the whole file (mock.module wiring runs once).
    raw.exec("DELETE FROM questions");
    raw.exec("DELETE FROM server_intents");
  });

  test("missing qid → 400 qid required", async () => {
    const res = await app.fetch(req({}));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("qid required");
  });

  test("unknown qid → 404 question not found", async () => {
    const res = await app.fetch(req({ qid: "q-does-not-exist" }));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("question not found");
  });

  test("non-deferred (open) qid → 409 cannot be reopened", async () => {
    insertOpen("q-open-1");
    const res = await app.fetch(req({ qid: "q-open-1" }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("cannot be reopened");
    expect(body.error).toContain("status=open");
    // The row must NOT have been mutated.
    const after = raw.query("SELECT status, defer_until FROM questions WHERE qid=?")
      .get("q-open-1") as { status: string; defer_until: string | null };
    expect(after.status).toBe("open");
    expect(after.defer_until).toBeNull();
  });

  test("deferred qid → 200; row flips to open with defer_until cleared; SSE fires", async () => {
    insertDeferred("q-def-2");
    // Capture the SSE fan-out. broadcaster.emit is called synchronously inside doReopen.
    const seen: string[] = [];
    const off = broadcaster.subscribe((msg) => {
      if (msg.kind !== "event") return;
      const d = msg.data as { payload?: { qid?: string } } | undefined;
      if (d?.payload?.qid === "q-def-2") seen.push(msg.event);
    });
    try {
      const res = await app.fetch(req({ qid: "q-def-2" }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        result: { qid: string; status: string; reopened_at: string; reopened_by: string };
      };
      expect(body.ok).toBe(true);
      expect(body.result.qid).toBe("q-def-2");
      expect(body.result.status).toBe("open");
      expect(body.result.reopened_by).toBe("owner-web");
      expect(typeof body.result.reopened_at).toBe("string");

      const row = raw.query("SELECT status, defer_until FROM questions WHERE qid=?")
        .get("q-def-2") as { status: string; defer_until: string | null };
      expect(row.status).toBe("open");
      expect(row.defer_until).toBeNull();

      expect(seen).toContain("question.reopened");
    } finally {
      off();
    }
  });

  test("replayed Idempotency-Key → cached=true, no double UPDATE", async () => {
    insertDeferred("q-def-3");
    const idem = "test-reopen-idem-3";
    const res1 = await app.fetch(req({ qid: "q-def-3" }, { "Idempotency-Key": idem }));
    expect(res1.status).toBe(200);
    // Manually flip the row back to deferred so a second UPDATE (if it fired) would be
    // observable — a cache HIT must NOT touch the DB.
    raw
      .query(`UPDATE questions SET status='deferred', defer_until='2100-01-01T00:00:00Z' WHERE qid=?`)
      .run("q-def-3");
    const res2 = await app.fetch(req({ qid: "q-def-3" }, { "Idempotency-Key": idem }));
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { ok: boolean; cached: boolean };
    expect(body2.ok).toBe(true);
    expect(body2.cached).toBe(true);
    // Row is still deferred (the cached replay did not re-run the UPDATE).
    const row = raw.query("SELECT status FROM questions WHERE qid=?").get("q-def-3") as {
      status: string;
    };
    expect(row.status).toBe("deferred");
  });
});
