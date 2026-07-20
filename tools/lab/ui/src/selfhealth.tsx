import type { VNode } from "preact";
import type { CoverageState, EpicCoverage, RenderBundle, SelfHealth } from "./types.js";
import { Age, Unknown } from "./components.js";

/**
 * The anti-rot alarm (GSL-99, PRD R5.3): the dashboard reporting its OWN rot.
 *
 * The risk it exists for is written into the PRD as the tasty-lunch lesson — a hand-kept hub that has
 * gone stale is WORSE than no hub, because it still looks authoritative and it lies with a timestamp
 * on it. Phase 4 closed that for the data (a page whose chronicler died must LOOK dead). This closes
 * it for the documentation.
 *
 * ONE RULE, above all three meters: NO METER IS GREEN BY DEFAULT. Missing source → `unknown`, in the
 * muted colour, with the reason attached. Green is a claim and a claim needs evidence; ignorance is
 * not evidence, and it must never be dressed in the colour of proof.
 */

/** state → the class that colours it. `empty` and `unknown` are BOTH kept away from green on purpose. */
const METER_CLASS: Record<string, string> = {
  ok: "ok",
  gaps: "warn",
  debt: "warn",
  empty: "dim",
  unknown: "unknown",
};

function meterClass(state: string, alarm = false): string {
  if (alarm) return "dead"; // three cycles of silence is not a warning any more
  return METER_CLASS[state] ?? "unknown";
}

/**
 * Meter 1 — freshness. TWO AGES, NEVER ONE.
 *
 * `grade` is a verdict on the DATA, handed down at the instant of the build. A reader who opens this
 * page five hours later is holding a five-hour-old verdict, and the arithmetic he is owed is:
 *
 *     effective age of the data  =  data_age (at build)  +  (now − generated_at)
 *
 * The staleness banner at the top of every page performs exactly that sum on open (client.ts:
 * regradeStaleness) and may only ever grade itself WORSE. This meter is where the two ages are
 * SHOWN — because a reader with JS off, and anyone reading render_bundle.json with a script, has to
 * do that sum himself, and cannot do it from one number.
 */
function Freshness({ h, built }: { h: SelfHealth; built: number }): VNode {
  return (
    <div class={"card sh-m " + meterClass(h.grade === "fresh" ? "ok" : h.grade === "stale" ? "gaps" : "unknown")} id="sh-freshness">
      <div class="sh-h">Freshness — two ages, not one</div>
      <div class="sh-row">
        {/* `ageText` already ends in "old" (countdown.ts) — the label is phrased to run into it rather
            than bolting a second suffix on, which is how this line first read "0s old ago". */}
        <span class="sh-k">this build is</span>
        {/* Age #1: the BUILD's own age. 0s at build; it ticks from the moment the reader opens it. */}
        <Age id="sh-build-age" ts={h.generated_at} built={built} />
        <span class="dim mono"> (built {h.generated_at})</span>
      </div>
      <div class="sh-row">
        <span class="sh-k">its freshest event was</span>
        {/* Age #2: the DATA's age, frozen at build time. It does not tick — it is a fact about the build. */}
        <b id="sh-data-age" data-data-age-s={h.data_age_s === null ? "" : String(h.data_age_s)}>
          {h.data_age_s === null ? <Unknown why="no event has ever been logged in this checkout" /> : h.data_age_human}
        </b>{" "}
        old <span class="dim mono">at that moment ({h.latest_event_ts ?? "never"})</span>
      </div>
      <div class="sh-why">
        The grade above (<code>{h.grade}</code>) judges <b>the data, at build time</b>. Add the first
        age to the second before you trust it — that is why there are two. The banner does this sum on
        open and may only ever grade itself <i>worse</i>.
      </div>
    </div>
  );
}

function EpicRow({ e }: { e: EpicCoverage }): VNode {
  const cls = meterClass(e.state);
  return (
    <div class="sh-epic" data-sh-epic={e.key} data-state={e.state} data-missing={e.missing.join(" ")}>
      <span class={"tag " + cls}>{e.key}</span>{" "}
      {e.state === "unknown" ? (
        <>
          <Unknown why={e.why} /> <span class="dim">— {e.why}</span>
        </>
      ) : e.state === "empty" ? (
        <span class="dim">{e.why}</span>
      ) : (
        <>
          <b>
            {e.covered.length}/{e.task_count}
          </b>{" "}
          tasks have a committed dev_history
          {e.missing.length > 0 ? (
            <>
              {" — missing: "}
              {e.missing.map((k, i) => (
                <span key={k}>
                  {i > 0 ? " · " : ""}
                  {/* BY NAME. "84% covered" is not actionable at 03:00; "GSL-93 has none" is. */}
                  <span class="tag sev warn" data-missing-task={k}>
                    {k}
                  </span>
                </span>
              ))}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Meter 2 — dev_history coverage, BY NAME, off the git INDEX.
 *
 * Two refusals hold this meter up:
 *
 *   · it counts COMMITTED files (`git ls-files` — what `git show :<path>` resolves), never the working
 *     tree. An uncommitted dev_history file does not exist for the reader who arrives after the next
 *     compaction with a fresh clone, and that reader is the only person this history is written for.
 *   · an epic whose task list git cannot read reports `unknown`, not 100%. Zero-of-zero is the
 *     cheapest false green available on this page.
 */
function DevHistory({ h }: { h: SelfHealth }): VNode {
  const d = h.dev_history;
  return (
    <div class={"card sh-m " + meterClass(d.state)} id="sh-devhistory" data-state={d.state}>
      <div class="sh-h">
        dev_history coverage —{" "}
        {d.state === "unknown" ? (
          <Unknown why={d.why} />
        ) : (
          <>
            <b>{d.covered}</b>/{d.tasks} tasks documented
            {d.missing > 0 ? <span class="warn"> · {d.missing} with no history</span> : null}
          </>
        )}
      </div>
      {d.state === "unknown" ? <div class="sh-why">{d.why}</div> : d.epics.map((e) => <EpicRow key={e.key} e={e} />)}
      {d.uncommitted.length > 0 ? (
        <div class="sh-why" id="sh-dh-uncommitted">
          <b>{d.uncommitted.length}</b> dev_history file(s) exist in the working tree and in no commit
          — <b>they do not count here</b>, and they will not exist for whoever clones this repo
          tomorrow: {d.uncommitted.join(", ")}
        </div>
      ) : null}
      {/* Print your glob. "Nothing is missing" and "I looked in the wrong place" must not render alike. */}
      <div class="sh-why mono" id="sh-dh-searched">
        Searched: {d.searched}
      </div>
    </div>
  );
}

/**
 * Meter 3 — handoff age, against the last CYCLE BOUNDARY.
 *
 * The PRD's sentence is the specification: a fleet that ran three cycles and wrote no handoff is debt
 * accruing in silence. So the number that matters is not "how old is the newest handoff" — it is HOW
 * MANY CYCLES HAVE CLOSED SINCE ONE WAS WRITTEN, which is a run, and the meter counts it as one.
 *
 * The source is the COMMITTED handoff, dated by the commit that added it. Not the `handoff.written`
 * event: that hook fires on every write to ORCHESTRATION-STATE.md too, so an orchestrator touching
 * its own state file would keep this meter permanently green — green in the reassuring direction,
 * which is the only direction that matters.
 */
function Handoffs({ h, built }: { h: SelfHealth; built: number }): VNode {
  const x = h.handoffs;
  const n = x.undocumented_cycles;
  return (
    <div
      class={"card sh-m " + meterClass(x.state, x.alarm)}
      id="sh-handoff"
      data-state={x.state}
      data-undocumented-cycles={n === null ? "" : String(n)}
      data-alarm={x.alarm ? "1" : "0"}
    >
      <div class="sh-h">
        handoff age vs the last cycle boundary —{" "}
        {x.state === "unknown" ? (
          <Unknown why={x.why} />
        ) : x.state === "ok" ? (
          <span class="ok">the last cycle to close was written up</span>
        ) : (
          <span class={x.alarm ? "dead" : "warn"}>
            <b>{n}</b> cycle(s) closed with no handoff{x.alarm ? " — this is the alarm, not a warning" : ""}
          </span>
        )}
      </div>
      <div class="sh-row">
        <span class="sh-k">last committed handoff</span>
        {x.last ? (
          <>
            <span class="mono">{x.last.name}</span>, <Age id="sh-handoff-age" ts={x.last.ts} built={built} />
          </>
        ) : (
          <Unknown why="no handoff is committed in this checkout" />
        )}
      </div>
      <div class="sh-row">
        <span class="sh-k">last cycle boundary</span>
        {x.boundary ? (
          <>
            <Age id="sh-boundary-age" ts={x.boundary.ts} built={built} />{" "}
            {/* `total` counts CYCLES, not the raw `pane.ended` events it is derived from — a cycle
                holds up to three panes and they close together. The Searched line below prints both
                numbers and the debounce window, so the collapse is auditable rather than asserted. */}
            <span class="dim mono">
              ({x.boundary.source}, {x.boundary.total} cycle boundary(ies))
            </span>
          </>
        ) : (
          <Unknown why={x.why} />
        )}
      </div>
      {x.why ? <div class="sh-why">{x.why}</div> : null}
      {x.uncommitted.length > 0 ? (
        <div class="sh-why" id="sh-ho-uncommitted">
          <b>{x.uncommitted.length}</b> handoff(s) were written and never committed — for a fresh clone
          they do not exist: {x.uncommitted.join(", ")}
        </div>
      ) : null}
      <div class="sh-why mono" id="sh-ho-searched">
        Searched: {x.searched}
      </div>
    </div>
  );
}

export function SelfHealthPanel({ b }: { b: RenderBundle }): VNode {
  const h = b.self_health;
  const built = Date.parse(b.generated_at);
  return (
    <section id="self-health" data-grade={h.grade} data-dh={h.dev_history.state} data-ho={h.handoffs.state}>
      <h2>What this laboratory knows about its own rot</h2>
      <Freshness h={h} built={built} />
      <DevHistory h={h} />
      <Handoffs h={h} built={built} />
    </section>
  );
}
