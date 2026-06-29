# ORCHESTRATION-STATE — gosleep (Orchestration Harness)

## At a glance (human)

- **Working on:** **Epic GSL-24 "Harness hardening v2"** — make the 4 eval-FAILED v1 fixes actually change agent behavior. v1 (GSL-7) edited the skill text but the behavioral eval showed 4 of 6 fixes did NOT move behavior (abstract prose ≠ behavior change). v2 = CONCRETE, imperative, example-driven edits that NAME the exact anti-pattern, placed prominently (Red flags / Quick reference).
- **Reality (2026-06-29 cold-start, verified live):** `main @ c46eb74` (GSL-19 eval epic merged via PR #27). Four epics shipped & closed: GSL-1, GSL-7 (hardening v1), GSL-15 (vendoring), GSL-19 (efficient+SAFE eval runner + validation scorecard). No open PRs. Fleet empty (no panes in my window 7; no background Workflow tasks). Window 10 = a DIFFERENT project's fleet — NOT ours, never touch.
- **v2 epic ready:** GSL-24 (In Progress, GH #28) + tasks GSL-25 (SC-09), GSL-26 (SC-19), GSL-27 (SC-12), GSL-28 (SC-11) all To Do, plus GSL-29 (re-validate at N=2). Per-task v2 plan lives in each Jira task description.
- **Why v2 (eval finding, scorecard `evals/results/2026-06-29-0028-scorecard.md`):** GREEN scores SC-09=0.0 (patience-vs-nudge), SC-19=0.0 (rollover-while-worker-alive), SC-12=0.25 (telemetry), SC-11=0.75 (state-mechanics). These 4 fixes underperformed → v2 rewrites them concretely.
- **Plan this run:** Cycle 1 pane-worker = ledger housekeeping (new GSL-30) + the 4 concrete skill fixes (1 commit/task, commit-before-next, `./install.sh` after) → orchestrator-run controlled GSL-29 eval Workflow (4 scenarios, N=2, cached RED) → Cycle 2 pane-worker commits scorecard+analysis + opens the GSL-24 epic PR (In Review). Owner-gated: whether to auto-merge the v2 PR.
- **CONTROL on evals (hard lesson — see incident below):** the eval runner is a background Workflow (invisible agents, NOT panes). Run ONLY via `evals/runner/run-config.json` (requires explicit scenarios; 120-agent ceiling that throws). Control-test first, watch live agent count, NEVER fire-and-forget.
- **Standing policy:** orchestrator executes NOTHING delivery — all commits/Jira/GitHub/dev_history to pane-workers (Sonnet); verification = Haiku; orchestrator = Opus, only coordinates + owns THIS file + writes a dated handoff at every boundary. The GSL-29 eval Workflow is the ONE orchestrator-run action (workers are banned from the Workflow tool), under tight control.

## LIVE-STATUS

`cycle=0 (cold-start complete) | orchestrator=Opus 4.8 (1M) pane=%7 win=7 | tree=/Users/romanlidovskyi/Documents/dev/harness/gosleep branch=GSL-19-eval-validation(merged)@c46eb74 | fleet=EMPTY | latest handoff=docs/handoff/07-2026-06-29-handoff-v2-execution.md | status=ABOUT TO SPAWN Cycle 1 (gsl24-fixes, Sonnet) = ledger GSL-30 + skill fixes GSL-25/26/27/28. next Jira=GSL-30, next GH=#34.`

## TELEMETRY (cumulative — never reset)

`cycles_completed≈12 (prior sessions) | tokens: NOT precisely tracked across prior sessions (no TELEMETRY block kept before now; the 2026-06-28 242-agent incident alone ≈ 1.2M out / 0.59M in / 25.4M cache-read) | forward-tracking starts this session | open_workers=[] | budget: no hard ceiling agreed; eval runs capped at 120 agents by the runner; loop-guard = stop if 2 cycles with non-advancing NEXT.`

## Standing rules / decisions

- 2026-06-11 (owner): orchestrator never executes delivery — all delivery to worker agents; orchestrator coordinates + keeps state on disk + writes dated handoff at each boundary. (A trivial command the owner directly asks for may be run inline.)
- 2026-06-27 (owner): FULL AUTONOMOUS multi-hour run. Don't ask mid-run (stopping loses the process); accumulate questions, surface at END; decisions that would pause → make a defensible reversible call, log it, queue the question.
- 2026-06-28 (owner): RUN evals OPTIMALLY (efficient-agent-evals): cache + reuse RED, re-run GREEN only, batched judge, deterministic asserts, right-size N.
- 2026-06-28 (owner): N=**2** for eval runs going forward.
- 2026-06-28 (owner): VENDORING = Option A — gosleep is SOURCE OF TRUTH for ALL delivery/orchestration skills; per-skill subfolders under `skill/`; `install.sh` installs all local→global.
- 2026-06-28 (owner): TLM-58 = DROPPED (owner closes it himself); OFF our queue.
- **2026-06-28/29 (eval incident — IRON RULE):** never fire-and-forget a multi-agent Workflow. Eval runner reads `evals/runner/run-config.json` (gitignored), REFUSES without explicit scenarios (no silent full-run), throws if expected agents > 120. Always control-test first + watch live agent count + watchdog.
- Anchors (CLAUDE.md): Jira GSL @ ainstance-labs.atlassian.net (cloudId 74054cdc-47ef-497d-9684-734149876a8b; transitions To Do=11/In Progress=21/In Review=31/Done=41); GitHub ainstance-labs/gosleep; assignee Roman L (557058:83b04839-8bde-4331-9c2d-24843d0b8e67). Epic+Task only (Bug allowed); 1 branch/Epic, 1 commit/Task (msg starts with key), 1 PR/Epic, regular merge (never squash). Idempotent creates; no force-push; artifacts in-tree (never /tmp); write "section" not the glyph.
- `skill/` source of truth; `./install.sh` syncs local→global per-skill (`rsync --delete` scoped to each `~/.claude/skills/<name>/`, never the parent). Pull global ahead via REVERSE rsync; never install while local is behind global.
- Models: workers=Sonnet, verification=Haiku, orchestrator=Opus. ALWAYS pass `model:` explicitly when spawning.
- Operational: graceful teammate `shutdown_request` is NOT reliable — use `tmux kill-pane` to terminate a stuck read-only worker.
- PROCESS LESSON (v1 Cycle 4): workers MUST commit each task BEFORE editing the next file/section — else all edits collapse into one commit (per-task granularity lost; can't fix without banned force-push).

## v2 key mapping (epic GSL-24 "Harness hardening v2")

| Jira | summary | GH | targets | v1 GREEN |
|---|---|---|---|---|
| GSL-24 | Harness hardening v2 (epic, In Progress) | #28 | — | — |
| GSL-25 | v2 SC-09: forbid vague "keep monitoring"; mandate ONE concrete nudge + example | #29 | SC-09 | 0.0 |
| GSL-26 | v2 SC-19: hard gate — never roll while a worker is alive | #30 | SC-19 | 0.0 |
| GSL-27 | v2 SC-12: concrete TELEMETRY-in-STATE mechanism | #31 | SC-12 | 0.25 |
| GSL-28 | v2 SC-11: concrete state-update on suspect handoff / late ID | #32 | SC-11 | 0.75 |
| GSL-29 | v2 re-validate (SC-09/11/12/19 @ N=2, cached RED) | #33 | all 4 | — |
| GSL-30 | ledger housekeeping (handoffs 04–07 + STATE + reports + 0009 scorecard) | #34 (to create) | — | — |

## Owner questions (saved — surface at end of run; owner unavailable)

- Merge the GSL-24 v2 PR autonomously, or leave for owner review? (Conservative default: open PR, leave In Review — skill-governance change; owner explicitly flagged this.)
- Long-term eval architecture: eval agents are inherently background Workflow (cannot be panes); acceptable to keep controlling via config+ceiling+control-test+watchdog, or want a pane-native design?
- Token-credit report for the 242-agent incident at `docs/reports/token-overage-incident-2026-06-28/index.html` — owner previously said NOT to send (treat as closed unless owner reopens).

## Log

### 2026-06-11 → 2026-06-28 — epics GSL-1, GSL-7, GSL-15, GSL-19 (compressed)
- **GSL-1 (init):** imported harness v0, wired tracker+GitHub, fixed stale ROOT paths, synced skill. PR #5 regular-merged. Done.
- **GSL-7 (hardening v1):** 6 skill-gap fixes (recovery on-disk-first, idempotent+late-IDs, state+telemetry+rollover, patience-vs-nudge, transcript-discipline) + authored eval scenarios SC-21/22/23. PR #16 regular-merged; `./install.sh` synced global. Done. **Per-task granularity anomaly in Cycle 4** (all 3 edits landed in one commit) — documented, lesson captured above.
- **GSL-15 (vendoring, Option A):** restructured `skill/` into per-skill subfolders + multi-skill `install.sh`; vendored 4 supporting skills; updated CLAUDE.md+README. PR #21 regular-merged (main `b1753a1`). Verified all 5 skills diff-r identical vs global, ~74 unrelated globals intact. Done.
- **GSL-19 (eval validation):** made runner efficient (batched judge + per-scenario N + RED cache); ran on cost-appropriate models (Sonnet under-test, Haiku judge); FILE-based run-config + hard 120-agent safety after the incident; ran the controlled validation (86 agents, N=4, cached RED). Scorecard `evals/results/2026-06-29-0028-scorecard.md`. PR #27 regular-merged (main `c46eb74`). Done.
- **INCIDENT (2026-06-28):** a "2-scenario smoke" launched via Workflow defaulted to all-23 (arg didn't propagate) and was fire-and-forgot → 242 invisible background agents before TaskStop. Salvage: ~21 cached RED baselines (reused since). Root-caused by GSL-23. Report at `docs/reports/token-overage-incident-2026-06-28/`.
- **EVAL FINDING → motivates v2:** GREEN SC-09=0.0, SC-19=0.0, SC-12=0.25, SC-11=0.75. Text-only edits didn't change behavior.

### 2026-06-29 — Phase: GSL-24 hardening v2 (epic GSL-24)
- **Cold-start by fresh top-level orchestrator (Opus 4.8, 1M ctx).** Raised the 4 delivery skills. Reconciled live: `main @ c46eb74`; fleet empty (window 7 = me only; window 10 = foreign fleet; TaskList empty); no open PRs; GH issues #28–33 open; Jira GSL-24 In Progress, GSL-25/26/27/28/29 To Do, GSL-1/7/15/19 Done. STATE was stale (didn't reflect GSL-19 merge + v2 epic) — rewrote it (this file). Plan set (see At a glance). About to spawn Cycle 1.
