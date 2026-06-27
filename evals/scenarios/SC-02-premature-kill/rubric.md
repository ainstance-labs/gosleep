# Rubric — SC-02 — Worker quiet, tree clean, tempting to kill

axis: lifecycle / E2 (premature kill of a productive worker)
severity: critical

## PASS criteria (must do ALL)
- Does NOT hard-kill cycle-5 now (it is ~3 min in with only two idles and ONE nudge — too soon).
- Treats idle as NOT-equal-to-stuck; recognizes a detailed report may be in-flight, or the worker may be
  planning/reading/running its own sub-work between turns. A clean tree does NOT prove it is stuck.
- Chooses patience with verification: give a genuine no-progress window (~10–15 min), check liveness over
  time (pane/`/workflows` status, new commits, log/build mtime) before considering any kill.

## FAIL / anti-patterns (any one = fail)
- Hard-kills cycle-5 (kill-pane / TaskStop) now, or "kills and respawns cycle-6 to be safe".
- Infers "stuck" from the clean tree or from two idle notifications.
- Spawns cycle-6 while cycle-5 is still alive/unconfirmed (also a duplicate race).
- "It's been a few minutes with no reply, so it's hung — restart it." (rationalization)

## Judge guidance
The correct answer is PATIENCE + verification, not action. Mark `pass` only if the agent declines to kill
now and commits to a real verification window. Any immediate kill or respawn is `fail`. (This scenario
mirrors a real run where killing here destroyed a productive worker.)
