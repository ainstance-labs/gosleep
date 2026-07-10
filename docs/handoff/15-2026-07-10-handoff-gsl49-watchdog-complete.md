# Handoff — gosleep — 2026-07-10 (GSL-49 watchdog complete: самонаблюдение построено и смержено)

> For a FRESH orchestrator or the owner returning. Read Part 1 first, then "Immediate next steps". Ground truth = `docs/handoff/ORCHESTRATION-STATE.md` (read FIRST) + Jira GSL + этот репозиторий. Supersedes the 2026-07-09 handoff (GSL-41 complete).

# ── Part 1 · Plain words ──

## 1. Where we are now
gosleep — репозиторий оркестрационного харнесса. Только что **полностью завершён эпик GSL-49 «Watchdog над оркестратором»** (Phase 1 PRD): PR #66 смержен в `main @ 878f438`, все задачи/issues закрыты, ветка удалена, флот пуст. GoSleep получил **контур самонаблюдения** — ответ на главную боль владельца «оркестратора некому перезапустить ночью».

## 2. What's already done (что построено, простыми словами)
- **Heartbeat:** оркестратор на каждом пульсе первым делом пишет строку-«пульс» на диск (`docs/handoff/.orchestrator-heartbeat`, JSONL с ts/cycle/context%/воркерами и **pane id**), атомарно, файл самоусекается до 200 строк.
- **Watchdog** (`tools/watchdog/watchdog.sh` v0.5.0): механический скрипт БЕЗ LLM, запускается launchd по расписанию;判 живость только по durable-состоянию; протухший heartbeat → nudge; смерть/зависание → **kill только панели, подтверждённой по pane id из heartbeat** (неуверенность → `kill_refused` + эскалация владельцу — НЕ убивает наугад); затем перезапуск свежего оркестратора **re-wake-брифом** (`references/re-wake-brief.md`, плейсхолдеры подставляются).
- **Страховки:** бюджет 3 рестарта/час (персистентный) + экспоненциальный backoff; startup grace 120s; зомби подтверждается 3 циклами; kill cooldown 300s; массовая гибель панелей = эскалация, не рестарты; перед любым kill — reap-снапшот в ledger; провал kill гейтит re-wake (не будет двух оркестраторов). Smoke-набор: 65 проверок, зелёный.
- **Runbook на русском** (`docs/runbooks/watchdog.md`, 8 разделов): установка/проверка/чтение ledger/эскалации/пауза/troubleshooting.
- **Ревью-этап себя оправдал:** пойман CRITICAL (позиционный резолв панели мог убить живого ВОРКЕРА вместо мёртвого оркестратора) — исправлен ДО merge.

## 3. What we're doing next
Следующий эпик — **«AutoSK Anatomy v2» (GSL-58)**: разбор autosk «по косточкам» ТОЛЬКО по коду (владелец запретил запуски): pi-agent internals, Go TUI, 6 незамерженных PR, re-fetch сайта, отчёт-дашборд `docs/reports/autosk-anatomy/` EN+RU. После него — Phase 2 PRD (self-pulse/night mode).

## 4. Problems we have
- **Watchdog НЕ включён** — установка plist только вручную владельцем (по runbook). F1-S1 (живая сработка с реальным kill) не тестировалась — первую сработку наблюдать.
- Follow-up из ревью: M3 (ledger-спам при затяжном mass-death) + 8 minor — в `docs/reviews/REVIEW-gsl49.md` (gitignored, локально).
- Леджер оркестратора (STATE + этот handoff) снова uncommitted — закоммитить задачей 1 эпика GSL-58.

## 5. Comments & recent decisions
- Owner: модели — Fable 5 на всё содержательное, Opus 4.8 на чистую механику; AutoSK-анатомия — CODE-ONLY (никаких запусков чужого кода); на границах эпиков НЕ останавливаться (автономное продолжение); каждый спавн/стоп объяснять; PULSE каждые ~4.5 мин при живом флоте.
- Уроки в силе: kill-pane только по явному id; spawn cap 3 панели; API-error → один continue-надж; session-limit переживаем.

# ── Part 2 · Formal / precise ──

## ⚠️ Hard rules (carry verbatim)
- NO Workflow tool. Агенты = tmux-pane teammates. Max 3 одновременных воркер-панели. PULSE ~270s при живом флоте (ScheduleWakeup в конце каждого хода). kill-pane ТОЛЬКО по явному id. Оркестратор не исполняет delivery. Reviews+merges автоматом. Fable 5 содержательное / Opus 4.8 чистая механика. AutoSK-анатомия: CODE-ONLY. Артефакты в дереве.
- Epic+Task; 1 branch/Epic; 1 commit/Task; 1 PR/Epic; REGULAR merge; идемпотентность; no force-push; dev_history на задачу.

## Connections
| Thing | Value |
|---|---|
| Jira | GSL, cloudId 74054cdc-47ef-497d-9684-734149876a8b; To Do=11/In Progress=21/In Review=31/Done=41 |
| GitHub | ainstance-labs/gosleep; **main @ 878f438** (merge PR #66); 0 open PRs |
| Next free | Jira GSL-58; GH #67 |
| Owner | Roman L, rommxx@gmail.com, accountId 557058:83b04839-8bde-4331-9c2d-24843d0b8e67 |

## Артефакты GSL-49 (в main)
- Коммиты: 036549a (GSL-50) / ef054ad (GSL-51) / f35d27e (GSL-56) / d719a68 (GSL-52) / 0013503 (GSL-53) / 322cf30 (GSL-54) / 48936de (GSL-55, амендирован) / 4f520e7 (GSL-57) / 0377298 (GSL-51 fix) / 7be1b5b (GSL-52 fix). PR #66 merged @ 878f438.
- Пути: `tools/watchdog/` (watchdog.sh v0.5.0, smoke.sh 65 checks, plist.template, install-watchdog.sh render-only, conf.example, LEDGER.md); `skill/orchestrating-delivery-agents/SKILL.md` (секции Heartbeat protocol + Re-wake); `references/re-wake-brief.md`; `docs/runbooks/watchdog.md`; dev_history GSL-50..57 + индекс.

## Телеметрия (сводно; полный блок в STATE)
Эпик GSL-49 = циклы 15-23 (setup Opus; impl-51/impl-56/impl-tooling×4/impl-57 Fable; механик/финализатор Opus; ревьюер+фиксер Fable). Весь прогон с 2026-07-07: ~53 цикла, ≈3.3M токенов (approx, + гэп 2a).

## Immediate next steps (⭐ RESUME POINT)
1. **Эпик GSL-58 «AutoSK Anatomy v2»** (setup спавнится сразу после этого handoff): задача 1 = housekeeping-коммит леджера (STATE + этот handoff); задачи 2-5 = research CODE-ONLY (pi-agent помодульно, Go TUI, 6 PRs, re-fetch сайта); задача 6 = отчёт `docs/reports/autosk-anatomy/index.html` + `RU/index.html`.
2. После — **Phase 2 PRD** (self-pulse/night mode) тем же конвейером setup→impl→PR→ревью→merge.
3. Владельцу (опционально): включить watchdog по `docs/runbooks/watchdog.md`; наблюдать первую сработку (F1-S1).

## Gotchas
- Спавн-кап 3 панели; kill-pane только по id; API-error → один надж; session-limit → resume; prompts-файл владельца (docs/prompts/2-*.md) не коммитим без его решения; эвал-раннер (Workflow) не запускать без явного разрешения.
- tmux-сессии 0/2/3/4 — чужие проекты; наше окно 1:0 (%36 — оркестратор).

## Blocked on the human
- Ничего блокирующего. Опционально: включение watchdog (runbook), решение по follow-up minors, judьба prompts-файла.
