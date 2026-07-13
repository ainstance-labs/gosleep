import type { VNode } from "preact";
import type { QueueItem, RenderBundle } from "../types.js";
import { Empty } from "../components.js";

/**
 * Screen 4 of PRD R5.2. GSL-95 adds the live `auto-applies in Xh Ym` countdown (F5-S2); this renders
 * the queue itself, keyed on the distinction that actually matters at 03:00:
 *
 *   a DECISION resolves ITSELF at `auto_apply_at` — the night keeps moving, and the morning audits it.
 *   a BLOCKER takes no default, EVER (manifest §3) — it waits for a human, and the work it names stops.
 *
 * Rendering them in one undifferentiated list would bury the only question the owner has to answer
 * under four he does not.
 */
function Item({ q }: { q: QueueItem }): VNode {
  const isBlocker = q.type === "BLOCKER";
  return (
    <div class="card">
      <div>
        <span class={`tag ${q.type}`}>{q.type}</span> <code>{q.id}</code>{" "}
        {q.task ? <code>{q.task}</code> : null}{" "}
        {q.high_impact ? <span class="tag BLOCKER">high impact</span> : null}
      </div>
      <p>
        <b>{q.question}</b>
      </p>
      {q.default ? (
        <p>
          <small>
            <b>Default:</b> {q.default}
            {q.default_rationale ? <> — {q.default_rationale}</> : null}
          </small>
        </p>
      ) : isBlocker ? (
        <p>
          <small class="stale-note">
            No default, and there never will be: a BLOCKER stops the work it names until you answer it
            (manifest §3). It has no timer.
          </small>
        </p>
      ) : null}
      <p>
        <small>
          {q.auto_apply_at ? (
            <>
              auto-applies at <code data-auto-apply-at={q.auto_apply_at}>{q.auto_apply_at}</code> ·{" "}
            </>
          ) : null}
          {q.reversibility ? <>reversibility {q.reversibility} · </> : null}
          {q.from ? <>asked by {q.from} · </> : null}
          {q.seen_by?.length ? <>seen by {q.seen_by.join(", ")}</> : null}
        </small>
      </p>
      {q.impact_if_wrong ? (
        <p>
          <small>
            <b>If the default is wrong:</b> {q.impact_if_wrong}
          </small>
        </p>
      ) : null}
    </div>
  );
}

export function Questions({ b }: { b: RenderBundle }): VNode {
  const q = b.queue;
  const blockers = q.open_blockers;
  const others = q.open_items.filter((x) => x.type !== "BLOCKER");

  return (
    <>
      <div class="grid">
        <div class="kpi">
          <b>{q.open}</b>
          <span>open</span>
        </div>
        <div class="kpi">
          <b>{blockers.length}</b>
          <span>blockers (stop the night)</span>
        </div>
        <div class="kpi">
          <b>{others.length}</b>
          <span>self-resolving</span>
        </div>
        <div class="kpi">
          <b>{q.total}</b>
          <span>asked, all time</span>
        </div>
      </div>

      <h2>Blocking you ({blockers.length})</h2>
      {blockers.length === 0 ? (
        <Empty>
          No blockers. Nothing the fleet is doing is waiting on a human — which is the whole point of
          the queue: absent an owner, take the reversible default, keep working, surface it in the
          morning.
        </Empty>
      ) : (
        blockers.map((x) => <Item key={x.id} q={x} />)
      )}

      <h2>Waiting for you, but not waiting on you ({others.length})</h2>
      {others.length === 0 ? (
        <Empty>Nothing open.</Empty>
      ) : (
        others.map((x) => <Item key={x.id} q={x} />)
      )}

      <h2>Decided without you ({q.closed_items.length})</h2>
      {q.closed_items.length === 0 ? (
        <Empty>The queue has never closed a question.</Empty>
      ) : (
        <div class="wrap">
          <table>
            <tr>
              <th>id</th>
              <th>type</th>
              <th>question</th>
              <th>outcome</th>
            </tr>
            {q.closed_items.map((x) => (
              <tr key={x.id}>
                <td class="mono">{x.id}</td>
                <td>
                  <span class={`tag ${x.type}`}>{x.type}</span>
                </td>
                <td>{x.question}</td>
                <td>
                  <span class="tag">{x.status}</span>
                  {x.answer ? <> {x.answer}</> : x.default ? <> {x.default}</> : null}
                </td>
              </tr>
            ))}
          </table>
        </div>
      )}
    </>
  );
}
