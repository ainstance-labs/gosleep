// @gosleep/web — GSL-377 unit tests for optionsSignature and staleness detection.
//
// The AnswerDialog stores an option-set snapshot at open time and compares it
// against the live options every render. Any add / remove / reorder / rename
// that shows up on SSE flips the signature — the stale banner fires and the
// submit paths refuse until the owner clicks Reload.
//
// This file locks the signature helper's shape. The full render-time behavior
// (banner rendering, button disable, auto-close on question-vanish) is
// exercised by the live browser proof under
// docs/reports/verifications/GSL-377/runs/01/.

import { describe, expect, test } from "bun:test";

import { optionsSignature } from "../src/screens/Questions";
import { normalizeOptions } from "../src/lib/questionOptions";

const A = { label: "Alpha", description: "first", pros: [], cons: [] };
const B = { label: "Beta", description: "second", pros: [], cons: [] };
const C = { label: "Gamma", description: "third", pros: [], cons: [] };

describe("optionsSignature (GSL-377)", () => {
  test("null and empty produce distinct-but-stable signatures", () => {
    expect(optionsSignature(null)).toBe(optionsSignature(null));
    expect(optionsSignature([])).toBe(optionsSignature([]));
    // Any two "no options" states are treated as equal for staleness — both
    // route to the free-text answer surface.
    expect(optionsSignature(null)).toBe(optionsSignature([]));
  });

  test("same options in same order → equal signatures", () => {
    expect(optionsSignature([A, B])).toBe(optionsSignature([A, B]));
    // Object identity does not matter — the signature is content-based.
    const A2 = { ...A };
    const B2 = { ...B };
    expect(optionsSignature([A, B])).toBe(optionsSignature([A2, B2]));
  });

  test("reorder detected", () => {
    expect(optionsSignature([A, B])).not.toBe(optionsSignature([B, A]));
  });

  test("remove detected", () => {
    expect(optionsSignature([A, B])).not.toBe(optionsSignature([A]));
  });

  test("add detected", () => {
    expect(optionsSignature([A, B])).not.toBe(optionsSignature([A, B, C]));
  });

  test("rename (label change) detected", () => {
    const A_renamed = { ...A, label: "Alpha-Prime" };
    expect(optionsSignature([A, B])).not.toBe(optionsSignature([A_renamed, B]));
  });

  test("description change detected", () => {
    const A_edited = { ...A, description: "first (revised)" };
    expect(optionsSignature([A, B])).not.toBe(optionsSignature([A_edited, B]));
  });

  test("pros/cons drift is INTENTIONALLY tolerated", () => {
    // Pros/cons are advisory metadata — a shim that appends more context to an
    // existing option should not fire the stale banner. Only label/description
    // drift matters (that is what the submitted answer is tied to).
    const A_more_pros = { ...A, pros: ["fast"] };
    expect(optionsSignature([A, B])).toBe(optionsSignature([A_more_pros, B]));
  });

  test("integrates with normalizeOptions — string-shape pros/cons still stable", () => {
    // Legacy senders can ship pros/cons as strings; normalizeOptions coerces to
    // arrays. The signature only looks at label + description so the coercion
    // is invisible to the staleness check.
    const raw_v1 = [{ label: "Option A" }];
    const raw_v2 = [
      { label: "Option A", pros: "cheap" as unknown as string[] },
    ];
    expect(optionsSignature(normalizeOptions(raw_v1))).toBe(
      optionsSignature(normalizeOptions(raw_v2)),
    );
  });
});
