// @gosleep/core — tail indexer tests (GSL-263).
//
// Verifies the tail contract:
//   1. Existing lines in an events file are picked up on the first sweep and end up in SQLite.
//   2. A line appended AFTER the tail starts also arrives — the poll-fallback catches it even
//      if fs.watch is a no-op on the test platform.
//   3. The broadcaster receives one message per newly-inserted event (in seq order).
//   4. Idempotency: a second sweep against an unchanged file inserts nothing new.
//
// Every test runs against a scratch database + scratch lab dir so the owner's real state is
// never touched. The paths are injected via `TailOptions.paths` — production defaults land
// under `docs/lab/`; tests point them at `/tmp/<uuid>/lab/`.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, appendFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, type OpenedDb } from "../src/db/client.ts";
import { startTailIndexer } from "../src/indexer/tail.ts";
import type { EventRow } from "../src/indexer/process.ts";

// Migration SQL — apply the schema against the scratch DB before each test.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = readFileSync(
  resolve(HERE, "../drizzle/0000_initial.sql"),
  "utf8",
);

function bootDb(dbPath: string): OpenedDb {
  const db = openDatabase(dbPath);
  // The Drizzle-kit SQL is one statement per --> statement-breakpoint block.
  for (const stmt of MIGRATION_SQL.split("--> statement-breakpoint")) {
    const trimmed = stmt.trim();
    if (trimmed.length > 0) db.raw.exec(trimmed);
  }
  return db;
}

function makeLabDirs(root: string): {
  events: string;
  questionsQueue: string;
  questionsArchive: string;
  decisions: string;
  heartbeat: string;
} {
  mkdirSync(join(root, "events"), { recursive: true });
  mkdirSync(join(root, "questions"), { recursive: true });
  mkdirSync(join(root, "decisions"), { recursive: true });
  mkdirSync(join(root, "supervision"), { recursive: true });
  return {
    events: join(root, "events"),
    questionsQueue: join(root, "questions/queue.jsonl"),
    questionsArchive: join(root, "questions/archive.jsonl"),
    decisions: join(root, "decisions/log.jsonl"),
    heartbeat: join(root, "supervision/heartbeat.jsonl"),
  };
}

function jsonLine(rec: unknown): string {
  return JSON.stringify(rec) + "\n";
}

describe("tail indexer", () => {
  let scratchRoot: string;

  beforeAll(() => {
    scratchRoot = mkdtempSync(join(tmpdir(), "gosleep-tail-"));
  });

  afterAll(() => {
    rmSync(scratchRoot, { recursive: true, force: true });
  });

  test("first sweep drains pre-existing events + broadcasts each in seq order", async () => {
    const workDir = mkdtempSync(join(scratchRoot, "case1-"));
    const dbPath = join(workDir, "core.db");
    const dirs = makeLabDirs(workDir);
    const day = "2026-08-07";
    const file = join(dirs.events, `${day}.jsonl`);
    writeFileSync(
      file,
      jsonLine({
        ts: `${day}T00:00:00.000Z`,
        src: "emit",
        actor: "tail-test",
        type: "tail.test.pre1",
        data: { note: "pre-existing line 1" },
      }) +
        jsonLine({
          ts: `${day}T00:00:01.000Z`,
          src: "emit",
          actor: "tail-test",
          type: "tail.test.pre2",
          data: { note: "pre-existing line 2" },
        }),
    );

    const db = bootDb(dbPath);
    const emitted: EventRow[] = [];
    const controller = startTailIndexer(db, {
      pollIntervalMs: 60_000, // do not race the manual sweep
      eventsDir: dirs.events,
      paths: {
        questionsQueue: dirs.questionsQueue,
        questionsArchive: dirs.questionsArchive,
        decisions: dirs.decisions,
        heartbeat: dirs.heartbeat,
      },
      onEventInserted: (row) => emitted.push(row),
    });
    await controller.sweep();
    await controller.stop();

    const rows = db.raw
      .query("SELECT seq, type FROM events ORDER BY seq ASC")
      .all() as Array<{ seq: number; type: string }>;
    expect(rows.length).toBe(2);
    expect(rows[0]?.type).toBe("tail.test.pre1");
    expect(rows[1]?.type).toBe("tail.test.pre2");
    // Broadcaster fired once per row, ascending seq.
    expect(emitted.map((r) => r.type)).toEqual(["tail.test.pre1", "tail.test.pre2"]);
    expect(emitted[0]!.seq).toBeLessThan(emitted[1]!.seq);
    db.raw.close();
  });

  test("post-start append arrives on the next sweep + broadcasts", async () => {
    const workDir = mkdtempSync(join(scratchRoot, "case2-"));
    const dbPath = join(workDir, "core.db");
    const dirs = makeLabDirs(workDir);
    const day = "2026-08-07";
    const file = join(dirs.events, `${day}.jsonl`);
    writeFileSync(file, ""); // empty file to start

    const db = bootDb(dbPath);
    const emitted: EventRow[] = [];
    const controller = startTailIndexer(db, {
      pollIntervalMs: 60_000,
      eventsDir: dirs.events,
      paths: {
        questionsQueue: dirs.questionsQueue,
        questionsArchive: dirs.questionsArchive,
        decisions: dirs.decisions,
        heartbeat: dirs.heartbeat,
      },
      onEventInserted: (row) => emitted.push(row),
    });
    await controller.sweep(); // no-op first sweep

    // Now append a new line and drive a second sweep.
    appendFileSync(
      file,
      jsonLine({
        ts: `${day}T01:00:00.000Z`,
        src: "emit",
        actor: "tail-test",
        type: "tail.test.appended",
        data: { note: "appended after start" },
      }),
    );
    await controller.sweep();
    await controller.stop();

    const rows = db.raw
      .query("SELECT seq, type FROM events ORDER BY seq ASC")
      .all() as Array<{ seq: number; type: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0]?.type).toBe("tail.test.appended");
    expect(emitted.length).toBe(1);
    expect(emitted[0]!.type).toBe("tail.test.appended");
    db.raw.close();
  });

  test("second sweep against unchanged file inserts nothing", async () => {
    const workDir = mkdtempSync(join(scratchRoot, "case3-"));
    const dbPath = join(workDir, "core.db");
    const dirs = makeLabDirs(workDir);
    const day = "2026-08-07";
    const file = join(dirs.events, `${day}.jsonl`);
    writeFileSync(
      file,
      jsonLine({
        ts: `${day}T02:00:00.000Z`,
        src: "emit",
        actor: "tail-test",
        type: "tail.test.once",
        data: {},
      }),
    );

    const db = bootDb(dbPath);
    const emitted: EventRow[] = [];
    const controller = startTailIndexer(db, {
      pollIntervalMs: 60_000,
      eventsDir: dirs.events,
      paths: {
        questionsQueue: dirs.questionsQueue,
        questionsArchive: dirs.questionsArchive,
        decisions: dirs.decisions,
        heartbeat: dirs.heartbeat,
      },
      onEventInserted: (row) => emitted.push(row),
    });
    await controller.sweep();
    const firstCount = (db.raw.query("SELECT count(*) AS n FROM events").get() as { n: number }).n;
    const firstEmitted = emitted.length;

    await controller.sweep(); // no change on disk → no new rows
    await controller.stop();

    const secondCount = (db.raw.query("SELECT count(*) AS n FROM events").get() as { n: number }).n;
    expect(secondCount).toBe(firstCount);
    expect(emitted.length).toBe(firstEmitted);
    db.raw.close();
  });
});
