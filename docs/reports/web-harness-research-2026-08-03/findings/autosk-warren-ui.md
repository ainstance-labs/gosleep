# Веб-интерфейсы AutoSK, Warren, Overstory — архитектурный разбор

**Автор:** res-autosk-warren (эксперт-исследователь панели «веб-интерфейс harness»)
**Дата:** 2026-08-03
**Источники:** живые репозитории на GitHub на момент чтения + прошлые внутренние исследования (`docs/reports/autosk-anatomy/index.html`, `docs/reports/autonomy-lab-ui/index.html`, `docs/reports/orchestrator-landscape/index.html`).
**Границы факта:** каждая техническая деталь ниже опирается либо на конкретный файл в репозитории, либо на страницу README. То, чего проверить не удалось, помечено «не найдено».

## Ключевой вывод одним абзацем

Три референса решают **три разных задачи** и потому дают три разных ответа на «как выглядит веб harness».
**AutoSK** формально **не веб-инструмент**: у него Tauri-приложение (React/Vite внутри нативной оболочки) плюс mobile web view для iOS, оба — тонкие клиенты JSON-RPC-демона `autoskd` через Unix-socket. **Warren** — единственный из трёх с реальным «браузерным» HTTP-контрольным-планом (`warren serve` на :8080, React 18 + Vite 6 + Tailwind v4 + shadcn/radix, NDJSON-стрим событий), но платит за это API-ключом Anthropic — под подписку не работает. **Overstory** архивирован 2026-05-28 и объявлен «духовным предшественником Warren»: там был `ov serve` на :7321 с HTTP + WebSocket, headless `claude -p` и SQLite-mail-шина между координатором и воркерами — это исторически интересная, но уже нерабочая референсная точка. Для нашего проекта (TypeScript-стек, статические HTML сегодня, kicks-to-real-UI завтра) Warren — самый близкий шаблон, а AutoSK и Overstory дают точечные приёмы, которые полезно унести отдельно.

---

## 1. Сравнительная таблица

| Ось | **AutoSK** (v0.2.4, 2026-06-28, frozen) | **Warren** (v0.13.1, active) | **Overstory** (archived 2026-05-28) |
|---|---|---|---|
| **Есть ли веб-интерфейс** | Строго говоря — нет. Есть Tauri-нативка (React/Vite внутри Rust-обёртки) + mobile **web** view для iOS. Браузер сам по себе к демону не подключается. | **Да, полноценный.** SPA (React 18 + Vite + Tailwind v4 + shadcn/radix) обслуживается Bun-сервером на :8080. | **Да.** `ov serve` поднимал HTTP + WebSocket-сервер на :7321. Отдельно был TUI-дашборд `ov dashboard`. |
| **Стек фронта** | React + Vite (в Tauri), TypeScript. Отдельно Astro для маркетингового сайта. Отдельно Go+gocui+lazycore TUI (~15.7k LOC, 119 файлов). | React 18.3, Vite 6, Tailwind v4, shadcn-компоненты на Radix (dialog, label, slot, toast), TanStack Query 5, react-router 7, Recharts 3.8, Framer Motion 12, lucide-react, TypeScript. | Vite/TS (папка `ui/`), детали фронта в архиве беглый WebFetch не раскрыл. |
| **Стек сервера** | `autoskd` — Bun/TypeScript, компилируется в single-binary, автоматически стартует при первом обращении CLI/TUI/GUI. | `warren serve` — Bun/TypeScript, слушает `Bun.serve` на :8080. В контейнере это `ENTRYPOINT`. | Bun/TypeScript, HTTP + WebSocket сервер, отдельный `ov` CLI. |
| **Транспорт клиент↔сервер** | **JSON-RPC поверх Unix-domain socket** (локальный режим) или host:port с bearer-token (удалённый режим). GUI и CLI одинаково клиенты одного протокола. | **HTTP (REST) + NDJSON-стримы** через `GET /runs/:id/events?follow=1`. WebSocket-сервера не найдено — стриминг решён «push over HTTP» через долгие NDJSON-ответы. Есть модуль `bridges.ts` + `bridge-reconnect.ts` (client-side reconnect с backoff — стилистически похоже на EventSource). | **HTTP + WebSocket** для UI, **SQLite mail-bus** (WAL mode, ~1-5 мс/запрос) для inter-agent, плюс NDJSON из headless `claude -p` для событий агентов. |
| **Где живёт состояние** | Файлы в `.autosk/` внутри репозитория пользователя (задачи, история). Плюс демонский рантайм-стейт. | **SQLite** (`/data/warren.db`) как основной лог событий/runs. Опция PostgreSQL (`WARREN_DB_URL=postgres://…`) для «org-scale». Рабочие каталоги — `/data/burrow/` (локальный runtime) или k8s pod-volumes. | **SQLite** для mail-системы, merge-queue, метрик; git worktrees для изоляции воркеров; файловая система для checkpoints и persistent-CV агентов. |
| **Как запускается** | CLI/TUI/GUI сами поднимают `autoskd` на первом обращении. GUI — установленный `.app`/`.deb`/AppImage. iOS — TestFlight. | Docker-контейнер (`ghcr.io/jayminwest/warren:latest`), `docker run -p 8080:8080 -e WARREN_API_TOKEN=… -e ANTHROPIC_API_KEY=…`. Развёртывания — GKE. | `ov serve` из CLI, порт :7321 по умолчанию (конфигурируемый). |
| **Аутентификация / порт** | Локально — файловый сокет (нет сети). Удалённо — bearer-token. | `Authorization: Bearer $WARREN_API_TOKEN` **обязателен** на всех маршрутах кроме `/healthz` и `/version`. Порт :8080 по умолчанию открыт наружу через контейнер; **TLS вынесен на edge** (Caddy/ingress). | Не найдено явного описания аутентификации в архиве; сервер на localhost:7321. |
| **Что можно ДЕЛАТЬ из UI** | Смотреть задачи/сессии/воркфлоу; создавать/переводить задачи; отправлять шаги; смотреть транскрипт в реальном времени; в GUI — partials (потоковая печать ответа), в TUI partials выключены (см. `jobdetail.go:225-241`). | **Dispatch run** (`POST /dispatch`), **steer mid-run** (`POST /runs/:id/steer`), **cancel** (`POST /runs/:id/cancel`), **pause/resume** (по хендлерам `runs.pause-resume.test.ts`), просмотр live-events, per-run preview environment (`.warren/preview.yaml`), просмотр стоимости/токенов, ссылка на PR. | Dispatch, отслеживание, checkpoint/restore, watchdog-триаж; UI поддерживает live-стрим событий. |
| **Как решён «агент работает долго»** | GUI и TUI подписываются на `task-changed / project-changed / session-changed` push-нотификации демона, плюс 30-сек safety-resync + CAS-coalescing trailing-refresh (`gui.go:321-372,504-546`). Adaptive poll fallback удваивает интервал (кап 30 с) когда бэкенд медленный. | NDJSON-стрим `/runs/:id/events?follow=1` — «tail» до финализации run'а. Есть `stream-limits.ts` для ограничения одного соединения и `bridges.ts`+`bridge-reconnect.ts` для восстановления. `POST /runs/:id/steer` вбрасывает сообщение, которое агент подхватит на следующем ходу — то есть steering не прерывает текущий turn. | WebSocket для UI, headless `claude -p --output-format stream-json` парсится и разворачивается наружу, checkpoint даёт «compaction survivability». |
| **Работа под Claude-подпиской** | Через связку autosk→pi→Anthropic возможна: pi имеет полный **PKCE OAuth-флоу с claude.ai** и хранит creds в `~/.pi/agent/auth.json` (см. `providers/anthropic.ts:14`, `ai/src/utils/oauth/anthropic.ts:232-381`). autosk обёртывает `claude -p` тоже без API-ключа. **Да, реально бегает по подписке.** | **Нет.** README требует `ANTHROPIC_API_KEY=sk-ant-…` и `GITHUB_TOKEN=ghp_…`. Явная формулировка: "bring your own key, agents run in sandboxes on your infra". | Использует headless `claude -p` (по подписке возможно, пока Anthropic не закрутил гайки), но проект архивирован. |
| **Аудитория** | Solo-разработчик за ноутбуком; iOS mobile view — для присмотра. | Команда/self-hosted control plane, «Watch them work live, steer them mid-run». Много одновременных runs. | Multi-agent продвинутая оркестрация в личном контуре; deprecated. |

---

## 2. AutoSK — по осям

**Позиционирование.** «task manager + workflow engine for coding agents», три фронта на едином JSON-RPC-демоне (см. `docs/reports/autosk-anatomy/index.html` глава §1 и README AutoSK).

**Клиент.** У AutoSK **нет отдельного HTTP-сервера, слушающего 127.0.0.1**. Есть демон `autoskd`, который слушает Unix-domain socket (или host:port в удалённом режиме). GUI — это Tauri-приложение (React/Vite фронт + Rust backend, backend транслирует JSON-RPC на socket). CLI и `autosk lazy` (Go+gocui+lazycore TUI) тоже клиенты того же протокола. Mobile web view для iOS — это на самом деле специализированная сборка Tauri, а не «URL, который можно открыть в браузере».

**Freshness contract TUI** (готовый рецепт, разобранный в §6 нашего же autosk-anatomy report):
1. Подписка на 3 типа push-нотификаций (`task-changed`, `project-changed`, `session-changed`), каждая триггерит `scheduleRefresh()`.
2. Safety-resync через 30 секунд на случай пропущенных нотификаций.
3. **CAS trailing-refresh coalescing:** пока refresh в полёте, входящие спам-нотификации только флипают `pending` — цикл продолжится, финальное состояние доедет (`gui.go:504-546`).
4. **Adaptive poll fallback:** если последний fetch занял > ½ бюджета — интервал удваивается (кап 30 с). Родилось из инцидента 100%-CPU в lazygit.
5. **Spinner-only-when-running**: анимация идёт только пока сессия `running` — idle-дашборд ноль CPU (`gui.go:465-502`).

Всё это — паттерны для нашей живой dashboard-панели, они переносимы напрямую в TS-клиент.

**Действия из UI.** Ниже — контроль сессий, транскрипта, задач; всё сводится к JSON-RPC-вызовам одного и того же демона. В GUI (Tauri) поддержаны **partials** (потоковая печать assistant'а), в TUI — нет (`jobdetail.go:225-241`, стрим-хендлер без `case "partial"`). Wave-2 autosk-anatomy наш собственный отчёт помечает это `AVOID` — «wire partials from day one».

**Аутентификация.** Локально — файловый сокет (нет сети — нет проблемы). Удалённо — bearer-token. Простой, но рабочий барьер.

**Работа под Claude-подпиской.** Реализована через pi: `ANTHROPIC_OAUTH_TOKEN` проверяется **до** `ANTHROPIC_API_KEY` (`providers/anthropic.ts:14`), PKCE OAuth-флоу с claude.ai/oauth/authorize и refresh (`ai/src/utils/oauth/anthropic.ts:232-381`). Это самое ценное из AutoSK для нашего собственного веб-контрола: **приём, доказавший, что харнесс можно завести на подписку**.

**Что применимо к нам:**
- Freshness contract целиком (push-first + coalescing + adaptive fallback) — точно, без изменений.
- OAuth-паттерн pi — как ориентир, если/когда нам понадобится собственная авторизация вне Claude Code CLI.
- Транспортная разделка «GUI и CLI — тонкие клиенты одного демона» — переносится в наш «Bun HTTP-сервер + Preact SPA + Python-лабораторные джобы» без ущерба.

**Что НЕ применимо:**
- Tauri-упаковка — нам не нужна нативка. У нас статические HTML + Preact ядро (~425 строк) уже живут, следующий шаг — HTTP-сервер и настоящий SPA, не десктоп.
- Go TUI как второй фронт — избыточно для нашей команды из одного владельца.
- iOS Testflight — у нас есть требование к mobile, но через веб (страница адаптированная под телефон), а не через Testflight-бета.

---

## 3. Warren — по осям

**Позиционирование.** «Self-hostable control plane for ephemeral coding agents» — spawn'ит агентов, показывает live, разрешает steer'ить, отдаёт обратно branch. Это ровно тот класс инструментов, к которому мы хотим прийти сами.

**Стек — самый близкий к нашему.** `src/ui/package.json` живьём: React 18.3, Vite 6, Tailwind v4, `@tailwindcss/vite`, `@radix-ui/react-dialog`, `@radix-ui/react-label`, `@radix-ui/react-slot`, `@radix-ui/react-toast`, `@tanstack/react-query` 5.62, `class-variance-authority`, `clsx`, `tailwind-merge`, `framer-motion` 12.40, `lucide-react`, `react-router-dom` 7, `recharts` 3.8, `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`. Dev-время — TypeScript, `@vitejs/plugin-react`. Классический shadcn/radix-стек, с готовым дизайн-словарём и лёгким motion-слоем.

**Сервер** — `src/server/`, Bun/TypeScript. По содержимому каталогов видно:
- `router.ts` + `router.test.ts` — компиляция паттернов `"/runs/:id/events"` в regex и матчинг.
- `handlers/` — по хендлеру на ресурс: `runs.dispatch.ts`, `runs.events.ts`, `runs.pause-resume.test.ts`, `runs.finalize.test.ts`, `runs.preview-launch.test.ts`, `plan-runs.ts`, `projects.ts`, `agents.ts`, `alerts.ts`, `metrics.ts`, `meta.ts`, `diagnostics.ts`, `whoami.ts`.
- `stream-limits.ts` — ограничение на одно долгоживущее соединение (важно, чтобы не заDDOS'ить свою же control-plane).
- `bridges.ts`+`bridge-reconnect.ts` — server-side «мост» для восстановления клиентских соединений с backoff'ом.
- `idempotency.ts` — идемпотентность POST'ов (dispatch), тест `runs.dispatch-idempotency.test.ts`.
- `auth.ts` — bearer-token.
- `scheduler.ts`, `projection.ts` — событийная модель (event-sourcing над SQLite).

**Транспорт стрима.** Явно **NDJSON-over-HTTP**, не WebSocket. Клиент делает `GET /runs/:id/events?follow=1`, сервер держит соединение и льёт newline-delimited JSON, пока run не финализируется. Отдельного WebSocket-сервера в дереве нет (проверил `src/server/` — нет ни файла `ws.ts`/`websocket.ts`, ни зависимости от ws-либы в package.json). Reconnect делает клиент (стилистически похоже на EventSource-паттерн).

**Список публичных HTTP-эндпоинтов** (из README + структуры хендлеров): `GET /healthz`, `GET /readyz`, `GET /version`, `GET /whoami`, `POST /dispatch`, `GET /runs/:id`, `GET /runs/:id/events?follow=1`, `POST /runs/:id/steer`, `POST /runs/:id/cancel`, `POST /runs/:id/preview/login`, `POST /plan-runs`, `GET /analytics/cost`, `GET /metrics` (Prometheus exposition).

**Действия из UI (не только просмотр!):**
- **Dispatch** — выбрать агент в реестре (`claude-code`, `pi`, …), написать промпт, стартануть.
- **Steer mid-run** — POST-ом вбросить сообщение, которое агент прочтёт на следующем ходу. Не прерывает текущий turn, что важно для устойчивости.
- **Cancel** — clean abort.
- **Pause/Resume** — судя по тесту `runs.pause-resume.test.ts`.
- **Live tail** — по одному NDJSON-стриму на клиент.
- **PR-preview environment** — если в репо есть `.warren/preview.yaml`, Warren поднимает preview-окружение per-run и даёт URL с login-эндпоинтом.
- **Cost analytics** — `GET /analytics/cost`, значит есть UI-виджет со стоимостью запусков.

**Как решён вопрос «агент работает долго»** — NDJSON-стрим тянется всё время run'а; `stream-limits.ts` защищает бэкенд; `bridge-reconnect.ts` восстанавливает при разрыве; steer не блокирует; UI на Recharts может рисовать метрики поверх событий.

**Storage.** SQLite по умолчанию (`/data/warren.db`) со всем логом событий; опция PostgreSQL для оrg-scale. Событийная модель + `projection.ts` = event-sourcing поверх SQLite, что очень похоже на нашу текущую JSONL-модель, но с индексами.

**Auth.** `Authorization: Bearer $WARREN_API_TOKEN`, генерится `openssl rand -hex 32`, вставляется в UI один раз. TLS — на edge (Caddy / k8s ingress).

**Работа под Claude-подпиской — нет.** README прямо говорит: `ANTHROPIC_API_KEY=sk-ant-…` + `GITHUB_TOKEN=ghp_…`. Это структурная развилка: Warren платит API-ключами за то, чтобы быть чистым HTTP-контрольным-планом; AutoSK платит Tauri-упаковкой за то, чтобы жить на подписке через локальный CLI. Наш собственный веб должен либо (а) как AutoSK — быть локальным клиентом, который дергает уже залогиненный `claude`, либо (б) прямо взять OAuth-паттерн pi.

**Что применимо к нам (прямые заимствования):**
- **Стек фронта под копирку.** Vite + React 18 (или Preact-alias — у нас уже Preact) + Tailwind v4 + shadcn — это наиболее совпадающий с тем, что владелец назвал «Mastra Studio + Supabase» стиль.
- **NDJSON-over-HTTP как транспорт live-стрима.** Проще WebSocket'а, не требует upgrade-hop, тривиально проксируется через любой ingress, легко тестируется (тестовый корпус golden-responses в `__golden__/responses`).
- **Схема эндпоинтов** — прямая калька: `GET /runs/:id/events?follow=1`, `POST /runs/:id/steer`, `POST /runs/:id/cancel`. Уже думать не над чем.
- **stream-limits.ts + bridges** — паттерн защиты собственного control-plane. Пропишем сразу.
- **Идемпотентность POST'ов dispatch** — просто и обязательно.
- **Bearer-token как единственный уровень auth v1.** Не переусложнять.
- **SQLite как event-store** — рядом с текущими JSONL стоит рассмотреть SQLite (с WAL), особенно раз owner готов принять локальные скрипты на Python/Go.

**Что НЕ применимо:**
- Требование ANTHROPIC_API_KEY — не наш путь, работать должно по подписке.
- Docker/GKE deploy — избыточно, у нас однопользовательская локальная лаборатория.
- k8s-runtime — только `local` вариант нам актуален.

---

## 4. Overstory — по осям (archived 2026-05-28)

**Статус.** Read-only, репо помечено «духовным предшественником Warren». 1712 commits, MIT.

**Веб-интерфейс.** Был, `ov serve` на :7321. HTTP + WebSocket. Параллельно TUI-дашборд `ov dashboard` (Chalk/ANSI). Значит, автор двинулся от «HTTP + WS» в Overstory к «HTTP + NDJSON» в Warren — это важное направление эволюции: они **отказались от WebSocket в пользу NDJSON-over-HTTP** в новом проекте.

**Как спавнил Claude.** `claude -p --output-format stream-json`, NDJSON парсился в `ClaudeRuntime.parseEvents`. Опционально tmux-режим (`ov sling --no-headless`) как «escape hatch». Runtime-адаптеры на 11 платформ (Claude, Pi, Gemini, Aider, Goose, Amp, …) — это ценный урок абстракции над бэкендами.

**Иерархическая оркестрация.** Overstory был буквально тем, о чём спрашивал владелец в мандате — там есть уровень **над оркестратором**:

```
Orchestrator (multi-repo) → Coordinator (per-project)
  → Supervisor/Lead (depth 1) → Workers (Scout, Builder, Reviewer, Merger — depth 2)
```

Связь — через **custom SQLite mail system** (WAL mode, ~1-5 мс/запрос) с 8 типизированными сообщениями (`worker_done`, `merge_ready`, `dispatch`, …) и broadcast'ами (`@all`, `@builders`). FIFO merge-queue с 4-уровневым разрешением конфликтов. **Tiered watchdog:** Tier 0 — механический демон, Tier 1 — AI-triage, Tier 2 — monitor-agent.

**Storage.** SQLite (mail + merge queue + метрики), git worktrees per agent, файловый checkpoint/restore для «compaction survivability».

**Что применимо к нам:**
- **SQLite mail-bus между агентами** — прямая архитектурная альтернатива нашей текущей передаче через файлы и tmux `SendMessage`. Уменьшает latency, даёт транзакции и WAL.
- **Tiered watchdog** — механический-daemon → AI-triage → monitor-agent — красиво ложится на нашу «orchestrator-pulse-rule» и на текущие проблемы «оркестратор молчит».
- **Checkpoint/restore для compaction survivability** — прямо просится, у нас регулярно ломаются orchestrator'ы на пороге контекста.
- **NDJSON парсинг `claude -p --output-format stream-json`** — если мы делаем headless-worker и хотим полный event-stream (шаги, tool-calls, thinking), формат тот же.
- **Runtime-адаптеры на N платформ** — задел на будущее «работать не только с Claude».

**Что НЕ применимо / устарело:**
- WebSocket-транспорт (сам автор от него отказался в Warren).
- «tmux escape hatch» — у нас tmux уже основной, а не escape.
- Проект больше не поддерживается — брать целыми модулями нельзя, только паттерны.

---

## 5. Что устарело в наших прошлых исследованиях

Наши репорты `autosk-anatomy` и `autonomy-lab-ui` датированы ~2026-07-10; на 2026-08-03 живая картина расходится в двух местах.

1. **AutoSK помечен «frozen, 12 дней тишины».** Живой GitHub-скан сегодня показывает 397 commits на main (репорт видел меньше) и HEAD дальше `fd4c22e`. Возможно, автор что-то поменял, — но самые крупные ветки (freeze / bus-factor-1) остаются верны на уровне архитектуры: v0.2.4 всё ещё последний релиз в моих проверках. **Проверить надо только:** сдвинулась ли ветка, есть ли новые релизы. На архитектуру это не влияет.
2. **Warren в наших старых репортах отсутствует как самостоятельный объект.** Между 07-10 (autonomy-lab-ui) и сегодня Warren прошёл несколько релизов и сейчас на v0.13.1 «Stable, running on GKE in continuous use». То есть **основной сдвиг: у нас теперь появился рабочий, современный, живой референс собственного веб-контрольного-плана**. Это меняет вес: раньше AutoSK был единственный образец веба, сейчас Warren — гораздо более прямой шаблон под наш желаемый стек.
3. **Overstory в `orchestrator-landscape` есть, но он там ещё жив.** Он архивирован 2026-05-28 и явно указывает наследника — Warren. Это надо зафиксировать: цитировать Overstory как «пример иерархичной оркестрации», но не как «референс для внедрения».
4. **Наш собственный `autonomy-lab-ui` рекомендовал «static HTML в v1, интерактив в v2».** Это остаётся разумно, но **v2 теперь имеет живой шаблон** (Warren), а не только ASCII-мокапы. При планировании v2 конкретный HTTP-контракт можно писать не «с нуля», а от Warren'овских эндпоинтов.
5. **WebSocket vs NDJSON — эволюция автора.** Overstory (WS) → Warren (NDJSON-over-HTTP). Это внешний сигнал: не начинать с WebSocket. Наш собственный autonomy-lab-ui это тоже не рекомендовал, но теперь есть и живое подтверждение.

---

## 6. Идеи, которые стоит рассмотреть нам (конкретные приёмы)

Отсортировано по «переносится сразу» → «требует нашего решения».

### 6.1. Транспорт: NDJSON-over-HTTP как единственный live-стрим

Один эндпоинт `GET /runs/:id/events?follow=1` возвращает бесконечный newline-delimited JSON, где каждая строка — событие (`step.started`, `tool.called`, `question.raised`, `run.finished`). Клиент читает `ReadableStream` через fetch API (в Preact — тривиально). Reconnect делает клиент с backoff'ом. Плюсы: одно соединение на run, без upgrade-hop'ов, любые ingress/каддии прозрачны, тестируется golden-файлами. **Прямая калька из Warren.** Прямо годится для нашей текущей JSONL-модели: сервер — просто «tail-f поверх файла + фильтр по run_id + send через `Response(stream)`».

### 6.2. Идемпотентность POST'ов

Всё, что «начать что-то делать» (dispatch, ретрай, отправка ответа на question), обязано принимать `Idempotency-Key: <uuid>` и не создавать дубликат при повторе. У Warren это отдельный модуль (`idempotency.ts` + `runs.dispatch-idempotency.test.ts`). Без этого при плохой сети UI будет плодить дублирующие run'ы. Час работы, экономит день неприятностей.

### 6.3. Stream-limits + bridges для устойчивости

`stream-limits.ts` не даёт одному клиенту сожрать все соединения (например, из-за багованного reconnect'а). `bridges.ts`+`bridge-reconnect.ts` — server-side помощник для восстановления «своей стороны» соединения при рестарте демона. Небольшой код, но снимает целый класс «UI перестал получать события» инцидентов. Уместно **сразу**, не откладывать до v2.

### 6.4. Одна и та же событийная шина под всё

Warren: NDJSON-события, идущие в SQLite (`projection.ts`), — и есть источник дашборда, аналитики стоимости (`GET /analytics/cost`), и метрик (`GET /metrics` Prometheus). Один поток, три потребителя. Это в точности принцип нашего собственного `autonomy-lab-ui`: «Liveness derived from artifacts, not self-report». Warren доказал, что схема живёт и на прод-масштабе.

### 6.5. Freshness contract из AutoSK TUI — целиком

Push-нотификации → coalescing → adaptive poll fallback → spinner-only-when-running. Переносится напрямую в TS-клиент (~200 строк), сразу же убивает целый спектр «100%-CPU idle dashboard» багов, которые новички ловят на первом же большом транскрипте.

### 6.6. Sticky-tail транскрипта с intent preservation

Из AutoSK (`gui.go:1199-1318`, оценка `STEAL` в §6 нашего же autosk-anatomy): транскрипт открывается снизу, документы — сверху, автотэйл продолжается только если пользователь **уже был у низа**; ручной scroll-up никогда не «дёргается» обратно. Одна из самых заметных UX-мелочей.

### 6.7. Partials с первого дня

AutoSK Wave-2 наш же отчёт помечает `AVOID` — TUI не показывает partials assistant'а, потому что стрим-handler не имеет `case "partial"` (`jobdetail.go:225-241`). Даёт «мёртвый» дашборд посреди долгого turn'а. **Нам сразу с первого дня отрисовывать частичные ответы**, иначе пользователю кажется, что всё зависло.

### 6.8. Steer, а не interrupt

У Warren `POST /runs/:id/steer` — вбрасывает сообщение, которое агент прочитает **на следующем ходу**, не прерывая текущий. Это правильная модель для нашей архитектуры «оркестратор пишет teammate, teammate дочитает и продолжит». `cancel` — отдельный жёсткий эндпоинт. Не смешивать «hint» и «kill».

### 6.9. Preview per-run как отдельная идея

Warren по `.warren/preview.yaml` поднимает per-run окружение и даёт URL. У нас это ложится на «лабораторию»: run → отдельный worktree → отдельная preview-страница отчёта. Может быть vN, не v1.

### 6.10. OAuth-паттерн pi как страховка

Если Anthropic начнёт закручивать `claude -p` для подписки, у нас должен быть план Б. Прямой forward-порт `providers/anthropic.ts` + `ai/src/utils/oauth/anthropic.ts` (PKCE OAuth-флоу с `claude.ai/oauth/authorize`, кэш creds в `~/.<app>/auth.json`) — понятный, воспроизведённый чужой рабочей кодой. Держать в голове, не реализовывать до нужды.

### 6.11. SQLite как event-store — рассмотреть отдельно

Наши `docs/lab/events/*.jsonl` — уже событийная модель, но без индексов. SQLite (WAL) даёт: (1) быстрые фильтры по run_id/actor/type, (2) транзакционность (никаких «полу-записанных» событий), (3) единый bus для inter-agent сообщений (Overstory-паттерн). Локальный скрипт-миграция «JSONL → SQLite при чтении» ложится в TS без особых затрат. Обсудить с владельцем.

### 6.12. Отсутствие WebSocket — сознательное решение

Автор Warren (тот же человек, что делал Overstory на WS) осознанно съехал на NDJSON. Мы фиксируем: WS в v1 не планируем. Это простое, ясное «нет», которое сэкономит спор.

### 6.13. Отсутствие Tauri — сознательное решение

AutoSK доказал, что Tauri работает. Но Tauri тянет нативные сборки, TestFlight и десктопную установку. У нас цель — «браузер + мобильный веб», не десктоп. Referenced ради приёмов, не ради упаковки.

---

## 7. Мини-summary для оркестратора

**AutoSK** — красивая машина, живёт на подписке (лучший в трёх), но её веб — не браузерный, а Tauri; переносим приёмы (freshness contract, sticky-tail, partials, OAuth-паттерн pi), не архитектуру целиком.

**Warren** — прямой шаблон под наш будущий веб-контрольный-план: React 18 + Vite + Tailwind v4 + shadcn/radix + TanStack Query + Recharts, Bun HTTP-сервер, NDJSON-стримы, POST-действия (dispatch/steer/cancel/pause/resume), bearer-token, SQLite event-store. **Единственное «нет» — API-ключ Anthropic вместо подписки**; эту дельту закрываем моделью «локальный клиент дёргает уже залогиненный `claude`» + план Б в виде OAuth-паттерна pi.

**Overstory** — предшественник Warren, архивирован; из него мы забираем **SQLite mail-bus между агентами**, **иерархичный tiered watchdog**, и урок «WS → NDJSON». Целыми модулями брать нельзя.

---

**Пути к живым источникам, которые я читал:**
- `docs/reports/autosk-anatomy/index.html` (наш собственный, §1, §6, §7)
- `docs/reports/autonomy-lab-ui/index.html` (наш собственный, §04 UI, §02 Laboratory)
- https://github.com/wierdbytes/autosk — README и структура каталогов
- https://autosk.app/ — marketing site (проверенные Wave-2 верно якорят hero-копию `Hero.astro:20-25`)
- https://github.com/jayminwest/warren — README, `src/ui/package.json`, `src/server/`, `src/server/handlers/`
- https://github.com/jayminwest/overstory — README и структура (archived)

**Что я НЕ проверил и это оставляет открытые вопросы:**
- Живой код рендер-хендлера `runs.events.ts` в Warren — точная семантика finalize, backpressure, heartbeat-пингов внутри NDJSON. При принятии решения о нашем эндпоинте — стоит прочитать эти ~200 строк отдельно.
- Как именно Warren кодирует steer-сообщения в NDJSON и как агент их подхватывает (это может быть либо через переменную окружения, либо через файл в burrow'е). Не критично для нас на этом шаге, но полезно уточнить перед реализацией POST /steer.
- Свежие commits на AutoSK после 2026-06-28 — я видел цифру 397 commits суммарно, но не сверил, был ли новый релиз после v0.2.4. Не влияет на архитектурные выводы.
