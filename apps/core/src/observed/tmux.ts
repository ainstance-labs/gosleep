// @gosleep/core — tmux map collector (GSL-352 under GSL-350 phase 14).
//
// Reads the local tmux server every 2 s (R14.5) and UPSERTs one row per pane into
// `tmux_panes`. Enumerates the WHOLE server (R14.2) — no cwd-prefix filter.
//
// SIDE-EFFECTS declared (for the sentinel review — R14.1):
//   - READS: `tmux` binary via Bun.spawnSync (`list-panes -a -F …`).
//   - WRITES: `tmux_panes` rows (own table), `observed_events` rows via the writer.
//   - SPAWNS: `tmux` (read-only subcommands only — never `send-keys`, never `capture-pane`).
//
// The FORMAT string mirrors what the machine-wide Claude-session enumerator + Fleet
// enrichment consume. `pane_id` is used verbatim as the primary key.
//
// tmux-unavailable behaviour: a first-time run without tmux installed (or without a running
// server) logs `core.observed.tmux.unavailable` once and no-ops the sweep. The collector is
// NOT disabled on that error — the operator may start a tmux server later. Only a real
// exception inside the parser trips the sentinel via runCollectorTick.

import { getDb } from "../db/client.ts";
import { appendObservedEvent } from "./events.ts";
import { bumpEventsToday, registerCollector, runCollectorTick } from "./sentinel.ts";

export const TMUX_COLLECTOR_NAME = "tmux-map";
export const TMUX_CADENCE_MS = 2_000;

/** How many consecutive misses before a pane_disappeared event is emitted. */
const PANE_DISAPPEAR_THRESHOLD = 2;

/**
 * How many consecutive misses before a pane row is soft-deleted (M4 fix). The disappear
 * event fires at PANE_DISAPPEAR_THRESHOLD; PANE_PRUNE_THRESHOLD gives us a few extra
 * sweeps of headroom in case the tmux server briefly hiccuped (e.g. `-L` socket flap) so
 * we don't lose historical rows on a false-alarm miss. Rows past the prune threshold are
 * DELETEd — the disappear event is already recorded in observed_events for history.
 */
const PANE_PRUNE_THRESHOLD = 10;

/** tmux -F format string. Fields land tab-separated in stdout — parser splits accordingly. */
const TMUX_FMT =
  "#{pane_id}\t#{session_id}\t#{session_name}\t#{window_id}\t#{pane_pid}\t" +
  "#{pane_current_path}\t#{pane_current_command}\t#{pane_title}";

export interface RawPaneRow {
  pane_id: string;
  session_id: string;
  session_name: string;
  window_id: string;
  pane_pid: number;
  pane_current_path: string | null;
  pane_current_command: string | null;
  pane_title: string | null;
}

/**
 * Parse the tab-separated output of `tmux list-panes -a -F <TMUX_FMT>`. Skips empty lines
 * and rows whose pane_pid does not parse to a positive integer (a defensive filter — tmux is
 * reliable, but a truncated read shouldn't crash the sweep).
 */
export function parseTmuxListOutput(raw: string): RawPaneRow[] {
  const rows: RawPaneRow[] = [];
  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    const parts = line.split("\t");
    if (parts.length < 8) continue;
    const pane_pid = Number.parseInt(parts[4]!, 10);
    if (!Number.isFinite(pane_pid) || pane_pid <= 0) continue;
    rows.push({
      pane_id: parts[0]!,
      session_id: parts[1]!,
      session_name: parts[2]!,
      window_id: parts[3]!,
      pane_pid,
      pane_current_path: parts[5]?.length ? parts[5] : null,
      pane_current_command: parts[6]?.length ? parts[6] : null,
      pane_title: parts[7]?.length ? parts[7] : null,
    });
  }
  return rows;
}

/**
 * Run the `tmux list-panes -a -F <TMUX_FMT>` command via Bun.spawnSync. Returns null when
 * tmux is not available (missing binary, socket unreachable) — the caller no-ops in that
 * case. Returns the raw stdout on success.
 */
export function runTmuxList(): string | null {
  try {
    const p = Bun.spawnSync({
      cmd: ["tmux", "list-panes", "-a", "-F", TMUX_FMT],
      stderr: "pipe",
      stdout: "pipe",
    });
    if (p.exitCode !== 0) {
      // tmux exits non-zero when the server is not running. Treat as unavailable, not fatal.
      return null;
    }
    return p.stdout.toString();
  } catch {
    return null;
  }
}

/**
 * Fold a fresh scrape into the tmux_panes table + emit observed_events for appear/disappear.
 * Exposed as a pure function so tests can inject a scraped-output fixture.
 */
export function foldScrape(
  scrapedIso: string,
  panes: RawPaneRow[],
): {
  upserts: number;
  appeared: number;
  disappeared: number;
  pruned: number;
} {
  const db = getDb();
  const seenIds = new Set<string>();
  let upserts = 0;
  let appeared = 0;
  let disappeared = 0;

  for (const p of panes) {
    seenIds.add(p.pane_id);
    // UPSERT: preserve first_seen; refresh everything else and reset misses.
    const existed = db.raw
      .query("SELECT pane_id FROM tmux_panes WHERE pane_id = ?")
      .get(p.pane_id) as { pane_id: string } | null;
    if (existed === null) {
      db.raw.exec(
        "INSERT INTO tmux_panes(pane_id, session_id, session_name, window_id, pane_pid, " +
          "pane_current_path, pane_current_command, pane_title, first_seen, last_seen, misses) " +
          `VALUES('${escapeSql(p.pane_id)}', '${escapeSql(p.session_id)}', '${escapeSql(p.session_name)}', ` +
          `'${escapeSql(p.window_id)}', ${p.pane_pid}, ` +
          `${sqlOrNull(p.pane_current_path)}, ${sqlOrNull(p.pane_current_command)}, ` +
          `${sqlOrNull(p.pane_title)}, '${scrapedIso}', '${scrapedIso}', 0)`,
      );
      appeared += 1;
      appendObservedEvent({
        project_slug: null,
        kind: "pane_appeared",
        source: "tmux-list",
        payload: {
          pane_id: p.pane_id,
          pane_pid: p.pane_pid,
          pane_current_path: p.pane_current_path,
          pane_title: p.pane_title,
          session_name: p.session_name,
        },
      });
      bumpEventsToday(TMUX_COLLECTOR_NAME);
    } else {
      db.raw.exec(
        `UPDATE tmux_panes SET session_id='${escapeSql(p.session_id)}', ` +
          `session_name='${escapeSql(p.session_name)}', ` +
          `window_id='${escapeSql(p.window_id)}', pane_pid=${p.pane_pid}, ` +
          `pane_current_path=${sqlOrNull(p.pane_current_path)}, ` +
          `pane_current_command=${sqlOrNull(p.pane_current_command)}, ` +
          `pane_title=${sqlOrNull(p.pane_title)}, ` +
          `last_seen='${scrapedIso}', misses=0 ` +
          `WHERE pane_id='${escapeSql(p.pane_id)}'`,
      );
    }
    upserts += 1;
  }

  // Any pane not seen this sweep gets misses++; PANE_DISAPPEAR_THRESHOLD trip → event once.
  // M4 fix — panes past PANE_PRUNE_THRESHOLD get soft-deleted (their disappear event is
  // already recorded in observed_events so the historical view survives).
  const stale = db.raw
    .query(
      "SELECT pane_id, session_name, pane_pid, misses FROM tmux_panes " +
        "WHERE last_seen <> ?",
    )
    .all(scrapedIso) as {
    pane_id: string;
    session_name: string;
    pane_pid: number;
    misses: number;
  }[];

  let pruned = 0;
  for (const row of stale) {
    if (seenIds.has(row.pane_id)) continue;
    const nextMisses = row.misses + 1;
    // Fire the disappear event on the exact threshold crossing (never re-emit).
    if (row.misses < PANE_DISAPPEAR_THRESHOLD && nextMisses >= PANE_DISAPPEAR_THRESHOLD) {
      disappeared += 1;
      appendObservedEvent({
        project_slug: null,
        kind: "pane_disappeared",
        source: "tmux-list",
        payload: {
          pane_id: row.pane_id,
          pane_pid: row.pane_pid,
          session_name: row.session_name,
          missed_sweeps: nextMisses,
        },
      });
      bumpEventsToday(TMUX_COLLECTOR_NAME);
    }
    if (nextMisses >= PANE_PRUNE_THRESHOLD) {
      // Soft-delete: remove the row so /observed/tmux stops counting a dead pane. The
      // pane_disappeared event stays in observed_events for the historical timeline.
      db.raw.exec(
        `DELETE FROM tmux_panes WHERE pane_id='${escapeSql(row.pane_id)}'`,
      );
      pruned += 1;
    } else {
      db.raw.exec(
        `UPDATE tmux_panes SET misses=${nextMisses} WHERE pane_id='${escapeSql(row.pane_id)}'`,
      );
    }
  }

  return { upserts, appeared, disappeared, pruned };
}

/**
 * One collector tick — the sentinel-wrapped entry point the poller calls every 2 s.
 * Splits into `runTmuxList()` (I/O) and `foldScrape()` (pure) so tests can inject fixtures.
 */
export async function tmuxCollectorTick(): Promise<void> {
  await runCollectorTick(TMUX_COLLECTOR_NAME, async () => {
    const out = runTmuxList();
    if (out === null) return; // tmux unavailable → no-op, don't disable
    const panes = parseTmuxListOutput(out);
    foldScrape(new Date().toISOString(), panes);
  });
}

/**
 * Start the tmux collector polling loop. Returns a stop function the server tears down at
 * shutdown. Registers the collector inventory row on first call.
 */
export interface TmuxCollectorController {
  stop(): void;
}

export function startTmuxCollector(
  intervalMs = TMUX_CADENCE_MS,
): TmuxCollectorController {
  registerCollector(TMUX_COLLECTOR_NAME, {
    source: "tmux-list",
    cadence_ms: intervalMs,
  });
  const timer = setInterval(() => {
    tmuxCollectorTick().catch(() => {
      // Errors are surfaced through the collector inventory's last_error; no need to log here.
    });
  }, intervalMs);
  return {
    stop() {
      clearInterval(timer);
    },
  };
}

// -----------------------------------------------------------------------------
// helpers — minimal SQL escapers scoped to this collector's known input shape
// -----------------------------------------------------------------------------

function escapeSql(s: string): string {
  return s.replace(/'/g, "''");
}

function sqlOrNull(s: string | null): string {
  if (s === null) return "NULL";
  return `'${escapeSql(s)}'`;
}
