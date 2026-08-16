// @gosleep/web — GSL-371 unit tests for normalizeOptions / hasClickableOptions.
//
// Wire-shape sanity for the clickable-variant rendering path: only payloads
// where every item has a non-empty `label` become clickable. Anything else
// (a bare string, an empty array, a mixed-shape list) falls through to the
// free-text answer path so the panel never accidentally offers a broken row.

import { describe, expect, test } from "bun:test";

import {
  hasClickableOptions,
  normalizeOptions,
} from "../src/lib/questionOptions";

describe("normalizeOptions (GSL-371)", () => {
  test("labels-only list is clickable", () => {
    const out = normalizeOptions([{ label: "alpha" }, { label: "beta" }]);
    expect(out).toEqual([
      { label: "alpha", description: null, pros: [], cons: [] },
      { label: "beta", description: null, pros: [], cons: [] },
    ]);
  });

  test("pros/cons string variants are coerced to arrays", () => {
    // Legacy senders ship pros/cons as a single string; the current shim
    // ships them as string[]. Both must land as string[] downstream so the
    // React render path stays uniform.
    const out = normalizeOptions([
      {
        label: "one",
        description: "the first choice",
        pros: "cheap",
        cons: ["slow", "brittle"],
      },
    ]);
    expect(out).toEqual([
      {
        label: "one",
        description: "the first choice",
        pros: ["cheap"],
        cons: ["slow", "brittle"],
      },
    ]);
  });

  test("empty labels reject the whole payload", () => {
    // If ANY item is malformed we bail out — a partially clickable list is
    // worse than a fully-free-text fallback because the operator cannot tell
    // by looking which rows would submit and which would not.
    expect(normalizeOptions([{ label: "ok" }, { label: "" }])).toBeNull();
    expect(normalizeOptions([{ label: 42 }])).toBeNull();
    expect(normalizeOptions([{ notALabel: "ok" }])).toBeNull();
  });

  test("non-array / empty / string payloads reject", () => {
    expect(normalizeOptions(null)).toBeNull();
    expect(normalizeOptions(undefined)).toBeNull();
    expect(normalizeOptions([])).toBeNull();
    expect(normalizeOptions("pick this")).toBeNull();
    expect(normalizeOptions({ label: "not-in-array" })).toBeNull();
  });

  test("hasClickableOptions mirrors normalizeOptions success", () => {
    expect(hasClickableOptions([{ label: "a" }])).toBe(true);
    expect(hasClickableOptions([])).toBe(false);
    expect(hasClickableOptions("free-text")).toBe(false);
  });

  test("labels are trimmed and blank-after-trim rejects", () => {
    expect(normalizeOptions([{ label: "  spaced  " }])).toEqual([
      { label: "spaced", description: null, pros: [], cons: [] },
    ]);
    expect(normalizeOptions([{ label: "   " }])).toBeNull();
  });
});
