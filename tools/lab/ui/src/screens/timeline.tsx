import type { VNode } from "preact";
import type { LabEvent, RenderBundle } from "../types.js";
import { BlindSpots, Empty, FilterBar, FilterCount, eventDetail, srcClass } from "../components.js";
import { facetValues, type FilterIndex, type FilterRow } from "../filter.js";
import { severityOf } from "../severity.js";

/** The island the client reads back, and the table's row ids. Wired in render.tsx; asserted in smoke.sh. */
export const TIMELINE_ISLAND = "timeline-index";
const SCOPE = "timeline-rows";
const COUNT = "timeline-count";

/**
 * The feed, newest first, across days — and the ONE fold everything on this screen is built from.
 *
 * Not "the target day": a timeline keyed on today is blank at 00:05 and blank all morning after a
 * quiet night, and a blank feed looks exactly like a dead hook layer, which is the single confusion
 * this tier exists to prevent.
 */
function feed(b: RenderBundle): LabEvent[] {
  return [...b.recent_events].reverse();
}

/**
 * The filter's view of the feed. The table below and the JSON island in the page are BOTH generated
 * from this one array, in one pass, and `rows[i]` is `<tr data-row="i">` — so the record the client
 * matches on and the row it hides are the same row by construction, not by agreement.
 *
 * The client never reads the rendered cells. It could: the actor is right there in the <td>. But a
 * filter that greps its own rendered HTML is matching a shadow — re-format the column, add a link, and
 * the filter quietly stops matching. The values here are the data; the cells are a picture of it.
 */
export function timelineIndex(b: RenderBundle): FilterIndex {
  const rows: FilterRow[] = feed(b).map((e) => ({
    actor: String(e.actor ?? ""),
    type: String(e.type ?? ""),
    severity: severityOf(e.type),
    src: String(e.src ?? ""),
  }));

  return {
    rows,
    facets: [
      { key: "actor", label: "actor", values: facetValues(rows, "actor") },
      { key: "type", label: "type", values: facetValues(rows, "type") },
      // Worst-first, not alphabetical: at 03:00 the owner opens `incident`, not `agent.turn_ended`.
      // Intersected with what is actually here, so the box never offers a grade that matches nothing.
      { key: "severity", label: "severity", values: facetValues(rows, "severity") },
      // Provenance is a filter and not just a colour: "show me only what the hooks SAW" is the query
      // that separates the mechanical record (0 tokens, no model's cooperation) from what an agent
      // merely told us, and it is the one query that can audit the difference.
      { key: "src", label: "src", values: facetValues(rows, "src") },
    ],
    search: [],
    total: rows.length,
  };
}

/** Screen 2 of PRD R5.2. GSL-97: actor/type/severity filter over an inlined island; incident markers. */
export function Timeline({ b }: { b: RenderBundle }): VNode {
  const rows = feed(b);
  const idx = timelineIndex(b);
  const truncated = b.events.total > b.recent_events.length;

  return (
    <>
      <h2>
        Feed — {rows.length} newest of {b.events.total} ({b.events.today} on {b.date})
      </h2>

      {truncated ? (
        // A cap the page does not mention is a lie by omission: the owner would read the last row here
        // as "the beginning", when it is only the beginning of what we chose to carry. Note this is a
        // SEPARATE sentence from the filter's count below — they hide rows for different reasons, and
        // collapsing them into one number would let a build-time cap masquerade as the reader's filter.
        <div class="card">
          Showing the most recent <b>{b.recent_cap}</b> events. The other{" "}
          {b.events.total - b.recent_events.length} are on disk, not here:{" "}
          <code>docs/lab/events/*.jsonl</code>.
        </div>
      ) : null}

      <FilterBar id="timeline-filter" island={TIMELINE_ISLAND} scope={SCOPE} count={COUNT} index={idx} />
      <FilterCount id={COUNT} total={rows.length} />

      {rows.length === 0 ? (
        <Empty>
          No events. Either nothing ran, or the hooks are not firing — check{" "}
          <code>.artifacts/lab/lab-log.err</code>.
        </Empty>
      ) : (
        <div class="wrap">
          <table id={SCOPE}>
            <tr>
              <th>utc</th>
              <th>sev</th>
              <th>type</th>
              <th>actor</th>
              <th>src</th>
              <th>detail</th>
            </tr>
            {rows.map((e, i) => {
              const sev = severityOf(e.type);
              return (
                // The incident marker is SERVER-rendered — a class and a cell, not a script. An
                // incident that only shows up once JavaScript runs is invisible in the GitHub blob
                // view on a phone, which is the exact place the owner reads this at 02:00.
                <tr key={`${e.ts}-${e.seq ?? i}`} data-row={i} class={`sev-${sev}`}>
                  <td class="mono">{(e.ts ?? "").slice(11, 19)}</td>
                  <td>
                    <span class={`tag sev ${sev}`}>{sev}</span>
                  </td>
                  <td>{e.type}</td>
                  <td class="mono">{e.actor}</td>
                  <td>
                    <span class={`tag ${srcClass(e.src)}`}>{e.src}</span>
                  </td>
                  <td class="mono">{eventDetail(e)}</td>
                </tr>
              );
            })}
          </table>
        </div>
      )}

      <h2>All days — {b.events.total} events</h2>
      <div class="grid">
        <div class="card">
          <table>
            <tr>
              <th>type</th>
              <th>n</th>
            </tr>
            {Object.entries(b.events.by_type).map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td class="mono">{v}</td>
              </tr>
            ))}
          </table>
        </div>
        <div class="card">
          <table>
            <tr>
              <th>provenance</th>
              <th>n</th>
            </tr>
            {Object.entries(b.events.by_src).map(([k, v]) => (
              <tr key={k}>
                <td>
                  <span class={`tag ${srcClass(k)}`}>{k}</span>
                </td>
                <td class="mono">{v}</td>
              </tr>
            ))}
          </table>
        </div>
      </div>

      <div class="card">
        Provenance is queryable, not claimed:{" "}
        <code>jq -r 'select(.src|startswith("hook:")).type' docs/lab/events/*.jsonl</code> — that half
        of the log cost 0 tokens and needed no model's cooperation.
      </div>

      <BlindSpots
        items={[
          "severity is graded from an event's TYPE, never from its payload — a verify.verdict carrying a" +
            " FAIL reads as info here, because its failure lives in data, not in its type.",
          "a type neither emitter has taught this build grades as `unknown`, not `info` — the table may" +
            " lag the emitters, but it may not colour an unknown event green (src/severity.ts).",
          "the counts above are for ALL days on disk; the feed and its filter cover only the " +
            String(b.recent_cap) + " rows this build carried.",
        ]}
      />
    </>
  );
}
