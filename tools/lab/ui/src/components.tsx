import type { ComponentChildren, VNode } from "preact";
import type { LabEvent, RenderBundle } from "./types.js";
import { VERDICTS } from "./verdicts.js";
import { countClass, countSentence, type FilterIndex } from "./filter.js";
import { ageText, elapsedMs } from "./countdown.js";

/** The seven screens of PRD R5.2. One nav, one order, on every page. */
export const SCREENS = [
  { id: "index", file: "index.html", label: "Overview" },
  { id: "timeline", file: "timeline.html", label: "Timeline" },
  { id: "tasks", file: "tasks.html", label: "Tasks" },
  { id: "questions", file: "questions.html", label: "Questions" },
  { id: "fleet", file: "fleet.html", label: "Fleet" },
  { id: "cost", file: "cost.html", label: "Cost" },
  { id: "library", file: "library.html", label: "Library" },
] as const;

export type ScreenId = (typeof SCREENS)[number]["id"];

export function Nav({ current }: { current: ScreenId }): VNode {
  return (
    <nav>
      {SCREENS.map((s) => (
        <a key={s.id} href={s.file} aria-current={s.id === current ? "page" : undefined}>
          {s.label}
        </a>
      ))}
    </nav>
  );
}

/**
 * The staleness banner. Server-rendered with the build-time verdict, re-graded on open by the client
 * script (see verdicts.ts for why both must happen, and why they must come from one map).
 *
 * The ids and data-* attributes here are a CONTRACT, not decoration: tools/lab/smoke.sh asserts every
 * one of them, because each was added to close a real defect where the page hid its own rot.
 */
export function StaleBanner({ b }: { b: RenderBundle }): VNode {
  const st = b.staleness;
  const g = st.grade;
  return (
    <div
      class={`stale ${g}`}
      id="staleness"
      data-grade={g}
      data-generated-at={b.generated_at}
      data-event-age-s={st.max_event_age_s === null ? "" : String(st.max_event_age_s)}
      data-fresh-s={String(st.thresholds_s.fresh)}
      data-dead-s={String(st.thresholds_s.dead)}
    >
      <span id="stale-head">
        {g.toUpperCase()} · last event {st.max_event_age_human} ago
      </span>
      <small>
        generated_at {b.generated_at} · latest event {st.latest_event_ts ?? "never"} · thresholds
        fresh&le;{Math.floor(st.thresholds_s.fresh / 60)}m, dead&gt;
        {Math.floor(st.thresholds_s.dead / 3600)}h ·{" "}
        <span id="stale-verdict">{VERDICTS[g]}</span>
      </small>
    </div>
  );
}

export function Empty({ children }: { children: ComponentChildren }): VNode {
  return <div class="card">{children}</div>;
}

/**
 * An age that keeps aging. Server-rendered against `generated_at` (honest for a reader with JS off),
 * re-computed against the reader's own clock on open and every second after — see client.ts
 * `tickAges`, which selects on `[data-age-ts]` and on nothing else.
 *
 * IT LIVES HERE, SHARED, FOR ONE REASON. It was written twice — once on the Tasks board, once on
 * Self-health — and the third screen that needed it (Fleet, whose ENTIRE subject is how long ago a
 * worker was last heard from) printed the build-time string instead and froze. A worker rendered
 * `silent for 12m` and read three hours later still said 12m: wrong, and wrong in the reassuring
 * direction, on the screen the owner opens to decide whether the fleet is alive. A component that
 * exists in one place cannot be forgotten by the screen that needs it most.
 *
 * `ts` is nullable on purpose: a row with no timestamp must render its fallback prose and carry NO
 * `data-age-ts`, so the ticker never ages a value it cannot source.
 */
export function Age({
  ts,
  built,
  id,
  fallback,
}: {
  ts: string | null;
  built: number;
  id?: string;
  fallback?: string;
}): VNode {
  const ms = ts === null ? NaN : elapsedMs(ts, built);
  if (ts === null || isNaN(ms)) {
    return (
      <span class="age" id={id}>
        {fallback ?? "age unknown"}
      </span>
    );
  }
  return (
    <span class="age" id={id} data-age-ts={ts} title={ts}>
      {ageText(ms / 1000)}
    </span>
  );
}

/**
 * The single most important component on this dashboard.
 *
 * "Nobody is working" and "I cannot see who is working" must never render the same, and neither must
 * "the budget is fine" and "there is no budget on disk to compare against". Phase 4 spent a whole
 * cycle removing three ways this laboratory lied about itself; Phase 5 builds the screen the owner
 * uses to decide whether he can go to sleep, and it has no right to invent a fourth.
 *
 * So: a value with no source renders as `unknown`, in muted type, WITH THE REASON attached — never
 * as 0, never as a plausible default, never as a green tick.
 */
export function Unknown({ why }: { why?: string }): VNode {
  return (
    <span class="unknown" title={why ?? "no source on disk for this value"}>
      unknown
    </span>
  );
}

/** A KPI tile that knows the difference between zero and no-idea. */
export function Kpi({
  value,
  label,
  why,
}: {
  value: number | string | null | undefined;
  label: string;
  why?: string;
}): VNode {
  const missing = value === null || value === undefined || value === "";
  return (
    <div class="kpi">
      <b>{missing ? <Unknown why={why} /> : value}</b>
      <span>{label}</span>
    </div>
  );
}

/** Sources this screen could not read. A page that hides its blind spots is the tasty-lunch wiki. */
export function BlindSpots({ items }: { items: string[] }): VNode | null {
  if (items.length === 0) return null;
  return (
    <>
      <h2>What this screen cannot see</h2>
      <div class="card blind">
        {items.map((s, i) => (
          <span key={s}>
            {i > 0 ? <br /> : null}
            {s}
          </span>
        ))}
      </div>
    </>
  );
}

/**
 * A day is WHEN IT HAPPENED (`ts`), never which file the line was written into. Since GSL-89 a
 * backfilled line lives in today's file carrying last night's ts — keyed on the file, last night's
 * recovered commits would show up as today's work, which is the very lie poll-fill's floor exists to
 * prevent. The bundle's events are already folded, so this is a pure slice.
 */
export function eventsOn(b: RenderBundle, date: string): LabEvent[] {
  return b.recent_events.filter((e) => (e.ts ?? "").slice(0, 10) === date);
}

export function srcClass(src: string | undefined): string {
  const s = String(src ?? "");
  if (s.startsWith("hook:")) return "hook";
  if (s === "poll-fill") return "poll";
  return "emit";
}

/**
 * One derived column out of an event's free-form `data`. The order matters: the first key that
 * exists wins, and `sha` leads because a commit is the thing the owner most often wants to click
 * back to. smoke.sh asserts BOTH directions here — that a live sha is rendered, and that a
 * superseded one is not — because a renderer that prints nothing at all would pass the second
 * assertion vacuously.
 */
export function eventDetail(e: LabEvent): string {
  const d = (e.data ?? {}) as Record<string, unknown>;
  for (const k of ["sha", "path", "key", "question", "error_type", "decision", "cmd"]) {
    const v = d[k];
    if (v !== undefined && v !== null && v !== "") return String(v).slice(0, 90);
  }
  return "";
}

export function EventsTable({ events, limit }: { events: LabEvent[]; limit?: number }): VNode {
  const slice = limit === undefined ? events : events.slice(-limit);
  const rows = [...slice].reverse();
  if (rows.length === 0) {
    return (
      <Empty>
        No events. Either nothing ran, or the hooks are not firing — check{" "}
        <code>.artifacts/lab/lab-log.err</code>.
      </Empty>
    );
  }
  return (
    <div class="wrap">
      <table>
        <tr>
          <th>utc</th>
          <th>type</th>
          <th>actor</th>
          <th>src</th>
          <th>detail</th>
        </tr>
        {rows.map((e, i) => (
          <tr key={`${e.ts}-${e.seq ?? i}`}>
            <td class="mono">{(e.ts ?? "").slice(11, 19)}</td>
            <td>{e.type}</td>
            <td class="mono">{e.actor}</td>
            <td>
              <span class={`tag ${srcClass(e.src)}`}>{e.src}</span>
            </td>
            <td class="mono">{eventDetail(e)}</td>
          </tr>
        ))}
      </table>
    </div>
  );
}

/**
 * The filter controls (GSL-97, PRD R5.3). Rendered at build time from the SAME FilterIndex that is
 * serialized into the page's JSON island, so the options a reader can pick and the values the client
 * matches against cannot drift apart: they are one object, written once.
 *
 * It ships `hidden`. The client removes that the moment it has an island and a table to point them
 * at — so a reader with JS off never sees a <select> he can move and which changes nothing, and a
 * reader whose island failed to parse gets the full list rather than a control that silently narrows
 * to nothing. The three `data-filter-*` attributes are the wiring, and smoke.sh asserts each of them:
 * they are how the client finds the island, the rows, and the sentence it has to keep true.
 */
export function FilterBar({
  id,
  island,
  scope,
  count,
  index,
}: {
  id: string;
  island: string;
  scope: string;
  count: string;
  index: FilterIndex;
}): VNode {
  return (
    <div
      class="filters"
      id={id}
      hidden
      data-filter-island={island}
      data-filter-scope={scope}
      data-filter-count={count}
    >
      {index.facets.map((f) => (
        <label key={f.key}>
          <span>{f.label}</span>
          <select data-facet={f.key}>
            <option value="">all</option>
            {f.values.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      ))}
      {index.search.length > 0 ? (
        <label>
          <span>text</span>
          <input type="search" data-search="" placeholder="name or title" />
        </label>
      ) : null}
      <button type="button" data-filter-reset="">
        clear
      </button>
    </div>
  );
}

/**
 * What the page is NOT showing. Server-rendered as the honest no-JS truth (nothing is hidden until a
 * script hides it), then rewritten by the client on every change. See filter.ts for why this sentence
 * is the load-bearing part of the whole feature and not a caption.
 */
export function FilterCount({ id, total }: { id: string; total: number }): VNode {
  return (
    <p class={countClass(total, total)} id={id} data-total={String(total)}>
      {countSentence(total, total)}
    </p>
  );
}

export function Footer(): VNode {
  return (
    <footer>
      Regenerated by <code>tools/lab/chronicler.sh</code> — <b>never hand-edit</b>: the next pass
      overwrites it. Authority on conflict: <code>ORCHESTRATION-STATE.md</code> + live git (C8). Source
      of truth for this page: <code>docs/lab/render_bundle.json</code>.
    </footer>
  );
}
