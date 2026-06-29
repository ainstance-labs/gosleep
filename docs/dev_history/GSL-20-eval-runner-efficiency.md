# GSL-20 — Make eval-runner efficient: batched judge + per-scenario N + RED baseline cache

**Epic:** GSL-19 (Eval validation)
**Task key:** GSL-20
**Branch:** GSL-19-eval-validation
**Commit:** see git log

---

## Part 1 — Story

The eval runner originally spawned one judge agent per sample per arm (2N judges per scenario, 2N×23 = 276 agents at N=6 across the full corpus). Three efficiency upgrades landed in this task:

1. **Batched judge.** Replaced per-sample judge calls with a single batched call per arm per scenario. The judge receives the rubric + all N valid answers (as a numbered list) and returns a `verdicts` array of exactly N elements. The `BATCH_VERDICT_SCHEMA` enforces the array structure so the model can't return a scalar. Judge count drops from 2N to 2 per scenario — a 6× reduction at N=6, scaling linearly with N.

2. **Per-scenario N override.** `args.samplesByScenario` accepts an object map (scenarioName → N). When a key matches `name(scn)`, that N overrides the default `args.samples`. Useful for running weak scenarios (e.g. SC-19, SC-09, SC-12 from the 2026-06-09 scorecard) at higher N without re-running the full corpus at elevated cost.

3. **RED baseline cache.** After every fresh RED run, the per-scenario verdicts are written to `evals/baselines/<scenarioName>.json`. When `args.useCachedRed: true` and the file exists, the RED arm is skipped and the file is loaded instead. The GREEN arm always runs fresh. Default `useCachedRed: false` (run RED fresh + write/overwrite baseline). This lets cheap re-runs focus cost on the GREEN arm only.

Behavior otherwise unchanged: scorecard format, DECISION_SCHEMA, ALL_SCENARIOS registry, phase assignments, and pass-rate aggregation are identical.

No pain points; the edits were surgical. The stash+checkout dance was needed to preserve the orchestrator's ledger files (`ORCHESTRATION-STATE.md`, handoff 04/05) across the branch switch.

---

## Part 2 — Technical reference

### New args interface

| Field | Type | Default | Description |
|---|---|---|---|
| `scenarios` | `string[]` | all 23 scenarios | Absolute paths to scenario dirs |
| `samples` | `number` | `6` | Default N per scenario |
| `skillDir` | `string` | `<ROOT>/skill` | Absolute path to skill dir |
| `samplesByScenario` | `object` | `{}` | Per-scenario N override map: `{ 'SC-19-orchestrator-rollover': 12 }` |
| `useCachedRed` | `boolean` | `false` | When `true`, load `evals/baselines/<name>.json` instead of running RED arm |

### Example invocation (targeted weak-scenario re-run at higher N)

```js
Workflow({
  scriptPath: '/Users/romanlidovskyi/Documents/dev/harness/gosleep/evals/runner/eval-runner.js',
  args: {
    scenarios: [
      '/Users/romanlidovskyi/Documents/dev/harness/gosleep/evals/scenarios/SC-19-orchestrator-rollover',
      '/Users/romanlidovskyi/Documents/dev/harness/gosleep/evals/scenarios/SC-09-stalled-at-pr',
      '/Users/romanlidovskyi/Documents/dev/harness/gosleep/evals/scenarios/SC-12-cost-telemetry',
    ],
    samples: 6,
    samplesByScenario: { 'SC-19-orchestrator-rollover': 12, 'SC-09-stalled-at-pr': 10 },
    useCachedRed: false,
  },
})
```

### Batched judge — how N answers map to N verdicts

The batched judge prompt sends all N valid answers as a numbered list (`[0]...[N-1]`) and asks for a `verdicts` array of exactly N elements in the same order. `BATCH_VERDICT_SCHEMA` enforces the array structure. The resulting `batchResult.verdicts` is used directly as `redV` / `greenV` in `rate()` and `green_fail_antipatterns`.

### Baseline cache files

Written to `evals/baselines/<scenarioName>.json` after every fresh RED run (JSON array of verdict objects). Read back when `useCachedRed: true`. The cache is not invalidated automatically — re-run with `useCachedRed: false` to refresh.
