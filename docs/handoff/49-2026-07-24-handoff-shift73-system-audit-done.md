# Handoff — gosleep — 2026-07-24 (shift 73: global system audit complete, plan in flight)

> For a NEW orchestrator. Read Part 1 → Part 2 → RESUME. Ground truth = ORCHESTRATION-STATE.md + this file.
> Previous baton: briefing 48 (owner's audit mandate). This one supersedes it.

# ── Part 1 · Plain words ──

## 1. Where we are

The owner gave shift 73 one mandate: run a global audit of the whole orchestration system against
the original prompt `docs/prompts/2-deep-orchestrating-research.md`, make our own conclusions with
fresh eyes and draw up a development plan. The audit was carried out and closed. Twelve expert
workers, 99 findings after calibration, not a single top-severity finding left. The result was
published: a bilingual HTML dashboard in the repository, the evidence base alongside, the plan
turned into a live backlog of eight epics and 61 tasks. Right now the first unblocked epic is
in execution — quality of the web version.

The main number to understand about the project: **as research work the system is 70-75% ready,
but as a product "the owner sleeps, the system delivers" — around 45%**. The gap is explained by
three things: the mechanisms described in the instructions have no executor; the statements have
no update owner; the single source of truth about whether the system is alive is its own report
about itself.

## 2. What was done

An expert panel was assembled in waves of three (fleet cap — three simultaneous workers). Six
domain auditors dissected the mandate's ten pillars: competitors, orchestrator supervision,
headless mode, autonomy, lab, web version, delivery and PRD, reports, plus a blind spot found by
the orchestrator itself — five project skills as a product. Then three red teams tried to refute
the conclusions. Then synthesis, dashboard, backlog, and two fixers.

The most valuable thing is not the findings themselves but that the check worked. **Thirteen
CRITICAL labels across three independent calibrations — not a single one held.** The auditor
panel proved reliable on facts and systematically overstated consequences. Synthesis, faced with
calibration, withdrew four of its own conclusions and raised the system score from 35 to 45
percent.

What emerged in substance. The mechanical orchestrator watchdog existed only as code: in the
system it had never been installed, and if enabled with default settings would have raised a
second orchestrator next to the live one. The owner's concern that headless mode does not work on
subscription was not confirmed — it works. The Claude Code platform already covers part of the
supervision problem out of the box, but its daemon is not installed as a service, so an external
tick is still needed — but our homegrown one can be shrunk many times over. The system had never
worked through a night: the autonomous work record is 6 hours 47 minutes, and even that in the
evening. And most unpleasant: there is no permissions block in the configuration at all, the
orchestrator runs with all checks fully off, and no one consciously chose this.

## 3. What's next

Eight epics in priority order are already in Jira. Five of them rest on the owner's decisions and
wait for an answer — the questions are written down in the project queue. Two epics are not
blocked: web-version quality (GSL-177, in progress) and evening hygiene (GSL-175, next). Work on
them can start right now.

The plan's first epic is deliberately cheap — about an hour of work: four point-edits of the
instruction plus a rule that will not let them go stale again. But it hits the "who edits skills
now" question, because the authoritative copy sits outside git and outside review.

## 4. Shift problems and lessons

- The framing "the owner doubts prior claims" systematically biases auditors toward the negative.
  It was confirmed three times. From now on this framing must be balanced with a red team
  immediately, not after.
- Synthesis in the first pass decided that two calibrations did not exist and calibrated 47
  findings itself. Sending it back for rework fixed this. Checking that an agent actually read
  what it references is a mandatory step.
- Claims in service files go stale faster than it seems: the explanation to the evidence base
  became false within forty minutes of being written, when the third red team finished.
- Audit materials were originally written into an ignored folder and would not have survived the
  shift. The evidence base must sit next to the report, not in a service directory.

## 5. Comments

The owner gave one directive this shift: the mobile version and push notifications are put on
pause, the priority is professional work on the web version with all functions and all services.
This is reflected in the rules, in the backlog (mobile items were not filed) and in the execution
priority.

# ── Part 2 · Formal ──

## Hard rules (carry forward, do not weaken)

Full set — the Standing rules section in `docs/handoff/ORCHESTRATION-STATE.md`. Key items:
Opus 5 for the orchestrator and all workers · NO Workflow tool · fleet cap 3, panel is built in
waves · REGULAR merge, never squash · `closes` before each number · no force-push, no
`git add -A`, no `--amend` after push · tree-wide git operations forbidden in shared trees ·
sovereign untouched (`docs/prompts/`, `docs/lab/decisions/manifest.md`,
`docs/handoff/ORCHESTRATION-STATE.md`) · temporary files only in the project tree, not in the
system temporary directory · section-sign character not used · `install.sh` under guard, do not
remove · kill-pane only by explicit id after a re-list · mobile and push on pause (owner
2026-07-24) · pulse order: heartbeat → wakeup early → probes → final text to owner.

## Connections

Jira **GSL**, cloudId `74054cdc-47ef-497d-9684-734149876a8b`, transitions To Do=11 / In Progress=21 /
In Review=31 / Done=41 · GitHub `ainstance-labs/gosleep` · owner Roman L, accountId
`557058:83b04839-8bde-4331-9c2d-24843d0b8e67` · main @ **250b207** · skills GLOBAL
(`~/.claude/skills/`): orchestrating-delivery-agents, tmux-agents-orchestration, handoff,
delivery-workflow, using-jira.

## Gates (main base)

```
bash tools/lab/smoke.sh            # 404/404, FAIL=0 (flake on line 234 — pre-existing)
bash tools/lab/hooks-verify.sh     # 14/14
(cd tools/lab/ui && npx tsc --noEmit)   # 0
bash tools/lab/chronicler.sh --no-poll  # 7 pages
```
Gotcha: `chronicler.py` runs `main()` on import. Smoke is more reliable in a clone or worktree.

## Delivered this shift

- **Audit dashboard:** `docs/reports/system-audit-2026-07-24/index.html` + `ru/index.html`
  (22 files, 99 findings with filters, 11 pillars, 5 root causes, 8 epics, 5 inline diagrams,
  a 32-term glossary, 461 internal anchors resolving, zero network requests).
- **Evidence base:** `docs/reports/system-audit-2026-07-24/evidence/` — 13 files
  (6 domain findings, 3 red team verdicts, synthesis, payload, PRD delta, README).
- **Backlog:** epics GSL-174…181, tasks GSL-182…242, 69 GitHub mirrors, all assigned to the owner.
- **Question queue:** 8 records `q-2026-07-24-001…008`, `open=8 (2B/6D/0C/0F)`.
- **Merged PRs:** #173 (GSL-169 — owner mandate and evidence base in git), #248 (GSL-243 —
  report publish, base catch-up, ignore file, site rebuild).
- **Lab site** rebuilt: was "dead" / 1345 events → became "fresh" / 2116 events.

## Open questions to the owner (awaiting answer)

| id | type | task | about |
|---|---|---|---|
| q-2026-07-24-002 | BLOCKER | GSL-174 | Who and how edits skills now |
| q-2026-07-24-003 | BLOCKER | GSL-180 | Agent permissions: leave off, list explicitly, or relay via Channels |
| q-2026-07-24-001 | DECISION | GSL-178 | Arm the watchdog or not, and in which mode |
| q-2026-07-24-004 | DECISION | GSL-179 | What number to set as the token ceiling |
| q-2026-07-24-005 | DECISION | GSL-176 | External tick carrier: launchd or Claude Desktop tasks |
| q-2026-07-24-006 | DECISION | GSL-177 | Do we roll out a second version of the web interface |
| q-2026-07-24-007 | DECISION | GSL-176 | When to run the first real overnight run |
| q-2026-07-24-008 | DECISION | GSL-177 | Does the web dashboard count as a "report to the owner" per the manifest |

Default auto-apply deadline for the decisions is 2026-07-25 08:00Z. **Auto-apply does not exist**
(this is finding one of the first epic): defaults are applied manually by the orchestrator on the
pulse via `tools/lab/lab-emit.sh list --due`.

## Additionally for owner decision (outside the queue)

The skill `tmux-agents-orchestration` exists as a single copy in `~/.claude/skills/`, was never
committed, and there is no backup. The owner's rule from July 20 forbids copying global skills into
the repository without his command, so no copy was made. Confirmed three ways.

## Epic GSL-177 delivered (first epic of the plan, owner's priority)

Web version: freshness, coherence and quality of the first version. 8 tasks (GSL-205…210 plus
executor-filed GSL-248 for rebuild and GSL-249 for dev history), PR #251 merged with a regular merge.

Gates before → after: smoke **404/404 → 452/452**, FAIL=0 (48 new assertions, including failure
controls); hooks check 14/14; types 0; chronicler 7 pages. Live check in an isolated browser:
key indicators pulled from 2117 to 812 pixels, the "waiting for you" block — from 2228 to 923;
14 interactive elements work; the home-path leak on the timeline is fully removed; zero console
errors and zero external requests on all seven screens. Acceptance run:
`docs/reports/verifications/GSL-210/runs/01/` (EN + RU).

The web's second version has not started — that is question `q-2026-07-24-006`, waiting on the owner.

## Repository state at handoff

`main` @ **dc4bcdd** — the shift-73 ledger commit (state file with cycle 104-118 telemetry, this
handoff, question queue, lab events). Working tree clean, no open PRs, fleet empty.

## TELEMETRY

Cumulative: cycles_completed=141, tokens_out≈18 900 000 (plus historical gaps — details in the
state file's TELEMETRY block). Shift 73: 13 workers, ≈2.27M tokens_out, all on Opus 5, model of
each verified from the transcript.

## RESUME POINT — next orchestrator

1. Load the 5 global skills → `ORCHESTRATION-STATE.md` (At a glance, LIVE-STATUS, Standing
   rules) → this handoff.
2. Sanity: `tmux list-panes -t 11` (should be own pane only) · `git log origin/main -1`
   (expected dc4bcdd or newer) · `gh pr list --state open` (empty) ·
   `tools/lab/lab-emit.sh list --count` (expected `open=8 (2B/6D/0C/0F)`) · `head -12 install.sh`
   (guard in place).
3. First heartbeat: cycle 139+, own `$TMUX_PANE`, honest context_pct.
4. **First thing check the question queue** — `tools/lab/lab-emit.sh list` and `list --due`. If
   the owner answered, act on the answer and unblock the corresponding epic. If default deadlines
   are past (after 2026-07-25 08:00Z), apply the defaults manually and log a decision — there is
   no auto-apply mechanism in the system, that is finding one of the first epic.
5. Work available without owner answers: **GSL-175** (evening hygiene: archive, spend, Library
   depth). Build the executor brief per the epic GSL-177 template: reads the epic and tasks in
   Jira, reads the relevant findings in `docs/reports/system-audit-2026-07-24/evidence/` with
   priority on red team verdicts, executes task after task with gates and dev history, does not
   merge the PR.
6. Pulse order: heartbeat → ScheduleWakeup early (middle of the turn) → checklist probes → final
   text to the owner. Answer owner questions first thing.
