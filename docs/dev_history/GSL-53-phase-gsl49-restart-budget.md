# GSL-53 — Restart budget + exponential backoff + escalation

**Epic:** GSL-49 — Watchdog над оркестратором (PRD Phase 1)
**Branch:** GSL-49-orchestrator-watchdog
**Phase:** GSL-49 — PRD Phase 1, requirement R1.3 (restart budget + эскалация)

---

## Part 1 — Story

### What was done
The GSL-52 watchdog could restart the orchestrator; now it knows when to STOP. Every kill/re-wake
path is routed through a single gate (`do_restart`) that consults a persistent, file-backed restart
history: at most N restarts per sliding window (default 3-in-60-min, owner-configurable, e.g.
3/night). Under budget → exponential backoff before the spawn (min(cap, base·2^n), base 1s cap 16s —
warren's `RestartBudget` numbers) and the restart is recorded. Budget exhausted → no kill, no
restart: the watchdog escalates to the owner — an `escalation` ledger event, a local macOS
notification (osascript), and an optional `WD_ESCALATE_HOOK` executable as the Phase-6 push/ntfy
extension point — then leaves the fleet alone. "Never mask an orchestrator bug with a restart loop"
(warren `supervisor/main.ts:12-14`).

### Problems solved
- **Escalation spam:** a down orchestrator would otherwise notify on every 3-min tick. An
  `escalated` marker suppresses repeats for `WD_ESCALATE_REPEAT_SECS` (default 1h); a healthy tick
  (or a deliberate quiesce) clears the marker so the *next* incident escalates fresh.
- **Kill-then-can't-restart hole:** the budget check runs BEFORE the kill, not between kill and
  re-wake — an exhausted budget never leaves the orchestrator killed-but-not-restarted.
- **Stale budget state:** history is pruned to the window on every read (atomic temp+rename), so
  yesterday's restarts never block tonight's recovery — smoke-verified with 2h-old entries.

### Problems remaining
Debounce rails (grace/zombie/cooldown/mass-death/lock hardening) are GSL-54; reap-before-kill is
GSL-55. Escalation is local-only by design here — the phone push lands in Phase 6 via the hook.

### Pitfalls & workarounds
- `--dry-run` intentionally mutates the watchdog's OWN state (markers, history, dry_run-flagged
  ledger lines) while suppressing external actions — that's what makes multi-tick sequences
  smoke-testable. Documented in watchdog.conf.example: for live diagnosis, point `WD_STATE_DIR`
  at a scratch copy so a manual dry-run can't consume the real budget.
- Backoff exponent is computed by doubling in a loop capped at `WD_BACKOFF_CAP_SECS` — no `2**n`
  overflow risk from a corrupt history file.
- `WD_ESCALATE_HOOK` is validated at startup (must be executable) — a typo'd hook path fails
  loudly at arm time (exit 78), not silently at 3am escalation time.

### What didn't make it
No per-night vs per-hour dual budgets — one window knob; the owner tunes it (PRD explicitly allows
«для ночного окна владелец может задать 3/ночь»). No AI triage before escalating (02 §9-C —
optional later, fail-safe).

---

## Part 2 — Technical reference

**Files changed:**
- `tools/watchdog/watchdog.sh` — v0.2.0: `restarts_in_window` (prune+count, atomic),
  `record_restart`, `backoff_secs`, `escalate` (ledger + osascript + hook, marker-suppressed),
  `do_restart` gate replacing all direct `act_kill`/`act_rewake` call sites; new knobs
  `WD_RESTART_BUDGET/WD_RESTART_WINDOW_SECS/WD_BACKOFF_BASE_SECS/WD_BACKOFF_CAP_SECS/
  WD_ESCALATE_REPEAT_SECS/WD_ESCALATE_HOOK` (validated, incl. hook executability); healthy/quiesced
  ticks clear the `escalated` marker. New decisions: `escalated`, `kill_refused`.
- `tools/watchdog/watchdog.conf.example` — budget/backoff/escalation section + dry-run state note.
- `tools/watchdog/smoke.sh` — 5 new scenarios + 5 side-effect asserts (see below).

**State (all in `WD_STATE_DIR`, survives watchdog restarts):** `restarts.history` (one epoch/line,
window-pruned on read) · `escalated.marker` (epoch of last escalation).

**Verified by running** `bash tools/watchdog/smoke.sh` → 30/30 PASS, incl.:
- 3 recent restarts + dead session → `DECISION=escalated`, `escalation` ledger event, NO
  `orchestrator_restarted`, marker set (= F1-S4 / SC-B).
- 2 recent restarts + dead session → re-wake with `backoff 4s` (n=2 → 1·2²), history 2→3.
- 3 restarts 2h old → window-pruned → re-wake allowed.
- Fresh marker + still dead → escalation suppressed (0 duplicate ledger events).
- Healthy tick → marker cleared.

**PRD acceptance (R1.3):** counter in window, configurable — done; exponential backoff base 1s cap
16s — done; исчерпан → прекратить рестарты + эскалировать (запись + локальный notify + интерфейс к
Ф6-пушу) — done (ledger + osascript + hook); счётчик персистентен — file-backed, survives watchdog
restart (launchd tick = new process each time, state on disk by construction).

**Links:** Jira [GSL-53](https://ainstance-labs.atlassian.net/browse/GSL-53) ·
GitHub [#61](https://github.com/ainstance-labs/gosleep/issues/61) · Epic
[GSL-49](https://ainstance-labs.atlassian.net/browse/GSL-49) / [#57](https://github.com/ainstance-labs/gosleep/issues/57)
