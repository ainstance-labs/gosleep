# Обзор рынка веб- и десктоп-интерфейсов для agent-harness'ов

Дата: 2026-08-03. Автор: expert #2 (research panel), gosleep.
Область: инструменты того же класса, что gosleep — оркестраторы автономных
кодовых агентов с интерактивной оболочкой. AutoSK и Warren разбирает эксперт #1
и намеренно не включены.

Все факты — со ссылками на первоисточник (репо / документация / профильные
разборы). Где явно не нашёл — «не найдено».

---

## 1. Сводная таблица

| Инструмент | Frontend | Backend / язык | Транспорт live | Локально/облако | Основные UI-действия | Наблюдаемость хода агента | Вес установки |
|---|---|---|---|---|---|---|---|
| **OpenHands** (ex OpenDevin) | React 19 + Vite + React Router 7, TS | FastAPI (Python) | WebSocket + REST | Локально (Docker) или облако | Запуск/стоп разговора, чат, файлы, bash, VSCode-панель | Live-события через WS, встроенный VSCode | Docker, тяжёлый |
| **Cursor Agents / Cloud** | Собственный Electron IDE + PWA на cursor.com/agents | Проприетарно | Стриминг (не раскрыт) | Гибрид: локальный IDE + облачные worktrees/VM | Создать/переименовать до 8 параллельных агентов, редирект, PR-хендофф | Логи, лист изменений, кнопки accept/reject hunks | Инсталлер IDE |
| **Devin** (Cognition) | Web-панель + десктоп-клиент | Проприетарный VM/gRPC | gRPC / WebSocket (<50 ms) | Только облако (Ubuntu VM per session) | Чат, стрим терминала/редактора/браузера, follow-up | Три параллельных стрима — терминал, редактор, браузер | Клиент + подписка |
| **Goose** (Block) | Electron + React (переходит на Tauri) | Rust (`goosed`) | HTTP + WebSocket | Локальный демон + десктоп | Чат, extensions, run/stop, ACP-протокол | Стрим шагов, панель extensions | Инсталлер + Rust-демон |
| **Cline** (VSCode ext.) | React + Vite + Tailwind, HeroUI/Radix в WebView | Node.js extension host | gRPC-over-postMessage (VS Code webview) | Локально в IDE | Approve/deny per-tool, edit-in-place, streaming текст, XML-tools | «Generative UI», стриминг мыслей, tool-timeline | VS Code + ext |
| **Roo Code** (fork Cline, ARCHIVED май 2026) | Vite + React + TS + Tailwind, Zustand | Node + Express | postMessage / гRPC | Локально в IDE | Multi-mode (Architect/Code/Debug/Ask/Orchestrator) | Как Cline | VS Code + ext |
| **Continue.dev** | React WebView | Layered core (JS/TS) для VSCode / JetBrains / CLI | Webview Protocols + pass-through message list | Локально в IDE | Chat, Agent, tools, tool-approve | Timeline тулколов | Ext |
| **Zed Agent Panel** | Родной GPUI (Rust) | Zed (Rust) | Внутренний бас Zed | Локально в IDE | Inline assist (Ctrl+Enter), accept/reject hunk, edit diffs | Inline-diff в файлах, «file × lines» summary | Zed бинарь |
| **Warp Agent Mode** | Родной GPU-терминал (Rust) | Warp cloud + local | Внутренний | Гибрид | Approve/deny команд, prompt-queueing, redirect | Chat + чекпойнты, лог команд | Терминал |
| **Aider `--browser`** | Streamlit (Python) | Aider CLI (Python) | Streamlit re-run + polling | Локально | Чат, diff, git-commit ревью, model switch | Каждый шаг = git commit | pip |
| **SWE-agent inspector** | HTML/JS static | Python CLI (`sweagent inspector`) | Локальный статический сервер | Локально, оффлайн | Навигация по шагам (h/l), toggle детализации (v) | Trajectory как TAO-триплеты (thought, action, observation) | pip |
| **Claude Code (CLI + web + mobile)** | claude.ai/code — Next.js (Anthropic proprietary) | Cloud sandbox | Стриминг + push через `--channels` | Локальный CLI + облачные task'и + iOS/Android push | Prompt, approve/deny, schedule, PR handoff | Timeline шагов в web, push на телефон | CLI + web-аккаунт |
| **OpenAI Codex CLI + Web** | Веб-панель на chat.openai.com + IDE-ext | Cloud runners | Стриминг + PR-хендофф | Гибрид (CLI local + cloud tasks) | Три approval level (Suggest/Auto Edit/Full Auto), delegate to cloud, PR merge | Список тасков, логи, дифы | CLI + подписка |
| **LangGraph Studio** | React SPA + desktop-обёртка (Mac/Linux) | LangGraph server (Python) | HTTP + стриминг event'ов через LangSmith | Локально (self-hosted) или SaaS | Trigger invocation, thread-time-travel, edit state | Граф + node-level trace + token/latency per node | pip + Studio-desktop |
| **Sculptor** (Imbue) | Mac-десктоп (нативный) | Docker-контейнеры per workspace | Внутренний | Локально | Pairing Mode (sync workspace ↔ репо), diff-view, per-agent workspace | Отдельный workspace, terminal, diff-view для каждого | .app |
| **Conductor** (Melty Labs) | Mac-десктоп (нативный) | Git worktrees + Claude/Codex CLI | Внутренний | Локально | Assign task, review diff, create PR | Дашборд многих агентов, diff-first | .app free |
| **Claude Squad** | Bubble Tea TUI (Go) | tmux + git worktrees | tmux pane pipe | Локально, TUI | Список инстансов, jump, kill | Каждый агент в pane, статус | Go бинарь |
| **Crush** (Charm) | Bubble Tea v2 TUI (Go) | Go, pubsub-broker | Внутренний | Локально, TUI | Chat, sub-task delegation, MCP-tools | pubsub → tea.Msg events | Go бинарь |
| **OpenCode** (Anomaly) | Bubble Tea TUI (Go) | Go server (client/server арх.) | Внутренний / нет web порта | Локально, TUI | Chat, agents sidebar, permission rules | agents-sidebar, permission events | Go бинарь |
| **vibe-kanban** (Bloop, shutdown апр 2026, OSS-continued) | React frontend (Node) | Rust + SQLite (SQLx) | Локальный HTTP + polling | Локально, открывает браузер | Kanban для CLI-агентов, per-task worktree, ветки | Kanban-колонки состояний, live-логи | `npx`-style CLI |
| **agent-dashboard** (bjornjee) | Bubble Tea TUI (Go) + PWA (Node, порт 8390) | Go, читает `~/.agent-dashboard/agents/*.json` + tail JSONL | file-watcher + HTTP (PWA-порт) | Только локально; PWA доступна с телефона в той же сети | Reply, approve/reject, jump-to-pane, view diff, open PR, stop | Парсит транскрипты Claude Code JSONL, статусы blocked/waiting/running/done/PR/merged, token cost, plan+mermaid viewer, push-notif | `git clone` + `make web` |
| **amux** (mixpeek) | Vanilla HTML/CSS/JS + PWA (service-worker) — всё в одном файле | **Один Python-файл** `amux-server.py` + SQLite + tmux | **SSE** (fallback polling) | Локальный HTTPS-сервер, PWA-inst на iOS/Android | Start/stop, send text, approve tool, peek scrollback, claim board task, redirect, archive/restart | Live-terminal peek на карточках, full scrollback + search, ANSI-strip pane parse, per-session token spend, self-heal watchdog (context compact, crash, rate-limit) | pipx/brew, zero deps beyond `python3` + `tmux` |
| **Agent Inbox** (LangChain) | React (open-source, self-deploy) | LangGraph deployment | HTTP + polling (LangSmith interrupts) | Локально или облако | Список interrupts, approve/deny/edit-args, resume graph | Durable pause, thread survives refresh, видна всем компонентам | pip + npm |
| **CopilotKit + AG-UI** | React (chat/sidebar/popup + generative UI) | AG-UI-совместимый агент | **AG-UI: SSE или WebSocket** (стандартизированные события `TEXT_MESSAGE_*`, `TOOL_CALL_*`, `STATE_SNAPSHOT`) | Локально или SaaS | `useHumanInTheLoop`-хук, streaming-текст, frontend tools, стейт-снепшоты | Событийный поток шагов + tool-lifecycle events | npm пакет |
| **Ralph loop / meta-harness** | **Нет UI** (файлы + tail) | Shell + любой агент | Файловая система | Локально | Редактировать prompt-файл, tail лог | `tail -f`, `git log`, файлы на диске | ~50 строк bash |
| **Cognition-класс: gptme / SWE-rex / Herdr / dmux** | TUI или tmux-обёртки | Разное | tmux pipe / stdin | Локально | Как Claude Squad | Экран tmux | Скрипт |

Источники таблицы перечислены разделом ниже; для колонок «наблюдаемость» и
«действия» — прежде всего deepwiki-разборы, README на GitHub, официальные docs.

---

## 2. Три-четыре доминирующих паттерна на рынке

Собранные 20+ инструментов группируются в четыре повторяющиеся архитектурные
формы. Ниже — в порядке распространённости.

### Паттерн A — «IDE-extension WebView»
> Cline, Roo Code, Continue.dev, Zed Agent Panel, Cursor.

Frontend — React (или родной GPUI у Zed), поставляется как расширение IDE.
Транспорт — `postMessage` / внутренние шины IDE, поверх — свои envelope-протоколы
(Cline завернул всё в gRPC-over-postMessage; Continue — двунаправленные
pass-through-каналы Webview ↔ Core). Один документ — одна WebView; агент бежит в
хост-процессе расширения. Плюсы: живёт рядом с редактором, интервенция через
approve-hunk работает в родном UX. Минусы: намертво привязан к IDE и одному
воркеру. Для параллельных агентов IDE-паттерн сам по себе не решает — оттого
Cursor и Roo прикручивают отдельную «agents window» / cloud-panel сверху.

### Паттерн B — «Локальный демон + браузерный SPA»
> OpenHands, vibe-kanban, amux, agent-dashboard (PWA-часть), Aider `--browser`,
> LangGraph Studio (self-hosted), Agent Inbox.

Отдельный процесс (Rust / Python / Go / Node) слушает `localhost`, статика
собранного SPA (React/Vite или vanilla HTML/JS) отдаётся тем же процессом,
живые события — WebSocket (OpenHands), SSE (amux, AG-UI по умолчанию), polling
(Aider Streamlit, LangGraph). Ставится через `pipx / brew / npx / go install`.
PWA-надстройка (amux, agent-dashboard) позволяет добавить иконку на телефон и
получать push-уведомления в той же локальной сети — без облака.
**Это ближайшая к gosleep форма.**

### Паттерн C — «Десктоп-приложение / Electron / нативное Mac»
> Goose (Electron → Tauri), Sculptor, Conductor, Devin desktop client,
> LangGraph Studio desktop.

Отдельная .app с собственным окном, внутри — либо Electron+React, либо Tauri,
либо родной SwiftUI. Backend — локальный демон или облачный VM. Плюсы:
управление жизненным циклом (autostart, tray-иконка), нативные уведомления.
Минусы: требуется билд/подписка/дистрибуция; исходники обычно проприетарны
(Conductor, Devin, Sculptor); Electron тяжёл (Goose как раз мигрирует на Tauri
именно за этим).

### Паттерн D — «TUI-мультиплексор + опциональная веб-надстройка»
> Claude Squad, Crush, OpenCode, agent-dashboard TUI, Herdr, dmux, ntm, gptme.

Bubble Tea (Go) — де-факто стандарт TUI-фреймворка в этом сегменте. Каждый агент
живёт в отдельном tmux-пейне или Docker-контейнере, git-worktree разделяет
файлы. Веб-часть либо отсутствует (Crush, OpenCode), либо приделана поверх
как PWA к тому же state store (agent-dashboard, amux). Установка — один Go-бинарь.
Наблюдаемость сводится к «переключись на нужный pane».

### Паттерн E (нишевый, но идейно важный) — «Meta-loop без UI»
> Ralph Wiggum, ZeroSync-style, «tail-a-file»-подходы.

UI отсутствует по идеологии: одна папка `prompts/`, один бесконечный shell-луп,
`git log` как история, `tail -f` как мониторинг. Демонстрирует, что интерактивный
web-UI — **не обязателен** для автономных длинных запусков; но именно с этим
паттерном чаще всего связаны жалобы «оно 10 минут молчит».

### Транспорт для живых обновлений — что победило
- **SSE** — новый де-факто стандарт для «агент → фронтенд»: закреплён в
  протоколе **AG-UI** (CopilotKit + LangGraph + CrewAI + Mastra), реализован в
  amux, поддержан в OpenAI Responses.
- **WebSocket** — там, где нужна двусторонность (OpenHands, Goose, Devin, Cursor
  cloud).
- **postMessage / gRPC-over-postMessage** — только в IDE-расширениях.
- **Polling / file-watcher** — только в TUI-first решениях (agent-dashboard TUI
  читает JSONL напрямую) и в Streamlit-обёртке Aider.

### Наблюдаемость длинного хода — что реально работает
1. **Live-terminal peek на карточке**: amux и agent-dashboard показывают
   последние N строк tmux-пейна прямо на сессия-карточке — самый честный «что
   агент делает сейчас».
2. **Timeline тулколов** (Cline, Zed, LangGraph Studio, agent-observability
   стек Langfuse/Honeycomb/LangSmith): TAO-триплеты, parent/child span'ы,
   иерархия sub-agent'ов.
3. **Статусы, извлечённые из транскрипта** (agent-dashboard): парсинг JSONL
   Claude Code → blocked / waiting / running / review / PR / merged.
4. **Три параллельных стрима** (Devin): терминал + редактор + браузер в одном
   окне, latency <50 ms.
5. **Push-notif на телефон** (amux PWA, agent-dashboard, Claude Code
   `--channels`, коммьюнити-решения через `ntfy.sh`) — не даёт «застрять» вслепую.

### Мид-флайт вмешательство — рынок сходится на 4 глаголах
Хорошая формализация — из Hermes/Nous и OpenCode issue-tracker'ов, повторяется в
Warp docs:
- **interrupt** — послать сообщение, оно прерывает цикл и агент отвечает;
- **/queue** — сообщение улетит после текущего хода;
- **/bg (или /btw)** — параллельная реплика, не трогает основной цикл;
- **/steer** — вставить guidance в результат следующего тулкола, не прерывая
  цикл (уязвимо к prompt-injection защите модели — известная проблема).

Из UI это обычно inline-инпут в чате + чипы «steer / queue / interrupt».

### Approve-flow (permission prompts)
- **Trio Allow / Deny / Always** — Cline, OpenCode, Claude Code CLI, Warp.
- **Событийная очередь approval'ов** (Agent Inbox от LangChain,
  OpenCode Permission Events, amux) — устойчива к refresh'у, читается с телефона.
- **Push+deep-link на телефон** — Claude Code `--channels`, коммьюнити
  `ntfy.sh`-хуки поверх OpenCode/Claude Code.
- **Auto-allow patterns** — Claude Code `--allowedTools`, OpenCode rules
  (например, whitelistим `git status*`).

---

## 3. Что из этого подходит нам

Ограничения gosleep из брифа:
- обязателен TypeScript-стек;
- всё локально на машине владельца, без облака;
- данные — JSONL-файлы в git-репозитории;
- генератор HTML на Python уже есть (docs/lab/site/*.html).

### Прямые аналоги (тот же класс задачи)
Три инструмента ближе всего по замыслу и ограничениям, у них можно грубо копировать
архитектуру:

1. **amux** (`mixpeek/amux`, MIT). Единственный файл `amux-server.py`, PWA
   поверх, SSE для live-обновлений, self-heal watchdog, board на SQLite. Именно
   так делается «локальный control plane на телефоне без облака». Слабое место
   для нас — Python; но идеи (SSE, PWA-manifest, service-worker для оффлайна,
   live-peek scrollback на карточке, per-session token spend) прямо переносимы.
2. **agent-dashboard** (`bjornjee/agent-dashboard`, MIT). TUI на Bubble Tea +
   отдельная **PWA на Node** (`make web` на порту 8390). Читает JSONL Claude Code
   и derived-JSON per-agent из `~/.agent-dashboard/agents/`. Это точный аналог
   нашей ситуации: файлы в репозитории → live-панель. Инженерия минимальная,
   потому что frontend просто читает уже существующие файлы (та же модель, что
   уже у нас: JSONL + сгенерированный HTML).
3. **vibe-kanban** (OSS-continued после закрытия Bloop). Node-фронт + Rust-бек,
   но паттерн «kanban для агентов, каждая карточка = ветка + worktree»
   применим 1-в-1 к нашим epic'ам.

### Что ещё стоит подсмотреть
- **AG-UI** (CopilotKit) — как протокол событий. Если делаем свой транспорт
  между Python-генератором и TypeScript-фронтом, `AG-UI SSE` избавит от изобретения
  своей схемы событий и даст готовые типы `TEXT_MESSAGE_*` / `TOOL_CALL_*` /
  `STATE_SNAPSHOT` — тестировано на LangGraph, CrewAI, Mastra, Agno.
- **Agent Inbox** (LangChain, open source) — если нам понадобится очередь
  approve/deny, готовый паттерн «список interrupts + reply» уже есть.
- **claude-code-viewer** (`d-kimuson/claude-code-viewer`, TS/Node) и
  **clog** — прямые «tail JSONL → браузер» решения на нашем стеке; полезно как
  референс кода.

### Рекомендуемая форма для gosleep (моё мнение как эксперта)
- **Паттерн Б**, локальный демон + SPA, **не Electron**.
- **Backend**: маленький TS-сервер (Fastify или чистый `node:http`), читает
  существующие JSONL из `docs/lab/events/*.jsonl` и `docs/lab/supervision/*.jsonl`
  file-watcher'ом (`chokidar` или `fs.watch`), пушит diff-события через **SSE**
  на клиента. SSE достаточен: у нас нет двусторонности (все команды владельца
  сейчас идут через терминал/tmux/файлы).
- **Frontend**: Vite + React + TS. Существующие HTML-страницы (cost, fleet,
  index, library, questions, tasks, timeline) остаются как «server-rendered»
  первый экран, JS-часть подписывается на SSE и патчит DOM. Мигрируем
  постепенно, не переписывая генератор.
- **Мобилка**: PWA-манифест + service worker (как amux). Ставится «Add to Home
  Screen». Никакого облака.
- **Наблюдаемость длинного хода**: скопировать формулу amux/agent-dashboard —
  на каждой карточке worker'а последние N строк output'а из его pane или
  transcript'а, обновляемые через SSE в реальном времени.
- **Действия из UI (первая версия — узкий набор)**: (а) отправить сообщение в
  pane (запись в очередь, tmux-hook читает), (б) approve/deny стандартных
  permission-prompts, (в) переключить активную задачу. Всё остальное пусть
  пока делает терминал.
- **Push на телефон**: локальный `ntfy` в сети владельца или Web Push через
  service worker; без внешнего облака.

Что **не подходит**:
- Electron (Goose уже уходит от него — оверхед не оправдан).
- Rust-backend (amux и Warp классные, но мы под TS и не готовы держать
  два языка).
- Только TUI (мы уже это доказали внутри — владелец видит «Searching…» и
  молчание).

---

## Источники

- OpenHands: [DeepWiki React app structure](https://deepwiki.com/OpenHands/OpenHands/10.1-development-environment-setup), [SDK arch overview](https://docs.openhands.dev/sdk/arch/overview), [SDK paper (arxiv)](https://arxiv.org/html/2511.03690v1).
- Goose: [DeepWiki install & setup](https://deepwiki.com/block/goose/2-installation-and-setup), [Goose 2.0 beta blog](https://goose-docs.ai/blog/2026/04/08/goose-acp-and-new-tui/).
- Cline: [DeepWiki WebviewProvider](https://deepwiki.com/cline/cline/2.4-webviewprovider), [Cline breakdown — Dwarves](https://memo.d.foundation/breakdown/cline).
- Roo Code: [Qodo review](https://www.qodo.ai/blog/roo-code-vs-cline/), [Frontman comparison](https://frontman.sh/blog/roo-code-vs-cline/).
- Continue.dev: [DeepWiki system arch](https://deepwiki.com/continuedev/continue/2.1-system-architecture), [Agent mode docs](https://docs.continue.dev/features/agent/how-it-works).
- Zed: [Agent Panel & UI](https://deepwiki.com/zed-industries/zed/8.1-agent-panel-and-ui), [Inline assistant docs](https://zed.dev/docs/ai/inline-assistant).
- Warp: [Agent Mode](https://www.warp.dev/ai), [Prompt queueing](https://docs.warp.dev/agent-platform/local-agents/interacting-with-agents/prompt-queueing/), [Terminal and Agent modes](https://docs.warp.dev/agent-platform/local-agents/interacting-with-agents/terminal-and-agent-modes/).
- Aider: [Streamlit browser mode issue](https://github.com/Aider-AI/aider/issues/595), [Sandbox analysis](https://agent-safehouse.dev/docs/agent-investigations/aider).
- SWE-agent inspector: [Docs](https://swe-agent.com/latest/usage/inspector/), [mini-traj-web-browser](https://github.com/SWE-agent/mini-traj-web-browser).
- Claude Code web: [Claude Code on the web docs](https://code.claude.com/docs/en/claude-code-on-the-web), [Anthropic blog](https://claude.com/blog/claude-code-on-the-web), [Builder.io updates recap](https://www.builder.io/blog/claude-code-updates).
- OpenAI Codex: [CLI vs Claude Code 2026](https://blakecrosley.com/blog/codex-vs-claude-code-2026), [OpenAI Codex CLI guide](https://www.codegateway.dev/en/blog/openai-codex-cli-complete-guide-2026), [Wikipedia](https://en.wikipedia.org/wiki/OpenAI_Codex_(AI_agent)).
- Devin: [Fastio deep dive](https://fast.io/resources/devin-software-engineer/), [Docs intro](https://docs.devin.ai/get-started/devin-intro), [DevinAI-agent client repo](https://github.com/DevinAI-agent/devin-AI).
- LangGraph Studio: [First agent IDE](https://www.langchain.com/blog/langgraph-studio-the-first-agent-ide), [Observability in Studio](https://docs.langchain.com/langsmith/observability-studio).
- Sculptor: [Announce](https://imbue.com/blog/sculptor-announce), [Product page](https://imbue.com/product/sculptor), [GitHub](https://github.com/imbue-ai/sculptor).
- Conductor: [Made-with-love review](https://madewithlove.com/blog/conductor-running-multiple-ai-coding-agents-in-parallel/), [CodePick guide](https://codepick.dev/en/guides/conductor-build-intro/).
- vibe-kanban: [VirtusLab blog](https://virtuslab.com/blog/ai/vibe-kanban), [BrightCoding review](https://www.blog.brightcoding.dev/2026/04/19/vibe-kanban-10x-your-ai-coding-agent-output).
- Cursor cloud/agents: [Cursor blog «Agent on web»](https://cursor.com/blog/agent-web), [Changelog 2.0](https://cursor.com/changelog/2-0), [Learn Cursor agents-window](https://www.learncursor.dev/learn/cursor-agents/agents-window).
- Claude Squad: [smtg-ai/claude-squad](https://github.com/smtg-ai/claude-squad), [DEV review](https://dev.to/stevengonsalvez/claude-squad-run-multiple-ai-agents-in-parallel-without-the-mess-1hfl).
- Crush: [DeepWiki architecture](https://deepwiki.com/charmbracelet/crush/5.1-tui-architecture-and-appmodel).
- OpenCode: [TUI docs](https://opencode.ai/docs/tui/), [Permissions docs](https://opencode.ai/docs/permissions/), [Agents-sidebar](https://github.com/Mark1708/opencode-agents-sidebar).
- agent-dashboard: [GitHub](https://github.com/bjornjee/agent-dashboard), [Home page](https://bjornjee.github.io/agent-dashboard/).
- amux: [GitHub](https://github.com/mixpeek/amux), [Multi-agent orchestrators 2026](https://amux.io/blog/best-multi-agent-orchestrators-2026/).
- CopilotKit / AG-UI: [ag-ui protocol repo](https://github.com/ag-ui-protocol/ag-ui), [Overview docs](https://docs.ag-ui.com/introduction), [CopilotKit README](https://github.com/CopilotKit/CopilotKit).
- Agent Inbox (LangChain): [GitHub](https://github.com/langchain-ai/agent-inbox), [Ambient agents blog](https://www.langchain.com/blog/introducing-ambient-agents).
- Ralph loop: [Original blog (Geoffrey Huntley) via Codecentric explainer](https://www.codecentric.de/en/knowledge-hub/blog/the-ralph-wiggum-loop-autonomous-code-generation-with-a-fresh-context), [ZeroSync deep-dive](https://www.zerosync.co/blog/ralph-loop-technical-deep-dive), [Alteredcraft essay](https://writing.alteredcraft.com/p/the-ralph-wiggum-agent-loop-is-really).
- Мид-флайт steering: [Warp prompt queueing](https://docs.warp.dev/agent-platform/local-agents/interacting-with-agents/prompt-queueing/), [Claude Code real-time steering issue](https://github.com/anthropics/claude-code/issues/30492), [Hermes 4 ways-to-message](https://x.com/Teknium/status/2048232396924088713), [OpenCode queued messages issue](https://github.com/anomalyco/opencode/issues/16102).
- Permission prompt UX: [OpenCode permissions](https://opencode.ai/docs/permissions/), [OpenCode permission events → mobile queue](https://codeongrass.com/blog/opencode-permission-events-mobile-approval-queue/), [Claude Code mobile approval system](https://dev.to/coa00/how-i-built-a-mobile-approval-system-for-claude-code-so-i-can-finally-leave-my-desk-1ida).
- Claude Code transcript viewers на нашем стеке: [claude-code-viewer](https://github.com/d-kimuson/claude-code-viewer/), [claude-code-trace](https://github.com/delexw/claude-code-trace), [clog](https://github.com/HillviewCap/clog).
- Общий обзор рынка: [andyrewlee/awesome-agent-orchestrators](https://github.com/andyrewlee/awesome-agent-orchestrators), [amux — Best AI agent multiplexers 2026](https://amux.io/guides/best-ai-agent-multiplexers-2026/).

---

Файл готов к передаче в панель. Ни строки кода не менял, только этот findings-файл создал.
