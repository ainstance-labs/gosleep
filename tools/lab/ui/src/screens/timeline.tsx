import type { VNode } from "preact";
import type { RenderBundle } from "../types.js";
import { EventsTable, srcClass } from "../components.js";

/** Screen 2 of PRD R5.2. GSL-97 adds the client-side actor/type/severity filter over an inlined island. */
export function Timeline({ b }: { b: RenderBundle }): VNode {
  const truncated = b.events.total > b.recent_events.length;

  return (
    <>
      {/* ONE feed, newest first, across days. Not a per-day table: a timeline keyed on today is
          blank at 00:05 and blank all morning after a quiet night — and a blank feed looks exactly
          like a dead hook layer, which is the one confusion this tier exists to prevent. */}
      <h2>
        Feed — {b.recent_events.length} newest of {b.events.total} ({b.events.today} on {b.date})
      </h2>
      {truncated ? (
        // A cap the page does not mention is a lie by omission: the owner would read the last row
        // here as "the beginning", when it is only the beginning of what we chose to carry.
        <div class="card">
          Showing the most recent <b>{b.recent_cap}</b> events. The other{" "}
          {b.events.total - b.recent_events.length} are on disk, not here:{" "}
          <code>docs/lab/events/*.jsonl</code>.
        </div>
      ) : null}
      <EventsTable events={b.recent_events} />

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
    </>
  );
}
