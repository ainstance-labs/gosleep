// @gosleep/core — DB schema version resolver (GSL-294).
//
// Target-architecture rev 2 §3.4 defines `GET /version.db_schema_version` as a "drizzle-journal
// hash" that pins the DB shape at process boot. The web client can then compare its cached
// version against the current /version response and reload / warn on drift (target-arch §12 R34).
//
// Compute: SHA-256 over
//   1. The exact bytes of `apps/core/drizzle/meta/_journal.json` (canonical order + timestamps).
//   2. Each `NNNN_*.sql` file under `apps/core/drizzle/` in filename-sorted (i.e. migration)
//      order, joined by a single newline separator.
// Return the first 16 hex chars — a short prefix is enough to distinguish releases while
// staying readable in a log line or a URL query. The full 64-hex digest is available via
// `computeDbSchemaVersion({ full: true })` for anyone who wants the extra entropy.
//
// Deterministic + read-only: given the same on-disk files, the hash never changes. No wall-clock,
// no random. This makes it a safe key for cache invalidation.
//
// Failure modes:
//   * Missing directory / journal → returns "unavailable" (never throws). The GET /version
//     handler falls back to "unset" (legacy placeholder) so the panel does not 500.
//   * A migration file unreadable → its slot in the hash carries a synthetic
//     "unreadable:<basename>" line; the overall value still stabilises across restarts as long
//     as the FS layout is stable.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export interface ComputeOptions {
  /** Override the drizzle directory (tests). Defaults to <cwd>/apps/core/drizzle. */
  drizzleDir?: string;
  /** If true, return the full 64-hex digest; otherwise the first 16 hex chars. */
  full?: boolean;
  /** Env override (test hook). */
  envOverride?: string;
}

const DEFAULT_DRIZZLE_DIRS = [
  "apps/core/drizzle",
  "drizzle",
  "../drizzle",
  "../../apps/core/drizzle",
];

/** Locate the drizzle dir relative to cwd, trying a few candidates for smoke/launchd shapes. */
export function resolveDrizzleDir(): string | null {
  for (const rel of DEFAULT_DRIZZLE_DIRS) {
    const abs = resolve(process.cwd(), rel);
    if (existsSync(abs) && existsSync(join(abs, "meta", "_journal.json"))) return abs;
  }
  return null;
}

/**
 * Compute the schema version. Pure w.r.t. its args (given a stable FS + no env override).
 */
export function computeDbSchemaVersion(opts: ComputeOptions = {}): string {
  const envOverride = opts.envOverride ?? process.env.GOSLEEP_DB_SCHEMA_VERSION_OVERRIDE;
  if (envOverride !== undefined && envOverride.length > 0) return envOverride;

  const dir = opts.drizzleDir ?? resolveDrizzleDir();
  if (dir === null) return "unavailable";

  const hasher = createHash("sha256");
  const journalPath = join(dir, "meta", "_journal.json");
  try {
    hasher.update(readFileSync(journalPath));
  } catch {
    return "unavailable";
  }
  hasher.update("\n---\n");

  let entries: string[];
  try {
    entries = readdirSync(dir)
      .filter((n) => /^\d+_.*\.sql$/.test(n))
      .sort();
  } catch {
    return "unavailable";
  }
  for (const name of entries) {
    hasher.update(name);
    hasher.update("\n");
    try {
      hasher.update(readFileSync(join(dir, name)));
    } catch {
      hasher.update(`unreadable:${name}`);
    }
    hasher.update("\n---\n");
  }
  const hex = hasher.digest("hex");
  return opts.full === true ? hex : hex.slice(0, 16);
}

/** Module-scoped memo: computed once on first call so the /version handler stays hot. */
let cached: string | null = null;

/** Public accessor used by the read routes. Never throws. */
export function getDbSchemaVersion(): string {
  if (cached !== null) return cached;
  cached = computeDbSchemaVersion();
  return cached;
}

/** Test hook: reset the memo so a fresh env-override branch runs. */
export function __resetDbSchemaVersionCache(): void {
  cached = null;
}
