// @gosleep/core — observed-events writer + SSE broadcast tests
// (GSL-355 under GSL-350 phase 14).
//
// Uses `mock.module("../src/db/client.ts", …)` with a scratch in-memory SQLite whose schema
// is loaded from the actual migration chain — same pattern as internal.test.ts /
// fleet.projection.test.ts. This keeps the writer's `getDb()` deterministic even when other
// test files already mocked the module.
//
// Coverage:
//   1. appendObservedEvent inserts a row and fires an SSE `observed` message.
//   2. `source='hook'` is rejected (R14.4).
//   3. The read endpoint returns rows filtered by `?project=<slug>` and paged by `?since`.
//   4. Sentinel counters register + bump.

import { afterEach, describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Hono } from "hono";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as schema from "../src/db/schema.ts";
import type { OpenedDb } from "../src/db/client.ts";
// Real openDatabase — imported BEFORE we install a mock.module so downstream tests that
// import from db/client through us (mock is process-wide in bun:test) still see the real
// openDatabase behavior (the mock overrides only `getDb`).
import { openDatabase as realOpenDatabase } from "../src/db/client.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_MIGRATIONS = resolve(HERE, "../drizzle");

// Boot a scratch in-memory DB with the FULL migration chain applied — same shape as prod.
const raw = new Database(":memory:");
raw.exec("PRAGMA journal_mode = MEMORY;");
const scratchDb = drizzle(raw, { schema });
migrate(scratchDb, { migrationsFolder: REAL_MIGRATIONS });
const openedDb: OpenedDb = { db: scratchDb, raw, path: ":memory:" };

// Provide a dev-env Bearer so requireBearer passes without a real Keychain.
process.env["GOSLEEP_BEARER_TOKEN"] = "test-bearer-obs-events";

// Bun's `mock.module` is process-wide and irreversible — preserve `openDatabase` so tests
// that run after this file (indexer.tail, indexer.reconcile) still get the real function.
mock.module("../src/db/client.ts", () => ({
  getDb: () => openedDb,
  openDatabase: realOpenDatabase,
  defaultDbPath: () => ":memory:",
  schema,
  __resetDbClientForTests: () => {
    /* no-op in mock */
  },
}));

const { appendObservedEvent } = await import("../src/observed/events.ts");
const { broadcaster } = await import("../src/sse/broadcaster.ts");
const { registerCollector, bumpEventsToday, listCollectors, __resetCollectorInventory } =
  await import("../src/observed/sentinel.ts");
const { observedRoutes } = await import("../src/routes/observed.ts");

afterEach(() => {
  __resetCollectorInventory();
});

function bearerReq(path: string): Request {
  return new Request(`http://127.0.0.1:7331${path}`, {
    headers: {
      Host: "127.0.0.1:7331",
      Authorization: "Bearer test-bearer-obs-events",
    },
  });
}

describe("observed events (GSL-355)", () => {
  test("appendObservedEvent inserts a row and fires an SSE observed message", () => {
    const received: unknown[] = [];
    const unsub = broadcaster.subscribe((msg) => {
      if (msg.kind === "observed") received.push(msg);
    });
    const seq = appendObservedEvent({
      project_slug: "repoA",
      kind: "session_appeared",
      source: "transcript-mtime",
      payload: { session_id: "abc" },
    });
    unsub();
    expect(seq).toBeGreaterThan(0);
    expect(received).toHaveLength(1);
    const msg = received[0] as { event: string; id: number; data: { kind: string } };
    expect(msg.event).toBe("observed.session_appeared");
    expect(msg.id).toBe(seq);
    expect(msg.data.kind).toBe("session_appeared");
  });

  test("refuses source='hook' (R14.4 hook rows belong to gosleep timeline)", () => {
    expect(() =>
      appendObservedEvent({
        project_slug: "repoB",
        kind: "session_appeared",
        // @ts-expect-error — intentional invalid source
        source: "hook",
      }),
    ).toThrow(/hook/);
  });

  test("GET /observed/events filters by ?project", async () => {
    const app = new Hono();
    app.route("/", observedRoutes);

    appendObservedEvent({
      project_slug: "alpha",
      kind: "session_appeared",
      source: "transcript-mtime",
    });
    appendObservedEvent({
      project_slug: "beta",
      kind: "session_appeared",
      source: "transcript-mtime",
    });
    appendObservedEvent({
      project_slug: "alpha",
      kind: "transcript_activity",
      source: "transcript-mtime",
    });

    const res = await app.fetch(bearerReq("/observed/events?project=alpha"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: { project_slug: string; kind: string }[];
      count: number;
    };
    expect(body.count).toBeGreaterThanOrEqual(2);
    for (const ev of body.events) {
      expect(ev.project_slug).toBe("alpha");
    }
    const kinds = body.events.map((e) => e.kind);
    expect(kinds).toContain("session_appeared");
    expect(kinds).toContain("transcript_activity");
  });

  test("collector inventory: registerCollector + bumpEventsToday reflect on /observed/collectors", async () => {
    registerCollector("test-collector", { source: "tmux-list", cadence_ms: 1234 });
    bumpEventsToday("test-collector", 3);
    const app = new Hono();
    app.route("/", observedRoutes);
    const res = await app.fetch(bearerReq("/observed/collectors"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      collectors: {
        name: string;
        cadence_ms: number;
        events_today: number;
        write_attempts: number;
        disabled: boolean;
      }[];
      write_attempts_total: number;
    };
    const found = body.collectors.find((r) => r.name === "test-collector");
    expect(found).toBeDefined();
    expect(found!.cadence_ms).toBe(1234);
    expect(found!.events_today).toBe(3);
    expect(found!.write_attempts).toBe(0);
    expect(found!.disabled).toBe(false);
    expect(body.write_attempts_total).toBe(0);
  });

  test("noteWriteAttempt trips the invariant + disables the collector", async () => {
    const { noteWriteAttempt } = await import("../src/observed/sentinel.ts");
    registerCollector("naughty", { source: "tmux-list", cadence_ms: 1000 });
    noteWriteAttempt("naughty", "db-insert-outside-writer", "tried INSERT into events");
    const rows = listCollectors();
    const row = rows.find((r) => r.name === "naughty");
    expect(row).toBeDefined();
    expect(row!.write_attempts).toBe(1);
    expect(row!.disabled).toBe(true);
    expect(row!.last_error).toContain("db-insert-outside-writer");
  });
});
