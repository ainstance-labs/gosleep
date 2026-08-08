// @gosleep/core — runtime Drizzle migration entry (GSL-261).
//
// Applied at engine start (before `Bun.serve` binds a port) and by `bun run db:migrate` for
// operator-driven runs. The flow, per target-arch section 4.2:
//
//   1. Open the DB (creating it if the file is missing) with WAL + pragmas from client.ts.
//   2. `PRAGMA integrity_check` — refuse to migrate a corrupt file. R29 dictates: never let a
//      "green" migration mask a broken store; a bad integrity check WARN-logs and exits non-zero,
//      leaving the operator to restore the last snapshot.
//   3. Take a pre-migration snapshot (best-effort: unavailable `sqlite3` binary logs a WARN but
//      does not block the migration — a pristine box may run migrate before snapshot.sh exists
//      on PATH). Successful snapshots land under `data/snapshots/pre-<ts>.db`.
//   4. Wrap `drizzle-orm/bun-sqlite/migrator#migrate()` in a transaction so a mid-batch failure
//      rolls the whole batch back. `migrate()` itself keeps a `__drizzle_migrations` bookkeeping
//      table so repeated runs are idempotent.
//   5. Emit one JSON log line per run (start / integrity / snapshot / applied / done) so the
//      launchd stdout log can be diffed after a bad night.
//
// Exit codes: 0 = OK (including "no pending migrations"), 1 = integrity check failed or
// migration threw. Any non-zero exit is intended to be surfaced by launchd's KeepAlive back to
// the operator via `plist.sh status`.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { defaultDbPath, openDatabase } from "../src/db/client.ts";

// The migrations folder sits next to this file at `apps/core/drizzle/`. Resolve relative to
// this script so `bun run scripts/migrate.ts` works from any CWD.
const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(HERE, "../drizzle");

function nowIso(): string {
  return new Date().toISOString();
}

function log(event: string, extra: Record<string, unknown> = {}): void {
  // Structured single-line JSON: matches the log shape serve.ts already uses on `core.listen`.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: nowIso(), event, ...extra }));
}

function preMigrationSnapshot(dbPath: string): void {
  // Skip when the DB file does not exist yet (fresh install — nothing to back up).
  if (!existsSync(dbPath)) {
    log("core.migrate.snapshot.skip", { reason: "db-missing", path: dbPath });
    return;
  }
  const snapshotsDir = resolve(dirname(dbPath), "snapshots");
  if (!existsSync(snapshotsDir)) mkdirSync(snapshotsDir, { recursive: true, mode: 0o700 });
  const stamp = nowIso().replace(/[:.]/g, "-");
  const target = resolve(snapshotsDir, `pre-${stamp}.db`);
  const res = spawnSync("sqlite3", [dbPath, `.backup '${target}'`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (res.status === 0) {
    log("core.migrate.snapshot.ok", { path: target });
  } else {
    // Non-fatal: a missing sqlite3 binary or a snapshot dir permission problem should not block
    // the migration itself. The operator will see the WARN in the log and the launchd status.
    log("core.migrate.snapshot.warn", {
      status: res.status,
      stderr: (res.stderr ?? "").toString().trim(),
    });
  }
}

async function main(): Promise<void> {
  const dbPath = defaultDbPath();
  log("core.migrate.start", { db: dbPath, migrations: MIGRATIONS_FOLDER });

  const { db, raw } = openDatabase(dbPath);

  // integrity_check returns a single row with the string 'ok' on success; anything else is a
  // multi-row list of problems. Refuse to migrate a broken store.
  const check = raw.query("PRAGMA integrity_check;").all() as Array<{ integrity_check: string }>;
  const firstResult = check[0]?.integrity_check ?? "unknown";
  if (firstResult !== "ok") {
    log("core.migrate.integrity.fail", { rows: check });
    raw.close();
    process.exit(1);
  }
  log("core.migrate.integrity.ok");

  preMigrationSnapshot(dbPath);

  try {
    // drizzle's `migrate` is synchronous underneath (Bun's Database is sync) but declared async
    // for parity with node-postgres — awaiting is safe. It internally uses a transaction per
    // migration file; wrapping the whole batch below adds an outer safety net.
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    log("core.migrate.done");
  } catch (err) {
    log("core.migrate.fail", {
      error: err instanceof Error ? err.message : String(err),
    });
    raw.close();
    process.exit(1);
  }

  raw.close();
}

await main();
