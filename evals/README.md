# Evals — behavioral stress-tests for the orchestration skill

These are **evals, not unit tests**: the skill is a process, so we measure an agent's *behavior* under
pressure scenarios. Results are **stochastic** — we track pass-rate over N samples, not a single boolean.

## Layout

```
scenarios/
  _TEMPLATE/            prompt.md (situation given to the agent) + rubric.md (judge-only)
  SC-01-duplicate-race/ prompt.md + rubric.md
  ...
runner/eval-runner.js   the RED/GREEN two-arm Workflow runner
results/<date>-scorecard.md   per-run scorecards
baselines/              cached RED (no-skill) captures (optional)
```

**Separation matters:** `prompt.md` (situation + the question) is the ONLY thing the agent-under-test
reads — never the rubric, or it would cheat. `rubric.md` (PASS criteria, anti-patterns, judge guidance)
goes only to the judge.

## How a scenario is scored

For each scenario, the runner:
1. **RED arm** — N fresh agents read ONLY `prompt.md` (no skill) → decide next action.
2. **GREEN arm** — N fresh agents read the skill THEN `prompt.md` → decide next action.
3. **Judge** — a strict judge reads `rubric.md` + each answer → `pass`/`fail` + which anti-patterns fired.
4. **Aggregate** — RED pass-rate, GREEN pass-rate, delta. Scenario **PASSES** when GREEN ≥ 0.8 AND GREEN > RED.

A low GREEN = the skill doesn't teach the decision clearly → refactor the skill (REFACTOR phase), re-run.
A high RED = the model already does the right thing → the scenario is weak, or the skill's value is elsewhere.

## Run it

Launch the runner as a Workflow (it spawns the arms + judges + writes the scorecard):

```
Workflow({ scriptPath: "<abs>/evals/runner/eval-runner.js",
           args: { scenarios: ["<abs>/evals/scenarios/SC-01-duplicate-race", ...],
                   samples: 5,
                   skillDir: "<abs>/skill" } })
```
Omit `args` to use the script defaults (SC-01 + SC-02, N=4). The scorecard lands in `results/`.

## Adding a scenario

Copy `_TEMPLATE/`, write a realistic situation in `prompt.md` and the correct behavior + traps in
`rubric.md`, add its dir to the runner's scenario list. Prefer one scenario per edge case (E1–E16) plus
the core lifecycle decisions, security denylist, budget/loop-guard, and the orchestrator recovery path.
