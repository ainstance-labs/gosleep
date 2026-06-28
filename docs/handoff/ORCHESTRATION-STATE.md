# ORCHESTRATION-STATE — gosleep (Orchestration Harness)

## At a glance (human)

- **Working on:** autonomous multi-hour campaign (owner granted full autonomy 2026-06-27). Closing epic **GSL-1** then building a new epic **"Harness hardening"** (skill-gap fixes + new eval scenarios).
- **Pane mode: CONFIRMED WORKING this session.** A probe worker opened as tmux split pane `%8` = `7:0.1` inside the orchestrator's own window 7 (content: @panecheck / Haiku / gosleep / PR #5). `teammateMode: auto` is honored at startup even though `CLAUDE_CODE_CHILD_SESSION=1`. Other windows' panes (`%6`/`%9` = tasty-lunch) are visible but NOT ours — distinguish by window membership (7.x = ours).
- **GSL-1 status:** all tasks (GSL-2/3/4/5) Done; PR **#5** open + mergeable; closing it now (regular merge) as Cycle 1.
- **TLM-58 (tasty-lunch) reconciled:** it is the "mother" epic of the whole harness, built BEFORE the gosleep repo existed. 16 tasks: 10 Done (already physically imported into gosleep = GSL-2), 1 In Progress (TLM-63 full eval run, stalled on weekly usage limit), 5 To Do skill-gaps (TLM-64/71/72/73/74). Owner decision 2026-06-27: copy ONLY the live work into GSL (no duplication of the 10 done); do NOT touch TLM-58 itself for now.
- **New epic plan "Harness hardening":** 6 skill-gap fixes (GSL-6 handoff-discipline + TLM-64/71/72/73/74 ports) + new eval-scenario authoring (E17 / VERIFY-REQUEST / watchdog) + a ledger-commit/uphousekeeping task. Each new task carries a provenance link to its TLM source key.
- **Autonomous decisions:** merge PR #5 regular; copy only the 6 live TLM tasks + reparent GSL-6; do NOT run the expensive full eval (~480 agents); defer vendoring (needs owner design choice). Models: workers=Sonnet, verification=Haiku, orchestrator=Opus.
- **Queued for owner (end-of-run questions):** (1) vendoring design A vs B; (2) run the expensive full eval (resume TLM-63 + new scenarios)?; (3) merge the Harness-hardening PR autonomously or leave for owner review?; (4) disposition of original TLM-58 (close as superseded?).
- **Standing policy:** orchestrator executes NOTHING — all delivery (commits, Jira, GitHub, dev_history, evals) to pane-workers; orchestrator only coordinates, keeps THIS file current, and writes a dated handoff at every session boundary.

## LIVE-STATUS

`cycle 2 DONE + terminated | cycle 3 NEXT | worker=gsl-fix-a (Sonnet) branch=GSL-7-harness-hardening (off main@6316954) | task=GSL-14 artifacts commit + GSL-6/8/9 skill fixes | status=GSL-7 epic In Progress; GSL-6(reparent)+GSL-8..14 created (GH #8..#15); executing skill fixes; install.sh deferred to epic finalize`

### Key mapping (epic GSL-7 "Harness hardening")
| Jira | summary | GH | source |
|---|---|---|---|
| GSL-7 | Harness hardening (epic, In Progress) | #8 | — |
| GSL-6 | handoff discipline (Bug, reparented) | #7 | operational |
| GSL-8 | recovery on-disk handoff FIRST | #9 | TLM-64 / SC-03 |
| GSL-9 | idempotent find-or-create + late IDs | #10 | TLM-71 / SC-04,11,16 |
| GSL-10 | on-disk state + telemetry + rollover | #11 | TLM-72 / SC-19,12 |
| GSL-11 | patience vs active nudge at PR boundary | #12 | TLM-73 / SC-09 |
| GSL-12 | transcript-tail abuse + context discipline | #13 | TLM-74 / SC-07,20 |
| GSL-13 | author E17/VERIFY-REQUEST/watchdog scenarios | #14 | new behavior |
| GSL-14 | track orchestration ledger + gitignore .vscode | #15 | owner decision |

## Standing rules / decisions

- 2026-06-11 (owner): orchestrator never executes delivery — all delivery to worker agents; orchestrator coordinates + keeps state on disk + writes dated handoff at each boundary. (A trivial command the owner directly asks for may be run inline.)
- **2026-06-27 (owner): FULL AUTONOMOUS multi-hour run.** Do not ask questions, do not stop mid-run (stopping loses the autonomous process). Accumulate questions and surface them at the END; owner will then answer + possibly finish remaining items. Decisions that would normally pause → make a defensible reversible call, log it, queue the question.
- Anchors (CLAUDE.md): Jira GSL @ ainstance-labs.atlassian.net (cloudId 74054cdc-47ef-497d-9684-734149876a8b; transitions To Do=11/In Progress=21/In Review=31/Done=41); GitHub ainstance-labs/gosleep; assignee Roman L (accountId 557058:83b04839-8bde-4331-9c2d-24843d0b8e67). Epic+Task only (Bug allowed); 1 branch/Epic, 1 commit/Task (msg starts with key), 1 PR/Epic, regular merge (never squash). Idempotent creates; no force-push; artifacts in-tree (never /tmp); write "section" not the glyph.
- `skill/` is source of truth for the global skill; `./install.sh` syncs local -> global (`rsync --delete`). Pull global ahead via the REVERSE rsync; never run install.sh while local is behind global.
- 2026-06-27 (owner): confirmed the copy-only-live-work plan for TLM-58 (no duplication of the 10 done tasks); leave original TLM-58 untouched for now; reparent GSL-6 under the new Harness-hardening epic (supersedes the earlier "leave GSL-6 standalone").
- 2026-06-26 (owner, deferred): vendoring of the 4 supporting skills (writing-prds, delivery-workflow, handoff, using-jira) — design A vs B NOT chosen; deferred to end-of-run.
- Operational note (2026-06-26): a graceful teammate `shutdown_request` is NOT reliable — the probe ignored it and stayed idle; force `tmux kill-pane` was needed. Use kill-pane as the fallback to terminate a stuck teammate (read-only worker = safe).

## Log

### 2026-06-11 — Phase: init (epic GSL-1)
- Orchestrator bootstrap; created this state file. Jira GSL-1 In Progress, GSL-2/3 Done, GSL-4 In Progress; PR #5 open; GH #1-4; git @ c189a66.

### 2026-06-25 — Phase: init (epic GSL-1)
- TCC/Full-Disk-Access blocker hit then resolved by owner. Reverse-synced global->local skill (E17 / VERIFY-REQUEST / watchdog / background-subagent rule), `diff -r` identical. Wrote handoff 02.

### 2026-06-26 — Phase: init (epic GSL-1)
- **Cycle 1 (gsl5-worker, Sonnet):** GSL-5 skill-sync delivered — commit `875bc26`, GH #6, Jira Done. Orchestrator-verified.
- **Cycle 2 (gsl4-worker, Sonnet):** GSL-4 stale-path fix — commit `06ed904`, Jira Done. Static path-resolution verify only (no LLM/Workflow). All GSL-1 tasks now Done.
- Owner raised worker-visibility (panes) + asked to re-confirm vendoring design. Added `teammateMode: auto` to settings; proved it needs a fresh session. Filed Bug GSL-6 + GH #7 (handoff-discipline gap). Wrote handoff 03.

### 2026-06-27 — Phase: GSL-1 close-out + new epic (Harness hardening)
- Cold-start by fresh top-level orchestrator (Opus 4.8). Raised the 4 delivery skills; reconciled live: ACCESS_OK; git @ 06ed904; skill/ `diff -r` identical; Jira GSL-1 In Progress, GSL-2/3/4/5 Done, GSL-6 Bug To Do (standalone); PR #5 open; GH #1-4/#6/#7; next free GH=#8, next Jira key=GSL-7.
- **Pane test PASSED:** probe `panecheck` (Haiku) opened as split pane `%8` in window 7; proven mine via window membership + pane content. Probe force-killed (graceful shutdown ignored).
- Read TLM-58 (tasty-lunch) full: 16 tasks, mapped Done vs live. Confirmed all Done deliverables physically present in gosleep (skill/, evals/ 20 SC-*, docs/report/, docs/design/, docs/dev-history/).
- Owner granted FULL AUTONOMOUS run; confirmed copy-only-live-work plan. Campaign started: close GSL-1 -> Harness-hardening epic.
- **Cycle 1 (gsl1-closeout, Sonnet):** GSL-1 closed — PR #5 REGULAR-merged (main @6316954), branch deleted, GH #1-4/#6 closed, epic Done. Orchestrator-verified independently (merge commit on origin/main over the 4 task commits = not squash). Worker terminated (kill-pane).
- **Cycle 2 (gsl-hardening-setup, Sonnet):** created epic GSL-7 (In Progress) + tasks GSL-8..GSL-14 + reparented GSL-6 under GSL-7; GH mirrors #8..#15. Verified via JQL + gh. Worker terminated.
