// @gosleep/core — machine-wide Claude session enumerator (GSL-353 under GSL-350 phase 14).
//
// Walks `~/.claude/projects/<escaped-cwd>/*.jsonl` — every project on the host, not only
// gosleep. Reads each transcript's HEAD (first line, for cwd) + TAIL (last line, for
// liveness / last-message summary) — NEVER the body between. Model is picked from the first
// assistant/system frame that names one.
//
// SIDE-EFFECTS declared (for sentinel review — R14.1):
//   - READS: ~/.claude/projects/*/*.jsonl transcripts (head+tail only), file mtimes.
//   - WRITES: agent_sessions rows (own table, for observed AND native rows — the upsert
//     pattern is idempotent w.r.t. the fleet-poll worker; only `pid`, `status`, `model`,
//     `project_slug`, `cwd_project_root`, `updated_at` are set — hook-owned columns like
//     `current_tool` / `context_pct` / `cycle` are never overwritten). Also observed_events
//     via the sanctioned writer.
//   - SPAWNS: `ps -o ppid=` and `lsof -t` for pid-tree correlation are only issued when the
//     `GOSLEEP_OBSERVER_LSOF=1` env opt-in is set (GSL-359 primacy swap — see pidtree.ts).
//     Off by default because verifier R2 measured lsof returning empty 100% in prod.
//
// Owner-decision refinements (2026-08-16, binding on the PRD's open questions):
//   - Depth = FACTS + WORK-TOPIC. This file provides the WORK-TOPIC heuristic (last user
//     message ≤60 char slice) with `attribution_kind='inferred'` — the UI clearly labels it.
//   - Privacy hide list is layered on top by projects.ts; this file always writes the real
//     project_slug into the DB (hiding is a render-time projection).
//
// GSL-360 (2026-08-16) — collector loop is chunked to keep the tick under R14.5 cadence.
// The enumerator's `readdir`+`stat` list is still cheap; the per-transcript enrichment
// (header/tail read, work-topic extraction) is deferred so warm transcripts (mtime within
// WARM_WINDOW_MS) process every tick and cold transcripts rotate N=COLD_CHUNK per tick.
// The historical-backfill guard (`firstSweepDone`) now flips only after the first full
// cold rotation completes, so the boot-time flood stays tagged `backfill=true` throughout.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { getDb } from "../db/client.ts";
import { appendObservedEvent } from "./events.ts";
import { resolvePaneForTranscript } from "./pidtree.ts";
import { bumpEventsToday, registerCollector, runCollectorTick } from "./sentinel.ts";

export const SESSIONS_COLLECTOR_NAME = "claude-sessions";
export const SESSIONS_CADENCE_MS = 5_000;

/** How long since last transcript growth before we flip a session to `session_idle`. */
export const IDLE_THRESHOLD_MS = 60_000;

/**
 * How long since transcript_mtime before an observed row is stamped `ended_at` (M6 fix).
 * 1 hour is a conservative default — most Claude sessions never quiet for that long unless
 * genuinely done. Enumerator carries `ended` on the snapshot; foldSessions applies it once
 * (idempotent — a row that later grows re-clears ended_at).
 */
export const ENDED_THRESHOLD_MS = 60 * 60 * 1_000;

/** Last-user-message slice length for the work-topic heuristic (owner decision). */
export const WORK_TOPIC_MAX_LEN = 60;

/**
 * GSL-360 chunked-fold tuning knobs.
 * - `WARM_WINDOW_MS`: transcripts whose mtime is within this window from `now()` are "warm"
 *   and get their expensive enrichment (header + tail + work-topic read) on every tick.
 *   Everything older is "cold" and rotates through fixed-size chunks. 24 h keeps every
 *   still-plausibly-live session in the warm set with room to spare.
 * - `COLD_CHUNK`: how many cold transcripts one tick processes. 50 keeps a 500-transcript
 *   home at ~10 ticks per full cold rotation (≈50 s at the default 5 s cadence).
 * Both are env-overridable for benchmarks and hermetic tests.
 */
export const WARM_WINDOW_MS_DEFAULT = 24 * 60 * 60 * 1_000;
export const COLD_CHUNK_DEFAULT = 50;

export function warmWindowMs(): number {
  const raw = process.env["GOSLEEP_OBSERVER_WARM_WINDOW_MS"];
  if (raw === undefined || raw.length === 0) return WARM_WINDOW_MS_DEFAULT;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : WARM_WINDOW_MS_DEFAULT;
}

export function coldChunkSize(): number {
  const raw = process.env["GOSLEEP_OBSERVER_COLD_CHUNK"];
  if (raw === undefined || raw.length === 0) return COLD_CHUNK_DEFAULT;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : COLD_CHUNK_DEFAULT;
}

/**
 * Fresh-boot flag for the backfill guard (M5 fix). The first foldSessions call after
 * process boot enumerates a machine that may already have hundreds of historical projects
 * on disk — every session would fire a `session_appeared` event and drown the observed
 * timeline. On the first sweep we tag each emitted event's payload with `backfill=true` so
 * the default timeline view can filter it out; subsequent sweeps emit live-tagged events.
 *
 * GSL-360 addendum: with the chunked cold rotation, "the first sweep" now means "every
 * chunk of the first full rotation across all cold transcripts". `foldSessions` accepts a
 * `holdFirstSweep` option that keeps the flag armed across chunks; `sessionsCollectorTick`
 * only clears the hold after `coldRotationComplete` flips.
 */
let firstSweepDone = false;

/** Test-only reset for the backfill flag so per-file scratch DBs get a fresh boot. */
export function __resetSessionsFirstSweepForTests(): void {
  firstSweepDone = false;
}

/** GSL-360 cold-rotation cursor + "one full pass done" flag. Module-level so successive
 *  ticks pick up where the previous left off; test-only reset provided below. */
let coldCursor = 0;
let coldRotationComplete = false;

export function __resetSessionsChunkStateForTests(): void {
  coldCursor = 0;
  coldRotationComplete = false;
}

/**
 * The gosleep repo root — sessions whose cwd is this OR any subdirectory of this are
 * considered gosleep-native (observed_only=0). Any other cwd is observed_only=1.
 * Overridable via env for hermetic tests.
 */
export function gosleepProjectRoot(): string {
  const env = process.env.GOSLEEP_REPO_ROOT;
  if (env !== undefined && env.length > 0) return resolve(env);
  // Walk up from this file: apps/core/src/observed/sessions.ts → repo root is 4 dirs up.
  // But since tests may run from anywhere, prefer the git-toplevel via cwd if set.
  return resolve(process.cwd());
}

export interface ClaudeSessionSnapshot {
  session_id: string; // the jsonl filename stem
  project_dir: string; // the ~/.claude/projects/<escaped> dir name
  project_slug: string; // basename of resolved cwd
  cwd_project_root: string | null;
  transcript_path: string;
  transcript_mtime_ms: number;
  cwd: string | null;
  model: string | null;
  work_topic_inferred: string | null;
  status: "active" | "idle";
  observed_only: 0 | 1;
  /** Owning tmux pane_pid resolved via pid-tree walk (M1 fix). NULL when correlation lost
   *  or lsof/ps unavailable — the /fleet SQL falls back to a cwd-prefix heuristic and tags
   *  the row `attribution='heuristic'`. */
  tmux_pane_pid: number | null;
  /** True iff the transcript has been quiet longer than ENDED_THRESHOLD_MS (M6 fix). */
  ended: boolean;
}

/**
 * Read the first JSON line of a transcript. Used for the CWD field Claude Code writes in the
 * session header (`"cwd":"…"` on many frames). Returns null on any parse error.
 */
export function readHeaderJson(path: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(path, "utf8");
    const nl = raw.indexOf("\n");
    if (nl < 0) return null;
    const first = raw.slice(0, nl);
    try {
      return JSON.parse(first) as Record<string, unknown>;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Read the tail of a transcript file (last ~64 KB) and return the last non-empty JSON line.
 * `~/.claude/projects` transcripts can be MB-scale — reading the whole file every 5 s per
 * session would be silly. 64 KB is enough for the last frame in every observed case.
 */
export function readTailJson(path: string, tailBytes = 65_536): Record<string, unknown> | null {
  try {
    const stat = statSync(path);
    const readFrom = Math.max(0, stat.size - tailBytes);
    const fd = Bun.file(path);
    // Bun.file has no explicit seek; use readFileSync for the fallback with position via a Buffer.
    // Node fs read with position is safer and cross-runtime.
    const buf = Buffer.alloc(stat.size - readFrom);
    // Use openSync/readSync via node:fs
    const nodeFs = require("node:fs");
    const handle = nodeFs.openSync(path, "r");
    try {
      nodeFs.readSync(handle, buf, 0, buf.length, readFrom);
    } finally {
      nodeFs.closeSync(handle);
    }
    void fd; // avoid unused-import lint
    const chunk = buf.toString("utf8");
    const lines = chunk.split("\n").filter((l) => l.length > 0);
    if (lines.length === 0) return null;
    // Prefer the LAST parseable JSON line — sometimes the tail slice starts mid-line.
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        return JSON.parse(lines[i]!) as Record<string, unknown>;
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Walk BACKWARD through the tail chunk to find the last user-typed prompt. Two shapes seen
 * in the wild:
 *   1. `{"type":"last-prompt","lastPrompt":"…"}` — a canonical last-user marker.
 *   2. `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]}}` —
 *      the normal user message frame.
 *
 * Returns the first parseable one, sliced to `WORK_TOPIC_MAX_LEN`. Redacts newlines to " " so
 * the panel gets a clean single-line summary.
 */
export function extractWorkTopic(path: string): string | null {
  try {
    const stat = statSync(path);
    const readFrom = Math.max(0, stat.size - 256 * 1024);
    const nodeFs = require("node:fs");
    const buf = Buffer.alloc(stat.size - readFrom);
    const handle = nodeFs.openSync(path, "r");
    try {
      nodeFs.readSync(handle, buf, 0, buf.length, readFrom);
    } finally {
      nodeFs.closeSync(handle);
    }
    const chunk = buf.toString("utf8");
    const lines = chunk.split("\n").filter((l) => l.length > 0);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i]!;
      // Cheap prefilter — skip lines that don't mention user shapes at all.
      if (!line.includes('"user"') && !line.includes('"last-prompt"')) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      const rec = obj as Record<string, unknown>;
      if (rec["type"] === "last-prompt" && typeof rec["lastPrompt"] === "string") {
        return summarize(rec["lastPrompt"] as string);
      }
      if (rec["type"] === "user") {
        const message = rec["message"] as Record<string, unknown> | undefined;
        const content = message?.["content"];
        if (typeof content === "string") return summarize(content);
        if (Array.isArray(content)) {
          for (const item of content) {
            if (typeof item !== "object" || item === null) continue;
            const itm = item as Record<string, unknown>;
            if (itm["type"] === "text" && typeof itm["text"] === "string") {
              return summarize(itm["text"] as string);
            }
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

function summarize(s: string): string {
  const oneline = s.replace(/\s+/g, " ").trim();
  if (oneline.length <= WORK_TOPIC_MAX_LEN) return oneline;
  return `${oneline.slice(0, WORK_TOPIC_MAX_LEN - 1)}…`;
}

/**
 * Convert `~/.claude/projects/-Users-foo-bar-baz/` back to a plausible cwd. Claude Code writes
 * these dirs by replacing every '/' in the cwd with '-' and prefixing a leading '-'. Our
 * reverse: strip the leading dash, then replace every remaining '-' with '/'. This is a
 * best-guess fallback — the real cwd from the transcript header (when present) always wins.
 */
export function directoryToGuessedCwd(dirName: string): string {
  const trimmed = dirName.startsWith("-") ? dirName.slice(1) : dirName;
  return `/${trimmed.replace(/-/g, "/")}`;
}

/**
 * GSL-360 cheap listing pass: enumerate every `.jsonl` transcript path under
 * `~/.claude/projects/*` with its mtime, WITHOUT reading the file body. `readdir`+`stat`
 * on a 500-transcript home takes single-digit ms even on slow disks — this is the primitive
 * the chunked collector loop iterates over. `buildSnapshot` below does the heavy work
 * per-candidate.
 */
export interface SessionCandidate {
  session_id: string;
  project_dir: string;
  path: string;
  mtime_ms: number;
}

export function listCandidateTranscripts(claudeHome?: string): SessionCandidate[] {
  const home = claudeHome ?? join(homedir(), ".claude");
  const projectsDir = join(home, "projects");
  if (!existsSync(projectsDir)) return [];
  const out: SessionCandidate[] = [];
  const dirents = readdirSync(projectsDir, { withFileTypes: true });
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const projectDir = join(projectsDir, dirent.name);
    let jsonlFiles: string[];
    try {
      jsonlFiles = readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const fname of jsonlFiles) {
      const path = join(projectDir, fname);
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(path);
      } catch {
        continue;
      }
      out.push({
        session_id: fname.replace(/\.jsonl$/, ""),
        project_dir: dirent.name,
        path,
        mtime_ms: stat.mtimeMs,
      });
    }
  }
  // Deterministic order so the cold-rotation cursor visits the same transcript position
  // across ticks even when the filesystem reshuffles readdir output. Path is unique.
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

/**
 * GSL-360 per-candidate enrichment: read header + tail, extract work-topic, resolve pane
 * (opt-in), classify observed-only vs native. Called by `enumerateSessions` (for the
 * legacy full-sweep path) and by `sessionsCollectorTick` (per-chunk in the chunked path).
 */
export function buildSnapshot(
  cand: SessionCandidate,
  panePids: ReadonlySet<number> | undefined,
  gosleepRoot: string,
  nowMs: number,
): ClaudeSessionSnapshot {
  const header = readHeaderJson(cand.path);
  const tail = readTailJson(cand.path);
  const cwdCandidate =
    (header && typeof header["cwd"] === "string" ? (header["cwd"] as string) : null) ??
    (tail && typeof tail["cwd"] === "string" ? (tail["cwd"] as string) : null) ??
    directoryToGuessedCwd(cand.project_dir);
  const modelCandidate = (() => {
    for (const src of [header, tail]) {
      if (src === null) continue;
      const m = (src as Record<string, unknown>)["model"];
      if (typeof m === "string" && m.length > 0) return m;
    }
    return null;
  })();
  const projectRoot = cwdCandidate;
  const slug = projectSlugFromCwd(projectRoot);
  const observedOnly: 0 | 1 = pathIsUnder(projectRoot, gosleepRoot) ? 0 : 1;
  const idle = nowMs - cand.mtime_ms > IDLE_THRESHOLD_MS;
  const ended = nowMs - cand.mtime_ms > ENDED_THRESHOLD_MS;

  // GSL-350 M1 / GSL-359 primacy swap: resolve owning tmux pane via lsof + parent-PID
  // walk ONLY when the opt-in env is set. Verifier R2 measured lsof returning empty
  // 200/200 times in prod (Claude CLI closes the transcript between turns), so the
  // hot-path lsof cost bought zero resolutions. The path is preserved as `pidtree` in
  // the /fleet CTE and can be re-armed for benchmarks or a future CLI variant that
  // keeps the file handle open.
  let tmuxPanePid: number | null = null;
  if (
    process.env["GOSLEEP_OBSERVER_LSOF"] === "1" &&
    panePids !== undefined &&
    panePids.size > 0 &&
    !ended
  ) {
    try {
      tmuxPanePid = resolvePaneForTranscript(cand.path, panePids);
    } catch {
      tmuxPanePid = null;
    }
  }

  return {
    session_id: cand.session_id,
    project_dir: cand.project_dir,
    project_slug: slug,
    cwd_project_root: projectRoot,
    transcript_path: cand.path,
    transcript_mtime_ms: cand.mtime_ms,
    cwd: cwdCandidate,
    model: modelCandidate,
    work_topic_inferred: extractWorkTopic(cand.path),
    status: idle ? "idle" : "active",
    observed_only: observedOnly,
    tmux_pane_pid: tmuxPanePid,
    ended,
  };
}

/**
 * Enumerate all `.jsonl` transcript files under `~/.claude/projects/*` — one per session.
 * Called by tests directly; the live collector tick uses the chunked path in
 * `sessionsCollectorTick` (GSL-360) instead so a 500-transcript home does not block Bun's
 * timer queue for 7-8 s at boot.
 *
 * `panePids` (optional): the set of `pane_pid` values currently in the tmux_panes table.
 * When provided AND `GOSLEEP_OBSERVER_LSOF=1`, the enumerator resolves each session's
 * owning pane via a pid-tree walk (`resolvePaneForTranscript`) and populates
 * `tmux_pane_pid` on the snapshot. Otherwise every snapshot's `tmux_pane_pid` stays null
 * and /fleet uses the cwd-prefix heuristic (`attribution='heuristic'`).
 */
export function enumerateSessions(
  claudeHome?: string,
  panePids?: ReadonlySet<number>,
): ClaudeSessionSnapshot[] {
  const cands = listCandidateTranscripts(claudeHome);
  const gosleepRoot = gosleepProjectRoot();
  const now = Date.now();
  return cands.map((c) => buildSnapshot(c, panePids, gosleepRoot, now));
}

/**
 * The project_slug for a cwd: the basename of the first path component that names an existing
 * directory. Falls back to the raw basename. Kept deterministic for the deterministic-colour
 * projection in `projects.ts`.
 */
export function projectSlugFromCwd(cwd: string): string {
  const parts = cwd.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return "root";
  return parts[parts.length - 1] ?? "root";
}

function pathIsUnder(childRaw: string, parentRaw: string): boolean {
  const child = resolve(childRaw);
  const parent = resolve(parentRaw);
  return child === parent || child.startsWith(`${parent}/`);
}

/**
 * Fold the enumerated snapshot into `agent_sessions`. Every session (observed AND native)
 * lands via an idempotent upsert (M2 fix — earlier revision only UPDATE-d native rows and
 * silently dropped them when no row pre-existed, e.g. under GOSLEEP_DISABLE_FLEET_POLL=1).
 *
 * The upsert is careful with the fleet-poll worker's ownership: it only writes columns the
 * enumerator authoritatively knows about (`pid`, `model`, `status`, `updated_at`,
 * `project_slug`, `cwd_project_root`, `observed_only`, `ended_at`) and preserves the
 * hook-owned columns (`current_tool`, `context_pct`, `current_intent`, `cycle`).
 *
 * m3 fix: `name` is refreshed on every UPDATE from the current `project_slug` so a moved
 * project no longer shows a stale `observed:old-slug` label.
 *
 * m5 fix: on the FIRST sweep after boot, emitted events carry `payload.backfill=true` so
 * the default timeline view can filter the historical flood out.
 *
 * m6 fix: when `snapshot.ended` is true (transcript quiet > ENDED_THRESHOLD_MS) the row's
 * `ended_at` is stamped; a re-active transcript later clears it back to NULL.
 */
export function foldSessions(
  snapshot: ClaudeSessionSnapshot[],
  opts?: { holdFirstSweep?: boolean },
): {
  observed_upserts: number;
  native_upserts: number;
  session_appeared: number;
  session_idle: number;
  transcript_activity: number;
  session_ended: number;
} {
  const db = getDb();
  let observed_upserts = 0;
  let native_upserts = 0;
  let session_appeared = 0;
  let session_idle_count = 0;
  let transcript_activity = 0;
  let session_ended_count = 0;

  const isBackfill = !firstSweepDone;
  // Flip AFTER the sweep so any late-arriving snapshot in this call still counts as boot.
  // The flip happens at end-of-function via the `firstSweepDone = true` assignment below.

  for (const s of snapshot) {
    const nowIso = new Date(s.transcript_mtime_ms).toISOString();
    const endedAtValue = s.ended ? nowIso : null;
    const nameValue = s.observed_only === 1 ? `observed:${s.project_slug}` : null;

    const existed = db.raw
      .query(
        "SELECT session_id, status, updated_at, ended_at, name FROM agent_sessions WHERE session_id = ?",
      )
      .get(s.session_id) as
      | { session_id: string; status: string; updated_at: string; ended_at: string | null; name: string }
      | null;

    if (existed === null) {
      // Fresh row — INSERT. Native rows get a placeholder `name` when the fleet-poll worker
      // has not yet contributed one (M2 fix — before this, native rows never landed at all
      // under GOSLEEP_DISABLE_FLEET_POLL=1).
      const insertedName = nameValue ?? `observed:${s.project_slug}`;
      db.raw
        .query(
          "INSERT INTO agent_sessions(session_id, name, kind, pid, cwd, status, started_at, " +
            "updated_at, model, observed_only, project_slug, cwd_project_root, ended_at) " +
            "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          s.session_id,
          insertedName,
          "interactive",
          s.tmux_pane_pid,
          s.cwd ?? s.cwd_project_root ?? "",
          s.status,
          nowIso,
          nowIso,
          s.model,
          s.observed_only,
          s.project_slug,
          s.cwd_project_root,
          endedAtValue,
        );
      if (s.observed_only === 1) observed_upserts += 1;
      else native_upserts += 1;
      session_appeared += 1;
      appendObservedEvent({
        project_slug: s.project_slug,
        kind: "session_appeared",
        source: "transcript-mtime",
        payload: {
          session_id: s.session_id,
          cwd: s.cwd,
          model: s.model,
          observed_only: s.observed_only === 1,
          backfill: isBackfill,
        },
      });
      bumpEventsToday(SESSIONS_COLLECTOR_NAME);
      if (s.ended) session_ended_count += 1;
    } else {
      // Existing row — UPDATE only the columns the enumerator owns. Hook-owned columns
      // (current_tool, context_pct, current_intent, cycle) are NOT touched.
      // m3: name is refreshed for observed rows so a project_slug flip is reflected. For
      // native rows we leave name to the fleet-poll worker (it names sessions authoritatively).
      db.raw
        .query(
          "UPDATE agent_sessions SET status = ?, updated_at = ?, " +
            "model = COALESCE(?, model), pid = COALESCE(?, pid), " +
            "project_slug = ?, cwd_project_root = ?, observed_only = ?, " +
            "name = CASE WHEN ? = 1 THEN ? ELSE name END, " +
            "ended_at = ? WHERE session_id = ?",
        )
        .run(
          s.status,
          nowIso,
          s.model,
          s.tmux_pane_pid,
          s.project_slug,
          s.cwd_project_root,
          s.observed_only,
          s.observed_only,
          nameValue,
          endedAtValue,
          s.session_id,
        );
      if (s.observed_only === 1) observed_upserts += 1;
      else native_upserts += 1;

      if (existed.ended_at === null && s.ended) {
        session_ended_count += 1;
        appendObservedEvent({
          project_slug: s.project_slug,
          kind: "session_idle",
          source: "transcript-mtime",
          payload: { session_id: s.session_id, ended: true, backfill: isBackfill },
        });
        bumpEventsToday(SESSIONS_COLLECTOR_NAME);
      } else if (existed.status !== "idle" && s.status === "idle") {
        session_idle_count += 1;
        appendObservedEvent({
          project_slug: s.project_slug,
          kind: "session_idle",
          source: "transcript-mtime",
          payload: { session_id: s.session_id, backfill: isBackfill },
        });
        bumpEventsToday(SESSIONS_COLLECTOR_NAME);
      } else if (existed.updated_at !== nowIso && s.status === "active") {
        transcript_activity += 1;
        appendObservedEvent({
          project_slug: s.project_slug,
          kind: "transcript_activity",
          source: "transcript-mtime",
          payload: {
            session_id: s.session_id,
            work_topic_inferred: s.work_topic_inferred,
            backfill: isBackfill,
          },
        });
        bumpEventsToday(SESSIONS_COLLECTOR_NAME);
      }
    }
  }

  // GSL-360: only flip `firstSweepDone` when the caller is NOT asking us to hold it across
  // additional chunks. The chunked collector loop holds it until the full cold rotation
  // completes, so the boot-time backfill flood stays tagged `backfill=true` throughout.
  if (opts?.holdFirstSweep !== true) firstSweepDone = true;

  return {
    observed_upserts,
    native_upserts,
    session_appeared,
    session_idle: session_idle_count,
    transcript_activity,
    session_ended: session_ended_count,
  };
}

/**
 * One collector tick. Warm transcripts (mtime within `warmWindowMs()` from now) are fully
 * enriched every tick; cold transcripts rotate through `coldChunkSize()`-per-tick chunks so
 * a 500-transcript home stops blocking Bun's timer queue for 7-8 s at boot. Wrapped in the
 * sentinel so an accidental throw is captured in the collector-inventory row.
 *
 * The `firstSweepDone` backfill guard is HELD across the first full cold rotation via
 * `foldSessions(..., { holdFirstSweep: true })`, and cleared once the cold cursor wraps.
 * That preserves the boot-time semantics of the original single-shot enumeration: every
 * historical `session_appeared` still lands with `payload.backfill=true`; only sessions
 * that appear (or reactivate) AFTER the first full rotation are tagged `backfill=false`.
 */
export async function sessionsCollectorTick(claudeHome?: string): Promise<void> {
  await runCollectorTick(SESSIONS_COLLECTOR_NAME, async () => {
    // Read the current tmux_panes.pane_pid snapshot so the enumerator can walk pids into
    // owning panes under the GSL-359 opt-in. Cheap: a single sqlite scan of a small table
    // (≤ dozens of rows in practice). Empty set → enumerator skips lsof/ps entirely.
    const db = getDb();
    const paneRows = db.raw
      .query("SELECT pane_pid FROM tmux_panes")
      .all() as { pane_pid: number }[];
    const panePids = new Set(paneRows.map((r) => r.pane_pid));

    const cands = listCandidateTranscripts(claudeHome);
    const now = Date.now();
    const warmCutoffMs = now - warmWindowMs();
    const warm: SessionCandidate[] = [];
    const cold: SessionCandidate[] = [];
    for (const c of cands) {
      if (c.mtime_ms >= warmCutoffMs) warm.push(c);
      else cold.push(c);
    }

    // Cold rotation: slice a chunk starting at the cursor, advance, wrap on overflow. The
    // wrap flips `coldRotationComplete=true` so subsequent ticks clear the backfill hold.
    const chunkSize = coldChunkSize();
    let coldChunk: SessionCandidate[] = [];
    if (cold.length > 0) {
      if (coldCursor >= cold.length) coldCursor = 0; // list shrank between ticks
      coldChunk = cold.slice(coldCursor, coldCursor + chunkSize);
      coldCursor += coldChunk.length;
      if (coldCursor >= cold.length) {
        coldCursor = 0;
        coldRotationComplete = true;
      }
    } else {
      // No cold transcripts at all → rotation is trivially complete on the first tick.
      coldRotationComplete = true;
    }

    const gosleepRoot = gosleepProjectRoot();
    const toProcess = [...warm, ...coldChunk];
    const snap = toProcess.map((c) => buildSnapshot(c, panePids, gosleepRoot, now));

    foldSessions(snap, { holdFirstSweep: !coldRotationComplete });
  });
}

export interface SessionsCollectorController {
  stop(): void;
}

export function startSessionsCollector(
  intervalMs = SESSIONS_CADENCE_MS,
): SessionsCollectorController {
  registerCollector(SESSIONS_COLLECTOR_NAME, {
    source: "transcript-mtime",
    cadence_ms: intervalMs,
  });
  const timer = setInterval(() => {
    sessionsCollectorTick().catch(() => {
      /* recorded in inventory */
    });
  }, intervalMs);
  return {
    stop() {
      clearInterval(timer);
    },
  };
}
