import type { VNode } from "preact";
import type { Runway, RunwayClock } from "./types.js";

/**
 * The headline of the whole dashboard (PRD R5.1 / F5-S1). The owner opens one file at midnight and
 * this is the first thing he reads, so it gets exactly one job: answer "can I go to sleep?" WITH THE
 * EVIDENCE, and never round that answer in the comfortable direction.
 *
 * Which is why the number carries a QUALIFIER, not just a value:
 *
 *   RUNWAY ≈ 4h      every stopping clock is readable, and the nearest is 4h away.
 *   RUNWAY ≤ 4h      the nearest READABLE one is 4h — but a clock we cannot read might be nearer.
 *   RUNWAY clear     no stopping clock is counting, and we can read all of them.
 *   RUNWAY unknown   nothing is counting, but a clock is unreadable. We cannot say. NOT "clear".
 *
 * The difference between the last two is the entire point. "No blocker is open" is evidence. "The
 * heartbeat is missing so I cannot see the fleet" is a hole in the evidence. A dashboard that draws
 * them the same way is the one that tells you to go to sleep on facts it does not have.
 */
function hours(h: number | null): string {
  if (h === null) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${Math.floor(h / 24)}d ${Math.round(h % 24)}h`;
}

function Clock({ c }: { c: RunwayClock }): VNode {
  return (
    <div class={`clock ${c.state}`} title={c.why}>
      <span class="clock-axis">{c.label}</span>
      <b class="clock-val">
        {c.hours !== null ? hours(c.hours) : c.state === "clear" ? "clear" : c.state}
      </b>
      {c.gauge ? <span class="clock-gauge">{c.gauge}</span> : null}
      <span class={`clock-kind ${c.on_exhaustion}`}>{c.on_exhaustion}</span>
    </div>
  );
}

export function RunwayStrip({ r }: { r: Runway }): VNode {
  const headline =
    r.bound === "exact"
      ? `≈ ${hours(r.hours)}`
      : r.bound === "upper"
        ? `≤ ${hours(r.hours)}`
        : r.bound === "clear"
          ? "clear"
          : "unknown";

  // The tone is a CSS class and nothing else — no number, threshold or formula is decided here.
  //
  // GSL-109 split "unknown" off from "warn". They were the same amber, which quietly undid the
  // distinction this component's whole docstring is about: "under four hours left" is a reading, and
  // "I could not read the clock" is the absence of one. Painted identically, the second was served
  // to the owner as the first. `unk` is magenta and dashed — off the green-amber-red axis entirely,
  // because unknown is not a grade on it. See theme.ts for why the hue was chosen by measurement.
  const tone =
    r.bound === "clear"
      ? "ok"
      : r.bound === "unknown"
        ? "unk"
        : r.hours !== null && r.hours < 1
          ? "dead"
          : r.hours !== null && r.hours < 4
            ? "warn"
            : "ok";

  return (
    <div class={`runway ${tone}`}>
      <div class="runway-top">
        <span class="runway-label">RUNWAY</span>
        <span class="runway-big">{headline}</span>
        {r.binding ? (
          <span class="runway-bind">binding: {r.binding_label}</span>
        ) : r.bound === "clear" ? (
          <span class="runway-bind ok">nothing is going to stop the night</span>
        ) : (
          <span class="runway-bind">no readable stopping clock</span>
        )}
      </div>

      <div class="runway-say">
        {r.bound === "exact" && r.binding_why ? <>{r.binding_why}</> : null}
        {r.bound === "upper" ? (
          <>
            <b>Upper bound only.</b> {r.binding_why} — but {r.unknown_axes.length} stopping clock(s)
            could not be read (<b>{r.unknown_axes.join(", ")}</b>), and an unreadable clock cannot be
            ruled out. The true runway is <b>at most</b> this.
          </>
        ) : null}
        {r.bound === "clear" ? (
          <>
            No stopping clock is counting, and every one of them is readable. That is evidence, not an
            absence of it.
          </>
        ) : null}
        {r.bound === "unknown" ? (
          <>
            <b>Cannot say.</b> No stopping clock is counting — but {r.unknown_axes.length} of them
            could not be read (<b>{r.unknown_axes.join(", ")}</b>). That is a hole in the evidence, not
            a green light: <i>“nothing is wrong”</i> and <i>“I cannot see whether anything is wrong”</i>{" "}
            are different sentences.
          </>
        ) : null}
      </div>

      {/* The nearest of ALL six, even when it does not stop the night. A 40-minute forced roll must
          never hide behind a 6-hour runway just because the watchdog handles it. */}
      {r.next_event && r.next_event.axis !== r.binding ? (
        <div class="runway-next">
          Next, either way: <b>{r.next_event.label}</b> in <b>{hours(r.next_event.hours)}</b> —{" "}
          {r.next_event.on_exhaustion === "degrades" ? (
            <>handled automatically, the night continues</>
          ) : r.next_event.on_exhaustion === "completes" ? (
            <>the work runs out — the good ending</>
          ) : (
            <>this one stops the night</>
          )}
          .
        </div>
      ) : null}

      <div class="clocks">
        {r.clocks.map((c) => (
          <Clock key={c.axis} c={c} />
        ))}
      </div>

      <details class="runway-trace">
        <summary>
          Why — all six clocks, read from disk ({r.known}/{r.total} readable)
        </summary>
        <ul>
          {r.clocks.map((c) => (
            <li key={c.axis}>
              <b>
                {c.hours !== null ? hours(c.hours) : c.state} — {c.label}
              </b>
              : {c.why}
              <br />
              <small class="mono">{c.sources.join(" · ")}</small>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
