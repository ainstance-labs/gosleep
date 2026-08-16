// GSL-398 (m-3) — question terminal transitions must invalidate /fleet.
//
// E2E run-02: after the fixture answered its AskUserQuestion, the Fleet card kept
// `CURRENT TOOL: AskUserQuestion` for the entire remainder of the run. `curl /fleet`
// returned `current_tool: null` (server had cleared it via the tool-observed feeder debounce),
// but useFleet has no `refetchInterval` — it relies entirely on SSE-driven invalidation, and
// the pre-fix dispatcher's `question.` branch scheduled only `questions` (never `fleet`).
//
// Fix: `sseRootsFor` bumps `fleet` in addition to `questions` when a question row transitions
// past `open` (answered / deferred / reopened). The refactor path (GSL-397) put the dispatcher
// under test — this file layers m-3 on top with a red-first check.

import { describe, expect, test } from "bun:test";

import { sseRootsFor } from "../src/data/sseDispatch";

describe("question.* terminal transitions invalidate /fleet (m-3)", () => {
  test("question.answered → questions AND fleet", () => {
    const roots = sseRootsFor("question.answered");
    expect(roots).toContain("questions");
    expect(roots).toContain("fleet");
  });

  test("question.deferred → questions AND fleet", () => {
    const roots = sseRootsFor("question.deferred");
    expect(roots).toContain("questions");
    expect(roots).toContain("fleet");
  });

  test("question.reopened → questions AND fleet", () => {
    const roots = sseRootsFor("question.reopened");
    expect(roots).toContain("questions");
    expect(roots).toContain("fleet");
  });
});

describe("question.posed stays narrowly scoped", () => {
  test("question.posed schedules questions but NOT fleet", () => {
    // Posing a question doesn't shift server-side agent_sessions.current_tool immediately;
    // the tool-observed feeder debounces and eventually emits agent_sessions.updated for the
    // fleet key. Piggybacking fleet on every question.posed would double the refetch
    // volume for no gain.
    const roots = sseRootsFor("question.posed");
    expect(roots).toContain("questions");
    expect(roots).not.toContain("fleet");
  });
});
