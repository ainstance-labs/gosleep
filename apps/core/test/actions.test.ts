// @gosleep/core — action-layer unit tests (GSL-268).
//
// These exercise the invariants that would silently break the write path if we lost them:
//   - resolveIntentId: rejects garbage headers, keeps well-formed keys, mints a fresh one when
//     absent so the audit trail is never empty.
//   - withTimeline: pending → ok ledger transitions; cached replay does NOT re-run fn(); a
//     thrown error lands as 'fail' and re-raises.
//   - serialize: two concurrent calls to the same endpoint run in order, different endpoints
//     interleave.
//
// The tests use an in-memory SQLite (`:memory:`) rather than the real WAL file so a failed
// run leaves no on-disk state to clean up.

import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import * as schema from "../src/db/schema.ts";
import type { OpenedDb } from "../src/db/client.ts";
import { resolveIntentId, withTimeline } from "../src/actions/withTimeline.ts";
import { serialize } from "../src/actions/mutex.ts";

function makeMemoryDb(): OpenedDb {
  const raw = new Database(":memory:");
  raw.exec("PRAGMA journal_mode = MEMORY;");
  // Only the tables withTimeline touches — no need for the full v1 schema in this suite.
  raw.exec(`CREATE TABLE server_intents (
    intent_id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT,
    params TEXT
  );`);
  const db = drizzle(raw, { schema });
  return { db, raw, path: ":memory:" };
}

describe("resolveIntentId", () => {
  test("mints fresh UUID when header is missing", () => {
    const a = resolveIntentId(undefined);
    const b = resolveIntentId(undefined);
    expect(a).toMatch(/^[0-9a-f-]{36}$/i);
    expect(b).toMatch(/^[0-9a-f-]{36}$/i);
    expect(a).not.toEqual(b);
  });

  test("keeps a well-formed Idempotency-Key", () => {
    expect(resolveIntentId("web-2026-08-07-abc")).toBe("web-2026-08-07-abc");
    expect(resolveIntentId("  padded-key  ")).toBe("padded-key");
  });

  test("mints fresh UUID when header is empty or unprintable", () => {
    const empty = resolveIntentId("");
    expect(empty).toMatch(/^[0-9a-f-]{36}$/i);

    const withNul = resolveIntentId("bad\x00key");
    expect(withNul).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test("mints fresh UUID when header is absurdly long", () => {
    const long = "x".repeat(200);
    expect(resolveIntentId(long)).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe("withTimeline — ledger + idempotency", () => {
  let db: OpenedDb;
  beforeEach(() => {
    db = makeMemoryDb();
  });

  test("first call: pending → ok, records result", async () => {
    let ran = 0;
    const out = await withTimeline<{ echo: string }>(
      db,
      {
        intentId: "iid-1",
        endpoint: "POST /actions/questions/answer",
        input: { qid: "q-1", answer: "yes" },
      },
      async () => {
        ran += 1;
        return { echo: "ok" };
      },
    );
    expect(ran).toBe(1);
    expect(out.ok).toBe(true);
    expect(out.cached).toBe(false);
    expect(out.result?.echo).toBe("ok");

    const row = db.raw
      .query("SELECT * FROM server_intents WHERE intent_id = ?")
      .get("iid-1") as { status: string; params: string; finished_at: string };
    expect(row.status).toBe("ok");
    expect(row.finished_at).toMatch(/T.*Z/);
    const params = JSON.parse(row.params) as { input: unknown; result: { echo: string } };
    expect(params.result.echo).toBe("ok");
  });

  test("replay: second call with same intentId does NOT re-run fn()", async () => {
    let ran = 0;
    await withTimeline(db, {
      intentId: "iid-2",
      endpoint: "POST /actions/questions/answer",
      input: {},
    }, async () => {
      ran += 1;
      return { n: 1 };
    });
    const replay = await withTimeline(db, {
      intentId: "iid-2",
      endpoint: "POST /actions/questions/answer",
      input: {},
    }, async () => {
      ran += 1;
      return { n: 2 };
    });
    expect(ran).toBe(1); // fn only ran once
    expect(replay.cached).toBe(true);
    expect(replay.ok).toBe(true);
    expect((replay.result as { n: number }).n).toBe(1);
  });

  test("failure: thrown error records 'fail' and re-raises", async () => {
    const boom = new Error("kaboom");
    await expect(
      withTimeline(db, {
        intentId: "iid-fail",
        endpoint: "POST /actions/tick",
        input: {},
      }, async () => {
        throw boom;
      }),
    ).rejects.toThrow("kaboom");

    const row = db.raw
      .query("SELECT status, params FROM server_intents WHERE intent_id = ?")
      .get("iid-fail") as { status: string; params: string };
    expect(row.status).toBe("fail");
    expect(JSON.parse(row.params).error).toBe("kaboom");
  });

  test("cross-endpoint key reuse: refuses replay, returns error", async () => {
    await withTimeline(db, {
      intentId: "iid-cross",
      endpoint: "POST /actions/tick",
      input: {},
    }, async () => ({ ok: 1 }));

    const cross = await withTimeline(db, {
      intentId: "iid-cross",
      endpoint: "POST /actions/questions/answer",
      input: {},
    }, async () => ({ ok: 2 }));

    expect(cross.cached).toBe(true);
    expect(cross.ok).toBe(false);
    expect(cross.error).toMatch(/previously used against/);
  });
});

describe("serialize — per-endpoint mutex", () => {
  test("two concurrent calls to the same endpoint run in order", async () => {
    const order: number[] = [];
    const a = serialize("ep.a", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
      return 1;
    });
    const b = serialize("ep.a", async () => {
      order.push(2);
      return 2;
    });
    await Promise.all([a, b]);
    expect(order).toEqual([1, 2]);
  });

  test("different endpoints interleave", async () => {
    const order: string[] = [];
    const slowA = serialize("ep.a2", async () => {
      await new Promise((r) => setTimeout(r, 25));
      order.push("A");
    });
    const fastB = serialize("ep.b2", async () => {
      order.push("B");
    });
    await Promise.all([slowA, fastB]);
    // B is on a different endpoint — it should NOT wait for A's 25 ms delay.
    expect(order[0]).toBe("B");
    expect(order[1]).toBe("A");
  });

  test("mutex releases even when fn throws", async () => {
    // First call throws; second call must still run rather than deadlock behind a rejected
    // promise the mutex never awaited.
    const first = serialize("ep.c", async () => {
      throw new Error("first");
    });
    const second = serialize("ep.c", async () => "second");
    await expect(first).rejects.toThrow("first");
    await expect(second).resolves.toBe("second");
  });
});
