# Handoff — gosleep (Orchestration Harness) — 2026-06-28 (vendoring complete; harness now self-contained; 2 owner decisions left)

> For a FRESH orchestrator. Read Part 1 (plain words) first, then Part 2, then "Immediate next steps".
> Supersedes the 2026-06-27 GSL-7 PR-open handoff. Live ground truth: `docs/handoff/ORCHESTRATION-STATE.md` (read FIRST) + Jira GSL + this repo.

# ── Part 1 · Plain words (read first) ──

## 1. Where we are now
Three whole epics shipped in this autonomous run and gosleep is now a **self-contained orchestration toolkit**: it owns the hardened orchestration skill AND vendored copies of the four supporting delivery skills, with one installer that pushes them all to the user's global skills. There are NO open epics, NO running workers, and NO open PRs. Only two decisions remain, both genuinely the owner's.

## 2. What's already done (this run)
- **GSL-1 "Project initialization" — merged & closed** (PR #5, regular merge).
- **GSL-7 "Harness hardening" — merged & closed** (PR #16, merge `a6ecc9a`): 6 fixes to the orchestrating-delivery-agents skill (mandatory dated handoffs, on-disk-first recovery, idempotent+reconcile IDs, atomic state + telemetry rollover, patience-vs-nudge, tightened transcript exception) + 3 new eval scenarios (SC-21 hung-verifier, SC-22 VERIFY-REQUEST, SC-23 watchdog). Coherence-reviewed PASS. `./install.sh` synced it to global.
- **GSL-15 "Vendor all delivery skills" — merged & closed** (PR #21, merge `b1753a1`): Option A. `skill/` restructured into per-skill subfolders; the 4 supporting skills (`writing-prds`, `delivery-workflow`, `handoff`, `using-jira`) vendored in; `install.sh` rewritten to install every owned subfolder local→global. **Verified SAFE**: install.sh touches only per-skill targets, never the parent — the user's other ~74 global skills confirmed intact; all 5 owned skills `diff -r` identical vs global.
- Everything ran through Sonnet pane-workers; verification via a Haiku agent; the orchestrator (Opus) coordinated and kept state on disk; every step independently verified against live git/gh/Jira.

## 3. What we're doing next
Two owner decisions (both queued, neither started):
- **Run the expensive full eval suite?** It would behaviourally validate the GSL-7 fixes + run the new SC-21/22/23. ~480 agents; it hit the Anthropic WEEKLY usage limit last time. RISK: a separate tasty-lunch orchestration is running in parallel and shares that weekly limit — a big eval run could disrupt it. That's why this is gated on the owner, not run autonomously.
- **TLM-58 disposition** (the original harness epic in the tasty-lunch project): owner said leave it for now; when decided, mark "superseded by GSL-7 + GSL-15" and close, or migrate anything still wanted.

## 4. Problems we have
- None blocking. One tidiness item: the orchestrator ledger updates since GSL-14 (this handoff #05, handoff #04, and the latest `ORCHESTRATION-STATE.md` edits) are uncommitted working-tree changes. They're safe on disk; commit them in a small housekeeping task next session (or fold into the next epic).
- Minor: from Cycle 4, the GSL-10/11/12 skill edits were bundled in one commit (`6f9565e`) — content correct, granularity off; already merged, disclosed, not worth a force-push to fix.

## 5. Comments & recent decisions
- **Owner decision 2026-06-28: vendoring = Option A** — gosleep is the SOURCE OF TRUTH for ALL delivery/orchestration skills, because the owner is building a global orchestration system of many skills + tools, all mastered here. (See memory `gosleep-owns-all-delivery-skills`.)
- The owner is running this in **full-autonomy mode**: don't stop to ask mid-run; accumulate decisions; resolve small things optimally/professionally.
- Operational learnings now in the skill + STATE: graceful teammate shutdown is unreliable (use `tmux kill-pane`); the uncommitted orchestrator ledger blocks local `git checkout`/`gh pr merge --delete-branch` (workers merge via the GitHub REST API or `git stash` the 2 ledger files around a checkout); identify workers by pane CONTENT in OUR tmux session/window only, never by recycled pane id, always excluding the orchestrator's own pane `%7`.

# ── Part 2 · Formal / precise ──

## Hard rules (carry forward verbatim)
- Orchestrator executes NOTHING — all delivery to pane-workers; orchestrator coordinates, keeps `ORCHESTRATION-STATE.md`, writes a dated handoff at EVERY session boundary (enforced by the skill via GSL-6).
- Epic + Task only (Bug allowed). 1 branch/epic, 1 commit/task (key-first), 1 PR/epic, REGULAR merge (never squash). Idempotent creates. No force-push. Artifacts in-tree, never /tmp.
- GitHub Issues mirror Jira; assign every issue to the owner. Models: orchestrator Opus, workers Sonnet, verification Haiku.
- `skill/` is the source of truth for ALL 5 skills (per-skill subfolders). `./install.sh` installs every owned subfolder local→global (rsync --delete PER SKILL ONLY — never the `~/.claude/skills` parent).

## Connections
| Thing | Value |
|---|---|
| Jira | project **GSL**, cloudId `74054cdc-47ef-497d-9684-734149876a8b`. Transitions To Do=11/In Progress=21/In Review=31/Done=41 |
| GitHub | `ainstance-labs/gosleep`. **main @ `b1753a1`**. No open PRs/issues. **Next free GH = #22** |
| Owner | Roman L, rommxx@gmail.com, accountId `557058:83b04839-8bde-4331-9c2d-24843d0b8e67` |
| Next Jira key | **GSL-19** |

## What exists in code (main @ b1753a1)
- `skill/` — source of truth for 5 skills: `orchestrating-delivery-agents/` (hardened, SKILL.md + references/), `writing-prds/`, `delivery-workflow/`, `handoff/`, `using-jira/` (each a SKILL.md) + `skill/README.md` index.
- `install.sh` — multi-skill installer (per-skill rsync, safe). `evals/` — SC-01..SC-23 + runner. `docs/dev_history/` (GSL-2..GSL-18), `docs/handoff/` (01–05), `docs/design/`, `docs/report/`, `CLAUDE.md` (updated for multi-skill layout).

## Immediate next steps (THE RESUME POINT — both owner-gated)
1. **Eval run?** — if the owner approves, run the suite ECONOMICALLY (use the `efficient-agent-evals` skill to cut agent count/cost) and mind the shared weekly limit + the parallel tasty-lunch run. Delegate to workers; it produces a scorecard that may reveal more skill-gaps (-> a follow-up hardening epic).
2. **TLM-58 disposition** — owner's call; then a worker closes/links it.
3. **Housekeeping** (small, can do proactively): commit the uncommitted orchestration ledger (handoffs 04/05 + STATE) — as a tiny tracked task on a fresh branch off main.
4. The working tree is on a local `GSL-15-vendoring` label (remote deleted). Next session: `git stash -u` the 2 ledger files, `git checkout main`, `git pull`, `git stash pop`.

## Gotchas
- install.sh must NEVER `rsync --delete` the `~/.claude/skills` parent — only per-skill subdirs (protects gstack/superpowers/gsd-* etc.).
- Distinguish OUR pane-workers (tmux session/window 7) from the tasty-lunch orchestrator's (other windows). Never kill another session's panes.
- Refer to prior handoffs in prose, never as a literal dated `.md` filename in a doc body.

## Blocked on the human
- Run the expensive full eval suite? (weekly-limit + parallel-run risk).
- TLM-58 disposition.
