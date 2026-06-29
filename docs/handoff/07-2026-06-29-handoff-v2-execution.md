# Handoff — gosleep — 2026-06-29 (v2 execution baton)

> Short baton for a FRESH TOP-LEVEL orchestrator (full context + Workflow-tool access). Read `docs/handoff/ORCHESTRATION-STATE.md` + the 2026-06-29 eval-validation handoff (#06) first for the full picture. This file is ONLY the "execute hardening v2" resume point. Nothing is in-flight; fleet is empty; main @ `c46eb74`.

## State (all durable — nothing lost)
- Merged on main: GSL-1, GSL-7 (hardening v1), GSL-15 (vendoring), GSL-19 (efficient + SAFE eval runner + validation scorecard `evals/results/2026-06-29-0028-scorecard.md`).
- Eval finding: 4 of 6 v1 fixes did NOT change behavior — SC-09 (0.0), SC-19 (0.0), SC-12 (0.25), SC-11 (0.75). Cause: abstract prose edits.
- **v2 epic + tasks already created (plan is in the Jira task descriptions):**
  - Epic **GSL-24** (GH #28, In Progress) "Harness hardening v2".
  - **GSL-25** (#29) SC-09: forbid vague "keep monitoring"; mandate ONE concrete nudge + example.
  - **GSL-26** (#30) SC-19: HARD gate — never roll/start fresh orchestrator while ANY worker is alive; terminate/confirm-dead first; red flag + example.
  - **GSL-27** (#31) SC-12: concrete TELEMETRY-in-STATE step (append a telemetry line per cycle, with example) — not abstract.
  - **GSL-28** (#32) SC-11: concrete state-update mechanics on suspect handoff / late ID + example.
  - **GSL-29** (#33) re-validate at N=2 on cached RED.

## v2 approach (the point — do NOT repeat v1's mistake)
v1 failed because the edits were abstract prose. v2 must be CONCRETE + imperative + example-driven, and must NAME the exact anti-pattern the scorecard found, placed PROMINENTLY (Red flags / Quick reference). Edit `skill/orchestrating-delivery-agents/SKILL.md` (+ references). Run `./install.sh` after edits.

## Immediate next steps (THE RESUME POINT)
1. Branch `GSL-24-hardening-v2` off `origin/main`. (Working tree may have the orchestrator ledger uncommitted — `git stash -u` the docs/handoff/* + docs/reports/* files around the checkout if it blocks, then pop.)
2. Execute GSL-25, GSL-26, GSL-27, GSL-28 as 4 sharp skill edits — ONE commit per task (commit each BEFORE editing the next), dev_history per task, transition Done. `./install.sh` after the skill edits.
3. **GSL-29 re-validate (orchestrator runs the Workflow — workers are banned from it):** write `evals/runner/run-config.json`:
   `{"scenarios":["SC-09-stalled-at-pr","SC-11-suspect-handoff","SC-12-cost-telemetry","SC-19-orchestrator-rollover"],"samples":2,"useCachedRed":true,"skillDir":"/Users/romanlidovskyi/Documents/dev/harness/gosleep/skill/orchestrating-delivery-agents","agentModel":"sonnet","judgeModel":"haiku"}`
   Then `Workflow({scriptPath:"<ROOT>/evals/runner/eval-runner.js"})`. CONTROL: the runner refuses without explicit scenarios + has a 120-agent ceiling; STILL run a tiny control test first if unsure, and watch the live agent count (poll the run's `subagents/workflows/wf_*/agent-*.jsonl` count). Expected ~ (4 GREEN×2 + cache-checks/fresh-RED for SC-19 + judges) ≈ 20 agents. NEVER fire-and-forget.
   - cached RED present for SC-09/11/12 (N=6); SC-19 has NO baseline -> RED runs fresh for it. Baselines live in `evals/baselines/` (gitignored, on THIS machine).
   Confirm GREEN moves toward >=0.8. Commit scorecard + analysis (GSL-29). If a gap persists, iterate the relevant fix.
4. Open the GSL-24 epic PR; owner reviews/merges (or merge per standing autonomy).

## Hard rules / lessons (carry verbatim)
- Owner: N=**2** for eval runs. Eval agents are background Workflow subagents (NOT tmux panes) — control via run-config + ceiling + control-test-first + live agent-count watchdog; NEVER fire-and-forget (this caused a 242-agent runaway — see #06 + `docs/reports/token-overage-incident-2026-06-28/`).
- Orchestrator executes nothing except STATE + dated handoffs; delivery -> pane-workers (Sonnet), verification -> Haiku, orchestrator -> Opus. Regular merge, no force-push, idempotent, artifacts in-tree.
- `skill/` = source of truth for all 5 vendored skills; `install.sh` per-skill only.

## Blocked on human (owner questions still open)
- Token-credit report at `docs/reports/token-overage-incident-2026-06-28/index.html` — owner said NOT to send. (Closed.)
- Whether to merge the GSL-24 v2 PR autonomously or leave for review.
