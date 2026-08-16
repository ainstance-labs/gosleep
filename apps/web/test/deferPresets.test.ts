// @gosleep/web — GSL-372 unit tests for the defer-preset ladder.
//
// The dialog exposes a fixed set of preset durations plus a custom-ISO
// escape hatch. GSL-372 added three short-duration presets ("5m", "15m",
// "1h") at the front of the ladder — these tests pin the mapping so a
// future refactor cannot silently drop a short preset (the whole point of
// the ticket) or scramble the order.

import { describe, expect, test } from "bun:test";

import {
  DEFER_PRESET_ORDER,
  DEFER_RELATIVE_SECONDS,
  nextWeekMondayAt10Iso,
  resolveDeferPreset,
  tomorrowAt10Iso,
  type DeferPresetKey,
} from "../src/lib/deferPresets";

const NOW = new Date("2026-08-16T12:00:00Z"); // stable anchor across tests

describe("DEFER_PRESET_ORDER (GSL-372)", () => {
  test("ladder contains the three short-duration presets at the front", () => {
    const keys = DEFER_PRESET_ORDER.map(([k]) => k);
    // no-timer is first (escape hatch), then the short-duration group ascends.
    expect(keys.slice(0, 5)).toEqual([
      "no-timer",
      "5m",
      "15m",
      "30m",
      "1h",
    ]);
  });

  test("long-form presets survive the reshuffle", () => {
    const keys = DEFER_PRESET_ORDER.map(([k]) => k);
    for (const k of ["2h", "tomorrow-10am", "next-week", "custom"] as const) {
      expect(keys).toContain(k);
    }
  });

  test("labels are human-readable and stable", () => {
    const dict = new Map<DeferPresetKey, string>(DEFER_PRESET_ORDER);
    expect(dict.get("5m")).toBe("5 minutes");
    expect(dict.get("15m")).toBe("15 minutes");
    expect(dict.get("1h")).toBe("1 hour");
  });
});

describe("DEFER_RELATIVE_SECONDS (GSL-372)", () => {
  test.each([
    ["5m", 300],
    ["15m", 900],
    ["30m", 1800],
    ["1h", 3600],
    ["2h", 7200],
  ] as Array<[DeferPresetKey, number]>)("%s → %d s", (key, seconds) => {
    expect(DEFER_RELATIVE_SECONDS.get(key)).toBe(seconds);
  });
});

describe("resolveDeferPreset (GSL-372)", () => {
  test("no-timer resolves to null", () => {
    expect(resolveDeferPreset("no-timer", "", NOW)).toBeNull();
  });

  test.each([
    ["5m", 300],
    ["15m", 900],
    ["30m", 1800],
    ["1h", 3600],
    ["2h", 7200],
  ] as Array<[DeferPresetKey, number]>)(
    "%s adds the exact delta from now",
    (key, seconds) => {
      const iso = resolveDeferPreset(key, "", NOW);
      expect(iso).not.toBeNull();
      const delta = new Date(iso as string).getTime() - NOW.getTime();
      expect(delta).toBe(seconds * 1000);
    },
  );

  test("tomorrow-10am rounds to next day at 10:00 local", () => {
    const iso = resolveDeferPreset("tomorrow-10am", "", NOW);
    expect(iso).toBe(tomorrowAt10Iso(NOW));
    // Sanity: the result is strictly after `now`.
    expect(new Date(iso as string).getTime()).toBeGreaterThan(NOW.getTime());
  });

  test("next-week resolves to a strictly-later Monday", () => {
    const iso = resolveDeferPreset("next-week", "", NOW);
    expect(iso).toBe(nextWeekMondayAt10Iso(NOW));
    const resolved = new Date(iso as string);
    expect(resolved.getDay()).toBe(1); // Monday
    expect(resolved.getTime()).toBeGreaterThan(NOW.getTime());
  });

  test("custom trims whitespace; empty custom collapses to null", () => {
    expect(resolveDeferPreset("custom", "  2027-01-01T00:00:00Z  ", NOW)).toBe(
      "2027-01-01T00:00:00Z",
    );
    expect(resolveDeferPreset("custom", "", NOW)).toBeNull();
    expect(resolveDeferPreset("custom", "   ", NOW)).toBeNull();
  });
});
