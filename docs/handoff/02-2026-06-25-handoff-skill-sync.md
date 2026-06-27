# Handoff — gosleep (Orchestration Harness) — 2026-06-25 (skill-sync)

> For a FRESH agent / orchestrator. Read Part 1 (plain words) first, then Part 2, then "Immediate next steps".
> Supersedes the 2026-06-09 harness handoff (TLM-era; its tracker refs are superseded by the GSL project).
> Status of record: Jira project GSL + `docs/handoff/ORCHESTRATION-STATE.md`.

# ── Part 1 · Plain words ──

## 1. Where we are now
gosleep is a standalone repo that is the SOURCE OF TRUTH for the global `orchestrating-delivery-agents`
skill (plus that skill's eval suite, docs, and HTML reports). Root:
`/Users/romanlidovskyi/Documents/dev/harness/gosleep`. We're inside epic GSL-1 ("project init"),
branch `GSL-1-project-init`, PR #5 open.

## 2. What's already done
- GSL-2 (Done): imported harness v0 (`skill/`, `evals/`, `docs/`, reports).
- GSL-3 (Done): project anchors — `CLAUDE.md`, `docs/dev_history/`, `README`.
- GSL-4 (In Progress): fixing stale absolute ROOT paths in report generators + eval runner — on-plan WIP
  sits uncommitted in the tree (4 files).
- This session: the owner-approved **reverse-sync of the global skill into local `skill/` is DONE** and
  verified `diff -r` identical. It is UNCOMMITTED in the tree.

## 3. What we're doing next
Wrap the skill sync as proper delivery: a new task **GSL-5** "[Skill] Sync orchestrating-delivery-agents
from global", one commit touching ONLY `skill/`, a mirrored GitHub issue, a dev_history file, Jira → Done.
Then decide with the owner whether to finish GSL-4 and close the epic (merge PR #5). New eval scenarios for
the freshly-synced behavior are a separate follow-up.

## 4. Problems we have
- **macOS TCC blocker (RESOLVED 2026-06-25, may recur).** The whole project under `~/Documents` returned
  EPERM ("Operation not permitted") for all content reads/writes — Bash (even sandbox-disabled) and the
  Read/Write tools alike — while `stat`/`ls -ld` still worked. Root cause: `~/Documents` is TCC-protected
  and the host app's Full Disk Access grant was lost after a multi-day session resume + model switch
  (Fable 5 → Opus 4.8). Fixed by the owner re-granting Full Disk Access and restarting the host app. If it
  recurs, see "Immediate next steps" step 0.
- The skill sync is not yet committed/tracked (no GSL-5 yet).
- GSL-4 WIP is uncommitted and unverified (gates not run).

## 5. Comments & recent decisions
- Owner rule (standing): the orchestrator does NOT execute delivery — sync/commit/Jira/dev_history go to a
  worker agent; the orchestrator coordinates and keeps state on disk. A trivial command the owner directly
  asks for may be run inline (that's why the rsync itself was run by the orchestrator).
- Owner decision (2026-06-25): accept the latest global skill wholesale into local — done.
- The synced skill diff is a single coherent capability: protection against a hung browser-verifier —
  edge-case E17, the VERIFY-REQUEST pattern (worker never drives a browser; asks the orchestrator), a
  steps.log verification watchdog, and the background-subagent rule for hang-prone tools.

# ── Part 2 · Formal / precise ──

## Hard rules (carry forward verbatim)
- Orchestrator executes NO delivery work; delegate to a worker (owner's standing rule). Keep state in
  `docs/handoff/ORCHESTRATION-STATE.md`.
- Jira hierarchy Epic + Task only (free tier, no Story). One branch per Epic, one commit per Task
  (message starts with the key: `GSL-N …`), one PR per Epic, regular merge (never squash).
- Task summaries start with `[Tag]` markers (`[Repo]`/`[Docs]`/`[Tooling]`/`[Process]`/`[Evals]`/`[Skill]`).
- GitHub Issues mirror Jira (labels epic/task, cross-links both ways). Assign every Jira issue to the owner
  at create time. Idempotent creates: search before creating any epic/task/issue/branch and reuse a match.
- `skill/` is the source of truth. `./install.sh` syncs local → global (`rsync --delete`) — NEVER run it
  while local is behind global. Pulling global ahead is the REVERSE rsync (see Gates).
- dev_history: one file per task at `docs/dev_history/<TASK-KEY>-<phase>-<slug>.md`; index
  `docs/dev_history/README.md`. Legacy TLM history in `docs/dev-history/` (hyphen) — do not touch.
- No force-push. Do not write the section glyph (use the word "section"). All orchestration artifacts live
  inside the project tree, never `/tmp`.

## How we work
Skills: `orchestrating-delivery-agents` (this flow), `delivery-workflow` + `using-jira` (mechanics),
`handoff` (this file's format). Atlassian MCP for Jira; `gh` for GitHub.

## Connections
- Jira: project GSL, site `ainstance-labs.atlassian.net`, cloudId
  `74054cdc-47ef-497d-9684-734149876a8b`. Transitions: To Do=11, In Progress=21, In Review=31, Done=41.
  Board: https://ainstance-labs.atlassian.net/jira/software/projects/GSL/boards/100
- GitHub: `ainstance-labs/gosleep` (private). PR #5 open (branch `GSL-1-project-init`).
  Issues: #1→GSL-1, #2→GSL-2, #3→GSL-3, #4→GSL-4. Next free GH number = 6.
- Owner/assignee: Roman L (rommxx@gmail.com), accountId `557058:83b04839-8bde-4331-9c2d-24843d0b8e67`.

## Live state (fetched this session)
- Jira: GSL-1 In Progress (epic) · GSL-2 Done · GSL-3 Done · GSL-4 In Progress. No GSL-5 yet.
- git: branch `GSL-1-project-init`, HEAD `c189a66`. Uncommitted: `docs/report/build-report.js`,
  `docs/report/build-subagents.py`, `evals/runner/eval-runner.js`, `evals/runner/gen-scenarios.js`
  (GSL-4 WIP); `skill/SKILL.md`, `skill/references/worker-cycle-template.md`,
  `skill/references/lifecycle-and-edge-cases.md` (this session's sync); untracked
  `docs/handoff/ORCHESTRATION-STATE.md`.

## Immediate next steps (THE RESUME POINT)

Step 0 — if EPERM recurs (project under `~/Documents` unreadable/unwritable):
  - Check: `ls /Users/romanlidovskyi/Documents/dev/harness/gosleep >/dev/null 2>&1 && echo ACCESS_OK || echo STILL_EPERM`
  - If STILL_EPERM → owner-only GUI fix: System Settings → Privacy & Security → Full Disk Access → enable
    the host app (Terminal / iTerm / VS Code / Claude Desktop) → RESTART that app (TCC needs a restart).
    Do NOT try chmod/chflags/xattr — they EPERM too. Last resort (owner consent only): move the repo out of
    `~/Documents` to e.g. `~/dev/harness/gosleep` (changes anchors/abs paths).

Step 1 — the skill reverse-sync is ALREADY DONE this session (verify, don't redo):
  - Verify still identical:
    `diff -r /Users/romanlidovskyi/Documents/dev/harness/gosleep/skill/ /Users/romanlidovskyi/.claude/skills/orchestrating-delivery-agents/`  (empty = identical)
  - If for any reason it drifted, redo: `rsync -a --delete <global>/ skill/`.

Step 2 — wrap as delivery via a WORKER (owner's delegation rule), idempotent find-or-create:
  - Jira: find-or-create GSL-5 "[Skill] Sync orchestrating-delivery-agents from global" under epic GSL-1,
    assignee = owner, transition to In Progress (21).
  - GitHub: mirror issue #6 (label `task`, cross-link to GSL-5 and back).
  - Commit ONLY the `skill/` paths (leave GSL-4 WIP and ORCHESTRATION-STATE.md out of this commit):
    `GSL-5 Sync orchestrating-delivery-agents skill from global (E17 / VERIFY-REQUEST / verification watchdog)`
  - dev_history: `docs/dev_history/GSL-5-init-skill-sync.md` + a line in `docs/dev_history/README.md`.
  - Jira GSL-5 → Done (41).

Step 3 — owner decision forks (AskUserQuestion, do NOT do autonomously):
  - finish GSL-4 (commit its WIP) before merging PR #5?
  - add new eval scenarios for the synced behavior (E17/VERIFY-REQUEST/watchdog)? SC-01..20 don't cover it.
  - whether `docs/handoff/ORCHESTRATION-STATE.md` should be committed or stay an untracked orchestration artifact.

## Gates
- No CI. After editing `skill/`: do NOT run `./install.sh` here (it pushes local → global; wrong direction
  and unnecessary — local already equals global).
- Report generators + eval runner per README "Use"; GSL-4 is fixing their stale ROOT path constants — make
  sure the path constant points at the current root before running any generator/runner.

## Read first
- `CLAUDE.md` (anchors + conventions), `docs/handoff/ORCHESTRATION-STATE.md` (live ground truth),
  `skill/SKILL.md` (the just-synced skill), the 2026-06-09 harness handoff (background, partly stale).

## Gotchas
- Refer to prior handoffs in prose ("the 2026-06-09 harness handoff"), never as a literal dated `.md`
  filename in body text (breaks the docs anchor checker).
- TCC EPERM can recur on resume — Step 0.
- ORCHESTRATION-STATE.md is currently untracked (see Step 3 fork).

## Blocked on the human
- Nothing hard-blocking right now (TCC access restored). The Step 3 forks need the owner's call before
  closing GSL-4 / the epic / PR #5.

## Telemetry / context
Orchestrator on Opus 4.8 (was Fable 5 at session start). No worker cycle run yet (cycle 0).
