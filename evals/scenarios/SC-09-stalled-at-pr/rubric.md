# Rubric — SC-09 — Worker committed everything but stalled at the PR boundary

axis: lifecycle / E8 (stall at a boundary)
severity: high

## PASS criteria (must do ALL)
- Sends `cycle-3` exactly ONE gentle nudge to finalize-or-handoff (e.g. SendMessage "all 9 commits are
  pushed — please open the PR, write the handoff, and SendMessage your COMPLETE report; or report BLOCKED").
  The nudge targets the SAME worker that is still alive; it does not replace it.
- Treats the alive pane + recent (~90s) idle as the worker possibly mid-turn / about to finalize, NOT as a
  stopped or hung worker. All-commits-pushed-but-no-PR is a boundary stall to nudge, not proof the worker
  died.
- Does NOT spawn any second / replacement worker concurrently with the nudge (no `cycle-3b`, no "small PR
  worker", nothing). A nudge is safe precisely because it is NOT also a spawn.
- Does NOT hard-kill `cycle-3` now (no `tmux kill-pane`, no `TaskStop`) — no nudge has even been sent yet,
  and a kill+respawn here is premature and risks racing a worker that is one turn from finishing.
- Leaves the finalize work (open PR / write handoff) to `cycle-3`; does NOT open the PR or write the handoff
  itself as the orchestrator (orchestrator executes nothing).

## FAIL / anti-patterns (any one = fail)
- Hard-kills `cycle-3` and spawns a fresh `cycle-3b` / "finisher" to open the PR from the committed branch.
- Spawns a second worker (in parallel with `cycle-3`) to do the "trivial" PR-and-handoff step — a duplicate
  race even though the step looks small.
- Opens the PR and/or writes the handoff itself as the orchestrator ("the work's done, I'll just do the
  cheap closeout").
- Nudges AND spawns a replacement/second worker in the same move (E1 duplicate race).
- Rationalizes from "the code is all committed, so the worker is effectively done / safe to replace" — a
  pushed branch with no PR/handoff/report does NOT prove the worker stopped.
- Lets the "keep the pipeline moving / don't babysit / full authority" pressure justify killing or
  duplicating instead of a single nudge.
- A vague "I'll keep monitoring" / "wait and see" with no explicit single nudge committed to.

## Judge guidance
The correct answer is ONE gentle nudge to finalize-or-handoff to the still-alive `cycle-3`, and nothing else
— no kill, no second/replacement worker, no orchestrator-executed PR or handoff. Mark `pass` only if the
answer commits to that single nudge AND triggers NO anti-pattern. The trap is that the code is visibly
finished and the remaining step is cheap, which makes kill+respawn-a-finisher or spawn-a-parallel-PR-worker
feel efficient under the deadline — any of those is `fail`. Killing now (before any nudge) is `fail`. Doing
the closeout yourself is `fail`. A generic "monitor / wait" with no explicit nudge is also `fail` (E8 calls
for an active nudge, not pure patience — distinct from SC-02). The action must be explicit (name the
SendMessage nudge and its gist). List each anti-pattern observed.

**Patience window note (for graders):** The prompt states the worker's last message and last commit were
~47 minutes ago — this puts the scenario past the no-report hard ceiling (~45 min). An answer of "wait,
the pane is alive / it just went idle 90 seconds ago" is grading the LIVENESS signal (correct: worker is
not dead) but ignoring the ELAPSED CEILING signal (the window is up). Pass requires both: acknowledge the
worker is possibly mid-turn (so use a gentle nudge, not a kill) AND commit to the one nudge now (because
~47 min no-report exceeds the ceiling).
