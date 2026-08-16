// @gosleep/core — session_control registry unit tests (GSL-361, observer mode phase B).
//
// Pins down the registry's transition semantics used by both the shim heartbeat and the
// panel take/release endpoints:
//
//   1. recordHeartbeat creates a row on first fire with state='observer', shim_registered=true.
//   2. recordHeartbeat(env_opt_in=true) escalates an observer row to controlled/env.
//   3. recordHeartbeat(env_opt_in=true) NEVER overwrites a runtime-controlled row's source
//      (owner's panel-take wins over the env flag).
//   4. takeControl on a shim-less session_id (no row) throws with httpStatus=404.
//   5. takeControl with shim_registered=false throws with httpStatus=409 (R15.7).
//   6. takeControl transitions observer → controlled/runtime and stamps activated_by/at.
//   7. takeControl on already-controlled returns changed:false (idempotent).
//   8. releaseControl on env-locked throws with httpStatus=409 (R15.3).
//   9. releaseControl transitions controlled/runtime → observer, stamps deactivated_at.
//  10. releaseControl on already-observer returns changed:false (idempotent).
//  11. readEffectiveState defaults to observer for an unknown session_id (no row).

import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import * as schema from "../src/db/schema.ts";
import type { OpenedDb } from "../src/db/client.ts";
import {
  readControl,
  readEffectiveState,
  recordHeartbeat,
  releaseControl,
  takeControl,
} from "../src/control/registry.ts";

function bootScratchDb(): OpenedDb {
  const raw = new Database(":memory:");
  raw.exec("PRAGMA journal_mode = MEMORY;");
  raw.exec(`CREATE TABLE session_control (
    session_id TEXT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'observer',
    source TEXT NOT NULL DEFAULT 'runtime',
    activated_at TEXT,
    activated_by TEXT,
    deactivated_at TEXT,
    shim_registered INTEGER NOT NULL DEFAULT 0,
    last_heartbeat_at TEXT,
    last_heartbeat_pid INTEGER
  );`);
  const db = drizzle(raw, { schema });
  return { db, raw, path: ":memory:" };
}

let opened: OpenedDb;

beforeEach(() => {
  opened = bootScratchDb();
});

describe("session_control registry — heartbeat (GSL-361)", () => {
  test("first heartbeat creates observer row with shim_registered", () => {
    const r = recordHeartbeat(opened, {
      session_id: "sess-A",
      pid: 4242,
      env_opt_in: false,
    });
    expect(r.state).toBe("observer");
    expect(r.source).toBe("runtime");
    expect(r.shim_registered).toBe(true);
    expect(r.env_locked).toBe(false);
    expect(r.created).toBe(true);

    const row = readControl(opened, "sess-A")!;
    expect(row.state).toBe("observer");
    expect(row.shim_registered).toBe(true);
    expect(row.last_heartbeat_pid).toBe(4242);
  });

  test("env_opt_in heartbeat creates a controlled/env row (F15-S4)", () => {
    const r = recordHeartbeat(opened, {
      session_id: "sess-B",
      pid: 555,
      env_opt_in: true,
    });
    expect(r.state).toBe("controlled");
    expect(r.source).toBe("env");
    expect(r.env_locked).toBe(true);
    expect(r.created).toBe(true);

    const row = readControl(opened, "sess-B")!;
    expect(row.state).toBe("controlled");
    expect(row.source).toBe("env");
    expect(row.activated_by).toBe("shim-env");
  });

  test("env_opt_in does NOT overwrite a runtime-controlled row", () => {
    recordHeartbeat(opened, { session_id: "sess-C", pid: 1, env_opt_in: false });
    takeControl(opened, { session_id: "sess-C", by: "owner-web" });
    const r = recordHeartbeat(opened, {
      session_id: "sess-C",
      pid: 1,
      env_opt_in: true,
    });
    // Existing state stays; env_opt_in cannot demote source='runtime'.
    expect(r.state).toBe("controlled");
    expect(r.source).toBe("runtime");
    expect(r.env_locked).toBe(false);
  });

  test("subsequent heartbeats refresh last_heartbeat_pid + are idempotent", () => {
    recordHeartbeat(opened, { session_id: "sess-D", pid: 100, env_opt_in: false });
    const r = recordHeartbeat(opened, {
      session_id: "sess-D",
      pid: 200,
      env_opt_in: false,
    });
    expect(r.state).toBe("observer");
    const row = readControl(opened, "sess-D")!;
    expect(row.last_heartbeat_pid).toBe(200);
  });
});

describe("session_control registry — takeControl (GSL-361)", () => {
  test("no row → throws 404", () => {
    let caught: unknown;
    try {
      takeControl(opened, { session_id: "sess-missing", by: "owner-web" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error & { httpStatus?: number }).httpStatus).toBe(404);
  });

  test("shim_registered=false → throws 409 (R15.7)", () => {
    // Insert a row directly WITHOUT recording a heartbeat so shim_registered stays 0.
    opened.raw
      .query("INSERT INTO session_control (session_id) VALUES (?)")
      .run("sess-noshim");
    let caught: unknown;
    try {
      takeControl(opened, { session_id: "sess-noshim", by: "owner-web" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error & { httpStatus?: number }).httpStatus).toBe(409);
  });

  test("observer → controlled/runtime + stamps activated_at/by (F15-S1)", () => {
    recordHeartbeat(opened, {
      session_id: "sess-take",
      pid: 999,
      env_opt_in: false,
    });
    const r = takeControl(opened, { session_id: "sess-take", by: "owner-web" });
    expect(r.state).toBe("controlled");
    expect(r.source).toBe("runtime");
    expect(r.activated_by).toBe("owner-web");
    expect(r.activated_at).not.toBeNull();
    expect(r.changed).toBe(true);

    const row = readControl(opened, "sess-take")!;
    expect(row.state).toBe("controlled");
    expect(row.source).toBe("runtime");
  });

  test("takeControl on already-controlled → changed:false (idempotent)", () => {
    recordHeartbeat(opened, {
      session_id: "sess-double",
      pid: 1,
      env_opt_in: false,
    });
    takeControl(opened, { session_id: "sess-double", by: "owner-web" });
    const r = takeControl(opened, { session_id: "sess-double", by: "owner-web" });
    expect(r.changed).toBe(false);
    expect(r.state).toBe("controlled");
  });
});

describe("session_control registry — releaseControl (GSL-361)", () => {
  test("env-locked release → throws 409 (R15.3)", () => {
    recordHeartbeat(opened, {
      session_id: "sess-envlocked",
      pid: 1,
      env_opt_in: true,
    });
    let caught: unknown;
    try {
      releaseControl(opened, {
        session_id: "sess-envlocked",
        by: "owner-web",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error & { httpStatus?: number }).httpStatus).toBe(409);
    const row = readControl(opened, "sess-envlocked")!;
    expect(row.state).toBe("controlled"); // unchanged
    expect(row.source).toBe("env");
  });

  test("controlled/runtime → observer + stamps deactivated_at (F15-S3)", () => {
    recordHeartbeat(opened, {
      session_id: "sess-rel",
      pid: 1,
      env_opt_in: false,
    });
    takeControl(opened, { session_id: "sess-rel", by: "owner-web" });
    const r = releaseControl(opened, {
      session_id: "sess-rel",
      by: "owner-web",
    });
    expect(r.state).toBe("observer");
    expect(r.deactivated_at).not.toBeNull();
    expect(r.changed).toBe(true);
    const row = readControl(opened, "sess-rel")!;
    expect(row.state).toBe("observer");
    expect(row.deactivated_at).not.toBeNull();
  });

  test("release on already-observer → changed:false (idempotent)", () => {
    recordHeartbeat(opened, {
      session_id: "sess-observer",
      pid: 1,
      env_opt_in: false,
    });
    const r = releaseControl(opened, {
      session_id: "sess-observer",
      by: "owner-web",
    });
    expect(r.changed).toBe(false);
    expect(r.state).toBe("observer");
  });
});

describe("session_control registry — readEffectiveState (GSL-361)", () => {
  test("unknown session_id → default observer, no row", () => {
    const eff = readEffectiveState(opened, "sess-unknown");
    expect(eff.state).toBe("observer");
    expect(eff.source).toBeNull();
    expect(eff.shim_registered).toBe(false);
  });

  test("controlled row surfaces state/source truthfully", () => {
    recordHeartbeat(opened, {
      session_id: "sess-eff",
      pid: 42,
      env_opt_in: false,
    });
    takeControl(opened, { session_id: "sess-eff", by: "owner-web" });
    const eff = readEffectiveState(opened, "sess-eff");
    expect(eff.state).toBe("controlled");
    expect(eff.source).toBe("runtime");
    expect(eff.shim_registered).toBe(true);
  });
});
