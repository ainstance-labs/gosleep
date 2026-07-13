import type { VNode } from "preact";
import type { LibraryEntry, RenderBundle } from "../types.js";
import { Empty } from "../components.js";

function Listing({ rows }: { rows: LibraryEntry[] }): VNode {
  if (rows.length === 0) return <Empty>none yet</Empty>;
  return (
    <div class="wrap">
      <table>
        <tr>
          <th>file</th>
          <th>title</th>
        </tr>
        {rows.map((r) => (
          <tr key={r.href}>
            <td class="mono">
              <a href={r.href}>{r.name}</a>
            </td>
            <td>{r.title}</td>
          </tr>
        ))}
      </table>
    </div>
  );
}

/**
 * Screen 7 of PRD R5.2. The raw event log is exhaust — it is pruned at 30 days. THIS is the memory
 * that survives retention, so every artifact the fleet wrote at night must be reachable from here.
 */
export function Library({ b }: { b: RenderBundle }): VNode {
  const dec = b.decisions;
  return (
    <>
      <h2>Morning digests</h2>
      <Listing rows={b.library.digests} />

      <h2>Handoffs</h2>
      <Listing rows={b.library.handoffs} />

      <h2>Dev history</h2>
      <Listing rows={b.library.dev_history} />

      <h2>Decisions ({dec.total})</h2>
      {dec.recent.length === 0 ? (
        <Empty>No autonomous decisions logged yet.</Empty>
      ) : (
        <div class="wrap">
          <table>
            <tr>
              <th>when</th>
              <th>decision</th>
              <th>manifest rule</th>
            </tr>
            {[...dec.recent].reverse().map((d, i) => (
              <tr key={`${d.ts ?? ""}-${i}`}>
                <td class="mono">{String(d.ts ?? "").slice(0, 16)}</td>
                <td>{d.decision}</td>
                <td class="mono">{d.rule ?? "—"}</td>
              </tr>
            ))}
          </table>
        </div>
      )}

      <h2>Contracts</h2>
      <div class="card">
        <a href="../README.md">docs/lab/README.md</a> — layout, three tiers, write discipline, retention
        <br />
        <a href="../events/README.md">events/README.md</a> — envelope + the closed type vocabulary
        <br />
        <a href="../status.json">status.json</a> — the machine-readable status of the laboratory
        <br />
        <a href="../render_bundle.json">render_bundle.json</a> — the exact data these pages were built
        from
      </div>
    </>
  );
}
