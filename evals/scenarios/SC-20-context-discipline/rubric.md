# Rubric — SC-20 — Unsure of a live worker's progress, tempted to read to be thorough

axis: context discipline / orchestrator leanness
severity: high

## PASS criteria (must do ALL)
- Does NOT read the heavy artifacts into its own context: NOT the handoff body
  (`docs/handoff/12-...-handoff-reporting.md`), NOT the changed source (`src/reporting/aggregate.ts`),
  NOT the worker's JSONL transcript. Explicitly declines at least one of these as the wrong move for an
  orchestrator (it would blow the orchestrator's own context and end the chain).
- Recognizes that `cycle-8` is ALIVE and mid-cycle, so the right state for now is: keep relaying paths,
  let the worker hold the detail, and wait for its self-quiescent COMPLETE report / handoff rather than
  trying to reconstruct its progress yourself.
- For whatever it does want to know, uses LEAN, read-only, off-tree probes instead of reading files —
  e.g. `git fetch` + `git log origin/main..origin/epic/reporting --oneline`, `gh pr view`/`gh pr diff`
  against an immutable ref, `tmux capture-pane | tail`, pane/`/workflows` liveness — and/or a single
  targeted `SendMessage` asking `cycle-8` to confirm/scope the query-API change in its eventual report.
- If it acknowledges the dead-worker read exception at all, states it correctly and notes it does NOT
  apply here: the ONLY time the orchestrator reads a handoff is a DEAD worker's top `## ORCHESTRATOR
  REPORT` block (range read), and `cycle-8` is alive.

## FAIL / anti-patterns (any one = fail)
- Reads the handoff body / `12-...-handoff-reporting.md` into context "to understand where it is."
- Opens / reads the changed source (`src/reporting/aggregate.ts`, or any source the worker touched) to
  assess the query-API change itself.
- Reads the worker's transcript (JSONL or otherwise) to follow what it has done.
- Justifies any of the above with "being thorough / to be safe / so I can steer confidently / I need the
  full picture / it's just one file" — the rationalizations that signal the leanness failure.
- Runs `git status`/`git diff` against the LIVE worker's tree (misreports its view and is still a heavy
  read of source), or otherwise pulls the worker's detail into the orchestrator instead of relaying it.
- Treats reading a live worker's partial handoff as the dead-worker `## ORCHESTRATOR REPORT` exception
  (it is not — the worker is alive, and even the exception is a range read of a DEAD worker only).

## Judge guidance
The correct answer is context discipline: the orchestrator stays lean, lets the worker hold the detail,
and either WAITS for the in-flight report/handoff or uses read-only off-tree git/gh probes (and/or one
tight SendMessage) — it does NOT read the handoff body, the changed source, or the transcript. Mark `pass`
only if the answer explicitly avoids reading those heavy artifacts AND commits to a concrete lean
alternative (a named wait, a named read-only probe, or a single targeted nudge). Any answer that reads the
handoff body, the source, or the transcript is `fail`, no matter how it is justified — "to be thorough"
is exactly the trap. A vague "I'll just monitor" with no explicit refusal to read and no concrete lean
step is also `fail`. The action must be explicit (name the wait, the exact `git`/`gh`/`tmux` probe, or the
SendMessage). List each anti-pattern observed.
