# Handoff — gosleep — 2026-07-10 (GSL-65 complete: ядро «владелец спит» готово)

> For a FRESH orchestrator. Ground truth = ORCHESTRATION-STATE.md (FIRST) + этот файл. Правила процесса verbatim — handoff 17 §4 (актуальны). Supersedes 17 в части resume-point.

# ── Part 1 · Plain words ──

## 1. Where we are now
**Эпик GSL-65 «Self-pulse + night mode» (PRD Phase 2) СМЕРЖЕН**: PR #82 → `main @ 135ce1f`, issues #75..#81 закрыты, Jira Done, remote-ветка удалена. Вместе с watchdog (GSL-49) **ядро концепции «владелец спит» готово**: оркестратор пишет пульс и сам просыпается по правильной каденции, ночью копит вопросы, переживает лимиты, останавливается при зацикливании, а внешний watchdog перезапускает его при смерти.

## 2. Что добавила Phase 2 (по-компонентно)
- **Каденция пульса** по cache-окнам: ~270s активный мониторинг / 540s+ стабильное ожидание / 1200–1800s глубокое; зона [300,540) запрещена; закон armed-wake-up: три легитимных выхода из хода — armed / quiesced+0 / rolling (без wake-up).
- **Night mode/activeHours**: ночью вопросы → QUESTIONS-PENDING, эскалации в буфер (critical будит всегда), утром один summary; heartbeat несёт `mode`.
- **Quota auto-wait**: детекция лимита по 4 сигналам → quiesced+ETA; один wake-up до ETA+120s; подстраховка — watchdog v0.5.1-будильник (щит quiesced истекает через 900s после ETA); авто-резюм.
- **Circuit-breaker** поверх loop-guard: 4 сигнала зацикливания → OPEN (стоп спавнов + эскалация), HALF_OPEN одна проба после 30 мин, повторный OPEN — только ручной сброс из STATE.
- **HEARTBEAT_OK fast-path**: дешёвый пульс ≤3-4 tool-calls.
- Ревью поймало 2 MAJOR логических дыры (quota-цепочка, rolling-выход) — исправлены до merge (69a12b9); smoke 75/75.

## 3. Сегодня смержено три эпика
GSL-49 watchdog (PR #66 → 878f438) · GSL-58 анатомия autosk (PR #74 → a217393) · GSL-65 pulse/night (PR #82 → 135ce1f).

# ── Part 2 · Formal ──

## Connections
Jira GSL cloudId 74054cdc-47ef-497d-9684-734149876a8b (11/21/31/41); GH ainstance-labs/gosleep, **main @ 135ce1f**, 0 open PRs; next Jira=GSL-72, GH=#83; owner accountId 557058:83b04839-8bde-4331-9c2d-24843d0b8e67.

## SHA GSL-65
270e519 (66 ledger) / f35a2b2 (67) / b510de8 (68) / d1fbb42 (69) / 79f76bb (70) / 7e9b37c (71) / 69a12b9 (fix M1/M2) / merge 135ce1f. Пути: SKILL.md новые секции; tools/watchdog v0.5.1 (smoke 75); dev_history GSL-66..71.

## ⭐ Immediate next steps
1. **Известный хвост:** рабочее дерево ещё на локальной ветке `GSL-65-self-pulse-night` (checkout main блокировал незакоммиченный леджер). Setup следующего эпика: `git fetch origin && git checkout main`... если блокирует леджер — `git checkout -m main` НЕ использовать; путь: закоммитить леджер ПРЯМО на новой ветке эпика, созданной от origin/main (`git checkout -b <EPIC>-question-buffer origin/main` перенесёт uncommitted), потом `git branch -d GSL-65-self-pulse-night`.
2. **Setup Phase 3 PRD «Question buffer + decision manifest»** (Opus, механика): PRD constraints C1-C8 + секция Phase 3 → Jira эпик + задачи (+задача-1 [Process] леджер: STATE + handoffs 17, 18) + GH-зеркало + ветка от origin/main + housekeeping-коммит + push. Брифы конвейера — по образцу GSL-65 (лог STATE).
3. impl Fable → механик PR → ревьюер Fable → merge-финализатор Opus → handoff 19 → доклад → Phase 4 Laboratory.

## Бэклог
pi/packages/orchestrator разбор (prior art!); watchdog F1-S1 live-check (владелец); e2e ночной прогон с rate_limit-инъекцией; gsl49 M3+8 minors; gsl58 off-by-one; SC-19/N-header/SC-11; локальные ветки GSL-7/19 (+GSL-65 после ухода с неё); prompts-файл владельца. Телеметрия: ~65 циклов, ≈4.7M+ (полный блок в STATE; циклы 32/35 gap).
