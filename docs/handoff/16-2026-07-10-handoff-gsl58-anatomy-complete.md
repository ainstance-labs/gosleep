# Handoff — gosleep — 2026-07-10 (GSL-58 complete: AutoSK anatomy "by molecules" merged)

> For a FRESH orchestrator or the owner returning. Read Part 1 first, then "Immediate next steps". Ground truth = `docs/handoff/ORCHESTRATION-STATE.md` (read FIRST) + Jira GSL + the repository. Supersedes the earlier 2026-07-10 handoff (GSL-49 watchdog).

# ── Part 1 · Plain words ──

## 1. Where we are now
Epic **GSL-58 "AutoSK Anatomy v2" IS COMPLETE**: PR #74 merged into `main @ a217393`, all issues closed, Jira Done, branch deleted, fleet empty. The owner's requirement "dissect autosk to the bones, by molecules, from code only" is met: the review verified 14 report citations line by line against real clone code — no fabrications. No third-party code was run (owner ban honored).

## 2. What's already done (and where to look)
Dashboard report: **`docs/reports/autosk-anatomy/index.html`** (EN, 135KB) + **`RU/index.html`** (full Russian, 175KB): module-by-module anatomy of the pi stack, 3 sequence SVGs (task lifecycle, pi RPC, claude stream-json), protocol dictionary (31 commands + 20 events), config surface, 24 failure modes, TUI patterns, analysis of 6 PRs, an adopt list of 23 items. Raw material: `docs/research/2026-07-10-autosk-anatomy/` (4 files, all with file:line).

## 3. Main findings
1. **pi (earendil-works/pi) — the second subscription-native harness** (OAuth PKCE over Claude Pro/Max); its RPC is richer than `claude -p` stream-json: session forks, cursor-based get_entries, host bash.
2. **pi has a first-party experimental `packages/orchestrator`** (spawns and supervises N `pi --mode rpc` children) — direct prior art for GoSleep. In the backlog as a candidate for a separate deep analysis.
3. **agent_settled vs agent_end**: the true completion signal in pi is `agent_settled` (auto-retry/compaction continue an "ended" run), and the autosk driver sits on `agent_end` — a latent race. Lesson for us: verify true completion signals.
4. **autosk FROZEN**: 12+ days without commits, bus-factor 1, all 6 external PRs orphaned after the v1→v2 rewrite. Strategy confirmed: take the ideas, do not depend.
5. **TUI**: gocui/lazygit stack, 10 patterns to "steal" (push-redraw+CAS, owner-anchored composer, fail-open markdown...) / 1 "do not repeat" for the future admin panel.
6. **From the PRs**: a JSONL error matrix, the cancel-vs-result priority rule, content-hash revisions of workflow definitions.

## 4. Problems we have
Nothing blocking. Minor from the review: an off-by-one line reference to go.mod in 03-tui.md (substance correct) — to the backlog. The ledger (STATE + this handoff) uncommitted — as task 1 of the next epic.

## 5. Comments & recent decisions
Rules in force: Fable 5 substantive / Opus 4.8 pure mechanics; NO Workflow; max 3 panes; PULSE ~270s; kill-pane only by id; on epic boundaries continue autonomously; explain every spawn to the owner. Today TWO epics closed: GSL-49 watchdog (PR #66) and GSL-58 anatomy (PR #74).

# ── Part 2 · Formal / precise ──

## ⚠️ Hard rules (carry verbatim)
NO Workflow tool. Agents = tmux-pane teammates. Max 3 worker panes (machine spawn cap). PULSE ~270s with a live fleet. kill-pane only by explicit id. The orchestrator does not execute delivery. Reviews+merges automatic. Fable 5 substantive / Opus 4.8 mechanics. Artifacts in the tree. Epic+Task; 1 branch/Epic; 1 commit/Task; 1 PR/Epic; REGULAR merge; idempotency; no force-push; dev_history per task. API-error → one continue nudge; session-limit → resume.

## Connections
| Thing | Value |
|---|---|
| Jira | GSL, cloudId 74054cdc-47ef-497d-9684-734149876a8b; To Do=11/In Progress=21/In Review=31/Done=41 |
| GitHub | ainstance-labs/gosleep; **main @ a217393** (merge PR #74); 0 open PRs |
| Next free | Jira GSL-65; GH #75 |
| Owner | Roman L, rommxx@gmail.com, accountId 557058:83b04839-8bde-4331-9c2d-24843d0b8e67 |

## GSL-58 artifacts (in main)
Commits: b38b768 (GSL-59 ledger) / ba2177d (GSL-60 pi-agent) / 1763dde (GSL-61 TUI) / a293a94 (GSL-62 PRs) / 4b4d3ab (GSL-63 site) / 19274b5 (GSL-64 report). PR #74 merged @ a217393. Clones for cross-check: `.research-cache/autosk@fd4c22e`, `.research-cache/pi@34582ef` (gitignored).

## Immediate next steps (⭐ RESUME POINT)
1. **Epic Phase 2 PRD "Self-pulse + night mode"** (setup spawns right after this handoff): task 1 = a housekeeping ledger commit (STATE + this handoff); further tasks from `docs/prd/PRD-gosleep-evolution.md` Phase 2 section. Context for impl: SKILL.md sections PULSE/heartbeat + findings `docs/research/2026-07-07-orchestration/04-loop-engineering.md` (self-pacing, cache windows, activeHours/night mode).
2. Then — Phase 3 PRD (question buffer + decision manifest).
3. Backlog: pi/packages/orchestrator analysis (epic candidate — prior art!); watchdog F1-S1 live-check (on the owner); gsl49 M3+8 minors; gsl58 off-by-one; SC-19/N-header/SC-11; branches GSL-7/19; owner's prompts file (commit?).

## Gotchas
Spawn cap 3; kill-pane by id; a checkout on a dirty ledger → `git fetch origin main:main` + checkout (do not stash); do not run the eval runner (Workflow) without the owner; tmux sessions 0/2/3/4 — other people's; CODE-ONLY for someone else's code.

## Blocked on the human
Nothing. Optional: enable the watchdog (docs/runbooks/watchdog.md), the fate of the prompts file, priority of the pi/orchestrator analysis.
