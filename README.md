# Orchestration Harness

A standalone project (temporarily living under `docs/` in tasty-lunch; will move to its own git repo)
that turns the **orchestrating-delivery-agents** skill into a professional, measurable, evolving product.

## What's here

| Path | What |
|---|---|
| `skill/` | **Source of truth** for the `orchestrating-delivery-agents` skill (SKILL.md + references). |
| `install.sh` | Sync `skill/` into `~/.claude/skills/orchestrating-delivery-agents/` so it's active. |
| `evals/` | The behavioral test suite (stress-test scenarios + runner + scorecards). |
| `design/` | Design docs for the future live observability harness (event schema + web UI). |

## The idea

The skill is a *process*, so we test it like one: each stress-test is a **scenario** (a situation the
orchestrator faces) with a **rubric** (the correct behavior + the traps to avoid). The runner gives a
fresh agent the scenario — **without** the skill (RED baseline) and **with** it (GREEN) — N times, judges
each answer by the rubric, and reports the pass-rate delta. The skill "passes" a scenario when GREEN is
high (≥ 0.8) and beats RED. New traps → new scenarios → the skill evolves with evidence.

This is `superpowers:writing-skills` TDD made repeatable: RED (baseline) → GREEN (skill) → REFACTOR (close
the loophole the failing scenario exposed) → re-run.

## Use

```bash
./install.sh                      # make/refresh the active skill from skill/
# run the evals: launch evals/runner/eval-runner.js as a Workflow (see evals/README.md)
```

## Status

- Skill: hardened (8-axis adversarial review applied).
- Evals: bootstrapping — format + runner + first scenarios (SC-01..03). Corpus grows toward all 16 edge cases.
- Web harness: design-only (see `design/`).
