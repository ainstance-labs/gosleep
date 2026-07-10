# GSL-54 — Gastown-debounce: startup grace + zombie(3) + kill cooldown + mass-death + single-flight

**Epic:** GSL-49 — Watchdog над оркестратором (PRD Phase 1)
**Branch:** GSL-49-orchestrator-watchdog
**Phase:** GSL-49 — PRD Phase 1, requirement R1.4 (Gastown-уроки, обязательные)

---

## Part 1 — Story

### What was done
The watchdog got the production war wounds Gastown paid for (04 §7.1): every decision is now
counter-debounced, cooldown-limited, and warm-up-exempt, and the watchdog itself is single-flight
and rate-limited. Concretely: (a) **startup grace** — a session younger than ~120s (from the
watchdog's own `last-started` marker OR tmux `session_created` for manual starts) is exempt from
staleness judgment, so a fresh orchestrator that hasn't written its first heartbeat is never killed
(Gastown #567); (b) **zombie debounce** — "pane exists but no agent process under it" becomes a
zombie only after 3 CONSECUTIVE cycles, and only in combination with a stale heartbeat — never a
single source; any tick where the process reappears resets the counter; (c) **kill cooldown** —
≥5 min between force-kills; a kill inside the cooldown is deferred, not queued; (d) **mass-death
detection** — the whole tmux session gone while the last heartbeat recorded ≥2 workers is treated
as a systemic failure (tmux server death / reboot / sleep): escalate to the owner, do NOT
blind-restart; (e) **single-flight hardening** — stale locks from crashed ticks are stolen after a
threshold, live locks are respected, and a self rate-limit refuses to tick more often than once
per minute. «One-shot "STATE stale → restart" сработает на ложняке в первую же ночь» — this commit
is the reason it won't.

### Problems solved
- **"Не судить по одному источнику":** the zombie path requires BOTH a stale heartbeat AND a
  3-cycle process-scan failure before killing; a fresh heartbeat clears the zombie counter (durable
  state stays the primary truth per C7). A wedged-but-running process still gets the gentler
  nudge→kill path instead.
- **Process detection through the pane shell:** claude sits generations below `pane_pid`; the probe
  walks ≤6 generations via `pgrep -P` (comma-list) and greps `ps -o command=` against
  `WD_AGENT_PROC_REGEX` (default `claude`).
- **Existing smoke fixtures vs mass-death:** dead-session scenarios that previously meant
  "just restart" carried `open_workers:2` — with mass-death they'd (correctly!) escalate. Fixtures
  split into `HB_SOLO` (1 worker → plain re-wake) vs `HB_OK` (2 workers → the new mass-death case).

### Problems remaining
Route-through-reap before kill + the ledger format doc are GSL-55 (final task). Mass-death
currently keys off the last heartbeat's `open_workers` + whole-session death; per-worker
`worker_died` ledger records join in GSL-55.

### Pitfalls & workarounds
- A comment glued to a closing quote (`"${VAR:=60}"# comment (…)`) is NOT a comment in bash — the
  `(` in it is a syntax error at parse time. Caught immediately by the smoke `bash -n` gate.
- Lock stealing uses the lock dir's mtime and only fires past `WD_LOCK_STALE_SECS` (default 900s ≫
  any real tick) — a live tick's lock is never stolen; contention after a steal exits quietly.
- Kill cooldown is checked AFTER the restart budget in `do_restart`: an exhausted budget escalates
  immediately rather than being masked for a cooldown period.

### What didn't make it
No per-rig worker patrols or specialized maintenance dogs (Gastown's quota/doctor/compactor) — the
watchdog supervises the orchestrator only; workers are the orchestrator's job (skill E17 watchdog).
No `flock(1)` — macOS doesn't ship it; mkdir-lock + stale-steal is the portable equivalent.

---

## Part 2 — Technical reference

**Files changed:**
- `tools/watchdog/watchdog.sh` — v0.3.0: `in_startup_grace` (last-started marker ∪ tmux
  `session_created`), `probe_agent_process_alive` (pane_pid → ≤6-generation pgrep walk → regex),
  `counter_*` helpers (`zombie.count`), mass-death branch before blind re-wake (ledger `mass_death`
  + escalation), kill-cooldown gate in `do_restart` (`last-kill` marker), hardened `acquire_lock`
  (stale-steal ≥ `WD_LOCK_STALE_SECS`, self rate-limit `WD_MIN_TICK_INTERVAL_SECS` via `last-tick`
  marker). New knobs (all validated, loud-fail): `WD_STARTUP_GRACE_SECS=120, WD_ZOMBIE_CYCLES=3,
  WD_KILL_COOLDOWN_SECS=300, WD_MASS_DEATH_WORKERS=2, WD_MIN_TICK_INTERVAL_SECS=60,
  WD_LOCK_STALE_SECS=900, WD_AGENT_PROC_REGEX=claude`. New decisions: `ok_grace`, `zombie_watch`,
  `kill_deferred`, `mass_death`. New test injections: `WD_TEST_SESSION_CREATED`, `WD_TEST_PROC_ALIVE`.
- `tools/watchdog/watchdog.conf.example` — R1.4 section.
- `tools/watchdog/smoke.sh` — `CASE_ENV` per-case env injection; 8 new scenarios + 8 asserts;
  fixtures split HB_OK/HB_SOLO.

**Verified by running** `bash tools/watchdog/smoke.sh` → 46/46 PASS, incl.:
- missing heartbeat + session 30s old → `ok_grace` (both grace sources); 500s old → `nudged` (F1-S2).
- process-dead cycle 1 → `zombie_watch` (counter=1, no kill); seeded counter=2 + cycle 3 →
  `kill_rewake` `zombie_confirmed_3_cycles` (F1-S3); process back → counter reset, normal nudge.
- kill 60s after previous kill → `kill_deferred`, no `kill` ledger event.
- dead session + `open_workers:2` → `mass_death`: ledger + escalation, NO restart.
- 2nd tick <60s → `rate-limited`; held fresh lock → single-flight exit; 30-min-old lock → stolen.

**PRD acceptance (R1.4):** (a) grace ✓ (b) zombie 3 циклов ✓ (c) cooldown ≥5 мин ✓ (d) mass-death →
эскалация ✓ (e) single-flight + rate-limited ✓; каждый порог конфиг-оверрайдабелен ✓; невалидный
конфиг падает громко (exit 78) ✓. F1-S2, F1-S3 smoke-verified.

**Links:** Jira [GSL-54](https://ainstance-labs.atlassian.net/browse/GSL-54) ·
GitHub [#62](https://github.com/ainstance-labs/gosleep/issues/62) · Epic
[GSL-49](https://ainstance-labs.atlassian.net/browse/GSL-49) / [#57](https://github.com/ainstance-labs/gosleep/issues/57)
