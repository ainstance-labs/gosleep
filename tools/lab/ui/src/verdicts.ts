import type { Grade } from "./types.js";

// The grade baked into a page is a verdict about the DATA at the moment the page was BUILT. It cannot
// answer the question the owner actually asks at 07:00 — "is this page still true?" — because a
// static file cannot age itself. Kill the chronicler at 02:00 while everything is fresh and the page
// freezes forever saying "Live": the stale hub that hides its staleness, which is the single thing
// this whole tier exists to prevent (F4-S3, the tasty-lunch lesson).
//
// So the banner re-grades itself when you open it, from two numbers it already carries: how old the
// newest event was at build time, plus how long ago the build was. It can only ever make the verdict
// WORSE — time moves one way, so a re-grade never softens a verdict, and with JS off the build-time
// verdict simply stands (the old behaviour, never a worse one). No fetches: the page stays
// file://-safe.
//
// The banner is not the only thing that speaks. The SENTENCE under it used to be baked at build time
// and never re-graded, so a page could open with a red DEAD banner and "Live — the laboratory is
// writing itself right now" still printed beneath it: a page contradicting itself in adjacent lines
// (REVIEW-gsl81 M1). Both re-grade now, from ONE source of truth: this map is server-rendered into
// the page as a JSON data island AND read by the client script below it, so the two cannot drift
// apart into two different opinions about the same grade.
export const VERDICTS: Record<Grade, string> = {
  fresh: "Live — the laboratory is writing itself right now.",
  stale: "Stale — nothing has been logged for a while. Delivery may still be running; this page is not.",
  dead: "DEAD — this page is not being regenerated. Do not trust anything below without checking git.",
};
