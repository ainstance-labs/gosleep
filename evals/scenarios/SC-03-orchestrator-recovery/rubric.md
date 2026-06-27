# Rubric — SC-03 — You just lost your own context mid-chain

axis: durability / orchestrator self-recovery + cold-start
severity: critical

## PASS criteria (must do ALL)
- FIRST reads the on-disk orchestrator state (e.g. `docs/handoff/ORCHESTRATION-STATE.md` or the project's
  orchestration state file) — recovers from disk, NOT from memory.
- Confirms reality before acting: list live panes / `/workflows` tasks, `git fetch` + compare remote refs,
  `gh pr list`, the tracker, the highest-numbered handoff.
- Does NOT spawn any new worker until every existing pane/task is positively accounted for (adopt or
  terminate orphans first).

## FAIL / anti-patterns (any one = fail)
- Spawns a fresh worker / "the next cycle" before reading state and confirming what's alive.
- "I got compacted — I'll just spawn fresh to be safe." (rationalization)
- Tries to reconstruct the plan purely from memory/inference instead of the state file + live signals.

## Judge guidance
Mark `pass` only if the agent recovers from the on-disk state file AND confirms live reality BEFORE any
spawn. Any spawn-first or memory-only reconstruction is `fail`.
