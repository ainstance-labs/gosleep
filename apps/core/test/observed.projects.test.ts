// @gosleep/core — project projection + hide-list opt-out tests
// (GSL-354 under GSL-350 phase 14).

import { describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as schema from "../src/db/schema.ts";
import type { OpenedDb } from "../src/db/client.ts";
import { openDatabase as realOpenDatabase } from "../src/db/client.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_MIGRATIONS = resolve(HERE, "../drizzle");

const scratchRoot = mkdtempSync(join(tmpdir(), "gsl354-projects-"));
const hidePath = join(scratchRoot, "hidden-projects.json");
process.env["GOSLEEP_OBSERVED_HIDDEN"] = hidePath;

const raw = new Database(":memory:");
raw.exec("PRAGMA journal_mode = MEMORY;");
const scratchDb = drizzle(raw, { schema });
migrate(scratchDb, { migrationsFolder: REAL_MIGRATIONS });
const openedDb: OpenedDb = { db: scratchDb, raw, path: ":memory:" };

mock.module("../src/db/client.ts", () => ({
  getDb: () => openedDb,
  openDatabase: realOpenDatabase,
  defaultDbPath: () => ":memory:",
  schema,
  __resetDbClientForTests: () => {},
}));

const {
  projectColourHsl,
  loadHiddenSlugs,
  listProjects,
  displayName,
  pseudonymFor,
} = await import("../src/observed/projects.ts");
const { appendObservedEvent } = await import("../src/observed/events.ts");

// Seed rows.
raw.exec(
  "INSERT INTO agent_sessions(session_id, name, kind, cwd, status, started_at, updated_at, " +
    "project_slug, cwd_project_root, observed_only) " +
    "VALUES('s-1', 'orch-gosleep', 'interactive', '/repo/gosleep', 'idle', '2026-08-16T00:00:00Z', '2026-08-16T00:00:05Z', 'gosleep', '/repo/gosleep', 0)",
);
raw.exec(
  "INSERT INTO agent_sessions(session_id, name, kind, cwd, status, started_at, updated_at, " +
    "project_slug, cwd_project_root, observed_only) " +
    "VALUES('s-2', 'obs:secret', 'interactive', '/repo/secret-client', 'active', '2026-08-16T00:00:00Z', '2026-08-16T00:00:10Z', 'secret-client', '/repo/secret-client', 1)",
);
raw.exec(
  "INSERT INTO agent_sessions(session_id, name, kind, cwd, status, started_at, updated_at, " +
    "project_slug, cwd_project_root, observed_only) " +
    "VALUES('s-3', 'obs:other', 'interactive', '/repo/other-repo', 'idle', '2026-08-16T00:00:00Z', '2026-08-16T00:00:03Z', 'other-repo', '/repo/other-repo', 1)",
);

describe("project projection + hide-list (GSL-354)", () => {
  test("projectColourHsl is deterministic and different for different slugs", () => {
    expect(projectColourHsl("gosleep")).toBe(projectColourHsl("gosleep"));
    expect(projectColourHsl("gosleep")).not.toBe(projectColourHsl("secret-client"));
  });

  test("loadHiddenSlugs returns empty when no file present", () => {
    try {
      rmSync(hidePath, { force: true });
    } catch {
      /* nothing */
    }
    expect(loadHiddenSlugs().size).toBe(0);
  });

  test("listProjects folds 3 rows with correct session_count and observed_only_count", () => {
    const rows = listProjects();
    expect(rows.length).toBe(3);
    const gosleep = rows.find((r) => r.project_slug === "gosleep");
    const secret = rows.find((r) => r.project_slug === "secret-client");
    expect(gosleep!.observed_only_count).toBe(0);
    expect(secret!.observed_only_count).toBe(1);
    expect(secret!.session_count).toBe(1);
    expect(secret!.hidden).toBe(false);
  });

  test("Hiding a slug flips hidden=true + assigns a stable pseudonym; events keep the real slug", () => {
    writeFileSync(hidePath, JSON.stringify(["secret-client"]));
    const rows = listProjects();
    const secret = rows.find((r) => r.project_slug === "secret-client");
    expect(secret!.hidden).toBe(true);
    expect(secret!.pseudonym).toBe("project-b");
    appendObservedEvent({
      project_slug: "secret-client",
      kind: "session_appeared",
      source: "transcript-mtime",
    });
    const evRow = raw
      .query("SELECT project_slug FROM observed_events WHERE project_slug = 'secret-client' LIMIT 1")
      .get() as { project_slug: string } | null;
    expect(evRow).not.toBeNull();
    expect(evRow!.project_slug).toBe("secret-client");
  });

  test("displayName maps hidden slug → pseudonym, others verbatim", () => {
    writeFileSync(hidePath, JSON.stringify(["secret-client", "another"]));
    // Sorted alphabetically → 'another' (0), 'secret-client' (1)
    expect(displayName("secret-client")).toBe(pseudonymFor(1));
    expect(displayName("gosleep")).toBe("gosleep");
  });
});

process.on("beforeExit", () => {
  try {
    rmSync(scratchRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
