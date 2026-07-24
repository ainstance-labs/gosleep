import type { VNode } from "preact";
import type { FleetWorker, LinkBases, RenderBundle } from "../types.js";
import { Age, BlindSpots, Empty, Ids, Kpi, Unknown } from "../components.js";

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

/**
 * GSL-207: ONE ROW PER WORKER, not one card.
 *
 * The card was right when a worker was an event. It is wrong now: eight of nine workers on the live
 * board are eleven days old, and nine cards of eight fields each is 2.5 screens of scrolling to
 * answer a question — "who has been quiet, and for how long" — that is a single sorted column. A
 * card gives every worker the same weight; a table lets the eye run down one column and stop at the
 * one that is wrong. That is the instrument-not-presentation rule of the design spec, applied to the
 * screen that had drifted furthest from it.
 *
 * WHAT SURVIVES THE CHANGE, deliberately and by contract:
 *   · `.wk-age` still wraps the age, still with nothing nested inside it beyond its label and the
 *     Age span — smoke.sh captures its contents non-greedily and client.ts repaints it by
 *     textContent, and both would break silently on a wrapper.
 *   · the state class still rides the row, so `.wk.silent .wk-age` still paints amber. SILENT IS
 *     AMBER, NEVER RED: this screen may not claim a worker is dead, and the table did not earn that
 *     right by being a table.
 *   · every `unknown` keeps its reason. A denser layout is not a licence to drop the half of a
 *     value that says why it is missing.
 */
function Worker({
  w,
  built,
  links,
}: {
  w: FleetWorker;
  built: number;
  links: LinkBases | undefined;
}): VNode {
  return (
    <tr class={`wk ${w.state}`} data-worker={w.name} data-state={w.state}>
      <td class="mono key-col">
        <span class="wk-name">{w.name}</span>
      </td>
      <td>
        <b>{w.state}</b>
        <div class="wk-why">{w.state_why}</div>
      </td>
      {/* The age, and it KEEPS AGING while the page is open. Baked at build time it would say
          `silent 12m` three hours later — the reassuring direction, on the one screen that must
          not comfort. It leads the data columns because it is the field the reader came for. */}
      <td>
        <div class="wk-age" title={w.state_why}>
          <small>{AGE_LABEL[w.state]}</small>
          <Age ts={w.last_ts} built={built} fallback={w.last_age_human} />
        </div>
      </td>
      <td class="mono">
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
      </td>
      <td class="mono">
        <b class="mono" title={w.session_id}>
          {w.session_short}
        </b>
        <div class="wk-why">
          pane <Unknown why={w.pane_why} />
        </div>
      </td>
      <td class="mono">
        {w.started_ts ? w.started_ts.slice(11, 19) : <Unknown why={w.started_why ?? undefined} />}
      </td>
      <td class="num">
        {w.tokens_out === null ? (
          <Unknown why={w.tokens_why ?? undefined} />
        ) : (
          <span title={w.tokens_source}>{w.tokens_out.toLocaleString("en-US")}</span>
        )}
      </td>
      <td class="num">{w.events}</td>
      <td>
        {/* GSL-205: the subject a task.completed named opens with its key. Reading which worker did
            what and then having to go and find the ticket by hand is the seam this closes. */}
        {w.task ? (
          <Ids text={w.task} links={links} />
        ) : (
          <Unknown why="no task.created/completed for this session names a subject" />
        )}
      </td>
    </tr>
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
          {/* GSL-129: the KPI at the top says "N live workers" and these cards are almost all ended,
              which reads as one contradictory set unless the two are told apart. They measure
              different things from different sources — the live count is the orchestrator's open
              panes right now; a card is any worker the LOG could name over the whole window. The
              reconciliation used to sit far below in "what this screen cannot see"; it belongs here,
              where the two numbers collide. Shown only when a live count actually exists to bridge. */}
          {f.open_workers !== null ? (
            <p class="stale-note">
              The <b>live workers</b> tile above counts panes open right now, from the orchestrator's
              heartbeat; these cards are every worker the log could name over the window, ended ones
              included. Two sources, two questions — the counts need not be the same set.
            </p>
          ) : null}
          {/* scope-note, not filter-count (GSL-160): there is no filter on this screen, and the
              live count's className is a client.ts contract this static caption must not wear. */}
          <div class="scope-note">
            A card per worker the log can name. <b>{f.unnamed_sessions}</b> other session(s) have
            events but no name — they completed no task, so the log never learned who they were. Silent
            after {Math.round(f.quiet_after_s / 60)}m; <i>silent</i> is not <i>dead</i>.
          </div>
          <div class="wrap">
            <table id="fleet-rows">
              <tr>
                <th class="key-col">worker</th>
                <th>state</th>
                <th>last event</th>
                <th>model (transcript, not self-report)</th>
                <th>session</th>
                <th>started</th>
                <th class="num">tokens out (ledger)</th>
                <th class="num">events</th>
                <th>task</th>
              </tr>
              {f.workers.map((w) => (
                <Worker key={w.session_id} w={w} built={built} links={b.links} />
              ))}
            </table>
          </div>
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
