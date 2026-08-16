// @gosleep/core — SQLite client singleton (GSL-261).
//
// One Drizzle-over-bun:sqlite handle per process. The path is `data/gosleep.db` relative to the
// repo root; the resolver walks up from this file's directory so `bun run` from any CWD lands
// at the same file. Overridable via `GOSLEEP_DB_PATH` for hermetic tests (the importer smoke
// (GSL-262) sets this to a scratch path so no test pollutes the owner's real state).
//
// On first open the client enables WAL journaling and busy-timeout defaults per target-arch
// section 4.4:
//   - `journal_mode=WAL` — non-blocking readers, one writer, atomic .backup for snapshots.
//   - `synchronous=NORMAL` — WAL's safe default; FULL is only needed for financial-grade
//     durability that a local dev harness does not require.
//   - `busy_timeout=5000` — the writer (this process) will occasionally overlap the daily
//     snapshot cron; 5 s lets `.backup` finish without spurious 'database is locked'.
//   - `foreign_keys=ON` — SQLite defaults OFF; on the rare table where we do declare an FK,
//     we want it enforced.
//
// The connection is NOT closed on module unload; Bun tears the process down and SQLite's WAL
// checkpoint runs at that point. If a caller needs a fresh handle (tests), it passes a distinct
// `dbPath` to `openDatabase(...)` and receives its own connection — the singleton stays
// unaffected.

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import * as schema from "./schema.ts";

/**
 * Resolve `data/gosleep.db` relative to the repo root without depending on a runtime CWD.
 * The file layout is: `<repo>/apps/core/src/db/client.ts` → `../../../../data/gosleep.db`.
 * If `GOSLEEP_DB_PATH` is set, that takes precedence — used by tests and by the snapshot
 * restore script to point the client at the restored file before flipping the symlink.
 */
export function defaultDbPath(): string {
  const override = process.env.GOSLEEP_DB_PATH;
  if (override && override.length > 0) return resolve(override);
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../../../../data/gosleep.db");
}

function tunePragmas(raw: Database): void {
  raw.exec("PRAGMA journal_mode = WAL;");
  raw.exec("PRAGMA synchronous = NORMAL;");
  raw.exec("PRAGMA busy_timeout = 5000;");
  raw.exec("PRAGMA foreign_keys = ON;");
}

export interface OpenedDb {
  db: BunSQLiteDatabase<typeof schema>;
  raw: Database;
  path: string;
}

/**
 * Open a fresh Drizzle handle at the given path — always creates parent directories if missing.
 * The migrate script uses this; the runtime singleton wraps it once per process.
 */
export function openDatabase(dbPath: string = defaultDbPath()): OpenedDb {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const raw = new Database(dbPath, { create: true });
  tunePragmas(raw);
  const db = drizzle(raw, { schema });
  return { db, raw, path: dbPath };
}

// Process-wide singleton — lazy so `import` never spins the DB before it is needed. Tests that
// want isolation should call `openDatabase(<scratch>)` and pass the resulting handle around.
let cached: OpenedDb | null = null;

export function getDb(): OpenedDb {
  if (!cached) cached = openDatabase();
  return cached;
}

export type DbHandle = BunSQLiteDatabase<typeof schema>;
export { schema };

/**
 * Test-only: reset the cached singleton so a subsequent `getDb()` call re-resolves via
 * `defaultDbPath()`. Used by observer-mode tests (GSL-350) that set `GOSLEEP_DB_PATH` per
 * file and cannot rely on the cross-file singleton from another test.
 */
export function __resetDbClientForTests(): void {
  cached = null;
}
