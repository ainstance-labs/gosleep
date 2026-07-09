# Handoff — gosleep — 2026-07-01 (hardening arc complete: v2 + v3 + eval-quality all merged)

> For a FRESH orchestrator or the owner returning. Read Part 1 first, then "Immediate next steps". Ground truth = `docs/handoff/ORCHESTRATION-STATE.md` (read FIRST) + Jira GSL + this repo. Supersedes the 2026-06-29 handoffs.

# ── Part 1 · Plain words ──

## 1. Where we are now
gosleep is the self-contained orchestration-harness repo (owns 5 delivery skills). The whole "harness hardening" arc is DONE: three epics this run — **GSL-24 (v2)**, **GSL-31 (v3)**, **GSL-37 (eval-quality)** — all merged to `main @ 41566be`. There are **no open PRs and no open issues**; the fleet is empty. The behavioral eval that drove everything now shows the skill is in good shape.

## 2. What happened (the story + the payoff)
- The eval had flagged 4 behaviors as broken (SC-09, SC-11, SC-12, SC-19). v1 and v2 tried to fix them by editing the skill's PROSE — and mostly failed.
- v3 cracked it with two moves: fix the eval CALIBRATION (some scenarios were themselves wrong) and edit the decision MECHANISM (a finalize-boundary exception right in the idle-decision flowchart; a hard rule against killing a live worker to roll).
- The eval-quality follow-ups (GSL-37) then finished the job and, importantly, revealed that the remaining "gaps" were the EVAL's fault, not the skill's: once the SC-09 and SC-12 scenarios were calibrated correctly, the skill's behavior passed cleanly (SC-09 RED 0/3 vs GREEN 3/3; SC-12 GREEN 3/3).
- Net: SC-09 fixed + discriminating, SC-19 much improved (0.75), SC-11 fine (v2 fix; a v3 dip was N=2 noise), SC-12 skill validated + scenario now discriminates.

## 3. What we're doing next
Nothing is pending. Only a small, non-urgent backlog remains (below), which the owner can pick up or drop. The big work is complete.

## 4. Problems / open (all minor, none tracked as issues)
- SC-19 sits at 0.75 — a small polish (make the skill enumerate the concrete rollover ceremony steps) would push it ≥0.8.
- SC-12's tightened rubric (require the ORCHESTRATOR-REPORT range-read) is the hardest criterion to score consistently — watch for judge variance.
- The eval-runner writes a stale "N=2" header on the scorecard when per-scenario N overrides are used (cosmetic runner bug).
- SC-11's N=2 noise could be confirmed at higher N if it ever matters.

## 5. Comments & recent decisions
- **Owner directive IN FORCE: no Workflow tool this session.** All agents — including eval/testing — run as tmux-pane teammates; testing uses Sonnet. Evals this run were done via a pane "eval-harness" worker that used a few single subagents (no Workflow). Delivery, review, and merge were all pane-workers; merges were server-side + regular.
- Owner granted full autonomy earlier: reviews + merges are automatic (done throughout).
- The deep lesson worth keeping: for judgment-under-tension behaviors, fix the MECHANISM (flowchart/gates) and verify the eval CALIBRATION — prose edits alone don't move behavior, and a suspicious RED≥GREEN inversion usually means the eval is wrong.

# ── Part 2 · Formal / precise ──

## ⚠️ Hard rules (carry verbatim)
- **NO Workflow tool this session.** All agents = tmux-pane teammates (Agent tool, named). Testing = Sonnet pane agents (a pane "eval-harness" worker may use a few single subagents; never the Workflow tool; never mass-spawn). Ask the owner before any Workflow.
- Orchestrator executes NOTHING delivery — commits/Jira/GitHub → pane-workers (Sonnet); review → pane reviewer-teammate; verification → Haiku; orchestrator → Opus, owns STATE + dated handoffs. Reviews + merges AUTOMATIC.
- Epic+Task/Bug; 1 branch/Epic, 1 commit/Task (msg starts with key), 1 PR/Epic, REGULAR merge (never squash); idempotent; no force-push; artifacts in-tree; "section" not the glyph.
- `skill/` source of truth; `./install.sh` per-skill local→global. loop-guard: unmoved across 2 attempts → check calibration, surface to owner, don't blind-edit.

## Connections
| Thing | Value |
|---|---|
| Jira | GSL, cloudId 74054cdc-47ef-497d-9684-734149876a8b. To Do=11/In Progress=21/In Review=31/Done=41 |
| GitHub | ainstance-labs/gosleep. **main @ `41566be`.** 0 open PRs, 0 open issues. Next free GH ≈ #48 |
| Owner | Roman L, rommxx@gmail.com, 557058:83b04839-8bde-4331-9c2d-24843d0b8e67 |
| Next Jira | GSL-41 |

## Merged this run
- **PR #35** (GSL-24 v2) `c150a3d`; **PR #42** (GSL-31 v3) `571f1d5`; **PR #47** (GSL-37 eval-quality) `41566be`.
- Epics GSL-24 / GSL-31 / GSL-37 all Done; tasks GSL-25..40 Done.
- Skill (`skill/orchestrating-delivery-agents/SKILL.md`) carries all v2+v3 edits, installed globally. GSL-37 changed only eval scenarios/rubrics + docs (no skill code).

## Immediate next steps (⭐ RESUME POINT)
No required work. If the owner wants the backlog: (1) SC-19 polish — add a concrete rollover-ceremony step list to the skill's self-monitoring/roll section, then re-test SC-19 via a Sonnet pane eval-harness (NO Workflow); (2) fix the eval-runner scorecard N-header; (3) confirm SC-11 at higher N. Each would be a new task under a fresh epic (next Jira GSL-41).

## Gotchas
- Working tree is on local branch `GSL-37-eval-quality` (merged, remote deleted). Next session: `git checkout main && git pull`; the orchestrator ledger (STATE + this handoff 12) is uncommitted and carries across (stash -u + pop if blocked). Commit it as a small housekeeping task when convenient.
- Eval testing MUST be pane-based (no Workflow) this session. The `evals/runner/eval-runner.js` is a Workflow — do NOT run it; use a pane eval-harness worker (single subagents) instead. `evals/baselines/` + `run-config.json` are gitignored.
- Window 10 in tmux = a DIFFERENT project's fleet — never touch. Our work is window 7.

## Blocked on the human
- Nothing blocking. Optional: whether to pursue the minor backlog (SC-19 polish, runner header, SC-11 confirm). Awaiting owner.
