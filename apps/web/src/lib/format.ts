// @gosleep/web — small formatters (GSL-265).

const REL_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
  ["second", 1],
];

const RTF = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** e.g. "3 minutes ago", "in 2 hours" — always human-relative, no client tz math. */
export function timeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const deltaSec = Math.round((t - now) / 1000);
  const abs = Math.abs(deltaSec);
  for (const [unit, secondsInUnit] of REL_UNITS) {
    if (abs >= secondsInUnit || unit === "second") {
      const value = Math.round(deltaSec / secondsInUnit);
      return RTF.format(value, unit);
    }
  }
  return RTF.format(deltaSec, "second");
}

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** "12:34:56" — local hour/min/sec, safe for repeating timestamps in a list. */
export function timeOfDay(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return TIME_FMT.format(new Date(t));
}

/** e.g. "GSL-265" -> stable palette color hash for pill backgrounds. Deterministic. */
export function hashToHue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

export function shortJson(v: unknown, cap = 120): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > cap ? `${s.slice(0, cap - 1)}…` : s;
}

// -----------------------------------------------------------------------------
// GSL-327 — friendly model label.
//
// Fleet renders `s.model` which arrives from the model-resolver as a raw
// Claude Code model id (`claude-opus-4-8`, `claude-fable-5`,
// `claude-haiku-4-5-20251001`, …). Live-fire E2E run 08 flagged those as
// unreadable ("claude-fable-5" instead of the marketing "Fable 5"). This is a
// pure UI mapper — the resolver stays untouched, the wire shape stays
// untouched, and the raw id is still available on hover via the existing
// `title` attribute.
//
// Rules:
//   - Known-family match on the CANONICAL prefix, so future dated suffixes
//     (`claude-opus-4-7-20260101`) map correctly without a table update.
//   - The two sentinels emitted by the resolver (GSL-321 transcript-first,
//     GSL-325 boot-window fallback) — `"unknown"` and `"starting"` — pass
//     through verbatim. The Fleet already colours them as "no model yet"
//     hints; a friendly label would be actively misleading here.
//   - Unknown ids fall back to a cleaned label (`claude-` prefix stripped +
//     trailing YYYYMMDD suffix stripped + TitleCase), NEVER an empty string
//     or a throw — an unrecognised id must still render something readable.
//   - Empty / whitespace-only input → `"unknown"` so the Fleet's caller pill
//     stays consistent; `null` / `undefined` is left to the call-site
//     (Fleet.tsx renders "model unknown" for those).
// -----------------------------------------------------------------------------

interface ModelFamily {
  /** Canonical prefix — matched with `startsWith` so dated suffixes work. */
  prefix: string;
  /** Human-facing label. */
  label: string;
}

// Ordered longest-prefix-first so `claude-haiku-4-5` wins over a hypothetical
// `claude-haiku-4`. Add new families here, not at the call-sites.
const MODEL_FAMILIES: readonly ModelFamily[] = [
  { prefix: "claude-opus-4-8", label: "Opus 4.8" },
  { prefix: "claude-opus-4-7", label: "Opus 4.7" },
  { prefix: "claude-opus-4-5", label: "Opus 4.5" },
  { prefix: "claude-opus-4-1", label: "Opus 4.1" },
  { prefix: "claude-opus-4", label: "Opus 4" },
  { prefix: "claude-sonnet-5", label: "Sonnet 5" },
  { prefix: "claude-sonnet-4-5", label: "Sonnet 4.5" },
  { prefix: "claude-sonnet-4", label: "Sonnet 4" },
  { prefix: "claude-sonnet-3-7", label: "Sonnet 3.7" },
  { prefix: "claude-fable-5", label: "Fable 5" },
  { prefix: "claude-haiku-4-5", label: "Haiku 4.5" },
  { prefix: "claude-haiku-4", label: "Haiku 4" },
  { prefix: "claude-haiku-3-5", label: "Haiku 3.5" },
];

/** Sentinels emitted by apps/core/src/routes/read.ts model-resolver — leave alone. */
const MODEL_SENTINELS: ReadonlySet<string> = new Set(["unknown", "starting"]);

/** Strip a trailing `-YYYYMMDD` date suffix (Claude Code snapshot suffix). */
function stripDateSuffix(s: string): string {
  return s.replace(/-\d{8}$/, "");
}

/** Best-effort humanisation for an unrecognised model id. */
function fallbackModelLabel(id: string): string {
  const withoutClaude = id.startsWith("claude-") ? id.slice("claude-".length) : id;
  const withoutDate = stripDateSuffix(withoutClaude);
  if (withoutDate.length === 0) return id;
  return withoutDate
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => (part[0] ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

/**
 * Map a raw model id to a friendly UI label.
 *
 * Contract:
 *   - `null` / `undefined` → `"unknown"` (a safe never-empty sentinel; the
 *     Fleet call-site guards these before calling and renders its own copy).
 *   - Empty or whitespace-only input → `"unknown"`.
 *   - Known family → the marketing label (`"Opus 4.8"`, `"Fable 5"`, …).
 *   - `"unknown"` / `"starting"` sentinels → returned verbatim.
 *   - Unknown id → a cleaned fallback label (never breaks the UI).
 */
export function formatModelLabel(id: string | null | undefined): string {
  if (id === null || id === undefined) return "unknown";
  const trimmed = id.trim();
  if (trimmed.length === 0) return "unknown";
  if (MODEL_SENTINELS.has(trimmed)) return trimmed;
  for (const fam of MODEL_FAMILIES) {
    if (trimmed === fam.prefix || trimmed.startsWith(`${fam.prefix}-`)) {
      return fam.label;
    }
  }
  return fallbackModelLabel(trimmed);
}

// -----------------------------------------------------------------------------
// GSL-329 — friendly PR chip label.
//
// GSL-319 shipped the Latest-PR card + Fleet PR chip as clickable anchors
// whose visible text was the FULL URL (e.g.
// `https://github.com/ainstance-labs/gosleep/pull/9`). Live-fire E2E run 08
// flagged that as noisy on a small chip — the convention on other panels is
// the compact `#N`.
//
// Pure URL parser. The anchor's `href` stays the full URL; call-sites keep
// the URL in `title` too so the operator can still copy it.
//
// Rules:
//   - Any URL containing `/pull/N` → `#N`. Works for github.com, forks, and
//     private mirrors — the parser cares about the path shape, not the host.
//   - Query strings, fragments, trailing slashes, whitespace are all
//     tolerated.
//   - Unparseable (bare hostname, empty, garbage, `null`, `undefined`) →
//     `"PR"`. Never the raw URL (that would defeat the whole point).
// -----------------------------------------------------------------------------

/**
 * Parse a PR URL into a compact `#N` label.
 *
 * Falls back to the short label `"PR"` when the URL has no `/pull/<digits>`
 * segment — the raw URL is never rendered as the anchor text (call-sites
 * keep it in `href` and `title` for the operator's clipboard).
 */
export function formatPrLabel(url: string | null | undefined): string {
  if (url === null || url === undefined) return "PR";
  const trimmed = url.trim();
  if (trimmed.length === 0) return "PR";
  const match = trimmed.match(/\/pull\/(\d+)/);
  if (match !== null && match[1] !== undefined) {
    return `#${match[1]}`;
  }
  return "PR";
}

