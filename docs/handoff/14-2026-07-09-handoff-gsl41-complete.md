# Handoff — gosleep — 2026-07-09 (GSL-41 complete: research → 4 reports EN+RU → PRD; everything merged)

> For a FRESH orchestrator or the owner returning. Read Part 1 first, then "Immediate next steps". Ground truth = `docs/handoff/ORCHESTRATION-STATE.md` (read FIRST) + Jira GSL + this repo. Supersedes the 2026-07-07 pause handoff.

# ── Part 1 · Plain words ──

## 1. Where we are now
gosleep — a repository of an orchestration harness (owns 5 delivery skills). Epic **GSL-41 "deep research of orchestrators" IS COMPLETE**: PR #56 merged into `main @ 55907e1`, all tasks and GH issues closed, branch deleted, fleet empty. No open PRs and no unfinished Jira tasks.

## 2. What's already done
- Researched at maximum depth (clones + code + web): **AutoSK** (wierdbytes/autosk + autosk.app), **Warren** and **Overstory** (jayminwest), plus `claude -p`/headless/subscription, loop engineering as a discipline, and the tasty-lunch reference for "the Laboratory". Raw material: 5 files in `docs/research/2026-07-07-orchestration/`.
- Wrote **4 professional HTML dashboards, each in two languages** (`index.html` EN + `RU/index.html`): `docs/reports/orchestrator-landscape/`, `docs/reports/headless-and-supervision/`, `docs/reports/autonomy-lab-ui/`, `docs/reports/loop-engineering/`. All self-contained (inline CSS/SVG, light+dark theme), terms explained from scratch.
- Wrote a **PRD**: `docs/prd/PRD-gosleep-evolution.md` (748 lines) — 6 evolution phases (~35 commit-sized tasks): watchdog → self-pulse/night mode → question buffer → Laboratory → UI → mobile.
- The review passed (1 MAJOR finding about charset fixed by a fix commit before merge).

## 3. Key conclusions (briefly)
- **`claude -p` works on subscription as a first-class surface** (this is the official surface; since ~June 2026 programmatic calls come from a separate monthly metered pool). The risk of it being closed is LOW. Anthropic marks official surfaces and bans third-party harnesses.
- **Our engine (interactive Claude Code + Agent Teams/tmux) — the most defended surface**; we keep it; `claude -p` — only for bounded glue (chronicler, watchdog triage) with a budget.
- **Supervision over the orchestrator** is solved by a MECHANICAL (non-LLM) watchdog: heartbeat file + launchd + restart budget + escalation; production lessons of Gastown are mandatory (startup grace, zombie debounce, kill cooldown, exp backoff), otherwise false-fire on the first night. Overstory (our own architecture) had the same hole; the author of Warren went away from a persistent LLM coordinator entirely.
- **AutoSK** — proof of a subscription-native approach; their mobile (Tauri iOS, raw TCP without TLS/push) is obsoleted by the official **Remote Control** (subscription, push, TLS) — our stack: RC + hook→ntfy + Telegram + Tailscale.
- **Loop engineering:** our skill is above canon on the worker side, below on the orchestrator side; the minimum "owner sleeps" package = self-pulse + night mode + question buffer (LOW-MED effort). A question buffer barely exists in public code — a chance to lead.

## 4. Problems we have
- Nothing blocking. The orchestrator ledger (ORCHESTRATION-STATE.md + handoffs 13/14 + docs/prompts/2-*.md) sits on main uncommitted — commit as the first housekeeping task of the next epic (the prompts file — by the owner's decision).
- Telemetry: cycle 2a gap (the first fleet was killed before the reports) flagged in TELEMETRY; part of the numbers approx.

## 5. Comments & recent decisions
- Model policy (owner, 2026-07-09): **new agents = Fable 5; pure mechanics = Opus 4.8.** Switch history — in STATE.
- New hard rules of this phase: the orchestrator PULSE (~270s with a live fleet, ScheduleWakeup at the end of every turn); kill-pane ONLY by explicit id (the `kill-pane -a` incident killed the fleet); spawn cap = 3 simultaneous worker panes on this machine; a transient API error is cured by one continue nudge; a session-limit is survived (workers quiesce, files intact, after the reset they continue).

# ── Part 2 · Formal / precise ──

## ⚠️ Hard rules (carry verbatim)
- NO Workflow tool. ALL agents = tmux-pane teammates. Max 3 concurrent worker panes (the 4th falls: `fork failed: Device not configured`). PULSE ~270s with a live fleet. kill-pane only by explicit id after a re-list, never `-a`. The orchestrator does NOT execute delivery itself. Reviews+merges automatic (full autonomy). Artifacts in the project tree.
- Models: new agents Fable 5; pure mechanics Opus 4.8; `model:` always explicit.
- Epic+Task; 1 branch/Epic; 1 commit/Task (`GSL-N ...`); 1 PR/Epic; REGULAR merge; idempotency; no force-push; dev_history per task.

## Connections
| Thing | Value |
|---|---|
| Jira | GSL, cloudId 74054cdc-47ef-497d-9684-734149876a8b; To Do=11/In Progress=21/In Review=31/Done=41 |
| GitHub | ainstance-labs/gosleep; **main @ 55907e1** (merge PR #56); 0 open PRs/issues |
| Next free | Jira GSL-49; GH #57 |
| Owner | Roman L, rommxx@gmail.com, accountId 557058:83b04839-8bde-4331-9c2d-24843d0b8e67 |

## GSL-41 artifacts (all in main)
- Findings: `docs/research/2026-07-07-orchestration/{01-autosk,02-warren-overstory,03-headless-subscription-landscape,04-loop-engineering,05-lab-ui-mobile-autonomy}.md`
- Reports (EN + RU): `docs/reports/orchestrator-landscape/`, `docs/reports/headless-and-supervision/`, `docs/reports/autonomy-lab-ui/`, `docs/reports/loop-engineering/` — each with `index.html` + `RU/index.html`
- PRD: `docs/prd/PRD-gosleep-evolution.md` (+ `docs/prd/README.md`)
- Dev history: `docs/dev_history/GSL-42..48-*.md` + index. PR: #56 (merged). Review report: `docs/reviews/REVIEW-gsl41.md` (gitignored, local).

## Phase telemetry (summary; the full block in STATE)
14 cycles: setup (Opus), 5 researchers (Fable), 4 report writers (2 Fable + 2 Opus), PRD (Opus), committer/reviewer/finalizer (Opus). Total ≈2.6M tokens (approx, + irrecoverable gap of cycle 2a — the first fleet died before the reports). Incidents and lessons — in STATE · section Known-automation-traps + Standing rules.

## Immediate next steps (⭐ RESUME POINT)
1. **A housekeeping ledger commit** (the first task of the next epic): `docs/handoff/ORCHESTRATION-STATE.md` + `13-*.md` + `14-*.md`; `docs/prompts/2-deep-orchestrating-research.md` — ask the owner whether to commit.
2. **Pick the next epic from the PRD** (`docs/prd/PRD-gosleep-evolution.md`). Recommendation: **Phase 1 — Watchdog over the orchestrator** (highest value for "GoSleep", well specified, S-M effort) → create epic GSL-49 per the convention.
3. Minor backlog (the owner decides): SC-19 polish ≥0.8; eval-runner stale N-header; SC-11 higher-N confirm; local branches GSL-7/GSL-19 (remotes already deleted); hands-on tests of Remote Control + the hooks matrix (findings 05 NOT-covered).

## Gotchas
- Spawn cap 3 panes; kill-pane only by id; API-error → one continue nudge; session-limit → resume by nudge; `docs/reports/token-overage-incident-*` — old style, not a reference.
- The eval runner (`evals/runner/`) is a Workflow: do NOT run without the owner's explicit permission; only via run-config.json + a control run; N=2.
- tmux sessions 0/2/3/4 — other people's projects; our window 1:0.

## Blocked on the human
- Nothing blocking. Awaiting a decision: which epic is next (Phase 1 watchdog?) and the fate of the untracked prompts file.
