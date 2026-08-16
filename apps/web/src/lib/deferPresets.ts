// @gosleep/web — defer-preset ladder helpers (GSL-278 baseline + GSL-372
// short-duration presets).
//
// The Questions screen's defer dialog offers a fixed ladder of preset
// durations plus an "escape hatch" for a custom ISO string. GSL-372 added
// three short-duration presets ("5m", "15m", "1h") at the front of the
// ladder so the owner can snooze a question for a genuinely short pause
// without falling through to the custom-ISO picker or picking a much longer
// preset than intended. The long presets are unchanged.
//
// Extracted from the JSX so the mapping can be covered by plain `bun test`
// unit tests independent of React. `resolveDeferPreset` accepts an
// explicit `now` argument to keep the test suite deterministic (no
// Date.now() shim required).

export type DeferPresetKey =
  | "no-timer"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "2h"
  | "tomorrow-10am"
  | "next-week"
  | "custom";

/** Ordered as rendered in the dialog — ascending by duration, escape
 *  hatches at the ends. */
export const DEFER_PRESET_ORDER: ReadonlyArray<
  readonly [DeferPresetKey, string]
> = [
  ["no-timer", "No timer"],
  ["5m", "5 minutes"],
  ["15m", "15 minutes"],
  ["30m", "30 minutes"],
  ["1h", "1 hour"],
  ["2h", "2 hours"],
  ["tomorrow-10am", "Tomorrow 10:00"],
  ["next-week", "Next Monday 10:00"],
  ["custom", "Custom ISO"],
];

/** Relative duration in seconds for the fixed presets. Absolute presets
 *  (`tomorrow-10am`, `next-week`) live in their own helpers because they
 *  round to a wall-clock hour, not a delta from `now`. */
export const DEFER_RELATIVE_SECONDS: ReadonlyMap<DeferPresetKey, number> =
  new Map([
    ["5m", 5 * 60],
    ["15m", 15 * 60],
    ["30m", 30 * 60],
    ["1h", 60 * 60],
    ["2h", 2 * 60 * 60],
  ]);

function isoNowPlus(seconds: number, now: Date): string {
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

/** Tomorrow at 10:00 local (rounded to the minute). Kept anchored to the
 *  passed `now` so tests are deterministic. */
export function tomorrowAt10Iso(now: Date): string {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

/** Next-Monday 10:00 local. If `now` is a Sunday, we still push to the
 *  following Monday (i.e. tomorrow, not today). */
export function nextWeekMondayAt10Iso(now: Date): string {
  const d = new Date(now.getTime());
  const day = d.getDay(); // 0 = Sun
  const daysUntilMonday = (8 - day) % 7 || 7;
  d.setDate(d.getDate() + daysUntilMonday);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

/** Resolve a preset key + optional custom ISO to a defer-until ISO string,
 *  or `null` when the owner picked "No timer" (no auto-reopen). */
export function resolveDeferPreset(
  key: DeferPresetKey,
  custom: string,
  now: Date,
): string | null {
  if (key === "no-timer") return null;
  if (key === "tomorrow-10am") return tomorrowAt10Iso(now);
  if (key === "next-week") return nextWeekMondayAt10Iso(now);
  if (key === "custom") {
    // Empty custom => no timer (mirrors CLI semantics).
    return custom.trim().length > 0 ? custom.trim() : null;
  }
  const seconds = DEFER_RELATIVE_SECONDS.get(key);
  if (seconds === undefined) return null;
  return isoNowPlus(seconds, now);
}
