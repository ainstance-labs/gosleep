import type { VNode } from "preact";
import type { Gates, RenderBundle, Supervision } from "../types.js";
import { Age, Empty, EventsTable, Ids, Sha, Unknown, eventsOn } from "../components.js";
import { RunwayStrip } from "../runway.js";
import { SelfHealthPanel } from "../selfhealth.js";

/**
 * GSL-206: the supervisor tile and the gates strip.
 *
 * The mandate opens on one hole — "the orchestrator has nobody to orchestrate it from above" — and
 * the mechanism that closes it (tools/watchdog, a runbook, a 75-check smoke) had no representation
 * in the web at all: two mentions of the word `watchdog` in the whole view layer, both in comments.
 * Nor did the gates: the owner read "smoke 404/404" out of a hand-typed line in a text file, which
 * is exactly the faith he said he was done extending.
 *
 * ARMED IS NOT A GRADE. The tile is not painted green when the supervisor is armed and red when it
 * is not — this is a state, and its two values are two facts. It is painted amber in the ONE case
 * that is actually alarming (nothing is watching), and each cell prints the evidence it was read
 * from. Whatever cannot be read from a file is printed as its own sentence rather than defaulted:
 * "the agent is not installed" is knowledge; "launchd may or may not have loaded it" is a gap, and
 * they are not allowed to render alike.
 */
function SupervisorTile({ s, built }: { s: Supervision; built: number }): VNode {
  return (
    <div class={"card sh-m " + (s.armed ? "ok" : "warn")} id="supervisor" data-armed={String(s.armed)}>
      <div class="sh-h">Supervisor — {s.armed ? "armed" : "not armed"}</div>
      <div class="sh-why">{s.armed_why}</div>
      <div class="sh-row">
        <span class="sh-k">last woke</span>
        {s.last_tick_ts ? (
          <>
            {/* The age KEEPS AGING while the page is open (client.ts tickAges). A supervisor that
                last woke "4m ago" according to a page built six hours ago is the reassuring
                direction, on the one tile whose whole subject is whether something is still alive. */}
            <Age ts={s.last_tick_ts} built={built} suffix="ago" /> <code>{s.last_tick_ts}</code>
            {s.ticks === null ? null : <span class="dim"> · {s.ticks} tick(s) logged</span>}
          </>
        ) : (
          <Unknown why={s.last_tick_why ?? undefined} />
        )}
      </div>
      <div class="sh-row">
        <span class="sh-k">decisions</span>
        {s.ledger_lines === null ? (
          <Unknown why={s.ledger_why ?? undefined} />
        ) : (
          <>{s.ledger_lines} line(s) in the ledger</>
        )}
      </div>
      <div class="sh-row">
        <span class="sh-k">restarts</span>
        {s.restarts === null ? (
          <Unknown why={s.restarts_why ?? undefined} />
        ) : (
          <>{s.restarts}</>
        )}
      </div>
      <div class="sh-row">
        <span class="sh-k">config</span>
        {s.configured ? <>tools/watchdog/watchdog.conf</> : <Unknown why={s.configured_why ?? undefined} />}
      </div>
      {/* The half that was NOT measured, said out loud. A tile that means "installed" while printing
          "armed" is the class of lie this dashboard exists to refuse. */}
      <div class="sh-why">{s.loaded_why}</div>
      <div class="sh-why">
        Searched: <code>{s.searched}</code> · runbook <code>{s.runbook}</code>
      </div>
    </div>
  );
}

/** One tile per gate this project runs. A gate with no receipt is `unknown` — never a pass. */
function GatesStrip({ g }: { g: Gates }): VNode {
  return (
    <>
      <div class="grid" id="gates">
        {g.runs.map((r) => (
          <div class={"kpi gate " + r.state} key={r.name} data-gate={r.name} data-state={r.state}>
            <b>
              {r.state === "unknown" ? (
                <Unknown why={r.why ?? undefined} />
              ) : (
                <>
                  {r.passed ?? "?"}/{(r.passed ?? 0) + (r.failed ?? 0)}
                </>
              )}
            </b>
            <span>
              {r.name}
              {r.ts ? <> · {r.age_human} ago</> : null}
            </span>
          </div>
        ))}
      </div>
      <div class="scope-note">
        A gate with no receipt reads <b>unknown</b>, never <i>pass</i>: a gate that has not run has
        not passed. Receipts are written by the runners themselves into{" "}
        <code>{g.searched}</code> — gitignored, so a fresh clone starts with none and each tile names
        the command that fills it.
      </div>
    </>
  );
}

/** Screen 1 of PRD R5.2 — the morning landing. GSL-94 puts the autonomy runway at the top of it. */
export function Overview({ b }: { b: RenderBundle }): VNode {
  const q = b.questions;
  const d = b.delivery;
  const openPrs = d.prs.filter((p) => p.state === "OPEN");
  const hb = b.orchestrator.heartbeat;

  return (
    <>
      {/* R5.1: the first thing on the morning screen, because "can I go to sleep?" is the only
          question this dashboard exists to answer. Everything below is the supporting evidence. */}
      <RunwayStrip r={b.runway} />

      {/* R5.3 (GSL-99): and immediately under the answer, what the answer is WORTH. A dashboard that
          has quietly gone stale is worse than no dashboard — it still looks authoritative. So the
          page's own rot is reported here, above the evidence it qualifies, not buried at the bottom.

          GSL-207 kept the POSITION and folded the DETAIL (see selfhealth.tsx): the three verdicts
          stay on screen in one line, the twelve hundred pixels behind them do not. Measured before:
          the KPI tiles below began at 2010px and "Waiting for you" at 2114px — the two blocks the
          owner opens this page for, both past two full screens of scrolling. */}
      <SelfHealthPanel b={b} />

      <div class="grid" id="overview-kpi">
        <div class="kpi">
          <b>{b.events.today}</b>
          <span>events today</span>
        </div>
        <div class="kpi">
          <b>{Math.round(b.events.mechanical_share * 100)}%</b>
          <span>mechanical (0-token)</span>
        </div>
        <div class="kpi">
          <b>{q.open}</b>
          <span>open questions</span>
        </div>
        <div class="kpi">
          <b>{d.commits_on_date.length}</b>
          <span>commits on {b.date}</span>
        </div>
      </div>

      {b.narrative?.text ? (
        <>
          <h2>The night, in words</h2>
          <div class="card">{b.narrative.text}</div>
        </>
      ) : null}

      <h2 id="waiting-for-you">Waiting for you ({q.open})</h2>
      {q.items.length === 0 ? (
        <Empty>
          Nothing is waiting for you. The night decided everything it was licensed to decide.
        </Empty>
      ) : (
        <div class="wrap">
          <table>
            <tr>
              <th>id</th>
              <th>type</th>
              <th>question</th>
              <th>auto-applies / default</th>
            </tr>
            {q.items.map((i) => (
              <tr key={i.id}>
                <td class="mono">
                  {i.id}
                  {/* GSL-205: every one of these rows carries a Jira key, and not one of them was
                      clickable. The id itself is the queue's own, and stays text — it resolves to a
                      line in questions/queue.jsonl, not to a URL. */}
                  {i.task ? (
                    <>
                      {" "}
                      <Ids text={i.task} links={b.links} />
                    </>
                  ) : null}
                </td>
                <td>
                  {/* GSL-116: the type carries the grade, so it carries the class. Only BLOCKER
                      matches a colour rule (.tag.BLOCKER -> dead); DECISION/CLARIFY/FYI fall to the
                      neutral default. Before this, a BLOCKER was painted the same grey as an FYI —
                      the one type that means "stop" read as the one that means "for information". */}
                  <span class={`tag ${i.type}`}>{i.type}</span>
                </td>
                <td>
                  <Ids text={i.question} links={b.links} />
                </td>
                <td class="mono">{i.auto_apply_at ?? i.default ?? ""}</td>
              </tr>
            ))}
          </table>
        </div>
      )}

      {/* GSL-206: the two services the mandate names, and the web could not see.

          BELOW "Waiting for you", not above it, and the position was measured rather than
          argued: placed above, this section pushed the queue the owner has to ACT on down to
          1493px — undoing GSL-207 in the same breath. What is waiting for a human outranks the
          state of the machinery that is not. Everything below this point is evidence, and this
          is the first of it. */}
      {b.supervision ? (
        <>
          <h2>Supervision and gates</h2>
          <SupervisorTile s={b.supervision} built={Date.parse(b.generated_at)} />
        </>
      ) : null}
      {b.gates ? <GatesStrip g={b.gates} /> : null}

      <h2>Delivery</h2>
      <div class="card mono">
        branch <b>{d.branch}</b> @ {d.head ? <Sha sha={d.head} links={b.links} /> : d.head} ·{" "}
        {d.dirty_paths} dirty path(s)
      </div>
      {d.commits_on_date.length === 0 ? (
        <Empty>No commits on {b.date}.</Empty>
      ) : (
        <div class="wrap">
          <table>
            <tr>
              <th>sha</th>
              <th>subject</th>
              <th>author</th>
            </tr>
            {d.commits_on_date.map((c) => (
              <tr key={c.sha}>
                <td class="mono">
                  <Sha sha={c.sha} links={b.links} title={c.subject} />
                </td>
                {/* A commit subject opens with the task key by convention (one commit per task), so
                    this cell is where the board's rows and the day's work meet. */}
                <td>
                  <Ids text={c.subject} links={b.links} />
                </td>
                <td class="mono">{c.author}</td>
              </tr>
            ))}
          </table>
        </div>
      )}
      {openPrs.length === 0 ? (
        <Empty>No open PRs.</Empty>
      ) : (
        <div class="card">
          {openPrs.map((p, i) => (
            <span key={p.number}>
              {i > 0 ? " · " : ""}
              <a href={p.url}>#{p.number}</a> <Ids text={p.title ?? ""} links={b.links} />
            </span>
          ))}
        </div>
      )}

      <h2>Orchestrator</h2>
      {hb ? (
        <div class="card mono">{JSON.stringify(hb)}</div>
      ) : (
        <Empty>No heartbeat on disk.</Empty>
      )}

      <h2>
        Timeline — {b.date} (last 25 of {b.events.today})
      </h2>
      <EventsTable events={eventsOn(b, b.date)} limit={25} links={b.links} />
      <div class="card">
        <a href="timeline.html">Full timeline &rarr;</a>
      </div>

      {b.degraded.length > 0 ? (
        <>
          <h2>Degraded sources</h2>
          <div class="card">
            {b.degraded.map((x, i) => (
              <span key={x.source}>
                {i > 0 ? <br /> : null}
                <code>{x.source}</code> — {x.why}
              </span>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
