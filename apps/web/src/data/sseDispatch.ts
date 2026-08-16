// @gosleep/web — SSE type → query-key dispatcher (GSL-397 / GSL-398 extraction).
//
// Pure function: given an incoming SSE event `type` string, return the list of TanStack Query
// key roots whose caches should be invalidated. Pinned by apps/web/test/sseInvalidations.test.ts
// so the dispatcher contract can drift only via a failing test.
//
// Rules encoded here (each rule is one line in the switch below):
//   * every event bumps `timeline` (the event feed itself renders every row).
//   * `question.*`          → questions.
//       - `question.answered` / `question.deferred` / `question.reopened` also invalidate
//         `fleet`. GSL-398 (m-3): server clears `agent_sessions.current_tool` when the
//         session transitions past its blocking question but no `agent_sessions.updated`
//         fires; without a fleet invalidation here the Fleet card keeps the pre-answer tool
//         label forever (useFleet has no refetchInterval).
//   * `permission.*`        → questions. GSL-397 (m-2): the pre-fix dispatcher had a
//     `question.` branch but no `permission.` branch, so a fresh permission.posed row was
//     invisible on /questions until the operator reloaded.
//   * `task.submitted` / `task.submit.failed` → submissions + fleet (a failed submission may
//     flip control_state, and the submissions drawer shows both outcomes).
//   * `task.*` / `tasks.*`   → tasks.
//   * `skill.*`              → skills.
//   * `cost.*`               → cost.
//   * `agent_sessions.*` / `agent.*` → fleet.
//   * `sessions.control.*`   → fleet + sessions + observed (control-registry projections
//     ride on all three views).
//   * `sessions.submissions.updated` → submissions.
//   * anything else          → nothing beyond timeline (fail-open).
//
// `SseProvider` iterates the returned list and calls the coalescing invalidator once per
// root so a burst still collapses inside the 250 ms window.

export function sseRootsFor(type: string): string[] {
  const roots: string[] = ["timeline"];

  if (type.startsWith("question.")) {
    roots.push("questions");
    // GSL-398 (m-3) is layered on top of this branch in a follow-up commit; see the second
    // describe() block in apps/web/test/sseInvalidations.test.ts.
    return roots;
  }

  // GSL-397 (m-2) — permission.posed / .answered / .denied all need the /questions view to
  // refresh (permission rows live in the same table and render as Allow/Deny cards).
  if (type.startsWith("permission.")) {
    roots.push("questions");
    return roots;
  }

  if (type === "task.submitted" || type === "task.submit.failed") {
    roots.push("submissions", "fleet");
    return roots;
  }
  if (type.startsWith("task.") || type.startsWith("tasks.")) {
    roots.push("tasks");
    return roots;
  }
  if (type.startsWith("skill.")) {
    roots.push("skills");
    return roots;
  }
  if (type.startsWith("cost.")) {
    roots.push("cost");
    return roots;
  }
  if (type.startsWith("agent_sessions.") || type.startsWith("agent.")) {
    roots.push("fleet");
    return roots;
  }
  if (type.startsWith("sessions.control.")) {
    roots.push("fleet", "sessions", "observed");
    return roots;
  }
  if (type === "sessions.submissions.updated") {
    roots.push("submissions");
    return roots;
  }

  return roots;
}
