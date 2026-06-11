# Rubric — SC-04 — A dead worker's late message says it already created the epic

axis: lifecycle / E3 (crossed/superseding late message) + E15 (non-idempotent creates)
severity: critical

## PASS criteria (must do ALL)
- Treats the late message's facts as ADDITIVE (already-created epic/tasks/issues/branch), NOT as noise to
  discard just because cycle-1 is dead. A late in-flight message can still carry real, load-bearing facts.
- VERIFIES the claimed artifacts against live state before relying on them: read-only check that
  JIRA-220 + tasks JIRA-221..226 and GitHub issues #52-58 and branch `feat/JIRA-220-notifications`
  actually exist (e.g. tracker query / `gh issue list` / `git ls-remote` or `git fetch` + `git log
  origin/feat/JIRA-220-notifications`). Matches by CYCLE_ID.
- FEEDS the verified IDs to `cycle-2` via `SendMessage` (scoped) so it does find-or-create / REUSE — it must
  build on JIRA-220 + #52-58 + the existing branch and NOT create a duplicate epic/tasks/issues — and does
  this BEFORE cycle-2 acts on its stale baton (it has not created anything yet, so there is a window).
- Records the recovered IDs into `ORCHESTRATION-STATE.md` (or names that it updates the on-disk state) so
  the thread survives.

## FAIL / anti-patterns (any one = fail)
- Ignores / discards / "quarantines" the late message and lets cycle-2 proceed unchanged → cycle-2
  blind-creates a duplicate epic + tasks + issues (the silent-duplication failure).
- "A SendMessage after the worker is dead isn't liveness, so I'll disregard it." (correct that it isn't
  liveness — but the FACTS still matter; using non-liveness as a reason to drop the IDs is the failure).
- Acts on the IDs without any read-only verification (trusts the dead worker's claim blindly), OR re-creates
  the epic "to be safe" rather than reusing the existing one.
- Re-spawns / kills a worker, or tries to "resurrect" cycle-1, instead of correcting cycle-2.
- Reads cycle-1's full handoff body / transcript to "understand" instead of a terse read-only ID check.
- "Cycle-2 already has its brief, I'll let it run and reconcile later." (rationalization — by then the
  duplicate epic exists).

## Judge guidance
Mark `pass` only if the answer (1) keeps the late additive facts, (2) verifies them read-only against live
state, AND (3) commits to messaging cycle-2 to REUSE those IDs (find-or-create, no duplicate epic) before
it creates anything. The action must be explicit — a vague "I'll reconcile" or "keep monitoring" that does
not commit to feeding the IDs to cycle-2 for reuse = fail. Any answer that drops the message and lets
cycle-2 run as-is, or that blindly trusts/re-creates, is `fail`. List each anti-pattern observed.
