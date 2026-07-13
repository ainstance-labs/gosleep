# Handoff — gosleep — 2026-07-12 (для fresh-оркестратора; GSL-72 полностью готов и верифицирован, остался ТОЛЬКО merge)

> ДЛЯ СВЕЖЕГО ОРКЕСТРАТОРА. Читай: Part 1 → «⚠️ ЖЕЛЕЗНЫЕ ПРАВИЛА» → «⭐ RESUME». Ground truth = ORCHESTRATION-STATE.md (первым) + этот файл. Supersedes handoff 20 (2026-07-10).

# ── Part 1 · Простыми словами ──

## 1. Где мы
Эпик **GSL-72 «Question buffer + decision manifest»** (PRD Phase 3) готов на 100%: 8 задач + фиксы по ревью запушены (HEAD **d86ba0f**), **PR #92 OPEN / CLEAN**, Jira-эпик In Review, задачи Done, smoke **37/37**. Всё это перепроверено ДВУМЯ независимыми read-only агентами (verify-skill 5/5 PASS, verify-delivery 6/6 PASS). Осталось одно действие: **merge и закрытие хвостов** — потом Phase 4.

## 2. Что случилось в прошлых двух сессиях (важно понять)
Два оркестратора подряд «молчали в чате»: заканчивали turn'ы tool call'ом (обычно ScheduleWakeup), а текст, написанный до/между tool calls, владельцу не показывается. Владелец дважды был на грани остановки проекта. Исправление: (а) из скилла orchestrating-delivery-agents вырезан сам паттерн «turn кончается tool call'ом» и строка-ловушка; (б) в проект поставлен Stop-hook, который механически блокирует конец turn'а без финального текста. Подробности — Урок №1 ниже.

## 3. Отношения с владельцем — прочитай обязательно
Доверие подорвано. Владелец требует: отвечать на КАЖДОЕ его сообщение; объяснять каждый спавн/стоп воркера; никакой самодеятельности сверх приказа (исполнять буквально; сомнения — спрашивать); стандартную терминологию (tool call, tool result, turn — никаких самодельных переводов); при сомнении в твоих словах — он вправе требовать независимых агентов-проверщиков (паттерн verify-*, себя оправдал). Не спорь, показывай команды и их вывод.

# ── Part 2 · Формально ──

## ⚠️ ЖЕЛЕЗНЫЕ ПРАВИЛА (нарушение первого = немедленная остановка проекта)
1. **КАЖДЫЙ turn заканчивается ТЕКСТОМ владельцу — после ВСЕХ tool calls, ноль tool calls после текста.** Любой tool result (в т.ч. ответ ScheduleWakeup, что бы он ни говорил) — НЕ разрешение закончить turn. Знание правила НЕ спасает — двух предшественников оно не спасло; спасает привычка: последний акт = текст. Stop-hook (`.claude/settings.json` → `tools/hooks/stop-require-final-text.sh`) подстрахует блокировкой, но правило соблюдай сам. ScheduleWakeup (если пользуешься пульсом) взводится В СЕРЕДИНЕ turn'а.
2. **Модели: ВСЕ агенты — Opus 4.8** (`model: opus`); оркестратор — Fable 5. Модель воркера сверяй по его транскрипту (`grep '"model"' ~/.claude/projects/-Users-romanlidovskyi-Documents-dev-harness-gosleep/<новейший>.jsonl`) — self-report врёт (fixer назвался fable-5, был opus-4-8).
3. NO Workflow tool; max 3 воркер-панели (4-я падает: fork failed); kill-pane только по явному id; no force-push; REGULAR merge (никогда squash); идемпотентность; телеметрия в STATE после каждого цикла; оркестратор не исполняет delivery сам; воркеры НЕ трогают леджер-файлы.
4. tmux: наше окно 1:0; сессии 0/2/3/4 — ЧУЖИЕ проекты (tasty-lunch, agentic-flow-admin, v8-inspect), их панели не трогать.

## ⭐ RESUME POINT (по порядку)
1. Подними скиллы: orchestrating-delivery-agents (уже вычищен от ловушки), handoff, delivery-workflow, using-jira. Прочитай ORCHESTRATION-STATE.md + этот файл. Сверь реальность: `tmux list-panes -t 1:0` (должна быть только твоя панель), `git log --oneline -1` (**d86ba0f** на `GSL-72-question-buffer`, sync с origin), `gh pr view 92 --json state,mergeStateStatus` (OPEN/CLEAN). Первым же turn'ом напиши владельцу текст — он проверит видимость.
2. **Merge-финализатор** (воркер, Opus 4.8, чистая механика): `gh pr merge 92 --merge` (REGULAR) → закрыть issues **#84..#91** вручную (`Closes` авто-закроет только #83; проверить все девять) → Jira эпик GSL-72 → Done (transition **41**, cloudId ниже) → удалить ТОЛЬКО remote-ветку (`git push origin --delete GSL-72-question-buffer`) → локальный main FF: `git fetch origin main:main`. **Локальную ветку и checkout НЕ трогать** — в дереве незакоммиченный леджер. Отчёт ≤12 строк + model= (по транскрипту) + телеметрия.
3. **Phase 4 «Laboratory»** по PRD (`docs/prd/PRD-gosleep-evolution.md`): setup-воркер (Opus) создаёт эпик GSL-81+ (GH #93+), ветку от свежего origin/main. **Первая задача эпика = леджер-коммит**, в который входят: ORCHESTRATION-STATE.md, handoffs 19/20/21, docs/reports/bugs/, `.gitignore` (правка), `skill/orchestrating-delivery-agents/SKILL.md` (чистка ловушки), `.claude/settings.json` + `tools/hooks/stop-require-final-text.sh` (Stop-hook едет в репо). `docs/prompts/2-*.md` НЕ коммитить (решение владельца не принято). Дальше конвейер: impl → механик PR → ревьюер → (фиксер) → финализатор. Потом Phase 5 UI, Phase 6 Mobile.

## Connections
Jira GSL cloudId `74054cdc-47ef-497d-9684-734149876a8b` (To Do=11 / In Progress=21 / In Review=31 / Done=41); GH `ainstance-labs/gosleep`; PR #92; origin/main @ 135ce1f (до merge); next Jira=GSL-81, GH=#93; owner Roman L (rommxx@gmail.com) accountId `557058:83b04839-8bde-4331-9c2d-24843d0b8e67`. Обе копии скилла (skill/ и ~/.claude/skills/) идентичны, sync = `./install.sh` (только local→global).

## Что лежит незакоммиченным в дереве (штатно, уходит леджер-коммитом Phase 4)
`M .gitignore` · `M docs/handoff/ORCHESTRATION-STATE.md` · `M skill/orchestrating-delivery-agents/SKILL.md` · `?? .claude/` (settings.json; scheduled_tasks.lock уже в gitignore) · `?? docs/handoff/19,20,21-*.md` · `?? docs/reports/bugs/` (багрепорт инцидента) · `?? tools/hooks/` · `?? docs/prompts/2-*.md` (НЕ коммитить).

## Бэклог
lab-emit: m1 (мёртвые zC/wF в --count), m5 (answer/resolve без проверки статуса, нужен --force); m6 (08:30–09:00 вне режимов) и m7 (якоря denylist §3) → предлагать как manifest candidates (манифест owner-sovereign, агенты НЕ правят); разбор pi/packages/orchestrator (кандидат эпика); watchdog F1-S1 live-check (за владельцем, runbook §8); e2e «ночь с развилкой»; gsl49 M3+8 minors; gsl58 off-by-one; SC-19 polish; локальные ветки GSL-7/GSL-19.

## Телеметрия прогона (кумулятив — продолжать, не обнулять)
≈72 цикла, total≈**5.43M** токенов approx (полный блок в STATE; гэпы 2a/32/35 помечены).

## Blocked on human
Нет. Очередь вопросов `tools/lab/lab-emit.sh list` → open=0.
