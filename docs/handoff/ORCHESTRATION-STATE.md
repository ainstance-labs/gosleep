# ORCHESTRATION-STATE — gosleep (Orchestration Harness)

## At a glance (human)

- **Working on:** **GSL-41 deep-research orchestration (started 2026-07-07)** per owner prompt `docs/prompts/2-deep-orchestrating-research.md`: deep analysis of autosk / warren / overstory (+ landscape), `claude -p` headless & subscription question, orchestrator-supervision problem, autonomy (question buffer, decision manifest), "Laboratory" concept, UI + mobile, loop engineering. Deliverables: 4 HTML dashboard reports (EN+RU, each in own folder under `docs/reports/`) + PRD in `docs/prd/`.
- **Plan:** cycle 1 setup (Opus, mechanical: housekeeping + branch + Jira/GH scaffolding) → cycles 2-6 five parallel research pane-workers (Fable 5, write findings to `docs/research/2026-07-07-orchestration/`, NO git ops) → report writers (Fable 5, 4 reports EN+RU + PRD) → pane review (Fable 5) → merge.
- **Prior arc:** HARDENING ARC COMPLETE (2026-07-01) — GSL-24 v2, GSL-31 v3, GSL-37 eval-quality all merged (`main @ 41566be`, PRs #35/#42/#47). Eval final: SC-09 fixed+discriminating, SC-12 skill validated, SC-19 0.75, SC-11 ok. Lesson: mechanism-fix > prose; suspicious RED≥GREEN inversion = check eval calibration first.
- **⛔ OWNER DIRECTIVES IN FORCE:** (1) NO Workflow tool — ALL agents = tmux-pane teammates; eval-runner (a Workflow) only via `run-config.json` with explicit scenario list + tiny control run + live agent-count watch, ask owner first; N=2 for evals. (2) **2026-07-07 model policy: ALL agents = Fable 5; ONLY technical/mechanical tasks = Opus 4.8** (supersedes Sonnet/Haiku tiering for this run).
- **Standing policy:** orchestrator executes NOTHING — all commits/Jira/GitHub → pane-workers; reviews + merges AUTOMATIC (owner full autonomy); orchestrator owns THIS file + dated handoffs.
- **Minor backlog (untracked, owner to decide):** SC-19 polish to ≥0.8; eval-runner stale "N=2" scorecard header; SC-11 higher-N confirm. Old local branches GSL-7/GSL-19 have live remotes — left for owner.

## LIVE-STATUS

`PHASE GSL-41 research | cycle 1 (setup) SPAWNING | orchestrator=Fable 5, pane 1:0.0 %36 | main=41566be | tree=/Users/romanlidovskyi/Documents/dev/harness/gosleep on GSL-37-eval-quality (merged; setup worker moves it to main → GSL-41-orchestration-research) | latest handoff=docs/handoff/12-2026-07-01-handoff-hardening-arc-complete.md | 0 open PRs/issues | next Jira=GSL-41, next GH=#48 | ⛔ NO Workflow; models: Fable 5 all, Opus 4.8 mechanical only.`

## TELEMETRY (cumulative — never reset; append one line per cycle)

`cycles_completed≈30 (hardening arc, prior runs) | open_workers=[] | tokens: not surfaced by harness per-cycle.`
- `GSL-24 v2: fixes + eval-control(6)/full(18) → SC-11 fixed, SC-12 partial, SC-09/SC-19 0.0. PR #35 (c150a3d).`
- `GSL-31 v3: GSL-35 recalib SC-09 + GSL-32 flowchart-exception + GSL-33 kill-to-roll + GSL-34 SC-12. eval-v3(30) → SC-09 0→1.0, SC-19 0→0.75, SC-11 0.5(noise), SC-12 0.0. PR #42 (571f1d5).`
- `GSL-37 eval-quality (pane-eval, NO Workflow): GSL-40 ledger + GSL-39 SC-09 discrimination + GSL-38 SC-12 recalib+tighten. → SC-09 RED0/GREEN3, SC-12 GREEN3/3. PR #47 (41566be).`

## Standing rules / decisions

- 2026-06-11 (owner): orchestrator never executes delivery — all to worker agents; state on disk + dated handoff each boundary.
- 2026-06-27/28 (owner): FULL AUTONOMOUS; evals OPTIMALLY; N=2 default, N=4-6 borderline; VENDORING Option A.
- 2026-06-29 (owner): FULL AUTONOMY — reviews AND merges automatic. Pause only for denylist/irreversible/credentials.
- 2026-07-01 (owner, IN FORCE): NO Workflow tool. ALL agents (incl. testing) = tmux-pane teammates. No mass-spawn. Control the process. Ask before any Workflow.
- **2026-07-07 (owner, IN FORCE): model policy — use EXCLUSIVELY Fable 5 agents; ONLY technical/mechanical tasks → Opus 4.8.** (Supersedes workers/reviewers=Sonnet + verify=Haiku for this run.)
- loop-guard: a behavior unmoved across 2 genuine attempts → investigate CALIBRATION / surface to owner.
- Anchors: Jira GSL cloudId 74054cdc-47ef-497d-9684-734149876a8b (To Do=11/In Progress=21/In Review=31/Done=41); GitHub ainstance-labs/gosleep; assignee Roman L 557058:83b04839-8bde-4331-9c2d-24843d0b8e67. Epic+Task/Bug; 1 branch/Epic, 1 commit/Task, 1 PR/Epic, REGULAR merge; idempotent; no force-push; artifacts in-tree; "section" not the glyph.
- `skill/` source of truth; `./install.sh` per-skill local→global. Always pass `model:` explicitly when spawning.
- Research-run specifics (2026-07-07): third-party clones go to gitignored `.research-cache/`; research workers write ONLY to `docs/research/2026-07-07-orchestration/<own-file>.md` and do NO git operations (single committer pattern — one worker commits per task); web via WebFetch/WebSearch (clone repos and read code locally as primary method).

## Eval status (per scenario — FINAL after GSL-37)

| Scenario | RED | GREEN | verdict |
|---|---|---|---|
| SC-09 stalled-at-pr | 0/3 | 3/3 | FIXED + discriminating |
| SC-11 suspect-handoff | 0 | 1.0 (v2) | fixed in v2; v3's 0.5 was N=2 noise |
| SC-12 cost-telemetry | 0/3 | 3/3 | skill VALIDATED; scenario recalibrated |
| SC-19 rollover | 0 | 0.75 | improved; minor polish deferred |

## Log

### 2026-06-11 → 2026-07-01 (compressed — hardening arc, COMPLETE)
- GSL-1 init (#5), GSL-7 v1 (#16), GSL-15 vendoring (#21), GSL-19 eval runner (#27). 242-agent incident root-caused by GSL-23.
- GSL-24 v2 (#35), GSL-31 v3 (#42), GSL-37 eval-quality (#47) — details in TELEMETRY + handoff 12. Fleet emptied, session boundary at handoff 12.

### 2026-07-07 — Phase GSL-41: deep-research orchestration (autosk/warren/overstory → reports + PRD)
- Owner ran `docs/prompts/2-deep-orchestrating-research.md`; model directive: Fable 5 all agents, Opus 4.8 mechanical only.
- Cold-start verified clean: fleet empty, 0 open PRs/issues, Jira all Done, single worktree; ledger (STATE + handoff 12) uncommitted → setup worker commits it.
- Cycle 1 (gsl41-setup, Opus): SPAWNING — housekeeping (main, prune merged local branches GSL-15/24/31/37), branch GSL-41-orchestration-research, .gitignore + `.research-cache/`, Jira Epic GSL-41 + 7 tasks + GH mirror, ledger commit.
