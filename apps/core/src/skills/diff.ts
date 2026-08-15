// @gosleep/core — filesystem diff / hash for skill directories (T6, GSL-255 partial).
//
// Consumed by:
//   - GET /skills/:name/diff  — a full diff dump for the details drawer on the Skills screen.
//   - GET /skills             — the enriched projection carries `has_changes` (bool) computed
//                                from the same hashes; row-level indicator on the list.
//
// Semantics:
//   - Local  = `skill/<name>/` under the repo root.
//   - Prod   = `~/.claude/skills/<name>/` (via $HOME).
//   - Hash   = sha256 over `sorted(find <dir> -type f)` where each contribution is the file's
//              relative path + a null byte + the file's bytes. Empty tree hashes to a fixed
//              known sentinel. A missing prod dir hashes to `absent`.
//   - Diff   = `diff -u -r --new-file <prod> <local>` output, truncated to 200 KB with a
//              trailing marker if bounded (plan risk 4).
//
// Cache:
//   - Per-name in-process cache, 5-second TTL. Keys the request-time hash+diff computation
//     off the wall clock; a burst of clicks on the Skills screen shares one filesystem walk.
//   - Hermetic tests override the local + prod roots via optional arguments.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

const EMPTY_TREE_HASH = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const ABSENT_SENTINEL = "absent";

// GSL-174 verifier run 02 M-1: widened to all 12 owned skills. 7 dev copies
// (originals through tmux-agents-orchestration) + 5 orphan-rescued via GSL-334
// (agentic-report-creator, agentic-scenario-runner, efficient-agent-evals,
// extra-usage, verifier-skeptic). Additive only; extend when a new skill is
// added under skill/<name>/ or rescued from the global tree.
const KNOWN_SKILLS = new Set([
  "orchestrating-delivery-agents",
  "delivery-workflow",
  "handoff",
  "using-jira",
  "writing-prds",
  "remote-control",
  "tmux-agents-orchestration",
  "agentic-report-creator",
  "agentic-scenario-runner",
  "efficient-agent-evals",
  "extra-usage",
  "verifier-skeptic",
]);

const DIFF_BYTE_CAP = 200_000;

// -----------------------------------------------------------------------------
// path resolution
// -----------------------------------------------------------------------------

export interface SkillPaths {
  local: string;
  prod: string;
}

export function resolveSkillPaths(
  name: string,
  overrides?: { repoRoot?: string; home?: string },
): SkillPaths {
  const root = overrides?.repoRoot ?? REPO_ROOT;
  const home = overrides?.home ?? process.env.HOME ?? "";
  return {
    local: resolve(root, "skill", name),
    prod: resolve(home, ".claude/skills", name),
  };
}

// -----------------------------------------------------------------------------
// walk + hash
// -----------------------------------------------------------------------------

function walkFiles(rootDir: string): string[] {
  if (!existsSync(rootDir)) return [];
  const out: string[] = [];
  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile()) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

export function hashSkillTree(dir: string): string {
  if (!existsSync(dir)) return ABSENT_SENTINEL;
  const files = walkFiles(dir);
  if (files.length === 0) return EMPTY_TREE_HASH;
  const h = createHash("sha256");
  for (const f of files) {
    const rel = relative(dir, f);
    h.update(rel);
    h.update("\x00");
    try {
      h.update(readFileSync(f));
    } catch {
      // A read failure at hash time is a partial-tree hazard — surface as a distinct hash so
      // has-changes reads TRUE even when both sides fail identically (safer default).
      h.update(`<unreadable:${rel}>`);
    }
    h.update("\x00");
  }
  return `sha256:${h.digest("hex")}`;
}

// -----------------------------------------------------------------------------
// diff via /usr/bin/diff (bounded)
// -----------------------------------------------------------------------------

async function runDiff(prodDir: string, localDir: string): Promise<string> {
  // `diff -u -r --new-file`:
  //   -u          unified format
  //   -r          recurse
  //   --new-file  treat absent files as empty (lets `absent prod` render as "add" not "skip")
  // We do NOT use Bun.spawnSync here — the streaming `Bun.spawn` with a read-all is cheaper on
  // large diffs because we can early-exit once we hit the byte cap.
  const proc = Bun.spawn({
    cmd: ["diff", "-u", "-r", "--new-file", prodDir, localDir],
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderrText] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  if (stdout.length <= DIFF_BYTE_CAP) {
    return stdout;
  }
  const truncated = stdout.slice(0, DIFF_BYTE_CAP);
  return `${truncated}\n\n[diff truncated at ${DIFF_BYTE_CAP} bytes — ${stdout.length - DIFF_BYTE_CAP} bytes elided; full diff via CLI: diff -u -r ${prodDir} ${localDir}]${stderrText.length > 0 ? `\n\n[diff stderr: ${stderrText}]` : ""}`;
}

// -----------------------------------------------------------------------------
// cache
// -----------------------------------------------------------------------------

interface CachedResult {
  computedAt: number;
  result: SkillDiffResult;
}

const CACHE_TTL_MS = 5_000;
const cache = new Map<string, CachedResult>();

function cacheKey(name: string, paths: SkillPaths): string {
  return `${name}|${paths.local}|${paths.prod}`;
}

// -----------------------------------------------------------------------------
// public result shape
// -----------------------------------------------------------------------------

export interface SkillDiffResult {
  name: string;
  localExists: boolean;
  prodExists: boolean;
  hashLocal: string;
  hashProd: string;
  hasChanges: boolean;
  diffBytes: number;
  diffText: string;
  computedAt: string;
  truncated: boolean;
}

export interface ComputeOptions {
  overrides?: { repoRoot?: string; home?: string };
  skipCache?: boolean;
}

export async function computeSkillDiff(
  name: string,
  opts: ComputeOptions = {},
): Promise<SkillDiffResult> {
  const paths = resolveSkillPaths(name, opts.overrides);
  const key = cacheKey(name, paths);
  const now = Date.now();
  const cached = cache.get(key);
  if (!opts.skipCache && cached && now - cached.computedAt < CACHE_TTL_MS) {
    return cached.result;
  }
  const localExists = existsSync(paths.local);
  const prodExists = existsSync(paths.prod);
  const hashLocal = hashSkillTree(paths.local);
  const hashProd = hashSkillTree(paths.prod);
  const diffText = localExists || prodExists ? await runDiff(paths.prod, paths.local) : "";
  const truncated = diffText.includes("[diff truncated at ");
  const result: SkillDiffResult = {
    name,
    localExists,
    prodExists,
    hashLocal,
    hashProd,
    hasChanges: hashLocal !== hashProd,
    diffBytes: diffText.length,
    diffText,
    computedAt: new Date(now).toISOString(),
    truncated,
  };
  cache.set(key, { computedAt: now, result });
  return result;
}

/**
 * Cheap per-skill "has changes?" check for the list-view enrichment. Reuses the cache but
 * skips the diff computation entirely — only the two hashes are needed.
 */
export function quickHasChanges(
  name: string,
  overrides?: { repoRoot?: string; home?: string },
): { hasChanges: boolean; hashLocal: string; hashProd: string; localExists: boolean; prodExists: boolean } {
  const paths = resolveSkillPaths(name, overrides);
  const key = cacheKey(name, paths);
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && now - cached.computedAt < CACHE_TTL_MS) {
    return {
      hasChanges: cached.result.hasChanges,
      hashLocal: cached.result.hashLocal,
      hashProd: cached.result.hashProd,
      localExists: cached.result.localExists,
      prodExists: cached.result.prodExists,
    };
  }
  const localExists = existsSync(paths.local);
  const prodExists = existsSync(paths.prod);
  const hashLocal = hashSkillTree(paths.local);
  const hashProd = hashSkillTree(paths.prod);
  return {
    hasChanges: hashLocal !== hashProd,
    hashLocal,
    hashProd,
    localExists,
    prodExists,
  };
}

/**
 * Test-only helper — drop the whole cache. Used by unit tests to bypass the 5-second TTL.
 */
export function clearSkillDiffCache(): void {
  cache.clear();
}

// Re-exported for external consumers (tests + record-publish.ts).
export { KNOWN_SKILLS };
