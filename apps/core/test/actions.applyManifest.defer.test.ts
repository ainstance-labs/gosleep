// @gosleep/core — action + worker unit tests for GSL-277 (apply-manifest) + GSL-278 (defer).
//
// Isolated in-memory tests that don't touch the real docs/lab tree or data/gosleep.db:
//   * `isValidIsoLike` from the defer route — rejects garbage, accepts real ISO shapes.
//   * `reconcileDeferred` from the defer-reopen worker — only re-opens rows whose defer_until
//     is past `now`, ignores rows without a timer, and clears defer_until when it fires.
//
// A full end-to-end curl test lives in tools/lab/tests/core-smoke.sh (extended by this task).

import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import * as schema from "../src/db/schema.ts";
import type { OpenedDb } from "../src/db/client.ts";
import { isValidIsoLike } from "../src/routes/actions.ts";
import { reconcileDeferred } from "../src/workers/defer-reopen.ts";

function makeMemoryDb(): OpenedDb {
  const raw = new Database(":memory:");
  raw.exec("PRAGMA journal_mode = MEMORY;");
  // Minimum table subset the worker + tests need. The `applied_by` / `applied_rule_ref`
  // columns land in migration 0002 in the real DB; we replicate the column set here so a
  // schema mismatch would surface as a SQLite compile error in the test setup itself.
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
    last_event_seq INTEGER
  );`);
  const db = drizzle(raw, { schema });
  return { db, raw, path: ":memory:" };
}

function insertOpen(db: OpenedDb, qid: string): void {
  db.raw
    .query(
      `INSERT INTO questions (qid, status, kind, question, opened_at)
       VALUES (?, 'open', 'DECISION', 'test?', ?)`,
    )
    .run(qid, "2026-08-07T00:00:00Z");
}

function insertDeferred(db: OpenedDb, qid: string, deferUntil: string | null): void {
  db.raw
    .query(
      `INSERT INTO questions (qid, status, kind, question, opened_at, defer_until)
       VALUES (?, 'deferred', 'DECISION', 'test?', ?, ?)`,
    )
    .run(qid, "2026-08-07T00:00:00Z", deferUntil);
}

describe("isValidIsoLike (POST /actions/questions/defer body guard)", () => {
  test("accepts standard ISO-8601 Z", () => {
    expect(isValidIsoLike("2026-08-07T00:00:00Z")).toBe(true);
    expect(isValidIsoLike("2026-08-07T00:00:00.123Z")).toBe(true);
    expect(isValidIsoLike("2026-08-07")).toBe(true);
  });

  test("rejects a truthy-but-non-ISO string", () => {
    expect(isValidIsoLike("future")).toBe(false);
    expect(isValidIsoLike("tomorrow")).toBe(false);
    expect(isValidIsoLike("in 30 minutes")).toBe(false);
  });

  test("rejects empty string (defer_until='' would mean 'no timer' — handled at the route level as null)", () => {
    expect(isValidIsoLike("")).toBe(false);
  });
});

describe("reconcileDeferred (defer-reopen worker)", () => {
  let db: OpenedDb;
  beforeEach(() => {
    db = makeMemoryDb();
  });

  test("reopens a row whose defer_until is past `now`", async () => {
    insertDeferred(db, "q-past-1", "2026-08-07T00:00:00Z");
    const summary = await reconcileDeferred(db, {
      now: () => "2026-08-08T00:00:00Z",
      disableLabEmit: true,
    });
    expect(summary.reopened).toBe(1);
    expect(summary.qids).toEqual(["q-past-1"]);

    const row = db.raw.query("SELECT status, defer_until FROM questions WHERE qid = ?")
      .get("q-past-1") as { status: string; defer_until: string | null };
    expect(row.status).toBe("open");
    expect(row.defer_until).toBeNull();
  });

  test("skips a row whose defer_until is still in the future", async () => {
    insertDeferred(db, "q-future-1", "2026-08-10T00:00:00Z");
    const summary = await reconcileDeferred(db, {
      now: () => "2026-08-08T00:00:00Z",
      disableLabEmit: true,
    });
    expect(summary.reopened).toBe(0);
    const row = db.raw.query("SELECT status FROM questions WHERE qid = ?")
      .get("q-future-1") as { status: string };
    expect(row.status).toBe("deferred");
  });

  test("ignores a deferred row without a timer (defer_until IS NULL)", async () => {
    insertDeferred(db, "q-no-timer", null);
    const summary = await reconcileDeferred(db, {
      now: () => "2100-01-01T00:00:00Z",
      disableLabEmit: true,
    });
    expect(summary.reopened).toBe(0);
    const row = db.raw.query("SELECT status FROM questions WHERE qid = ?")
      .get("q-no-timer") as { status: string };
    expect(row.status).toBe("deferred");
  });

  test("ignores non-deferred rows entirely", async () => {
    insertOpen(db, "q-open-1");
    const summary = await reconcileDeferred(db, {
      now: () => "2100-01-01T00:00:00Z",
      disableLabEmit: true,
    });
    expect(summary.reopened).toBe(0);
  });

  test("mixed batch: reopens only the due rows in one pass", async () => {
    insertDeferred(db, "q-past-a", "2026-08-07T00:00:00Z");
    insertDeferred(db, "q-past-b", "2026-08-07T00:30:00Z");
    insertDeferred(db, "q-future", "2027-01-01T00:00:00Z");
    insertDeferred(db, "q-nil", null);
    insertOpen(db, "q-open");
    const summary = await reconcileDeferred(db, {
      now: () => "2026-08-08T00:00:00Z",
      disableLabEmit: true,
    });
    expect(summary.reopened).toBe(2);
    expect(new Set(summary.qids)).toEqual(new Set(["q-past-a", "q-past-b"]));
  });

  test("idempotent: running twice with no new due rows re-opens nothing on the second pass", async () => {
    insertDeferred(db, "q-double", "2026-08-07T00:00:00Z");
    const first = await reconcileDeferred(db, {
      now: () => "2026-08-08T00:00:00Z",
      disableLabEmit: true,
    });
    expect(first.reopened).toBe(1);
    const second = await reconcileDeferred(db, {
      now: () => "2026-08-08T00:00:01Z",
      disableLabEmit: true,
    });
    expect(second.reopened).toBe(0);
  });
});
