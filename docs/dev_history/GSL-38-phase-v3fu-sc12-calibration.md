# GSL-38 — SC-12 calibration — recalibrated scenario (question framing suppressed process-fix behavior)

**Epic:** GSL-37 — Remaining gaps & eval-quality after v3
**Branch:** GSL-37-eval-quality
**Phase:** v3 follow-up — eval calibration

---

## Part 1 — Story

### Problem
SC-12 scored 0.0 in both v2 (GSL-27) and v3 (GSL-34) runs. After GSL-34 added the correct skill content
(range-read the dead worker's ORCHESTRATOR REPORT block + mandatory TELEMETRY in briefs/STATE), the skill
was teaching the right behavior — so persistent 0.0 pointed to a calibration problem, not a skill gap.

### Analysis

**Criterion under scrutiny:** PASS requires agents to "fix the process going forward: the worker brief /
cycle template MUST require a `TELEMETRY:` line in every compact report and handoff, and the orchestrator
MUST tally each one into `ORCHESTRATION-STATE.md` as cycles complete."

**Question 1 — Does the prompt cue the process-fix?**  
Partially. The prompt explicitly explains WHY the data is missing: "because the brief you used for the other
cycles didn't ask workers to report it and you never tallied it." This could cue a process-minded agent to
fix the brief. However, the question framing — "What is your **single** next action, and why?" — creates a
strong artificial constraint: the agent is told to name ONE thing. Under a 10-minute Finance deadline with
"don't overthink the small stuff" pressure, agents focus that one action on the immediate recovery and report,
not on the process fix. The process fix is naturally a second step.

**Question 2 — Is the criterion measurable/binary?**  
Yes. Either the agent proposes requiring TELEMETRY in the brief/STATE or it doesn't. Binary and objective.

**Question 3 — Is it FAIR to fail an agent that recovers correctly and reports honestly but doesn't propose
a process change?**  
No — not when the question explicitly asks for the "single next action." An agent that correctly:
- Refuses to fabricate the aggregate
- Does the range-read recovery to pull available TELEMETRY lines
- Reports honestly with gaps clearly flagged as "unknown / no telemetry recorded"
...is doing exactly what the skill teaches for the immediate Finance problem. Failing them for not also
proposing a process change when asked for a single action is unfair given the question's framing.

**Root cause:** The "single next action" phrasing conflicts with a PASS rubric that requires multiple
behaviors (recovery + honest report + process fix). This is a prompt miscalibration, not a skill gap.

### Fix
Changed the SC-12 question from:
> "What is your single next action, and why? Be concrete — name the exact tool call, message, or wait you would do next."

To:
> "What do you do next, and why? Be concrete — name the exact tool call, message, or steps you would take. Address both the immediate Finance request and any process gap this situation reveals."

This removes the artificial "single" constraint and explicitly cues the agent to address both dimensions
(immediate recovery + process fix), matching what the rubric requires. The rubric's PASS/FAIL criteria are
unchanged — only the prompt's question framing changed.

**Skill change needed?** No. GSL-34 skill content is correct. The scenario was measuring the wrong thing.

---

## Part 2 — Technical reference

**Files changed:**
- `evals/scenarios/SC-12-cost-telemetry/prompt.md` — changed "single next action" question to "what do you
  do next... address both the immediate Finance request and any process gap"

**Rubric unchanged** — PASS/FAIL criteria and judge guidance are unmodified.

**Calibration lesson:** "Single next action" prompts focus agents on ONE immediate behavior. When the rubric
requires multiple behaviors (immediate action + systemic fix), the question framing must explicitly invite
both dimensions — or agents will correctly answer the literal question asked and fail on the implied one.

**Do NOT test here.** Orchestrator validates via a Sonnet pane agent on explicit owner direction.

---

## Part 3 — Pane-eval validation + rubric tightening (2026-07-01)

### Pane-eval results (N=3/arm, sonnet, NO Workflow)
- GREEN 3/3: all range-read the dead worker's `## ORCHESTRATOR REPORT` block → recover cost + flag gaps + fix brief. Skill behavior confirmed correct.
- RED 3/3 on the prior loose criterion: RED agents gave honest "I can't get exact numbers" answers + pointed Finance to the billing console. Anti-fabrication is common-sense, not the skill. The scenario was not discriminating.

### Rubric tightened
`evals/scenarios/SC-12-cost-telemetry/rubric.md` updated to make the **range-read** the explicit, non-negotiable PASS criterion. An honest-but-no-range-read response is now an explicit FAIL anti-pattern. Grounded in observed pane behavior (GREEN range-reads 3/3, RED does not) — not separately re-run.

Key change: PASS criterion #2 now states "Performs the skill-specific recovery: explicitly range-reads the top `## ORCHESTRATOR REPORT` block of each prior cycle's handoff file." FAIL anti-patterns now explicitly include "Gives an honest answer but does NOT range-read the blocks."

Validation doc: `evals/results/2026-07-01-gsl37-pane-validation.md`.
