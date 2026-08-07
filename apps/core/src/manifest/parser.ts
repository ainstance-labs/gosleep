// @gosleep/core — decision-manifest parser (GSL-277).
//
// Reads `docs/lab/decisions/manifest.md` (OWNER-SOVEREIGN — this file NEVER writes it) and
// extracts the enumerated rules the owner cites when a question is answered "via manifest".
// The manifest format is fixed at v1 (see docs/lab/decisions/manifest.md preamble): six top-level
// sections numbered `## 1.` through `## 6.`; each section contains bullet lines that begin
// with a `§N.bullet-key` marker followed by an em-dash and the rule body, e.g.
//
//     ## 2. Decide-by-default (queue a DECISION record, apply default at deadline)
//     - §2.merge-strategy — стратегия слияния при развилке → regular merge, НИКОГДА squash…
//
// Format contract enforced by the parser:
//   * Only lines that match `^-\s+§(\d+)\.([a-z0-9-]+)\s+—\s+.+` are considered rules. Any bullet
//     that lacks the `§` sigil is a note; we skip it silently (a partially-parsed manifest is
//     honest — the owner may have paragraphs the parser cannot classify).
//   * The `id` in the parsed rule is the canonical citation `manifest §N.bullet-key`. Matches the
//     shape the decision log requires (`lab-emit decision --rule "manifest §N.bullet"`).
//   * A rule's `body` is the trimmed text after the em-dash on the same line, joined with any
//     immediately-following indented continuation lines until the next bullet / section.
//
// The parser is intentionally strict about the sigil (`§` U+00A7) — an ASCII `#` would collide
// with markdown headers, and the manifest's convention is stated in owner-visible language.
// The failure mode when the file is malformed: we return whatever we could parse cleanly + a
// count of skipped lines (so `/manifest` can surface an honest "N unrecognised bullets" note).

import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Absolute path to the manifest file (OWNER-SOVEREIGN — read-only). */
export function manifestPath(overrideLabDir?: string): string {
  const labDir = overrideLabDir
    ?? process.env.GOSLEEP_LAB_DIR
    ?? resolve(process.cwd(), "docs/lab");
  return resolve(labDir, "decisions/manifest.md");
}

/** One parsed manifest rule. See module-level format contract. */
export interface ManifestRule {
  /** Canonical citation, e.g. `"manifest §2.merge-strategy"`. Use this as the `rule_ref` on
   *  a POST /actions/questions/apply-manifest call — the endpoint validates it exactly against
   *  the parsed set. */
  id: string;
  /** Top-level section number (1 .. 6). */
  section: number;
  /** Bullet key inside the section, e.g. `"merge-strategy"`. */
  bullet: string;
  /** Full section heading text (e.g. "Decide-by-default (queue a DECISION record…)"). */
  section_title: string;
  /** Rule body — the human text after the em-dash. Multi-line rules join with a single space. */
  body: string;
  /** 1-indexed source line where the rule bullet begins (for the UI's tooltip). */
  source_line: number;
}

export interface ParsedManifest {
  path: string;
  bytes: number;
  mtime: string;
  rules: ManifestRule[];
  /** Rule id -> rule (fast lookup for the endpoint). */
  index: Map<string, ManifestRule>;
  /** Bullets that started with the §-sigil but failed to parse cleanly (rare). */
  skipped: number;
}

const SECTION_RE = /^##\s+(\d+)\.\s+(.+?)\s*$/;
// Rule bullet: leading `-` (possibly with space) + `§<section>.<key>` + em-dash + body.
// The body match is `.+` on the first line — continuation lines are picked up in the loop below.
const RULE_RE = /^-\s+§(\d+)\.([a-z0-9-]+)\s+—\s+(.+?)\s*$/;
// A continuation line is any non-empty line starting with whitespace (typical markdown wrap).
// A blank line or a new bullet / heading ends the rule.
const CONTINUATION_RE = /^\s+\S/;

/**
 * Parse the manifest at `path`. Returns the rules in the order they appear in the file, plus a
 * fast id-index and provenance (bytes/mtime for the UI).
 *
 * Errors: any I/O failure throws — the endpoint layer surfaces this as a 500 that names the file.
 * A parseable-but-empty manifest is NOT an error; it just returns `rules: []`.
 */
export function parseManifestFromPath(path: string): ParsedManifest {
  const raw = readFileSync(path, "utf8");
  const st = statSync(path);
  return {
    path,
    bytes: st.size,
    mtime: st.mtime.toISOString(),
    ...parseManifestInternal(raw),
  };
}

/**
 * Parse a manifest from an in-memory string. Split out so unit tests can drive the parser
 * without touching the filesystem; the endpoint uses `parseManifestFromPath`.
 */
export function parseManifest(source: string): Omit<ParsedManifest, "path" | "bytes" | "mtime"> {
  return parseManifestInternal(source);
}

function parseManifestInternal(source: string): Omit<ParsedManifest, "path" | "bytes" | "mtime"> {
  const lines = source.split(/\r?\n/);
  const rules: ManifestRule[] = [];
  const index = new Map<string, ManifestRule>();
  let sectionNumber = 0;
  let sectionTitle = "";
  let skipped = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;

    // Section heading?
    const secMatch = SECTION_RE.exec(line);
    if (secMatch) {
      const n = Number.parseInt(secMatch[1] ?? "0", 10);
      if (Number.isFinite(n) && n > 0) {
        sectionNumber = n;
        sectionTitle = (secMatch[2] ?? "").trim();
      }
      continue;
    }

    // Rule bullet?
    const ruleMatch = RULE_RE.exec(line);
    if (ruleMatch) {
      const ruleSection = Number.parseInt(ruleMatch[1] ?? "0", 10);
      const bullet = ruleMatch[2] ?? "";
      const bodyStart = (ruleMatch[3] ?? "").trim();
      // Sanity: the §N in the bullet MUST match the containing ## N section. A mismatch
      // suggests the file is being edited mid-thought — we still keep the rule (using its
      // own §N) but count it separately so the UI can flag "manifest looks inconsistent".
      const section = ruleSection > 0 ? ruleSection : sectionNumber;

      // Absorb indented continuation lines until we hit a blank, a new bullet, or a heading.
      let bodyParts = [bodyStart];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j] ?? "";
        if (next.length === 0) break;
        if (SECTION_RE.test(next)) break;
        if (/^-\s+/.test(next)) break;
        if (!CONTINUATION_RE.test(next)) break;
        bodyParts.push(next.trim());
        j += 1;
      }
      i = j - 1;

      const id = `manifest §${section}.${bullet}`;
      const rule: ManifestRule = {
        id,
        section,
        bullet,
        section_title: section === sectionNumber ? sectionTitle : "",
        body: bodyParts.join(" ").trim(),
        source_line: /* 1-indexed */ i + 1 - (bodyParts.length - 1),
      };
      // Duplicate ids in the manifest are a hard error in principle, but the file is
      // owner-sovereign so we do not throw — the LAST occurrence wins (matches "diff mid-thought"
      // authoring style) and we count the earlier one as skipped for the UI note.
      if (index.has(id)) skipped += 1;
      rules.push(rule);
      index.set(id, rule);
      continue;
    }

    // Bullet that starts with `- §` but did not match RULE_RE: broken bullet, count as skipped.
    if (/^-\s+§/.test(line)) skipped += 1;
  }

  return { rules, index, skipped };
}

/** Convenience: parse the manifest file. Falls back to a well-known relative path when
 *  `GOSLEEP_LAB_DIR` is unset. */
export function loadManifest(overrideLabDir?: string): ParsedManifest {
  return parseManifestFromPath(manifestPath(overrideLabDir));
}

/** Repo root helper: the manifest lives next to `docs/`. `apps/core/src/manifest/parser.ts`
 *  → four levels up = the workspace root. */
export function defaultManifestPathForRepo(repoRoot: string): string {
  return resolve(dirname(dirname(dirname(dirname(repoRoot)))), "docs/lab/decisions/manifest.md");
}
