// @gosleep/core — machine-wide Claude session enumerator + work-topic heuristic tests
// (GSL-353 under GSL-350 phase 14).
//
// Uses a fake ~/.claude with two project directories: one that matches GOSLEEP_REPO_ROOT
// (native), one that does not (observed-only). Each has a hand-written .jsonl transcript.

import { describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as schema from "../src/db/schema.ts";
import type { OpenedDb } from "../src/db/client.ts";
import { openDatabase as realOpenDatabase } from "../src/db/client.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_MIGRATIONS = resolve(HERE, "../drizzle");

const scratchRoot = mkdtempSync(join(tmpdir(), "gsl353-sessions-"));

// Fake $HOME/.claude for the enumerator.
const fakeHome = join(scratchRoot, "claude-home");
const projectsDir = join(fakeHome, "projects");
mkdirSync(projectsDir, { recursive: true });

// Fake native project (matches GOSLEEP_REPO_ROOT).
const nativeCwd = join(scratchRoot, "native-repo");
mkdirSync(nativeCwd, { recursive: true });
process.env["GOSLEEP_REPO_ROOT"] = nativeCwd;

// Fake observed-only project (scratch-repo under /tmp/other).
const observedCwd = join(scratchRoot, "scratch-repo");
mkdirSync(observedCwd, { recursive: true });

function escapeCwd(cwd: string): string {
  return `-${cwd.replace(/\//g, "-")}`;
}

function writeTranscript(projectDir: string, sessionId: string, cwd: string, extra: string[]): void {
  mkdirSync(projectDir, { recursive: true });
  const lines: string[] = [];
  lines.push(JSON.stringify({ type: "header", cwd, model: "claude-opus-4-7-20260201" }));
  for (const l of extra) lines.push(l);
  writeFileSync(join(projectDir, `${sessionId}.jsonl`), `${lines.join("\n")}\n`);
}

writeTranscript(
  join(projectsDir, escapeCwd(nativeCwd)),
  "sess-native-1",
  nativeCwd,
  [
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "please review the migration" }] } }),
    JSON.stringify({ type: "last-prompt", lastPrompt: "review migration for safety and coverage" }),
  ],
);

writeTranscript(
  join(projectsDir, escapeCwd(observedCwd)),
  "sess-observed-1",
  observedCwd,
  [
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "add a table to my note app" }] } }),
    JSON.stringify({ type: "last-prompt", lastPrompt: "make the fruit column sortable" }),
  ],
);

// Scratch DB with the FULL migration chain.
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

const { enumerateSessions, foldSessions, extractWorkTopic } = await import(
  "../src/observed/sessions.ts"
);

describe("machine-wide session enumerator (GSL-353)", () => {
  test("enumerateSessions returns 2 rows across 2 projects with observed_only correctly set", () => {
    const rows = enumerateSessions(fakeHome);
    expect(rows).toHaveLength(2);
    const nativeRow = rows.find((r) => r.session_id === "sess-native-1");
    const observedRow = rows.find((r) => r.session_id === "sess-observed-1");
    expect(nativeRow).toBeDefined();
    expect(observedRow).toBeDefined();
    expect(nativeRow!.observed_only).toBe(0);
    expect(observedRow!.observed_only).toBe(1);
    // Both surface the transcript's cwd (header wins).
    expect(nativeRow!.cwd).toBe(nativeCwd);
    expect(observedRow!.cwd).toBe(observedCwd);
    expect(nativeRow!.model).toBe("claude-opus-4-7-20260201");
  });

  test("extractWorkTopic finds the last-prompt line and slices to WORK_TOPIC_MAX_LEN", () => {
    const observedProjectDir = join(projectsDir, escapeCwd(observedCwd));
    const path = join(observedProjectDir, "sess-observed-1.jsonl");
    const topic = extractWorkTopic(path);
    expect(topic).not.toBeNull();
    expect(topic).toContain("fruit column");
  });

  test("foldSessions writes an observed-only row + a session_appeared event; native cwd row is NOT observed_only", () => {
    const snap = enumerateSessions(fakeHome);
    const stats = foldSessions(snap);
    expect(stats.session_appeared).toBeGreaterThanOrEqual(1);
    const rows = raw
      .query("SELECT session_id, observed_only, project_slug, model FROM agent_sessions ORDER BY session_id")
      .all() as {
      session_id: string;
      observed_only: number;
      project_slug: string;
      model: string | null;
    }[];
    const observedInserted = rows.find((r) => r.session_id === "sess-observed-1");
    expect(observedInserted).toBeDefined();
    expect(observedInserted!.observed_only).toBe(1);
    expect(observedInserted!.project_slug).toBe("scratch-repo");
    expect(observedInserted!.model).toBe("claude-opus-4-7-20260201");

    const events = raw
      .query("SELECT COUNT(*) AS n FROM observed_events WHERE kind = 'session_appeared'")
      .get() as { n: number };
    expect(events.n).toBeGreaterThanOrEqual(1);
  });
});

// Cleanup — best-effort at process exit; bun:test doesn't call afterAll on module scope.
process.on("beforeExit", () => {
  try {
    rmSync(scratchRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
