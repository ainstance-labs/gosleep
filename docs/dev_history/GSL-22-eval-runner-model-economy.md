# GSL-22 — Run eval agents on cost-appropriate models (Sonnet under-test, Haiku judge)

**Epic:** GSL-19 eval-validation  
**Branch:** GSL-19-eval-validation  
**Commit:** GSL-22 Run eval agents on cost-appropriate models (Sonnet under-test, Haiku judge)  
**Jira:** https://ainstance-labs.atlassian.net/browse/GSL-22  
**GitHub:** https://github.com/ainstance-labs/gosleep/issues/25

---

## Part 1 — Story

### Problem

The eval-runner spawned every agent — both the RED/GREEN answer agents AND the judge/scorecard agents — with no model set. That meant they all inherited the session model (Opus). For a full 23-scenario × 6-sample run, that's ~23 × 6 × 2 arms × 1 answer + ~23 × 2 judge + 1 scorecard = ~300+ Opus calls. This burned weekly quota fast and made a full eval run prohibitively expensive.

### Solution

Two new args (`agentModel` and `judgeModel`) with sensible defaults:

- **`agentModel` (default `'sonnet'`)** — applied to the RED answer agents and GREEN answer agents. Both arms run on the same model, so the GREEN−RED lift is apples-to-apples and the comparison remains valid.
- **`judgeModel` (default `'haiku'`)** — applied to the batched judge calls (one per arm per scenario) and the scorecard synthesis agent. Judges receive the rubric + formatted answers and apply a binary pass/fail verdict — a well-specified formulaic task where Haiku is both fast and accurate enough.

File I/O helpers (cache load, baseline write) were left without a model override — they don't benefit from a specific tier.

### What changed

`evals/runner/eval-runner.js`:
- Added `AGENT_MODEL` and `JUDGE_MODEL` constants parsed from `args`
- Updated the top-of-file args comment to document the new keys
- Applied `model: AGENT_MODEL` to RED answer `parallel` and GREEN answer `parallel`
- Applied `model: JUDGE_MODEL` to RED batched judge, GREEN batched judge, and scorecard synth
- Updated the `log()` line to surface the active models on run start

No schema, batching, per-scenario N, RED cache, or scorecard format was touched.

---

## Part 2 — Technical reference

### Args interface (full)

| arg | type | default | description |
|-----|------|---------|-------------|
| `scenarios` | `string[]` | all 23 scenario dirs | Absolute paths to scenario dirs |
| `samples` | `number` | `6` | Default N per scenario |
| `skillDir` | `string` | `<ROOT>/skill` | Path to skill root |
| `samplesByScenario` | `object` | `{}` | Per-scenario N override map |
| `useCachedRed` | `boolean` | `false` | Load RED verdicts from baselines/ cache |
| `agentModel` | `string` | `'sonnet'` | Model for RED + GREEN answer agents |
| `judgeModel` | `string` | `'haiku'` | Model for batched judges + scorecard synth |

### Agent model assignment

| agent call | model arg |
|------------|-----------|
| RED answer agents (`parallel`) | `AGENT_MODEL` |
| GREEN answer agents (`parallel`) | `AGENT_MODEL` |
| RED batched judge | `JUDGE_MODEL` |
| GREEN batched judge | `JUDGE_MODEL` |
| Scorecard synth | `JUDGE_MODEL` |
| RED cache load (file I/O) | _(none — inherits session)_ |
| RED cache write (file I/O) | _(none — inherits session)_ |
