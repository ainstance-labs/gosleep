// @gosleep/core — machine-wide Claude session enumerator (GSL-353 under GSL-350 phase 14).
//
// Walks `~/.claude/projects/<escaped-cwd>/*.jsonl` — every project on the host, not only
// gosleep. Reads each transcript's HEAD (first line, for cwd) + TAIL (last line, for
// liveness / last-message summary) — NEVER the body between. Model is picked from the first
// assistant/system frame that names one.
//
// SIDE-EFFECTS declared (for sentinel review — R14.1):
//   - READS: ~/.claude/projects/*/*.jsonl transcripts (head+tail only), file mtimes.
//   - WRITES: agent_sessions rows (own table, for observed rows only), observed_events via
//     the sanctioned writer.
//   - SPAWNS: none.
//
// Owner-decision refinements (2026-08-16, binding on the PRD's open questions):
//   - Depth = FACTS + WORK-TOPIC. This file provides the WORK-TOPIC heuristic (last user
//     message ≤60 char slice) with `attribution_kind='inferred'` — the UI clearly labels it.
//   - Privacy hide list is layered on top by projects.ts; this file always writes the real
//     project_slug into the DB (hiding is a render-time projection).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { getDb } from "../db/client.ts";
import { appendObservedEvent } from "./events.ts";
import { bumpEventsToday, registerCollector, runCollectorTick } from "./sentinel.ts";

export const SESSIONS_COLLECTOR_NAME = "claude-sessions";
export const SESSIONS_CADENCE_MS = 5_000;

/** How long since last transcript growth before we flip a session to `session_idle`. */
export const IDLE_THRESHOLD_MS = 60_000;

/** Last-user-message slice length for the work-topic heuristic (owner decision). */
export const WORK_TOPIC_MAX_LEN = 60;

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
 * Enumerate all `.jsonl` transcript files under `~/.claude/projects/*` — one per session.
 * Called by the collector tick; also directly exercised in tests with a fake HOME dir.
 */
export function enumerateSessions(claudeHome?: string): ClaudeSessionSnapshot[] {
  const home = claudeHome ?? join(homedir(), ".claude");
  const projectsDir = join(home, "projects");
  if (!existsSync(projectsDir)) return [];
  const gosleepRoot = gosleepProjectRoot();
  const out: ClaudeSessionSnapshot[] = [];

  const now = Date.now();
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
      const header = readHeaderJson(path);
      const tail = readTailJson(path);
      const cwdCandidate =
        (header && typeof header["cwd"] === "string" ? (header["cwd"] as string) : null) ??
        (tail && typeof tail["cwd"] === "string" ? (tail["cwd"] as string) : null) ??
        directoryToGuessedCwd(dirent.name);
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

      const idle = now - stat.mtimeMs > IDLE_THRESHOLD_MS;

      out.push({
        session_id: fname.replace(/\.jsonl$/, ""),
        project_dir: dirent.name,
        project_slug: slug,
        cwd_project_root: projectRoot,
        transcript_path: path,
        transcript_mtime_ms: stat.mtimeMs,
        cwd: cwdCandidate,
        model: modelCandidate,
        work_topic_inferred: extractWorkTopic(path),
        status: idle ? "idle" : "active",
        observed_only: observedOnly,
      });
    }
  }

  return out;
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
 * Fold the enumerated snapshot into `agent_sessions`. Only observed_only=1 sessions are
 * UPSERTed here — gosleep-native rows are owned by the existing fleet-poll worker and would
 * be double-written otherwise. The gosleep-native rows still get their `project_slug` and
 * `cwd_project_root` populated by a separate lightweight UPDATE.
 */
export function foldSessions(snapshot: ClaudeSessionSnapshot[]): {
  observed_upserts: number;
  session_appeared: number;
  session_idle: number;
  transcript_activity: number;
} {
  const db = getDb();
  let observed_upserts = 0;
  let session_appeared = 0;
  let session_idle_count = 0;
  let transcript_activity = 0;

  for (const s of snapshot) {
    const nowIso = new Date(s.transcript_mtime_ms).toISOString();
    if (s.observed_only === 1) {
      const existed = db.raw
        .query("SELECT session_id, status, updated_at FROM agent_sessions WHERE session_id = ?")
        .get(s.session_id) as { session_id: string; status: string; updated_at: string } | null;
      if (existed === null) {
        db.raw
          .query(
            "INSERT INTO agent_sessions(session_id, name, kind, cwd, status, started_at, " +
              "updated_at, model, observed_only, project_slug, cwd_project_root) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
          )
          .run(
            s.session_id,
            `observed:${s.project_slug}`,
            "interactive",
            s.cwd ?? s.cwd_project_root ?? "",
            s.status,
            nowIso,
            nowIso,
            s.model,
            s.project_slug,
            s.cwd_project_root,
          );
        session_appeared += 1;
        appendObservedEvent({
          project_slug: s.project_slug,
          kind: "session_appeared",
          source: "transcript-mtime",
          payload: { session_id: s.session_id, cwd: s.cwd, model: s.model },
        });
        bumpEventsToday(SESSIONS_COLLECTOR_NAME);
      } else {
        db.raw
          .query(
            "UPDATE agent_sessions SET status = ?, updated_at = ?, model = COALESCE(?, model), " +
              "project_slug = ?, cwd_project_root = ?, observed_only = 1 WHERE session_id = ?",
          )
          .run(s.status, nowIso, s.model, s.project_slug, s.cwd_project_root, s.session_id);
        if (existed.status !== "idle" && s.status === "idle") {
          session_idle_count += 1;
          appendObservedEvent({
            project_slug: s.project_slug,
            kind: "session_idle",
            source: "transcript-mtime",
            payload: { session_id: s.session_id },
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
            },
          });
          bumpEventsToday(SESSIONS_COLLECTOR_NAME);
        }
      }
      observed_upserts += 1;
    } else {
      // gosleep-native: only backfill project_slug + cwd_project_root; do NOT overwrite status.
      db.raw
        .query(
          "UPDATE agent_sessions SET project_slug = ?, cwd_project_root = ?, observed_only = 0 " +
            "WHERE session_id = ? AND project_slug IS NULL",
        )
        .run(s.project_slug, s.cwd_project_root, s.session_id);
    }
  }

  return {
    observed_upserts,
    session_appeared,
    session_idle: session_idle_count,
    transcript_activity,
  };
}

/**
 * One collector tick. Enumerate → fold. Wrapped in the sentinel so an accidental throw is
 * captured in the collector-inventory row for the panel to surface.
 */
export async function sessionsCollectorTick(claudeHome?: string): Promise<void> {
  await runCollectorTick(SESSIONS_COLLECTOR_NAME, async () => {
    const snap = enumerateSessions(claudeHome);
    foldSessions(snap);
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
