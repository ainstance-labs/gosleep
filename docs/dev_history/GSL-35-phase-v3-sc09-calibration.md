# GSL-35 — SC-09 Calibration Investigation

**Task:** GSL-35  
**Epic:** GSL-31 (close eval gaps — v3)  
**Branch:** GSL-31-close-eval-gaps  
**Date:** 2026-06-29  
**Phase:** v3 — SC-09 calibration

---

## What was done

Investigated whether the SC-09-stalled-at-pr eval inversion (RED 1.0, GREEN 0.0 in v2) was caused by
a miscalibrated eval or a genuine skill deficiency. Outcome: **(A) MISCALIBRATED** — prompt fixed.
GSL-32 skill fix remains warranted.

---

## Root cause of the inversion

The SC-09 scenario has two liveness signals:
1. **Time signal:** worker has been running 50 minutes, all commits pushed — the ~45-min no-report
   hard ceiling is past.
2. **Recency signal:** "About 90 seconds ago cycle-3 emitted an idle notification; pane is still alive."

The skill's liveness flowchart routes `pane alive → "Alive/moving → WAIT"` *before* it checks time
thresholds. A skill-following agent correctly reads the 90-second idle + alive pane as "within patience
window" and defaults to "keep monitoring" — which fails the rubric.

The prompt never explicitly said the patience window had elapsed. This made it ambiguous: the worker
*could* have been at the PR boundary for only 90 seconds (window not elapsed → wait is correct) or for
47 minutes (window elapsed → nudge is correct). Skill-following agents resolved the ambiguity in favor
of the prominent recency signal, landing on "vague monitoring" = rubric FAIL.

---

## What changed

**`evals/scenarios/SC-09-stalled-at-pr/prompt.md`** — added one sentence after the 90-second idle
line explicitly stating the patience window is expired:

> "The branch has been fully pushed (no new commits) for approximately **47 minutes** — the no-report
> hard ceiling (~45 min) has elapsed; this is a finalize-boundary stall with the patience window
> expired, not an in-flight worker still within its window."

**`evals/scenarios/SC-09-stalled-at-pr/rubric.md`** — added a "Patience window note" to judge
guidance clarifying that an answer of "wait, the pane is alive" is grading liveness correctly but
ignoring the elapsed ceiling, and must be failed.

---

## Why GSL-32 skill fix is still needed

Even with the prompt fix making the elapsed window explicit, the skill's flowchart still routes
`pane alive → WAIT` without first checking time thresholds. A skill-following agent reading the
flowchart will still go to WAIT at the liveness step and never reach the time-ceiling check.

The recommended GSL-32 approach: add a **finalize-boundary exception** to the liveness flowchart —
something like: *"at a finalize boundary (all tasks committed, no PR/report), check time ceiling
FIRST before defaulting to WAIT. If ceiling elapsed → ONE nudge regardless of pane state."* This
prevents the patience framing from winning over the active-nudge rule at the specific boundary
where the nudge is required.

---

## Files changed

- `evals/scenarios/SC-09-stalled-at-pr/prompt.md` — added patience-window-elapsed sentence
- `evals/scenarios/SC-09-stalled-at-pr/rubric.md` — added judge patience-window note
- `docs/dev_history/GSL-35-phase-v3-sc09-calibration.md` — this file
- `docs/dev_history/README.md` — index entry added
