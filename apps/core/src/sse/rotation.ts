// @gosleep/core — UTC-day rotation watcher (GSL-263).
//
// A cheap wall-clock timer that watches for a UTC day transition and emits `event: rotate` on
// the broadcaster when it fires. Target-arch section 6.1 spells the contract: at 00:00 UTC the
// server pushes `event: rotate\ndata: {new_day: "…"}`; the client invalidates all TanStack
// queries and re-fetches the day-scoped ones. This closes the red-team finding "day changed,
// dashboard stayed on yesterday's numbers".
//
// Implementation:
//   - `setInterval` fires every 60 seconds. Cheap enough that we do not need to compute the
//     exact time-to-midnight; the transition lands within one minute of the actual boundary
//     which is far below any human perception window.
//   - The current UTC day is derived from `new Date().toISOString().slice(0, 10)`. On the first
//     tick after boot we PRIME the value without emitting — we do not want to spuriously fire
//     a rotate every server restart.
//   - The rotation callback is INJECTABLE — the default is `broadcaster.emitRotate`, but tests
//     pass a spy so `sse.rotation.test.ts` can advance the clock with a fake `Date` and assert
//     the callback ran exactly once at the boundary.

import { broadcaster } from "./broadcaster.ts";

export interface RotationOptions {
  intervalMs?: number;
  now?: () => Date;
  emit?: (newDay: string) => void;
}

/**
 * Extract the current UTC date bucket ("YYYY-MM-DD") from a Date. Sidesteps timezone drift
 * by round-tripping through ISO 8601.
 */
export function utcDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * A controller returned by `startRotationWatcher()`. `check()` runs the transition test once
 * synchronously — the tests use it to advance the wall clock and assert the effect without
 * waiting for the interval.
 */
export interface RotationWatcher {
  stop(): void;
  currentDay(): string;
  /** Fire the transition test now. Returns the (possibly new) current day. */
  check(): string;
}

export function startRotationWatcher(opts: RotationOptions = {}): RotationWatcher {
  const now = opts.now ?? (() => new Date());
  const emit = opts.emit ?? ((day: string) => broadcaster.emitRotate(day));
  const intervalMs = opts.intervalMs ?? 60_000;

  let currentDay = utcDay(now());

  const check = (): string => {
    const observed = utcDay(now());
    if (observed !== currentDay) {
      const prev = currentDay;
      currentDay = observed;
      try {
        emit(observed);
      } catch (err) {
        // A subscriber that throws must not disable the timer; log to stderr and continue.
        // eslint-disable-next-line no-console
        console.error(
          JSON.stringify({
            ts: new Date().toISOString(),
            event: "sse.rotation.emit_error",
            prev,
            observed,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
    return currentDay;
  };

  const timer = setInterval(check, intervalMs);
  // Do not keep the process alive purely for this timer — a Ctrl-C on the CLI must still exit.
  if (typeof timer.unref === "function") timer.unref();

  return {
    stop(): void {
      clearInterval(timer);
    },
    currentDay(): string {
      return currentDay;
    },
    check,
  };
}
