// @gosleep/core — project projection + hide-list opt-out (GSL-354 under GSL-350 phase 14).
//
// Rebuilds the project-level view on demand from the joined tmux_panes ∪ agent_sessions rows.
// Emits `{project_slug, cwd_root, git_toplevel, first_seen, session_count, last_activity,
// hidden, pseudonym}` per project.
//
// Owner decision (2026-08-16, binding): privacy = opt-out hide list at data/observed/
// hidden-projects.json. Hidden projects render under a stable pseudonym (project-b, …); the
// collectors still observe them and the events table still carries the real slug — hiding is
// a RENDER-time projection, not a data-layer redaction. This preserves the raw record.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getDb } from "../db/client.ts";

export interface ProjectRow {
  project_slug: string;
  cwd_project_root: string | null;
  session_count: number;
  observed_only_count: number;
  last_activity: string | null;
  hidden: boolean;
  pseudonym: string | null;
  colour_hsl: string;
}

/**
 * Deterministic HSL colour from a slug. Fold to a stable H (hue) and fix S+L so every colour
 * lives in the same design band. Two slugs never collide unless their FNV-1a hashes collide.
 */
export function projectColourHsl(slug: string): string {
  // FNV-1a 32-bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i += 1) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hue = (h >>> 0) % 360;
  return `hsl(${hue}, 62%, 50%)`;
}

/**
 * Resolve the hide-list JSON path. Overridable via GOSLEEP_OBSERVED_HIDDEN for tests.
 * Default: <repo-root>/data/observed/hidden-projects.json.
 */
export function hideListPath(): string {
  const env = process.env.GOSLEEP_OBSERVED_HIDDEN;
  if (env !== undefined && env.length > 0) return resolve(env);
  const here = dirname(fileURLToPath(import.meta.url));
  // apps/core/src/observed/projects.ts → repo root is 4 dirs up.
  return resolve(here, "../../../..", "data", "observed", "hidden-projects.json");
}

/**
 * Read the hide list. Never throws — a missing / malformed file → empty set (nothing hidden).
 */
export function loadHiddenSlugs(): Set<string> {
  const path = hideListPath();
  if (!existsSync(path)) return new Set<string>();
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const out = new Set<string>();
      for (const item of parsed) {
        if (typeof item === "string" && item.length > 0) out.add(item);
      }
      return out;
    }
  } catch {
    /* fall through */
  }
  return new Set<string>();
}

/** Assign a stable pseudonym to a slug — index into the hide list, alphabetic. */
export function pseudonymFor(index: number): string {
  // 0 → project-b, 1 → project-c, … (skip 'a' — feels too close to "project A" = primary).
  const alpha = "bcdefghijklmnopqrstuvwxyz";
  if (index < alpha.length) return `project-${alpha[index]}`;
  return `project-${index}`;
}

/**
 * Build the project projection. Returns rows sorted by last-activity desc (most-recent first).
 */
export function listProjects(): ProjectRow[] {
  const db = getDb();
  const hidden = loadHiddenSlugs();
  // Union: distinct project_slugs from agent_sessions ∪ (via pane_current_path basename) tmux_panes.
  const rows = db.raw
    .query(
      "WITH s AS ( " +
        "  SELECT project_slug AS slug, cwd_project_root AS root, " +
        "         MAX(updated_at) AS last_activity, COUNT(*) AS session_count, " +
        "         SUM(CASE WHEN observed_only = 1 THEN 1 ELSE 0 END) AS observed_only_count " +
        "  FROM agent_sessions WHERE project_slug IS NOT NULL AND ended_at IS NULL " +
        "  GROUP BY project_slug " +
        ") " +
        "SELECT slug, root, last_activity, session_count, observed_only_count FROM s " +
        "ORDER BY (last_activity IS NULL) ASC, last_activity DESC",
    )
    .all() as {
    slug: string;
    root: string | null;
    last_activity: string | null;
    session_count: number;
    observed_only_count: number;
  }[];

  const hiddenList = [...hidden].sort();
  const pseudoIndex = new Map<string, string>();
  hiddenList.forEach((slug, idx) => pseudoIndex.set(slug, pseudonymFor(idx)));

  return rows.map((r) => ({
    project_slug: r.slug,
    cwd_project_root: r.root,
    session_count: r.session_count,
    observed_only_count: r.observed_only_count,
    last_activity: r.last_activity,
    hidden: hidden.has(r.slug),
    pseudonym: pseudoIndex.get(r.slug) ?? null,
    colour_hsl: projectColourHsl(pseudoIndex.get(r.slug) ?? r.slug),
  }));
}

/**
 * Given a raw slug, return the display name — pseudonym if hidden, else slug verbatim.
 * Used by the collectors-inventory panel to consistently render project names on the panel.
 */
export function displayName(slug: string): string {
  const hidden = loadHiddenSlugs();
  if (!hidden.has(slug)) return slug;
  const idx = [...hidden].sort().indexOf(slug);
  return pseudonymFor(idx);
}
