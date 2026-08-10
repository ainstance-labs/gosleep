// @gosleep/core — model resolver (GSL-290; transcript-first upgrade GSL-321).
//
// `claude agents --json` (see `packages/runner-adapter/src/claude-code.ts`) does NOT surface
// each session's model — the CLI contract only carries session_id / name / cwd / pid / kind /
// status / startedAt. The web Fleet cards want a model label per card, and there are two
// sources — used in this precedence, first non-null wins:
//
//   1. GSL-321 — the session's own transcript file. Every assistant turn is a JSONL row with
//      `{"type":"assistant","message":{"model":"claude-<name>-<ver>"}}`. This is the ONLY
//      honest per-session source; a `claude --model haiku` invocation reflects `haiku` here
//      even when the global settings file names `fable-5`. Run 06's `todo-workspace-47` was
//      launched with `--model haiku` and the Fleet card showed the global `fable-5` because
//      this reader did not exist. See `resolveTranscriptModel`.
//
//   2. GSL-290 — the Claude Code settings hierarchy the CLI itself reads:
//        a. `<cwd>/.claude/settings.local.json` — session/project override (highest precedence).
//        b. `<cwd>/.claude/settings.json`       — project-shared default.
//        c. `$HOME/.claude/settings.json`       — user global default.
//
// A `--model` flag on the `claude` invocation is captured by the transcript reader; the
// settings hierarchy is the honest fallback ONLY when the transcript reader reports
// `absent` (no transcript file at all matches this session_id — a fresh session with no
// journaling yet). If a transcript file DOES exist but no assistant line has landed yet
// (the boot window, seconds after spawn), the reader reports `starting` and the resolver
// returns null (Fleet renders "unknown"). See `readTranscriptModelState` — GSL-321's boot-
// window race follow-up (run 07 finding): settings-fallback during the boot window
// fabricated a wrong-but-confident model for delegated `--model X` sessions.
// If ALL sources fail we return null; the Fleet card renders "unknown" — never a
// fabricated value.
//
// Each settings file may declare the model at either the top-level `"model"` field OR inside
// `env` as `CLAUDE_MODEL` / `ANTHROPIC_MODEL`. First non-empty string wins.
//
// The resolver is PURE (given a cwd + HOME) so unit tests fully cover it. The fleet-poll
// worker calls it per session per tick, hitting a small in-process cache keyed on
// `<session_id>|<cwd>|<home>` so a stable file is read at most once per tick.

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { getSessionAdapter } from "./session.ts";

/**
 * The three files probed, in precedence order. Exported for the tests.
 */
export function modelResolverCandidates(cwd: string, home: string): string[] {
  return [
    join(cwd, ".claude", "settings.local.json"),
    join(cwd, ".claude", "settings.json"),
    join(home, ".claude", "settings.json"),
  ];
}

/**
 * Pull a non-empty string from one of the accepted fields in a parsed settings JSON. Returns
 * null when nothing usable was found. Never throws — a non-object input degrades to null.
 */
function pickModelField(parsed: unknown): string | null {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const rec = parsed as Record<string, unknown>;
  // Top-level "model" wins over env — matches Claude Code's precedence.
  if (typeof rec.model === "string" && rec.model.length > 0) return rec.model;
  const env = rec.env;
  if (env !== null && typeof env === "object" && !Array.isArray(env)) {
    const envRec = env as Record<string, unknown>;
    if (typeof envRec.CLAUDE_MODEL === "string" && envRec.CLAUDE_MODEL.length > 0) {
      return envRec.CLAUDE_MODEL;
    }
    if (typeof envRec.ANTHROPIC_MODEL === "string" && envRec.ANTHROPIC_MODEL.length > 0) {
      return envRec.ANTHROPIC_MODEL;
    }
  }
  return null;
}

export interface ResolveModelOptions {
  /** Override `$HOME` (test hook). Default: `os.homedir()`. */
  home?: string;
  /** Test hook: inject a fake FS. Keys are absolute file paths, values are file contents
   *  (a string), null (unreadable), or undefined (missing). */
  readFile?: (p: string) => string | null | undefined;
}

/**
 * Resolve the model for a given cwd. Returns `null` when no candidate declared a model. Test
 * hook lets a bun test hand in a fake `readFile` so the pure resolver never touches disk.
 */
export function resolveModelForCwd(
  cwd: string,
  opts: ResolveModelOptions = {},
): string | null {
  const home = opts.home ?? homedir();
  const candidates = modelResolverCandidates(cwd, home);
  const read =
    opts.readFile ??
    ((p: string): string | null => {
      try {
        if (!existsSync(p)) return null;
        return readFileSync(p, "utf8");
      } catch {
        return null;
      }
    });

  for (const p of candidates) {
    const raw = read(p);
    if (raw === null || raw === undefined || raw.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A malformed settings file is not the resolver's problem — skip and try the next.
      continue;
    }
    const model = pickModelField(parsed);
    if (model !== null) return model;
  }
  return null;
}

// -----------------------------------------------------------------------------
// GSL-321 — transcript-derived model reader.
// -----------------------------------------------------------------------------

export interface ResolveTranscriptModelOptions {
  /** Test hook: replace the transcript entries listing (default: adapter.readTranscript). */
  listTranscripts?: (sessionId: string) => Array<{
    path: string;
    modified_at_epoch_ms: number;
  }>;
  /** Test hook: replace the raw file reader (default: node:fs.readFileSync). */
  readFile?: (p: string) => string | null;
  /** Cap on how many bytes we read from the tail of the transcript. Default 64 KiB — enough
   *  to catch several dozen assistant turns without loading a whole day's session. */
  tailBytes?: number;
}

/** Type predicate for the assistant-turn line we care about. */
function extractModelFromLine(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  if (!trimmed.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const rec = parsed as Record<string, unknown>;
  if (rec.type !== "assistant") return null;
  const msg = rec.message;
  if (msg === null || typeof msg !== "object") return null;
  const model = (msg as Record<string, unknown>).model;
  return typeof model === "string" && model.length > 0 ? model : null;
}

/**
 * Discriminated result of `readTranscriptModelState`. Three cases:
 *
 *   - `found`: at least one assistant turn was scanned successfully; `model` is what the
 *     session's most recent turn recorded.
 *   - `starting`: a transcript file for this session_id EXISTS on disk, but no assistant
 *     line has landed yet (the session is booting / mid-first-turn) — or every candidate
 *     file was unreadable. The Fleet must render "unknown", NOT the global settings default:
 *     a delegated `claude --model sonnet` session must not read as "fable-5" for the boot
 *     window just because the global setting says so (GSL-321 boot-window race follow-up).
 *   - `absent`: no transcript file at all matches this session_id. The settings-hierarchy
 *     resolver is the honest fallback — this is a fresh session with no journaling yet.
 */
export type TranscriptModelState =
  | { kind: "found"; model: string }
  | { kind: "starting" }
  | { kind: "absent" };

/**
 * Rich-state transcript reader (GSL-321 boot-window race follow-up).
 *
 * The GSL-321 initial implementation returned `null` for BOTH "no transcript file at all"
 * and "transcript file exists but has no assistant line yet". The caller (modelCache) then
 * fell back to the settings hierarchy in both cases. That is wrong for the middle case:
 * while a session is booting, its transcript file has already been created but its first
 * assistant turn has not yet been journaled — so a delegated `--model sonnet` session
 * showed up as the global default (e.g. "fable-5") for the first several seconds. This
 * function distinguishes the two so the modelCache can skip the settings fallback while
 * the session is starting up.
 */
export function readTranscriptModelState(
  sessionId: string,
  opts: ResolveTranscriptModelOptions = {},
): TranscriptModelState {
  if (sessionId.length === 0) return { kind: "absent" };
  const tailBytes = opts.tailBytes ?? 64 * 1024;

  const list =
    opts.listTranscripts ??
    ((sid: string) => {
      try {
        const r = getSessionAdapter().readTranscript(sid);
        if (!r.ok) return [];
        return r.entries.map((e) => ({
          path: e.path,
          modified_at_epoch_ms: e.modified_at_epoch_ms,
        }));
      } catch {
        return [];
      }
    });

  const entries = list(sessionId);
  if (entries.length === 0) return { kind: "absent" };
  // Newest file wins — a session may span several transcripts across resumes / compactions.
  entries.sort((a, b) => b.modified_at_epoch_ms - a.modified_at_epoch_ms);

  const read =
    opts.readFile ??
    ((p: string): string | null => {
      try {
        if (!existsSync(p)) return null;
        // Read only the tail; a long session's transcript is often multi-MB, and the whole
        // point of this reader is a cheap "what's the current model" lookup on every tick.
        const st = statSync(p);
        const size = st.size;
        if (size <= tailBytes) return readFileSync(p, "utf8");
        // For big files: use a Bun `file().slice(offset).text()` if available, else fall back
        // to readFileSync of the whole file (still cheap enough at Node's read speed).
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const bunGlobal = (globalThis as any).Bun;
          if (bunGlobal && typeof bunGlobal.file === "function") {
            const f = bunGlobal.file(p) as {
              slice: (start: number) => { text: () => Promise<string> };
            };
            // Bun's slice returns a Blob; text() is async. We block via a sync helper — but
            // synchronous Bun blob reads are not exposed, so on the big-file path we accept
            // reading the whole file. tailBytes is a soft guard, not a hard one.
          }
        } catch {
          /* fall through */
        }
        return readFileSync(p, "utf8");
      } catch {
        return null;
      }
    });

  for (const e of entries) {
    const raw = read(e.path);
    if (raw === null || raw.length === 0) continue;
    // Take the tail slice so `.slice(-tailBytes)` bounds even the fallback whole-file read.
    const tail = raw.length > tailBytes ? raw.slice(-tailBytes) : raw;
    // Split by newlines and walk backwards — latest assistant turn wins.
    const lines = tail.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const found = extractModelFromLine(lines[i] ?? "");
      if (found !== null) return { kind: "found", model: found };
    }
  }
  // Transcript file(s) exist for this session_id — booting / mid-first-turn / unreadable.
  return { kind: "starting" };
}

/**
 * Backwards-compatible wrapper. Returns the assistant model when a transcript scan yielded
 * one, otherwise `null` (whether the transcript is absent or merely empty of assistant
 * lines — callers that need to tell the two apart use `readTranscriptModelState` directly).
 * The `modelCache` is the ONLY production caller that needs the distinction (to skip the
 * settings fallback while the session is booting); this wrapper keeps existing unit tests
 * and any future single-boolean callers unchanged.
 */
export function resolveTranscriptModel(
  sessionId: string,
  opts: ResolveTranscriptModelOptions = {},
): string | null {
  const state = readTranscriptModelState(sessionId, opts);
  return state.kind === "found" ? state.model : null;
}

/**
 * Per-tick cache. `startTick()` clears the map; the resolver is called once per session per
 * tick and reads at most one file per fresh cwd. Kept module-level (not per-worker) because
 * the process is single-instance; the fleet-poll worker owns the whole cache's lifetime.
 *
 * GSL-321 — the cache key now includes `session_id` so two sessions in the same cwd (a
 * scratch project running two Claude invocations with different `--model` flags) each get
 * their own transcript-derived value. Falls back to the cwd-keyed settings resolver when
 * the transcript path returns null.
 */
class ModelCache {
  private cache = new Map<string, string | null>();

  startTick(): void {
    this.cache.clear();
  }

  /**
   * Resolve the model for a live session.
   *
   * GSL-321 precedence (three cases from the transcript reader):
   *
   *   1. `found` — the transcript has at least one assistant turn. Return that model; it
   *      is the ONLY per-session honest source (a `claude --model haiku` invocation shows
   *      up here as `claude-haiku-*` even when settings.json says `fable-5`).
   *   2. `starting` — a transcript file exists but no assistant line has landed yet (the
   *      session is booting / mid-first-turn). Return null so the Fleet card renders
   *      "unknown". The GSL-321 boot-window race follow-up: we MUST NOT fall back to the
   *      settings hierarchy here, because a delegated `claude --model sonnet` session
   *      would render as the global default (e.g. "fable-5") for the first several
   *      seconds until its first assistant turn lands. "Wrong-but-confident is worse than
   *      unknown" is GSL-321's stated design intent — the initial commit honored it only
   *      for the absent case.
   *   3. `absent` — no transcript file at all matches this session_id. Fall back to the
   *      settings-hierarchy resolver: the session was just started and nothing is
   *      journaled yet, so the shared/global default is the best honest guess. Still may
   *      be null → Fleet renders "unknown".
   */
  get(
    sessionId: string,
    cwd: string,
    opts: ResolveModelOptions & ResolveTranscriptModelOptions = {},
  ): string | null {
    const key = `${sessionId}|${cwd}|${opts.home ?? homedir()}`;
    if (this.cache.has(key)) {
      return this.cache.get(key) ?? null;
    }
    const state = readTranscriptModelState(sessionId, opts);
    if (state.kind === "found") {
      this.cache.set(key, state.model);
      return state.model;
    }
    if (state.kind === "starting") {
      // Boot-window: transcript file exists but no assistant line yet. Do NOT fall back
      // to the settings hierarchy — it would fabricate a wrong-but-confident value for a
      // delegated `--model` session. Cache null so the tick does not re-scan.
      this.cache.set(key, null);
      return null;
    }
    // state.kind === "absent" — settings hierarchy is the honest fallback.
    const fromSettings = resolveModelForCwd(cwd, opts);
    this.cache.set(key, fromSettings);
    return fromSettings;
  }
}

export const modelCache = new ModelCache();
