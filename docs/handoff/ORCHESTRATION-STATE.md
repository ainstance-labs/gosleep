# ORCHESTRATION-STATE — gosleep (Orchestration Harness)

## At a glance (human)

- **Working on:** **GSL-41 deep-research orchestration** per `docs/prompts/2-deep-orchestrating-research.md`. Deliverables: 4 HTML dashboard reports (EN+RU) в `docs/reports/` + PRD в `docs/prd/`.
- **Progress:** research **5/5 DONE** (01-autosk 32K, 02-warren-overstory 37K, 03-headless 37K, 04-loop-engineering ~40K, 05-lab-ui 48K). Writers: writer-landscape RUNNING (a, Fable), writer-headless RUNNING (b, Fable), writer-loops SPAWNING (d, **Opus** — новая политика). Очередь: (c) writer-autonomy [входы 05+01 готовы], (e) writer-prd [последним]. Затем коммиттер (Opus) → ревью → PR → merge.
- **⛔ МОДЕЛЬНАЯ ПОЛИТИКА ОБНОВЛЕНА (owner, 2026-07-08 ~00:25): лимиты Fable 5 кончаются, Opus 4.8 — хорошие. Текущие Fable-агенты (writer-landscape, writer-headless) ДОДЕЛЫВАЮТ; все НОВЫЕ агенты — исключительно Opus 4.8.**
- **Ключевые ответы исследований:** (а) `claude -p` по подписке BY DESIGN, metered pool ~06/2026, kill-risk LOW; движок — tmux+Agent Teams; (б) супервизия = механический watchdog (heartbeat + launchd + restart budget) + уроки Gastown (startup grace, zombie debounce, cooldown, exp backoff); (в) AutoSK = subscription-native + mobile-референс, но официальный **Remote Control (02/2026, subscription-only, push, TLS) обесценивает DIY-transport** — рекомендуемый стек: Remote Control + hook→ntfy push + Tailscale break-glass; (г) min "owner sleeps" = self-pulse + night mode + question buffer; (д) Laboratory = 3 яруса: hooks→events.jsonl (0 токенов) / конвенции скиллов / chronicler-регенератор статик-HTML + morning digest; урок tasty-lunch (197 dev_history, 94+ handoffs по протоколу; но手-правленный wiki-хаб сгнил за месяц → дашборд только скрипт-регенерируемый); (е) буфер вопросов: BLOCKER push-now / DECISION default+deadline / CLARIFY proceed / FYI + decision-manifest + learning loop; (ж) UI: "autonomy runway" = min() из 6 часов-исчерпания; 7 экранов.
- **⛔ OWNER DIRECTIVES IN FORCE:** (1) NO Workflow — все агенты tmux-pane teammates. (2) Модели: НОВЫЕ агенты = Opus 4.8 (с 2026-07-08 ~00:25); работающие Fable 5 доделывают. (3) PULSE ~5-10 мин при живом флоте. (4) Отчёты = HTML-дашборды; docs/research/*.md — служебные (owner подтвердил); PRD = markdown.
- **Standing policy:** оркестратор не исполняет ничего; reviews+merges автоматом; владею STATE + датированными handoff.

## LIVE-STATUS

`PHASE GSL-49 STARTING (2026-07-10, autonomous continuation per owner) — PRD Phase 1: Watchdog над оркестратором | cycle 1 (setup, Opus) SPAWNING: эпик GSL-49 + задачи из PRD Phase 1 + housekeeping-коммит леджера + ветка | база: main @ 55907e1 (GSL-41 merged PR #56) | next GH=#57 | policy: Fable 5 + Opus для чистой механики (2026-07-10), NO Workflow, PULSE ~270s, max 3 panes, kill-pane by id | resume: handoff 14 + этот файл.`

## TELEMETRY (cumulative — never reset; append one line per cycle)

`cycles_completed≈44 | open_workers=[writer-landscape (Fable), writer-headless (Fable)] (+res-labui terminating) | prior-run tokens not surfaced per-cycle.`
- `hardening arc (PRs #35/#42/#47): see handoff 12.`
- `cycle=1 worker=gsl41-setup model=claude-opus-4-8 tokens_out=~14000 tokens_in=~120000 cache_read=~90000 | running: cycles=31 total≈224000`
- `cycle=2a workers=res-* (first spawn) model=claude-fable-5 KILLED by orchestrator kill-pane error — tokens_this_cycle=UNRECOVERED — gap flagged`
- `cycle=2 worker=res-autosk-2 model=claude-fable-5 tokens_out=~14000 tokens_in=~90000 cache_read=~1200000 | running: cycles=32 total≈328000 (+2a gap)`
- `cycle=3 worker=res-headless-2 model=claude-fable-5 tokens_out=~33000 tokens_in=~310000 cache_read=~240000 | running: cycles=33 total≈671000 (+2a gap)`
- `cycle=4 worker=res-warren-2 model=claude-fable-5 tokens_out=~18000 tokens_in=~420000 cache_read=~360000 | running: cycles=34 total≈1109000 (+2a gap)`
- `cycle=5 worker=res-loops model=claude-fable-5 tokens_out=~23000 tokens_in=~115000 cache_read=~1100000 (final cumulative) | running: cycles=35 total≈1247000 (+2a gap)`
- `cycle=6 worker=res-labui model=claude-fable-5 tokens_out=~26000 tokens_in=~260000 cache_read=~650000 (final cumulative, incl. pre-pause) | running: cycles=36 total≈1533000 (+2a gap)`
- `cycle=7 worker=writer-loops model=claude-opus-4-8 tokens_out=~54000 tokens_in=~46000 cache_read=~120000 | running: cycles=37 total≈1633000 (+2a gap)`
- `cycle=8 worker=writer-landscape model=claude-fable-5 tokens_out=~133000 tokens_in=~78000 cache_read=~1600000 (final) | running: cycles=38 total≈1844000 (+2a gap)`
- `cycle=9 worker=writer-headless model=claude-fable-5 tokens_out=~96000 tokens_in=~58000 cache_read=~520000 (final) | running: cycles=39 total≈1998000 (+2a gap)`
- `cycle=10 worker=writer-autonomy model=claude-opus-4-8 tokens_out=~47000 tokens_in=~95000 cache_read=~180000 | running: cycles=40 total≈2140000 (+2a gap)`
- `cycle=11 worker=writer-prd model=claude-opus-4-8 tokens_out=~14000 tokens_in=~95000 cache_read=est-unavailable (worker flagged gap) | running: cycles=41 total≈2249000 (+2a gap)`
- `cycle=12 worker=gsl41-committer model=claude-opus-4-8 tokens_out=~16000 tokens_in=~120000 cache_read=~70000 | running: cycles=42 total≈2385000 (+2a gap)`
- `cycle=13 worker=gsl41-reviewer model=claude-opus-4-8 tokens_out=~7000 tokens_in=~62000 cache_read=~40000 | running: cycles=43 total≈2454000 (+2a gap)`
- `cycle=14 worker=gsl41-finalizer model=claude-opus-4-8 tokens_out=~8500 tokens_in=~140000 cache_read=~110000 (final, approx) | running: cycles=44 total≈2603000 (+2a gap)`
- interim (not final): ≈4k/90k/60k на паузе — финальная строка при COMPLETE.

## Standing rules / decisions

- 2026-06-11 (owner): оркестратор не исполняет delivery — всё воркерам; state on disk + dated handoff на каждой границе.
- 2026-06-27/28 (owner): FULL AUTONOMOUS; N=2; vendoring Option A.
- 2026-06-29 (owner): FULL AUTONOMY — reviews AND merges automatic. Пауза только на denylist/irreversible/credentials.
- 2026-07-01 (owner, IN FORCE): NO Workflow tool. Все агенты = tmux-pane teammates. No mass-spawn. Ask before any Workflow.
- Модельная политика (история): 2026-07-07 Fable5+Opus-механика → 2026-07-08 ~00:25 только Opus (Fable-лимиты) → **АКТУАЛЬНО 2026-07-10 (owner, после обсуждения): Fable 5 для всего содержательного; СОВСЕМ механические задачи — Opus 4.8 допустим** (setup-скаффолдинг подтверждён как механика — оркестратор дал оценку ~90% рутины, владелец принял).
- 2026-07-07 (owner, IN FORCE): PULSE ~5-10 мин при живом флоте (ScheduleWakeup в конце каждого хода).
- 2026-07-07 (урок, HARD): kill-pane ТОЛЬКО по явному id после re-list. Никогда `-a`. Не глушить stderr на разрушающих tmux-командах.
- loop-guard: поведение не сдвинулось за 2 честные попытки → калибровка / к владельцу.
- Anchors: Jira GSL cloudId 74054cdc-47ef-497d-9684-734149876a8b (11/21/31/41); GitHub ainstance-labs/gosleep; assignee Roman L 557058:83b04839-8bde-4331-9c2d-24843d0b8e67. Epic+Task; 1 branch/Epic; 1 commit/Task; 1 PR/Epic; REGULAR merge; идемпотентно; no force-push; артефакты в дереве.
- `skill/` source of truth; `./install.sh` local→global. Model всегда явно.
- Research-run: клоны → `.research-cache/`; исследователи — свой findings-файл; писатели — своя папка отчёта; git — только коммиттер в конце.

## Known-automation-traps (this machine)

- **Spawn cap:** 4-я одновременная воркер-панель падает (`fork failed: Device not configured`). Max 3; очередь.
- Окно 1:0 — наше (%36). Сессии 0/2/3/4 tmux — чужие.
- Транзиентный `API Error: Server error mid-response` → один continue-надж на findings-файл (проверено 2×).
- Session-limit hit переживаем: воркеры квиесцируются, файлы целы, после резета продолжают по наджу (проверено).

## Eval status — FINAL after GSL-37: SC-09 fixed; SC-11 fixed; SC-12 validated; SC-19 0.75.

## Log

### 2026-06-11 → 2026-07-01 (compressed — hardening arc COMPLETE)
- GSL-1 (#5), GSL-7 (#16), GSL-15 (#21), GSL-19 (#27), GSL-24 (#35), GSL-31 (#42), GSL-37 (#47). Детали: handoff 12.

### 2026-07-07 — Phase GSL-41 (день 1)
- Setup (Opus): GSL-42 `898297c`; epic GH #48; tasks GH #49..55. | Уроки: dead-stall → PULSE; `kill-pane -a` → id-only; API-error → надж.
- Research DONE день 1: 01-autosk; 03-headless; 02-warren-overstory (сводки — в "At a glance" и handoff 13).
- **PAUSE 23:15** (лимиты; handoff 13) → **resume 2026-07-08 ~00:05** (owner разбудил воркеров сам).

### 2026-07-08 — день 2
- **Cycle 5 (res-loops, Fable) DONE + continuation:** 04 дополнен (Gastown watchdog impl: Boot LLM-triage + flock, stuck-kill 30s×3 + cooldown, startup grace, zombie debounce, exp backoff, mass-death; ralph-wiggum = внутрисессионный луп; Letta sleep-time → adoption 8). Терминирован 00:16.
- writer-headless (b, Fable) spawned ~00:20 в слот res-loops.
- **Cycle 6 (res-labui, Fable) DONE:** 05 (48002B, §1-7+COVERAGE) — tasty-lunch: конвенции масштабируются (197 dev_history, 94+ handoffs), но рукотворный wiki-хаб сгнил → Laboratory только скрипт-регенерируемая; 3 яруса (hooks→events.jsonl 0-токенов / конвенции / chronicler bounded claude -p, НЕ pane-teammate); буфер вопросов 4 типа + decision-manifest + learning loop; mobile: официальный Remote Control (2026-02-24, subscription-only, push, TLS) вместо DIY autosk → стек Remote Control + hook→ntfy + Telegram-ответы + Tailscale; UI: autonomy runway = min(6 часов-исчерпания), 7 экранов ASCII. NOT covered: hands-on тесты. Shutdown requested ~00:29.
- **00:25 owner: смена модельной политики** — Fable-лимиты кончаются; текущие Fable доделывают, НОВЫЕ агенты только Opus 4.8. writer-loops (d) пойдёт на Opus.
- **Cycle 7 (writer-loops, Opus) DONE ~00:38:** отчёт (d) loop-engineering: EN 79.5K + RU 97.7K, 8 секций + источники, SVG-таймлайн канона, 10 паттерн-карточек, gap-таблица 8✅/2⚠/5❌, adoption 8 позиций + MVP-пакет; self-contained верифицирован. Shutdown requested.
- Wind-down Fable-писателей ~00:30 (владелец: Fable только для оркестратора): ждём чекпоинты writer-landscape/writer-headless → преемники на Opus.
- **Cycle 8 (writer-landscape, Fable) DONE ~00:44:** отчёт (a) orchestrator-landscape ЦЕЛИКОМ вместо чекпоинта — EN 128K (1335 строк) + RU 183K (1348 строк), 9 секций, глоссарий 16 терминов, 4 SVG-схемы/язык, 11 таблиц, матрица 7×15 с колонкой gosleep + 3 дыры, план Tier1(6)+Tier2(16); палитра dataviz, self-contained, тег-баланс проверен. Преемник не нужен. Shutdown requested.
- **Cycle 9 (writer-headless, Fable) DONE ~00:47:** отчёт (b) headless-and-supervision ЦЕЛИКОМ — EN 102.7K + RU 141.7K; claude -p с нуля + auth ladder, таймлайн политики с FACT/COMMUNITY бейджами, матрица подходов A–F + рекомендация A+D+B, supervision: D1-D5 дыры + кейсы Overstory/Warren/Gastown + 15 production-уроков, дизайн watchdog (4 swimlane SVG, псевдокод, rollout), топ-10 рекомендаций, 17 источников. Преемник не нужен. Shutdown requested.
- **Cycle 10 (writer-autonomy, Opus) DONE ~01:00:** отчёт (c) autonomy-lab-ui — EN 96258B + RU 96193B; Лаборатория 3 яруса SVG, буфер вопросов (4 типа, queue.jsonl, decision-manifest 6 секций, learning loop, morning digest), UI autonomy runway + живые HTML-макеты 5 экранов, mobile RC+ntfy+Telegram+Tailscale, 12 рекомендаций V/E/R. Shutdown requested. ВСЕ 4 ОТЧЁТА ГОТОВЫ.
- **Cycle 11 (writer-prd, Opus) DONE ~01:12:** PRD-gosleep-evolution.md (748 строк, 80K) + README-индекс; C1-C8 constraints (subscription-only, interactive engine, claude -p glue, NO Workflow, cap-3, model tiers); 6 фаз safety→scheduling→autonomy→doc→UI→mobile, ~35 commit-sized задач, seam-guard матрица, риски, defer-лист (SSE v2, AI-триаж, CI-gate, sleep-time). Gastown-уроки и cache-окна вшиты. Shutdown requested.
- **Cycle 12 (gsl41-committer, Opus) DONE ~01:20:** 6 коммитов (GSL-43..48) + dev_history каждый + индекс; 2 CHECKPOINT.md удалены до стейджа; Jira GSL-43..48 Done, эпик In Review; PR #56 OPEN, mergeStateStatus=CLEAN; леджер/prompts не тронуты. Deviations: dev_history с -cycle1- (в тон GSL-42); loop-engineering HTML без doctype-обёртки (фрагменты, на оценку ревьюеру); GH-мэппинг #49..#55=GSL-42..48 сверен по телам. Shutdown requested.
- **Cycle 13 (gsl41-reviewer, Opus) DONE ~01:25:** ревью PR #56 → docs/reviews/REVIEW-gsl41.md. CRITICAL 0 / MAJOR 1 (loop-eng EN+RU: нет meta charset+doctype — кириллица RU рискует mojibake через file://; только 2 из 8 файлов) / MINOR 1 (quirks mode, то же лечение). PASS: 7 коммитов key-first, 7 dev_history + индекс, 0 внешних подгрузок, EN/RU h2-паритет точный, PRD 6 фаз полные, PR body корректен. Вердикт FIX (одно правко-место). Shutdown requested.
- **Cycle 14 (gsl41-finalizer, Opus) DONE ~23:40:** fix 4258890 (обёртка обоих loop-eng файлов, title/viewport/style корректно в head, verified); PR #56 merged REGULAR → 55907e1; issues #48..#55 закрыты (auto-Closes закрыл только эпик — остальные вручную); Jira эпик Done; ветка удалена лок+origin; леджер переехал на main без stash (git fetch origin main:main + checkout). ЭПИК GSL-41 ЗАВЕРШЁН.

### 2026-07-10 — Phase GSL-49: Watchdog (PRD Phase 1)
- Owner: «почему остановился?» → урок принят (memory: continue-at-milestone-boundaries): на границе эпика продолжаю автономно следующей фазой PRD, не спрашивая. Стартую GSL-49 (рекомендация из handoff 14).
- Cycle 1 (gsl49-setup, Opus, механика): SPAWNING — PRD Phase 1 → Jira эпик+задачи+GH-зеркало, ветка, housekeeping-коммит леджера (STATE + handoffs 13/14; prompts-файл владельца НЕ коммитить).
- Owner 2026-07-10: вопрос «Opus?» → оценка оркестратора: setup = ~90% механика (PRD уже содержит готовый список задач) → shutdown отозван, gsl49-setup доделывает на Opus.
