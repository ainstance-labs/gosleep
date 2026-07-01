# GSL-39 — SC-09 restore discrimination — prompt states facts, agent must infer elapsed ceiling

**Epic:** GSL-37 — Remaining gaps & eval-quality after v3
**Branch:** GSL-37-eval-quality
**Phase:** v3 follow-up — eval quality

---

## Part 1 — Story

### Problem
After the GSL-35 recalibration, `evals/scenarios/SC-09-stalled-at-pr/prompt.md` became non-discriminating:
it explicitly told the agent that "the no-report hard ceiling (~45 min) has elapsed" and called it "a
finalize-boundary stall with the patience window expired." Even a no-skill (RED-arm) agent that simply reads
those phrases understands the expected action, so RED=GREEN=1.0 — the scenario no longer isolated whether
the agent knew the skill's finalize-boundary flowchart or was just reading the prompt's conclusion.

### Root cause
GSL-35 overcorrected from the previous failure (agents not nudging because they saw a live pane as "wait
and see"). To make the timer criterion unambiguous, it spelled out the ceiling-elapsed conclusion directly
in the prompt. This removed all inference work from the agent.

### Fix
Revised `prompt.md` to present only observable facts:
- All 9 task commits pushed, no new commits for ~47 minutes
- Worker's last SendMessage ~47 minutes ago
- Tmux pane still alive; last idle notification ~90 seconds ago
- No PR, no handoff file, no report of any kind

Removed every sentence that pre-announced the conclusion ("ceiling elapsed", "patience window expired",
"finalize-boundary stall"). The agent must now INFER from the ~47-min-no-report timestamp that the ~45-min
no-report ceiling has passed — which is exactly what the skill's finalize-boundary flowchart exception
teaches. A no-skill agent is significantly less likely to make this connection without coaching.

Also updated the rubric's "Patience window note" to drop the phrase "the prompt explicitly states" (which
was accurate under the old prompt but misleading under the new one) and instead clarify that ~47 min
no-report IS past the ceiling, for grader reference.

The rubric's PASS/FAIL criteria are unchanged (still: ONE gentle nudge to cycle-3, no kill, no spawn).

### Expected outcome
- GREEN arm (skill-following agent): reads the 47-min timestamp, maps it to the ~45-min no-report ceiling
  via the flowchart, sends exactly one nudge. PASS.
- RED arm (no-skill agent): sees a live pane and recent (90s) idle, likely defaults to "wait and see" or
  doesn't connect 47 min to a specific ceiling. More likely to FAIL → restores RED < GREEN discrimination.

---

## Part 2 — Technical reference

**Files changed:**
- `evals/scenarios/SC-09-stalled-at-pr/prompt.md` — removed "ceiling elapsed / patience window expired"
  conclusion; kept timestamp facts (47 min no-report, pane alive, 90s idle)
- `evals/scenarios/SC-09-stalled-at-pr/rubric.md` — updated judge guidance note wording only; PASS/FAIL
  criteria unchanged

**Key removal:** The sentence "The branch has been fully pushed (no new commits) for approximately 47 minutes
— the no-report hard ceiling (~45 min) has elapsed; this is a finalize-boundary stall with the patience
window expired, not an in-flight worker still within its window." was deleted.

**Skill reference:** `orchestrating-delivery-agents` SKILL.md — E8 stall handling, finalize-boundary
flowchart exception (introduced in GSL-32, SC-09 timing awareness in GSL-35).

**Do NOT test here.** Orchestrator validates via a Sonnet pane agent on explicit owner direction.
