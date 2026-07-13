// The only code that runs in the owner's browser. It is inlined into every page (no external file:
// a page opened from file:// must not depend on a sibling loading, and GitHub's blob view will not
// run one anyway). It makes exactly ONE promise: a page can only ever grade itself WORSE than it was
// built. Time moves one way; a re-grade that softens a verdict would be a page arguing itself back
// to life.
//
// With JS off, nothing here runs and the build-time verdict simply stands — the old behaviour, never
// a worse one.

import type { Grade } from "./types.js";

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

regradeStaleness();
