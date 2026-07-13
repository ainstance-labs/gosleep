import type { VNode } from "preact";
import type { RenderBundle } from "../types.js";
import { BlindSpots, Empty, Kpi, Unknown } from "../components.js";

function n(x: number | null): string {
  return x === null ? "—" : x.toLocaleString("en-US");
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
  const recent = [...c.cycles].reverse().slice(0, 40);

  return (
    <>
      <div class="grid">
        <Kpi value={c.cumulative_total === null ? null : n(c.cumulative_total)} label="tokens, cumulative" />
        <Kpi value={c.cumulative_cycles} label="cycles ledgered" />
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

      <h2>Per cycle — {c.cycles.length} ledgered</h2>
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
              <th>out</th>
              <th>in</th>
              <th>cache read</th>
              <th>cache write</th>
              <th>running total</th>
            </tr>
            {recent.map((r) => (
              <tr key={r.cycle}>
                <td class="mono">{r.cycle}</td>
                <td class="mono">{r.worker ?? <Unknown why="the bullet did not name a worker" />}</td>
                <td class="mono">{r.model ?? <Unknown why="the bullet did not name a model" />}</td>
                <td class="mono">{n(r.tokens_out)}</td>
                <td class="mono">{n(r.tokens_in)}</td>
                <td class="mono">{n(r.cache_read)}</td>
                <td class="mono">{n(r.cache_write)}</td>
                <td class="mono">{n(r.running_total)}</td>
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
              <th>cycles</th>
              <th>out</th>
              <th>in</th>
              <th>cache read</th>
              <th>missing from these sums</th>
            </tr>
            {c.by_model.map((m) => (
              <tr key={m.model ?? "unknown"}>
                <td class="mono">
                  {m.model ?? <Unknown why="the telemetry bullet named no model for these cycles" />}
                </td>
                <td class="mono">{m.cycles}</td>
                <td class="mono">{m.tokens_out === null ? <Unknown why="not one cycle in this bucket had a readable token count — unknown, not zero" /> : n(m.tokens_out)}</td>
                <td class="mono">{m.tokens_in === null ? <Unknown /> : n(m.tokens_in)}</td>
                <td class="mono">{m.cache_read === null ? <Unknown /> : n(m.cache_read)}</td>
                <td class={m.partial > 0 ? "wk-models" : "dim"}>
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
                <td class="mono">{q.error_type ?? "—"}</td>
                <td class="mono">
                  {q.eta ?? <Unknown why="the quota event carries no reset ETA — the wait is of unknown length" />}
                </td>
                <td>{q.detail ?? "—"}</td>
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
