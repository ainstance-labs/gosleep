# GSL-69 — Quota auto-wait: детекция session-limit + quiesce/resume + ETA

**Epic:** GSL-65 — Self-pulse + night mode (PRD Phase 2)
**Branch:** GSL-65-self-pulse-night
**Phase:** GSL-65 — PRD Phase 2, requirement R2.3 (quota-window auto-wait)

---

## Part 1 — Story

### What was done
Formalized the proven 2026-07-07→08 experience ("session limit hit → fleet waited → resumed at
reset") as a SKILL.md section **"Quota auto-wait — session-limit quiesce & resume"**:

- **Multi-signal detection** (ralph #183: a timeout misread as a rate limit parks a healthy
  fleet): own turn error naming the limit / worker StopFailure report / fleet-wide simultaneous
  silence after heavy usage (suspect quota before N separate bugs, confirm first) — and an
  explicit split: transient `overloaded`/`server_error` = retry with backoff, NOT a quiesce.
- **Quiesce protocol:** determine reset ETA (message → window+5h → top-of-next-hour fallback);
  hold the fleet (kill nothing, spawn nothing — held panes resume in-flight state for free);
  STATE LIVE-STATUS `status=quota-wait until=<ETA>` + log line; heartbeat `status:"quiesced"` +
  `note:"quota-wait until <ISO ETA>"` + `open_workers` = REAL held count; arm a ≤3600s
  ScheduleWakeup chain to the ETA and STAY in the session.
- **Resume protocol:** the first tick that runs = the window opened. Heartbeat `ok` (one write
  re-enters watchdog supervision) → STATE `QUOTA-WAIT exited` → fleet re-census (a pane may have
  died during the wait; reconcile per cold-start) → un-hold workers → normal cadence.
- **Heartbeat protocol extended:** `"quiesced"` now has two documented forms — chain done
  (`open_workers` MUST be 0, unchanged) and quota-wait (`note` MUST carry the ETA,
  `open_workers` = held count). Mechanically identical for the v0.5.0 watchdog: quiesced is
  checked FIRST in `decide_and_act`, before staleness/identity — no code change needed.
- **Residual risk documented:** an orchestrator pane dying DURING quota-wait stays down until the
  owner — the правильный trade (re-wakes during the limit would fail serially and drain the
  restart budget exactly when it's needed). The ETA in `note` tells the owner why all is quiet.

Watchdog side: header contract comment extended (comment-only); **smoke.sh got the quota-wait
lock-in**: fixture `HB_QUOTA_WAIT` (quiesced, `open_workers:2`, note ETA) + case
`quota-wait-stale-live` (STALE heartbeat + LIVE session → `ok_quiesced`) + a ledger assert (no
nudge/kill/restart events). That stale+live combination is exactly what a limited orchestrator
looks like — and exactly what previously would have earned a nudge→kill.

### Problems solved
- **«Run умирает/паркуется молча»** (01 §8-2: 5-hour window parks the whole fleet) → теперь это
  режим с ETA на диске, автопродолжением и стендауном watchdog'а.
- **Watchdog vs limited orchestrator:** без quota-wait формы стухший heartbeat при живой сессии =
  nudge → kill → re-wake, который сам бьётся о лимит → выжигание restart budget. Проверено
  smoke-кейсом, что quiesced-гейт держит.
- **Соблазн «выйти и передать watchdog'у»** прямо запрещён red flag'ом: армированная цепочка
  wake-up'ов — ЕДИНСТВЕННЫЙ путь резюма при подавленном watchdog'е.

### Problems remaining
Детекция прописана prompt-level; механический `StopFailure`-hook, питающий quota-события — Phase 4
(R4.1 явно маркирует `StopFailure(rate_limit|...)` → quota как «питает Ф2»). ETA-парсер из текста
лимита не автоматизирован (модель читает сообщение). PRD F2-S3 smoke «искусственный rate_limit»
покрыт на уровне watchdog-контракта (quiesced-форма), не end-to-end прогоном ночи.

### Pitfalls & workarounds
- `ScheduleWakeup` клампится к [60, 3600] — ETA дальше часа = цепочка хопов; тики, падающие об
  лимит, просто не исполняются, цепочку тянет следующий хоп; первый ИСПОЛНИВШИЙСЯ тик = свидетельство
  открытия окна (проба не нужна).
- `open_workers` в quota-wait НЕ обнуляется — иначе mass-death/worker_died логика watchdog'а при
  реальной смерти сессии во время ожидания отчиталась бы «0 воркеров потеряно».

### What didn't make it
Никаких изменений исполняемой логики watchdog.sh (не нужны — v0.5.0 контракт уже корректен);
никакой автоматики quota-телеметрии в $ (Ф4/Ф5 показывают).

---

## Part 2 — Technical reference

**Files changed:**
- `skill/orchestrating-delivery-agents/SKILL.md` — new section "Quota auto-wait — session-limit
  quiesce & resume" (detection ×4, quiesce ×5 steps, resume ×4 steps, residual risk); Heartbeat
  protocol: quiesced two-forms definition; Quick reference: session-limit row; Red flags: 2 new
  (handoff-and-exit; kill-and-respawn).
- `tools/watchdog/watchdog.sh` — header contract comment: quiesced two forms (comment-only;
  version/logic untouched).
- `tools/watchdog/smoke.sh` — `HB_QUOTA_WAIT` fixture, `quota-wait-stale-live` case
  (`ok_quiesced`), no-nudge/kill/restart ledger assert.

**Sources:** PRD Phase 2 R2.3/F2-S3; 04 §3.6 (ralph unattended auto-wait, #183 three-layer
detection); production experience 2026-07-07→08.

**Verified by running** `./install.sh` + `diff -rq` global → identical;
`bash tools/watchdog/smoke.sh` → **67/67 PASS** (was 65; +2 quota-wait).
