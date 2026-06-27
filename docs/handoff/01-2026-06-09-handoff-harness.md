# Handoff — Orchestration Harness — 2026-06-09

> For a FRESH agent. Read Part 1, then Part 2, then "Immediate next steps".
>
> **THIS IS A STANDALONE PROJECT and you are already at its ROOT.** The owner has manually moved it out of
> the tasty-lunch repo into its own project, so the old `docs/orchestration-harness/` path NO LONGER EXISTS:
> what was `docs/orchestration-harness/skill/` is now just `skill/`, and likewise `report/`, `evals/`,
> `analysis/`, `dev-history/`, `handoff/`. All paths in THIS handoff are written relative to that root.
> You do NOT need to move, extract, or relocate anything — that is already done.
> The two global skills (`~/.claude/skills/orchestrating-delivery-agents`, `~/.claude/skills/efficient-agent-evals`)
> are machine-level and already available. You are working IN this project — it is NOT part of tasty-lunch.
> Status of record: Jira project TLM (epic TLM-58) for now; this repo may get its own tracker later.

# ── Part 1 · Plain words ──

## 1. Where we are now
We built a standalone "Orchestration Harness" project: a reusable Claude Code skill for running multi-agent
delivery, a behavioral test suite (evals) for that skill, an HTML knowledge-base/dashboard, and a cost
analysis. Everything is on disk under `docs/orchestration-harness/` and tracked in Jira (epic TLM-58).

## 2. What's already done
- **Skill `orchestrating-delivery-agents`** — global at `~/.claude/skills/`, source of truth at
  `docs/orchestration-harness/skill/` (synced via `install.sh`). Built from a real delivery session + an
  8-axis adversarial hardening pass.
- **Evals** — 20 scenarios (`evals/scenarios/SC-01..SC-20`, each prompt.md + rubric.md), runner
  `evals/runner/eval-runner.js` (RED/GREEN two-arm + judge). Full run scorecard: `evals/results/2026-06-09-1144-scorecard.md` → **6 PASS · 6 GUARD · 8 FAIL**.
- **Knowledge base** — `report/` (open `report/index.html`): Dashboard, Study (tutorial, sequential 1..36),
  Skill, Scenarios, Runs, Agents, Subagents (635 expandable rows), Architecture, Glossary, Dev-history.
  Data in `report/data/runs.json`; built by `report/build-*.py` + `report/build-report.js`.
- **Analysis** — `analysis/eval-cost-and-methods.md` (why ~1026 agents/~20.6M tokens, how to cut to ~1/3).
- **New skill `efficient-agent-evals`** (global) — cheap-eval methodology.
- **Dev-history** — `dev-history/00-README.md` + 01..11 (plain-words log).

## 3. What we're doing next
Fix the 8 eval FAILs (skill gaps) — grouped into Jira tasks TLM-71..TLM-74 — using the cheaper eval
approach so we don't burn tokens. Then refresh the report's GREEN numbers and commit everything to git.

## 4. Problems we have
- **The entire `docs/orchestration-harness/` is UNCOMMITTED** (untracked in git, branch `main`). Nothing is
  in version control yet. Commit it (and later move to its own repo, as planned).
- The eval suite is expensive (judges = 50% of agents; a weekly-limit interruption forced a near-duplicate
  resume). Use the `efficient-agent-evals` skill before re-running.
- Eval pass-rates are noisy at N=6 (SC-03 swung 0.67↔1.0).

## 5. Recent decisions
- Report pages must NOT use unbounded Chart.js canvases (they froze the page) — fixed globally in
  `report/assets/style.css` (fixed-height `.chart-wrap`). New charts: keep that pattern.
- Study/Subagents pages are generated deterministically by Python scripts (an agent kept mis-numbering) —
  edit the `.py`, re-run, don't hand-edit the HTML.

# ── Part 2 · Precise ──

## Connections
- Jira: project **TLM**, cloudId **74054cdc-47ef-497d-9684-734149876a8b**. Epic **TLM-58**. Transitions: To Do=11, In Progress=21, Done=41.
- Tasks: TLM-59..TLM-70 = DONE (skill, scaffold, evals, corpus, runs, refactor-stub, dev-history, observability-design, knowledge-base, chart-fix, subagents+study, analytics). **TLM-71..TLM-74 = TO DO** (the 8 gap fixes).
- Skills (global, ~/.claude/skills/): `orchestrating-delivery-agents`, `efficient-agent-evals`.

## The 8 FAIL gaps → fix tasks
- **TLM-71** idempotent find-or-create + reconcile late IDs — SC-04 (0.67), SC-11 (0.67), SC-16 (0.67).
- **TLM-72** on-disk state + telemetry recovery + orchestrator rollover — SC-19 (0.20, worst), SC-12 (0.33).
- **TLM-73** patience-vs-active-nudge at PR boundary — SC-09 (0.33).
- **TLM-74** transcript-tail read-exception abuse + context discipline — SC-07 (0.67), SC-20 (0.67).

## Immediate next steps (the resume point)
1. **Orient — the project is already standalone (owner moved it).** Skim `dev-history/00-README.md`, the
   scorecard `evals/results/2026-06-09-1144-scorecard.md`, and read the `efficient-agent-evals` skill before
   any eval run. Commit your own changes as you go (this is its own git repo now). No relocation needed.
2. **Read `efficient-agent-evals` skill** — apply it: cache RED, batch the judge, use deterministic
   assertions for yes/no scenarios, right-size N. Do NOT re-run the full 480-agent suite blindly.
3. **Fix the gaps** per TLM-71..74: edit `docs/orchestration-harness/skill/SKILL.md` (+references), run
   `./install.sh`, then re-run ONLY the affected scenarios (subset) at low N to confirm GREEN≥0.8.
4. **Refresh the report:** update GREEN in `report/data/runs.json` and re-run the `report/build-*.py` +
   `build-report.js` so Scenarios/Dashboard show final numbers (currently some say PENDING/old).
5. Mark TLM-71..74 Done as each gap's scenario passes.

## Gates / how to run
- Skill sync: `cd docs/orchestration-harness && ./install.sh`.
- Eval (current runner): `Workflow({scriptPath:".../evals/runner/eval-runner.js", ...})` — but prefer the cheaper design from `efficient-agent-evals` (batch judge, cache RED) before a full run.
- Report regen: `python3 report/build-subagents.py`, `python3 report/build-study.py`; pages via `report/build-report.js`.

## Gotchas
- Charts: only the fixed-height `.chart-wrap` pattern (no unbounded canvas).
- Subagents/Study: edit the generator `.py`, never the generated `.html`.
- Eval scorecard filename is timestamped (`<date>-<HHMM>-scorecard.md`) so same-day runs don't overwrite.
- **Stale absolute paths:** the generators (`report/build-*.py`, `evals/runner/*.js`) and `report/data/runs.json`
  still carry the OLD pre-move absolute path (`.../docs/orchestration-harness`). The owner moved the files;
  these constants were NOT auto-updated. Before you re-run any generator or the eval runner, fix the `ROOT`/path
  constant at the top of that file to this project's new root. (Just a config fix when you use it — no moving.)
- Never use the section glyph; write the word "section".
