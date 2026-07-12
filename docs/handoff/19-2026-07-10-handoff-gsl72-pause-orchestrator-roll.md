# Handoff — gosleep — 2026-07-10 (плановая остановка оркестратора; эпик GSL-72 сдан контентно, остался PR-хвост)

> ДЛЯ СВЕЖЕГО ОРКЕСТРАТОРА. Читай: Part 1 → «⭐ RESUME» → «Уроки». Ground truth = ORCHESTRATION-STATE.md (первым) + этот файл. Правила процесса verbatim — handoff 17 §4.

# ── Part 1 · Простыми словами ──

## 1. Что за прогон был
За 2026-07-07…10 автономный конвейер (setup Opus → impl Fable → механик PR Opus → ревьюер Fable → фиксер → merge-финализатор Opus) закрыл: исследовательский эпик GSL-41 (4 HTML-отчёта EN+RU + PRD 6 фаз), **GSL-49 watchdog** (PR #66), **GSL-58 анатомия autosk** (PR #74), **GSL-65 пульс+ночной режим** (PR #82). Ядро «владелец спит» готово и в main.

## 2. Где остановились
**Эпик GSL-72 «Question buffer + decision manifest» (PRD Phase 3): ВСЕ 8 задач закоммичены ЛОКАЛЬНО** на ветке `GSL-72-question-buffer` @ **15b8fa3** (запушено на origin только до 9440319!). Jira: задачи GSL-73..80 Done, эпик In Progress. Сделано: типология вопросов 4 типов (74=501a86f), очередь+lab-emit.sh (75=4b30bc9, smoke 28/28), манифест решений (76=e351b7b), журнал+learning loop (77=703ec66, --rule обязателен), утренний дайджест (78=3e9269c), PULSE-дельты (79=d3eb02c), сводный dev_history (80=15b8fa3). **Остался только доставочный хвост: push → PR → ревью → merge.** Флот пуст (impl-buffer терминирован после полного отчёта).

## 3. Почему пауза
Приказ владельца после сбоя видимости: оркестратор заканчивал ходы tool-вызовом, и владелец НЕ ВИДЕЛ сообщений в чате. Урок №1 ниже — обязателен к исполнению с первого хода.

# ── Part 2 · Формально ──

## ⚠️ УРОКИ СЕССИИ (нарушение = повторение провала)
1. **КАЖДЫЙ ход заканчивается финальным ТЕКСТОВЫМ сообщением владельцу** — ПОСЛЕ всех tool-вызовов (включая ScheduleWakeup). Промежуточный текст и ходы, оконченные тулом, владельцу НЕ показываются. Даже пустой пульс — 1-2 строки статуса в чат.
2. Пульс ~270s (armed-wake-up взводится ВНУТРИ хода, не последним действием). На ответах владельцу токены НЕ экономить; каждый спавн/стоп объяснять («почему этот воркер, почему эта модель»).
3. Fable 5 = содержательное; Opus 4.8 = чистая механика. NO Workflow. Max 3 воркер-панели (4-я падает: fork failed). kill-pane ТОЛЬКО по явному id (никогда -a). API-error mid-response → один continue-надж. Session-limit → нудж после резета (панель живёт). Стоп-приказы воркеру доходят с лагом (длинные ходы) — учитывать пересечения.
4. Оркестратор не исполняет delivery сам; телеметрия в STATE после каждого цикла; идемпотентность везде; no force-push; REGULAR merge; на границах эпиков продолжать автономно.

## ⭐ RESUME POINT (по порядку)
1. Подними скиллы: orchestrating-delivery-agents, handoff, delivery-workflow, using-jira. Прочитай ORCHESTRATION-STATE.md + этот файл. Сверь: `tmux list-panes -t 1:0` (должна быть только твоя панель), `git -C <repo> log --oneline -3` (HEAD 15b8fa3 на GSL-72-question-buffer).
2. **Механик PR** (Opus, механика): `git push origin GSL-72-question-buffer` → `gh pr create` title `GSL-72 Question buffer + decision manifest — PRD Phase 3`, body `Implements GSL-72.` + чеклист `- [x] GSL-73..80 (#84..#91)` + `Mirrors GH #83.` + `Closes #83, #84, #85, #86, #87, #88, #89, #90, #91.` + CC-footer → Jira эпик In Review (31).
3. **Ревьюер** (Fable): линзы — типология vs night mode/denylist (BLOCKER будит, denylist не ослаблен); lab-emit.sh атомарность/дедуп + smoke 28/28 прогнать; манифест: ярусы зеркалят denylist, provenance --rule; learning loop; digest-процедура; PULSE-дельты vs каденция; ПРОВЕРИТЬ коммит с оговоркой «Turn order (HARD, owner-visibility)» в секции armed-wake-up — УЖЕ ВШИТ оркестратором по прямому приказу владельца (после 15b8fa3); grep-обход старых секций на противоречия; install.sh diff; dev_history 8 + индекс; PR body. → REVIEW-gsl72.md + вердикт.
4. FIX critical → фиксер (Fable) → merge; MERGE → **финализатор** (Opus): merge REGULAR → закрыть issues #83..#91 → Jira эпик Done (41) → ветка следующего эпика от origin/main (checkout main заблокирует незакоммиченный леджер — известный паттерн) → GSL-72-ветку удалить лок+origin.
5. Handoff 20 + доклад владельцу → **Phase 4 «Laboratory»** (PRD: T1 hooks→docs/lab/events/*.jsonl нулевой стоимости; T3 chronicler = bounded claude -p регенератор static-HTML админки; конвейер тот же: setup Opus → impl Fable → …). Далее Phase 5 UI → Phase 6 Mobile.

## Connections
Jira GSL cloudId 74054cdc-47ef-497d-9684-734149876a8b (To Do=11/In Progress=21/In Review=31/Done=41); GH ainstance-labs/gosleep; origin/main @ 135ce1f; next Jira=GSL-81, GH=#92; owner Roman L accountId 557058:83b04839-8bde-4331-9c2d-24843d0b8e67. Леджер к коммиту задачей-1 следующего эпика: ORCHESTRATION-STATE.md + handoffs 19 (этот). docs/prompts/2-*.md НЕ коммитить (решение владельца не принято).

## Бэклог (полный)
Разбор pi/packages/orchestrator (first-party prior art, кандидат эпика); watchdog F1-S1 live-check (за владельцем, runbook §8); e2e «ночь с развилкой» (F3-S1/SC-E живой end-check); gsl49 M3+8 minors (REVIEW-gsl49.md); gsl58 off-by-one (03-tui.md:10); SC-19 polish/eval-runner N-header/SC-11; локальные ветки GSL-7/GSL-19; формулировка armed-wake-up в SKILL.md (п.3 RESUME). Телеметрия прогона: ~67 циклов, ≈5.2M токенов approx (полный блок в STATE; гэпы: 2a, 32, 35 помечены).
