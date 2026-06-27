# Handoff — gosleep (Orchestration Harness) — 2026-06-26 (GSL-1 tasks complete; teammate pane-mode fix; vendoring next)

> For a FRESH orchestrator. Read Part 1 (plain words) first, then Part 2, then "Immediate next steps".
> Supersedes the 2026-06-25 skill-sync handoff. Live ground truth of record: `docs/handoff/ORCHESTRATION-STATE.md` (the orchestrator's living ledger) + Jira project GSL + this repo. This file is the durable narrative snapshot; the STATE file is authoritative if they ever disagree.

# ── Part 1 · Plain words (read first) ──

## 1. Where we are now
gosleep is a standalone git repo that is the SOURCE OF TRUTH for the global `orchestrating-delivery-agents` skill (plus its eval suite, docs, and HTML reports). We are finishing the first epic, **GSL-1 "Project initialization"**, on branch `GSL-1-project-init` with one open PR, **#5**. As of today every task under GSL-1 is Done and the PR is mergeable — but the merge/epic-close is the owner's call, not automatic.

## 2. What's already done
- **GSL-2, GSL-3** — Done earlier (harness import; project anchors / CLAUDE.md / dev_history index / README).
- **GSL-5** — Done today: wrapped the already-completed global→local skill reverse-sync as delivery. Commit `875bc26`, GH mirror issue **#6**, Jira Done. Brings the verification-hardening set (edge-case E17, VERIFY-REQUEST pattern, verification watchdog, background-subagent rule).
- **GSL-4** — Done today: fixed the stale pre-move ROOT paths in the report generators + eval runner. Commit `06ed904`. The pre-existing WIP turned out to be complete; build-study.py / build-issues.py / runs.json were confirmed clean. Verification was static only (the scripts need the Workflow harness + LLM to actually run; path resolution was confirmed by a node simulation).
- Both were delivered THROUGH worker sub-agents (owner's delegation rule) and independently verified by the orchestrator against live git / gh / Jira.

## 3. What we're doing next
The owner approved four decisions today (see Part 2). The big one: **vendor the other four skills the harness builds on (writing-prds, delivery-workflow, handoff, using-jira) into the repo** so the harness is self-contained — that's a new epic and its layout/sync design is NOT yet agreed (the owner wanted to clarify the design question, which got interrupted). Also pending: a separate task for eval scenarios covering the new skill behavior, committing the orchestration artifacts into git, and finally surfacing the PR #5 merge / GSL-1 close-out to the owner.

## 4. Problems we have
The one live problem is worker visibility. The owner REQUIRES workers to open in their own tmux split panes (Agent Teams), so he can watch and steer. The previous orchestrator session ran as a child/in-process session and spawned teammates in-process (no panes). Root cause: Claude Code **v2.1.179 changed the default `teammateMode` from `"auto"` to `"in-process"`** — so the same workflow that used to open panes now stays in one terminal unless the mode is set. This is fixed in config (see gotchas) but only takes effect in a FRESH session — which is why this handoff exists.

## 5. Comments & recent decisions
- The previous orchestrator (a child/in-process session) could not open panes no matter what; this was proven empirically (25s pane-poll, live idle teammate, zero new panes). The fix needed a fresh top-level session — that restart is happening now.
- One config was changed: `"teammateMode": "auto"` was ADDED to `~/.claude/settings.json` (the key was previously absent → it used the version default). `"auto"` restores the exact pre-v2.1.179 behavior that worked before (panes when inside tmux). Nothing else in settings was touched; JSON validated.

# ── Part 2 · Formal / precise ──

## Hard rules (owner's non-negotiables — carry forward verbatim)
- **The orchestrator executes NOTHING.** All delivery (commits, Jira, GitHub, dev_history, evals) goes to worker agents; the orchestrator only coordinates and keeps state on disk in `docs/handoff/ORCHESTRATION-STATE.md`. A trivial command the owner directly asks for may be run inline.
- **Workers must run as tmux-pane teammates** (Agent Teams), not in-process — owner requirement (2026-06-26).
- Epic + Task only (free Jira tier, no Story). 1 branch/epic, 1 commit/task (message starts with the key `GSL-N …`), 1 PR/epic, **regular merge (never squash)**. Task summaries start with `[Tag]` markers.
- Idempotent creates (search before create). No force-push. All orchestration artifacts live inside the project tree, never `/tmp`. Write "section", never the paragraph glyph.
- GitHub Issues mirror Jira (labels epic/task, cross-links both ways). Assign every Jira issue to the owner at create time.
- `skill/` is the source of truth; `install.sh` syncs local→global (`rsync --delete`). Never run it while local is behind global (pull global ahead via the REVERSE rsync first).
- Model tiers: orchestrator premium; workers mid (Sonnet); verification cheap.

## How we work
Skills to raise at startup: `orchestrating-delivery-agents`, `handoff`, `delivery-workflow`, `using-jira`. The delivery mechanics (branch/commit/PR/dev_history) come from delivery-workflow + using-jira.

## Connections
| Thing | Value |
|---|---|
| Jira | project **GSL**, site `ainstance-labs.atlassian.net`, cloudId `74054cdc-47ef-497d-9684-734149876a8b` |
| Jira transitions | To Do=11, In Progress=21, In Review=31, Done=41 |
| GitHub | `ainstance-labs/gosleep` (private). PR **#5** open (epic). Issues: #1→GSL-1, #2→GSL-2, #3→GSL-3, #4→GSL-4, #6→GSL-5. **Next free GH number = #7** |
| Owner / assignee | Roman L, rommxx@gmail.com, accountId `557058:83b04839-8bde-4331-9c2d-24843d0b8e67` |
| Branch / HEAD | `GSL-1-project-init` @ `06ed904` (pushed to origin) |
| Teammate mode | `~/.claude/settings.json` → `"teammateMode": "auto"` (env var names only; no secrets here) |

## Gates
No CI. After editing `skill/`, run `./install.sh` (syncs local→global). Report generators (`docs/report/*`) and the eval runner (`evals/runner/*`) need the Workflow harness + LLM to run functionally — do NOT blindly run the full eval suite (cost/hang risk); a static path-resolution check is the safe smoke test. No `package.json`, no docs checker in the repo.

## What exists in code
- `skill/` — `orchestrating-delivery-agents` source (SKILL.md + references/), currently identical to global (`diff -r` clean).
- `evals/` — 20 behavioral scenarios SC-01..SC-20 + runner (no coverage yet for E17 / VERIFY-REQUEST / watchdog).
- `docs/report/` — HTML report generators (paths fixed under GSL-4).
- `docs/dev_history/` — per-task history (GSL-2/3/4/5 present) + README index. Legacy TLM-era history is in `docs/dev-history/` (hyphen) — do not touch.
- `install.sh`, `README.md`, `CLAUDE.md`.

## Immediate next steps (THE RESUME POINT)
1. **Verify pane mode FIRST.** On the first worker spawn, check `tmux list-panes -a` — a NEW pane must appear. If it does NOT, STOP and tell the owner (do not silently fall back to in-process). The fix (`teammateMode: auto`) is already in settings; a fresh top-level session should honor it.
2. **Re-ask the owner the vendoring design** (interrupted earlier). Two options: (A) "own all 5 uniform" — per-skill subdirs, repo is source of truth for all 5, install.sh installs all; (B) "oda authoritative + 4 mirrors" — repo owns orchestrating-delivery-agents, the 4 are vendored snapshots (global→local pull) for self-containment. Then design the new vendoring epic + tasks.
3. **Vendoring epic** (owner: "vendor now") — execute via workers (new epic key, own branch off updated main once PR #5 merges).
4. **Eval-scenarios task** for E17 / VERIFY-REQUEST / watchdog — separate task.
5. **Commit orchestration artifacts** (owner decision d, "commit all"): the dated handoffs + `ORCHESTRATION-STATE.md` into git (handoff 01 is already tracked; `.gitignore` only ignores `.artifacts/` and `docs/reviews/`). Use a GSL-keyed commit, not mixed with code.
6. **Surface to owner**: merge PR #5 (regular merge) + close epic GSL-1 — owner decision, not autonomous.
7. **[Skill] handoff-discipline fix** (owner-requested 2026-06-26): amend `orchestrating-delivery-agents` so the orchestrator self-monitoring/roll AND cold-start sections REQUIRE writing/refreshing a dated handoff file at EVERY session boundary (restart/roll/compaction/pause) — not only refreshing `ORCHESTRATION-STATE.md` — and make the `handoff` skill non-optional for orchestrator boundaries (today it is marked "optional", and the roll section says only "ensure STATE is current, start a fresh orchestrator pointed at it"). Add a matching Common-mistake + Red-flag. Deliver as a tracked task via a worker, then `./install.sh` to sync local→global. **Filed 2026-06-26 as Jira Bug GSL-6 + GH #7. OWNER DECISION: leave GSL-6 standalone (no epic) for now — decide later; do NOT auto-parent. Nothing changed in code/skill yet.**

## Read first
- `docs/handoff/ORCHESTRATION-STATE.md` — the live ground-truth ledger (read first, always).
- This handoff (the narrative snapshot).
- `docs/prompts/1-run-fresh-agent.md` — original project context (partly stale: GSL-4/GSL-5 now Done).
- `CLAUDE.md` — anchors and conventions.

## Gotchas
- **teammateMode is read at session START and does NOT hot-reload** — proven by a 25s pane-poll in the prior session. A fresh top-level session is required (the prior session was `CLAUDE_CODE_CHILD_SESSION=1`, child/in-process). Do NOT change the `teammateMode: auto` key; it restores the working pre-v2.1.179 default.
- Refer to prior handoffs in PROSE (e.g. "the 2026-06-25 skill-sync handoff"), never as a literal dated `.md` filename (it can break a docs checker; none exists here yet, but keep the habit).
- Report/eval generators are not safe to run end-to-end without the Workflow harness + LLM — static-check path resolution instead.
- dev_history files go in `docs/dev_history/` and land WITH the task's commit; legacy `docs/dev-history/` (hyphen) is untouchable TLM history.

## Blocked on the human
- **Vendoring layout/design** choice (option A vs B above) before the vendoring epic can start.
- **PR #5 merge + GSL-1 epic close-out** decision.
- The session restart itself (in progress — this handoff is the baton across it).
