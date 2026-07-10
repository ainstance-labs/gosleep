# Handoff — gosleep — 2026-07-07 (GSL-41 research: PAUSE по лимитам, середина фазы)

> For a FRESH orchestrator or the owner returning. Read Part 1 first, then "Immediate next steps". Ground truth = `docs/handoff/ORCHESTRATION-STATE.md` (read FIRST) + this file. Supersedes the 2026-07-01 handoff (hardening arc complete).

# ── Part 1 · Plain words ──

## 1. Where we are now
gosleep — репозиторий оркестрационного харнесса (5 delivery-скиллов). Идёт эпик **GSL-41: глубокое исследование внешних оркестраторов** (AutoSK, Warren, Overstory, экосистема) с выходом в 4 HTML-отчёта (EN+RU) + PRD. Владелец приостановил работу из-за исчерпания лимитов ровно посередине: **все 5 исследований написаны (4 полностью, 1 частично), отчёты ещё не написаны**.

## 2. What's already done
- Эпик GSL-41 + 7 задач (GSL-42..48) созданы в Jira, зеркалированы в GH (#48..55). Ветка `GSL-41-orchestration-research` от main, коммит GSL-42 (`898297c`, леджер+housekeeping) запушен.
- Исследования в `docs/research/2026-07-07-orchestration/` (НЕ закоммичены, лежат на диске): 01-autosk (32КБ, ГОТОВ), 02-warren-overstory (37КБ, ГОТОВ), 03-headless-subscription-landscape (37КБ, ГОТОВ), 04-loop-engineering (36КБ, почти готов — воркер не успел отчитаться), 05-lab-ui-mobile-autonomy (7.6КБ, В ПРОЦЕССЕ — оборван паузой).
- Главные ответы уже получены: (а) `claude -p` работает по подписке штатно, но с ~15.06.2026 программные вызовы метятся отдельным месячным кредитным пулом; риск закрытия НИЗКИЙ; рекомендация — оставить tmux+Agent Teams движком; (б) супервизия оркестратора решается механическим watchdog'ом (heartbeat-файл + launchd + бюджет рестартов) по образцу Warren; Overstory повторяет нашу архитектуру и имеет ту же дыру; (в) AutoSK доказывает subscription-native подход и даёт mobile-референс (Tauri iOS, но без TLS/push).

## 3. What we're doing next
После возобновления: дописать 05 (res-labui), затем 4 писателя отчётов + PRD, затем коммиттер (Opus), ревью, PR, merge. Детальная очередь — в Part 2.

## 4. Problems we have
- Лимиты подписки исчерпаны — причина паузы. Три воркер-панели могли остаться живыми (квиесцированы владельцем напрямую): res-loops, res-labui, writer-landscape — их надо переучесть при возобновлении (см. Part 2).
- Телеметрия циклов 5-7 (res-loops, res-labui, writer-landscape) НЕ получена — воркеры не успели отчитаться; в TELEMETRY стоит gap-флаг.
- Спавн-лимит машины: максимум 3 одновременных воркер-панели (4-я падает с "fork failed: Device not configured").

## 5. Comments & recent decisions
- Владелец (2026-07-07): все агенты — Fable 5; только механика — Opus 4.8. ПУЛЬС оркестратора каждые ~5-10 мин при живом флоте (ScheduleWakeup в конце каждого хода) — после моего dead-stall'а.
- Инцидент-урок: `tmux kill-pane -a` убил первый флот исследователей — панели убивать ТОЛЬКО по явному id. Транзиентный "API Error: Server error mid-response" лечится одним continue-наджем на файл находок (проверено 2×).
- Исследователи пишут находки инкрементально в СВОЙ файл, git не трогают (один коммиттер в конце). Клоны — в gitignored `.research-cache/`.

# ── Part 2 · Formal / precise ──

## ⚠️ Hard rules (carry verbatim)
- NO Workflow tool. ALL agents = tmux-pane teammates (Fable 5; Opus 4.8 только механика). Max 3 concurrent панели. Пульс ~270s при живом флоте. kill-pane только по явному id. Оркестратор НЕ исполняет delivery сам. Reviews+merges автоматом (full autonomy). Артефакты в дереве проекта; никаких /tmp.
- Epic+Task; 1 branch/Epic; 1 commit/Task (`GSL-N ...`); 1 PR/Epic; REGULAR merge; идемпотентность; no force-push.

## Connections
| Thing | Value |
|---|---|
| Jira | GSL, cloudId 74054cdc-47ef-497d-9684-734149876a8b; To Do=11/In Progress=21/In Review=31/Done=41 |
| GitHub | ainstance-labs/gosleep; main @ 41566be; branch `GSL-41-orchestration-research` @ `898297c` (pushed) |
| Epic | GSL-41 (In Progress) = GH #48; tasks GSL-42..48 = GH #49..55; GSL-42 Done, остальные To Do |
| Next free | Jira GSL-49; GH #56 |
| Owner | Roman L, rommxx@gmail.com, accountId 557058:83b04839-8bde-4331-9c2d-24843d0b8e67 |

## Fleet at pause (2026-07-07 ~23:15 local)
- Панели окна 1:0: %36 = оркестратор; %91 = res-loops (04, файл 35596B — почти готов, отчёта НЕ прислал); %92 = res-labui (05, файл 7618B — В ПРОЦЕССЕ); %93 = writer-landscape (входы читал, файлов отчёта ещё НЕ создал). Владелец сам велел им пауза — ожидаются квиесцированными.
- Окна/сессии 0/2/3/4 tmux — ЧУЖИЕ проекты, не трогать.

## Immediate next steps (⭐ RESUME POINT)
1. Прочитать `ORCHESTRATION-STATE.md` + этот handoff; `tmux list-panes -t 1:0` — сверить панели с "Fleet at pause".
2. Живые квиесцированные воркеры: res-loops — нуджнуть «допиши COVERAGE и пришли финальный отчёт с телеметрией»; res-labui — нуджнуть «продолжай по брифу с места остановки» (бриф в логе сессии/восстановить из этого handoff §Writer-briefs); writer-landscape — нуджнуть «продолжай: пиши docs/reports/orchestrator-landscape/index.html + RU/index.html». Мёртвые панели → перезапустить с суффиксом -2, указав продолжать по частичному файлу.
3. Дальше очередь писателей (max 3 панели, Fable 5): (b) writer-headless → `docs/reports/headless-and-supervision/` (входы 03+02, ГОТОВЫ); (c) writer-autonomy → `docs/reports/autonomy-lab-ui/` (входы 05+01); (d) writer-loops → `docs/reports/loop-engineering/` (вход 04); (e) writer-prd → `docs/prd/` (все 5 findings + отчёты; markdown по скиллу writing-prds, фазовая структура; ПОСЛЕДНИМ).
4. Требования к отчётам (владелец): дашборд с нуля, self-contained HTML (инлайн CSS/SVG, без внешних ресурсов), светлая+тёмная тема, responsive, схемы-SVG, термины объяснять просто с вводом в контекст, максимально подробно (дублирование ок), EN `index.html` + полная RU-версия `RU/index.html`, каждый отчёт в своей папке.
5. После писателей: коммиттер (Opus, механика): коммиты по задачам — GSL-43 (findings pack: docs/research/*), GSL-44..47 (по отчёту), GSL-48 (PRD), каждый с dev_history-файлом `docs/dev_history/GSL-NN-...md` + обновлением README-индекса; Jira-переходы в Done; push; PR `GSL-41 ...` (body: Implements GSL-41, checklist, Mirrors GH #48, Closes #48..#55); ревьюер (Fable 5) по pushed SHA; merge REGULAR; закрыть GH-issues; эпик → Done.
6. Телеметрию циклов 5-7 запросить в финальных отчётах воркеров; если воркер мёртв — range-read его `## ORCHESTRATOR REPORT`-блока НЕ применим (это findings-файлы, не handoff) → писать `tokens=UNRECOVERED — gap flagged`.

## Writer-briefs (эталон — writer-landscape)
Полный текст брифа writer-landscape хранится в логе этой сессии; ключевые элементы для реконструкции: роль, входные findings-файлы, выходные пути (`docs/reports/<folder>/index.html` + `RU/index.html`), требования владельца (дашборд/термины/подробность), технические требования HTML (self-contained, темы, responsive, SVG), правила (no git, no Workflow, ≤2 субагентов, инкрементальность, PROGRESS >10 мин, контекст до ~75-80%), финальный отчёт ≤12 строк + телеметрия.

## Gotchas
- Findings НЕ закоммичены (untracked) — не потерять при переключении веток; коммитит их только коммиттер-воркер задачей GSL-43.
- `docs/prompts/2-deep-orchestrating-research.md` untracked — файл владельца, в коммиты не включать без его решения.
- 03-headless CAVEAT: цифры кредитного пула ($20/$100/$200) из вторичных источников — перепроверить перед использованием в PRD.
- Существующий `docs/reports/token-overage-incident-2026-06-28` — старый стиль, владелец просил НЕ ориентироваться на него.
- Спавн-кап 3; "API Error mid-response" → один continue-надж; kill-pane только по id.

## Blocked on the human
- Возобновление работы (лимиты). Опционально при возобновлении: подтвердить бюджет на фазу писателей (5 Fable-циклов + коммиттер + ревью ≈ заметный расход).
