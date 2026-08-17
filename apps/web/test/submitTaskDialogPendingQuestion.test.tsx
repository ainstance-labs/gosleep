// @gosleep/web — GSL-402 unit test for the Submit-task dialog's pending-question banner.
//
// E2E run-03 finding m2: with the fixture parked on a pending AskUserQuestion (long-poll
// active in the shim), opening Submit task on the same session's Fleet card produced the
// normal preview modal — no banner, no chip, no colour cue. The message queued correctly
// under Claude Code's "Press up to edit queued messages" — no data was lost — but if the
// owner intended the text as an ANSWER to the question, it would silently miss the
// AskUserQuestion tool_input and land as a follow-on prompt.
//
// Fix: SubmitTaskDialog now accepts an optional `hasOpenQuestion` prop. When true, the
// dialog renders an info banner with a fixed sentinel string so the owner knows the text
// will queue behind the pending question rather than answer it. Non-blocking — the Send
// action is unchanged; the banner is advisory.
//
// This test renders the banner sub-component in static markup via react-dom/server. The
// full SubmitTaskDialog wraps its children in a Radix Dialog Portal which does not render
// in `renderToStaticMarkup` (portal target is a DOM node created at mount time); a
// small stateless banner sub-component is the correct testable surface.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
  SubmitTaskPendingQuestionBanner,
  PENDING_QUESTION_BANNER_TEXT,
} from "../src/components/SubmitTaskDialog";

describe("SubmitTaskPendingQuestionBanner (GSL-402)", () => {
  test("renders the fixed advisory sentence exactly", () => {
    const html = renderToStaticMarkup(
      createElement(SubmitTaskPendingQuestionBanner, {}),
    );
    // Owner-facing sentence — exact text is a contract, not a suggestion. Changing
    // the wording is a behaviour change (docs referring to it break silently) so the
    // test pins the constant AND the rendered output against the same expected value.
    expect(PENDING_QUESTION_BANNER_TEXT).toBe(
      "This session has an open question — the text will queue until the question is answered.",
    );
    expect(html).toContain(PENDING_QUESTION_BANNER_TEXT);
  });

  test("carries a stable testid so the E2E harness can grep for it", () => {
    const html = renderToStaticMarkup(
      createElement(SubmitTaskPendingQuestionBanner, {}),
    );
    expect(html).toContain('data-testid="submit-task-pending-question-banner"');
  });

  test("uses the role='note' semantic that Radix + screen readers announce", () => {
    // The existing "guardrails" banner in the same dialog uses role="note" — the
    // pending-question banner should match so screen-reader users get a consistent
    // announcement pattern. renderToStaticMarkup output is stable HTML so a plain
    // .toContain assertion is enough.
    const html = renderToStaticMarkup(
      createElement(SubmitTaskPendingQuestionBanner, {}),
    );
    expect(html).toContain('role="note"');
  });
});
