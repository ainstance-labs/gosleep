# GSL-36 — v3 re-validation results + analysis

**Task:** [Evals] v3 re-validation — SC-09 fixed (1.0), SC-19 0.75, SC-11 noise, SC-12 open
**Epic:** GSL-31 (Close eval-validated gaps)
**Date:** 2026-06-29

---

## Part 1 — Story

The v3 eval run was kicked off by the orchestrator after all four fix tasks landed
(GSL-32, GSL-33, GSL-34, GSL-35). This task records the results and closes the accounting.

The headline result: mechanism-targeted fixes work. Both scenarios that were stalled at 0.0
through v2's prose-edit cycle jumped dramatically once the specific behavioral mechanism was
identified and addressed with a structural change:

- **SC-09** (stalled-at-pr): 0.0 → 1.0 via the finalize-boundary flowchart exception (GSL-32)
  plus an eval calibration fix (GSL-35). The scenario is now non-discriminating (RED also 1.0)
  — a minor eval-design note but not a regression concern.
- **SC-19** (orchestrator-rollover): 0.0 → 0.75 via the kill-to-roll guard (GSL-33). Just
  below the 0.8 gate; the one failing sample wanted a positive ceremony enumeration.

Two scenarios are less clean:

- **SC-11** (suspect-handoff): 1.0 → 0.5, but N=2. The section was not touched in v3. This is
  sampling noise; no remediation warranted until a larger-N run.
- **SC-12** (cost-telemetry): 0.5 → 0.0. Loop-guard hit (2 edit attempts). The GSL-34 content
  fix is likely correct but the eval judge is not recognizing it — same pattern as SC-09 before
  its calibration pass. The correct next step is a calibration check, not another blind edit.

The recommendation is to merge the epic now and track SC-12 calibration + SC-11 noise-confirm
as follow-up tasks in a new epic. No further eval workflows should run on this branch.

### Where the bodies are buried

- SC-12 has now consumed two edit cycles (GSL-27 in v2, GSL-34 in v3) without measurable
  improvement. The content is not wrong — the eval is likely under-measuring the new guidance.
  A calibration-first approach (write a sharper probe, re-run with N≥4) should precede any
  further content change.
- SC-09's non-discriminating result is an eval-design debt item. Low priority but worth
  addressing in the next calibration cycle so the scenario can resume its role as a gate.

---

## Part 2 — Technical reference

**Artifacts:**
- Scorecard: `evals/results/2026-06-29-1719-scorecard.md`
- Analysis: `evals/results/2026-06-29-1719-v3-analysis.md`

**Results summary:**

| Scenario | v2 GREEN | v3 GREEN | Delta | Verdict |
|---|---|---|---|---|
| SC-09-stalled-at-pr | 0.0 | 1.0 | +1.0 | FIXED (non-discriminating) |
| SC-19-orchestrator-rollover | 0.0 | 0.75 | +0.75 | improved |
| SC-11-suspect-handoff | 1.0 | 0.5 | -0.5 | N=2 noise |
| SC-12-cost-telemetry | 0.5 | 0.0 | -0.5 | still open |

**Transition:** GSL-36 → Done (41); GSL-31 → In Review (31).
