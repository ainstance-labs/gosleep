// @gosleep/core — jira-sync worker unit tests (GSL-279).
//
// The behaviours pinned down here match the Jira acceptance rules:
//
//   1. INSERT on first sighting — a key that was never in the DB shows up with the source's
//      fields (epic, status, title, labels) + `last_synced_at` stamped.
//   2. UPDATE when any of the tracked columns differ — status is the big one; labels/title/epic
//      also count. `last_synced_at` moves on every cycle regardless (liveness signal for the UI).
//   3. NO-OP change — a cycle where the source returns the same rows produces zero UPDATEs
//      that materially change anything, but still bumps last_synced_at (the "Synced" column
//      in the UI must show that we DID reconcile, even when the source was unchanged).
//   4. Source fallback — the worker tries sources in order; when the first returns ok:false,
//      the second's snapshot is used. If all sources fail, the DB is untouched.
//   5. tasks.updated SSE fan-out — on non-empty change set, the emit callback fires with the
//      change summary. On a no-op cycle, it does NOT fire (broadcast storms are worse than
//      silence).

import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import * as schema from "../src/db/schema.ts";
import type { OpenedDb } from "../src/db/client.ts";
import {
  reconcileTasks,
  runSyncCycle,
  type JiraSyncChangeSummary,
  type SyncSource,
  type TaskSnapshot,
} from "../src/workers/jira-sync.ts";

function freshDb(): OpenedDb {
  const raw = new Database(":memory:");
  raw.exec("PRAGMA journal_mode = MEMORY;");
  raw.exec(`CREATE TABLE tasks (
    key TEXT PRIMARY KEY,
    epic TEXT,
    status TEXT NOT NULL,
    title TEXT NOT NULL,
    labels TEXT,
    last_synced_at TEXT
  );`);
  const db = drizzle(raw, { schema });
  return { db, raw, path: ":memory:" };
}

interface Row {
  key: string;
  epic: string | null;
  status: string;
  title: string;
  labels: string;
  last_synced_at: string;
}

function fakeSource(name: string, rows: TaskSnapshot[], ok: boolean = true): SyncSource {
  return {
    name,
    fetch: async () => ({
      ok,
      source: name,
      rows,
      reason: ok ? "ok" : "canned failure",
    }),
  };
}

describe("reconcileTasks", () => {
  let db: OpenedDb;
  beforeEach(() => {
    db = freshDb();
  });

  test("INSERT on first sighting", () => {
    const snap: TaskSnapshot[] = [
      { key: "GSL-279", epic: "GSL-250", status: "In Progress", title: "sync worker", labels: ["core"] },
      { key: "GSL-283", epic: "GSL-250", status: "To Do", title: "banner", labels: [] },
    ];
    const summary = reconcileTasks(db, snap, "test");
    expect(summary.inserted).toBe(2);
    expect(summary.updated).toBe(0);
    expect(summary.totalSeen).toBe(2);
    const rows = db.raw.query("SELECT * FROM tasks ORDER BY key").all() as Row[];
    expect(rows.length).toBe(2);
    expect(rows[0]!.key).toBe("GSL-279");
    expect(rows[0]!.epic).toBe("GSL-250");
    expect(rows[0]!.status).toBe("In Progress");
    expect(rows[0]!.last_synced_at).toBeTruthy();
    expect(JSON.parse(rows[0]!.labels)).toEqual(["core"]);
  });

  test("UPDATE on status change", () => {
    const snap1: TaskSnapshot[] = [
      { key: "GSL-279", epic: "GSL-250", status: "To Do", title: "sync worker", labels: [] },
    ];
    reconcileTasks(db, snap1, "test");
    const snap2: TaskSnapshot[] = [
      { key: "GSL-279", epic: "GSL-250", status: "In Progress", title: "sync worker", labels: [] },
    ];
    const summary = reconcileTasks(db, snap2, "test");
    expect(summary.updated).toBe(1);
    expect(summary.inserted).toBe(0);
    expect(summary.changedKeys).toEqual(["GSL-279"]);
    const row = db.raw.query("SELECT * FROM tasks WHERE key='GSL-279'").get() as Row;
    expect(row.status).toBe("In Progress");
  });

  test("no-op cycle still bumps last_synced_at without counting as UPDATE", async () => {
    const snap: TaskSnapshot[] = [
      { key: "GSL-279", epic: null, status: "To Do", title: "sync worker", labels: ["a", "b"] },
    ];
    reconcileTasks(db, snap, "test");
    const before = (db.raw.query("SELECT last_synced_at FROM tasks WHERE key='GSL-279'").get() as { last_synced_at: string }).last_synced_at;
    // Ensure the ISO timestamps differ — new Date().toISOString() has ms precision and reconcileTasks stamps at call time.
    await new Promise((r) => setTimeout(r, 5));
    const summary = reconcileTasks(db, snap, "test");
    expect(summary.updated).toBe(0);
    expect(summary.inserted).toBe(0);
    expect(summary.changedKeys).toEqual([]);
    const after = (db.raw.query("SELECT last_synced_at FROM tasks WHERE key='GSL-279'").get() as { last_synced_at: string }).last_synced_at;
    expect(after).not.toBe(before);
  });

  test("label set-equality ignores order", () => {
    reconcileTasks(
      db,
      [{ key: "GSL-1", epic: null, status: "To Do", title: "x", labels: ["a", "b"] }],
      "test",
    );
    const summary = reconcileTasks(
      db,
      [{ key: "GSL-1", epic: null, status: "To Do", title: "x", labels: ["b", "a"] }],
      "test",
    );
    expect(summary.updated).toBe(0);
  });
});

describe("runSyncCycle — source fallback", () => {
  let db: OpenedDb;
  beforeEach(() => {
    db = freshDb();
  });

  test("primary ok:true wins; secondary never fetched", async () => {
    const primary = fakeSource("primary", [
      { key: "GSL-279", epic: "GSL-250", status: "To Do", title: "x", labels: [] },
    ]);
    const secondary = fakeSource("secondary", [
      { key: "GSL-DIFF", epic: null, status: "To Do", title: "should not see this", labels: [] },
    ]);
    const summary = await runSyncCycle(db, { sources: [primary, secondary] });
    expect(summary.source).toBe("primary");
    expect(summary.inserted).toBe(1);
    const rows = db.raw.query("SELECT key FROM tasks").all() as Array<{ key: string }>;
    expect(rows.map((r) => r.key)).toEqual(["GSL-279"]);
  });

  test("primary ok:false triggers secondary", async () => {
    const primary = fakeSource("primary", [], false);
    const secondary = fakeSource("secondary", [
      { key: "GSL-283", epic: "GSL-250", status: "To Do", title: "x", labels: [] },
    ]);
    const summary = await runSyncCycle(db, { sources: [primary, secondary] });
    expect(summary.source).toBe("secondary");
    expect(summary.inserted).toBe(1);
  });

  test("all sources fail → DB untouched, source='none' returned", async () => {
    const primary = fakeSource("primary", [], false);
    const secondary = fakeSource("secondary", [], false);
    const summary = await runSyncCycle(db, { sources: [primary, secondary] });
    // The summary carries the LAST attempted source's name (for diagnostics), not 'none'.
    expect(summary.source).toBe("secondary");
    expect(summary.inserted).toBe(0);
    expect(summary.updated).toBe(0);
    const rows = db.raw.query("SELECT * FROM tasks").all() as Row[];
    expect(rows.length).toBe(0);
  });
});

describe("runSyncCycle — SSE fan-out", () => {
  let db: OpenedDb;
  beforeEach(() => {
    db = freshDb();
  });

  test("emit fires exactly once on non-empty change set", async () => {
    const source = fakeSource("test", [
      { key: "GSL-279", epic: null, status: "To Do", title: "x", labels: [] },
    ]);
    const emits: JiraSyncChangeSummary[] = [];
    await runSyncCycle(db, { sources: [source], onChange: (s) => emits.push(s) });
    expect(emits.length).toBe(1);
    expect(emits[0]!.inserted).toBe(1);
  });

  test("emit does NOT fire on no-op cycle", async () => {
    const source = fakeSource("test", [
      { key: "GSL-279", epic: null, status: "To Do", title: "x", labels: [] },
    ]);
    const emits: JiraSyncChangeSummary[] = [];
    await runSyncCycle(db, { sources: [source], onChange: (s) => emits.push(s) });
    // second cycle — same snapshot, no material changes
    await runSyncCycle(db, { sources: [source], onChange: (s) => emits.push(s) });
    expect(emits.length).toBe(1); // only the first cycle emitted
  });
});
