import type { VNode } from "preact";
import type { RenderBundle } from "../types.js";
import { BlindSpots, Empty, Kpi, Unknown } from "../components.js";

/**
 * Screen 5 of PRD R5.2. GSL-98 fills in the cards (state / model / pane / tokens / task); this is the
 * census they stand on — and the census is mostly a list of what the log CANNOT tell you.
 *
 * The one number that is authoritative is the orchestrator's own `open_workers`, and it lives in a
 * GITIGNORED heartbeat file. On a fresh clone there is no heartbeat, and the census is then UNKNOWN
 * — rendered as `unknown`, never as 0. "Nobody is working" and "I cannot see who is working" are
 * different sentences and this screen refuses to say the first when it means the second.
 */
export function Fleet({ b }: { b: RenderBundle }): VNode {
  const f = b.fleet;
  const noHeartbeat = "the orchestrator heartbeat is missing (it is gitignored — a fresh clone has none)";

  return (
    <>
      <div class="grid">
        <Kpi value={f.open_workers} label="live workers" why={noHeartbeat} />
        <Kpi value={f.cap} label="pane cap (manifest §5.slots)" />
        <Kpi value={f.free_slots} label="free slots" why={noHeartbeat} />
        <Kpi value={f.cycle} label="cycle" why={noHeartbeat} />
      </div>

      <h2>Orchestrator</h2>
      <div class="card">
        status{" "}
        {f.orchestrator_status ? (
          <b>{f.orchestrator_status}</b>
        ) : (
          <Unknown why={noHeartbeat} />
        )}{" "}
        · context{" "}
        {f.orchestrator_context_pct === null ? (
          <Unknown why={noHeartbeat} />
        ) : (
          <b>{f.orchestrator_context_pct}%</b>
        )}
        <br />
        <small>
          Source: <code>{f.source}</code>
        </small>
      </div>

      {/* Not "who is alive" — "who the log can name". The two are different, and conflating them is
          how a dashboard invents a fleet. */}
      <h2>Who the log can name ({f.roster.length})</h2>
      {f.roster.length === 0 ? (
        <Empty>The event log names nobody. Either nothing ran, or the hooks are not firing.</Empty>
      ) : (
        <div class="wrap">
          <table>
            <tr>
              <th>actor</th>
              <th>events</th>
              <th>last seen</th>
              <th>mostly doing</th>
            </tr>
            {f.roster.map((r) => (
              <tr key={r.actor}>
                <td class="mono">{r.actor}</td>
                <td class="mono">{r.events}</td>
                <td class="mono">{r.last_age_human} ago</td>
                <td>
                  {Object.entries(r.types).map(([t, n], i) => (
                    <span key={t}>
                      {i > 0 ? " · " : ""}
                      {t} <span class="mono">{n}</span>
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </table>
        </div>
      )}

      <BlindSpots items={f.blind_spots} />
    </>
  );
}
