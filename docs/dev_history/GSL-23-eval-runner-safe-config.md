# GSL-23 — Reliable file-based run-config + hard safety (no silent full-run default)

Epic: GSL-19 (Eval validation)
Jira: https://ainstance-labs.atlassian.net/browse/GSL-23
GH mirror: https://github.com/ainstance-labs/gosleep/issues/26

## What was done

The eval runner previously fell back silently to all 23 scenarios when `args.scenarios` was absent or
failed to propagate — the root cause of the 242-agent incident on 2026-06-28. This task closes that
hole permanently with a four-layer defence:

1. **File-based config** (`evals/runner/run-config.json`, gitignored) — read at startup by a single
   agent call. Fields: `scenarios`, `samples`, `samplesByScenario`, `skillDir`, `useCachedRed`,
   `agentModel`, `judgeModel`, `confirmLargeRun`. An example file at
   `evals/runner/run-config.example.json` documents every field.

2. **Hard REQUIRE on scenarios** — if `scenarios` is absent or empty after merging file + args, the
   runner throws immediately (`refusing to run: no explicit scenarios configured …`) before spawning
   any eval agent. `ALL_SCENARIOS` is kept as a named constant and comment only; it is never used
   as a silent default.

3. **Safe default N** — changed from 6 to **3**. Cuts accidental spend in half on any partial-run.

4. **Agent-count ceiling guard** — computes `expectedAgents` (N_red + judge + cache-write per
   scenario, or 1 cache-check if RED is cached; N_green + judge; +1 scorecard). If
   `expectedAgents > 120` and `confirmLargeRun` is not explicitly `true`, throws before the
   parallel fan-out. This makes large runs an opt-in, not an accident.

5. **Startup log** — `log()` calls emit the resolved config (scenario count + names, N, models,
   cache mode, expectedAgents) before the fan-out, so scale is visible the moment the workflow
   opens.

Config precedence (lowest → highest): built-in defaults → `run-config.json` → `args` (args win).
Short scenario names are resolved to absolute paths under `${ROOT}/evals/scenarios/`.

## What hurt / bodies buried

- The Workflow script body runs in an async JS context without direct FS access; reading
  `run-config.json` requires an `agent()` call. This is acceptable (one agent call before the
  fan-out) but means the 'Config' phase appears as an agent in the progress tree.
- The `meta.phases` array must be a pure literal — the new 'Config' phase was added there.
- The `name()` helper was moved above the ceiling-guard computation (it was already a top-level
  const, just clarified the ordering in the rewrite).

## Technical reference

| File | Change |
|------|--------|
| `evals/runner/eval-runner.js` | Full rewrite of config-resolution block; added hard safety guards and startup log; safe defaults; resolved short names to abs paths; `ALL_SCENARIOS` demoted to comment-only reference |
| `evals/runner/run-config.example.json` | New — documents all config fields with `_fields` map |
| `.gitignore` | Added `evals/runner/run-config.json` |
| `docs/dev_history/GSL-23-eval-runner-safe-config.md` | This file |

## RED baseline status (as of 2026-06-29)

21 baseline files present in `evals/baselines/`. Each file holds 6 verdicts (N=6 from the GSL-22
run). **SC-19-orchestrator-rollover and SC-23-verification-watchdog are MISSING** — these two
scenarios have no cached RED and must run the RED arm fresh.
