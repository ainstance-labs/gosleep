// @gosleep/web — GSL-376 a11y test for QuestionOptions option buttons.
//
// The rendered <button> concatenates label + description + pros + cons inside its
// children. Without an explicit aria-label the accessible name is that entire
// concatenation — screen readers announce the blob, and voice-control users cannot
// address a single option ("click Option A"). This test renders the component to
// static HTML via react-dom/server and asserts:
//   1. Each clickable button carries `aria-label` equal to the bare option label.
//   2. The visible body (label + description + pros/cons text) still renders so
//      sighted users are unaffected.
//   3. The non-clickable variant (onSelect === null) does NOT render <button> at all
//      and therefore has no aria-label to worry about.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { QuestionOptions } from "../src/screens/Questions";
import { normalizeOptions } from "../src/lib/questionOptions";

const FIXTURE = [
  {
    label: "Option A",
    description: "First choice.",
    pros: ["fast"],
    cons: ["opinionated"],
  },
  { label: "Option B", description: "Second choice.", pros: [], cons: [] },
];

describe("QuestionOptions accessible name (GSL-376)", () => {
  test("clickable option buttons carry aria-label with the bare option label", () => {
    const html = renderToStaticMarkup(
      createElement(QuestionOptions, {
        options: FIXTURE,
        // onSelect must be non-null to hit the <button> render path.
        onSelect: () => undefined,
      }),
    );
    // Regex — the pre-fix output has no aria-label at all on the option button.
    expect(html).toContain('aria-label="Option A"');
    expect(html).toContain('aria-label="Option B"');
    // And exactly one aria-label per option label — no accidental duplicates.
    const matchesA = html.match(/aria-label="Option A"/g) ?? [];
    const matchesB = html.match(/aria-label="Option B"/g) ?? [];
    expect(matchesA.length).toBe(1);
    expect(matchesB.length).toBe(1);
  });

  test("sighted body still renders label + description + pros/cons", () => {
    const html = renderToStaticMarkup(
      createElement(QuestionOptions, {
        options: FIXTURE,
        onSelect: () => undefined,
      }),
    );
    // The visible content must survive — the aria-label is additive, not a
    // replacement for the rich body.
    expect(html).toContain("Option A");
    expect(html).toContain("First choice.");
    expect(html).toContain("fast");
    expect(html).toContain("opinionated");
    expect(html).toContain("Second choice.");
  });

  test("non-clickable variant (onSelect=null) renders no <button> and no aria-label", () => {
    const html = renderToStaticMarkup(
      createElement(QuestionOptions, {
        options: FIXTURE,
        onSelect: null,
      }),
    );
    // Non-interactive path renders <div> rows — nothing screen-reader-focusable,
    // so aria-label is unnecessary and must not appear.
    expect(html).not.toContain("<button");
    expect(html).not.toContain("aria-label=");
  });

  test("normalizeOptions + QuestionOptions round-trip preserves aria-label parity", () => {
    // Belt-and-braces: the real Questions.tsx call site passes
    // normalizeOptions(...) into QuestionOptions. Prove the normalizer's shape
    // does not strip or mangle labels — the aria-label survives untouched.
    const raw = [{ label: "Do it" }, { label: "Skip it" }];
    const normalized = normalizeOptions(raw);
    const html = renderToStaticMarkup(
      createElement(QuestionOptions, {
        options: normalized,
        onSelect: () => undefined,
      }),
    );
    expect(html).toContain('aria-label="Do it"');
    expect(html).toContain('aria-label="Skip it"');
  });
});
