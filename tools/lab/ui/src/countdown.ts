// =============================================================================
// The deadline countdown (PRD R5.2 screen 4, F5-S2) — ONE formatter, TWO clocks.
//
// It is imported by BOTH sides on purpose:
//
//   src/screens/questions.tsx  reads the clock as `generated_at`  -> the build-time verdict, which
//                              is what a reader with JS off gets, and it is honest for that instant.
//   src/client.ts              reads the clock as `Date.now()`    -> re-graded when the page opens,
//                              then every second.
//
// Two formatters would be two opinions about one deadline, and they would drift the first time one
// of them learned about days and the other did not. There is one, so they cannot.
// =============================================================================

/** Seconds -> a duration a person reads at 03:00. Seconds are shown under an hour BECAUSE the
 *  countdown ticks: a number that visibly moves is the proof that the page is not frozen. Above an
 *  hour they are noise, and they are dropped. (client.ts's `human()` is deliberately NOT this
 *  function: an event age never needs seconds, and a countdown always does.) */
export function dur(s: number): string {
  if (s >= 86400) return Math.floor(s / 86400) + "d " + Math.floor((s % 86400) / 3600) + "h";
  if (s >= 3600) return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
  if (s >= 60) return Math.floor(s / 60) + "m " + (s % 60) + "s";
  return s + "s";
}

/**
 * What the deadline says, given how many seconds are left. Negative = the deadline has passed.
 *
 * The past-due wording is the load-bearing one, and it is not decoration. NOTHING in this repository
 * applies a default on a timer: `lab-emit.sh list --due` has exactly one consumer, and it is a LIVE
 * orchestrator on its pulse (skill/orchestrating-delivery-agents/SKILL.md §"DECISION past
 * auto_apply_at: apply the default NOW"). So an open DECISION whose deadline has passed does not
 * mean "resolved itself, audit it in the morning" — it means the pulse that was supposed to resolve
 * it never came. That is a fact about the FLEET, surfaced on the questions screen, and writing a
 * softer sentence here ("auto-applied") would state as done a thing no code does.
 */
export function countdownText(remainingS: number): string {
  const s = Math.round(remainingS);
  if (s > 0) return "auto-applies in " + dur(s);
  if (s > -60) return "due now";
  return "PAST DUE by " + dur(-s) + " — still open, so nobody applied the default";
}

/** Milliseconds until `iso`, measured on `nowMs`. NaN if the deadline does not parse — the caller
 *  renders nothing rather than a countdown to an invented instant.
 *
 *  `Date.parse` is offset-aware, which matters: the queue writes `…Z`, but events elsewhere in this
 *  laboratory arrive as `…+0200` (GSL-94 fixed exactly that bug in the Python parser), and a
 *  countdown that silently read an offset as UTC would be wrong by hours in the reassuring
 *  direction. */
export function remainingMs(iso: string, nowMs: number): number {
  const t = Date.parse(iso);
  return isNaN(t) ? NaN : t - nowMs;
}
