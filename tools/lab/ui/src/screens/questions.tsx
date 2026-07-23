import type { VNode } from "preact";
import type { QueueItem, RenderBundle } from "../types.js";
import { Empty } from "../components.js";
import { countdownText, remainingMs } from "../countdown.js";

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

/**
 * The deadline line. Three states, and the third one is why this is a function and not a ternary:
 *
 *   a deadline in the future  -> a countdown, which the client re-grades on open and ticks (F5-S2).
 *   a deadline in the past    -> PAST DUE. Nothing applies defaults on a timer (see countdown.ts), so
 *                                this says the pulse never came — it does not say "resolved".
 *   NO deadline at all        -> "waits for you, no deadline". Never `0h 0m`, never overdue. An
 *                                ABSENT deadline is not an EXPIRED one, and a screen that renders
 *                                missing-as-zero is the screen that files a question nobody set a
 *                                clock on under "you already missed it".
 *
 * The clock here is `generated_at` — the build-time verdict, honest for the instant it was made and
 * the only thing a reader with JS off will ever see. client.ts re-reads the SAME formatter against
 * the reader's own clock.
 */
function Deadline({ q, builtMs }: { q: QueueItem; builtMs: number }): VNode {
  if (!q.auto_apply_at) {
    return (
      <p>
        <small class="stale-note">
          No deadline: this one waits for you. It will not apply itself — and it is not overdue, it
          simply never had a clock.
        </small>
      </p>
    );
  }
  const rem = remainingMs(q.auto_apply_at, builtMs);
  if (isNaN(rem)) {
    // A deadline we cannot parse is not a deadline of zero. Say so, and show the bytes.
    return (
      <p>
        <small class="stale-note">
          Unreadable deadline: <code>{q.auto_apply_at}</code> — no countdown can be trusted from it.
        </small>
      </p>
    );
  }
  return (
    <p>
      <small>
        <span
          class={rem <= 0 ? "countdown past-due" : "countdown"}
          data-auto-apply-at={q.auto_apply_at}
        >
          {countdownText(rem / 1000)}
        </span>{" "}
        · deadline <code>{q.auto_apply_at}</code>
      </small>
    </p>
  );
}

function Item({ q, builtMs }: { q: QueueItem; builtMs: number }): VNode {
  const isBlocker = q.type === "BLOCKER";
  return (
    <div class="card">
      <div>
        <span class={`tag ${q.type}`}>{q.type}</span> <code>{q.id}</code>{" "}
        {q.task ? <code>{q.task}</code> : null}{" "}
        {/* Its own class, not "tag BLOCKER" (GSL-160): the flag borrows the BLOCKER colour by
            value, and borrowing the NAME would tie two meanings to one rule. */}
        {q.high_impact ? <span class="tag high-impact">high impact</span> : null}
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
      {/* A BLOCKER has no timer by construction, so it is not given one — not even an empty one. */}
      {isBlocker ? null : <Deadline q={q} builtMs={builtMs} />}
      <p>
        <small>
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

/**
 * The closed-question table, shared by the two "decided" sections. Its columns and the neutral
 * status tag are the shipped design; GSL-128 only changed WHICH rows each instance is handed.
 */
function ClosedTable({ items }: { items: QueueItem[] }): VNode {
  return (
    <div class="wrap">
      <table>
        <tr>
          <th>id</th>
          <th>type</th>
          <th>question</th>
          <th>outcome</th>
          <th>by</th>
        </tr>
        {items.map((x) => (
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
            {/* Who closed it. "answered-by-default" with no name is not a gap — it is the night
                answering for itself, and saying so is the point of the column. */}
            <td>{x.answered_by ? x.answered_by : <span class="dim">the default</span>}</td>
          </tr>
        ))}
      </table>
    </div>
  );
}

export function Questions({ b }: { b: RenderBundle }): VNode {
  const q = b.queue;
  const blockers = q.open_blockers;
  const others = q.open_items.filter((x) => x.type !== "BLOCKER");
  // The build-time clock. `Date.parse` of a bad generated_at yields NaN, and every countdown then
  // renders "unreadable" rather than counting down from an invented now.
  const builtMs = Date.parse(b.generated_at);
  const byType = Object.entries(q.by_type ?? {}).filter(([, n]) => n > 0);
  // GSL-128: "decided" splits by AUTHORSHIP, not merely by closed-ness. answered_by === "owner" is
  // the owner deciding it himself — the patch F6-S2 materialises as answered_by=owner, channel=… —
  // and everything else closed WITHOUT him: the night's auto-resolutions, or a non-owner answer.
  const decidedByYou = q.closed_items.filter((x) => x.answered_by === "owner");
  const decidedWithoutYou = q.closed_items.filter((x) => x.answered_by !== "owner");

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

      {/* Open, by type — the census the manifest's rules are written against. The two sections below
          group by what a question DEMANDS OF YOU, which is the grouping that matters at 03:00; this
          strip is the grouping by what it IS. */}
      {byType.length > 0 ? (
        <p>
          {byType.map(([t, n]) => (
            <span key={t}>
              <span class={`tag ${t}`}>{t}</span> {n}{" "}
            </span>
          ))}
        </p>
      ) : null}

      <h2>Blocking you ({blockers.length})</h2>
      {blockers.length === 0 ? (
        <Empty>
          No blockers. Nothing the fleet is doing is waiting on a human — which is the whole point of
          the queue: absent an owner, take the reversible default, keep working, surface it in the
          morning.
        </Empty>
      ) : (
        blockers.map((x) => <Item key={x.id} q={x} builtMs={builtMs} />)
      )}

      <h2>Waiting for you, but not waiting on you ({others.length})</h2>
      {others.length === 0 ? (
        <Empty>Nothing open.</Empty>
      ) : (
        others.map((x) => <Item key={x.id} q={x} builtMs={builtMs} />)
      )}

      <h2>Decided without you ({decidedWithoutYou.length})</h2>
      {decidedWithoutYou.length > 0 ? (
        <ClosedTable items={decidedWithoutYou} />
      ) : q.closed_items.length === 0 ? (
        <Empty>The queue has never closed a question.</Empty>
      ) : null}

      {/* GSL-128: the fourth bucket the three-section taxonomy never had. Every closed question used
          to land under "Decided without you" regardless of who closed it, so a question the owner
          answered himself (patched answered_by=owner, channel=chat) sat under a heading that flatly
          contradicted the `by` column printing "owner" one cell over. answered_by and channel are the
          exact evidence F6-S2 builds as the mark of owner participation; filing that participation
          under "without you" empties the only visible sign of it. It is a new heading, which the
          reface otherwise does not add (spec section 1.1) — added here because closing this MAJOR
          requires a section that matches the authorship fact, and the ticket's own root cause names
          this missing bucket. Drawn only when he has actually decided something, so an empty queue
          and the smoke fixtures render exactly as they did before. */}
      {decidedByYou.length > 0 ? (
        <>
          <h2>Decided by you ({decidedByYou.length})</h2>
          <ClosedTable items={decidedByYou} />
        </>
      ) : null}
    </>
  );
}
