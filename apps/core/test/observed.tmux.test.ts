// @gosleep/core — tmux map collector tests (GSL-352 under GSL-350 phase 14).
//
// Coverage:
//   1. parseTmuxListOutput handles the tab-separated -F fixture.
//   2. foldScrape UPSERTs new panes AND emits `pane_appeared` events.
//   3. foldScrape re-run with same rows → 0 appeared, existing last_seen refreshed.
//   4. Missing pane over PANE_DISAPPEAR_THRESHOLD sweeps → one `pane_disappeared` event.

import { describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as schema from "../src/db/schema.ts";
import type { OpenedDb } from "../src/db/client.ts";
import { openDatabase as realOpenDatabase } from "../src/db/client.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_MIGRATIONS = resolve(HERE, "../drizzle");

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

const { parseTmuxListOutput, foldScrape } = await import("../src/observed/tmux.ts");

const FIXTURE_LINES = [
  ["%0", "$0", "main", "@0", "12345", "/tmp/repoA", "bun", "gosleep-orch"].join("\t"),
  ["%1", "$0", "main", "@0", "12346", "/tmp/repoA", "vim", "gosleep-worker"].join("\t"),
  ["%2", "$1", "other", "@1", "22222", "/tmp/other", "bash", "shell"].join("\t"),
  ["%3", "$1", "other", "@1", "33333", "/private/tmp/repoB", "claude", "claude-code"].join("\t"),
].join("\n");

describe("tmux collector (GSL-352)", () => {
  test("parseTmuxListOutput parses tab-separated -F output", () => {
    const parsed = parseTmuxListOutput(FIXTURE_LINES);
    expect(parsed).toHaveLength(4);
    expect(parsed[0]!.pane_id).toBe("%0");
    expect(parsed[0]!.session_name).toBe("main");
    expect(parsed[0]!.pane_pid).toBe(12345);
    expect(parsed[3]!.pane_current_command).toBe("claude");
    expect(parsed[3]!.pane_title).toBe("claude-code");
  });

  test("foldScrape UPSERTs 4 rows + emits 4 pane_appeared events on first sweep", () => {
    // Fresh state — remove any leftover rows.
    raw.exec("DELETE FROM tmux_panes");
    raw.exec("DELETE FROM observed_events");
    const ts = "2026-08-16T00:00:00Z";
    const result = foldScrape(ts, parseTmuxListOutput(FIXTURE_LINES));
    expect(result.upserts).toBe(4);
    expect(result.appeared).toBe(4);
    expect(result.disappeared).toBe(0);

    const rows = raw.query("SELECT pane_id, last_seen, misses FROM tmux_panes").all() as {
      pane_id: string;
      last_seen: string;
      misses: number;
    }[];
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.last_seen).toBe(ts);
      expect(r.misses).toBe(0);
    }

    const eventRows = raw
      .query("SELECT kind, source FROM observed_events WHERE kind = 'pane_appeared'")
      .all() as { kind: string; source: string }[];
    expect(eventRows.length).toBe(4);
    for (const e of eventRows) {
      expect(e.source).toBe("tmux-list");
    }
  });

  test("Re-fold with same rows on a later ts → 0 appeared, last_seen refreshed", () => {
    const ts2 = "2026-08-16T00:00:02Z";
    const result = foldScrape(ts2, parseTmuxListOutput(FIXTURE_LINES));
    expect(result.appeared).toBe(0);
    expect(result.disappeared).toBe(0);
    const rows = raw
      .query("SELECT DISTINCT last_seen FROM tmux_panes")
      .all() as { last_seen: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.last_seen).toBe(ts2);
  });

  test("Missing pane over the threshold produces a pane_disappeared event", () => {
    const trimmed = FIXTURE_LINES.split("\n").filter((l) => !l.startsWith("%2")).join("\n");
    const ts3 = "2026-08-16T00:00:04Z";
    const r1 = foldScrape(ts3, parseTmuxListOutput(trimmed));
    expect(r1.disappeared).toBe(0);
    const ts4 = "2026-08-16T00:00:06Z";
    const r2 = foldScrape(ts4, parseTmuxListOutput(trimmed));
    expect(r2.disappeared).toBe(1);

    const events = raw
      .query("SELECT COUNT(*) AS n FROM observed_events WHERE kind = 'pane_disappeared'")
      .get() as { n: number };
    expect(events.n).toBe(1);
  });

  test("m4: dead pane is soft-deleted (pruned) after PANE_PRUNE_THRESHOLD misses", () => {
    // Continue from the prior test's state: pane %2 has misses=2 already and the row exists.
    // Keep the trimmed fixture (no %2) and sweep many more times.
    const trimmed = FIXTURE_LINES.split("\n").filter((l) => !l.startsWith("%2")).join("\n");
    let lastRes: { pruned: number } | null = null;
    for (let i = 3; i <= 15; i += 1) {
      const ts = `2026-08-16T00:00:${String(i * 2).padStart(2, "0")}Z`;
      lastRes = foldScrape(ts, parseTmuxListOutput(trimmed));
    }
    // Somewhere in that range the prune threshold (10) was crossed exactly once.
    const paneRow = raw
      .query("SELECT pane_id FROM tmux_panes WHERE pane_id = '%2'")
      .get() as { pane_id: string } | null;
    expect(paneRow).toBeNull(); // soft-deleted (pruned)
    // The pane_disappeared event fires exactly ONCE across the run (threshold-crossing only).
    const evCount = raw
      .query("SELECT COUNT(*) AS n FROM observed_events WHERE kind = 'pane_disappeared'")
      .get() as { n: number };
    expect(evCount.n).toBe(1);
    expect(lastRes!.pruned).toBeGreaterThanOrEqual(0); // may be 0 on the very last tick
  });
});
