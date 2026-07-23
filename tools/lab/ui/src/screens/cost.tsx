import type { VNode } from "preact";
import type { RenderBundle } from "../types.js";
import { BlindSpots, Empty, Kpi, Unknown } from "../components.js";

function n(x: number | null): string {
  return x === null ? "—" : x.toLocaleString("en-US");
}

/** The absence glyph, muted (spec 6.5) so an empty cell does not read as a datum. */
const dash = <span class="muted">&mdash;</span>;

/** A quantity cell: right-aligned tabular mono (spec 6.4), sized for the widest running total. */
function numCell(x: number | null): VNode {
  return <td class="num">{x === null ? dash : n(x)}</td>;
}

/**
 * Screen 6 of PRD R5.2. GSL-98 finishes the cards; this is the ledger they read.
 *
 * THE HEADLINE FINDING OF THIS SCREEN IS THAT THE CEILING DOES NOT EXIST. `manifest.md`
 * §5.phase-ceiling delegates the token ceiling to "the epic brief", and no epic brief on disk names a
 * number — so §5.warn-80 ("80% of the ceiling → FYI") and §3.budget ("BUDGET_EXCEEDED = BLOCKER") are
 * rules that can never fire. This screen has a numerator and no denominator, and it says so in the
 * largest type on the page rather than inventing a plausible cap.
 *
 * That matters beyond this screen: it is why GSL-94's budget clock is `unknown`, and an unknown clock
 * makes the whole autonomy runway an UPPER bound rather than an estimate.
 */
export function Cost({ b }: { b: RenderBundle }): VNode {
  const c = b.cost;
  const noCeiling = c.ceiling_why ?? undefined;
  // GSL-120: no slice. The heading prints c.cycles.length (67); slicing to 40 hid 27 cycles that HAD
  // a telemetry row, and nothing on the page named them — a second, silent truncation on top of the
  // 29 with no row at all (which the note below already accounts for). Heading and table now count
  // the same rows. Newest first.
  const ordered = [...c.cycles].reverse();
  /** Cycles the ledger's running total counts, minus the ones with a per-cycle row to sum. */
  const gap = c.cumulative_cycles === null ? null : c.cumulative_cycles - c.cycles.length;

  return (
    <>
      <div class="grid">
        <Kpi value={c.cumulative_total === null ? null : n(c.cumulative_total)} label="tokens, cumulative" />
        {/* NOT "cycles ledgered" — that word sat on this tile AND on the per-cycle heading below,
            over two different numbers (83 and 54). Both were right; one word made them look like one
            fact, and nothing on the page named the 29 cycles between them. */}
        <Kpi value={c.cumulative_cycles} label="cycles run (ledger running total)" />
        <Kpi value={c.ceiling === null ? null : n(c.ceiling)} label="ceiling" why={noCeiling} />
        <Kpi value={c.used_pct === null ? null : `${c.used_pct}%`} label="of ceiling used" why={noCeiling} />
      </div>

      {c.ceiling === null ? (
        <div class="card">
          <span class="stale-note">There is no token ceiling on disk.</span> {c.ceiling_why}
          <br />
          <small>
            Two manifest rules depend on a number that does not exist: <b>§5.warn-80</b> (80% of the
            ceiling → an FYI in the queue) and <b>§3.budget</b> (100% → <code>BUDGET_EXCEEDED</code>,
            a BLOCKER). Neither can ever fire. Until the owner names a ceiling, the budget axis of the
            autonomy runway reads <i>unknown</i> — and one unknown clock turns the whole runway from
            an estimate into an upper bound.
          </small>
        </div>
      ) : (
        <div class="card">
          Ceiling <b>{n(c.ceiling)}</b> tokens (source: <code>{c.ceiling_source}</code>).
        </div>
      )}

      <h2>Per cycle — {c.cycles.length} with a telemetry row</h2>
      {/* A FILTER MUST NAME WHAT IT HIDES. That rule is kept everywhere else on this dashboard —
          Timeline says "the other 308 are on disk, not here", every Library shelf prints its glob —
          and it was broken here in the most expensive place: a reader who sums the table below does
          not reach the cumulative total, and nothing told him why. */}
      {gap !== null && gap > 0 ? (
        <div class="scope-note" data-cycle-gap={String(gap)}>
          <b>{gap}</b> of the <b>{c.cumulative_cycles}</b> cycles the ledger counts have no
          per-cycle row here, so <b>every sum below is LOW by an unknown amount</b> — the cumulative
          total above is the only figure that covers them.
          {c.unparsed > 0 ? (
            <>
              {" "}
              <b>{c.unparsed}</b> of the {gap} are telemetry bullets that could not be keyed on a
              cycle; the rest were never written as bullets at all.
            </>
          ) : null}
        </div>
      ) : null}
      {c.cycles.length === 0 ? (
        <Empty>
          No telemetry. The ledger lives in <code>docs/handoff/ORCHESTRATION-STATE.md</code> under{" "}
          <code>## TELEMETRY</code>, one bullet per cycle, written by hand at the end of each.
        </Empty>
      ) : (
        <div class="wrap">
          <table>
            <tr>
              <th>cycle</th>
              <th>worker</th>
              <th>model</th>
              <th class="num">out</th>
              <th class="num">in</th>
              <th class="num">cache read</th>
              <th class="num">cache write</th>
              <th class="num">running total</th>
            </tr>
            {ordered.map((r) => (
              <tr key={r.cycle}>
                <td class="mono">{r.cycle}</td>
                <td class="mono">{r.worker ?? <Unknown why="the bullet did not name a worker" />}</td>
                <td class="mono">{r.model ?? <Unknown why="the bullet did not name a model" />}</td>
                {numCell(r.tokens_out)}
                {numCell(r.tokens_in)}
                {numCell(r.cache_read)}
                {numCell(r.cache_write)}
                {numCell(r.running_total)}
              </tr>
            ))}
          </table>
        </div>
      )}

      {/* GSL-98. `partial` is printed NEXT TO every sum, not in a footnote: a cost total that quietly
          skips the lines it could not parse under-reports with total confidence, and "cheaper than
          reality" is the one direction this screen must never err in. */}
      <h2>Per model</h2>
      {c.by_model.length === 0 ? (
        <Empty>
          No telemetry bullet names a model, so there is nothing to roll up. Searched the same ledger
          as above: <code>docs/handoff/ORCHESTRATION-STATE.md</code> § <code>TELEMETRY</code>, field{" "}
          <code>model=</code>.
        </Empty>
      ) : (
        <div class="wrap">
          <table>
            <tr>
              <th>model</th>
              <th class="num">cycles</th>
              <th class="num">out</th>
              <th class="num">in</th>
              <th class="num">cache read</th>
              <th>missing from these sums</th>
            </tr>
            {c.by_model.map((m) => (
              <tr key={m.model ?? "unknown"}>
                <td class="mono">
                  {m.model ?? <Unknown why="the telemetry bullet named no model for these cycles" />}
                </td>
                <td class="num">{m.cycles}</td>
                <td class="num">{m.tokens_out === null ? <Unknown why="not one cycle in this bucket had a readable token count — unknown, not zero" /> : n(m.tokens_out)}</td>
                <td class="num">{m.tokens_in === null ? <Unknown /> : n(m.tokens_in)}</td>
                <td class="num">{m.cache_read === null ? <Unknown /> : n(m.cache_read)}</td>
                <td class={m.partial > 0 ? "partial-note" : "dim"}>
                  {m.partial > 0
                    ? `${m.partial} of ${m.cycles} cycle(s) had an unreadable token field — these sums are LOW by an unknown amount`
                    : "nothing — every cycle parsed"}
                </td>
              </tr>
            ))}
          </table>
        </div>
      )}

      {/* The quota section is EXPECTED to be empty, which is exactly why it must print its own glob.
          "The quota never bit us" and "the hook that would have told us is dead" look identical from
          here, and only one of them is safe to sleep on. */}
      <h2>Quota events ({c.quota.total})</h2>
      {c.quota.total === 0 ? (
        <div class="card">
          <span class="stale-note">No quota event has ever been logged.</span> {c.quota.why_empty}
          <br />
          <small>
            Searched: <code>{c.quota.searched}</code>
          </small>
        </div>
      ) : (
        <div class="wrap">
          <table>
            <tr>
              <th>when</th>
              <th>type</th>
              <th>error</th>
              <th>resets</th>
              <th>detail</th>
            </tr>
            {c.quota.events.map((q, i) => (
              <tr key={`${q.ts}-${i}`}>
                <td class="mono">{q.ts ?? <Unknown />}</td>
                <td class="mono">{q.type}</td>
                <td class="mono">{q.error_type ?? dash}</td>
                <td class="mono">
                  {q.eta ?? <Unknown why="the quota event carries no reset ETA — the wait is of unknown length" />}
                </td>
                <td>{q.detail ?? dash}</td>
              </tr>
            ))}
          </table>
        </div>
      )}

      <BlindSpots
        items={[
          `the ledger is prose, not data: values are approximations (~, ≈), and some read "est-unavailable" or "UNRECOVERED"`,
          c.unparsed > 0
            ? `${c.unparsed} telemetry bullet(s) could not be keyed on a cycle and are NOT counted above`
            : "every telemetry bullet parsed — no line was silently dropped",
          "the per-model rollup is only as good as the ledger: a cycle whose bullet named no model lands in the `unknown` bucket, not in the model it actually ran on",
          "no per-DAY rollup is possible at all: the ledger records cycle NUMBERS and no timestamps, so spend cannot be placed in time",
        ]}
      />
    </>
  );
}
