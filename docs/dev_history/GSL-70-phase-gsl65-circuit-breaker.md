# GSL-70 — Circuit-breaker: same-error/output-decline + cooldown/HALF_OPEN + ручной сброс

**Epic:** GSL-65 — Self-pulse + night mode (PRD Phase 2)
**Branch:** GSL-65-self-pulse-night
**Phase:** GSL-65 — PRD Phase 2, requirement R2.4 (circuit-breaker поверх loop-guard)

---

## Part 1 — Story

### What was done
The existing loop guard (non-advancing `NEXT` ×2 / no-new-PR ×N → hard STOP+ask) is upgraded into
a full Nygard-style circuit breaker, new SKILL.md section **"Circuit breaker — staged
anti-runaway (extends the loop guard)"**, integrated WITH the loop guard rather than beside it
(the guard bullet in "Cost & runaway control" now feeds the breaker instead of hard-stopping):

- **States:** CLOSED → OPEN → HALF_OPEN → CLOSED/OPEN (ralph-claude-code `lib/circuit_breaker.sh`
  shape).
- **Trip signals table:** the 2 existing loop-guard signals + 2 ralph signals — same error
  signature ×3 consecutive cycles (signature = normalized first line of the failing error; a
  DIFFERENT error resets — new information ≠ spinning) and output/progress decline ×2 (cycle
  substance < ~30% of the chain's typical — ralph's >70% decline). Any one signal at threshold →
  OPEN.
- **On OPEN:** spawn nothing; live workers finish naturally (the breaker never kills productive
  work); breaker line written to STATE; escalation — OPEN is on the GSL-68 night-critical list, so
  it wakes the owner even at night; heartbeat gets `note:"breaker=OPEN"`; the pulse keeps running.
- **Cooldown 30 min → HALF_OPEN → EXACTLY ONE probe** (smallest unblocked task, fresh context):
  real advance → CLOSED + counters zeroed; re-trip → OPEN, cooldown ×2 (cap ~2h), NO further
  probes until the owner resets. Transient flakes no longer lock the chain forever (F2-S4), and
  repeated OPEN is explicitly an owner problem, not a retry problem.
- **Breaker line in STATE** (next to TELEMETRY, atomic update at every cycle boundary):
  `breaker=CLOSED since=<ts> next_probe=- counters: next_same=0/2 no_pr=0/3 err_same=0/3
  decline=0/2 last_error_sig=""` — human-resettable (autosk phone-editable pattern): the owner
  edits the line, the orchestrator obeys the file (C8) and never argues with a manual reset.
- **Restart does NOT reset the breaker:** a re-woken/replacement orchestrator inherits the line —
  ties into the re-wake anti-crash-loop rule instead of duplicating it. Adjacent-rails paragraph
  keeps breaker / watchdog-restart-budget / BUDGET_EXCEEDED cleanly separated.

### Problems solved
- **False permanent halts:** a transient flake previously tripped a hard STOP+ask that nobody
  answers at 3am. Now: cooldown + one probe recovers the chain autonomously.
- **Unwatched runaway shapes:** N cycles failing on the SAME error, or cycles shrinking to
  near-empty output, previously looked "busy" to the two-signal guard. Now counted and tripped.
- **Duplication risk avoided:** the loop guard was not replaced or restated — its bullet now
  routes into the breaker; `BUDGET_EXCEEDED` explicitly stays a ceiling (no cooldown, no probe).

### Problems remaining
Counting is orchestrator-discipline (prompt-level) until Phase-4 hooks can derive error signatures
and cycle-output metrics mechanically from events. "Chain's typical substance" for the decline
signal is a judgment definition — good enough for a 2-cycle debounce, not a precise metric.

### Pitfalls & workarounds
- Error-signature normalization (strip paths/timestamps) matters: raw first lines almost never
  match exactly, and the counter would never trip.
- OPEN must NOT stop the pulse: the cooldown clock, the wind-down supervision and the heartbeat
  all need live ticks — "stop spawning" ≠ "stop pulsing" (else the watchdog would judge the pane
  stale and restart it, masking the very bug the breaker caught).

### What didn't make it
No permission-denial signal (ralph's 4th trip condition) — our workers surface denylist as
`BLOCKED_ON_HUMAN`, which parks rather than spins, so the shape it guards can't occur here.
No mechanical enforcement of thresholds (Phase 4).

---

## Part 2 — Technical reference

**Files changed:**
- `skill/orchestrating-delivery-agents/SKILL.md` — "Cost & runaway control": ceiling≠breaker
  clarification + loop-guard bullet now feeds the breaker; new section "Circuit breaker — staged
  anti-runaway" (states, 4-signal trip table, OPEN protocol, cooldown/HALF_OPEN/single-probe,
  breaker line format + manual reset, adjacent rails); Quick reference: ceiling row split + breaker
  row; Red flags: loop-guard flag reworded + new OPEN-but-confident flag.

**Sources:** PRD Phase 2 R2.4/F2-S4; 04 §3.9 (ralph circuit breaker: 3 no-progress / 5 same-error /
>70% decline / 30-min cooldown / HALF_OPEN; autosk human-resettable counters), §6 item 6.

**Verified by running** `./install.sh` + `diff -rq` global → identical (skill-text-only task; smoke
untouched at 67/67 from GSL-69).
