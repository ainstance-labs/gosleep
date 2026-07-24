import type { ComponentChildren, VNode } from "preact";
import type { LabEvent, LinkBases, RenderBundle } from "./types.js";
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
      {/* GSL-115: with JS off, nothing re-grades. The build-time verdict then stands unbounded — and
          when that verdict is "fresh", the sentence beside it ("Live — the laboratory is writing
          itself right now") keeps asserting the present tense forever, on a page that may be days old.
          The banner is honest only if a reader who runs no script is TOLD the age is frozen. This
          renders exactly when scripting is off; with JS on the browser hides it and the live re-grade
          speaks instead. It carries no age string, so the "… old" ticker and its doubled-suffix guard
          never touch it. */}
      <noscript>
        JavaScript is off, so this banner is frozen at the build ({b.generated_at}): the age above does
        not tick and the verdict does not re-grade. Trust the timestamp, not the tense — a page open
        long enough has outlived its own present tense.
      </noscript>
    </div>
  );
}

export function Empty({ children }: { children: ComponentChildren }): VNode {
  return <div class="card">{children}</div>;
}

/* ═══════════════════ GSL-205: ONE identifier → link, on every screen ═══════════════════
 *
 * The defect this closes was not "a screen forgot a link". It was that the Tasks board owned the
 * ONLY implementation of "an identifier resolves somewhere", and every other screen printed the same
 * identifiers as dead text: 796 outbound links on Tasks against 7 on Questions, while all 20 queue
 * items carried a Jira key and 114 of 200 timeline rows carried a clickable identifier in plain
 * prose. The owner's own directive is that the laboratory is the single place from which everything
 * can be checked — an identifier he has to copy, paste and search for is that promise broken once
 * per row.
 *
 * So the rule is a FUNCTION and not a habit. A screen does not decide how a key becomes a URL; it
 * hands its text here. Three consequences, and each is the reason this is not seven local helpers:
 *
 *   · one prefix. The Tasks board's per-row jira_url and a key linkified out of a timeline detail
 *     are built from the SAME base, produced once in Python. Two spellings of one tracker is the
 *     failure where a link resolves — on somebody else's site.
 *   · one refusal. No base on disk (an older bundle, a non-GitHub remote) → the text renders exactly
 *     as it did before. This dashboard's oldest rule: no source, no claim. It does not guess an org.
 *   · one shape. Every generated link wears data-idlink, so a test can count them per screen instead
 *     of trusting that seven files each remembered.
 *
 * WHY #N GOES TO /issues/N AND NOT /pull/N. Issues and pull requests share one numbering space on
 * GitHub, so a number alone cannot say which it is — and tasks.tsx already refuses to guess (it will
 * not borrow an epic's issue number for its PR, because the wrong link would RESOLVE rather than
 * 404). /issues/N is the one form that is never wrong: GitHub redirects it to the pull request when
 * N is a pull request. Guessing is avoided by picking the URL that does not need a guess.
 */

/** Jira keys and GitHub issue/PR references, as they appear inside free prose. */
const ID_RE = /(GSL-\d+|#\d{1,6})/g;

function jiraHref(key: string, links: LinkBases | undefined): string | null {
  const base = links?.jira_base;
  return base ? base.replace(/\/+$/, "") + "/" + key : null;
}

function ghIssueHref(n: string, links: LinkBases | undefined): string | null {
  const base = links?.gh_base;
  return base ? base.replace(/\/+$/, "") + "/issues/" + n : null;
}

/** A commit. Callers pass this ONLY where the value is known to be a sha — see `eventDetailField`. */
export function commitHref(sha: string, links: LinkBases | undefined): string | null {
  const base = links?.gh_base;
  return base && /^[0-9a-f]{7,40}$/i.test(sha) ? base.replace(/\/+$/, "") + "/commit/" + sha : null;
}

/**
 * Free text with every identifier in it turned into a link. Text that carries none — the vast
 * majority of cells — comes back as the single string it went in as, so this costs nothing to call
 * everywhere, which is exactly why it is called everywhere.
 */
export function Ids({ text, links }: { text: string; links: LinkBases | undefined }): VNode {
  const parts = text.split(ID_RE);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) => {
        // split() with one capture group alternates literal / captured / literal …, so the odd
        // indices — and only those — are the matches. No second pass, no re-testing.
        if (i % 2 === 0) return p;
        const href = p.charAt(0) === "#" ? ghIssueHref(p.slice(1), links) : jiraHref(p, links);
        return href ? (
          <a key={`${p}-${i}`} href={href} data-idlink={p}>
            {p}
          </a>
        ) : (
          p
        );
      })}
    </>
  );
}

/** A commit sha, linked when a GitHub base exists and the value really looks like one. */
export function Sha({
  sha,
  links,
  title,
}: {
  sha: string;
  links: LinkBases | undefined;
  title?: string;
}): VNode {
  const href = commitHref(sha, links);
  return href ? (
    <a href={href} data-idlink={sha} title={title}>
      {sha}
    </a>
  ) : (
    <span title={title}>{sha}</span>
  );
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
  suffix,
}: {
  ts: string | null;
  built: number;
  id?: string;
  fallback?: string;
  /** GSL-132: "ago" for slots after a verb ("Last polled … ago"); default "old" everywhere else. */
  suffix?: "old" | "ago";
}): VNode {
  const ms = ts === null ? NaN : elapsedMs(ts, built);
  if (ts === null || isNaN(ms)) {
    return (
      <span class="age" id={id}>
        {fallback ?? "age unknown"}
      </span>
    );
  }
  // data-age-suffix rides along for the ticker: a repaint that forgot the grammar would turn
  // "Last polled 8d 0h ago" back into "… old" one second after the page opens.
  return (
    <span class="age" id={id} data-age-ts={ts} data-age-suffix={suffix ?? "old"} title={ts}>
      {ageText(ms / 1000, suffix ?? "old")}
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
  const reason = why ?? "no source on disk for this value";
  // GSL-209: the reason used to be delivered by `title=` alone. A tooltip is a MOUSE feature: it is
  // unreachable from a keyboard, unreachable on a phone (where this dashboard is explicitly meant to
  // be read), and invisible to anything that is not a pointer. The reason is not decoration here —
  // it is the half of the value that says WHY it is missing, and this whole component exists because
  // "nobody is working" and "I cannot see who is working" must never render alike.
  //
  // Three doors to one string, and no JavaScript in any of them:
  //   title      — the mouse, unchanged (the pointer user loses nothing)
  //   tabindex+  — a keyboard Tab focuses it, and :focus reveals the reason inline
  //   the DOM    — the text is IN the page, so page search finds it and a screen reader reads it
  //
  // THE TRADE-OFF, STATED: this adds a tab stop per unknown, and the Tasks board has 152 of them.
  // That is a real cost and it was weighed against the alternative, which is 152 explanations that
  // a keyboard user cannot reach at all. A value that cannot state its own absence is the failure
  // this dashboard was built to refuse; a long tab order is an inconvenience.
  return (
    <span class="unknown" tabindex={0} title={reason} aria-label={"unknown — " + reason}>
      unknown
      <span class="unk-why">{reason}</span>
    </span>
  );
}

/**
 * GSL-209: the two controls this dashboard shipped without — a theme switch and one search across
 * whatever the screen is showing.
 *
 * SHIPS `hidden`, LIKE THE FILTER BAR, and for the same reason: a control the reader can operate
 * that changes nothing is worse than no control at all. client.ts reveals it only once it has wired
 * both halves. With scripting off the page is exactly what it always was.
 *
 * The count line beside it is not a caption — it is the same safety rail filter.ts is built around.
 * A page sitting under a search somebody forgot looks exactly like a quiet night: empty. So the
 * moment one row is hidden, the page says so, in words, next to the box that hid it.
 */
export function PageControls(): VNode {
  return (
    <div class="chrome-controls" id="page-controls" hidden>
      <label class="ctl-search">
        <span>search</span>
        <input type="search" id="page-search" placeholder="anything on this screen" />
      </label>
      <p class="filter-count" id="page-search-count" hidden></p>
      <button type="button" id="theme-toggle" aria-pressed="false">
        theme
      </button>
    </div>
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
 *
 * GSL-124/GSL-121: THE VALUE IS RETURNED WHOLE. This used to end in .slice(0, 90), which cut 37 of
 * the 90 detail values on the current bundle — mid-word, with no ellipsis and no tooltip, and with
 * the remainder absent from the DOM entirely, so it could not even be recovered by searching the
 * page. Silent truncation is the one failure mode this laboratory exists to refuse, and a dashboard
 * that clips the evidence it is quoting is making the reader's decision for him.
 *
 * The cut was believed to be upstream, in the generator: the design spec (section 6.4) says these
 * values arrive "already pre-truncated at ~90 characters" and rules the matter out of scope for the
 * view layer on that basis. Measurement showed the premise was wrong — the truncation was HERE, in
 * the view, one call away from the reader. The rest of that same section is what now carries the
 * long values: td{overflow-wrap:anywhere} wraps the tail, on the deliberate instruction that long
 * values WRAP rather than clip. No ellipsis is added — that would be new visible text, which the
 * spec forbids — and no new line of prose appears anywhere.
 */
export function eventDetailParts(e: LabEvent): { field: string; value: string } {
  const d = (e.data ?? {}) as Record<string, unknown>;
  for (const k of ["sha", "path", "key", "question", "error_type", "decision", "cmd"]) {
    const v = d[k];
    if (v !== undefined && v !== null && v !== "") return { field: k, value: String(v) };
  }
  return { field: "", value: "" };
}

export function eventDetail(e: LabEvent): string {
  return eventDetailParts(e).value;
}

/**
 * The detail cell, rendered as the KIND of thing it is (GSL-205). Until this, every detail was one
 * undifferentiated mono string, which is why a commit sha and a Jira key — the two values on this
 * dashboard that most obviously lead somewhere — led nowhere on the screen that prints the most of
 * them. The field name is not decoration: it is the only thing that licenses a commit URL, and a
 * bare 7-hex token linkified on looks alone would eventually point at a commit that does not exist.
 */
export function EventDetail({ e, links }: { e: LabEvent; links: LinkBases | undefined }): VNode {
  const { field, value } = eventDetailParts(e);
  if (value === "") return <>{""}</>;
  if (field === "sha") return <Sha sha={value} links={links} />;
  // A path is a location in this repository, not an identifier: it gets no link (the file may not
  // exist on the default branch, and a link that 404s is the failure this screen refuses), but it
  // is still scanned, because commit subjects and error strings ride in the same slot.
  return <Ids text={value} links={links} />;
}

export function EventsTable({
  events,
  limit,
  links,
}: {
  events: LabEvent[];
  limit?: number;
  links?: LinkBases;
}): VNode {
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
            <td class="mono">
              <EventDetail e={e} links={links} />
            </td>
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
