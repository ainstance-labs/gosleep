import type { VNode } from "preact";
import type { FleetWorker, RenderBundle } from "../types.js";
import { Age, BlindSpots, Empty, Kpi, Unknown } from "../components.js";

/**
 * Screen 5 of PRD R5.2. GSL-93 built the census; GSL-98 puts the cards on it.
 *
 * WHAT THE CARD IS FOR. Not "who is alive" — the log cannot answer that and this screen will not
 * pretend to. It answers the one question it CAN: how long has each worker been quiet? An hour of
 * silence is the signal, and the card leads with it, in the biggest type it has.
 *
 * The `open_workers` count above the cards is the orchestrator's own, and it lives in a GITIGNORED
 * heartbeat file. On a fresh clone there is no heartbeat and the census is UNKNOWN — rendered as
 * `unknown`, never as 0. "Nobody is working" and "I cannot see who is working" are different
 * sentences and this screen refuses to say the first when it means the second.
 */
/** The word above the age. It changes with the state because the same number means different things:
 *  20m since the last event is routine on a live worker and is the whole story on a quiet one.
 *  Each label is a NOUN PHRASE, because the age beneath it now reads "20m old" — a label ending in
 *  "for" would have printed "silent for 20m old". */
const AGE_LABEL: Record<FleetWorker["state"], string> = {
  active: "last event",
  silent: "silent · last event",
  ended: "ended · last event",
};

function Worker({ w, built }: { w: FleetWorker; built: number }): VNode {
  return (
    <div class={`wk ${w.state}`}>
      <div class="wk-top">
        {/* The age first, and physically above the name: it is the field the reader came for — and it
            KEEPS AGING while the page is open. Baked at build time it would say `silent 12m` three
            hours later, which is the reassuring direction on the one screen that must not comfort. */}
        <div class="wk-age" title={w.state_why}>
          <small>{AGE_LABEL[w.state]}</small>
          <Age ts={w.last_ts} built={built} fallback={w.last_age_human} />
        </div>
        <div>
          <div class="wk-name">{w.name}</div>
          <div class="wk-why">{w.state_why}</div>
        </div>
      </div>

      <div class="wk-f">
        <div>
          <span>state</span>
          <b>{w.state}</b>
        </div>
        <div>
          <span>model (from the transcript, not self-report)</span>
          {w.model === null ? (
            <Unknown why={w.model_why ?? undefined} />
          ) : (
            <b class="mono" title={w.model_source ?? undefined}>
              {w.model}
            </b>
          )}
          {/* Two models in one session is a mid-session switch. It is shown, not averaged away. */}
          {w.models.length > 1 ? (
            <div class="wk-models" title="more than one model appears in this session's transcript">
              ⚠ also: {w.models.slice(1).join(", ")}
            </div>
          ) : null}
        </div>
        <div>
          <span>pane</span>
          <Unknown why={w.pane_why} />
        </div>
        <div>
          <span>session</span>
          <b class="mono" title={w.session_id}>
            {w.session_short}
          </b>
        </div>
        <div>
          <span>started</span>
          {w.started_ts ? (
            <b class="mono">{w.started_ts.slice(11, 19)}</b>
          ) : (
            <Unknown why={w.started_why ?? undefined} />
          )}
        </div>
        <div>
          <span>tokens out (ledger)</span>
          {w.tokens_out === null ? (
            <Unknown why={w.tokens_why ?? undefined} />
          ) : (
            <b class="mono" title={w.tokens_source}>
              {w.tokens_out.toLocaleString("en-US")}
            </b>
          )}
        </div>
        <div>
          <span>events</span>
          <b class="mono">{w.events}</b>
        </div>
      </div>

      <div class="wk-task">
        <span class="dim">task: </span>
        {w.task ?? <Unknown why="no task.created/completed for this session names a subject" />}
      </div>
    </div>
  );
}

export function Fleet({ b }: { b: RenderBundle }): VNode {
  const f = b.fleet;
  const built = Date.parse(b.generated_at);
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
        {f.orchestrator_status ? <b>{f.orchestrator_status}</b> : <Unknown why={noHeartbeat} />} ·
        context{" "}
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

      <h2>Workers ({f.workers.length})</h2>
      {f.workers.length === 0 ? (
        /* An empty Fleet screen that cannot say where it looked is indistinguishable from a broken
           one, so it prints its own glob rather than a shrug. */
        <Empty>
          No worker has been named. A card exists only for a session that a <code>task.completed</code>{" "}
          event named — that is the one event carrying both a session id and a worker's name.
          <br />
          <small>Searched: {f.workers_searched}</small>
        </Empty>
      ) : (
        <>
          <div class="filter-count">
            A card per worker the log can name. <b>{f.unnamed_sessions}</b> other session(s) have
            events but no name — they completed no task, so the log never learned who they were. Silent
            after {Math.round(f.quiet_after_s / 60)}m; <i>silent</i> is not <i>dead</i>.
          </div>
          {f.workers.map((w) => (
            <Worker key={w.session_id} w={w} built={built} />
          ))}
        </>
      )}

      {/* The other half of the join failure, and the actionable half: the ledger calls some worker
          `gsl81-reviewer` while the log calls it `reviewer-lab`. One worker, two hand-typed names, and
          only a human reading both columns can say so. */}
      {f.ledger_only.length > 0 ? (
        <div class="card">
          <b>{f.ledger_only.length} name(s) in the telemetry ledger match no card above.</b> The
          ledger's names and the log's names are typed by hand in two different places and nothing
          reconciles them, so a card with no tokens is a failed <i>join</i>, never a worker that spent
          nothing.
          <br />
          <small class="mono">{f.ledger_only.join(" · ")}</small>
        </div>
      ) : null}

      {/* Not "who is alive" — "who the log can name". A second, weaker channel: the emit lines carry a
          worker's name but no session id, so these rows can never become cards. Kept because a worker
          can appear here and nowhere else. */}
      <h2>Who else the log can name ({f.roster.length})</h2>
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
                <td class="mono">
                  <Age ts={r.last_ts} built={built} fallback={r.last_age_human} />
                </td>
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
