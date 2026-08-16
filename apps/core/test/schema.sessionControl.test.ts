// @gosleep/core — session_control schema tests (GSL-361, observer mode phase B).
//
// Sibling of schema.observer.test.ts (GSL-351). Asserts the 0006 migration lands and the
// new table behaves as declared:
//   - session_control primary key rejects a duplicate session_id;
//   - defaults are `state='observer', source='runtime', shim_registered=0`;
//   - state, source, activated_at/by, deactivated_at, shim_registered, last_heartbeat_at,
//     last_heartbeat_pid all round-trip;
//   - the migration bumps `computeDbSchemaVersion()` relative to a chain missing 0006 (drift).
//
// Isolation via `new Database()` + `drizzle()` directly (NOT `openDatabase` from db/client.ts)
// so cross-file mock.module contamination cannot poison the migration path.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import * as schema from "../src/db/schema.ts";
import { computeDbSchemaVersion } from "../src/db/schemaVersion.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_MIGRATIONS = resolve(HERE, "../drizzle");

function bootMigratedDb(dbPath: string): { raw: Database } {
  const raw = new Database(dbPath, { create: true });
  raw.exec("PRAGMA journal_mode = MEMORY;");
  const db = drizzle(raw, { schema });
  migrate(db, { migrationsFolder: REAL_MIGRATIONS });
  return { raw };
}

describe("session_control schema (GSL-361)", () => {
  const root = mkdtempSync(join(tmpdir(), "gsl361-schema-"));
  const dbPath = join(root, "gosleep.db");
  let raw!: Database;

  beforeAll(() => {
    raw = bootMigratedDb(dbPath).raw;
  });

  afterAll(() => {
    try {
      raw.close();
    } catch {
      /* ignore */
    }
    rmSync(root, { recursive: true, force: true });
  });

  test("inserting a bare row applies the defaults", () => {
    raw.exec(
      "INSERT INTO session_control(session_id) VALUES('sess-default-1')",
    );
    const row = raw
      .query(
        "SELECT state, source, shim_registered, activated_at, deactivated_at " +
          "FROM session_control WHERE session_id = 'sess-default-1'",
      )
      .get() as {
      state: string;
      source: string;
      shim_registered: number;
      activated_at: string | null;
      deactivated_at: string | null;
    };
    expect(row.state).toBe("observer");
    expect(row.source).toBe("runtime");
    expect(row.shim_registered).toBe(0);
    expect(row.activated_at).toBeNull();
    expect(row.deactivated_at).toBeNull();
  });

  test("primary key rejects duplicate session_id", () => {
    raw.exec("INSERT INTO session_control(session_id) VALUES('sess-dup-1')");
    expect(() => {
      raw.exec("INSERT INTO session_control(session_id) VALUES('sess-dup-1')");
    }).toThrow();
  });

  test("state + source + heartbeat columns round-trip", () => {
    raw.exec(
      "INSERT INTO session_control(session_id, state, source, activated_at, activated_by, " +
        "shim_registered, last_heartbeat_at, last_heartbeat_pid) VALUES(" +
        "'sess-round-1', 'controlled', 'env', '2026-08-16T00:00:00Z', 'shim-env', 1, " +
        "'2026-08-16T00:00:01Z', 4242)",
    );
    const row = raw
      .query(
        "SELECT state, source, activated_at, activated_by, shim_registered, " +
          "last_heartbeat_at, last_heartbeat_pid FROM session_control " +
          "WHERE session_id = 'sess-round-1'",
      )
      .get() as {
      state: string;
      source: string;
      activated_at: string | null;
      activated_by: string | null;
      shim_registered: number;
      last_heartbeat_at: string | null;
      last_heartbeat_pid: number | null;
    };
    expect(row.state).toBe("controlled");
    expect(row.source).toBe("env");
    expect(row.activated_at).toBe("2026-08-16T00:00:00Z");
    expect(row.activated_by).toBe("shim-env");
    expect(row.shim_registered).toBe(1);
    expect(row.last_heartbeat_at).toBe("2026-08-16T00:00:01Z");
    expect(row.last_heartbeat_pid).toBe(4242);
  });

  test("computeDbSchemaVersion reflects the new migration (drift from truncated chain)", () => {
    const scratchDir = mkdtempSync(join(tmpdir(), "gsl361-drift-"));
    const drizzleDir = join(scratchDir, "drizzle");
    mkdirSync(join(drizzleDir, "meta"), { recursive: true });
    for (const name of readdirSync(REAL_MIGRATIONS)) {
      const src = join(REAL_MIGRATIONS, name);
      const dst = join(drizzleDir, name);
      try {
        copyFileSync(src, dst);
      } catch {
        cpSync(src, dst, { recursive: true });
      }
    }
    const full = computeDbSchemaVersion({ drizzleDir });
    rmSync(join(drizzleDir, "0006_session_control.sql"));
    const truncated = computeDbSchemaVersion({ drizzleDir });
    expect(full).not.toBe(truncated);
    rmSync(scratchDir, { recursive: true, force: true });
  });
});
