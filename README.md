# Orchestration Harness (gosleep)

A standalone project that turns the **orchestrating-delivery-agents** skill into a professional,
measurable, evolving product.

- **GitHub:** https://github.com/ainstance-labs/gosleep
- **Tracker:** Jira project **GSL** ("GoSleep") — [kanban board](https://ainstance-labs.atlassian.net/jira/software/projects/GSL/boards/100)
- **Conventions & anchors:** see `CLAUDE.md`

## What's here

| Path | What |
|---|---|
| `skill/` | **Source of truth** for the `orchestrating-delivery-agents` skill (SKILL.md + references). |
| `install.sh` | Sync `skill/` into `~/.claude/skills/orchestrating-delivery-agents/` so it's active. |
| `evals/` | The behavioral test suite (stress-test scenarios + runner + scorecards). |
| `docs/design/` | Design docs for the future live observability harness (event schema + web UI). |
| `docs/report/` | HTML knowledge base / dashboard (open `docs/report/index.html`). |
| `docs/analysis/` | Eval cost analysis and methods. |
| `docs/dev_history/` | Per-task dev history (the live engineering memory, keyed by Jira task). |
| `docs/dev-history/` | Legacy narrative log from the pre-standalone (TLM) era — frozen. |
| `docs/handoff/` | Agent handoff batons + orchestration state. |

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

> **Heads-up:** the report generators and the eval runner still carry absolute paths from the
> pre-move location — fix the `ROOT` constants before running them (tracked as GSL-4).

## Status

- **Skill:** synced 2026-06-11 with the Fable 5-audited global version (additive hardening:
  richer orchestration-state structure, model economy rules, worker context calibration).
- **Evals:** 20 scenarios; last full run 2026-06-09 → **6 PASS · 6 GUARD · 8 FAIL**
  (`evals/results/2026-06-09-1144-scorecard.md`). Gap fixes are the next milestone.
- **Web harness:** design-only (see `docs/design/`).
