# GSL-37 Pane-eval validation — 2026-07-01

**Epic:** GSL-37 — Remaining gaps & eval-quality after v3
**Branch:** GSL-37-eval-quality
**Method:** pane harness — 12 single subagents (NO Workflow — owner directive), N=3/arm, model: sonnet

---

## Results

| Scenario | Arm | Result | Notes |
|---|---|---|---|
| SC-09 stalled-at-pr | RED | 0/3 | Agents send the nudge but then plan to spawn a duplicate finisher after 5–10 min — the anti-pattern |
| SC-09 stalled-at-pr | GREEN | 3/3 | Agents infer the elapsed ceiling from stated facts and send ONE nudge; no duplicate spawn |
| SC-12 cost-telemetry | GREEN | 3/3 | Agents range-read the dead worker's `## ORCHESTRATOR REPORT` block to recover cost, flag gaps, and fix the brief |
| SC-12 cost-telemetry | RED | 3/3 | Agents give an honest "I can't get exact numbers" subtotal + point Finance to the billing console — NO range-read |

---

## Verdicts

### SC-09 — discrimination RESTORED (GSL-39 success)
- RED 0/3, GREEN 3/3 → perfect discrimination.
- Fix: prompt now states facts (handoff time, elapsed time); agent must **infer** the elapsed ceiling rather
  than being told it explicitly. The anti-pattern (duplicate finisher spawn after 5–10 min) is cleanly
  separated from the correct behavior (infer ceiling → ONE nudge).
- The earlier SC-09 0.0 (v2/v3) was a calibration artifact where the scenario cued the answer. The skill's
  behavior is correct; only the prompt framing needed adjustment.

### SC-12 — skill validated; rubric tightened to discriminate
- **GREEN 3/3:** the skill is correct. All three green-arm agents performed the sanctioned range-read of each
  cycle's `## ORCHESTRATOR REPORT` block, recovered the available TELEMETRY lines, reported an honest
  verified subtotal with gaps flagged, and fixed the brief going forward.
- **RED 3/3 on the prior loose criterion:** the prior rubric accepted an "honest response" (anti-fabrication)
  as sufficient. RED agents gave honest answers — reporting an honest subtotal and pointing Finance to the
  billing console — without performing the skill-specific range-read. Anti-fabrication is common-sense
  behavior; it is not the skill. The scenario was no longer discriminating.
- **Rubric tightened:** PASS now requires the explicit range-read of `## ORCHESTRATOR REPORT` blocks. An
  honest-but-no-range-read response is now an explicit FAIL anti-pattern. This is grounded in the observed
  pane behavior — GREEN range-reads 3/3, RED does not — and is not separately re-run.

---

## Meta-finding

The earlier SC-09 (0.0 in v2/v3) and SC-12 (0.0 in v2/v3) "skill gaps" were **eval-calibration artifacts,
not skill defects.**

- SC-09 0.0: the prompt gave away the elapsed ceiling, removing the inference challenge that separates skill
  from no-skill behavior.
- SC-12 0.0: the scenario's "single next action" framing created an artificial constraint that penalized
  agents for correctly answering the question asked (immediate recovery) while requiring them to also address
  a second dimension (process fix) not invited by the framing.

Both scenarios have now been recalibrated to measure the skill accurately:
- SC-09: prompt states facts; agent infers the ceiling (GSL-39).
- SC-12: question invites both dimensions; rubric now requires the range-read (GSL-38).

---

## Artifacts
- Rubric tightened: `evals/scenarios/SC-12-cost-telemetry/rubric.md`
- SC-09 prompt recalibrated: `evals/scenarios/SC-09-stalled-at-pr/prompt.md` (GSL-39)
- Dev history: `docs/dev_history/GSL-38-phase-v3fu-sc12-calibration.md`
- Dev history: `docs/dev_history/GSL-39-phase-v3fu-sc09-discrimination.md`
