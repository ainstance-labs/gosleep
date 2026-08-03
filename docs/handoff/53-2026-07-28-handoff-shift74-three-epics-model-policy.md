# Handoff — gosleep — 2026-07-28 (shift 74: three epics merged; model policy hit inheritance)

> For a NEW orchestrator (or continuation of this session after the owner's decision). Read Part 1 → Part 2 → RESUME.
> Supersedes handoff 49 (shift 73's baton) and worker handoffs 50/51/52 (epic details — there). Ground truth = ORCHESTRATION-STATE.md.

# ── Part 1 · Plain words ──

## 1. Where we are

Shift 74 closed three epics of the audit plan in one day: lab hygiene (GSL-175), the token ceiling
(GSL-179), and the external safety-tick engine (GSL-176). All three merged into main with regular
merges (PR #252, #253, #254), mirrors closed, Jira → Done, ledger chain a114c8a → 746e98c →
e72d818. The check suite grew from 452 to 545 with zero failures, and a single gate `gate.sh`
appeared, which by default checks against the tracker (previously the check was off "by default
of prose").

Work stalled at a single spot: the owner ordered the next workers to run on Opus, but the
teammate pane INHERITS the orchestrator's model — the model:opus parameter is ignored (confirmed
by THREE transcripts in a day). This orchestrator session runs on Fable 5, so the owner's order is
mechanically executable only by restarting the orchestrator on Opus. impl-178 was killed a minute
after spawn, before starting work, exactly by this procedure.

## 2. What was done this shift

Six overdue defaults were applied in the morning (d-001…006) — there was no auto-apply mechanism
then; there IS ONE now: `lab-emit.sh apply-due` (built in GSL-200). The owner gave three directives
during the day: configurable token ceiling with an "unlimited" mode (executed in GSL-179),
"handoff, not baton", and "next workers on Opus" (d-011 — hit inheritance). Plus the format
question was closed: every orchestrator turn MUST end with text to the owner — three silent turns
in a row nearly buried trust; the root is the ScheduleWakeup response pretending to be the end
of the turn.

Epic details — in handoff 50 (GSL-175), 51 (GSL-179), 52 (GSL-176). Key new gear:
tick.sh (idempotent tick without an LLM), apply-due, the rebuild debounce hook (live), gate.sh,
the supervision archive docs/lab/supervision/, preflight of both tick carriers READY FOR THE
OWNER'S HANDS (evening = tools/lab/preflight-arm.sh, morning = tools/lab/tick-preflight-report.sh;
launchctl — owner only).

## 3. What's next

One unblocked epic — GSL-178 (watchdog in observe mode, kill/re-wake off, aliveness source
`claude agents --json`). The brief is ready and checked (see RESUME). Everything else hits the
owner: BLOCKER q-002 (who edits skills → GSL-174), BLOCKER q-003 (agent permissions → GSL-180),
date of the control night (d-005), decision on restarting the orchestrator on Opus.

## 4. Problems

- **Model inheritance** (main): teammate spawn ignores model:opus, the worker gets the
  orchestrator's model. Three transcripts confirm: ce2de7ba (impl-175), 2ec7dfa9 (impl-176), e700cbdb
  (impl-178, killed early). Executing the owner's order = restart the orchestrator on Opus.
- ScheduleWakeup trap: its tool result talks you into ending the turn without the final text.
  Pulse order: heartbeat → wakeup EARLY → probes → TEXT LAST. The defect is recorded in the
  skill too (worked example puts wakeup last) — the skill cannot be edited without an answer to q-002.
- Shift incident-lesson: a test lab-emit without GOSLEEP_LAB_DIR leaked into the live queue (closed honestly).

## 5. Comments

The morning digest for 07-28 exists — two old smoke failures about it went away on their own. The
owner is active in chat all day and replies quickly; bring questions to him directly in the
final text of the turn.

# ── Part 2 · Formal ──

## Hard rules
Full set — Standing rules in ORCHESTRATION-STATE.md. Key new items this shift:
token limits configurable + unlimited mode (12:20Z: next workers on Opus, d-011) ·
standard gate = `bash tools/lab/gate.sh` (GSL-203; --no-poll only explicit offline) ·
do not silently commit a bundle grade != fresh (GSL-194) · "handoff", not "baton".

## Connections
Jira GSL, cloudId 74054cdc-47ef-497d-9684-734149876a8b, transitions 11/21/31/41 · GitHub
ainstance-labs/gosleep · owner Roman L, accountId 557058:83b04839-8bde-4331-9c2d-24843d0b8e67 ·
main @ e72d818 · global skills (~/.claude/skills/): orchestrating-delivery-agents,
tmux-agents-orchestration, handoff, delivery-workflow, using-jira.

## Gates (main base @ e72d818)
`bash tools/lab/gate.sh` — everything at once: smoke 545/545 FAIL=0 · hooks-verify 19 · tsc 0 · chronicler
WITH polling (feed docs/lab/scratch/jira-poll.json, dump on the cycle boundary per
docs/handoff/GSL-223-orchestrator-cycle-boundary-jira-dump.md). Receipt .artifacts/lab/gates/gate.json.

## Question queue (at handoff time)
open=3: q-2026-07-24-002 BLOCKER (skills), q-2026-07-24-003 BLOCKER (permissions),
q-2026-07-28-004 DECISION (supervision archive; due 12:41:59Z — apply apply-due, the default is
already implemented in code by GSL-225). Shift decisions: d-001…011 in docs/lab/decisions/log.jsonl.

## TELEMETRY (cumulative)
cycles_completed=147, total≈19 229 000 tokens_out (+ historical gaps — see TELEMETRY in STATE).
Shift 74: 7 workers (6 finished, impl-178 killed early), all effectively on Fable 5.

## RESUME POINT
1. Cold start per the skill: 5 global skills → ORCHESTRATION-STATE.md (At a glance, LIVE-STATUS,
   Standing rules) → this handoff. Sanity: tmux list-panes (one own pane) · git log origin/main -1
   (e72d818 or newer) · gh pr list --state open (empty) · tools/lab/lab-emit.sh list --count ·
   bash tools/lab/lab-emit.sh apply-due (overdue defaults — now one command).
2. First heartbeat: cycle 149+, own $TMUX_PANE, honest context_pct.
3. If this session HAS BEEN RESTARTED on Opus by the owner's decision: spawn impl-178 for epic
   GSL-178 — build the brief per the STATE log template (shift 74 section; essence: observe mode
   per d-001, kill/re-wake off, launchctl on the owner, gate gate.sh, PR unmerged, MANDATORY early
   model verification from the transcript). After COMPLETE — a finalizer per the finalizer-176
   template (regular merge, mirrors, Jira Done, cycle boundary GSL-223, ledger).
4. If the owner allowed continuing on Fable 5 — same thing without a restart.
5. Pulse order is HARD: heartbeat FIRST → ScheduleWakeup SECOND (its response is a trap) →
   probes → final TEXT to owner LAST act of every turn. The Stop-hook enforces this.
6. For the owner's hands (remind): night-time preflight of the tick carriers (evening preflight-arm.sh /
   morning tick-preflight-report.sh, date on the owner), answers to q-002/q-003.

## Gotchas
- model:opus at teammate spawn is ignored — model ONLY from the transcript (grep '"model"' over
  ~/.claude/projects/-Users-romanlidovskyi-Documents-dev-harness-gosleep/*.jsonl, find the file by
  the brief phrase, not by mtime).
- chronicler.py runs main() on import; inside tick.sh --no-poll is legal (composition).
- An empty idle-notification from a live worker = mandatory capture-pane; after kill-pane — noise.
- Tests with lab-emit — only under GOSLEEP_LAB_DIR (a leak into the live queue = incident).
- Worker handoffs are NOT committed by workers — the finalizer/orchestrator ledger commit takes them.

## Blocked on the human
1. Restart the orchestrator on Opus (execute d-011) — or explicit permission to continue on Fable 5.
2. q-2026-07-24-002: who and how edits skills (blocks GSL-174 and the fix of the ScheduleWakeup trap in the skill).
3. q-2026-07-24-003: agent permissions (blocks GSL-180).
4. Date of the control night + the night preflight of the carriers (all ready, only your evening hands needed).
