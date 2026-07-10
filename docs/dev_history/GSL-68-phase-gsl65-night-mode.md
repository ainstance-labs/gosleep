# GSL-68 — Night mode / activeHours — режим и переключение поведения вопросов

**Epic:** GSL-65 — Self-pulse + night mode (PRD Phase 2)
**Branch:** GSL-65-self-pulse-night
**Phase:** GSL-65 — PRD Phase 2, requirement R2.2 (night mode / activeHours)

---

## Part 1 — Story

### What was done
New SKILL.md section **"Night mode — activeHours"**: the owner declares an attended window
(Standing-rules line in STATE, default night = 00:00–08:30; "я спать" forces night NOW); outside
it the chain runs `mode=night` — *interactivity loosened, rails tightened* (05 §4.1 inversion).
A day/night behavior table pins exactly what changes:

- **Questions:** AskUserQuestion FORBIDDEN except denylist. Non-denylist fork → `QUESTIONS-PENDING`
  in STATE (the existing re-wake mechanic, now entered by the clock), reversible default or
  park-per-item, worker rerouted. A night question is never a stalled pane.
- **Escalations:** buffered to STATE + surfaced at the morning boundary — except critical
  (denylist hit, mass-death, restart-budget exhaustion, breaker OPEN, BUDGET_EXCEEDED), which
  still escalate immediately.
- **Work selection:** autonomous reversible green delivery; at milestone boundaries continue into
  the next unblocked phase (owner mandate 2026-07-10). Night grants NO extra authority — denylist
  unchanged, zero exceptions.
- **Cadence:** long-waiting tier (1200–1800s) is the night default between boundaries.
- **Boundaries:** entering night → `MODE → night` STATE-log line + heartbeat `mode:"night"`;
  morning → `MODE → day`, surface the ENTIRE night buffer in one owner summary (Phase-3 digest
  when it exists), buffered items never silently dropped.
- **Heartbeat:** new optional `mode` field (`"night"` / omitted-or-`"day"`) — the mode is readable
  from disk (C7), never context-only. The watchdog's sed-based field extraction ignores unknown
  fields — non-breaking for v0.5.0.

`watchdog.conf.example` got a night-ops comment on `WD_HB_STALE_SECS`: the long-waiting tier
sleeps past the default 900s, so unattended nights need the threshold raised (e.g. 2100) — the
one owner-side knob that aligns watchdog and night cadence. Comment-only; contract untouched.

### Problems solved
- **"Ночь" была вайбом, не режимом.** Теперь это выводимое из часов + standing-переопределений
  состояние с точной таблицей поведения, записанное на диск (heartbeat `mode`, STATE log) — его
  видит владелец, watchdog-пост-мортем и replacement-оркестратор.
- **Переиспользование, не изобретение:** буферизация вопросов = существующий re-wake
  `QUESTIONS-PENDING` механизм; denylist = существующий; отличие ночи только в том, что вход — по
  расписанию, а не по рестарту. Phase-3 queue.jsonl просто заменит хранилище.
- **Морнинг-переход определён:** буфер обязан всплыть ОДНИМ summary; молчаливая потеря буфера
  прямо запрещена.

### Problems remaining
Буфер пока живёт в STATE (`QUESTIONS-PENDING`) без типологии/dedup — это Phase 3 (queue.jsonl,
manifest, digest). Критический канал эскалации ночью = watchdog escalate hook / локальный notify;
push на телефон — Phase 6. Механической проверки «AskUserQuestion не вызван ночью» нет —
prompt-level до Phase-4 hooks.

### Pitfalls & workarounds
- Watchdog не парсит `mode` — сознательно: ночная осведомлённость watchdog'а сводится к одному
  порогу (`WD_HB_STALE_SECS`), который поднимает владелец. Любая логика «watchdog читает режим и
  меняет поведение» раздула бы v0.5.0 контракт без нужды.
- Режим ВЫВОДИТСЯ на каждом пульсе (часы + standing rules), а не хранится флагом — replacement
  после компакции получает правильный режим бесплатно.

### What didn't make it
Авто-генерация morning digest (Phase 3/4); отдельный `activeHours`-парсер — окно объявляется
строкой в Standing rules, читается человеком и моделью, не скриптом (до Phase-3 манифеста).

---

## Part 2 — Technical reference

**Files changed:**
- `skill/orchestrating-delivery-agents/SKILL.md` — new section "Night mode — activeHours"
  (declaration + defaults, day/night behavior table, boundary protocols, buffer-surfacing rule);
  Heartbeat protocol: optional `mode` field; Quick reference: 2 rows (entering night / morning
  boundary); Red flags: 3am-question entry.
- `tools/watchdog/watchdog.conf.example` — `WD_HB_STALE_SECS` night-ops comment (raise above the
  long-waiting tier, e.g. 2100, for unattended operation). Comment-only.

**Sources:** PRD Phase 2 R2.2 (activeHours, буфер как флаг для Ф3); 04 §3.5-3.6 (OpenClaw
activeHours, morning-brief, HEARTBEAT_OK suppression); MEMORY «Continue at milestone boundaries».

**Verified by running** `./install.sh` + `diff -rq` global → identical;
`bash tools/watchdog/smoke.sh` → **65/65 PASS** (conf change is comment-only).
