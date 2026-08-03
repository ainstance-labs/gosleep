# Handoff — gosleep — 2026-08-02 (shift 74 result: four epics; orchestration handed to Opus 4.7)

> For a NEW orchestrator (expected on Opus 4.7). Read Part 1 → Part 2 → RESUME.
> Supersedes handoff 53 (interim) and 54 (worker impl-178). Ground truth = ORCHESTRATION-STATE.md.

# ── Part 1 · Plain words ──

## 1. Where we are

Shift 74 (28 July — 2 August, with a five-day subscription outage in the middle) closed FOUR epics
of the audit plan out of eight: lab hygiene (GSL-175), token ceiling (GSL-179), external tick
engine (GSL-176), and observing supervisor (GSL-178). All merged with regular merges — PR #252, #253,
#254, #255; a ledger chain of five commits, latest 8b23ffb. Smoke grew from 452 to 545 (plus a
separate watchdog smoke 75→168), the gate became a single command `gate.sh` and now checks against
the tracker by default. Watchdog is live: the observe run is under way, live lines are written into
the tracked archive.

There is no unblocked work left: everything hits owner decisions (who edits skills q-002;
agent permissions q-003; arming the watchdog after three days of the run; date of the control
night; scope of GSL-181 — verify).

## 2. Models — how it works now

The shift-74 orchestrator is Fable 5 (limits running out — hence the handoff). Workers get their
model from `CLAUDE_CODE_SUBAGENT_MODEL=claude-opus-4-7` in the owner's ~/.claude/settings.json —
verified by the finalizer-178 transcript (the first worker on the config). The Agent tool's model
parameter DOES NOT work on this surface (inheritance, proven three times); check a worker's model
ONLY from the transcript (self-report lies — finalizer-178 named itself "4.5", was 4-7).

## 3. What we fixed along the way (matters for the successor)

The "silent turn" illness: the ScheduleWakeup response ("Nothing more to do…"), if read last,
cuts the turn off before the final text to the owner. On owner command we amended the global skill
orchestrating-delivery-agents (Turn order: heartbeat → wakeup SECOND → probes → text; HARD
COROLLARY "ScheduleWakeup is never the last tool call"; worked example; Quick reference) and the
memory wakeup-first-text-last. The skill also received errata GSL-178 (heartbeat protocol: writer
tools/lab/heartbeat.sh, fields session/session_id/cli, breaker-check item, verifier-watch.sh).
Verified with greps. The Stop-hook is still in place and catches violations.

## 4. Problems and loose ends

- tools/lab/heartbeat.sh has no +x bit (run it as `bash tools/lab/heartbeat.sh …`) — fixed in
  the ledger part 6 of this shift.
- Panes %28 (impl-178-2) and %44 (finalizer-178) are live-idle by owner order "do not terminate";
  the new orchestrator does NOT inherit them as workers — they have finished; ask the owner about cleanup.
- Finalizer-178's tokens were not returned by the harness — TELEMETRY has an estimate by analogy,
  gap flagged.

## 5. Comments

The owner is active and replies quickly; today's skill edits went on his direct commands (precedent
q-002 logged in d-2026-08-02-004, the BLOCKER itself is open). apply-due is live in production. The
debounce hook is alive and keeps the bundle fresh on its own — on a race with the full gate there
is a transient smoke red, a single rerun is honest (lesson GSL-218).

# ── Part 2 · Formal ──

## Hard rules
Full set — Standing rules in ORCHESTRATION-STATE.md (read FIRST). Shift essentials: gate =
`bash tools/lab/gate.sh` (GSL-203); do not silently commit bundle grade!=fresh (GSL-194); token
limits configurable + unlimited (d-007); pulse heartbeat→wakeup SECOND→probes→TEXT last;
"handoff", not "baton"; workers Opus 4.7 by config; NO Workflow (ask-first); REGULAR merge; closes
before each number; sovereign untouched; mobile/push on pause.

## Connections
Jira GSL, cloudId 74054cdc-47ef-497d-9684-734149876a8b, transitions 11/21/31/41 · GitHub
ainstance-labs/gosleep · owner Roman L, accountId 557058:83b04839-8bde-4331-9c2d-24843d0b8e67 ·
main @ 8b23ffb (+ ledger part 6 on top) · global skills ~/.claude/skills/ (5 in total).

## Gates (main base)
`bash tools/lab/gate.sh` — smoke 545/545 FAIL=0 · hooks-verify 19 · tsc 0 · chronicler WITH polling
(feed docs/lab/scratch/jira-poll.json per checklist GSL-223). Watchdog smoke: `bash
tools/watchdog/smoke.sh` 168/0. Check the STATE breaker line: `bash tools/lab/breaker-check.sh`.

## Queue and decisions
open=2: q-2026-07-24-002 BLOCKER (who edits skills; precedent d-2026-08-02-004),
q-2026-07-24-003 BLOCKER (agent permissions). Shift decisions: d-2026-07-28-001…016 +
d-2026-08-02-001…005 in docs/lab/decisions/log.jsonl.

## TELEMETRY (cumulative)
cycles_completed=151, total≈19 462 000 tokens_out (+ historical gaps — see STATE). Shift 74:
10 workers (8 finished, 1 early kill per d-011, finalizer-178 first on Opus 4.7).

## RESUME POINT — new orchestrator (Opus 4.7)
1. Cold start per the skill: 5 global skills → ORCHESTRATION-STATE.md (At a glance, LIVE-STATUS,
   Standing rules, cli=/breaker= lines above TELEMETRY) → this handoff.
2. Sanity: tmux list-panes (own pane; %28/%44 — finished idle panes per owner order) ·
   git log origin/main -1 (8b23ffb or newer) · gh pr list --state open (empty) ·
   tools/lab/lab-emit.sh list --count (open=2 2B) · bash tools/lab/lab-emit.sh apply-due ·
   bash tools/lab/breaker-check.sh.
3. Pulse: `bash tools/lab/heartbeat.sh --cycle 153 --context-pct N --open-workers N --status ok`
   FIRST act of every turn; ScheduleWakeup SECOND; probes; TEXT to owner LAST.
4. There is NO work without the owner — ask the owner what's next: answers to q-002/q-003 unblock
   GSL-174/GSL-180; GSL-181 — verify scope in Jira; after ~3 days of the observe run — report
   per runbooks/watchdog.md section 0 and decide on arming; date of the control night is on the
   owner (all preflight is ready: evening preflight-arm.sh / morning tick-preflight-report.sh).
5. Epic merge chains — per the finalizer-176/178 pattern in the STATE log (regular merge → mirrors
   → Jira Done → cycle boundary GSL-223 → ledger).

## Gotchas
- Worker model — only from the transcript (grep '"model"' over ~/.claude/projects/.../\*.jsonl,
  find the file by the brief phrase). ScheduleWakeup response is a trap. An empty idle-notification
  from a live worker = mandatory capture-pane; after a kill — noise. Tests with lab-emit only under
  GOSLEEP_LAB_DIR. chronicler.py runs main() on import. Worker handoffs are committed by the ledger.
- Do not roll based on self-estimated context_pct (owner rule) — only on a real signal.

## Blocked on the human
1. q-2026-07-24-002 — who and how edits skills (GSL-174).
2. q-2026-07-24-003 — agent permissions (GSL-180).
3. Arming the watchdog: 3 days of run → runbooks/watchdog.md sections 0-1 (launchctl — owner's hands).
4. Date of the control night (d-005). 5. Fate of panes %28/%44. 6. Scope of GSL-181.
