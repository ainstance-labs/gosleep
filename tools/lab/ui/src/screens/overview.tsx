import type { VNode } from "preact";
import type { RenderBundle } from "../types.js";
import { Empty, EventsTable, eventsOn } from "../components.js";

/** Screen 1 of PRD R5.2 — the morning landing. GSL-94 puts the autonomy runway at the top of it. */
export function Overview({ b }: { b: RenderBundle }): VNode {
  const q = b.questions;
  const d = b.delivery;
  const openPrs = d.prs.filter((p) => p.state === "OPEN");
  const hb = b.orchestrator.heartbeat;

  return (
    <>
      <div class="grid">
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

      <h2>Waiting for you ({q.open})</h2>
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
                <td class="mono">{i.id}</td>
                <td>
                  <span class="tag">{i.type}</span>
                </td>
                <td>{i.question}</td>
                <td class="mono">{i.auto_apply_at ?? i.default ?? ""}</td>
              </tr>
            ))}
          </table>
        </div>
      )}

      <h2>Delivery</h2>
      <div class="card mono">
        branch <b>{d.branch}</b> @ {d.head} · {d.dirty_paths} dirty path(s)
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
                <td class="mono">{c.sha}</td>
                <td>{c.subject}</td>
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
              <a href={p.url}>#{p.number}</a> {p.title}
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
      <EventsTable events={eventsOn(b, b.date)} limit={25} />
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
