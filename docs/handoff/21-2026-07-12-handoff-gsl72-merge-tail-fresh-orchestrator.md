# Handoff — gosleep — 2026-07-12 (for a fresh orchestrator; GSL-72 is fully ready and verified, ONLY merge remains)

> FOR A FRESH ORCHESTRATOR. Read: Part 1 → "⚠️ HARD RULES" → "⭐ RESUME". Ground truth = ORCHESTRATION-STATE.md (first) + this file. Supersedes handoff 20 (2026-07-10).

# ── Part 1 · Plain words ──

## 1. Where we are
Epic **GSL-72 "Question buffer + decision manifest"** (PRD Phase 3) is 100% ready: 8 tasks + review fixes pushed (HEAD **d86ba0f**), **PR #92 OPEN / CLEAN**, Jira epic In Review, tasks Done, smoke **37/37**. All of this was double-checked by TWO independent read-only agents (verify-skill 5/5 PASS, verify-delivery 6/6 PASS). One action remains: **merge and close the tails** — then Phase 4.

## 2. What happened in the previous two sessions (important to understand)
Two orchestrators in a row "were silent in chat": ended turns with a tool call (usually ScheduleWakeup), and the text written before/between tool calls is not shown to the owner. The owner was twice on the verge of stopping the project. Fix: (a) from the `orchestrating-delivery-agents` skill the very pattern "a turn ends with a tool call" and the trap line were cut out; (b) a Stop-hook was installed in the project that mechanically blocks the end of a turn without a final text. Details — Lesson #1 below.

## 3. Relationship with the owner — read it, mandatory
Trust is undermined. The owner demands: answer to EVERY message of his; explain every worker spawn/stop; no initiative beyond the order (execute literally; doubts — ask); standard terminology (tool call, tool result, turn — no homemade translations); when in doubt about your words — he is entitled to demand independent checker agents (the verify-* pattern proved itself). Do not argue, show commands and their output.

# ── Part 2 · Formal ──

## ⚠️ HARD RULES (violation of the first = an immediate project stop)
1. **EVERY turn ends with TEXT to the owner — after ALL tool calls, zero tool calls after the text.** Any tool result (including the ScheduleWakeup response, whatever it says) is NOT permission to end the turn. Knowing the rule does NOT save — two predecessors it did not save; what saves is the habit: the last act = text. The Stop-hook (`.claude/settings.json` → `tools/hooks/stop-require-final-text.sh`) backs it up with a block, but hold the rule yourself. ScheduleWakeup (if you use a pulse) is armed IN THE MIDDLE of a turn.
2. **Models: ALL agents on Opus 4.8** (`model: opus`); the orchestrator — Fable 5. Verify the worker model from its transcript (`grep '"model"' ~/.claude/projects/-Users-romanlidovskyi-Documents-dev-harness-gosleep/<latest>.jsonl`) — self-report lies (the fixer named itself fable-5, was opus-4-8).
3. NO Workflow tool; max 3 worker panes (the 4th falls: fork failed); kill-pane only by explicit id; no force-push; REGULAR merge (never squash); idempotency; telemetry in STATE after every cycle; the orchestrator does not execute delivery itself; workers do NOT touch ledger files.
4. tmux: our window 1:0; sessions 0/2/3/4 — OTHER people's projects (tasty-lunch, agentic-flow-admin, v8-inspect), do not touch their panes.

## ⭐ RESUME POINT (in order)
1. Raise skills: orchestrating-delivery-agents (already cleaned of the trap), handoff, delivery-workflow, using-jira. Read ORCHESTRATION-STATE.md + this file. Check reality: `tmux list-panes -t 1:0` (should be your pane only), `git log --oneline -1` (**d86ba0f** on `GSL-72-question-buffer`, in sync with origin), `gh pr view 92 --json state,mergeStateStatus` (OPEN/CLEAN). On the very first turn write text to the owner — he will check visibility.
2. **Merge finalizer** (worker, Opus 4.8, pure mechanics): `gh pr merge 92 --merge` (REGULAR) → close issues **#84..#91** manually (`Closes` will auto-close only #83; verify all nine) → Jira epic GSL-72 → Done (transition **41**, cloudId below) → delete ONLY the remote branch (`git push origin --delete GSL-72-question-buffer`) → local main FF: `git fetch origin main:main`. **Do NOT touch the local branch or checkout** — the tree has an uncommitted ledger. Report ≤12 lines + model= (from transcript) + telemetry.
3. **Phase 4 "Laboratory"** per the PRD (`docs/prd/PRD-gosleep-evolution.md`): a setup worker (Opus) creates the epic GSL-81+ (GH #93+), a branch from a fresh origin/main. **The first task of the epic = the ledger commit**, into which go: ORCHESTRATION-STATE.md, handoffs 19/20/21, docs/reports/bugs/, `.gitignore` (edit), `skill/orchestrating-delivery-agents/SKILL.md` (trap cleanup), `.claude/settings.json` + `tools/hooks/stop-require-final-text.sh` (the Stop-hook rides into the repo). `docs/prompts/2-*.md` do NOT commit (the owner decision is not made). Then the pipeline: impl → mechanic PR → reviewer → (fixer) → finalizer. Then Phase 5 UI, Phase 6 Mobile.

## Connections
Jira GSL cloudId `74054cdc-47ef-497d-9684-734149876a8b` (To Do=11 / In Progress=21 / In Review=31 / Done=41); GH `ainstance-labs/gosleep`; PR #92; origin/main @ 135ce1f (before merge); next Jira=GSL-81, GH=#93; owner Roman L (rommxx@gmail.com) accountId `557058:83b04839-8bde-4331-9c2d-24843d0b8e67`. Both copies of the skill (skill/ and ~/.claude/skills/) are identical, sync = `./install.sh` (only local→global).

## What lies uncommitted in the tree (normal, goes with a Phase 4 ledger commit)
`M .gitignore` · `M docs/handoff/ORCHESTRATION-STATE.md` · `M skill/orchestrating-delivery-agents/SKILL.md` · `?? .claude/` (settings.json; scheduled_tasks.lock already in gitignore) · `?? docs/handoff/19,20,21-*.md` · `?? docs/reports/bugs/` (the incident bug report) · `?? tools/hooks/` · `?? docs/prompts/2-*.md` (do NOT commit).

## Backlog
lab-emit: m1 (dead zC/wF in --count), m5 (answer/resolve without a status check, need --force); m6 (08:30–09:00 outside the modes) and m7 (denylist anchors · section 3) → propose as manifest candidates (the manifest is owner-sovereign, agents do NOT edit); analysis of pi/packages/orchestrator (an epic candidate); watchdog F1-S1 live-check (on the owner, runbook · section 8); e2e "a night with a fork"; gsl49 M3+8 minors; gsl58 off-by-one; SC-19 polish; local branches GSL-7/GSL-19.

## Run telemetry (cumulative — continue, do not reset)
≈72 cycles, total≈**5.43M** tokens approx (the full block in STATE; gaps 2a/32/35 flagged).

## Blocked on human
None. Question queue `tools/lab/lab-emit.sh list` → open=0.
