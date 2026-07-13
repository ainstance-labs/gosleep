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

function readJson<T>(id: string): T | null {
  const el = document.getElementById(id);
  if (!el || !el.textContent) return null;
  try {
    return JSON.parse(el.textContent) as T;
  } catch {
    return null;
  }
}

function human(s: number): string {
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
  return Math.floor(s / 86400) + "d " + Math.floor((s % 86400) / 3600) + "h";
}

function regradeStaleness(): void {
  // ONE source of truth for the verdict prose, server-rendered beside us. If this island is missing
  // we leave the page exactly as it was built rather than invent a sentence.
  const verdicts = readJson<Record<Grade, string>>("verdicts");
  const el = document.getElementById("staleness");
  if (!verdicts || !el) return;

  const gen = Date.parse(el.dataset["generatedAt"] ?? "");
  if (isNaN(gen)) return;

  const built = parseInt(el.dataset["eventAgeS"] ?? "", 10);
  const pageAge = Math.max(0, (Date.now() - gen) / 1000);
  // No event was ever logged? Then the only clock we have is the page's own age.
  const age = isNaN(built) ? pageAge : built + pageAge;

  const fresh = parseInt(el.dataset["freshS"] ?? "", 10) || 1800;
  const dead = parseInt(el.dataset["deadS"] ?? "", 10) || 10800;
  const grade: Grade = age <= fresh ? "fresh" : age <= dead ? "stale" : "dead";

  const rank: Record<string, number> = { fresh: 0, stale: 1, dead: 2 };
  const was = el.dataset["grade"] ?? "fresh";
  if ((rank[grade] ?? 0) <= (rank[was] ?? 0)) return; // never soften a verdict

  el.className = "stale " + grade;
  el.dataset["grade"] = grade;

  const head = document.getElementById("stale-head");
  if (head) {
    head.textContent =
      grade.toUpperCase() +
      " · last event " +
      human(Math.round(age)) +
      " ago · re-graded when you opened this page";
  }
  // The prose must not outlive the banner's verdict: a red DEAD banner over the sentence "Live — the
  // laboratory is writing itself right now" is a page contradicting itself (REVIEW-gsl81 M1).
  const v = document.getElementById("stale-verdict");
  if (v && verdicts[grade]) v.textContent = verdicts[grade];
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
      el.textContent = ageText(ms / 1000);
    }
  };

  paint(); // ← re-graded ON OPEN, before the first tick.
  setInterval(paint, 1000);
}

regradeStaleness();
tickCountdowns();
tickAges();
