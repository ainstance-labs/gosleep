# GSL-71 — HEARTBEAT_OK fast-path + сводка фазы GSL-65 (PRD Phase 2)

**Epic:** GSL-65 — Self-pulse + night mode (PRD Phase 2)
**Branch:** GSL-65-self-pulse-night
**Phase:** GSL-65 — PRD Phase 2, задача 5 (`[Docs] dev_history + пример пульс-тика`)

---

## Part 1 — Story

### What was done
The cheap-tick promise of the cadence table got its mechanism: SKILL.md subsection
**"HEARTBEAT_OK fast-path — the minimal tick"** inside the Pulse cadence section. A 5-item STABLE
checklist (OpenClaw heartbeat shape): (1) heartbeat written — always first; (2) inbox empty;
(3) fleet census unchanged (one `tmux list-panes`); (4) ONE git/mtime progress probe vs the stored
SHA — no movement is still green while clocks are unexpired (idle ≠ stuck); (5) no expired clocks
(patience, breaker `next_probe`, quota ETA, mode boundary). All green → HEARTBEAT_OK: nothing
written, nothing further read, re-arm per the cadence table, end turn — ≤3–4 cheap tool calls.
Any check non-green → leave the fast-path and triage ONLY that delta through its own tree. Plus a
worked night-tick example (concrete heartbeat line → probes → `ScheduleWakeup 1500s`) and the
Quick-reference pulse row extended with the checklist.

### Сводка фазы GSL-65 (Phase 2 целиком)

| Task | Commit | Что дало |
|---|---|---|
| GSL-67 | f35a2b2 | Каденция по cache-окнам (~270s / ~540s / 1200–1800s; 300–540s dead zone banned) + HARD armed-wake-up правило + watchdog-alignment + анти-паттерны |
| GSL-68 | b510de8 | Night mode / activeHours: день/ночь-таблица, QUESTIONS-PENDING буферизация, границы (MODE-строки, утренний surfacing), heartbeat `mode` |
| GSL-69 | d1fbb42 | Quota auto-wait: 4-сигнальная детекция, quiesce+ETA (вторая форма `quiesced`), wake-цепочка ≤3600s, авто-resume; smoke 65→67 |
| GSL-70 | 79f76bb | Circuit-breaker CLOSED/OPEN/HALF_OPEN поверх loop-guard: 4 сигнала, cooldown+одна проба, breaker-строка в STATE, ручной сброс |
| GSL-71 | (этот) | HEARTBEAT_OK fast-path + пример тика + сводка фазы |

**Критерии фазы:** F2-S1 (armed-wake-up при open_workers>0 — HARD-правило + Quick-ref + Red flag)
✓; F2-S2 (интервалы по cache-окнам, нет 300s — таблица каденции) ✓; F2-S3 (quota auto-wait c ETA и
авто-resume — протокол + smoke-контракт watchdog'а) ✓ (end-to-end ночной прогон — эксплуатационная
проверка, не в этом эпике); F2-S4 (breaker: стоп + cooldown + HALF_OPEN, не вечный стоп) ✓.
Ограничения C1–C8 не нарушены: ничего не ушло с interactive-поверхности, watchdog остался 0-LLM,
v0.5.0 контракт не тронут (только комментарии + новые smoke-кейсы), STATE/handoff — авторитет.

### Problems solved
- Пульс перестал быть «правилом из памяти»: каденция, минимальный тик, ночной режим, quota-wait и
  breaker — всё в скилле, всё читается с диска (heartbeat/STATE), всё наследуется replacement-
  оркестратором.
- Fast-path решает OpenClaw-burnout: здоровый флот ночью стоит 3–4 tool-call'а за тик вместо
  полного triage-хода.

### Problems remaining
Prompt-level enforcement везде (armed-wake-up, детекция квоты, счётчики breaker'а) — механизация
через hooks = Phase 4. Question buffer живёт в QUESTIONS-PENDING до Phase 3 (queue.jsonl +
manifest + digest). End-check фазы (прогон «ночь» с инъекцией rate_limit) — на живой системе.

### Pitfalls & workarounds
Fast-path — exit ramp, не право игнорировать увиденную дельту: формулировка в скилле прямо
запрещает «skip a delta you already saw». Пример тика намеренно ночной — показывает сразу mode,
long-waiting delay и все clock-проверки в одной картинке.

### What didn't make it
Пример «плохого» тика (анти-пример) — анти-паттерны каденции уже покрывают; sleep-time
consolidation (04 §6 item 8, idle-gap chores) — не в scope Phase 2, кандидат в backlog.

---

## Part 2 — Technical reference

**Files changed:**
- `skill/orchestrating-delivery-agents/SKILL.md` — subsection "HEARTBEAT_OK fast-path — the
  minimal tick" (5-item checklist, all-green/any-non-green rules, worked example); Quick-reference
  pulse row extended.

**Sources:** PRD Phase 2 задача 5 + R2.1 («HEARTBEAT_OK → ничего»); 04 §3.5 (OpenClaw tiny stable
checklist, cheap-exit path).

**Verified by running** `./install.sh` + `diff -rq` global → identical;
`bash tools/watchdog/smoke.sh` → 67/67 PASS (regression sanity; tools untouched in this task).
