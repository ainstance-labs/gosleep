// GSL-397 (m-2) + GSL-398 (m-3) — SSE-type → query-key dispatcher.
//
// The SseProvider (apps/web/src/data/SseProvider.tsx) fans an incoming SSE event out to a set
// of TanStack Query invalidations. E2E run-02 flagged two dispatcher gaps:
//
//   * m-2 (GSL-397): fresh `permission.posed` did NOT push to /questions via SSE (owner had to
//     reload). `question.posed` DID push live because a `question.` branch existed; the
//     `permission.` prefix had no branch at all.
//
//   * m-3 (GSL-398): after answering an AskUserQuestion the Fleet card kept the pre-answer
//     `current_tool` value for the entire run. Server had cleared it; the client cache was
//     stale because `useFleet` has no refetchInterval and no `question.answered` -> fleet
//     invalidation existed.
//
// The dispatcher lives in `sseRootsFor(type)` — a pure function extracted from SseProvider so
// this test can pin the contract without booting React.

import { describe, expect, test } from "bun:test";

import { sseRootsFor } from "../src/data/sseDispatch";

describe("sseRootsFor — GSL-397 permission.* pushes to /questions", () => {
  test("permission.posed schedules the questions bucket (m-2)", () => {
    // Red-first: pre-fix, this returned only ["timeline"] because no branch matched.
    expect(sseRootsFor("permission.posed")).toContain("questions");
  });

  test("permission.answered / permission.denied also push /questions", () => {
    expect(sseRootsFor("permission.answered")).toContain("questions");
    expect(sseRootsFor("permission.denied")).toContain("questions");
  });

  test("every dispatch still bumps timeline (parity with question.*)", () => {
    expect(sseRootsFor("permission.posed")).toContain("timeline");
  });
});

// GSL-398 (m-3) — question terminal transitions invalidate /fleet — lives in
// apps/web/test/sseFleetInvalidateOnQuestionAnswered.test.ts (added by the next commit).

describe("sseRootsFor — existing contracts still hold", () => {
  test("task.submitted stays wired to submissions + fleet + timeline", () => {
    const roots = sseRootsFor("task.submitted");
    expect(roots).toContain("submissions");
    expect(roots).toContain("fleet");
    expect(roots).toContain("timeline");
  });

  test("agent_sessions.updated stays wired to fleet + timeline (no questions)", () => {
    const roots = sseRootsFor("agent_sessions.updated");
    expect(roots).toContain("fleet");
    expect(roots).toContain("timeline");
    expect(roots).not.toContain("questions");
  });

  test("sessions.control.* still invalidates fleet + sessions + observed", () => {
    const roots = sseRootsFor("sessions.control.take");
    expect(roots).toContain("fleet");
    expect(roots).toContain("sessions");
    expect(roots).toContain("observed");
  });

  test("an unknown event type still bumps timeline (never nothing)", () => {
    expect(sseRootsFor("some.unknown.event")).toEqual(["timeline"]);
  });
});
