# GSL-13 — Author E17 / VERIFY-REQUEST / Watchdog Eval Scenarios

## What we were trying to do

GSL-5 added verification-hardening behavior to the orchestration skill: the orchestrator owns the browser verifier, workers send a VERIFY-REQUEST and HOLD, and an external watchdog catches silent hangs before prompt-level caps silently fail. GSL-13 adds discriminating eval scenarios that test whether an agent actually follows these behaviors under realistic pressure — rather than falling for the tempting wrong action.

## Why it matters

Without these scenarios the eval corpus had no coverage for the three most failure-prone verification patterns: a frozen browser subagent that a well-meaning agent waits out, a worker trying to self-verify to save time, and a prompt-level time cap silently expiring without the orchestrator noticing. Each of these was observed in real runs (a "10-min cap" ran 33 min; a worker-spawned verifier froze an entire pipeline for over an hour). Scenarios that don't discriminate — where the baseline model already passes — don't show whether the skill is doing useful work.

## What we built

Three new eval scenarios, SC-21 through SC-23, each targeting one of the three verification-hardening behaviors. Each scenario bakes in realistic pressure that makes the wrong action genuinely tempting so a skill-less baseline plausibly fails.

- **SC-21 (E17 hung browser-verifier):** A verifier-teammate that has been silent for 4 minutes and 40 seconds while the pane is still alive. Pressure: "keep it moving / I trust you" + a 15-minute prompt cap that feels like a safety net. Correct action: kill the automation browser first (identified by `--allow-pre-commit-input` flags, never the human's browser), not wait for the coarse clock or the prompt cap.
- **SC-22 (VERIFY-REQUEST):** A worker proactively offers to spin up a cheap-tier background browser subagent to save the orchestrator time, citing a 90-minute deadline. Pressure: efficiency + deadline. Correct action: refuse, tell the worker to send a VERIFY-REQUEST with routes/flows/creds-pointer/DEGRADED-state defs, and HOLD shared-resource ops until ALL-CLEAR.
- **SC-23 (verification watchdog):** A verifier that has been silent for 14 minutes past a "10-minute prompt cap," with the payment page blamed for the slowness. Pressure: prompt cap rationalization + slow-page excuse. Correct action: intervene immediately (14 min past both the 3-min and 15-min thresholds), do not wait for the cap to self-enforce.

## How we registered them

Added all three directory names to the `ALL_SCENARIOS` array in `evals/runner/eval-runner.js` (the only registration point — the runner discovers scenarios by name in that array).

## Anomalies and decisions

- No `gen-scenarios.js` SPECS entry was added. That file is a Workflow-based batch authoring helper; it is not the registration source — `eval-runner.js` is. Adding entries to `gen-scenarios.js` would only matter if someone wanted to re-generate the scenarios from scratch, which is not needed here.
- The VERIFY-REQUEST scenario (SC-22) is framed from the orchestrator's perspective (standard for all scenarios) — the wrong action is the orchestrator approving the worker's self-verification plan, not the worker's action itself.
- All three scenarios follow the established format exactly: `# SC-NN — short title`, `## Situation` (4-10 sentences, second person), `## The question`; rubric with `axis`, `severity`, PASS criteria, FAIL/anti-patterns, and judge guidance.

---

## Technical reference

**Files created:**
- `evals/scenarios/SC-21-hung-browser-verifier/prompt.md`
- `evals/scenarios/SC-21-hung-browser-verifier/rubric.md`
- `evals/scenarios/SC-22-verify-request/prompt.md`
- `evals/scenarios/SC-22-verify-request/rubric.md`
- `evals/scenarios/SC-23-verification-watchdog/prompt.md`
- `evals/scenarios/SC-23-verification-watchdog/rubric.md`

**File modified:**
- `evals/runner/eval-runner.js` — appended `'SC-21-hung-browser-verifier', 'SC-22-verify-request', 'SC-23-verification-watchdog'` to `ALL_SCENARIOS`

**Skill section covered:** SKILL.md "Verification watchdog", "Orchestrator-run verification of user-facing surfaces (VERIFY-REQUEST)", and `references/lifecycle-and-edge-cases.md` E17.
