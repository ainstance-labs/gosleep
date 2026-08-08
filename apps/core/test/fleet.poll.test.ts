// @gosleep/core — fleet-poll worker unit tests (GSL-276; SessionAdapter seam GSL-281).
//
// The behaviours pinned down here match the acceptance rules the Jira description names:
//
//   1. INSERT on first sighting — a session that was never in the DB shows up with the fields
//      the runner adapter can observe (name, kind, pid, cwd, status). NULL columns
//      (context_pct, current_tool, current_intent, model) stay NULL — the poller is not the
//      shim, and would clobber a fresher value if it wrote here.
//   2. UPDATE on subsequent sightings — status + updated_at move; the started_at column
//      never changes (that's the immutable "first observed" timestamp per session).
//   3. END on disappearance — a session that was in last tick's roster but not this one gets
//      status='ended' + ended_at stamped.
//   4. RESURRECTION — a session that came back after ended_at was set is re-INSERTed via the
//      UPDATE branch (session_id already exists) with ended_at cleared. UUIDs make this
//      unlikely in practice, but the reconciler must not throw.
//   5. NO-OP on stale roster — an empty roster (provider failure elsewhere) reconciles to
//      "end all live sessions"; but a `sessionAdapter.listSessions()` failure returns
//      `ok:false` and the caller SKIPS the reconcile — that path is tested at the worker level.

import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import * as schema from "../src/db/schema.ts";
import type { OpenedDb } from "../src/db/client.ts";
import type { SessionSummary } from "@gosleep/runner-adapter";
import { reconcileRoster, startFleetPoll } from "../src/workers/fleet-poll.ts";

function freshDb(): OpenedDb {
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
    ended_at TEXT
  );`);
  const db = drizzle(raw, { schema });
  return { db, raw, path: ":memory:" };
}

function agent(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    session_id: "sid-A",
    name: "gosleep-93",
    kind: "interactive",
    pid: 12345,
    cwd: "/home/dev/proj",
    status: "busy",
    started_at_epoch_ms: 1_786_000_000_000,
    ...overrides,
  };
}

interface Row {
  session_id: string;
  name: string;
  kind: string;
  pid: number | null;
  model: string | null;
  cwd: string;
  cycle: number | null;
  context_pct: number | null;
  current_tool: string | null;
  current_intent: string | null;
  status: string;
  started_at: string;
  updated_at: string;
  ended_at: string | null;
}

describe("fleet-poll reconcileRoster", () => {
  let db: OpenedDb;
  beforeEach(() => {
    db = freshDb();
  });

  test("INSERT: new session lands with CLI fields + NULL hook fields", () => {
    const summary = reconcileRoster(db, [agent()]);
    expect(summary.inserted).toBe(1);
    expect(summary.updated).toBe(0);
    expect(summary.ended).toBe(0);
    expect(summary.totalLive).toBe(1);

    const rows = db.raw.query("SELECT * FROM agent_sessions").all() as Row[];
    expect(rows.length).toBe(1);
    const [row] = rows;
    if (row === undefined) throw new Error("expected row");
    expect(row.session_id).toBe("sid-A");
    expect(row.name).toBe("gosleep-93");
    expect(row.status).toBe("busy");
    expect(row.pid).toBe(12345);
    expect(row.context_pct).toBeNull(); // hook-owned
    expect(row.current_tool).toBeNull(); // hook-owned
    expect(row.current_intent).toBeNull();
    expect(row.model).toBeNull();
    expect(row.cycle).toBe(93); // parsed from name
    expect(row.ended_at).toBeNull();
    expect(row.started_at).toBe(new Date(1_786_000_000_000).toISOString());
  });

  test("UPDATE: second sighting bumps updated_at, keeps started_at + hook fields", async () => {
    reconcileRoster(db, [agent()]);
    const [firstRow] = db.raw
      .query("SELECT started_at, updated_at FROM agent_sessions WHERE session_id = 'sid-A'")
      .all() as Array<{ started_at: string; updated_at: string }>;
    if (firstRow === undefined) throw new Error("expected row");

    // Simulate the hook filling context_pct + current_tool in between.
    db.raw
      .query(
        "UPDATE agent_sessions SET context_pct = 47, current_tool = 'Read' WHERE session_id = 'sid-A'",
      )
      .run();

    // Wait a tick so updated_at moves.
    await new Promise((r) => setTimeout(r, 5));
    const s2 = reconcileRoster(db, [agent({ status: "idle", pid: 99 })]);
    expect(s2.inserted).toBe(0);
    expect(s2.updated).toBe(1);
    expect(s2.ended).toBe(0);

    const [afterRow] = db.raw
      .query("SELECT * FROM agent_sessions WHERE session_id = 'sid-A'")
      .all() as Row[];
    if (afterRow === undefined) throw new Error("expected row");
    expect(afterRow.status).toBe("idle");
    expect(afterRow.pid).toBe(99);
    expect(afterRow.started_at).toBe(firstRow.started_at); // immutable
    expect(afterRow.updated_at).not.toBe(firstRow.updated_at); // moved
    expect(afterRow.context_pct).toBe(47); // hook value preserved
    expect(afterRow.current_tool).toBe("Read"); // hook value preserved
  });

  test("END: session missing from roster gets ended_at + status='ended'", () => {
    reconcileRoster(db, [agent(), agent({ session_id: "sid-B", name: "gosleep-94" })]);
    const s = reconcileRoster(db, [agent({ session_id: "sid-B", name: "gosleep-94" })]);
    expect(s.ended).toBe(1);
    const rowA = db.raw
      .query("SELECT status, ended_at FROM agent_sessions WHERE session_id = 'sid-A'")
      .get() as { status: string; ended_at: string | null };
    expect(rowA.status).toBe("ended");
    expect(rowA.ended_at).not.toBeNull();
    const rowB = db.raw
      .query("SELECT status, ended_at FROM agent_sessions WHERE session_id = 'sid-B'")
      .get() as { status: string; ended_at: string | null };
    expect(rowB.status).toBe("busy");
    expect(rowB.ended_at).toBeNull();
  });

  test("END: idempotent — an already-ended row does not re-ended on subsequent polls", () => {
    reconcileRoster(db, [agent()]);
    reconcileRoster(db, []); // ends A
    const s = reconcileRoster(db, []); // still empty
    expect(s.ended).toBe(0);
  });

  test("RESURRECTION: ended row seen again clears ended_at", () => {
    reconcileRoster(db, [agent()]);
    reconcileRoster(db, []); // ends
    reconcileRoster(db, [agent({ status: "busy" })]); // back
    const row = db.raw
      .query("SELECT status, ended_at FROM agent_sessions WHERE session_id = 'sid-A'")
      .get() as { status: string; ended_at: string | null };
    expect(row.status).toBe("busy");
    expect(row.ended_at).toBeNull();
  });

  test("EMPTY DB + EMPTY ROSTER: no-op, no rows touched", () => {
    const s = reconcileRoster(db, []);
    expect(s.inserted).toBe(0);
    expect(s.updated).toBe(0);
    expect(s.ended).toBe(0);
    expect(s.totalLive).toBe(0);
    const count = db.raw.query("SELECT count(*) AS n FROM agent_sessions").get() as {
      n: number;
    };
    expect(count.n).toBe(0);
  });

  test("cycle parser tolerates non-conforming names", () => {
    reconcileRoster(db, [agent({ session_id: "sid-X", name: "no-cycle-here" })]);
    const row = db.raw
      .query("SELECT cycle FROM agent_sessions WHERE session_id = 'sid-X'")
      .get() as { cycle: number | null };
    expect(row.cycle).toBeNull();
  });
});

describe("fleet-poll worker (with injected lister)", () => {
  test("skips DB writes when lister reports ok=false", async () => {
    const db = freshDb();
    // Seed one existing row so we can prove it did NOT get ended_at stamped.
    reconcileRoster(db, [agent()]);

    let emitCount = 0;
    const controller = startFleetPoll(db, {
      intervalMs: 1_000_000, // effectively disable the interval; we drive by hand
      lister: async () => ({ ok: false, agents: [], reason: "timeout" }),
      onChange: () => {
        emitCount += 1;
      },
    });
    // Initial poll ran on startup — wait a beat for it to complete.
    await new Promise((r) => setTimeout(r, 20));
    // Force one more explicit poll for good measure.
    await controller.poll();
    await controller.stop();

    // Row still 'busy', not 'ended' — the CLI hiccup was NOT interpreted as "session died".
    const row = db.raw
      .query("SELECT status, ended_at FROM agent_sessions WHERE session_id = 'sid-A'")
      .get() as { status: string; ended_at: string | null };
    expect(row.status).toBe("busy");
    expect(row.ended_at).toBeNull();
    expect(emitCount).toBe(0);
  });

  test("emits change summary on non-empty reconcile", async () => {
    const db = freshDb();
    const emitted: Array<{ inserted: number; updated: number; ended: number }> = [];
    const controller = startFleetPoll(db, {
      intervalMs: 1_000_000,
      lister: async () => ({ ok: true, agents: [agent()], reason: "" }),
      onChange: (s) => {
        emitted.push({ inserted: s.inserted, updated: s.updated, ended: s.ended });
      },
    });
    // Initial poll fires on start — give it a moment.
    await new Promise((r) => setTimeout(r, 20));
    await controller.stop();
    // At least one emit with inserted=1. Depending on scheduler order the poll might have
    // fired only via startFleetPoll's initial `void poll()`; that's enough.
    expect(emitted.length).toBeGreaterThanOrEqual(1);
    const [first] = emitted;
    if (first === undefined) throw new Error("expected emit");
    expect(first.inserted).toBe(1);
    expect(first.updated).toBe(0);
    expect(first.ended).toBe(0);
  });
});
