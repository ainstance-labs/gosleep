import type { VNode } from "preact";
import type { LibraryEntry, RenderBundle } from "../types.js";
import { Empty, FilterBar, FilterCount } from "../components.js";
import { facetValues, type FilterIndex, type FilterRow } from "../filter.js";

export const LIBRARY_ISLAND = "library-index";
const SCOPE = "library-rows";
const COUNT = "library-count";

interface Row extends LibraryEntry {
  kind: string;
}

/**
 * The cross-index, flattened. ONE table across every kind — which is what a *cross*-index is, and what
 * PRD R5.2 asks for by name. Six separate tables are six lists; the owner looking for "what did we
 * write about the token overage" would have to know, before he starts, whether that lives under
 * reports or under RCA. Here he types `overage` and stops caring.
 *
 * The table and the page's JSON island are both generated from this array, in one pass, so `rows[i]`
 * is `<tr data-row="i">` by construction.
 */
function crossIndex(b: RenderBundle): Row[] {
  return b.library.sections.flatMap((s) => s.items.map((it) => ({ ...it, kind: s.label })));
}

export function libraryIndex(b: RenderBundle): FilterIndex {
  const rows: FilterRow[] = crossIndex(b).map((r) => ({
    kind: r.kind,
    // The free-text haystack. Name AND title, because half these files are dated slugs the owner
    // cannot recall and the other half are titles he can. Note what this is NOT: full-text over the
    // BODIES, which PRD R5.2 puts explicitly out of scope for v1. It searches the index, not the
    // library — the page should not imply it read what it only listed.
    text: `${r.name} ${r.title}`,
  }));

  return {
    rows,
    facets: [{ key: "kind", label: "kind", values: facetValues(rows, "kind") }],
    search: ["text"],
    total: rows.length,
  };
}

/**
 * Screen 7 of PRD R5.2. The raw event log is exhaust — it is pruned at 30 days. THIS is the memory
 * that survives retention, so every artifact the night wrote must be reachable from here.
 */
export function Library({ b }: { b: RenderBundle }): VNode {
  const rows = crossIndex(b);
  const idx = libraryIndex(b);
  const dec = b.decisions;

  return (
    <>
      <h2>Cross-index — {b.library.total} artifacts</h2>

      <FilterBar id="library-filter" island={LIBRARY_ISLAND} scope={SCOPE} count={COUNT} index={idx} />
      <FilterCount id={COUNT} total={rows.length} />

      {rows.length === 0 ? (
        <Empty>Nothing indexed. See where this build looked, below.</Empty>
      ) : (
        <div class="wrap">
          <table id={SCOPE}>
            <tr>
              <th>kind</th>
              <th>file</th>
              <th>title</th>
            </tr>
            {rows.map((r, i) => (
              <tr key={r.href} data-row={i}>
                <td>
                  <span class="tag">{r.kind}</span>
                </td>
                <td class="mono">
                  <a href={r.href}>{r.name}</a>
                </td>
                <td>{r.title}</td>
              </tr>
            ))}
          </table>
        </div>
      )}

      {/* The half of this screen that makes an empty row honest. A section that comes back with zero
          files is either "nothing was ever written" or "I was pointed at the wrong place", and those
          are opposite facts that render as the same blank. So each one prints the glob it ran. */}
      <h2>Where this index looked</h2>
      <div class="wrap">
        <table>
          <tr>
            <th>kind</th>
            <th>source</th>
            <th>files</th>
          </tr>
          {b.library.sections.map((s) => (
            <tr key={s.key}>
              <td>{s.label}</td>
              <td class="mono">{s.source}</td>
              <td class="mono">
                {s.count}
                {s.dir_exists ? null : <span class="stale-note"> · no such directory</span>}
              </td>
            </tr>
          ))}
        </table>
      </div>

      <h2>Decisions ({dec.total})</h2>
      {dec.recent.length === 0 ? (
        <Empty>No autonomous decisions logged yet.</Empty>
      ) : (
        <div class="wrap">
          <table>
            <tr>
              <th>when</th>
              <th>decision</th>
              <th>manifest rule</th>
            </tr>
            {[...dec.recent].reverse().map((d, i) => (
              <tr key={`${d.ts ?? ""}-${i}`}>
                <td class="mono">{String(d.ts ?? "").slice(0, 16)}</td>
                <td>{d.decision}</td>
                <td class="mono">{d.rule ?? "—"}</td>
              </tr>
            ))}
          </table>
        </div>
      )}

      <h2>Contracts</h2>
      <div class="card">
        <a href="../README.md">docs/lab/README.md</a> — layout, three tiers, write discipline, retention
        <br />
        <a href="../events/README.md">events/README.md</a> — envelope + the closed type vocabulary
        <br />
        <a href="../status.json">status.json</a> — the machine-readable status of the laboratory
        <br />
        <a href="../render_bundle.json">render_bundle.json</a> — the exact data these pages were built
        from
      </div>
    </>
  );
}
