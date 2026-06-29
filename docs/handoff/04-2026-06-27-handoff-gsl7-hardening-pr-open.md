# Handoff — gosleep (Orchestration Harness) — 2026-06-27 (autonomous hardening run complete; GSL-7 PR #16 open, awaiting owner)

> For a FRESH orchestrator. Read Part 1 (plain words) first, then Part 2, then "Immediate next steps".
> Supersedes the 2026-06-26 GSL-1-complete / pane-mode handoff. Live ground truth of record: `docs/handoff/ORCHESTRATION-STATE.md` (the orchestrator's living ledger) + Jira project GSL + this repo. STATE file wins if they ever disagree.

# ── Part 1 · Plain words (read first) ──

## 1. Where we are now
gosleep is the standalone repo that owns the `orchestrating-delivery-agents` skill plus its eval suite, docs and reports. Two things just happened in one autonomous session (the owner asked for several hours of hands-off work): (a) the first epic **GSL-1** "Project initialization" was **merged and closed** (PR #5, regular merge), and (b) a whole new epic **GSL-7 "Harness hardening"** was built, executed, verified, and its PR **#16** is now **open and clean, waiting for the owner to merge**. Every task is Done; nothing is half-finished. The only things left are decisions that are genuinely the owner's to make.

## 2. What's already done
- **GSL-1 closed:** PR #5 merged to `main` with a regular merge (commit `6316954`), branch deleted, GH issues #1–4/#6 closed, epic Done.
- **GSL-7 "Harness hardening" epic built & in review** (branch `GSL-7-harness-hardening`, PR **#16**, mergeState CLEAN, 8 commits):
  - **GSL-14** committed the orchestration ledger + handoffs + kickoff prompts into git and gitignored `.vscode/`.
  - **6 skill fixes** to `skill/` — GSL-6 (a dated handoff is now MANDATORY at every orchestrator boundary), GSL-8 (recovery reads the newest on-disk handoff FIRST before live probes), GSL-9 (idempotent find-or-create by stable key + reconcile late IDs), GSL-10 (atomic STATE writes + telemetry carried across rollover), GSL-11 (patience vs one active nudge at the PR boundary), GSL-12 (tightened the "read a dead worker's report" exception). A cheap independent reviewer (Haiku) checked all six: **PASS** (coherent, no contradictions, structure intact).
  - **GSL-13** authored three new eval scenarios — SC-21 (hung browser-verifier / E17), SC-22 (VERIFY-REQUEST), SC-23 (verification watchdog) — each with a separate judge-only rubric, registered in the runner. Authored only, NOT run.
- All work was done by Sonnet worker-agents in tmux panes; verification by a Haiku agent; the orchestrator (Opus) only coordinated and kept state on disk. Each step was independently verified against live git / gh / Jira.

## 3. What we're doing next
Nothing more can be done without the owner. Four decisions are waiting (details in "Immediate next steps"): **(1) merge PR #16** (the skill changes — deliberately left for a human glance since they become the canonical/global skill), **(2) the vendoring design** A vs B (still unanswered — it blocks a separate vendoring epic), **(3) whether to run the expensive full eval suite** to behaviourally validate the fixes (~480 agents; it hit the weekly usage limit last time), and **(4) what to do with the original TLM-58** epic in the tasty-lunch project (owner said leave it for now).

## 4. Problems we have
- **One known anomaly (not blocking):** the GSL-10/11/12 SKILL.md edits all landed in a single commit (`6f9565e`, the GSL-10 commit); the GSL-11 and GSL-12 commits carry only their dev_history. The content is all correct and present — only the "one commit per task" granularity is off for two tasks. It was NOT corrected because that needs history rewrite + force-push (banned) and interactive rebase (unavailable here). Disclosed in the PR body.
- The skill fixes are verified for COHERENCE (a text review), not yet BEHAVIOURALLY (that needs the eval run — decision #3).

## 5. Comments & recent decisions
- **Pane mode works in this session** despite `CLAUDE_CODE_CHILD_SESSION=1`: workers opened as tmux split panes inside the orchestrator's own window (proven by capturing a worker pane: its name/model/project matched). Other tmux windows belong to a separate tasty-lunch orchestrator — distinguish by tmux **session/window**, never by pane id.
- **Graceful teammate shutdown is unreliable** — a `shutdown_request` was ignored and the worker stayed idle; `tmux kill-pane` (after confirming the pane by content, never by recycled id, and excluding the orchestrator's own pane `%7`) is the reliable terminate. This is now also encoded in the skill.
- **Why PR #16 was left open** (not merged autonomously even under the full-autonomy grant): merging propagates skill-governance changes to the canonical repo and, via `./install.sh`, to the GLOBAL skill used by all the owner's projects. That deserves a 2-minute human glance. All the *tasks* are resolved; the epic-merge is the standard owner gate.

# ── Part 2 · Formal / precise ──

## Hard rules (owner's non-negotiables — carry forward verbatim)
- **The orchestrator executes NOTHING.** All delivery (commits, Jira, GitHub, dev_history, evals) goes to worker agents in tmux panes; the orchestrator only coordinates, keeps state on disk in `ORCHESTRATION-STATE.md`, and writes a dated handoff at EVERY session boundary (now enforced by GSL-6 in the skill itself).
- Epic + Task only (Bug allowed). 1 branch/epic, 1 commit/task (msg starts with the key `GSL-N …`), 1 PR/epic, **regular merge (never squash)**. Idempotent creates. No force-push. Artifacts inside the tree, never `/tmp`. Write "section", never the glyph.
- GitHub Issues mirror Jira (labels epic/task, cross-links both ways). Assign every Jira issue to the owner at create time.
- `skill/` is the source of truth; `./install.sh` syncs local→global (`rsync --delete`); never run it while local is behind global (reverse-rsync first).
- Models: orchestrator premium (Opus); workers mid (Sonnet); verification cheap (Haiku).
- Full-autonomy run (2026-06-27): don't stop to ask mid-run; accumulate decisions and surface them at the end.

## Connections
| Thing | Value |
|---|---|
| Jira | project **GSL**, site `ainstance-labs.atlassian.net`, cloudId `74054cdc-47ef-497d-9684-734149876a8b` |
| Jira transitions | To Do=11, In Progress=21, In Review=31, Done=41 |
| GitHub | `ainstance-labs/gosleep` (private). main @ `6316954`. **Epic PR #16 OPEN (CLEAN)**, branch `GSL-7-harness-hardening` @ `5d25fe9` (8 commits ahead). **Next free GH number = #17** |
| Owner / assignee | Roman L, rommxx@gmail.com, accountId `557058:83b04839-8bde-4331-9c2d-24843d0b8e67` |
| Teammate mode | `~/.claude/settings.json` → `"teammateMode": "auto"` (do NOT change) |

## Epic GSL-7 key/commit map
GSL-7 epic (#8, In Review) · GSL-6 #7 `0cfc321` · GSL-8 #9 `ba03660` · GSL-9 #10 `ae2f0cd` · GSL-10 #11 `6f9565e` · GSL-11 #12 `2353039` · GSL-12 #13 `9022bec` · GSL-13 #14 `5d25fe9` · GSL-14 #15 `e8a0dc3`. All 8 tasks Jira Done.

## Gates
No CI. The skill gate is `./install.sh` after editing `skill/` (syncs local→global) — **deferred to the owner's merge decision** (skill-governance changes). Report/eval generators need the Workflow harness + LLM to run functionally; do NOT blindly run the full eval suite (cost/hang). Skill-edit coherence was verified by a Haiku reviewer (report: `docs/reviews/REVIEW-hardening-skill.md`, gitignored).

## What exists in code
- `skill/` — `orchestrating-delivery-agents` source (SKILL.md + references). On `main` it is the pre-hardening version; the 6 hardening fixes live on the **GSL-7 branch / PR #16** (not yet on main, not yet synced to global).
- `evals/scenarios/` — SC-01..SC-20 + the new SC-21/22/23 (on the GSL-7 branch). Runner index = `ALL_SCENARIOS` in `evals/runner/eval-runner.js`.
- `docs/dev_history/` — per-task history incl. GSL-6/8/9/10/11/12/13/14. `docs/handoff/` — this ledger + handoffs 01–04. `docs/design/`, `docs/report/`.

## Immediate next steps (THE RESUME POINT — all owner-gated)
1. **Merge PR #16** (epic GSL-7) — REGULAR merge only. Then: `git checkout main && git pull`; run `./install.sh`; verify `diff -r skill/ ~/.claude/skills/orchestrating-delivery-agents/` is empty (identical); delete the branch; close GH issues #7,#8,#9,#10,#11,#12,#13,#14,#15 if not auto-closed; transition epic GSL-7 → Done (41). Delegate to a worker.
2. **Vendoring design** — get the owner's A-vs-B choice (A = repo owns all 5 skills uniformly; B = repo owns orchestrating-delivery-agents + vendors the other 4 as global→local snapshots — recommended). Then create a new vendoring epic and execute via workers.
3. **Full eval run** (resume TLM-63 equivalent + run the new SC-21/22/23) — only on the owner's go (cost; hit the weekly limit before). Use the `efficient-agent-evals` skill to keep agent count/cost down.
4. **TLM-58 disposition** — owner said leave it; when decided, mark it "superseded by GSL-7" in tasty-lunch and close, OR migrate anything still wanted.
5. **Commit the post-PR orchestration artifacts** — this handoff (#04) and the latest `ORCHESTRATION-STATE.md` are uncommitted working-tree changes (GSL-14 committed 02/03 + STATE-snapshot on the branch; #04 is newer). Fold them into a future "track artifacts" commit after PR #16 merges.

## Read first
- `docs/handoff/ORCHESTRATION-STATE.md` — the live ledger (read FIRST, always).
- This handoff (narrative snapshot).
- `docs/reviews/REVIEW-hardening-skill.md` — the Haiku coherence review of the 6 skill fixes (gitignored).
- PR #16 on GitHub — the epic diff + task checklist + the disclosed granularity anomaly.

## Gotchas
- Working tree is currently on `GSL-7-harness-hardening` (a worker's last checkout). After PR #16 merges, `git checkout main && git pull`; expect uncommitted `ORCHESTRATION-STATE.md` + this handoff to ride along.
- Distinguish OUR tmux workers (session/window 7) from the tasty-lunch orchestrator's (other windows). Never kill another session's panes. Identify workers by pane CONTENT (`@<name>`), never by recycled pane id, and always exclude the orchestrator's own pane.
- Graceful `shutdown_request` is unreliable — use `tmux kill-pane` to terminate a finished/stuck worker.
- The GSL-10/11/12 commit-granularity anomaly is accepted, not a bug to "fix" with force-push.

## Blocked on the human
- **Merge PR #16** (decision #1) — then install.sh + epic close.
- **Vendoring design A vs B** (decision #2) — blocks the vendoring epic.
- **Run the expensive full eval suite?** (decision #3).
- **TLM-58 disposition** (decision #4).
