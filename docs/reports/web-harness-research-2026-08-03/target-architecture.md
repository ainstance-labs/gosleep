# Целевая архитектура интерактивного веб-harness (единый проект, редакция 2)

**Автор:** архитектор web-harness (agent), gosleep.
**Дата:** 2026-08-03. **Редакция 2** — переработана под новые вводные владельца: **БД = источник правды**, старое и новое разграничить, аутентификация — исследовать варианты, сервер — конкретика и правильное имя.
**Для:** владельца, Roman L. Простыми словами.
**Не коммитить.** Рабочий документ разговора.

**Опорные материалы:**
- `findings/autosk-warren-ui.md`, `findings/harness-landscape-ui.md`, `findings/our-constraints.md` (в этой же папке).
- `redteam-verdict.md` — критика, «держится» и забытые работы.
- Свежее веб-исследование этой итерации (Drizzle vs Kysely vs Prisma; Hono vs Elysia; Warren на GitHub; gh CLI + macOS Keychain; VS Code Remote Tunnels device-flow) — ссылки в конце документа.

**Отменено владельцем и не тащим из предыдущих версий:**
- «Файлы в git — источник правды, SQLite — производная проекция». **Инвертировано:** БД — источник правды, файлы становятся историческим импортом.
- «Не спрашивать варианты аутентификации» — теперь именно варианты и рекомендация.

---

## Раздел 1. Итог рекомендаций одной страницей

| Ось | Выбор | Что заменяет / отменяет |
|---|---|---|
| Рантайм ядра | **Bun 1.2+** (нативный `bun:sqlite`, TypeScript-runtime без транспилятора, `Bun.serve`, `bun build --compile` для мобильного бинаря в перспективе) | Не Node/Fastify, не Deno. Обоснование в разделе 3. |
| HTTP-фреймворк | **Hono 4.x** (стандарт де-факто в Bun-экосистеме, ~38 M weekly download, portable Bun/Node/edge, `streamSSE` из коробки) | Не голый `Bun.serve` (как у Warren — там один разработчик, у нас нельзя), не Elysia (уже, экосистема меньше), не Fastify. Сравнение в 3.2. |
| ORM + миграции | **Drizzle ORM + drizzle-kit** (нативный `bun:sqlite`, миграции — plain `.sql` в git + snapshot.json + журнал, forward-only + reverse-migrations руками). Ровно тот же выбор, что у **Warren**. | Не Prisma (тяжёлая, лишний генератор), не Kysely (только query-builder, миграции пришлось бы прикручивать отдельно), не raw SQL миграции руками. Обоснование в 4.2. |
| Хранилище | **SQLite (WAL)** в `data/gosleep.db` (вне git); **периодические snapshot'ы** (`sqlite3 .backup`) в `data/snapshots/*.db` под 0600. | Не PostgreSQL (overkill для локального однопользовательского), не файлы-JSONL как источник правды (владелец отменил). |
| Веб-клиент | **React 19 + Vite 6 + shadcn/ui + Tailwind v4 + TanStack Query v5 + react-router v7 + Recharts + Framer Motion + lucide-react** (стек 1:1 с Warren) | Не Preact-SSG (владелец отверг), не Next.js (не нужен SSR/edge). |
| Аутентификация | **Слоями (defense in depth):** (1) Bearer-token в macOS Keychain через `security`-CLI, (2) обязательный **TouchID-жест** внутри `publish.sh` и других write-endpoint'ов с большим blast'ом, (3) `withTimeline`-аудит. Разбор всех 7 рассмотренных вариантов и таблица «что защищает / что не защищает / стоимость» — в разделе 7. | Не «токен в plaintext-файле 0600» как единственный слой, не OAuth device-flow (нет внешнего IdP), не mTLS (overkill). |
| Название компонента ядра | **`gosleep-core`** — короткое, стандартное отраслевое (Mastra Core, tRPC Core, LangGraph Core). Файлы: `apps/core/`. В документах роль называется «control plane» (термин Warren'а). | Не «daemon» (unix-style, устарел), не «warrend»-стиль с суффиксом `d`, не абстрактное «server». |
| Раскладка каталогов | **Monorepo Bun-workspaces:** новое живёт в `apps/core`, `apps/web`, `packages/schema`, `packages/sdk`. Старое остаётся в **`tools/lab/`** без изменений до финального переключения (шаг 8). | Не «legacy/»-папка (миграция всего конвейера — риск), не смешивание в `tools/`. Три варианта раскладки и рекомендация — в разделе 5. |
| Живые обновления | **SSE (Server-Sent Events)** через `GET /events?since=<seq>` с обязательным `Last-Event-ID` и `event: rotate` при UTC-смене. | Не WebSocket (Warren осознанно отказался), не long-poll. |
| Первая write-кнопка | **«Опубликовать скилл»** через `POST /actions/skills/publish` → spawn `tools/skills/publish.sh` → env-secret + TouchID-жест. | Готовый шаблон Warren'а `POST /dispatch`. |

**Первая кнопка от нуля — 15-18 дней. Полный v1 — 30-38 дней одному воркеру** с honest buffer +40% (см. раздел 11).

**Главный нерешённый риск:** двойной период (шаги 4-8 миграции), когда `tools/lab/*.sh`-скрипты продолжают писать в JSONL, а ядро зеркалит их в SQLite. Одна секунда рассинхронизации = потерянное событие, пока индексатор не догонит tail. Смягчение и разбор в разделе 12 R16.

---

## Раздел 2. Общая картина: ядро (core) — клиенты — БД

Читаем стрелки: `→` — пишет; `⇒` — подписан на; `···` — периодически.

```
┌── ГЕНЕРАТОРЫ ФАКТОВ (агенты, хуки, лаборатория) ──────────────────────────┐
│                                                                            │
│  Claude Code hooks ──→ lab-log-hook.sh (fail-open shim) ─→ lab-log.sh      │
│  Агенты ─→ lab-emit.sh (question/answer/decision/…)                       │
│  poll-fill.py (reconcile git/gh/Jira) ─→ lab-log.sh (--src=poll-fill)     │
│  heartbeat.sh, watchdog.sh, tick.sh ─→ супервизионные append-only         │
│                                                                            │
│  ПЕРЕХОДНЫЙ ПЕРИОД (шаги 3-8):                                             │
│    ЖИВОЕ ПИСЬМО в docs/lab/**/*.jsonl (как сегодня) +                      │
│    tail-индексатор ядра mirror'ит в SQLite инкрементально.                 │
│  ПОСЛЕ ПЕРЕКЛЮЧЕНИЯ (шаг 8):                                               │
│    Новый unified CLI `gosleep emit …` пишет НАПРЯМУЮ в SQLite,             │
│    JSONL становятся производными «архивами» (по желанию),                  │
│    хуки Claude Code продолжают работать через тот же CLI.                 │
└────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌── gosleep-core (новый Bun-процесс на 127.0.0.1:7331) ──────────────────────┐
│                                                                             │
│  РОЛЬ 1 — HTTP+SSE API. Hono роутер, Bearer + Origin/Host guards,          │
│    zod-валидация, streamSSE. Один эндпойнт на ресурс                       │
│    (см. раздел 3.3).                                                        │
│                                                                             │
│  РОЛЬ 2 — ИНДЕКСАТОР (переходный, шаги 3-7). tail'ит                       │
│    docs/lab/{events,questions,decisions,supervision}/**/*.jsonl,           │
│    INSERT OR IGNORE в SQLite. Управляется таблицей ingest_state.           │
│    При sha256-mismatch первых 4 КБ файла — auto-rebuild.                   │
│                                                                             │
│  РОЛЬ 3 — АГРЕГАТОР ИЗ SQLite. Query'ит через Drizzle, отдаёт              │
│    типизированные проекции клиенту. `render_bundle.json` продолжает        │
│    писать `chronicler.py` (для mobile/README.md и старых читателей),      │
│    но ядро отдаёт актуальнее — прямо из SQLite.                            │
│                                                                             │
│  РОЛЬ 4 — ИСПОЛНИТЕЛЬ ДЕЙСТВИЙ (POST). Всегда через                       │
│    withTimeline(intent → spawn CLI → outcome). Spawn'ит tools/skills/     │
│    publish.sh, tools/lab/lab-emit.sh, tools/lab/tick.sh, chronicler.sh.    │
│    После успеха — dual-write: SQLite (напрямую) + существующий CLI         │
│    (для сохранения JSONL-совместимости в переходный период).                │
│                                                                             │
│  РОЛЬ 5 — SSE-РАЗДАТЧИК. LISTEN на новые INSERT в events через             │
│    triggers + notify-канал (in-process EventEmitter), рассылает подписан-  │
│    ным клиентам. UTC-day rotation остаётся семантической (day='2026-…').   │
│                                                                             │
│  Безопасность: bind 127.0.0.1, Bearer из Keychain, Origin/Host, per-       │
│  endpoint concurrency=1, persistent idempotency, env-secret в spawn,       │
│  TouchID-жест внутри publish.sh (и в дальнейшем любых high-blast).         │
└─────────────────────────────────────────────────────────────────────────────┘
                    │                  │                    │
                    ▼                  ▼                    ▼
┌────────────────┐┌───────────────────┐┌──────────────────────────────────┐
│ apps/web       ││ apps/cli-adapter  ││ mobile-client (v-, заморожен)    │
│ React 19 +     ││ tools/lab/*.sh    ││ дорогу не закрываем:             │
│ Vite 6 +       ││ переоборудованы   ││   - тот же API-контракт          │
│ shadcn/ui +    ││ фича-флагом       ││     (packages/schema)            │
│ TanStack Q +   ││ GOSLEEP_WRITE_    ││   - Bearer через iOS Keychain    │
│ react-router7  ││ TO_CORE=1 писать  ││   - React Native позже           │
│ + Recharts     ││ через POST в core ││                                   │
│ Bearer из      ││ (dual-write в    ││                                   │
│ Keychain,      ││ переходный)       ││                                   │
│ SSE / SSE      ││                   ││                                   │
│ reconnect      ││                   ││                                   │
└────────────────┘└───────────────────┘└──────────────────────────────────┘
                                     │
                                     ▼
┌── SQLite (WAL) — data/gosleep.db, ВНЕ git ─────────────────────────────────┐
│                                                                             │
│  Таблицы: events, questions, decisions, tasks, skills, heartbeat,          │
│  server_intents (для reconcile осиротевших), migrations_journal.            │
│                                                                             │
│  Миграции — Drizzle: apps/core/drizzle/*.sql + snapshot.json + journal      │
│  ВСЁ КОММИТИТСЯ (кроме самой БД); откат — reverse-migration руками +       │
│  backup snapshot из data/snapshots/.                                        │
│                                                                             │
│  Snapshot'ы: sqlite3 .backup после каждой миграции + ежедневно cron'ом.    │
│  Retention: 30 дней ежедневных + все post-миграционные до вручную-снятия.  │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
┌── chronicler.py (ЖИВЁТ) ──────────┐ ┌── mobile/README.md (ЖИВЁТ) ────────┐
│ Продолжает писать                 │ │ GitHub-серверный рендер Markdown   │
│ docs/lab/render_bundle.json       │ │ — единственный способ мобильного   │
│ (для mobile/README.md,            │ │ read сегодня. Хроникёр пишет.      │
│ status.json — CLI/CI-читатели).   │ │ Не трогаем.                        │
│ Читает SQLite (после переключения)│ └─────────────────────────────────────┘
│ или JSONL (переходный).           │
└────────────────────────────────────┘
```

---

## Раздел 3. Ядро: имя, рантайм, фреймворк, структура

### 3.1. Как называть компонент — обзор индустрии и наш выбор

**Практика рынка (сверено с живыми репозиториями):**

| Продукт | Имя серверного компонента | Роль в документах |
|---|---|---|
| **Warren** (jayminwest) | `warren` (просто имя проекта) | «control plane» в архитектурной документации |
| **AutoSK** | `autoskd` (демон-суффикс `d`, unix-style) | «daemon» в README |
| **Overstory** (архивирован) | `ov serve` (команда), процесс `overstory-server` | «server» в README |
| **OpenHands** | `openhands-server` (uvicorn app) | «backend server» |
| **LangGraph** | `langgraph-api` (FastAPI сервис) | «server» / «API» |
| **Mastra** | `@mastra/core` (npm-пакет) | «core» / «runtime» |
| **tRPC** | `@trpc/server` | «server» |
| **kotadb** (jayminwest, свежий) | `kotadb` | «local-only code intelligence API» |
| **Encore** | `encore.dev` | «backend framework» |

**Наш выбор: `gosleep-core`.** Обоснование:

- **«core»** — короткое отраслевое, широко узнаваемое (Mastra, tRPC, LangGraph, ProseMirror). Не связано с unix-daemon-эрой.
- **`gosleep-` префикс** — избегает конфликта с любым другим `core`-пакетом при возможной будущей публикации в npm/GitHub. Ровно то, как Warren и AutoSK делают: `warren`, `autoskd`.
- В документах и разговорах допустимо описательное имя роли — **«control plane»** (термин Warren'а: сервер, к которому подключены разные клиенты и через который делаются действия). Это не имя, а функциональная категория.
- Отвергаем: `gosleepd` (устаревший unix-суффикс, у Warren'а и OpenHands давно нет; AutoSK сохранил как исторический), `gosleep-server` (слишком общее, не отличит от `apps/web`).

**Итоговое именование в проекте:**

| Уровень | Как называем |
|---|---|
| Пакет / каталог | `apps/core/` (в файловой системе) |
| npm-имя (если публикуем) | `@gosleep/core` |
| Процесс | `gosleep-core` (в `launchd`-plist, в `ps`) |
| Отраслевая роль в документах | «control plane» |
| В речи владельца | «ядро» / «core» — оба варианта |

### 3.2. Рантайм и фреймворк

**Bun 1.2+ — рантайм.** Обоснование сохраняется из редакции 1: нативный `bun:sqlite` (важно для Drizzle без C++-модуля), TypeScript-runtime без транспилятора, `Bun.serve` совместим с Fetch API, `bun build --compile` открывает путь к single-binary. Warren, AutoSK, kotadb, Overstory — все на Bun.

**Hono 4.x — фреймворк.** Сравнительная таблица:

| Ось | **Hono 4.x** | Elysia 2.x | голый `Bun.serve` | Fastify 5 |
|---|---|---|---|---|
| Weekly downloads | ~38 M | ~461 K | (нет пакета) | ~10 M |
| GitHub stars | ~30 K | ~18 K | (нет) | ~34 K |
| Runtime | Bun/Node/Deno/Cloudflare/Vercel | Bun (первичный), Node | Bun only | Node (Bun-совместим) |
| SSE-хелпер | `streamSSE` из коробки | `Bun.serve`-style stream | ручной ReadableStream | плагин `@fastify/sse` |
| Middleware-цепочка | Первый класс, ~30 официальных пакетов | Есть, `.use()` | Пишем сами | Первый класс, huge ecosystem |
| Валидация + типы | `@hono/zod-validator` (zod, valibot) | Eden — end-to-end через Elysia-типы | Ручная | `@fastify/type-provider-typebox`/zod |
| Портируется на Node | Да, тем же кодом | Уже да, но не первичный | Нет | Native |
| Кто в индустрии использует | Cloudflare Workers-standard, много SaaS | Много Bun-only ускорителей | Warren (собственная простота) | Половина Node-стартапов |
| Bun-специфичная скорость | На Bun — быстрый; едва медленнее Elysia | Наиболее быстрый на Bun | Наиболее близкий к железу | Медленнее (Node) |

**Почему Hono, а не голый `Bun.serve` (как у Warren):**
- У Warren один разработчик, вся machinery (roнутер, matcher, middleware, идемпотентность) написана вручную (`src/server/router.ts` компилирует паттерны в regex, `handlers/idempotency.ts` — свой, `bridges.ts` — свой). Это ~800 LOC инфраструктуры на один сервер. Мы получаем то же бесплатно из Hono.
- Warren осознанно ушёл в «минимум зависимостей» — у нас другая цель: скорость доставки, не архитектурная чистота.

**Почему Hono, а не Elysia:**
- Elysia на Bun едва быстрее (единицы процентов), но экосистема в ~80 раз меньше (461K vs 38M weekly).
- Elysia-Eden делает end-to-end типы через собственный tree-serializer — красиво, но привязывает к Elysia. Hono + zod — портируется куда угодно.
- Если завтра захотим запустить `gosleep-core` в Node (для чужого сервера, CI-контейнера, будущей SaaS-версии) — Hono портируется тем же кодом. Elysia — можно, но с шероховатостями.

**Почему Hono, а не Fastify:**
- Fastify — Node-first. Хотим Bun, значит тянем совместимость.
- Плагины Fastify — плюс, но для нашего v1 они не нужны.

**Валидация:** **zod v4** (общая с клиентом через `packages/schema/`). Hono имеет `@hono/zod-validator` — валидация тела POST-запроса в middleware, `c.req.valid('json')` возвращает уже типизированное.

**Логирование:** `pino` в `data/logs/core-<date>.log` — отдельно от timeline; timeline — через `withTimeline`.

### 3.3. Структура каталогов и эндпойнты

```
apps/core/                       # gosleep-core, Bun-workspace-package
├── package.json                 # "@gosleep/core"
├── bunfig.toml
├── tsconfig.json
├── drizzle.config.ts            # config для drizzle-kit (см. 4.2)
├── drizzle/                     # migrations, коммитится в git
│   ├── 0000_initial.sql
│   ├── 0000_initial_snapshot.json
│   ├── 0001_add_skills.sql
│   ├── 0001_add_skills_snapshot.json
│   └── meta/_journal.json       # порядок применения
├── src/
│   ├── serve.ts                 # entrypoint: Bun.serve + Hono app
│   ├── config.ts                # env, paths, keychain-lookup
│   ├── db/
│   │   ├── client.ts            # drizzle(bun:sqlite) singleton
│   │   ├── schema.ts            # все таблицы (SoT для миграций)
│   │   ├── queries/             # per-domain queries (questions, skills, …)
│   │   └── seed.ts              # dev-only fixtures
│   ├── routes/
│   │   ├── read.ts              # GET /bundle, /status, /events (SSE),
│   │   │                        # /questions, /skills, /timeline, /whoami,
│   │   │                        # /healthz, /version, /tasks, /cost, /fleet
│   │   ├── actions.ts           # POST /actions/*
│   │   └── setup.ts             # GET /setup?tok=<secret>
│   ├── indexer/
│   │   ├── tail.ts              # tail JSONL → SQLite (переходный, шаги 3-7)
│   │   ├── reconcile.ts         # sha256 first-4KB, auto-rebuild
│   │   └── rebuild.ts           # ручная перестройка из JSONL
│   ├── sse/
│   │   ├── broadcaster.ts       # in-process EventEmitter + Last-Event-ID
│   │   └── rotation.ts          # UTC-day rotation, event: rotate
│   ├── security/
│   │   ├── keychain.ts          # macOS `security` CLI wrapper
│   │   ├── bearer.ts            # Authorization middleware
│   │   ├── origin.ts            # Host + Origin/Referer
│   │   ├── idempotency.ts       # persistent .artifacts/web/idempotency.jsonl
│   │   └── withtimeline.ts      # intent → CLI → outcome + touch sentinel
│   ├── spawn/
│   │   ├── publish.ts           # bash tools/skills/publish.sh + env
│   │   ├── lab-emit.ts          # bash tools/lab/lab-emit.sh
│   │   ├── tick.ts              # bash tools/lab/tick.sh --carrier web
│   │   └── chronicler.ts        # bash tools/lab/chronicler.sh --coalesce-since
│   └── contract/
│       └── (imports from packages/schema)
├── bin/
│   └── touchid-gate             # Swift-бинарь, cкомпилирован swiftc
│                                # (framework LocalAuthentication + Security)
├── scripts/
│   ├── import-jsonl.ts          # one-shot: JSONL → SQLite
│   ├── export-jsonl.ts          # обратно (для аудита/архива)
│   ├── snapshot.sh              # sqlite3 .backup → data/snapshots/<ts>.db
│   └── migrate.ts               # runtime drizzle-kit migrate
├── plist/
│   └── com.gosleep.core.plist   # launchd
├── install-deps.sh              # curl bun install + bun install + swiftc
├── plist.sh                     # install / uninstall / status
└── test/
    ├── indexer.tail.test.ts
    ├── indexer.reconcile.test.ts
    ├── sse.rotation.test.ts
    ├── security.origin.test.ts
    ├── withtimeline.orphan.test.ts
    └── e2e.publish.test.ts
```

**Эндпойнты v1** (сокращённо — полный список эндпойнтов в разделе 6):

- Read: `GET /healthz`, `/version`, `/whoami`, `/bundle`, `/status`, `/questions`, `/skills`, `/timeline`, `/tasks`, `/cost`, `/fleet`, `/events` (SSE).
- Actions: `POST /actions/skills/publish`, `/actions/questions/answer`, `/actions/questions/resolve` (v1.1), `/actions/tick`, `/actions/events/ack`, `/actions/chronicler/rebuild`.

### 3.4. Версионирование API

- `Accept: application/vnd.gosleep.v1+json` — клиент декларирует мажор.
- Мажор растёт при разрушающих изменениях. Оба мажора живут ~2 недели.
- Минор — аддитивные поля, без bump'а.
- `/version` возвращает `{server_version, api_versions:["v1"], db_schema_version:"<drizzle-journal-hash>"}`.
- Клиент через `packages/schema` знает точные типы; сервер не декодирует старые формы данных, а мажор поднимается при `schema.ts` breaking-diff'е.

---

## Раздел 4. Хранилище: SQLite — источник правды, миграции — Drizzle

### 4.1. Кто источник правды теперь

**SQLite (`data/gosleep.db`) — источник правды.** Обоснование (владелец возразил на прошлый мой аргумент, и он прав):

1. **Версионирование решается штатно.** Drizzle-миграции — `.sql` + `snapshot.json` + `_journal.json` — **всё коммитится в git**. Схема любого прошлого коммита воспроизводится: `git checkout <sha>` → `bun run migrate` → БД в нужном состоянии.
2. **Откат делается штатно.** `git revert` миграции + написать reverse-миграцию + `bun run migrate` = откат схемы. Данные откатываются через **snapshot'ы** (`data/snapshots/*.db`) — `sqlite3` `.backup`, атомарный, ~5-15 сек для нашего размера.
3. **Целостность даётся штатно.** Транзакции, foreign keys, CHECK-constraints, UNIQUE-индексы — всё то, что JSONL не даёт вообще.
4. **Быстрая фильтрация даётся штатно.** `INDEX ON events(type,ts)` и join по task — за миллисекунды. По JSONL с 50k строк/день — секунды парсинга при каждом читателе.
5. **Один writer** — гораздо чище множества скриптов, каждый со своим mkdir-lock'ом.

**JSONL после переключения (шаг 8):**
- Существуют как **исторический архив** для read-only-читателей (grep, archive.org-style запросы).
- Пишутся опционально — только если `GOSLEEP_WRITE_JSONL=1` (по умолчанию 0 после шага 8).
- `chronicler.py` продолжает читать SQLite (через новый TS-CLI `gosleep dump-render-bundle`) и писать `render_bundle.json` + `mobile/README.md`. Это единственные два производных артефакта в git.

### 4.2. Drizzle ORM + drizzle-kit — обоснование

**Сравнительная таблица (сверено с рынком 2026):**

| Ось | **Drizzle + drizzle-kit** | Prisma 6 | Kysely + kysely-migrator |
|---|---|---|---|
| SQL-first | Да, схема на TS = SQL 1:1 | Нет, PSL DSL | Да, query-builder |
| bun:sqlite | **Нативная** поддержка | Через `@prisma/adapter-driver-adapters` — работает, но не first-class | Есть `kysely-bun-sqlite` |
| Миграции: генерация | `drizzle-kit generate` — читает `schema.ts` → `.sql` + `snapshot.json` | `prisma migrate dev/deploy` | Пишем руками (kysely-migrator даёт runner, не генератор) |
| Миграции: применение | `drizzle-kit migrate` (dev), `migrate()` из runtime (prod) | `prisma migrate deploy` | `migrator.migrateToLatest()` |
| Файлы миграций в git | **Да** (`.sql` + `snapshot.json` + `_journal.json`) | Да (`.sql` + `migration_lock.toml`) | Что напишем |
| Rollback | Forward-only, reverse-миграции руками (стандарт индустрии) | Prisma rollback не имеет — только forward | Ручной |
| Bundle size | ~20 КБ на бэкенде | ~20 МБ на бэкенде (Rust engine) | ~15 КБ |
| Тип-safety | 100% через `InferSelectModel<>` | 100% через сгенерированный клиент | 100% через SQL-типизацию |
| Cold start | Нативно быстрый | Медленнее (Rust engine boot) | Нативно быстрый |
| AI-tooling (Claude/Copilot) | Догоняет | Лучший (много training data) | Слабее |
| Кто в референсе использует | **Warren** (`drizzle.config.sqlite.ts` в репе), kotadb | Множество SaaS, но mostly Postgres | Bun-only-контекст в основном |

**Выбор — Drizzle.** Причины по нисходящей:
1. **Warren, наш прямой референс, — на Drizzle.** Продолжаем ту же выкройку.
2. Нативная поддержка `bun:sqlite` — без C++-модулей, без `@prisma/adapter-driver-adapters`, без танцев.
3. Читаемые `.sql` файлы миграций коммитятся в git — можно review-ить в PR.
4. Bundle size — 20 КБ vs 20 МБ Prisma engine (важно, если завтра запаковываем ядро в single-binary через `bun build --compile`).
5. Kysely — только query-builder, схему и миграции пришлось бы обвязывать сверху; Drizzle этот слой уже есть.

**Workflow миграций у нас:**

```
Разработка:
  1. Правим apps/core/src/db/schema.ts
  2. `bun run drizzle-kit generate` → создаётся apps/core/drizzle/00XX_<name>.sql
  3. Читаем сгенерированный SQL, при необходимости правим руками
  4. `bun run drizzle-kit migrate` — применяет к data/gosleep.db
  5. Тесты
  6. Коммит: schema.ts + drizzle/00XX_*.sql + drizzle/00XX_*_snapshot.json + drizzle/meta/_journal.json

Прод (у владельца при первом старте после update):
  1. bun run migrate:snapshot   # backup ДО миграции: sqlite3 .backup data/snapshots/pre-00XX-<ts>.db
  2. bun run migrate            # применяет ВСЕ ожидающие миграции в транзакции
  3. Если migrate() кинул — snapshot восстанавливается автоматически.

Откат (редко):
  1. Написать 00YY_revert_00XX.sql руками (Drizzle не генерит reverse — индустриальный стандарт)
  2. Применить через migrate
  ИЛИ (жёсткий откат):
  1. bun run restore-snapshot data/snapshots/pre-00XX-<ts>.db
  2. git checkout <до-этой-миграции>
```

### 4.3. Схема БД (первая версия)

Полная схема в `apps/core/src/db/schema.ts`. Ниже — конспект, что где живёт.

```typescript
// apps/core/src/db/schema.ts (упрощённо)

export const events = sqliteTable('events', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  day: text('day').notNull(),           // 'YYYY-MM-DD' UTC — для семантической группировки
  ts: text('ts').notNull(),             // ISO-8601
  src: text('src').notNull(),           // 'hook'|'emit'|'poll-fill'|'chronicler'|'server'|…
  actor: text('actor').notNull(),
  task: text('task'),                   // 'GSL-XXX' | null
  type: text('type').notNull(),         // enum из SEMANTIC_TYPES + hook.* + server.*
  payload: text('payload', { mode: 'json' }).notNull(),
  supersedes_seq: integer('supersedes_seq'),  // FK на events.seq (retroaктивные)
  ingested_from: text('ingested_from'), // 'jsonl:2026-08-03.jsonl#42' — след импорта; null для direct-write
}, (t) => ({
  ix_type_ts: index('ix_events_type_ts').on(t.type, t.ts),
  ix_task_ts: index('ix_events_task_ts').on(t.task, t.ts),
  ix_actor_ts: index('ix_events_actor_ts').on(t.actor, t.ts),
  uq_ingested: uniqueIndex('uq_events_ingested').on(t.ingested_from),  // дедуп tail'а
}));

export const questions = sqliteTable('questions', {
  qid: text('qid').primaryKey(),
  status: text('status').notNull(),     // 'open'|'answered'|'resolved'|'superseded'
  kind: text('kind').notNull(),         // 'BLOCKER'|'DECISION'|'CLARIFY'|'FYI'
  task: text('task'),
  question: text('question').notNull(),
  options: text('options', { mode: 'json' }),
  opened_at: text('opened_at').notNull(),
  answered_at: text('answered_at'),
  answer_text: text('answer_text'),
  resolved_at: text('resolved_at'),
  applied: text('applied'),
  last_event_seq: integer('last_event_seq').references(() => events.seq),
});

export const decisions = sqliteTable('decisions', {
  did: text('did').primaryKey(),
  ts: text('ts').notNull(),
  kind: text('kind'),
  subject: text('subject'),
  body: text('body', { mode: 'json' }).notNull(),
  last_event_seq: integer('last_event_seq').references(() => events.seq),
});

export const tasks = sqliteTable('tasks', {
  key: text('key').primaryKey(),        // 'GSL-XXX'
  epic: text('epic'),                   // 'GSL-YYY' | null
  status: text('status').notNull(),
  title: text('title').notNull(),
  labels: text('labels', { mode: 'json' }),
  last_synced_at: text('last_synced_at'),
});

export const skills = sqliteTable('skills', {
  name: text('name').primaryKey(),      // 'using-jira'
  version: text('version').notNull(),
  status: text('status').notNull(),     // 'draft'|'reviewed'|'published'
  last_published_at: text('last_published_at'),
  last_published_by: text('last_published_by'),
  changelog: text('changelog', { mode: 'json' }).notNull(),  // массив записей
});

export const heartbeat = sqliteTable('heartbeat', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  ts: text('ts').notNull(),
  cycle: integer('cycle'),
  context_pct: integer('context_pct'),
  open_workers: integer('open_workers'),
  extra: text('extra', { mode: 'json' }),
});

export const server_intents = sqliteTable('server_intents', {
  intent_id: text('intent_id').primaryKey(),
  endpoint: text('endpoint').notNull(),
  started_at: text('started_at').notNull(),
  finished_at: text('finished_at'),
  status: text('status'),               // 'pending'|'ok'|'fail'|'orphan'
  params: text('params', { mode: 'json' }),
});

export const ingest_state = sqliteTable('ingest_state', {
  file_path: text('file_path').primaryKey(),
  last_ingested_offset: integer('last_ingested_offset').notNull(),
  last_sha256_prefix: text('last_sha256_prefix').notNull(),  // sha256 первых 4 КБ
  updated_at: text('updated_at').notNull(),
});
```

### 4.4. Snapshot'ы, откат, воспроизводимость

**Snapshot'ы:**
- `sqlite3 gosleep.db ".backup data/snapshots/<ts>-<label>.db"` — атомарный, WAL-friendly.
- **Автоматически** перед каждой миграцией (`pre-00XX-<ts>.db`).
- **Автоматически** каждые 24 часа в `daily-<ts>.db` через launchd-cron.
- **Автоматически** перед и после `publish.sh` (важно — публикация меняет `~/.claude/skills/`, snapshot фиксирует состояние registry на момент).
- Retention: 30 дней ежедневных + все post-migration до ручного снятия + последние 5 pre-publish.
- Директория `data/snapshots/` — **вне git**, `chmod 0700`, никогда не расшариваем.

**Откат:**
1. **Мягкий (по данным):** написать reverse-миграцию — стандарт индустрии (Rails, Django, Prisma, Drizzle — все forward-only, откат руками).
2. **Жёсткий (по всему состоянию):** `bun run restore-snapshot <file>` — останавливает индексатор, `mv gosleep.db gosleep.db.<ts>.bak`, `cp snapshot gosleep.db`, поднимает.

**Воспроизводимость:**
- Git-checkout любой sha → `bun run migrate` → БД в состоянии этого коммита (пустая, если данные не seed'ятся).
- **Данные** — восстанавливаются либо из последнего snapshot'а на дату, либо путём **re-import из JSONL** (см. 4.5) — те же входные события дают ту же БД (дедуп через `uq_events_ingested`).

### 4.5. Что делать с историей, накопленной в JSONL

**Одноразовый импорт:** `bun apps/core/scripts/import-jsonl.ts`.

```
Что делает:
1. Читает docs/lab/events/*.jsonl с 2026-06 до сегодня в порядке дат.
2. Для каждой строки: парсит JSON, вычисляет ingested_from = "jsonl:2026-08-03.jsonl#42",
   INSERT OR IGNORE в events (уникальность по ingested_from).
3. Читает docs/lab/questions/queue.jsonl последовательно, fold'ит в questions
   по (qid, patches) — та же логика, что у chronicler.py, вынесенная в TS.
4. Читает docs/lab/decisions/log.jsonl — INSERT в decisions.
5. Читает docs/lab/supervision/heartbeat.jsonl — INSERT в heartbeat.
6. Обновляет ingest_state для каждого файла (offset = EOF, sha256 = первых 4 КБ).

Идемпотентность: повторный запуск ничего не меняет (INSERT OR IGNORE по uq_events_ingested).

Время: ~10-30 секунд на весь исторический объём.
```

**После импорта:**
- Индексатор `tail.ts` продолжает работу с `ingest_state.last_ingested_offset`, ничего не дублирует.
- JSONL-файлы остаются в git — как исторический архив; никто не обязан из них читать.

**После шага 8 (переключение писателей):**
- Хуки Claude Code продолжают писать в `lab-log-hook.sh`, который теперь **параллельно**:
  - Пишет в JSONL (для обратной совместимости и debug'а),
  - POST'ит в `http://127.0.0.1:7331/internal/emit` (новый **internal**-endpoint с secret'ом, тот же env-secret, что у publish.sh).
- Ядро при получении POST'а — INSERT в events напрямую.
- Через 1-2 месяца после стабильности — флаг `GOSLEEP_WRITE_JSONL=0`, JSONL становится опциональным (не пишется, кроме архива).

### 4.6. Что при ручной правке БД (`sqlite3 data/gosleep.db`)

- **По умолчанию — запрещено.** Единственный writer — `gosleep-core`. Standing rule в `CLAUDE.md`.
- Если владелец всё-таки правит вручную (dev-only): при следующем старте ядро запускает `PRAGMA integrity_check` — при OK продолжает; в противном случае — WARN в лог + прерывает старт.
- Для DBA-действий владельца — отдельный CLI `bun apps/core/scripts/db-shell.ts` с pre/post-snapshot'ом.

---

## Раздел 5. Разграничение старого и нового

**Требование владельца:** «правильно организовать процесс», без каши. Старое должно продолжать работать, пока новое строится, — и переключение не должно ломать хуки/гейты.

### 5.1. Три варианта раскладки и рекомендация

**Вариант R1 — Bun-workspaces monorepo (рекомендуемый).**

```
gosleep/                              # корень репо
├── apps/                             # НОВОЕ (после шага 3 миграции)
│   ├── core/                         # gosleep-core: Bun + Hono + Drizzle
│   │   └── (см. раздел 3.3)
│   └── web/                          # React + Vite + shadcn + Tailwind
│       ├── package.json
│       ├── vite.config.ts
│       ├── src/…
│       └── dist/                     # build output, вне git
├── packages/                         # НОВОЕ, разделяемые слои
│   ├── schema/                       # zod + drizzle-типы; переиспользует и клиент, и сервер
│   │   ├── package.json
│   │   └── src/{events,questions,skills,tasks,api}.ts
│   └── sdk/                          # typed TS client для core (fetch-обёртка)
│       ├── package.json
│       └── src/{client,useSSE,types}.ts
├── data/                             # НОВОЕ, ВНЕ git (в .gitignore)
│   ├── gosleep.db
│   ├── gosleep.db-wal
│   ├── gosleep.db-shm
│   ├── snapshots/
│   │   ├── daily-2026-08-03.db
│   │   └── pre-0001-*.db
│   └── logs/
│       └── core-2026-08-03.log
├── tools/                            # СТАРОЕ, ОСТАЁТСЯ
│   ├── lab/                          # хроникёр, все *.sh, ui/ (Preact-SSG)
│   ├── watchdog/
│   ├── hooks/
│   └── skills/                       # публикация (появится на шаге 1)
├── docs/                             # существующее
│   ├── lab/                          # JSONL, render_bundle, site, mobile
│   ├── prd/
│   ├── plans/
│   ├── handoff/
│   └── reports/
├── skill/                            # существующее
├── .claude/                          # существующее (settings, permissions)
├── package.json                      # bun-workspaces root
├── bun.lockb
├── bunfig.toml
└── CLAUDE.md
```

`package.json` корня:
```json
{
  "name": "gosleep",
  "private": true,
  "workspaces": ["apps/*", "packages/*"]
}
```

**Плюсы R1:**
- **Чистое разделение.** Новое живёт в `apps/`+`packages/`, старое — в `tools/lab/`. Хуки, гейты, скрипты `tools/lab/*.sh` не трогаем.
- **Общие типы** (`packages/schema`) переиспользуются клиентом, сервером и, в перспективе, мобильным.
- **`.gitignore` для `data/`** — база и снимки не в git, но структура очевидна.
- **`bun install` в корне** ставит всё дерево, `bun run --filter='@gosleep/core' dev` — работает с одним пакетом.
- Индустрия делает так же (Turborepo, Nx, Bun-workspaces — стандарт де-факто 2026).

**Минусы R1:**
- Появляется корневой `package.json` — сегодня его нет как workspace-root'а.
- `bun.lockb` в корне заменяет любые локальные — нужно пометить владельцу, что теперь единый lock.

---

**Вариант R2 — «Legacy-папка для старого».**

```
gosleep/
├── apps/core/                        # НОВОЕ
├── apps/web/                         # НОВОЕ
├── packages/…                        # НОВОЕ
├── legacy/                           # СТАРОЕ, физически перенесено
│   ├── chronicler.py
│   ├── lab-log.sh
│   ├── lab-emit.sh
│   ├── ui/                           # Preact-SSG
│   └── …
├── docs/                             # ОСТАЁТСЯ
└── tools/                            # только НОВЫЕ tools (skills/publish.sh)
```

**Плюсы R2:**
- Ярче маркер «это старое».
- `git grep tools/lab` в новом коде == 0 → компилятору легче ловить регрессии.

**Минусы R2:**
- **Ломает все хуки Claude Code** (`.claude/settings.json:98-121`) — там прописаны абсолютные пути `tools/hooks/lab-log-hook.sh`, `tools/lab/lab-log.sh`.
- **Ломает все существующие эпик-скрипты** в CI/README/CLAUDE.md — приходится найти и переписать десятки ссылок.
- **Ломает `chronicler-debounce.sh`**, `tick.sh`, `gate.sh`, `smoke.sh` — они через `SCRIPT_DIR=$(dirname "$0")` собирают соседей.
- **Ломает git-blame** для 3 815 строк хроникёра — sed-move «переносит» файл, но line-blame рвётся (Git иногда угадывает, но не гарантированно).

**Вердикт по R2:** не рекомендую. Требование «правильно организовать» не оправдывает ломать работающие хуки/гейты — риск превышает выгоду именования.

---

**Вариант R3 — «Всё в services/».**

```
gosleep/
├── services/
│   ├── core/                         # apps/core → services/core
│   ├── web/                          # apps/web → services/web
│   └── legacy-chronicler/            # tools/lab → services/legacy-chronicler
├── packages/…
└── …
```

**Плюсы R3:**
- Единая семантика «сервис»: и core-Bun, и React-web, и Python-хроникёр — все живут одинаково.

**Минусы R3:**
- Комбинирует минусы R1 и R2: тот же ломающий переезд `tools/lab` + переезд ещё и `apps/core`.
- «services» — не индустриальный термин для workspace'ов (индустрия — `apps`+`packages`, mono-repo стиль Turborepo/Nx).

**Вердикт по R3:** отклоняю.

### 5.2. Рекомендация: R1 (Bun-workspaces monorepo, `apps/`+`packages/`, `tools/lab/` не трогаем)

Влияние R1 на существующие компоненты:

| Компонент | Изменение |
|---|---|
| `.claude/settings.json` (12 hook-матчеров) | 0. Пути к `tools/hooks/lab-log-hook.sh` не меняются. |
| `tools/lab/chronicler.py` | 0 (в переходный период). На шаге 8 — небольшая правка: читает через `bun apps/core/scripts/dump-render-bundle.ts` вместо JSONL напрямую. |
| `tools/lab/*.sh` | 0 (в переходный период). На шаге 8 — обёрнуты в `lab-emit-hybrid.sh`, который дублирует append в JSONL + POST в core. Флаг `GOSLEEP_WRITE_JSONL` управляет обоими. |
| `tools/lab/ui/` (Preact-SSG) | Deprecated на шаге 8, `git rm` на шаге 9-10 (отдельный PR). |
| `docs/lab/site/*.html` | Deprecated, читают только через `file://` как fallback. |
| `docs/lab/mobile/README.md` | 0. GitHub-рендер продолжает работать. |
| `docs/lab/**/*.jsonl` | 0 в переходный период. После шага 8 — опционально пишется через `GOSLEEP_WRITE_JSONL=1`. Исторические файлы навсегда в git как архив. |
| `tools/lab/gate.sh` | Добавляется шаг `bun --filter='@gosleep/core' test` в конце гейта. Существующие проверки остаются. |
| `tools/lab/smoke.sh` | Добавляется 4 новых guard'а: `grep fs.writeFile apps/core` = 0 в write-path'ах; `grep sqlite3` вне apps/core = 0; Bearer-secret не в git; withTimeline обёрнут на каждом POST. |
| `CLAUDE.md` | +40 строк: раскладка monorepo, как запускать core, где живёт secret, как читать логи, как делать snapshot руками. |
| `docs/handoff/ORCHESTRATION-STATE.md` | +standing rule «SQLite — источник правды, JSONL — исторический архив с шага 8», «Ядро гlbинается через `launchctl bootout` после кофе owner'а». |
| `install.sh` | 0. Guard остаётся (четвёртый слой защиты). |

### 5.3. Как обеспечить «нет каши» — три жёстких правила

1. **`apps/` и `packages/` — только новое.** grep-guard в `smoke.sh`: `find apps packages -name '*.py'` = 0; `find apps packages -name '*.sh'` = 0 (кроме `install-deps.sh`, `plist.sh`, `snapshot.sh` в `apps/core/scripts/`).
2. **`tools/` — старое или инфра.** `apps/` не имеет права `child_process.spawn("tools/lab/...")` через прямой путь; всегда через `apps/core/src/spawn/*.ts`, где путь — единственное место, где `tools/lab/` упомянут. Так при переносе завтра меняется одно.
3. **`docs/lab/**` пишет только `tools/lab/lab-log.sh` / `lab-emit.sh` / `lab-write.sh`.** Ядро в них не пишет напрямую **никогда** — только через spawn CLI. grep-guard в smoke.

---

## Раздел 6. Клиент (`apps/web`) и действия v1

**Стек, экраны, SSE-flow, обработка разрыва — без изменений от редакции 1.** Ниже — только дельта: как клиент взаимодействует с БД-первой архитектурой.

### 6.1. Что изменилось для клиента

- `GET /bundle` теперь возвращает **проекцию из SQLite** (собирается запросом), а не файл `render_bundle.json`. Это чуть медленнее (~5-15 мс query + serialize против 2 мс read+ETag), но гарантированно свежее.
- `GET /questions` — прямой query из `questions`-таблицы; кэша нет; TanStack Query держит client-side stale-while-revalidate.
- `GET /events?since=<seq>` — SSE-стрим напрямую из `events`-таблицы через in-process `EventEmitter`; при коммите новой строки индексатор эмитит событие, broadcaster рассылает.
- `Last-Event-ID` header стандартом SSE — при reconnect'е браузер шлёт сам, сервер отдаёт всё после этой позиции.
- `event: rotate` при UTC-смене — client'у показывает «День сменился, обновляю» и invalidate все queries.

### 6.2. Полный список действий v1

Без изменений от редакции 1. Резюме:

| Метод | Путь | Спавнит | TouchID? | В переходный период дублируется? |
|---|---|---|---|---|
| `POST` | `/actions/skills/publish` | `tools/skills/publish.sh <name>` | **Да** | Нет (сразу в SQLite через skills-таблицу) |
| `POST` | `/actions/questions/answer` | `tools/lab/lab-emit.sh answer` + INSERT в SQLite | Нет | **Да, dual-write** через `lab-emit-hybrid.sh` |
| `POST` | `/actions/questions/resolve` (v1.1) | `tools/lab/lab-emit.sh resolve` + UPDATE | Нет | Да |
| `POST` | `/actions/tick` | `tools/lab/tick.sh --force --carrier web` | Нет | Нет (tick — идемпотентный, только читает и пишет через существующие пути) |
| `POST` | `/actions/events/ack` | `tools/lab/lab-log.sh --type ack …` + INSERT | Нет | Да |
| `POST` | `/actions/chronicler/rebuild` | `tools/lab/chronicler.sh --quiet --carrier web` | Нет | Нет |
| `POST` | `/internal/emit` | (не наружу — вызывает shim из hooks) | Нет | Только после шага 6 |

---

## Раздел 7. Аутентификация: варианты, таблица, рекомендация

**Ключевой критерий (владелец):** агент, работающий в той же shell'е под тем же UID, не должен уметь опубликовать скилл. Плюс — плейнс никакой другой машины, никаких browser-XSS.

### 7.1. Обзор индустрии

| Продукт | Механизм | Достаточно ли этого для нас |
|---|---|---|
| **Warren** (jayminwest) | Bearer из env `WARREN_API_TOKEN` (без Keychain, plain env) | **Нет.** Env var читается любым процессом под тем же UID. Warren не различает владельца/агента — это допущение проекта. |
| **AutoSK** (via pi) | PKCE OAuth-flow с claude.ai/oauth, creds в `~/.pi/agent/auth.json` (0600) | **Не для нас.** OAuth требует внешнего IdP; у нас его нет и не будет. |
| **gh CLI** | macOS Keychain (encrypted OAuth token); fallback plaintext через `--insecure-storage`; известный баг: silent unauth при keychain-timeout | **Полу-годится.** Keychain — правильный шаг, но при timeout gh молча шлёт без Authorization — это регресс, не хотим повторять. |
| **VS Code Remote Tunnels** | Device-flow OAuth с Microsoft/GitHub, оба конца привязаны к одному аккаунту | **Не для нас.** Требует внешний IdP. Мы работаем офлайн под подпиской Claude. |
| **Docker Desktop** | UID-based (host uid = daemon owner); credential-helper для registry | **Недостаточно.** UID = «владелец залогинен» = «агент под UID владельца тоже». |
| **Tailscale** | Node-level authentication, ACL server-side; **не различает пользователей на одной машине** | **Не годится.** Как сказано в их доке: «any OS user on the client machine can connect to SSH servers over Tailscale». Ровно наш антипаттерн. |
| **Kubernetes kubectl** | mTLS с per-user cert; kubeconfig 0600 | **Overkill.** Требует CA-инфраструктуры. |
| **1Password/Bitwarden CLI** | Master password + Touch ID prompt при каждом sensitive-action | **То, что нам нужно.** Прямая модель: physical gesture для high-blast. |

### 7.2. Семь вариантов защиты для нас: таблица

| # | Вариант | Что защищает | Что НЕ защищает | Стоимость (дни разработки) | UX-frикция |
|---|---|---|---|---|---|
| 1 | Bearer-token в plaintext-файле 0600 (`~/.config/gosleep/web.token`) | curl без токена; чужие UID'ы | Агент под UID владельца — читает файл | 0.5 | 0 после первого setup |
| 2 | Bearer-token в **macOS Keychain** через `security` CLI (`security add-generic-password/find-generic-password`, ACL к нашему бинарю) | То же + чужие процессы, которые не запрашивают через Keychain | Агент под UID владельца может позвать тот же `security find-…`; но Keychain **выбрасывает промпт** «gosleep-core запрашивает пароль» при **первом** доступе за сессию (кроме same-app-owner) | 0.5-1 | 0-1 промпт первый раз |
| 3 | **TouchID gesture** через `LocalAuthentication`-framework (Swift-бинарь, LAContext) | Физическая биометрия — агент структурно не имеет доступа к сенсору | MacBook без TouchID; SSH-сессия | 0.5 | 1 палец на write-action |
| 4 | **Confirm в owner's TTY** — сервер печатает в `/dev/tty` владельца (не stdin!) prompt «Publish 'using-jira'? y/N», ждёт ввода | Агент в pipe-контексте Claude Code не имеет `/dev/tty` владельца | keyboard-скрипт под тем же UID; SSH-сессия без TTY на другом конце | 0.5-1 | 1 нажатие клавиши |
| 5 | **OAuth device-flow с внешним IdP** (GitHub/Google/Anthropic OAuth) | Внешний IdP + phone-approval | Требует IdP; клавиатурный агент | 2-3 | периодический ре-auth |
| 6 | **YubiKey / Hardware key** (WebAuthn через `libfido2`) | Физическое устройство | MacBook без Yubikey; не для мобильного | 3-4 | вставить+тач |
| 7 | **mTLS с per-device cert** | Другие устройства/машины | Не различает процессы на одной машине | 2-3 | 0 после setup |

### 7.3. Рекомендация — многослойка

**Приоритет 1 (write high-blast: publish skill, любое изменение `~/.claude/skills/`, будущее `git push`):**
- **Обязательный TouchID gesture** (вариант 3) внутри `publish.sh` — единственный барьер, который агент структурно не проходит.
- **Fallback без сенсора** (MacBook Air без TouchID, SSH): TTY-confirm (вариант 4) — печатаем в `/dev/tty` owner'а prompt, ждём `y/N`. Слабее, но обход требует целенаправленной атаки (agent-подсаженный keyboard-watcher).

**Приоритет 2 (write low-blast: answer, ack, resolve, tick):**
- **Bearer-token в macOS Keychain** (вариант 2, с fallback на 1 при keychain-timeout, но с явной WARN в лог, не как gh silent-mode).
- Плюс env-secret `GOSLEEP_WEB_TOKEN`, передаваемый в spawn `lab-emit.sh` — как в редакции 1.

**Приоритет 3 (read-only: /bundle, /questions, /events):**
- **Только Bearer из Keychain**. Read'ы не меняют состояние; регресс не фатален.

**Приоритет 4 (transport):**
- **bind 127.0.0.1** (не `0.0.0.0`, не `::`);
- **Host-header check** — только `127.0.0.1:7331`;
- **Origin/Referer** — обязателен хотя бы один; если оба — совпадают;
- **CSP** на SPA — `default-src 'self'`.

### 7.4. Как это меняется по сравнению с редакцией 1

- Раньше был **plain-файл 0600**. Заменяем на **macOS Keychain** — тот же порядок работы (Bearer в заголовке), но secret хранится в keychain-item с ACL, и первое чтение вызывает системный prompt (агент видит **чужой** промпт от Apple — не может ответить). Инспирировано gh CLI (учтено, что там баг с silent-mode при timeout — мы **не** повторяем: при timeout возвращаем 503, не 200).
- Раньше TouchID был **единственным** физическим слоем. Оставляем, дополнительно проектируем **TTY-confirm-fallback** для сценария «без сенсора» — сегодня в редакции 1 fallback был только «одноразовый код в /dev/tty», сейчас упрощаем до `y/N` — meilleur UX.

### 7.5. Что честно не закрыто

- **Целенаправленная атака под тем же UID.** Абсолютной защиты без hardware-token'а (YubiKey/Secure-enclave-cert) нет. Смягчение: `withTimeline` пишет каждое серверное действие в `events` с `actor="web"` — post-hoc аудит.
- **MacBook Air без TouchID + агент в неинтерактивном контексте.** TTY-confirm требует `/dev/tty` — но `Claude Code` в CI-контексте `/dev/tty` не имеет. Значит: агент в Claude-Code-shell **всегда** упирается либо в TouchID (есть сенсор), либо в TTY-confirm (нет сенсора). Абсолютное не даёт, но приемлемо для однопользовательского контура.
- **Соц.-инженерия:** владелец нажал палец на TouchID случайно (macOS запросил в другой контекст). Смягчение: сам prompt-строка содержит имя действия — «Publish skill 'using-jira'». Владелец обязан прочитать.

---

## Раздел 8. Мобильный клиент в перспективе

**Заморожен владельцем.** Не строим, но готовим фундамент — детали в редакции 1 (без изменений):

1. **`packages/schema`** — zod-схемы и типы, переиспользуются React Native / Swift-клиентом.
2. **REST + SSE** — стандарты, поддержка native SDK'ов.
3. **Bearer-token как auth-механизм** — Keychain (iOS Keychain / Android Keystore).
4. **Никаких browser-only-флоу** (нет `document.referrer`, нет `sessionStorage` как единственного места).
5. **TouchID для мобильного — Face ID через тот же `LocalAuthentication`**, механизм переносится.

---

## Раздел 9. Миграция по шагам

**Шаг 0 (сейчас).** Preact-SSG работает; кнопки нет.

**Шаг 1 — Предпосылки skills-governance. 2.5 дня.**
- `docs/skills/CHANGELOG.jsonl` (пустой) + JSON-schema + smoke.
- `tools/skills/publish.sh` — env-check + TouchID + diff + backup + rsync + append CHANGELOG.
- Правка `chronicler.py`: `skills`-проекция читает CHANGELOG (для переходного периода).

**Шаг 2 — Chronicler top-level lock + web sentinel. 0.5 дня.**
- Из редакции 1, без изменений.

**Шаг 3 — Скелет monorepo + ядро (read-only, без БД). 3 дня.**
- Настроить Bun-workspaces (`package.json` root + `bunfig.toml`).
- `apps/core`: Bun.serve + Hono + healthz/version/whoami.
- `plist.sh install/uninstall` со secret'ом в **Keychain** (`security add-generic-password`).
- launchd-plist (`RunAtLoad=true, SessionCreate=true, KeepAlive`).
- Compile TouchID-бинарь (`swiftc -framework LocalAuthentication -framework Security`).

**Шаг 4 — SQLite + Drizzle schema v1 + импорт из JSONL. 3-4 дня.**
- `apps/core/src/db/schema.ts` — все таблицы из 4.3.
- `drizzle-kit generate` первой миграции; commit `.sql` + `snapshot.json` + `_journal.json`.
- `apps/core/scripts/import-jsonl.ts` — импортирует все исторические JSONL.
- `apps/core/scripts/snapshot.sh` + `restore-snapshot.sh`.
- launchd-cron для daily snapshot.
- Тесты: миграция вперёд, откат через snapshot, идемпотентность импорта.

**Шаг 5 — Индексатор tail JSONL → SQLite. 2-3 дня.**
- `apps/core/src/indexer/tail.ts` через `fs.watch` + poll-fallback + sha256-check.
- `reconcile.ts` — при mismatch перезапускает per-file rebuild.
- Read-эндпойнты `/bundle`, `/questions`, `/skills`, `/timeline`, `/tasks` — из SQLite.
- SSE broadcaster + rotation.
- Тесты: гонка индексатор vs lab-emit, UTC-rotation, orphan-intent reconcile.

**Шаг 6 — React-клиент (read-only). 5-6 дней.**
- Vite + React 19 + TS + Tailwind v4 + shadcn инициализация.
- `apps/web/src/data/*.ts` (api, sse, queries).
- Shell + 5 экранов (Overview, Timeline, Questions read-only, Tasks, Cost).

**Шаг 7 — Первая write-кнопка «Опубликовать». 1.5-2 дня.**
- `POST /actions/skills/publish` + `withTimeline` + spawn `publish.sh` с env-secret + TouchID жест внутри.
- Экран Skills с кнопкой, диалогом, toast'ами.
- Тест e2e: клик → TouchID prompt → snapshot → publish → chronicler.

**Шаг 8 — Dual-write: hooks в JSONL и в SQLite. 2-3 дня.**
- Новый **internal-эндпойнт** `POST /internal/emit` (только с env-secret, только 127.0.0.1).
- `lab-log-hook-hybrid.sh` (обёртка над существующим): пишет JSONL + `curl -X POST /internal/emit`.
- Настройка `.claude/settings.json` на новый shim.
- Флаг `GOSLEEP_WRITE_JSONL=1` (пока — да).

**Шаг 9 — Answer + tick + ack + resolve. 2 дня.**
- Четыре POST-эндпойнта, четыре экранных элемента.
- Экран Questions с диалогом ответа.

**Шаг 10 — Полировка + документация + smoke-guard'ы. 2-3 дня.**
- Bearer setup-flow (открывает окно с Keychain-подтверждением).
- CSP-заголовки, security-тесты.
- Runbook, правки `CLAUDE.md` и `ORCHESTRATION-STATE.md`.
- smoke-guard'ы (grep fs.writeFile apps/core = 0 и т.д.).

**Шаг 11 — Deprecation Preact-SSG. 1 день.**
- Хроникёр перестаёт вызывать `render.sh` (флаг `GOSLEEP_KEEP_STATIC_SITE=0`).
- `docs/lab/site/*.html` остаются в git как artifact 1-2 месяца.

**Шаг 12 — Финальное переключение: SQLite = source of truth. 2-3 дня.**
- `GOSLEEP_WRITE_JSONL=0` — hooks не пишут JSONL, только POST.
- `chronicler.py` читает БД через `bun apps/core/scripts/dump-render-bundle.ts`.
- Опция: `bun apps/core/scripts/export-jsonl.ts` для аудита.

**Шаг 13 (позже, отдельный PR) — Cleanup.** `git rm docs/lab/site/*.html`, `git rm -r tools/lab/ui/`.

### 9.1. Как сосуществуют старый и новый интерфейсы

**Шаги 3-7:** параллельно.
- Preact-SSG продолжает писать HTML (fallback).
- Ядро отдаёт актуальнее — из SQLite.
- Хроникёр пишет обычные производные.
- Хуки пишут в JSONL, индексатор их зеркалит в SQLite.

**Шаги 8-11:** переходный dual-write.
- Хуки пишут в оба места.
- Ядро — источник для UI.
- SSG-HTML пенсионируется, `mobile/README.md` остаётся.

**Шаг 12+:** переключение.
- Хуки пишут только через POST.
- JSONL пишется опционально.
- SQLite — авторитет.

---

## Раздел 10. Действия v1 (справочно)

См. таблицу в разделе 6.2. Не повторяю целиком — контракт одинаков; только реализация распространяется на dual-write (переходный) и direct-write (после шага 12).

**Пример потока `POST /actions/skills/publish` после шага 12** (полный direct-write):

1. Клиент: `POST /actions/skills/publish` с `Bearer <keychain-token>` + `Idempotency-Key` + `Origin: http://127.0.0.1:7331`.
2. Сервер: Bearer + Origin + Host middleware; per-endpoint concurrency=1.
3. `withTimeline("skills.publish", {name}, async () => …)`:
   - **Pre-snapshot:** `sqlite3 gosleep.db ".backup data/snapshots/pre-publish-<ts>.db"`.
   - INSERT в `server_intents` — pending.
   - Spawn: `bash tools/skills/publish.sh <name>` с env `GOSLEEP_WEB_TOKEN=<secret>`.
   - Внутри `publish.sh`: env-check → **TouchID gesture** → rsync → backup → INSERT в `skills` (через `bun apps/core/scripts/record-publish.ts <name> <version>`).
   - Post-spawn: UPDATE `server_intents` — finished.
4. Ответ: `{ok, snapshot_path, new_skill_version}`.
5. Клиент: toast, invalidate query `['skills']`.
6. SSE broadcaster рассылает `events` INSERT'ы (type='web.touchid.granted', 'skills.published').

---

## Раздел 11. Сроки

| Шаг | Диапазон, дни |
|---|---|
| 1. Предпосылки skills-governance | 2.0 – 2.5 |
| 2. Chronicler-lock + web sentinel | 0.5 |
| 3. Скелет monorepo + core (read-only) | 3.0 |
| 4. SQLite + Drizzle + импорт JSONL | 3.0 – 4.0 |
| 5. Индексатор + read-эндпойнты + SSE | 2.0 – 3.0 |
| 6. React-клиент (read-only) | 5.0 – 6.0 |
| 7. Первая write-кнопка (publish) | 1.5 – 2.0 |
| 8. Dual-write hooks | 2.0 – 3.0 |
| 9. Answer + tick + ack + resolve | 2.0 |
| 10. Полировка + docs + smoke-guards | 2.0 – 3.0 |
| 11. Deprecation Preact-SSG | 1.0 |
| 12. Финальное переключение SQLite=SoT | 2.0 – 3.0 |
| **Итого v1 (до шага 12)** | **26.0 – 33.0 дня** |
| **С +40% honest buffer** | **36 – 46 дней** |

**Первая рабочая кнопка (шаг 7):** 17-21 дня.
**Полный v1 с honest buffer:** **30-38 дней одному воркеру.**

Сравнение:
- Редакция 1 (JSONL = SoT, SQLite = проекция): 25-32 дня. Дешевле, но не отвечает решению владельца.
- Редакция 2 (SQLite = SoT + миграции + импорт из JSONL + Keychain): 30-38 дней. **Прибавка ~5-8 дней** — вклад БД-first-подхода и разграничения.

Можно параллелить (второй воркер):
- Шаги 4 и 6 независимы (БД и React-клиент);
- Шаги 5 и 6 частично параллельны;
- Максимум с двумя воркерами: ~22-26 календарных дней.

---

## Раздел 12. Риски

Переносится таблица из редакции 1 (R1-R25 — все актуальны). Плюс новые риски, специфичные для БД-first + Keychain-подхода:

| # | Риск | Как закрыт |
|---|---|---|
| R26 | **Двойной период (шаги 4-8): JSONL vs SQLite рассинхронизация — потеря событий между append в JSONL и tail'ом в SQLite** | Индексатор `tail.ts` читает через `fs.watch` + 10-сек poll как страховка. При каждом старте — sha256-check первых 4 КБ JSONL: mismatch → rebuild того файла. Тест: kill core → 100 emit'ов в JSONL → рестарт → все 100 в SQLite. |
| R27 | **Миграция схемы Drizzle сломала прод-данные** | Обязательный pre-snapshot перед каждой миграцией. `migrate()` внутри транзакции — при ошибке автоматически откатывается. Reverse-миграции пишутся руками; smoke test'ы: `bun run migrate → bun run test:migrations` заранее в CI-like гейте. |
| R28 | **`bun run drizzle-kit generate` сгенерил не тот SQL** (миграция дропает колонку с данными) | **Правило:** `.sql` файл всегда review'ится вручную перед commit'ом; smoke имеет проверку `grep -E "DROP (TABLE|COLUMN)" drizzle/*.sql` — при появлении требует явного annotate `-- WARN: intentional drop, snapshot X taken`. |
| R29 | **Keychain-timeout приводит к silent-unauth (как у gh CLI)** | Наш wrapper `security.ts` при timeout возвращает **503 Service Unavailable** (не 200 без Authorization). Клиент показывает «Keychain не отвечает, попробуйте позже». Явный WARN в лог. |
| R30 | **Импорт JSONL в SQLite создаёт дубли при повторном запуске** | `uq_events_ingested` на `ingested_from = "jsonl:<file>#<offset>"`. INSERT OR IGNORE — второй запуск ничего не меняет. Тест: `bun scripts/import-jsonl.ts && bun scripts/import-jsonl.ts` = один и тот же count. |
| R31 | **`data/gosleep.db` попал в git** | `.gitignore` жёстко исключает `data/**` (кроме `data/.gitkeep`). Smoke-guard: `git ls-files data/ | grep -v '.gitkeep'` = пусто. |
| R32 | **Snapshot'ы забиты диск (30 дней daily + N pre-migration)** | Retention-политика в `snapshot.sh`: удаляет daily старше 30 дней; keep все pre-migration в last 5 значимых версий, старше — переносить в холодный архив на внешний диск (владелец руками). |
| R33 | **launchd-cron для snapshot не срабатывает при закрытой крышке ноута** | Snapshot делается **дополнительно** при старте ядра после сна MacBook'а (detect через uptime-diff). Как страховка. |
| R34 | **BREAKING migration в схеме ломает уже-запущенный SPA (клиент с v1-типами, БД в v2)** | Мажор API — `Accept: vnd.gosleep.v1+json`; сервер отдаёт 406 если клиент шлёт неподдерживаемый мажор. Клиент показывает «Обнови вкладку», forced-reload. |
| R35 | **`fs.watch` на JSONL промахивается на macOS FSEvents (задержка 200-500 мс)** | Уже учтено (finding 12): 10-сек poll как страховка. Индексатор не критически-latency чувствителен — задержка 500 мс приемлема (пользователь не заметит на дашборде). |
| R36 | **Владелец сделал `git reset --hard`, а JSONL продолжает менять SQLite неверными данными** | `reconcile.ts` при старте: sha256-check и inode-check. При изменении не-append (mtime меняется без размера увеличения) — pеrebuild того файла. |
| R37 | **Bun-workspace-root в корне ломает существующие относительные пути в CLAUDE.md/скриптах** | Проверить перед шагом 3: `git grep -E "^(cd |scripts/|tools/)"` — почти всё абсолютно (`tools/lab/...`). Правки — только в `CLAUDE.md` (~40 строк). |
| R38 | **Hono middleware пропустил Bearer из-за regex-баг** | Специальный smoke-тест: 4 варианта запроса без корректного Bearer — все 401. Плюс golden-test'ы. |

**Унаследованные R1-R25 из редакции 1** остаются в силе (гонки, hooks, атомарность, Origin/Host, idempotency, UTC-rotation, ETag, dedup answer, launchd-KeepAlive, React-бандл, MacBook без TouchID, XSS-CSP).

---

## Приложение А. Соответствие требованиям владельца

| Требование владельца | Реализация |
|---|---|
| Ядро-сервер по образцу Warren/AutoSK | `apps/core` — Bun + Hono + Drizzle + SQLite, как у Warren (см. раздел 3.1) |
| Один контракт для разных клиентов | REST + SSE в `packages/schema`, переиспользуется core, web, будущим mobile |
| React + Vite + shadcn + Tailwind | `apps/web` — стек 1:1 с Warren, раздел 6 |
| SQLite обязательна | Источник правды, раздел 4 |
| Живые обновления обязательны | SSE через EventEmitter из SQLite triggers, `Last-Event-ID`, `event: rotate` |
| БД — источник правды | Раздел 4.1 |
| Миграции штатно | Drizzle-kit + `.sql` + snapshots в git, forward-only + reverse руками, раздел 4.2 |
| Старое сохранить и разграничить | Bun-workspaces monorepo, `tools/lab/` не трогаем в переходный, раздел 5.1 |
| Правильно организовать процесс | R1 (рекомендуемый вариант) — 3 варианта проанализированы, каша исключена тремя жёсткими правилами, раздел 5.3 |
| Аутентификация — исследовать | 7 вариантов проанализированы, таблица, рекомендация — раздел 7 |
| Агент не должен уметь опубликовать | TouchID gesture в publish.sh (единственный физический барьер), fallback TTY-confirm, раздел 7.3 |
| Именование компонента ядра | `gosleep-core`, обзор индустрии — раздел 3.1 |
| Сохранить решения red-team | R1-R25 из редакции 1 перенесены + 13 новых (R26-R38), раздел 12 |
| Честные сроки | 30-38 дней с +40% buffer, раздел 11 |

---

## Приложение Б. Ссылки на источники (веб)

- Warren repo (Bun.serve + Drizzle SQLite + React+shadcn): https://github.com/jayminwest/warren
- Drizzle migrations doc: https://orm.drizzle.team/docs/migrations
- Drizzle + Bun SQLite guide: https://orm.drizzle.team/docs/sqlite/connect-bun-sqlite
- Hono vs Elysia 2026 (encore.dev): https://encore.dev/articles/elysia-vs-hono
- Prisma vs Drizzle vs Kysely 2026 (scihub101): https://scihub101.com/web-development/orms-prisma-vs-drizzle-vs-kysely-2026
- gh CLI Keychain OAuth token (discussion): https://github.com/cli/cli/discussions/8980
- gh CLI Keychain silent-unauth bug: https://github.com/cli/cli/issues/13317
- VS Code Remote Tunnels device-flow: https://code.visualstudio.com/docs/remote/tunnels
- macOS TouchID via LocalAuthentication (Swift): https://www.advancedswift.com/face-id-touch-id-swift/
- Tailscale SSH access on shared machines: https://tailscale.com/docs/features/tailscale-ssh

## Приложение В. Ссылки на внутренние материалы

- `findings/autosk-warren-ui.md` — детали Warren, AutoSK, Overstory.
- `findings/harness-landscape-ui.md` — рыночные паттерны.
- `findings/our-constraints.md` — наши инварианты (атомарность, GSL-194, standing rules, hook-фильтры).
- `redteam-verdict.md` — 3 critical / 5 major / 6 minor.
- `docs/plans/skills-governance-plan.md` — этапы 2, 3 (предпосылки), 4-5 (сервер).
- `docs/handoff/ORCHESTRATION-STATE.md` — standing rules и решения владельца.
- `docs/reports/web-admin-inventory-2026-08-03.md` — инвентарь текущего веба.

**Конец документа.**
