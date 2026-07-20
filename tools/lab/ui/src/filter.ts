// =============================================================================
// The client-side filter (PRD R5.3: "клиентский JS-фильтр по встроенному JSON").
//
// Imported by BOTH sides, like countdown.ts: the screens build the index at build time and render the
// controls from it; the client bundle reads the SAME index back out of the page and narrows the rows.
// One shape, two consumers, no drift — the bundle's argument, one layer down.
//
// ── Why the data is INLINE, and not fetched ───────────────────────────────────────────────────────
// The dashboard's whole promise is that it opens from `file://` on a plane and from a private GitHub
// blob view on a phone. `fetch()` of a sibling file under `file://` is blocked by CORS, so a filter
// that asks the network for its data is a filter that is dead exactly where the page has to work. The
// dataset is a few hundred rows. It travels in a <script type="application/json"> island, the same
// vehicle the staleness verdicts already ride in.
//
// ── The filter NARROWS; it does not render ────────────────────────────────────────────────────────
// Every row is already in the HTML, written at build time. The client only sets `hidden` on the rows
// that fall out. So with JS off the page is not a blank shell awaiting hydration — it is the whole
// list, which is precisely what the reader wanted, minus a control that would not have worked anyway.
// (The control ships `hidden` and the client un-hides it: a dead <select> the reader can move but
// which changes nothing is worse than no <select> at all.)
//
// ── A FILTER MAY NOT HIDE SILENTLY ───────────────────────────────────────────────────────────────
// This is the rule the whole file exists for. A dashboard sitting under a filter somebody forgot
// looks exactly like a quiet night: empty. Phase 4 spent itself removing three ways this laboratory
// lied about its own emptiness, and a filter is a fourth one waiting to happen. So the count sentence
// is not decoration — it is the safety rail, and `countSentence` is written so that the moment even
// ONE row is hidden, the page says so, in words, in the reader's line of sight.
//
// For the same reason the filter is NOT persisted — no localStorage, no URL hash. It resets on every
// open. A filter that survives a reload is the forgotten-filter trap with a memory: the owner opens
// the page tomorrow and reads last week's narrow slice as tonight's whole night. Every open of this
// page starts by showing everything.
// =============================================================================

/** One rendered row's filterable values. Keyed by facet: `{actor: "impl-ui-4", severity: "info", …}`. */
export type FilterRow = Record<string, string>;

export interface FilterFacet {
  /** Matches a `<select data-facet="…">` and a key in every FilterRow. */
  key: string;
  label: string;
  /** The option list. Built from the rows themselves, so a facet can only ever offer values that exist. */
  values: string[];
}

export interface FilterIndex {
  /** `rows[i]` describes `<tr data-row="i">`. The index IS the join key — see matchesFilter. */
  rows: FilterRow[];
  facets: FilterFacet[];
  /** Row keys a free-text box searches (case-insensitive substring). Empty = no text box. */
  search: string[];
  /** How many rows were rendered. NOT how many exist on disk — the screens say that separately. */
  total: number;
}

/**
 * Does this row survive the active filter?
 *
 * `row === undefined` means the island and the DOM disagree about how many rows there are — a bug, and
 * one we cannot fix from here. It returns TRUE: the row STAYS. Fail-open is not politeness, it is the
 * only safe direction. Showing a row the reader did not ask for is a visible surprise he can see and
 * dismiss; hiding a row he did ask for is an invisible subtraction from a feed he is reading to decide
 * whether anything broke tonight. If those two errors are ever weighed against each other again, weigh
 * them the same way.
 */
export function matchesFilter(
  row: FilterRow | undefined,
  active: Record<string, string>,
  search: string[],
  query: string,
): boolean {
  if (row === undefined) return true; // ← fail-open. See above.

  for (const [key, want] of Object.entries(active)) {
    if (want !== "" && row[key] !== want) return false;
  }

  const q = query.trim().toLowerCase();
  if (q !== "" && search.length > 0) {
    const hay = search.map((k) => row[k] ?? "").join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** Distinct values of one facet, in the order they first appear — no invented options, ever. */
export function facetValues(rows: FilterRow[], key: string): string[] {
  const seen: string[] = [];
  for (const r of rows) {
    const v = r[key] ?? "";
    if (v !== "" && !seen.includes(v)) seen.push(v);
  }
  return seen;
}

/**
 * What the page says about what it is not showing. The one sentence that keeps a filter honest.
 *
 * Server-rendered as `all N shown` (nothing is hidden before a script runs), then rewritten by the
 * client on every change. The zero case gets its own sentence on purpose: `0 of 47` printed above an
 * empty table is the exact silhouette of a dead night, and the reader must be told, in words, that the
 * emptiness is HIS filter and not the laboratory's.
 */
export function countSentence(shown: number, total: number): string {
  if (total === 0) return "no rows to filter";
  if (shown >= total) return `all ${total} shown`;
  if (shown === 0) return `0 of ${total} shown — the filter is hiding every row`;
  return `${shown} of ${total} shown — ${total - shown} hidden by the filter`;
}

/** `filtered` = something is hidden; `none` = everything is. Both are loud in theme.ts, deliberately. */
export function countClass(shown: number, total: number): string {
  if (total === 0 || shown >= total) return "filter-count";
  return shown === 0 ? "filter-count filtered none" : "filter-count filtered";
}
