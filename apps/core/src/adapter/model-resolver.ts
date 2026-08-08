// @gosleep/core — model resolver (GSL-290).
//
// `claude agents --json` (see `packages/runner-adapter/src/claude-code.ts`) does NOT surface
// each session's model — the CLI contract only carries session_id / name / cwd / pid / kind /
// status / startedAt. The web Fleet cards want a model label per card; the honest source is
// the Claude Code settings hierarchy the CLI itself reads:
//
//   1. `<cwd>/.claude/settings.local.json` — session/project override (highest precedence).
//   2. `<cwd>/.claude/settings.json`       — project-shared default.
//   3. `$HOME/.claude/settings.json`       — user global default.
//
// Each file may declare the model at either the top-level `"model"` field OR inside `env`
// as `CLAUDE_MODEL` / `ANTHROPIC_MODEL`. First non-empty string wins; nothing found returns
// null and the Fleet card renders an explicit "unknown" pill (never fabricate a model).
//
// The resolver is PURE (given a cwd + HOME) so unit tests fully cover it. The fleet-poll
// worker calls it per session per tick, hitting a small in-process cache keyed on `<cwd>|<home>`
// so a stable file is read once per tick — the file is tiny (<2 KB) and the cache TTL is one
// poll interval (invalidated at the top of every reconcile). Cache misses degrade gracefully
// on I/O errors (missing/unreadable file → treat as unset).

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

/**
 * Per-tick cache. `startTick()` clears the map; the resolver is called once per session per
 * tick and reads at most one file per fresh cwd. Kept module-level (not per-worker) because
 * the process is single-instance; the fleet-poll worker owns the whole cache's lifetime.
 */
class ModelCache {
  private cache = new Map<string, string | null>();

  startTick(): void {
    this.cache.clear();
  }

  get(cwd: string, opts: ResolveModelOptions = {}): string | null {
    const key = `${cwd}|${opts.home ?? homedir()}`;
    if (this.cache.has(key)) {
      return this.cache.get(key) ?? null;
    }
    const model = resolveModelForCwd(cwd, opts);
    this.cache.set(key, model);
    return model;
  }
}

export const modelCache = new ModelCache();
