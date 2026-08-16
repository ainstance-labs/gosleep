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

const {
  enumerateSessions,
  foldSessions,
  extractWorkTopic,
  listCandidateTranscripts,
  sessionsCollectorTick,
  SESSIONS_COLLECTOR_NAME,
  SESSIONS_CADENCE_MS,
  __resetSessionsFirstSweepForTests,
  __resetSessionsChunkStateForTests,
} = await import("../src/observed/sessions.ts");
const { registerCollector, __resetCollectorInventory } = await import(
  "../src/observed/sentinel.ts"
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

  test("foldSessions writes BOTH observed and native rows (M2 fix — no fleet-poll dep)", () => {
    // Reset backfill flag so this test runs as a fresh boot.
    __resetSessionsFirstSweepForTests();
    raw.exec("DELETE FROM agent_sessions");
    raw.exec("DELETE FROM observed_events");
    const snap = enumerateSessions(fakeHome);
    const stats = foldSessions(snap);
    expect(stats.session_appeared).toBeGreaterThanOrEqual(2); // both native + observed appeared

    const rows = raw
      .query("SELECT session_id, observed_only, project_slug, model, name FROM agent_sessions ORDER BY session_id")
      .all() as {
      session_id: string;
      observed_only: number;
      project_slug: string;
      model: string | null;
      name: string;
    }[];
    // M2: native row now lands even without fleet-poll (was previously dropped).
    const nativeInserted = rows.find((r) => r.session_id === "sess-native-1");
    expect(nativeInserted).toBeDefined();
    expect(nativeInserted!.observed_only).toBe(0);
    expect(nativeInserted!.project_slug).toBe("native-repo");

    const observedInserted = rows.find((r) => r.session_id === "sess-observed-1");
    expect(observedInserted).toBeDefined();
    expect(observedInserted!.observed_only).toBe(1);
    expect(observedInserted!.project_slug).toBe("scratch-repo");
    expect(observedInserted!.name).toBe("observed:scratch-repo");
    expect(observedInserted!.model).toBe("claude-opus-4-7-20260201");

    const events = raw
      .query("SELECT COUNT(*) AS n FROM observed_events WHERE kind = 'session_appeared'")
      .get() as { n: number };
    expect(events.n).toBeGreaterThanOrEqual(2);
  });

  test("m5: first-sweep events are tagged payload.backfill=true; subsequent sweeps are backfill=false", () => {
    __resetSessionsFirstSweepForTests();
    raw.exec("DELETE FROM agent_sessions");
    raw.exec("DELETE FROM observed_events");
    // First sweep: all rows land as fresh INSERTs.
    foldSessions(enumerateSessions(fakeHome));
    const firstEvents = raw
      .query("SELECT payload_json FROM observed_events WHERE kind = 'session_appeared'")
      .all() as { payload_json: string }[];
    expect(firstEvents.length).toBeGreaterThanOrEqual(2);
    for (const ev of firstEvents) {
      const payload = JSON.parse(ev.payload_json) as { backfill?: boolean };
      expect(payload.backfill).toBe(true);
    }

    // Introduce a NEW transcript so the second sweep has something to emit for.
    writeTranscript(
      join(projectsDir, escapeCwd(observedCwd) + "-live"),
      "sess-observed-live",
      `${observedCwd}-live`,
      [JSON.stringify({ type: "last-prompt", lastPrompt: "second sweep prompt" })],
    );
    foldSessions(enumerateSessions(fakeHome));
    const liveRow = raw
      .query(
        "SELECT payload_json FROM observed_events WHERE kind = 'session_appeared' AND project_slug = 'scratch-repo-live'",
      )
      .get() as { payload_json: string } | null;
    expect(liveRow).not.toBeNull();
    const livePayload = JSON.parse(liveRow!.payload_json) as { backfill?: boolean };
    expect(livePayload.backfill).toBe(false);
  });

  test("m3: name refreshes on project_slug flip for observed rows", () => {
    __resetSessionsFirstSweepForTests();
    raw.exec("DELETE FROM agent_sessions");
    raw.exec("DELETE FROM observed_events");
    // Seed the observed row with a STALE name that doesn't match its current slug.
    raw.exec(
      "INSERT INTO agent_sessions(session_id, name, kind, cwd, status, started_at, updated_at, " +
        "project_slug, cwd_project_root, observed_only) " +
        "VALUES('sess-observed-1', 'observed:old-slug', 'interactive', '" +
        observedCwd +
        "', 'idle', '2026-08-16T00:00:00Z', '2026-08-16T00:00:00Z', 'old-slug', '" +
        observedCwd +
        "', 1)",
    );
    foldSessions(enumerateSessions(fakeHome));
    const row = raw
      .query("SELECT name FROM agent_sessions WHERE session_id = 'sess-observed-1'")
      .get() as { name: string };
    expect(row.name).toBe("observed:scratch-repo"); // refreshed to current slug
  });

  test("GSL-359: default enumeration leaves tmux_pane_pid null (lsof is opt-in via GOSLEEP_OBSERVER_LSOF)", () => {
    // Prod behaviour (verified in R2): lsof -t <transcript> returns empty because the Claude
    // CLI closes the file between turns. Enumerator MUST NOT invoke lsof/ps by default; the
    // /fleet SQL uses the heuristic path first and pidtree only fills in when the opt-in
    // populated `agent_sessions.pid`. This test pins that contract so a future revert of the
    // GSL-359 gate would fail loudly.
    const priorFlag = process.env["GOSLEEP_OBSERVER_LSOF"];
    delete process.env["GOSLEEP_OBSERVER_LSOF"];
    try {
      // Non-empty panePids on purpose — the gate short-circuits BEFORE the lookup, so this
      // documents that the gate wins even when pids are available.
      const panePids = new Set<number>([process.pid, 999_999_999]);
      const rows = enumerateSessions(fakeHome, panePids);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.tmux_pane_pid).toBeNull();
      }
    } finally {
      if (priorFlag === undefined) delete process.env["GOSLEEP_OBSERVER_LSOF"];
      else process.env["GOSLEEP_OBSERVER_LSOF"] = priorFlag;
    }
  });

  test("m6: transcript quiet > ENDED_THRESHOLD_MS sets ended_at on the row", () => {
    __resetSessionsFirstSweepForTests();
    raw.exec("DELETE FROM agent_sessions");
    raw.exec("DELETE FROM observed_events");
    // Write a transcript with an OLD mtime (2 hours ago).
    const oldTs = Date.now() - 2 * 60 * 60 * 1_000;
    const oldSessionDir = join(projectsDir, escapeCwd(observedCwd) + "-old");
    mkdirSync(oldSessionDir, { recursive: true });
    const oldSessionPath = join(oldSessionDir, "sess-old.jsonl");
    writeFileSync(
      oldSessionPath,
      JSON.stringify({ type: "header", cwd: observedCwd + "-old", model: "haiku" }) + "\n",
    );
    // Bun's fs uses utimesSync via the node interop.
    const fs = require("node:fs");
    fs.utimesSync(oldSessionPath, new Date(oldTs), new Date(oldTs));

    foldSessions(enumerateSessions(fakeHome));
    const row = raw
      .query("SELECT ended_at, session_id FROM agent_sessions WHERE session_id = 'sess-old'")
      .get() as { ended_at: string | null; session_id: string };
    expect(row).toBeDefined();
    expect(row.ended_at).not.toBeNull();
  });
});

describe("GSL-360 chunked collector loop", () => {
  test("listCandidateTranscripts returns every .jsonl under fake HOME with mtime", () => {
    const cands = listCandidateTranscripts(fakeHome);
    // At minimum the two seed transcripts from module setup are present.
    expect(cands.length).toBeGreaterThanOrEqual(2);
    for (const c of cands) {
      expect(c.path.endsWith(".jsonl")).toBe(true);
      expect(c.session_id).toMatch(/^sess-/);
      expect(c.mtime_ms).toBeGreaterThan(0);
    }
    // Sorted by path for deterministic cold-rotation cursor semantics.
    const sorted = [...cands].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    expect(cands.map((c) => c.path)).toEqual(sorted.map((c) => c.path));
  });

  test("sessionsCollectorTick chunks cold transcripts; backfill flag stays held across the rotation and clears on wrap", async () => {
    __resetSessionsFirstSweepForTests();
    __resetSessionsChunkStateForTests();
    __resetCollectorInventory();
    raw.exec("DELETE FROM agent_sessions");
    raw.exec("DELETE FROM observed_events");

    // Seed sentinel inventory so `sessionsCollectorTick` can `runCollectorTick`.
    registerCollector(SESSIONS_COLLECTOR_NAME, {
      source: "transcript-mtime",
      cadence_ms: SESSIONS_CADENCE_MS,
    });

    // Force a small warm window (1 s) so we can stamp mtimes deep in the past and make them
    // cold on purpose. Force chunk size to 1 so we can observe the rotation with tiny N.
    const priorWarm = process.env["GOSLEEP_OBSERVER_WARM_WINDOW_MS"];
    const priorChunk = process.env["GOSLEEP_OBSERVER_COLD_CHUNK"];
    process.env["GOSLEEP_OBSERVER_WARM_WINDOW_MS"] = "1000";
    process.env["GOSLEEP_OBSERVER_COLD_CHUNK"] = "1";

    // Create 3 cold transcripts under a fresh isolated fake HOME. Using the module-level
    // fakeHome would collide with warm rows from prior tests; a per-test HOME keeps the
    // cold list small and deterministic.
    const chunkHome = join(scratchRoot, "chunk-home");
    const chunkProjects = join(chunkHome, "projects");
    mkdirSync(chunkProjects, { recursive: true });
    const fsNode = require("node:fs");
    const oldTs = Date.now() - 10 * 60 * 60 * 1_000; // 10 h old → cold under 1 s warm window
    const coldPaths: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const cwd = join(scratchRoot, `chunk-cold-${i}`);
      mkdirSync(cwd, { recursive: true });
      const dir = join(chunkProjects, `-${cwd.replace(/\//g, "-")}`);
      mkdirSync(dir, { recursive: true });
      const p = join(dir, `sess-cold-${i}.jsonl`);
      writeFileSync(p, JSON.stringify({ type: "header", cwd, model: "haiku" }) + "\n");
      fsNode.utimesSync(p, new Date(oldTs), new Date(oldTs));
      coldPaths.push(p);
    }

    try {
      // Tick 1 — one cold visited, backfill still held.
      await sessionsCollectorTick(chunkHome);
      const after1 = raw
        .query("SELECT payload_json FROM observed_events WHERE kind = 'session_appeared'")
        .all() as { payload_json: string }[];
      expect(after1).toHaveLength(1);
      expect(JSON.parse(after1[0]!.payload_json).backfill).toBe(true);

      // Tick 2 — second cold visited, still held.
      await sessionsCollectorTick(chunkHome);
      const after2 = raw
        .query("SELECT payload_json FROM observed_events WHERE kind = 'session_appeared'")
        .all() as { payload_json: string }[];
      expect(after2).toHaveLength(2);
      for (const ev of after2) {
        expect(JSON.parse(ev.payload_json).backfill).toBe(true);
      }

      // Tick 3 — third cold visited, cursor wraps → coldRotationComplete=true, hold cleared.
      // The event emitted by this tick is still the last of the boot flood (firstSweepDone
      // was still false when foldSessions ran), so it too is `backfill=true`.
      await sessionsCollectorTick(chunkHome);
      const after3 = raw
        .query("SELECT payload_json FROM observed_events WHERE kind = 'session_appeared'")
        .all() as { payload_json: string }[];
      expect(after3).toHaveLength(3);
      for (const ev of after3) {
        expect(JSON.parse(ev.payload_json).backfill).toBe(true);
      }

      // Introduce a NEW transcript AFTER the rotation completed and tick again — it must
      // land as backfill=false because firstSweepDone flipped when we passed
      // holdFirstSweep=false at the end of tick 3.
      const liveCwd = join(scratchRoot, "chunk-live");
      mkdirSync(liveCwd, { recursive: true });
      const liveDir = join(chunkProjects, `-${liveCwd.replace(/\//g, "-")}`);
      mkdirSync(liveDir, { recursive: true });
      const livePath = join(liveDir, "sess-live-1.jsonl");
      writeFileSync(livePath, JSON.stringify({ type: "header", cwd: liveCwd, model: "haiku" }) + "\n");
      // Fresh mtime → warm.
      await sessionsCollectorTick(chunkHome);
      const liveRow = raw
        .query(
          "SELECT payload_json FROM observed_events WHERE kind = 'session_appeared' AND project_slug = 'chunk-live'",
        )
        .get() as { payload_json: string } | null;
      expect(liveRow).not.toBeNull();
      expect(JSON.parse(liveRow!.payload_json).backfill).toBe(false);
    } finally {
      if (priorWarm === undefined) delete process.env["GOSLEEP_OBSERVER_WARM_WINDOW_MS"];
      else process.env["GOSLEEP_OBSERVER_WARM_WINDOW_MS"] = priorWarm;
      if (priorChunk === undefined) delete process.env["GOSLEEP_OBSERVER_COLD_CHUNK"];
      else process.env["GOSLEEP_OBSERVER_COLD_CHUNK"] = priorChunk;
    }
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
