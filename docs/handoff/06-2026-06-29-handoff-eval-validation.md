# Handoff — gosleep (Orchestration Harness) — 2026-06-29 (eval validation done; incident + controls; owner decisions pending)

> Fresh orchestrator: read Part 1 first, then "Immediate next steps". Ground truth = `docs/handoff/ORCHESTRATION-STATE.md` (read FIRST) + Jira GSL + this repo. Supersedes the 2026-06-28 vendoring-complete handoff.

# ── Part 1 · Plain words ──

## 1. Where we are now
Three epics shipped earlier (GSL-1 init, GSL-7 hardening, GSL-15 vendoring — all merged). Tonight we ran the behavioral eval to validate the GSL-7 hardening, **optimally and under control** after an earlier incident. The eval is done; its PR (#27) is open for the owner to review. No workers running, no open eval run.

## 2. What happened tonight (important — read this)
- **Incident:** my "2-scenario smoke" was launched via the eval **Workflow** (background, invisible agents). A config arg (`scenarios`) did NOT propagate, the runner defaulted to "run ALL 23", and it spawned **242 background agents** (~1.2M out / 0.59M in / 25.4M cache-read tokens, Sonnet/Haiku) before I stopped it. The owner was rightly furious (invisible + uncontrolled spend). Token incident report (for an Anthropic support credit request) is at `docs/reports/token-overage-incident-2026-06-28/index.html`.
- **Root-cause fix (GSL-23):** the runner now reads a FILE `evals/runner/run-config.json`, REFUSES to run without an explicit scenarios list (no silent full-run), and has a hard **agent ceiling (120)** that throws before spawning. A 7-agent control test proved control is restored.
- **The real validation run (controlled): 86 agents**, N=4, reusing the cached RED baselines (the 242 agents' one salvageable product). Bounded, watched, no runaway.

## 3. The eval result (the actual finding)
RED = no-skill baseline, GREEN = with the hardened skill:
- **PASS (fix works):** SC-04, SC-07; and the NEW scenarios SC-21, SC-22 discriminate well (GSL-13 success).
- **GUARD (holds, non-discriminating):** SC-03, SC-16, SC-20, SC-23.
- **FAIL — 4 of the 6 GSL-7 fixes did NOT change behavior:** SC-09 (patience-vs-nudge, GREEN 0.0), SC-19 (rollover, GREEN 0.0), SC-12 (telemetry, 0.25), SC-11 (state-mechanics, 0.75).
- **Lesson:** editing the skill TEXT did not reliably change agent BEHAVIOR. The 4 gaps need a different (not text-only) approach — a "hardening v2".

## 4. Problems / open
- 4 confirmed behavioral gaps still open (above). No fix started — needs owner direction on approach.
- GSL-19 eval PR #27 is OPEN, not merged (left for owner review).
- Orchestrator ledger (this handoff, STATE, handoffs 04/05) still uncommitted — minor housekeeping.

## 5. Comments / owner directives captured tonight
- Owner: run agents **in tmux panes for control**; the eval is inherently a background Workflow (can't be panes) — I controlled it via file-config + ceiling + control-test-first + live watchdog. Flag for discussion.
- Owner: **N=2** going forward (not 4/6). Noted. (Tonight's run was N=4, already mostly done when raised; cached RED is N=6 and free to reuse.)
- Owner: TLM-58 dropped (owner closes it).

# ── Part 2 · Formal / precise ──

## Hard rules (carry forward)
- Orchestrator executes nothing except keeping STATE + writing dated handoffs; all delivery -> pane-workers (Sonnet), verification -> Haiku, orchestrator -> Opus. Epic+Task, 1 branch/epic, 1 commit/task, 1 PR/epic, REGULAR merge, idempotent, no force-push, artifacts in-tree.
- **NEW iron rule (from tonight): never fire-and-forget a multi-agent run.** Before any eval Workflow: verify the run-config limits it, run a tiny control test first, watch the live agent count, keep a watchdog. The runner's ceiling guard (120) + no-silent-full-run are the mechanism-level safety.
- `skill/` is source of truth for all 5 vendored skills; `install.sh` per-skill only (never the `~/.claude/skills` parent).

## Connections
| Thing | Value |
|---|---|
| Jira | GSL, cloudId 74054cdc-47ef-497d-9684-734149876a8b. To Do=11/In Progress=21/In Review=31/Done=41 |
| GitHub | ainstance-labs/gosleep. main @ `b1753a1`. **GSL-19 eval PR #27 OPEN (In Review).** Next free GH = #28 |
| Owner | Roman L, rommxx@gmail.com, 557058:83b04839-8bde-4331-9c2d-24843d0b8e67 |
| Next Jira | GSL-24 |

## Eval harness (how to run it SAFELY)
- Runner: `evals/runner/eval-runner.js` — a **Workflow script** (orchestrator-only; workers are banned from the Workflow tool). Invoke: `Workflow({scriptPath: "<abs>/evals/runner/eval-runner.js"})` — it reads config from `evals/runner/run-config.json` (gitignored).
- run-config fields: `scenarios` (REQUIRED, short names ok), `samples` (default 3; owner wants **2**), `samplesByScenario`, `skillDir` (MUST be `<ROOT>/skill/orchestrating-delivery-agents` post-vendoring), `useCachedRed` (reuse `evals/baselines/` RED cache; gitignored local cache), `agentModel` (sonnet), `judgeModel` (haiku), `confirmLargeRun`.
- Safety: refuses without explicit scenarios; throws if expectedAgents > 120 unless confirmLargeRun. ALWAYS run a 1-scenario control test + watch the agent count before a real run.
- Scorecards land in `evals/results/<ts>-scorecard.md`. Latest validation: `2026-06-29-0028-scorecard.md`.

## Immediate next steps (THE RESUME POINT — all owner-gated)
1. **Owner: merge GSL-19 PR #27?** (the safe+efficient runner + the validation scorecard). If yes -> worker merges (regular), closes #22-26, epic GSL-19 -> Done.
2. **Owner: "hardening v2" epic** to actually close SC-09 / SC-11 / SC-12 / SC-19 — and the APPROACH (text-only edits underperformed; may need sharper, example-driven skill changes, then re-validate at N=2 reusing cached RED — cheap now).
3. **Token credit:** send the support request from `docs/reports/token-overage-incident-2026-06-28/index.html`.
4. **Housekeeping:** commit the orchestrator ledger (handoffs 04/05/06 + STATE) as a small tracked task.

## Gotchas
- Working tree is on local branch `GSL-19-eval-validation` (PR #27). After #27 merges, `git stash -u` the ledger files, checkout main, pull, pop.
- `evals/baselines/` (RED cache, mixed N) and `evals/runner/run-config.json` are gitignored. RED is skill-independent -> cache reuse is free; re-run RED only for scenarios with no baseline.
- Eval agents are background Workflow subagents (NOT tmux panes) by nature — control them by config + ceiling + control-test + watchdog, never fire-and-forget.

## Blocked on the human
- Merge GSL-19 PR #27? · Hardening v2 approach for the 4 failing scenarios? · Send the token-credit request? · (N=2 confirmed for future runs.)
