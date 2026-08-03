# Handoff — gosleep — 2026-07-10 (GSL-49 watchdog complete: self-observation is built and merged)

> For a FRESH orchestrator or the owner returning. Read Part 1 first, then "Immediate next steps". Ground truth = `docs/handoff/ORCHESTRATION-STATE.md` (read FIRST) + Jira GSL + this repository. Supersedes the 2026-07-09 handoff (GSL-41 complete).

# ── Part 1 · Plain words ──

## 1. Where we are now
gosleep — a repository of an orchestration harness. Just **fully completed epic GSL-49 "Watchdog over the orchestrator"** (Phase 1 PRD): PR #66 merged into `main @ 878f438`, all tasks/issues closed, branch deleted, fleet empty. GoSleep got **a self-observation contour** — an answer to the owner's main pain "there is no one to restart the orchestrator at night".

## 2. What's already done (what is built, plain words)
- **Heartbeat:** on every pulse the orchestrator first writes a "pulse" line to disk (`docs/handoff/.orchestrator-heartbeat`, JSONL with ts/cycle/context%/workers and **pane id**), atomically, the file truncates itself to 200 lines.
- **Watchdog** (`tools/watchdog/watchdog.sh` v0.5.0): a mechanical script WITHOUT an LLM, run by launchd on a schedule; judges aliveness only by durable state; a stale heartbeat → nudge; death/hang → **kills only the pane confirmed by pane id from the heartbeat** (uncertainty → `kill_refused` + escalation to the owner — does NOT kill blindly); then restarts a fresh orchestrator with a **re-wake brief** (`references/re-wake-brief.md`, placeholders substituted).
- **Safeguards:** budget 3 restarts/hour (persistent) + exponential backoff; startup grace 120s; a zombie confirmed by 3 cycles; kill cooldown 300s; mass pane death = escalation, not restarts; before any kill — a reap snapshot in the ledger; a kill failure gates the re-wake (there will not be two orchestrators). Smoke suite: 65 checks, green.
- **Runbook in Russian** (`docs/runbooks/watchdog.md`, 8 sections): install/check/read ledger/escalations/pause/troubleshooting.
- **The review stage paid off:** caught a CRITICAL (a positional pane resolve could kill a live WORKER instead of the dead orchestrator) — fixed BEFORE merge.

## 3. What we're doing next
The next epic is **"AutoSK Anatomy v2" (GSL-58)**: dissection of autosk "to the bones" FROM CODE ONLY (the owner forbade runs): pi-agent internals, Go TUI, 6 unmerged PRs, site re-fetch, a dashboard report `docs/reports/autosk-anatomy/` EN+RU. After it — Phase 2 PRD (self-pulse/night mode).

## 4. Problems we have
- **Watchdog is NOT enabled** — plist installation only by the owner manually (per the runbook). F1-S1 (live fire with a real kill) was not tested — observe the first firing.
- Follow-ups from the review: M3 (ledger spam on prolonged mass-death) + 8 minor — in `docs/reviews/REVIEW-gsl49.md` (gitignored, local).
- The orchestrator ledger (STATE + this handoff) is again uncommitted — commit as task 1 of epic GSL-58.

## 5. Comments & recent decisions
- Owner: models — Fable 5 on all substantive, Opus 4.8 on pure mechanics; AutoSK anatomy — CODE-ONLY (no runs of third-party code); on epic boundaries do NOT stop (autonomous continuation); explain every spawn/stop; PULSE every ~4.5 min with a live fleet.
- Lessons in force: kill-pane only by explicit id; spawn cap 3 panes; API-error → one continue nudge; session-limit — survive.

# ── Part 2 · Formal / precise ──

## ⚠️ Hard rules (carry verbatim)
- NO Workflow tool. Agents = tmux-pane teammates. Max 3 simultaneous worker panes. PULSE ~270s with a live fleet (ScheduleWakeup at the end of every turn). kill-pane ONLY by explicit id. The orchestrator does not execute delivery. Reviews+merges automatic. Fable 5 substantive / Opus 4.8 pure mechanics. AutoSK anatomy: CODE-ONLY. Artifacts in the tree.
- Epic+Task; 1 branch/Epic; 1 commit/Task; 1 PR/Epic; REGULAR merge; idempotency; no force-push; dev_history per task.

## Connections
| Thing | Value |
|---|---|
| Jira | GSL, cloudId 74054cdc-47ef-497d-9684-734149876a8b; To Do=11/In Progress=21/In Review=31/Done=41 |
| GitHub | ainstance-labs/gosleep; **main @ 878f438** (merge PR #66); 0 open PRs |
| Next free | Jira GSL-58; GH #67 |
| Owner | Roman L, rommxx@gmail.com, accountId 557058:83b04839-8bde-4331-9c2d-24843d0b8e67 |

## GSL-49 artifacts (in main)
- Commits: 036549a (GSL-50) / ef054ad (GSL-51) / f35d27e (GSL-56) / d719a68 (GSL-52) / 0013503 (GSL-53) / 322cf30 (GSL-54) / 48936de (GSL-55, amended) / 4f520e7 (GSL-57) / 0377298 (GSL-51 fix) / 7be1b5b (GSL-52 fix). PR #66 merged @ 878f438.
- Paths: `tools/watchdog/` (watchdog.sh v0.5.0, smoke.sh 65 checks, plist.template, install-watchdog.sh render-only, conf.example, LEDGER.md); `skill/orchestrating-delivery-agents/SKILL.md` (sections Heartbeat protocol + Re-wake); `references/re-wake-brief.md`; `docs/runbooks/watchdog.md`; dev_history GSL-50..57 + index.

## Telemetry (summary; the full block in STATE)
Epic GSL-49 = cycles 15-23 (setup Opus; impl-51/impl-56/impl-tooling×4/impl-57 Fable; mechanic/finalizer Opus; reviewer+fixer Fable). The whole run from 2026-07-07: ~53 cycles, ≈3.3M tokens (approx, + gap 2a).

## Immediate next steps (⭐ RESUME POINT)
1. **Epic GSL-58 "AutoSK Anatomy v2"** (setup spawns right after this handoff): task 1 = a housekeeping ledger commit (STATE + this handoff); tasks 2-5 = research CODE-ONLY (pi-agent module by module, Go TUI, 6 PRs, site re-fetch); task 6 = a report `docs/reports/autosk-anatomy/index.html` + `RU/index.html`.
2. Then — **Phase 2 PRD** (self-pulse/night mode) with the same pipeline setup→impl→PR→review→merge.
3. For the owner (optional): enable the watchdog per `docs/runbooks/watchdog.md`; observe the first firing (F1-S1).

## Gotchas
- Spawn cap 3 panes; kill-pane only by id; API-error → one nudge; session-limit → resume; the owner's prompts file (docs/prompts/2-*.md) do not commit without their decision; do not run the eval runner (Workflow) without explicit permission.
- tmux sessions 0/2/3/4 — other people's projects; our window 1:0 (%36 — orchestrator).

## Blocked on the human
- Nothing blocking. Optional: enabling the watchdog (runbook), a decision on follow-up minors, the fate of the prompts file.
