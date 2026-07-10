# Handoff — gosleep — 2026-07-10 (GSL-58 complete: анатомия AutoSK «по молекулам» смержена)

> For a FRESH orchestrator or the owner returning. Read Part 1 first, then "Immediate next steps". Ground truth = `docs/handoff/ORCHESTRATION-STATE.md` (read FIRST) + Jira GSL + репозиторий. Supersedes the earlier 2026-07-10 handoff (GSL-49 watchdog).

# ── Part 1 · Plain words ──

## 1. Where we are now
Эпик **GSL-58 «AutoSK Anatomy v2» ПОЛНОСТЬЮ ЗАВЕРШЁН**: PR #74 смержен в `main @ a217393`, все issues закрыты, Jira Done, ветка удалена, флот пуст. Требование владельца «разобрать autosk по косточкам, по молекулам, только по коду» выполнено: ревью построчно сверило 14 цитат отчёта с реальным кодом клонов — фабрикаций нет. Запуски чужого кода не производились (запрет владельца соблюдён).

## 2. What's already done (и где смотреть)
Отчёт-дашборд: **`docs/reports/autosk-anatomy/index.html`** (EN, 135КБ) + **`RU/index.html`** (полный русский, 175КБ): помодульная анатомия pi-стека, 3 sequence-SVG (task lifecycle, pi RPC, claude stream-json), словарь протоколов (31 команда + 20 событий), конфиг-поверхность, 24 режима отказов, TUI-паттерны, разбор 6 PR, adopt-лист из 23 пунктов. Сырьё: `docs/research/2026-07-10-autosk-anatomy/` (4 файла, всё с file:line).

## 3. Главные открытия
1. **pi (earendil-works/pi) — второй subscription-native харнесс** (OAuth PKCE поверх Claude Pro/Max); его RPC богаче `claude -p` stream-json: fork сессий, курсорные get_entries, host bash.
2. **У pi есть first-party экспериментальный `packages/orchestrator`** (спавнит и супервизит N `pi --mode rpc` детей) — прямой prior art для GoSleep. В бэклоге как кандидат на отдельный глубокий разбор.
3. **agent_settled vs agent_end**: истинный сигнал завершения в pi — `agent_settled` (auto-retry/compaction продолжают «завершённый» run), а autosk-драйвер сидит на `agent_end` — латентная гонка. Урок для нас: проверять истинные сигналы завершения.
4. **autosk FROZEN**: 12+ дней без коммитов, bus-factor 1, все 6 внешних PR осиротели после переписывания v1→v2. Стратегия подтверждена: берём идеи, не зависим.
5. **TUI**: gocui/lazygit-стек, 10 паттернов «красть» (push-redraw+CAS, owner-anchored composer, fail-open markdown...) / 1 «не повторять» для будущей админки.
6. **Из PR**: JSONL error matrix, правило приоритета cancel-vs-result, content-hash ревизии workflow-определений.

## 4. Problems we have
Ничего блокирующего. Minor из ревью: off-by-one ссылка на строки go.mod в 03-tui.md (суть верна) — в бэклог. Леджер (STATE + этот handoff) uncommitted — задачей 1 следующего эпика.

## 5. Comments & recent decisions
Правила в силе: Fable 5 содержательное / Opus 4.8 чистая механика; NO Workflow; max 3 панели; PULSE ~270s; kill-pane только по id; на границах эпиков продолжаем автономно; каждый спавн объясняем владельцу. За сегодня закрыты ДВА эпика: GSL-49 watchdog (PR #66) и GSL-58 анатомия (PR #74).

# ── Part 2 · Formal / precise ──

## ⚠️ Hard rules (carry verbatim)
NO Workflow tool. Агенты = tmux-pane teammates. Max 3 воркер-панели (spawn cap машины). PULSE ~270s при живом флоте. kill-pane только по явному id. Оркестратор не исполняет delivery. Reviews+merges автоматом. Fable 5 содержательное / Opus 4.8 механика. Артефакты в дереве. Epic+Task; 1 branch/Epic; 1 commit/Task; 1 PR/Epic; REGULAR merge; идемпотентность; no force-push; dev_history на задачу. API-error→один continue-надж; session-limit→resume.

## Connections
| Thing | Value |
|---|---|
| Jira | GSL, cloudId 74054cdc-47ef-497d-9684-734149876a8b; To Do=11/In Progress=21/In Review=31/Done=41 |
| GitHub | ainstance-labs/gosleep; **main @ a217393** (merge PR #74); 0 open PRs |
| Next free | Jira GSL-65; GH #75 |
| Owner | Roman L, rommxx@gmail.com, accountId 557058:83b04839-8bde-4331-9c2d-24843d0b8e67 |

## Артефакты GSL-58 (в main)
Коммиты: b38b768 (GSL-59 ledger) / ba2177d (GSL-60 pi-agent) / 1763dde (GSL-61 TUI) / a293a94 (GSL-62 PRs) / 4b4d3ab (GSL-63 site) / 19274b5 (GSL-64 отчёт). PR #74 merged @ a217393. Клоны для сверки: `.research-cache/autosk@fd4c22e`, `.research-cache/pi@34582ef` (gitignored).

## Immediate next steps (⭐ RESUME POINT)
1. **Эпик Phase 2 PRD «Self-pulse + night mode»** (setup спавнится сразу после этого handoff): задача 1 = housekeeping-коммит леджера (STATE + этот handoff); далее задачи из `docs/prd/PRD-gosleep-evolution.md` секции Phase 2. Контекст для impl: SKILL.md секции PULSE/heartbeat + findings `docs/research/2026-07-07-orchestration/04-loop-engineering.md` (self-pacing, cache-окна, activeHours/night mode).
2. После — Phase 3 PRD (question buffer + decision manifest).
3. Бэклог: разбор pi/packages/orchestrator (кандидат эпика — prior art!); watchdog F1-S1 live-check (за владельцем); gsl49 M3+8 minors; gsl58 off-by-one; SC-19/N-header/SC-11; ветки GSL-7/19; prompts-файл владельца (коммитить?).

## Gotchas
Спавн-кап 3; kill-pane по id; checkout при грязном леджере → `git fetch origin main:main` + checkout (не стэшить); эвал-раннер (Workflow) не запускать без владельца; tmux-сессии 0/2/3/4 — чужие; CODE-ONLY для чужого кода.

## Blocked on the human
Ничего. Опционально: включить watchdog (docs/runbooks/watchdog.md), судьба prompts-файла, приоритет разбора pi/orchestrator.
