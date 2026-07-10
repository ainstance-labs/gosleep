# Handoff — gosleep — 2026-07-09 (GSL-41 complete: research → 4 отчёта EN+RU → PRD; всё смержено)

> For a FRESH orchestrator or the owner returning. Read Part 1 first, then "Immediate next steps". Ground truth = `docs/handoff/ORCHESTRATION-STATE.md` (read FIRST) + Jira GSL + this repo. Supersedes the 2026-07-07 pause handoff.

# ── Part 1 · Plain words ──

## 1. Where we are now
gosleep — репозиторий оркестрационного харнесса (владеет 5 delivery-скиллами). Эпик **GSL-41 «глубокое исследование оркестраторов» ПОЛНОСТЬЮ ЗАВЕРШЁН**: PR #56 смержен в `main @ 55907e1`, все задачи и GH-issues закрыты, ветка удалена, флот пуст. Открытых PR и незакрытых Jira-задач нет.

## 2. What's already done
- Исследованы максимально глубоко (клоны + код + веб): **AutoSK** (wierdbytes/autosk + autosk.app), **Warren** и **Overstory** (jayminwest), плюс `claude -p`/headless/подписка, loop engineering как дисциплина, и референс tasty-lunch для «Лаборатории». Сырьё: 5 файлов в `docs/research/2026-07-07-orchestration/`.
- Написаны **4 профессиональных HTML-дашборда, каждый в двух языках** (`index.html` EN + `RU/index.html`): `docs/reports/orchestrator-landscape/`, `docs/reports/headless-and-supervision/`, `docs/reports/autonomy-lab-ui/`, `docs/reports/loop-engineering/`. Все self-contained (инлайн CSS/SVG, светлая+тёмная тема), термины объясняются с нуля.
- Написан **PRD**: `docs/prd/PRD-gosleep-evolution.md` (748 строк) — 6 фаз развития (~35 commit-sized задач): watchdog → self-pulse/night mode → буфер вопросов → Лаборатория → UI → mobile.
- Ревью пройдено (1 MAJOR-находка про charset исправлена fix-коммитом до merge).

## 3. Ключевые выводы (кратко)
- **`claude -p` работает по подписке штатно** (это официальная поверхность; с ~июня 2026 программные вызовы идут из отдельного месячного metered-пула). Риск закрытия — НИЗКИЙ. Anthropic метит официальные поверхности и банит сторонние харнессы.
- **Наш движок (interactive Claude Code + Agent Teams/tmux) — самая защищённая поверхность**; оставляем его; `claude -p` — только для bounded-глю (chronicler, watchdog-triage) с бюджетом.
- **Надзор над оркестратором** решается МЕХАНИЧЕСКИМ (не-LLM) watchdog'ом: heartbeat-файл + launchd + restart budget + эскалация; обязательны производственные уроки Gastown (startup grace, zombie debounce, kill cooldown, exp backoff), иначе false-fire в первую ночь. Overstory (наша же архитектура) имел ту же дыру; автор Warren вообще ушёл от persistent LLM-координатора.
- **AutoSK** — доказательство subscription-native подхода; их mobile (Tauri iOS, raw TCP без TLS/push) обесценен официальным **Remote Control** (подписка, push, TLS) — наш стек: RC + hook→ntfy + Telegram + Tailscale.
- **Loop engineering:** наш скилл выше канона на worker-стороне, ниже на orchestrator-стороне; минимальный пакет «владелец спит» = self-pulse + night mode + буфер вопросов (LOW-MED усилие). Буфер вопросов почти не существует в публичном коде — шанс лидировать.

## 4. Problems we have
- Ничего блокирующего. Леджер оркестратора (ORCHESTRATION-STATE.md + handoffs 13/14 + docs/prompts/2-*.md) лежит на main НЕзакоммиченным — закоммитить первой housekeeping-задачей следующего эпика (prompts-файл — по решению владельца).
- Телеметрия: гэп цикла 2a (первый флот убит до отчётов) помечен в TELEMETRY; часть цифр approx.

## 5. Comments & recent decisions
- Модельная политика (owner, 2026-07-09): **новые агенты = Fable 5; совсем механическая работа = Opus 4.8.** История переключений — в STATE.
- Новые жёсткие правила этой фазы: ПУЛЬС оркестратора (~270s при живом флоте, ScheduleWakeup в конце каждого хода); kill-pane ТОЛЬКО по явному id (инцидент `kill-pane -a` убил флот); spawn cap = 3 одновременных воркер-панели на этой машине; транзиентный API-error лечится одним continue-наджем; session-limit переживается (воркеры квиесцируются, файлы целы, после резета продолжают).

# ── Part 2 · Formal / precise ──

## ⚠️ Hard rules (carry verbatim)
- NO Workflow tool. ALL agents = tmux-pane teammates. Max 3 concurrent воркер-панели (4-я падает: `fork failed: Device not configured`). PULSE ~270s при живом флоте. kill-pane только по явному id после re-list, никогда `-a`. Оркестратор НЕ исполняет delivery сам. Reviews+merges автоматические (full autonomy). Артефакты в дереве проекта.
- Модели: новые агенты Fable 5; чистая механика Opus 4.8; `model:` всегда явно.
- Epic+Task; 1 branch/Epic; 1 commit/Task (`GSL-N ...`); 1 PR/Epic; REGULAR merge; идемпотентность; no force-push; dev_history на каждую задачу.

## Connections
| Thing | Value |
|---|---|
| Jira | GSL, cloudId 74054cdc-47ef-497d-9684-734149876a8b; To Do=11/In Progress=21/In Review=31/Done=41 |
| GitHub | ainstance-labs/gosleep; **main @ 55907e1** (merge PR #56); 0 open PRs/issues |
| Next free | Jira GSL-49; GH #57 |
| Owner | Roman L, rommxx@gmail.com, accountId 557058:83b04839-8bde-4331-9c2d-24843d0b8e67 |

## Артефакты GSL-41 (всё в main)
- Findings: `docs/research/2026-07-07-orchestration/{01-autosk,02-warren-overstory,03-headless-subscription-landscape,04-loop-engineering,05-lab-ui-mobile-autonomy}.md`
- Отчёты (EN + RU): `docs/reports/orchestrator-landscape/`, `docs/reports/headless-and-supervision/`, `docs/reports/autonomy-lab-ui/`, `docs/reports/loop-engineering/` — в каждой `index.html` + `RU/index.html`
- PRD: `docs/prd/PRD-gosleep-evolution.md` (+ `docs/prd/README.md`)
- Dev history: `docs/dev_history/GSL-42..48-*.md` + индекс. PR: #56 (merged). Ревью-отчёт: `docs/reviews/REVIEW-gsl41.md` (gitignored, локально).

## Телеметрия фазы (сводно; полный блок в STATE)
14 циклов: setup (Opus), 5 исследователей (Fable), 4 писателя отчётов (2 Fable + 2 Opus), PRD (Opus), коммиттер/ревьюер/финализатор (Opus). Суммарно ≈2.6M токенов (approx, + невосстановимый гэп цикла 2a — первый флот погиб до отчётов). Инциденты и уроки — в STATE §Known-automation-traps + Standing rules.

## Immediate next steps (⭐ RESUME POINT)
1. **Housekeeping-коммит леджера** (первая задача следующего эпика): `docs/handoff/ORCHESTRATION-STATE.md` + `13-*.md` + `14-*.md`; `docs/prompts/2-deep-orchestrating-research.md` — спросить владельца, коммитить ли.
2. **Выбрать следующий эпик из PRD** (`docs/prd/PRD-gosleep-evolution.md`). Рекомендация: **Phase 1 — Watchdog над оркестратором** (наибольшая ценность для «GoSleep», хорошо специфицирована, S-M усилие) → создать эпик GSL-49 по конвенции.
3. Минорный бэклог (владелец решает): SC-19 polish ≥0.8; eval-runner stale N-header; SC-11 higher-N confirm; локальные ветки GSL-7/GSL-19 (remotes уже удалены); hands-on тесты Remote Control + hooks-матрицы (findings 05 NOT-covered).

## Gotchas
- Спавн-кап 3 панели; kill-pane только по id; API-error → один continue-надж; session-limit → resume по наджу; `docs/reports/token-overage-incident-*` — старый стиль, не референс.
- Эвал-раннер (`evals/runner/`) — это Workflow: НЕ запускать без явного разрешения владельца; только через run-config.json + контрольный прогон; N=2.
- tmux-сессии 0/2/3/4 — чужие проекты; наше окно 1:0.

## Blocked on the human
- Ничего блокирующего. Ожидается решение: какой эпик следующий (Phase 1 watchdog?) и судьба untracked prompts-файла.
