# Handoff — gosleep — 2026-07-10 (GSL-65 mid-flight: roll-point оркестратора на 66% контекста)

> For a FRESH orchestrator (после суммаризации/переката). Read Part 1, then «Immediate next steps». Ground truth = `docs/handoff/ORCHESTRATION-STATE.md` (FIRST) + этот файл. Supersedes прежний handoff 16 в части resume-point.

# ── Part 1 · Plain words ──

## 1. Where we are now
Идёт эпик **GSL-65 «Self-pulse + night mode» (PRD Phase 2)**. ВСЯ реализация готова: 6/6 задач закоммичены ЛОКАЛЬНО на ветке `GSL-65-self-pulse-night` (HEAD `7e9b37c`, origin отстаёт — запушен только `270e519`). Флот ПУСТ (impl-pulse терминирован подтверждённо). Остались механические шаги: push+PR → ревью → merge → закрытие. Сегодня уже смержены эпики GSL-49 (watchdog, PR #66) и GSL-58 (анатомия autosk, PR #74).

## 2. Готовые коммиты GSL-65 (локально)
GSL-66 270e519 (ledger) · GSL-67 f35a2b2 (каденция пульса + armed-wake-up) · GSL-68 b510de8 (night mode/QUESTIONS-PENDING) · GSL-69 d1fbb42 (quota auto-wait, smoke +2) · GSL-70 79f76bb (circuit-breaker) · GSL-71 7e9b37c (HEARTBEAT_OK fast-path + docs). Гейты пройдены: install.sh clean, smoke 67/67, watchdog v0.5.0 контракт цел. Jira GSL-66..71 все Done; эпик GSL-65 = GH #75, задачи = GH #76..#81.

## 3. Immediate next steps (⭐ RESUME POINT — выполнять по порядку)
1. **Спавнь механика** (Opus, имя gsl65-mechanic, механика): подними скилл using-jira; `git push origin GSL-65-self-pulse-night`; `gh pr create` title `GSL-65 Self-pulse + night mode — PRD Phase 2`, body: `Implements GSL-65.` + чеклист `- [x] GSL-66..71 (#76..#81)` + `Mirrors GH #75.` + `Closes #75, #76, #77, #78, #79, #80, #81.` + CC-footer; Jira эпик → In Review (31); отчёт ≤10 строк + телеметрия; self-quiesce.
2. **Ревьюер** (Fable, gsl65-reviewer): линзы: целостность новых секций SKILL.md (каденция vs cache-экономика; armed-wake-up vs roll-гейты; night mode vs denylist — critical будит; quota-wait vs watchdog quiesced v0.5.0; breaker vs loop-guard без дубля); прогнать `tools/watchdog/smoke.sh` сам (наш код) — зелёный 67/67; install.sh identical; dev_history 6 + индекс; PR body. Отчёт → docs/reviews/REVIEW-gsl65.md (gitignored) + ≤12 строк вердикт MERGE/FIX + телеметрия.
3. FIX critical → фиксер (Fable) → снова финализатор; **MERGE → финализатор** (Opus, gsl65-finalizer): CLEAN → `gh pr merge --merge` (REGULAR) → закрыть остатки issues #75..#81 → Jira эпик Done (41) → `git checkout main && git pull --ff-only` (леджер НЕ стэшить; блок → `git fetch origin main:main`+checkout) → ветку удалить лок+origin → отчёт + телеметрия.
4. **Финал эпика:** телеметрия финализатора в STATE → shutdown → подтверди → STATE (EPIC GSL-65 COMPLETE, next Jira=GSL-72, GH=#82) → handoff 18 (эпик-complete, по образцу handoff 15/16) → ДОКЛАД владельцу (Phase 2 смержена: каденция/night/quota-wait/breaker/fast-path = ядро «владелец спит» вместе с watchdog).
5. **БЕЗ ОСТАНОВКИ → Phase 3 PRD** (question buffer + decision manifest): setup Opus (PRD секция Phase 3 → эпик+задачи+задача-1 housekeeping-леджер (STATE+handoff 18) + GH-зеркало + ветка + коммит + push) → impl Fable → механик PR → ревью → merge → доклад → Phase 4 Laboratory. Конвейер и брифы — по образцу GSL-65 (см. лог STATE).

## 4. Процессные правила (verbatim, В СИЛЕ)
Fable 5 содержательное / Opus 4.8 чистая механика; NO Workflow; max 3 воркер-панели (spawn cap); PULSE ~270s при живом флоте + armed-wake-up КАЖДЫЙ ход; kill-pane ТОЛЬКО по явному id; оркестратор не исполняет delivery; reviews+merges автоматом; на границах эпиков продолжать автономно; каждый спавн/стоп объяснять владельцу с «почему»; телеметрия в STATE после каждого цикла; API-error → один continue-надж; session-limit → quiesce+resume; CODE-ONLY для чужого кода; эвал-раннер не запускать; docs/prompts/2-*.md не коммитить; tmux-сессии 0/2/3/4 чужие.

## 5. Connections + бэклог
Jira GSL cloudId 74054cdc-47ef-497d-9684-734149876a8b (To Do=11/In Progress=21/In Review=31/Done=41); GH ainstance-labs/gosleep; owner Roman L accountId 557058:83b04839-8bde-4331-9c2d-24843d0b8e67. Бэклог: разбор pi/packages/orchestrator (prior art, кандидат эпика); watchdog F1-S1 live-check (за владельцем); e2e ночной прогон с инъекцией rate_limit (F2-S3 эксплуатационная); gsl49 M3+8 minors; gsl58 off-by-one; SC-19/N-header/SC-11; локальные ветки GSL-7/19. Телеметрия прогона: ~61 цикл, ≈4.6M токенов (+2a гэп) — полный блок в STATE.
