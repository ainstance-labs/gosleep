// The only code that runs in the owner's browser. It is inlined into every page (no external file:
// a page opened from file:// must not depend on a sibling loading, and GitHub's blob view will not
// run one anyway). It makes exactly ONE promise: a page can only ever grade itself WORSE than it was
// built. Time moves one way; a re-grade that softens a verdict would be a page arguing itself back
// to life.
//
// With JS off, nothing here runs and the build-time verdict simply stands — the old behaviour, never
// a worse one.

import type { Grade } from "./types.js";
import { ageText, countdownText, elapsedMs, remainingMs } from "./countdown.js";
import { countClass, countSentence, matchesFilter, type FilterIndex } from "./filter.js";

function readJson<T>(id: string): T | null {
  const el = document.getElementById(id);
  if (!el || !el.textContent) return null;
  try {
    return JSON.parse(el.textContent) as T;
  } catch {
    return null;
  }
}

/**
 * An event age, in the voice the BUILD already speaks (chronicler.py: human_age).
 *
 * The sub-minute step is not cosmetic. Until GSL-134 this function started at minutes, while the
 * Python that renders the same number at build time starts at seconds — so the instant the client
 * repainted a young banner, "last event 7s ago" became "last event 0m ago" and the page lost
 * precision the moment it gained accuracy. Two formatters for one number are two opinions about it;
 * these two now agree at every step, which is the property that lets the banner repaint at all.
 */
function human(s: number): string {
  if (s < 60) return Math.floor(s) + "s";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
  return Math.floor(s / 86400) + "d " + Math.floor((s % 86400) / 3600) + "h";
}

/**
 * The staleness banner, re-graded against the READER'S clock and then kept honest every second.
 *
 * GSL-126. This used to return early whenever the grade did not get worse, and the early return took
 * the AGE with it: inside the fresh window the number was frozen at build time, so a page opened
 * twenty-nine minutes later still read "last event 7s ago" — wrong by a factor of two hundred and
 * fifty, on the line the page offers as its own proof of life. It was invisible because the grade
 * DID update the moment it crossed a threshold, so the mechanism looked alive; it was simply wired
 * to the threshold rather than to the clock. The self-health card two blocks down showed the true
 * age the whole time, which is the tell: one page, two ages, one of them false.
 *
 * The fix separates the two things the early return had conflated:
 *
 *   the GRADE  is a verdict, and a verdict may only ever get WORSE. bornGrade is captured once, at
 *              the build, and is the floor every repaint is clamped to. A page may admit it is dead;
 *              it may never argue itself back to life.
 *   the AGE    is a measurement, and a measurement is simply due. It is recomputed on open and on
 *              every tick, from the same two numbers the banner has always carried.
 *
 * The "re-graded" suffix stays attached to the thing it describes — it appears only when the verdict
 * actually moved off the build's. A number that merely got older is not a re-grade, and saying so on
 * every page would be new prose for an event that did not happen.
 */
function regradeStaleness(): void {
  // ONE source of truth for the verdict prose, server-rendered beside us. If this island is missing
  // we leave the page exactly as it was built rather than invent a sentence.
  const verdicts = readJson<Record<Grade, string>>("verdicts");
  const el = document.getElementById("staleness");
  if (!verdicts || !el) return;

  const gen = Date.parse(el.dataset["generatedAt"] ?? "");
  if (isNaN(gen)) return;

  const built = parseInt(el.dataset["eventAgeS"] ?? "", 10);

  // `|| 1800` would have swallowed a legitimate ZERO — "grade everything stale immediately" is a
  // threshold someone may one day set, and `||` cannot tell it from an absent attribute. The line
  // above already does this correctly for `built`; these two did not. No threshold is 0 today, which
  // is exactly why this was invisible.
  const freshRaw = parseInt(el.dataset["freshS"] ?? "", 10);
  const deadRaw = parseInt(el.dataset["deadS"] ?? "", 10);
  const fresh = isNaN(freshRaw) ? 1800 : freshRaw;
  const dead = isNaN(deadRaw) ? 10800 : deadRaw;

  const rank: Record<string, number> = { fresh: 0, stale: 1, dead: 2 };
  // Read ONCE, before any repaint writes to it: this is the build's verdict, and it is the floor.
  const born = (el.dataset["grade"] ?? "fresh") as Grade;
  const head = document.getElementById("stale-head");
  const v = document.getElementById("stale-verdict");

  const paint = (): void => {
    // max(0, …) is the same guard the countdown uses: a reader whose laptop clock runs slow must not
    // be handed a page fresher than the build already knew it was.
    const pageAge = Math.max(0, (Date.now() - gen) / 1000);
    // No event was ever logged? Then the only clock we have is the page's own age.
    const age = isNaN(built) ? pageAge : built + pageAge;
    const now: Grade = age <= fresh ? "fresh" : age <= dead ? "stale" : "dead";
    const grade: Grade = (rank[now] ?? 0) >= (rank[born] ?? 0) ? now : born;

    if (el.dataset["grade"] !== grade) {
      el.className = "stale " + grade;
      el.dataset["grade"] = grade;
      // The prose must not outlive the banner's verdict: a red DEAD banner over the sentence "Live —
      // the laboratory is writing itself right now" is a page contradicting itself (REVIEW-gsl81 M1).
      if (v && verdicts[grade]) v.textContent = verdicts[grade];
    }

    if (head) {
      head.textContent =
        grade.toUpperCase() +
        " · last event " +
        human(Math.round(age)) +
        " ago" +
        (grade === born ? "" : " · re-graded when you opened this page");
    }
  };

  paint(); // ← re-graded ON OPEN, before the first tick.
  setInterval(paint, 1000);
}

/**
 * The deadline countdowns on the Questions screen (PRD R5.2 screen 4, F5-S2).
 *
 * The failure this exists to prevent is the same one the staleness banner exists to prevent, in a
 * different unit. A page built at 23:00 saying "auto-applies in 2h", opened at 04:00, is a page
 * offering the owner two hours that were spent five hours ago. It is not a stale number — it is a
 * FALSE one, and it is false in the reassuring direction, which is the only direction that matters.
 * So the countdown is re-computed against the READER'S clock the moment the page opens, from the
 * absolute instant in `data-auto-apply-at` — not from a duration baked at build time.
 *
 * Then it ticks. A second-by-second number that visibly moves is also the cheapest proof a reader
 * has that this page is live and not a screenshot of one.
 *
 * With JS off, none of this runs and the server-rendered verdict stands — honest for `generated_at`,
 * which is the same deal the banner offers.
 */
function tickCountdowns(): void {
  const els = Array.from(document.querySelectorAll<HTMLElement>("[data-auto-apply-at]"));
  if (els.length === 0) return; // every screen ships this bundle; only one screen has deadlines

  // The build's own clock, carried by the staleness banner on every page.
  const built = Date.parse(document.getElementById("staleness")?.dataset["generatedAt"] ?? "");

  const paint = (): void => {
    // A countdown may never read a clock EARLIER than the one the page was built with. A reader
    // whose laptop is set an hour slow would otherwise hand every deadline an extra hour it does
    // not have — the page arguing itself out of a deadline, which is exactly the class of lie the
    // banner's "never soften a verdict" rule forbids. Hence max(now, generated_at): time may only
    // move forward here, and a broken clock can only ever leave the build-time verdict standing.
    const now = Date.now();
    const clock = isNaN(built) ? now : Math.max(now, built);

    for (const el of els) {
      const ms = remainingMs(el.dataset["autoApplyAt"] ?? "", clock);
      // An unparseable deadline keeps whatever the server said about it (a plain "unreadable"
      // note). Counting down to an instant we could not read would be inventing one.
      if (isNaN(ms)) continue;
      el.textContent = countdownText(ms / 1000);
      el.classList.toggle("past-due", ms <= 0);
    }
  };

  paint(); // ← F5-S2: re-graded ON OPEN. Everything after this is just keeping it honest.
  setInterval(paint, 1000);
}

/**
 * The ages on the Tasks board (PRD R5.2 screen 3, F5-S3): how old each Jira status is, and how long
 * ago the tracker was last polled at all.
 *
 * Same defect as the countdown, opposite sign. The board's statuses are fed by hand (the laboratory
 * holds no Jira credentials — C1), so the ONLY thing standing between the owner and a status he thinks
 * is current is the age printed beside it. Bake that age at build time and the page understates its own
 * staleness by exactly the time the owner spent asleep — the reassuring direction, again.
 *
 * `max(now, built)` for the same reason as the countdown: an age may only ever GROW. A reader whose
 * laptop clock is slow must not be told the tracker is fresher than the build already knew it was.
 */
function tickAges(): void {
  const els = Array.from(document.querySelectorAll<HTMLElement>("[data-age-ts]"));
  if (els.length === 0) return;

  const built = Date.parse(document.getElementById("staleness")?.dataset["generatedAt"] ?? "");

  const paint = (): void => {
    const now = Date.now();
    const clock = isNaN(built) ? now : Math.max(now, built);

    for (const el of els) {
      const ms = elapsedMs(el.dataset["ageTs"] ?? "", clock);
      // An unreadable timestamp keeps whatever the server said — it is not aged from an invented one.
      if (isNaN(ms)) continue;
      // The grammar is the server's choice, read back from the element (GSL-132) — a repaint may
      // change the number, never the sentence around it.
      el.textContent = ageText(ms / 1000, el.dataset["ageSuffix"] === "ago" ? "ago" : "old");
    }
  };

  paint(); // ← re-graded ON OPEN, before the first tick.
  setInterval(paint, 1000);
}

/**
 * The Timeline and Library filters (PRD R5.3, GSL-97).
 *
 * Everything this touches is already on the page: the rows were written at build time and the controls
 * were rendered from the same index that is sitting in the JSON island beside them. So this function
 * does exactly three things — un-hide the controls, wire them, and set `hidden` on the rows that fall
 * out. It never builds a row, never re-renders a table, and never reads a rendered cell: it matches on
 * the island's records, because a filter that greps its own HTML is matching a picture of the data and
 * breaks the day someone adds a link to a column.
 *
 * The bar ships `hidden` and is revealed HERE, at the end, only once an island, a table and a count
 * element have all been found. A <select> the reader can move that changes nothing is worse than no
 * <select> at all — and if any piece is missing, the page keeps the whole list, which is the only
 * degradation worth having.
 *
 * Every screen ships this bundle; only two carry islands. The rest fall out of the loop immediately.
 */
/* ═══════════════ GSL-209: ONE visibility rule, two things that hide rows ═══════════════
 *
 * The island filter (below) and the page search (further down) both want to hide table rows, and a
 * row must not be able to be hidden by one and un-hidden by the other. The bug that shape produces
 * is not a wobble — it is the filter's count sentence going quietly false ("all 200 shown" over a
 * table where the search has hidden 190), and that sentence is the safety rail the whole filter
 * feature is built around.
 *
 * So neither of them touches `hidden` directly. Each records its own verdict in its own dataset
 * flag, and this one function ANDs them. A third mechanism tomorrow adds a third flag here and
 * nothing else changes.
 */
function setVisible(row: HTMLElement, key: "fHidden" | "sHidden", hide: boolean): void {
  if (hide) row.dataset[key] = "1";
  else delete row.dataset[key];
  row.hidden = row.dataset["fHidden"] === "1" || row.dataset["sHidden"] === "1";
}

/** What the island filters must re-run when the page search changes what is visible. */
const RECOUNT: Array<() => void> = [];

function initFilters(): void {
  for (const bar of Array.from(document.querySelectorAll<HTMLElement>("[data-filter-island]"))) {
    const idx = readJson<FilterIndex>(bar.dataset["filterIsland"] ?? "");
    const scope = document.getElementById(bar.dataset["filterScope"] ?? "");
    const countEl = document.getElementById(bar.dataset["filterCount"] ?? "");
    if (!idx || !scope || !countEl) continue; // leave the page exactly as it was built

    const selects = Array.from(bar.querySelectorAll<HTMLSelectElement>("[data-facet]"));
    const search = bar.querySelector<HTMLInputElement>("[data-search]");
    const rows = Array.from(scope.querySelectorAll<HTMLElement>("[data-row]"));

    const apply = (): void => {
      const active: Record<string, string> = {};
      for (const s of selects) active[s.dataset["facet"] ?? ""] = s.value;

      for (const r of rows) {
        // The island's record for THIS row, joined on the index the renderer stamped into both.
        // A row with no record survives — see matchesFilter: hiding a row we failed to classify is
        // an invisible subtraction from the feed the owner reads to find out what broke tonight.
        const ok = matchesFilter(idx.rows[Number(r.dataset["row"])], active, idx.search, search?.value ?? "");
        setVisible(r, "fHidden", !ok);
      }

      // The rail. Counted over the rows actually VISIBLE in the table, not over idx.total and not
      // over this filter's own verdict: since GSL-209 the page search can hide a row too, and a
      // sentence that counted only what THIS control hid would be false the moment the other one
      // ran. What the reader is looking at is the DOM, and the sentence must be true about that.
      const shown = rows.filter((r) => !r.hidden).length;
      countEl.textContent = countSentence(shown, rows.length);
      countEl.className = countClass(shown, rows.length);
    };
    RECOUNT.push(apply);

    for (const s of selects) s.addEventListener("change", apply);
    if (search) search.addEventListener("input", apply);

    const reset = bar.querySelector<HTMLElement>("[data-filter-reset]");
    if (reset) {
      reset.addEventListener("click", () => {
        for (const s of selects) s.value = "";
        if (search) search.value = "";
        apply();
      });
    }

    bar.hidden = false; // ← the control exists only now that it can actually do something
    apply();
  }
}

/**
 * GSL-209 — the theme switch.
 *
 * The stylesheet already declared dark twice (`prefers-color-scheme` AND `:root[data-theme]`), so
 * the whole mechanism is one attribute on <html>. What did not exist was any way for a reader to
 * MOVE it: the dashboard followed the operating system and offered no opinion of its own, which is
 * fine at a desk and wrong at 03:00 in a dark room on a laptop set to light.
 *
 * IT IS PERSISTED, and filter.ts explains why that is not a contradiction. A filter is a VIEW OF
 * THE DATA, and a remembered filter is the forgotten-filter trap with a memory: the owner opens the
 * page tomorrow and reads last week's narrow slice as tonight's whole night. A theme hides nothing
 * and means nothing; it is a preference about ink. Remembering it is what a reader expects, and
 * forgetting it every time is the annoyance, not the safeguard.
 *
 * localStorage can THROW on file:// under some settings, which is exactly where this page is meant
 * to work. Every touch of it is guarded, and a failure costs the memory, never the toggle.
 */
function initTheme(): void {
  const btn = document.getElementById("theme-toggle") as HTMLButtonElement | null;
  const controls = document.getElementById("page-controls");
  if (!btn || !controls) return;
  const root = document.documentElement;

  const read = (): string | null => {
    try { return localStorage.getItem("gosleep-theme"); } catch { return null; }
  };
  const write = (v: string): void => {
    try { localStorage.setItem("gosleep-theme", v); } catch { /* file:// may refuse; the toggle still works */ }
  };
  /** What the reader is looking at right now — the explicit choice, else the system's. */
  const effective = (): string => {
    const set = root.getAttribute("data-theme");
    if (set === "dark" || set === "light") return set;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };
  const paint = (): void => {
    const now = effective();
    btn.setAttribute("aria-pressed", now === "dark" ? "true" : "false");
    // The label names WHERE THE CLICK GOES, not where you are: a button that says "dark" while the
    // page is dark reads as a state readout that has stopped working.
    btn.textContent = now === "dark" ? "light theme" : "dark theme";
  };

  const saved = read();
  if (saved === "dark" || saved === "light") root.setAttribute("data-theme", saved);
  paint();

  btn.addEventListener("click", () => {
    const next = effective() === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    write(next);
    paint();
  });

  // The band is revealed HERE, at the end, and by the control that can always do something. The
  // search box may have taken itself out above (a screen with nothing to search); the theme button
  // works on every page there is.
  controls.hidden = false;
}

/**
 * GSL-209 — one search across whatever this screen is showing.
 *
 * Two screens had a filter; the other five had no way to find anything at all, on pages that run to
 * twelve thousand pixels. This searches the rendered TEXT of every table row on the page, which is
 * a deliberately different thing from the island filter beside it on Timeline and Library:
 *
 *   the island filter matches RECORDS — typed facets, exact values, the data behind the cells.
 *   this matches WHAT IS PRINTED — because the reader is looking for a string he saw, and he does
 *   not know or care which column it lives in.
 *
 * They compose rather than compete: both go through setVisible, and the island's count sentence is
 * recomputed from the DOM afterwards, so it stays true about the table the reader is looking at.
 *
 * AND IT SAYS WHAT IT HID. The same rail as filter.ts, for the same reason — a page under a
 * forgotten search is indistinguishable from a quiet night.
 */
function initSearch(): void {
  const box = document.getElementById("page-search") as HTMLInputElement | null;
  const countEl = document.getElementById("page-search-count");
  const controls = document.getElementById("page-controls");
  if (!box || !countEl || !controls) return;

  // WHAT COUNTS AS A ROW. Not every screen is a table: the queue is a stack of cards, the Tasks
  // board rolls its epics up in <details>. Searching only <tr> would have left Questions — the one
  // screen whose entire subject is "what is waiting for you" — with a box that finds nothing.
  //
  // A unit is a table row with cells, a card, or an epic rollup. A container that HOLDS one of the
  // others is excluded, so hiding a unit never hides the unit inside it (and a card wrapping a
  // table is a section heading, not a search hit).
  //
  // Captured ONCE: these pages are static, written at build time — nothing here ever creates a unit.
  const rows: HTMLElement[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("main tr, main .card, main details.epic"))) {
    if (el.tagName === "TR" && !el.querySelector("td")) continue; // the header row
    if (el.tagName !== "TR" && el.querySelector("table, .card, details.epic")) continue;
    rows.push(el);
  }

  const apply = (): void => {
    const q = box.value.trim().toLowerCase();
    for (const r of rows) {
      setVisible(r, "sHidden", q !== "" && !(r.textContent ?? "").toLowerCase().includes(q));
    }
    // Recompute the island filters' sentences over the new DOM before writing our own.
    for (const f of RECOUNT) f();

    const shown = rows.filter((r) => !r.hidden).length;
    countEl.hidden = q === "";
    countEl.textContent = countSentence(shown, rows.length);
    countEl.className = countClass(shown, rows.length);
  };

  box.addEventListener("input", apply);
  // Escape clears — the cheapest possible exit from a search that hid everything.
  box.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") { box.value = ""; apply(); }
  });

  // Revealed only now that it can actually do something. A search box over zero units would be a
  // control that changes nothing, which is the one thing worse than no control — so on such a page
  // the BOX goes away and the theme button (which always works) stays.
  if (rows.length === 0) {
    const label = controls.querySelector<HTMLElement>(".ctl-search");
    if (label) label.hidden = true;
  }
}

regradeStaleness();
tickCountdowns();
tickAges();
initFilters();
// AFTER initFilters: the search pushes its recount through RECOUNT, which the filters fill in.
initSearch();
initTheme();
