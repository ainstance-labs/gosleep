// @gosleep/core — observer-mode schema tests (GSL-351 under epic GSL-350, phase 14).
//
// Confirms the new tables + additive columns land after the full drizzle migration chain
// runs — nothing here should require test-specific SQL. Also asserts:
//   - `tmux_panes` primary key rejects a duplicate `pane_id` on second insert;
//   - `observed_events` autoincrements `seq` monotonically;
//   - `agent_sessions.observed_only` defaults to 0 for legacy inserts;
//   - the migration bumps `computeDbSchemaVersion()` relative to a pruned chain (rev drift).
//
// Uses `new Database()` + `drizzle()` directly (NOT `openDatabase` from db/client.ts) so
// that mock.module replacements installed by earlier test files (fleet.projection.test.ts,
// internal.test.ts, actions.decidePermission.sse.test.ts) do not contaminate the migration
// path — the module-mock returns a legacy in-memory DB that would fail on the CREATE TABLE
// step when we re-run migrations against it.

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

describe("observer-mode schema (GSL-351)", () => {
  const root = mkdtempSync(join(tmpdir(), "gsl351-schema-"));
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

  test("tmux_panes accepts a well-formed row and rejects duplicate pane_id", () => {
    raw.exec(
      "INSERT INTO tmux_panes(pane_id, session_id, session_name, window_id, pane_pid, " +
        "pane_current_path, pane_current_command, pane_title, first_seen, last_seen) " +
        "VALUES('%1', '$1', 'main', '@1', 12345, '/tmp/repoA', 'bun', 'gosleep-orch', " +
        "'2026-08-16T00:00:00Z', '2026-08-16T00:00:00Z')",
    );
    // Duplicate should throw (UNIQUE PRIMARY KEY on pane_id).
    expect(() => {
      raw.exec(
        "INSERT INTO tmux_panes(pane_id, session_id, session_name, window_id, pane_pid, " +
          "pane_current_path, pane_current_command, pane_title, first_seen, last_seen) " +
          "VALUES('%1', '$1', 'main', '@1', 12345, '/tmp/repoA', 'bun', 'gosleep-orch', " +
          "'2026-08-16T00:00:00Z', '2026-08-16T00:00:00Z')",
      );
    }).toThrow();
  });

  test("observed_events autoincrements seq monotonically", () => {
    raw.exec(
      "INSERT INTO observed_events(ts, project_slug, kind, source, payload_json) " +
        "VALUES('2026-08-16T00:00:01Z', 'repoA', 'session_appeared', 'transcript-mtime', '{}')",
    );
    raw.exec(
      "INSERT INTO observed_events(ts, project_slug, kind, source, payload_json) " +
        "VALUES('2026-08-16T00:00:02Z', 'repoA', 'transcript_activity', 'transcript-mtime', '{}')",
    );
    const rows = raw.query("SELECT seq FROM observed_events ORDER BY seq").all() as {
      seq: number;
    }[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]!.seq).toBeLessThan(rows[1]!.seq);
  });

  test("agent_sessions.observed_only defaults to 0 when omitted", () => {
    raw.exec(
      "INSERT INTO agent_sessions(session_id, name, kind, cwd, status, started_at, updated_at) " +
        "VALUES('sess-1', 'orch', 'interactive', '/tmp/x', 'idle', '2026-08-16T00:00:00Z', '2026-08-16T00:00:00Z')",
    );
    const row = raw
      .query(
        "SELECT observed_only, project_slug, cwd_project_root FROM agent_sessions WHERE session_id = 'sess-1'",
      )
      .get() as { observed_only: number; project_slug: string | null; cwd_project_root: string | null };
    expect(row.observed_only).toBe(0);
    expect(row.project_slug).toBeNull();
    expect(row.cwd_project_root).toBeNull();
  });

  test("computeDbSchemaVersion reflects the new migration (drift from a truncated chain)", () => {
    // Compare full-chain hash against a truncated-chain hash. If the new migration file is not
    // being hashed, the two would collide — this asserts the schema-version machinery sees it.
    const scratchDir = mkdtempSync(join(tmpdir(), "gsl351-drift-"));
    const drizzleDir = join(scratchDir, "drizzle");
    mkdirSync(join(drizzleDir, "meta"), { recursive: true });
    // Copy every migration + the meta journal.
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
    // Now nuke the 0005 migration file and recompute — the hash MUST change.
    rmSync(join(drizzleDir, "0005_observer_mode_phase_a.sql"));
    const truncated = computeDbSchemaVersion({ drizzleDir });
    expect(full).not.toBe(truncated);
    rmSync(scratchDir, { recursive: true, force: true });
  });
});
