# Handoff — gosleep — 2026-07-10 (GSL-65 mid-flight: orchestrator roll point at 66% context)

> For a FRESH orchestrator (after a summarization/re-roll). Read Part 1, then "Immediate next steps". Ground truth = `docs/handoff/ORCHESTRATION-STATE.md` (FIRST) + this file. Supersedes the previous handoff 16 on the resume point.

# ── Part 1 · Plain words ──

## 1. Where we are now
Epic **GSL-65 "Self-pulse + night mode" (PRD Phase 2)** is running. THE WHOLE implementation is ready: 6/6 tasks committed LOCALLY on branch `GSL-65-self-pulse-night` (HEAD `7e9b37c`, origin lagging — only `270e519` is pushed). The fleet is EMPTY (impl-pulse terminated confirmed). Mechanical steps remain: push+PR → review → merge → close. Today already merged: epics GSL-49 (watchdog, PR #66) and GSL-58 (autosk anatomy, PR #74).

## 2. GSL-65 ready commits (locally)
GSL-66 270e519 (ledger) · GSL-67 f35a2b2 (pulse cadence + armed-wake-up) · GSL-68 b510de8 (night mode/QUESTIONS-PENDING) · GSL-69 d1fbb42 (quota auto-wait, smoke +2) · GSL-70 79f76bb (circuit-breaker) · GSL-71 7e9b37c (HEARTBEAT_OK fast-path + docs). Gates passed: install.sh clean, smoke 67/67, watchdog v0.5.0 contract intact. Jira GSL-66..71 all Done; epic GSL-65 = GH #75, tasks = GH #76..#81.

## 3. Immediate next steps (⭐ RESUME POINT — execute in order)
1. **Spawn the mechanic** (Opus, name gsl65-mechanic, mechanics): raise the using-jira skill; `git push origin GSL-65-self-pulse-night`; `gh pr create` title `GSL-65 Self-pulse + night mode — PRD Phase 2`, body: `Implements GSL-65.` + checklist `- [x] GSL-66..71 (#76..#81)` + `Mirrors GH #75.` + `Closes #75, #76, #77, #78, #79, #80, #81.` + CC footer; Jira epic → In Review (31); report ≤10 lines + telemetry; self-quiesce.
2. **Reviewer** (Fable, gsl65-reviewer): lenses: integrity of the new SKILL.md sections (cadence vs cache economics; armed-wake-up vs roll gates; night mode vs denylist — critical wakes; quota-wait vs watchdog quiesced v0.5.0; breaker vs loop-guard without duplication); run `tools/watchdog/smoke.sh` yourself (our code) — green 67/67; install.sh identical; dev_history 6 + index; PR body. Report → docs/reviews/REVIEW-gsl65.md (gitignored) + ≤12 line verdict MERGE/FIX + telemetry.
3. FIX critical → fixer (Fable) → finalizer again; **MERGE → finalizer** (Opus, gsl65-finalizer): CLEAN → `gh pr merge --merge` (REGULAR) → close remaining issues #75..#81 → Jira epic Done (41) → `git checkout main && git pull --ff-only` (do NOT stash the ledger; block → `git fetch origin main:main` + checkout) → delete the branch local+origin → report + telemetry.
4. **Epic final:** finalizer telemetry into STATE → shutdown → confirm → STATE (EPIC GSL-65 COMPLETE, next Jira=GSL-72, GH=#82) → handoff 18 (epic complete, per handoff 15/16 template) → REPORT to the owner (Phase 2 merged: cadence/night/quota-wait/breaker/fast-path = the "owner sleeps" core together with the watchdog).
5. **WITHOUT STOPPING → Phase 3 PRD** (question buffer + decision manifest): setup Opus (PRD Phase 3 section → epic+tasks+task-1 housekeeping ledger (STATE+handoff 18) + GH mirror + branch + commit + push) → impl Fable → mechanic PR → review → merge → report → Phase 4 Laboratory. Pipeline and briefs — per the GSL-65 template (see STATE log).

## 4. Process rules (verbatim, IN FORCE)
Fable 5 substantive / Opus 4.8 pure mechanics; NO Workflow; max 3 worker panes (spawn cap); PULSE ~270s with a live fleet + armed-wake-up EVERY turn; kill-pane ONLY by explicit id; the orchestrator does not execute delivery; reviews+merges automatic; on epic boundaries continue autonomously; explain every spawn/stop to the owner with "why"; telemetry into STATE after every cycle; API-error → one continue nudge; session-limit → quiesce+resume; CODE-ONLY for someone else's code; do not run the eval runner; docs/prompts/2-*.md do not commit; tmux sessions 0/2/3/4 are other people's.

## 5. Connections + backlog
Jira GSL cloudId 74054cdc-47ef-497d-9684-734149876a8b (To Do=11/In Progress=21/In Review=31/Done=41); GH ainstance-labs/gosleep; owner Roman L accountId 557058:83b04839-8bde-4331-9c2d-24843d0b8e67. Backlog: pi/packages/orchestrator analysis (prior art, epic candidate); watchdog F1-S1 live-check (on the owner); e2e night run with rate_limit injection (F2-S3 operational); gsl49 M3+8 minors; gsl58 off-by-one; SC-19/N-header/SC-11; local branches GSL-7/19. Run telemetry: ~61 cycles, ≈4.6M tokens (+2a gap) — the full block in STATE.
