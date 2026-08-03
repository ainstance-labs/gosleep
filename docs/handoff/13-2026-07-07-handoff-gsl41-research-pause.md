# Handoff — gosleep — 2026-07-07 (GSL-41 research: PAUSED on limits, mid-phase)

> For a FRESH orchestrator or the owner returning. Read Part 1 first, then "Immediate next steps". Ground truth = `docs/handoff/ORCHESTRATION-STATE.md` (read FIRST) + this file. Supersedes the 2026-07-01 handoff (hardening arc complete).

# ── Part 1 · Plain words ──

## 1. Where we are now
gosleep — a repository of an orchestration harness (5 delivery skills). Epic **GSL-41: deep research of external orchestrators** is running (AutoSK, Warren, Overstory, ecosystem) with output as 4 HTML reports (EN+RU) + a PRD. The owner paused the work due to a limit exhaustion right in the middle: **all 5 researches are written (4 in full, 1 partial), the reports are not yet written**.

## 2. What's already done
- Epic GSL-41 + 7 tasks (GSL-42..48) filed in Jira, mirrored to GH (#48..55). Branch `GSL-41-orchestration-research` from main, commit GSL-42 (`898297c`, ledger + housekeeping) pushed.
- Researches in `docs/research/2026-07-07-orchestration/` (NOT committed, on disk): 01-autosk (32KB, READY), 02-warren-overstory (37KB, READY), 03-headless-subscription-landscape (37KB, READY), 04-loop-engineering (36KB, almost ready — the worker did not finish reporting), 05-lab-ui-mobile-autonomy (7.6KB, IN PROGRESS — cut off by the pause).
- The main answers are already obtained: (a) `claude -p` works on subscription as a first-class surface, but since ~15.06.2026 programmatic calls are marked with a separate monthly credit pool; the risk of it being closed is LOW; recommendation — keep tmux+Agent Teams as the engine; (b) orchestrator supervision is solved by a mechanical watchdog (heartbeat file + launchd + restart budget) after the Warren pattern; Overstory repeats our architecture and has the same hole; (c) AutoSK proves the subscription-native approach and gives a mobile reference (Tauri iOS, but without TLS/push).

## 3. What we're doing next
After resumption: finish 05 (res-labui), then 4 report writers + PRD, then the committer (Opus), review, PR, merge. The detailed queue — in Part 2.

## 4. Problems we have
- Subscription limits exhausted — the pause cause. Three worker panes may have remained alive (quiesced by the owner directly): res-loops, res-labui, writer-landscape — they must be re-verified on resume (see Part 2).
- Telemetry of cycles 5-7 (res-loops, res-labui, writer-landscape) NOT received — the workers did not finish reporting; in TELEMETRY there is a gap flag.
- Machine spawn limit: at most 3 simultaneous worker panes (the 4th falls with "fork failed: Device not configured").

## 5. Comments & recent decisions
- Owner (2026-07-07): all agents on Fable 5; only mechanics on Opus 4.8. Orchestrator PULSE every ~5-10 min with a live fleet (ScheduleWakeup at the end of every turn) — after my dead-stall.
- Incident lesson: `tmux kill-pane -a` killed the first researcher fleet — kill panes ONLY by explicit id. The transient "API Error: Server error mid-response" is cured by one continue nudge on the findings file (verified 2×).
- Researchers write findings incrementally into THEIR file, do not touch git (one committer at the end). Clones — in the gitignored `.research-cache/`.

# ── Part 2 · Formal / precise ──

## ⚠️ Hard rules (carry verbatim)
- NO Workflow tool. ALL agents = tmux-pane teammates (Fable 5; Opus 4.8 only mechanics). Max 3 concurrent panes. Pulse ~270s with a live fleet. kill-pane only by explicit id. The orchestrator does NOT execute delivery itself. Reviews+merges automatic (full autonomy). Artifacts in the project tree; no /tmp.
- Epic+Task; 1 branch/Epic; 1 commit/Task (`GSL-N ...`); 1 PR/Epic; REGULAR merge; idempotency; no force-push.

## Connections
| Thing | Value |
|---|---|
| Jira | GSL, cloudId 74054cdc-47ef-497d-9684-734149876a8b; To Do=11/In Progress=21/In Review=31/Done=41 |
| GitHub | ainstance-labs/gosleep; main @ 41566be; branch `GSL-41-orchestration-research` @ `898297c` (pushed) |
| Epic | GSL-41 (In Progress) = GH #48; tasks GSL-42..48 = GH #49..55; GSL-42 Done, the rest To Do |
| Next free | Jira GSL-49; GH #56 |
| Owner | Roman L, rommxx@gmail.com, accountId 557058:83b04839-8bde-4331-9c2d-24843d0b8e67 |

## Fleet at pause (2026-07-07 ~23:15 local)
- Panes of window 1:0: %36 = orchestrator; %91 = res-loops (04, file 35596B — almost ready, report NOT sent); %92 = res-labui (05, file 7618B — IN PROGRESS); %93 = writer-landscape (was reading inputs, has not yet created report files). The owner himself told them to pause — expected quiesced.
- Windows/sessions 0/2/3/4 tmux — OTHER people's projects, do not touch.

## Immediate next steps (⭐ RESUME POINT)
1. Read `ORCHESTRATION-STATE.md` + this handoff; `tmux list-panes -t 1:0` — verify the panes against "Fleet at pause".
2. Live quiesced workers: res-loops — nudge "finish COVERAGE and send the final report with telemetry"; res-labui — nudge "continue by the brief from where you stopped" (the brief in the session log / recover from this handoff · section Writer-briefs); writer-landscape — nudge "continue: write docs/reports/orchestrator-landscape/index.html + RU/index.html". Dead panes → restart with a -2 suffix, telling them to continue from the partial file.
3. Next the writer queue (max 3 panes, Fable 5): (b) writer-headless → `docs/reports/headless-and-supervision/` (inputs 03+02, READY); (c) writer-autonomy → `docs/reports/autonomy-lab-ui/` (inputs 05+01); (d) writer-loops → `docs/reports/loop-engineering/` (input 04); (e) writer-prd → `docs/prd/` (all 5 findings + reports; markdown per the writing-prds skill; phase structure; LAST).
4. Report requirements (owner): a dashboard from scratch, self-contained HTML (inline CSS/SVG, no external resources), light+dark theme, responsive, SVG diagrams, explain terms simply from context, in maximum detail (duplication OK), EN `index.html` + a full RU version `RU/index.html`, each report in its own folder.
5. After the writers: the committer (Opus, mechanics): commits per task — GSL-43 (findings pack: docs/research/*), GSL-44..47 (per report), GSL-48 (PRD), each with a dev_history file `docs/dev_history/GSL-NN-...md` + updating the README index; Jira transitions to Done; push; PR `GSL-41 ...` (body: Implements GSL-41, checklist, Mirrors GH #48, Closes #48..#55); reviewer (Fable 5) by pushed SHA; merge REGULAR; close GH issues; epic → Done.
6. Telemetry of cycles 5-7 request in the final worker reports; if a worker is dead — a range-read of its `## ORCHESTRATOR REPORT` block does NOT apply (these are findings files, not handoffs) → write `tokens=UNRECOVERED — gap flagged`.

## Writer briefs (reference — writer-landscape)
The full text of the writer-landscape brief is stored in this session's log; key elements for reconstruction: role, input findings files, output paths (`docs/reports/<folder>/index.html` + `RU/index.html`), owner requirements (dashboard/terms/detail), HTML technical requirements (self-contained, themes, responsive, SVG), rules (no git, no Workflow, ≤2 subagents, incremental, PROGRESS >10 min, context up to ~75-80%), final report ≤12 lines + telemetry.

## Gotchas
- Findings NOT committed (untracked) — do not lose them on branch switch; only the committer worker commits them as task GSL-43.
- `docs/prompts/2-deep-orchestrating-research.md` untracked — the owner's file, do not include in commits without their decision.
- 03-headless CAVEAT: credit pool figures ($20/$100/$200) from secondary sources — verify before use in the PRD.
- The existing `docs/reports/token-overage-incident-2026-06-28` — old style, the owner asked NOT to orient by it.
- Spawn cap 3; "API Error mid-response" → one continue nudge; kill-pane only by id.

## Blocked on the human
- Resumption of work (limits). Optional on resume: confirm the budget for the writers phase (5 Fable cycles + committer + review ≈ noticeable spend).
