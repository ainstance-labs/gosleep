# Разведка: autosk / warren / overstory + новые игроки — 2026-07-24

> Аудит смены 73, волна 1, столп 1 мандата (`docs/prompts/2-deep-orchestrating-research.md`).
> Режим: read-only. Клоны — в `.research-cache/` (`autosk-0724` @ `8b4f3ec`, `warren` @ `7536ec89`,
> `overstory` @ `ff38f3f`, `5dive` @ `a1d7ef4`). Все ссылки вида `файл:строка` — на эти клоны.
> Данные GitHub API сняты 2026-07-24 ~21:20 local.

---

## Резюме

1. **Все три цели живы по-разному.** autosk — жив (пуш сегодня, 18 коммитов за 3 недели, релиз
   v0.2.5), но **ядро оркестрации за 2.5 недели не изменилось**: движок вырос на 47 строк, всё
   остальное — UI, тесты и один новый workflow. warren — жив и бешено активен (49 коммитов,
   версия 0.10.1), но сделал **разворот**: выпилил и conversations (чат), и plot (общий
   человеко-агентный субстрат) — то есть ровно те две подсистемы, которые ближе всего к нашей
   «лаборатории». overstory — **архивирован** (read-only с 28.05), но у него 1331 звезда против
   125 у warren: самый популярный из трёх — мёртвый.
2. **Главная новость не в конкурентах, а в платформе.** Claude Code 2.1.219 (наша установленная
   версия) уже штатно умеет: фоновые сессии под **отдельным supervisor-процессом** (`claude
   agents`), локальный планировщик Desktop-задач (1 мин, catch-up пропущенных, самоперепланирование),
   облачные Routines, **Channels** (Telegram/Discord/iMessage пушат события внутрь живой сессии
   плюс relay разрешений) и Remote Control. Это закрывает бóльшую часть проблемы «кто оркестрирует
   оркестратора» штатно. Наш самодельный tmux+launchd watchdog не обесценен полностью, но его
   уникальная ценность сузилась.
3. **Опасение владельца про `claude -p` не подтвердилось.** И autosk, и overstory зовут именно
   `claude -p`, и оба полагаются на уже залогиненный CLI, а не на API-ключ — то есть **подписка
   работает**. Анонс Anthropic про отдельные Agent-SDK-кредиты с 15.06.2026 был **отменён до
   выката**. Плюс в CLI есть `claude setup-token` — «long-lived authentication token (requires
   Claude subscription)».
4. **Самый значимый новый игрок — 5dive** (28 звёзд, но 100+ коммитов за 3 недели, релизы режутся
   сегодня). Он решает ровно нашу задачу и решает её так, как мы ещё не пробовали: оркестратор — это
   ОС (systemd + cron + unix-пользователи), а не агент; вопросы к человеку — типизированные gate'ы
   с тремя уровнями риска, TTL-автоприменением и **обучением на прецедентах**; автономность
   **измеряется** публичной метрикой.
5. **Что брать в первую очередь:** (1) риск-тиры gate'ов с TTL и прецедентами из 5dive — это
   апгрейд нашего манифеста решений; (2) лестницу восстановления detect→classify→act→escalate из
   5dive fleet-supervisor и ZFC-принцип из overstory — в наш watchdog; (3) осознанную миграцию на
   платформенные supervisor/Channels вместо части самописного.
6. **Где мы уже сильнее:** наш манифест решений с provenance-цитированием, наша связка Jira+GitHub
   как источник истины, наш watchdog с позитивной идентификацией панели и разбором quiesce-режимов —
   этого нет ни у кого из троих.

---

## Профили проектов

### autosk

- **Состояние:** HEAD `8b4f3ec` «fix: preserve workflow step declaration order (#17)» от
  2026-07-24 05:59 −0400; `pushed_at` = 2026-07-24T09:59:46Z. **27 звёзд**, 6 форков,
  3 watcher'а, 0 открытых issue. Создан 2026-05-13. Автор один — `wierdbytes`, плюс два внешних
  контрибьютора за период (`Nikita Bogomolov`, `c436zhan`). **18 коммитов с 03.07**, последний
  тег **v0.2.5** (2026-07-21). Лицензия MIT. Проект живой, но это по-прежнему соло-проект
  без сообщества.

- **Что изменилось с 2026-07-10:** диапазон `fd4c22e..8b4f3ec` — 82 файла, +4116/−197. Разбор:
  - **Ядро оркестрации почти не тронуто.** `git diff --stat fd4c22e..origin/main --
    daemon/extensions/claude-agent daemon/core/src/engine daemon/core/src/store` даёт ровно два
    файла: `engine/context.ts` (+1/−3) и `engine/engine.ts` (+45/−2). Это **hot-reload
    расширений** (коммит `ad81ee0` «hot-reload extensions on ext add/remove without a daemon
    restart»). Планировщик, транзит, crash recovery, `claude -p`-драйвер — байт в байт те же,
    что описаны в наших заметках 07-07.
  - **Новый workflow `@autosk/gh-review`** (`6e28b69`, 2026-07-21) — односеточный ревью
    GitHub issue/PR через read-only `gh` в докере: `daemon/extensions/gh-review/src/index.ts`
    (265 строк), промпт в `prompts/review.md`. Показательно: единственная новая
    оркестрационная фича за период — не про автономию, а про добавление ещё одной роли.
  - **UI-полировка:** восстановление последнего активного проекта между перезапусками
    (`gui/src/features/projects/utils/activeProject.ts`), контекстное меню «Open in Browser»
    для внешних ссылок, открытие http(s)-ссылок session-лога в системном браузере.
  - **Багфиксы транспорта:** UTF-8-руны, разорванные на границе RPC-чанка (`6367cb9`);
    сохранение порядка объявления шагов workflow (`8b4f3ec`).
  - **Новый док `docs/shipped.md`** — каталог поставляемых workflow и агентов (Diataxis).
  - **Вывод:** за 2.5 недели autosk не изменил ни одного ответа на наши вопросы. Наши заметки
    07-07 и 07-10 по нему **остаются валидными**.

- **Супервизия оркестратора:** *проблема снята архитектурно, а не решена механизмом.*
  Оркестратор в autosk — **не LLM, а детерминированный демон** (`autoskd`, Bun/TS). Заголовок
  `daemon/core/src/engine/engine.ts:1-19`: «single scheduler loop + global worker pool, session
  lifecycle, ctx.transit commit path, per-session MCP server, transcript writer, steer/followup/
  abort routing, **and crash recovery**». У демона нет контекстного окна, он не «заканчивается»,
  ему не нужен надзиратель-агент. Вместо супервизии — **crash recovery при рестарте**:
  `engine.ts:534-551` — любая сессия, оставшаяся в статусе `running` ИЛИ `queued`, помечается
  `failed: daemon_restart`, а её задача паркуется в `human`. То есть после падения демона
  **работа никогда не теряется молча — она всегда всплывает человеку**.
  Второй защитный слой — **hazard guard** (`daemon/core/src/extensions/hazard.ts:1-26`): при
  каждом открытии/перезагрузке проекта все `work`/`human`-задачи валидируются против живого
  реестра расширений; задача, указывающая на исчезнувший workflow или шаг, паркуется в `human`
  с `error="workflow_missing: …"`. Отдельно обработан случай «workflow удалили, но сессия ещё
  бежит» (`hazard.ts:52-58`, предикат `isLive`) — живую сессию не выдёргивают из-под себя.

- **Headless / claude -p / подписка:** `daemon/extensions/claude-agent/src/index.ts:389-419` —
  точный набор аргументов:
  `claude -p --output-format stream-json --input-format stream-json --verbose
  --include-partial-messages --replay-user-messages`, далее опционально `--mcp-config`,
  `--model`, `--effort`, `--dangerously-skip-permissions` либо `--permission-mode acceptEdits`,
  `--allowedTools`, `--disallowedTools`, `--append-system-prompt`, `--bare`.
  **Про подписку — прямая цитата из их же документации** (`docs/shipped.md`, раздел
  `@autosk/feature-dev-cc`): «Requirements. `claude` (the Claude Code CLI) on `PATH` or at
  `$AUTOSK_CLAUDE_BIN`, **already authenticated**». Никакого `ANTHROPIC_API_KEY` в требованиях
  нет. Значит autosk работает на том же кредентиале, что и интерактивный `claude`, — **подписка
  подходит**. Там же явно про безопасность: «Every agent step runs with
  `dangerouslySkipPermissions: true` … The run is unattended — a headless permission prompt would
  abort the turn — and isolated in its per-task worktree, so **the worktree is the safety
  boundary**».

- **Loop engineering:** это по-прежнему сильнейшая часть autosk, и она не изменилась.
  - **Итерация = одна сессия = один вызов `onRun` для одной задачи на одном шаге.** Шаг обязан
    завершиться вызовом MCP-инструмента `transit`.
  - **Защита от зацикливания — счётчик посещений шага.** `daemon/core/src/store/metadata.ts:21`
    резервирует ключ `step_visits`; `engine/transition.ts:89-99` отдаёт workflow'у
    `ctx.visits(step)`. Референсный workflow применяет это как порог:
    `daemon/extensions/feature-dev/src/index.ts:82-85` — переход в `dev` при
    `ctx.visits("dev") >= DEV_VISIT_CAP` (=5) **отклоняется**, и задача паркуется человеку.
    Счётчик **персистентный и сбрасываемый руками**: `autosk metadata unset <id> step_visits`.
  - **Kickback-бюджет** (по нашим заметкам 07-07, код не менялся): если модель закончила ход, не
    вызвав `transit`, её перепромптят до 3 раз, после чего задача паркуется с
    `agent_did_not_transit`.
  - **Circuit breaker в классическом смысле (backoff/ретраи с экспонентой) отсутствует.**
    Единственный «предохранитель» — парковка в `human`. Проверено: `grep -i
    "circuit.?breaker|backoff|retryBudget|maxRetries"` по `daemon/core/src/` не даёт ни одного
    совпадения.
  - **Планирование событийное, не polling.** `engine.ts:51-57` + `DEFAULT_RESCAN_MS = 30_000`
    (`engine.ts:63`) — 30-секундный rescan назван «slow backstop, not a poll loop», нужен только
    для правок файлов мимо демона. Пул воркеров — глобальный FIFO, `DEFAULT_WORKERS = 4`.
  - **Никакого cron/расписания нет.** Единственные таймеры в ядре — rescan и idle-shutdown
    (`rpc/daemon.ts:347`). Сайт autosk.app про расписания молчит.

- **Вопросы к человеку / манифест:** **манифеста решений нет вообще.** Есть один-единственный
  механизм — статус `human`, в который задача паркуется отовсюду: визит-кап, не-транзит,
  рестарт демона, пропавший workflow, явный `statusStep("human")` в графе (шаг `accept` в
  feature-dev). Тезис их сайта: «When in doubt, work parks to human — never lost». Это
  честный, но **тупой** механизм: он не различает типы вопросов, не имеет дедлайнов, не умеет
  решать за человека и ничему не учится. Наш манифест решений заметно умнее.

- **UI и мобильный доступ:** три фронтенда, все — тонкие JSON-RPC клиенты одного демона: Go CLI,
  Go TUI (`autosk lazy`, gocui), Tauri GUI (React/Vite). **Мобильный подход стоит украсть
  целиком.** `gui/README.md:181-196`: компактный shell — это «**a second presentation of the
  same store**, with no new state, reducer, selector, or RPC»; хук `useIsCompact`
  (`matchMedia` через `useSyncExternalStore`) переключает ветку на повороте/ресайзе; все
  компактные правила лежат в одном `styles/mobile.css`, импортируемом последним, **за одним
  media-query**, «so the desktop/iPad layout is byte-for-byte unchanged and no new
  `invoke`/`listen` site is added». Навигация — ровно один уровень вглубь: `MobileTopBar`,
  полноэкранный список, `MobileTabBar` (Tasks / Sessions / Workflows). iOS: каждый тег, включая
  пре-релизы, льётся в **TestFlight** (`gui/README.md:268-269`) — то есть это по-прежнему бета,
  не App Store.

- **Память и состояние:** БД нет принципиально — всё файлами под `.autosk/`, git-diffable.
  Задача — файл-запись со статусами `new → work → (done|cancel|human)`, свободный
  metadata-мешок с зарезервированным `step_visits`. Межролевая память — **комментарии**: сайт
  формулирует это как «Agents pass work through comments; every prior comment is injected at the
  top of the next step's prompt, so context carries between roles». Транскрипты сессий пишутся
  и **не чистятся** — `engine.ts:531` прямо: «No retention/GC — session files just accumulate».

- **Что берём себе:**
  1. **(высокий)** Мобильный принцип «вторая презентация того же стора». Наше место —
     `tools/lab/ui` + `docs/lab/site/*.html` + `docs/lab/mobile/`. Сейчас у нас мобильный вид
     живёт отдельной сущностью; один media-query поверх общего состояния убирает целый класс
     расхождений «десктоп показывает одно, телефон другое».
  2. **(высокий)** **Hazard guard при старте**: валидировать все in-flight сущности против живой
     конфигурации и парковать несогласованные. Наше место — старт оркестратора и
     `tools/watchdog/watchdog.sh`. У нас задача, ссылающаяся на исчезнувшую фазу PRD или снятый
     эпик, зависает невидимо; autosk такие случаи выносит наверх принудительно
     (`hazard.ts:17-25`).
  3. **(средний)** **Персистентный, сбрасываемый руками счётчик визитов** как штатный anti-loop.
     Наше место — `docs/lab/status.json` / очередь задач. Наш нынешний anti-loop опирается на
     суждение оркестратора; счётчик в durable-состоянии переживает и перезапуск, и смену
     оркестратора, и его можно обнулить одной командой.
  4. **(средний)** Формулировка «**worktree — это граница безопасности**» как явное основание для
     `--dangerously-skip-permissions`. Наше место — политика разрешений воркеров. Это даёт
     защитимый ответ на вопрос «почему мы отключаем промпты ночью».
  5. **(низкий)** `docs/shipped.md` как жанр — каталог «что у нас вообще есть из ролей и
     сценариев» в стиле Diataxis. Наше место — `docs/lab/README.md`.

- **Где мы сильнее:**
  - У нас есть **манифест решений с provenance** (`docs/lab/decisions/manifest.md`: каждое
    автономное решение обязано цитировать пункт манифеста по номеру раздела и имени буллета).
    У autosk
    единственная реакция на неопределённость — парковка.
  - У нас **очередь вопросов с дедлайнами** (`docs/lab/questions/queue.jsonl`, 43 записи,
    `auto_apply_at`). У autosk вопросов как сущности нет.
  - У нас **интеграция с Jira/GitHub как источником истины**. autosk — самодостаточный трекер
    в файлах, без внешнего мира.
  - У нас **утренний дайджест** — у autosk нет ничего, что подводит итог ночи.

---

### warren

- **Состояние:** HEAD `7536ec89` от 2026-07-23, `pushed_at` = 2026-07-24T09:07:39Z. **125 звёзд**,
  38 форков, 9 открытых issue. Создан 2026-05-08. **49 коммитов с 03.07**, автор фактически
  один — Jaymin West (плюс бот-коавтор `warren`, то есть проект строит сам себя). Теги **v0.10.0**
  и **v0.10.1** (2026-07-21), `package.json` = `0.10.1`. Лицензия MIT. Появился Discord.
  Проект живой и самый быстрый из троих.

- **Что изменилось с 2026-07-10:** это не инкремент, а **смена курса**. Диапазон
  `c3508c5..7536ec89` — 637 файлов, **+47551 / −42111**. Три сюжета:
  1. **Kubernetes-миграция (v0.10.0, PR #609, 2026-07-17).** Введён swappable
     `RuntimeProvider` (`src/runtime/registry.ts`, контракт `src/runtime/contract.ts`) с двумя
     реализациями: `local` (один контейнер, warren + burrow-песочница через `bwrap`) и `k8s`
     (под на прогон, песочница = граница пода, burrow отсутствует). Fly.io выпилен
     (`dd40a8e5` «chore(deploy): strip Fly.io hosting story — GKE is the deploy path»).
  2. **Deletion pass — удалены conversations и plot.** Это ключевое для нас. `docs/PHILOSOPHY.md`
     строки 50-54, поправка от 2026-07-17 дословно: «plot, conversations (brainstorming/chat),
     and canopy fail a *prior* test — **they have no users**. They are being **deleted outright**,
     not re-platformed (rule 8). A deleted feature can return as an extension when someone wants
     it badly enough to pay for the API it needs.» Порядок сноса зафиксирован в
     `PHILOSOPHY.md:167-171`. Проверено на диске: `src/plots/`, `src/plot-client/`,
     `src/ui/src/components/Chat.tsx` **отсутствуют**. Вместе с conversations ушёл и агент
     **`leveret` (overseer)** — его больше нет в `src/registry/builtins/` (удалён в `5fc9a36f`,
     остались только упоминания в тесте и k8s-entrypoint).
     Правило 8 из `PHILOSOPHY.md:133-137`: «**Unused features are deleted, not re-platformed.**
     … deletion is the honest form of subtraction».
  3. **Слой самолечения планировщика.** Целиком новая директория механики в `src/triggers/`:
     `cron-retry.ts`, `project-heal.ts`, `scheduled-pass.ts`, `dispatch.bounded-retry.test.ts`,
     `tick.self-heal.test.ts`. Плюс `src/workspace/` (materialize, git/worktree, git/identity,
     git/credential-env) — 15 новых файлов.

- **Супервизия оркестратора:** решена **процессно, вне LLM, в два этажа**.
  - **Этаж 1 — supervisor как ENTRYPOINT контейнера** (`src/supervisor/main.ts:1-23`). Три
    обязанности: порядок загрузки (burrow должен открыть unix-сокет до старта warren),
    форвардинг сигналов (SIGTERM/SIGINT обоим детям, 5с grace, затем SIGKILL) и политика
    рестарта. Политика сформулирована очень точно и её стоит процитировать целиком:
    «Warren is the user-facing process; if it crashes, hand the failure to the orchestrator
    (docker) so its restart policy decides what to do — **never mask a warren bug with an
    in-process restart loop**. Burrow is the runtime substrate; restart it inside the container
    with an exponential backoff and a **5-in-60s budget**… After the budget is exhausted, exit
    non-zero so the orchestrator restarts the whole container.»
  - **Этаж 2 — Docker/K8s restart policy.** То есть «кто супервизирует супервизора» отвечено
    делегированием наружу, к оркестратору контейнеров.
  - **Реализация бюджета** — `src/supervisor/budget.ts:15-49`: `RestartBudget` со скользящим
    окном; `backoffMs(attempt, base=1000, cap=16000)` даёт 1+2+4+8+16 = 31с, «comfortably
    inside the 60s window» (`budget.ts:51-56`). Это **готовый, протестированный circuit
    breaker** — самый чистый из всех, что я видел.

- **Headless / claude -p / подписка:** warren **не запускает `claude -p` сам** — он делегирует
  песочнице (burrow по unix-сокету либо поду K8s). Требуется `ANTHROPIC_API_KEY`
  (`README.md`, таблица обязательных переменных: «Forwarded to agent runtimes that need it»).
  **Это единственный из трёх, кто действительно не работает по подписке**, и причина
  архитектурная: агент бежит в изолированном контейнере/поде, где нет залогиненного CLI и нет
  доступа к keychain хоста. Для нас вывод обратный ожидаемому: **не headless-режим ломает
  подписку, а изоляция в контейнере**. Пока мы гоняем агентов на хосте владельца — подписка жива.

- **Loop engineering:** цикл у warren короткий и одноразовый — «complete a task, validate, push a
  branch, spin down». Настоящий loop-инжиниринг у них не в прогоне, а **в планировщике**:
  - **Тик 60с, single-flight** (`src/triggers/tick.ts:1-38`): перекрывающиеся тики
    **отбрасываются**, а не копятся — «A slow tick … degrades effective cadence but never causes
    duplicate fires». `stop()` дожидается слива текущего тика.
  - **Ограниченный ретрай cron-слота** (`src/triggers/cron-retry.ts:1-33`) —
    `MAX_CRON_TRANSIENT_RETRIES = 5`. Мотивировка написана по следам реального инцидента:
    «Left unbounded, a persistently-unreachable runtime … retries every tick forever, minting one
    `never_started` run row per tick (**~200 rows in 3h observed on GKE**)». После исчерпания
    слот «съедается» и логируется `scheduler.cron_gave_up`. Состояние **только в памяти**, и это
    осознанно: «A warren restart resets every counter, which is acceptable».
  - **Самолечение проекта + rate-limit уведомлений** (`src/triggers/project-heal.ts:1-30`): если
    клон проекта пропал с диска (эфемерный том в K8s) — **переклонировать**, а не валить тик;
    повторные уведомления об одной и той же неустранённой проблеме — не чаще раза в час
    (`NOTICE_INTERVAL_MS = 3_600_000`), попытки переклонирования — с экспонентой
    (`RECLONE_BACKOFF_BASE_MS = 300_000`, потолок `RECLONE_BACKOFF_MAX_MS = 3_600_000`).
  - **Терминальность гейтов качества** — системный промпт `claude-code` builtin (по заметкам
    07-07, файл на месте): «Quality gates are terminal, not advisory. You are NOT done until the
    gate exits zero… If genuinely unfixable, say so explicitly and leave the work open rather
    than claiming success».
  - **Патрульные агенты живы:** `nightwatch` (ночной cron: сканирует репо → выпускает seeds-план
    правок, **сам не чинит**; при `auto_plan_run: true` reap автоматически диспатчит plan-run на
    каждый новый план — `src/registry/builtins/nightwatch.ts:1-17`), `bugwatch`, `healer`
    (`healer.ts:1-22`: замкнутый цикл починки по продовому алерту Sentry/Grafana — читает
    контекст алерта, воспроизводит, чинит минимально, гоняет гейт локально, коммитит; guard-rails
    — «per-fingerprint max retries, cooldown, per-project opt-in» — лежат **на стороне warren, а
    не агента»**), `pr-fixer`, `planner`.

- **Вопросы к человеку / манифест:** **был и удалён.** plot был «shared human+agent event-log
  coordination substrate» с единой лентой человеческих и агентских событий и inline-карточками
  ответов на открытые вопросы. Теперь его нет. Осталась только техническая эскалация:
  `POST /runs/:id/steer` кладёт сообщение в inbox агента, следующий ход его подхватывает.
  Манифеста решений нет и не планируется. **Это самый важный негативный сигнал разведки**:
  единственный из троих, кто построил нашу «лабораторию», снёс её через два месяца с
  формулировкой «у неё нет пользователей». Для нас это не приговор (у нас пользователь ровно
  один и он есть), но это повод не раздувать субстрат ради красоты.

- **UI и мобильный доступ:** React/Vite/shadcn SPA в одном процессе с сервером, три тонких
  клиента одного пайплайна (Web UI, `warren` CLI, HTTP API). Живой поток событий — NDJSON,
  персистится в SQLite, тейлится через `GET /runs/:id/events?follow=1`; UI, CLI и HTTP едят
  один и тот же стрим. **Мобильного клиента нет.** Workspace UI (вкладки Plan/Run/Activity),
  который был главной человеко-ориентированной поверхностью, **удалён вместе с plot** — при этом
  `README.md` про него всё ещё рассказывает и всё ещё пишет «Stable (`0.9.10`)». То есть README
  отстал от кода: **читать их README как источник истины сейчас нельзя**.

- **Память и состояние:** SQLite (`bun:sqlite` + drizzle), опционально Postgres через
  `WARREN_DB_URL`. Долговременная память агентов — `mulch` (`.mulch/`), очередь задач —
  `seeds` (`.seeds/`, git-native). Правило 5 их философии (`PHILOSOPHY.md`): «**Data formats are
  API.** The JSONL run-event stream, the events table, the OpenAPI surface — machine-readable at
  every boundary.» Восстановление после рестарта покрыто приёмочным тестом (38 сценарных тестов
  в `scripts/acceptance/`, среди них «restart recovery»).

- **Что берём себе:**
  1. **(высокий)** **`RestartBudget` — 5 рестартов в 60с + экспонента 1/2/4/8/16с.** Наше место —
     `tools/watchdog/watchdog.sh`. У нас есть re-wake, но нет **бюджета**: watchdog,
     столкнувшийся с оркестратором, который падает сразу после старта, будет будить его всю ночь.
     Это дословно переносимая, уже протестированная структура данных (`budget.ts:15-49`).
  2. **(высокий)** **Rate-limit повторных уведомлений об одной и той же неустранённой проблеме**
     (раз в час) + экспоненциальный backoff попыток лечения. Наше место — эскалации watchdog'а и
     `docs/lab/questions/queue.jsonl`. Их мотивация — реальный инцидент на 200 мусорных записей
     за 3 часа; у нас ровно тот же риск — забить утренний дайджест одним и тем же вопросом.
  3. **(высокий)** **Single-flight тик: перекрывающиеся срабатывания отбрасывать, а не копить.**
     Наше место — пульс оркестратора и цикл watchdog'а. Формулировка «медленный тик деградирует
     каденцию, но никогда не даёт дублирующий запуск» — то, чего нам не хватает при медленном
     пульсе.
  4. **(средний)** **Разделение ролей «патруль планирует — исполнитель чинит»** (nightwatch не
     правит код, он выпускает план; reap автоматически диспатчит прогон на каждый пункт). Наше
     место — ночные автономные циклы. Это чище, чем один агент, который сам нашёл и сам починил.
  5. **(средний)** **Guard-rails живут на стороне control plane, а не в промпте агента**
     (`healer.ts:16-18`: «per-fingerprint max retries, cooldown, per-project opt-in … live on the
     warren side; this agent only does the repair work»). Наше место — граница между
     `SKILL.md` и `tools/`. У нас слишком много предохранителей живёт в тексте скилла, то есть
     зависит от того, прочитала ли их модель.
  6. **(средний)** Правило «**Data formats are API**» + один NDJSON-стрим на всех потребителей.
     Наше место — `docs/lab/events/*.jsonl` и `render_bundle.json`. Мы близки к этому, но UI
     иногда читает не тот же поток, что генераторы отчётов.
  7. **(низкий, но отрезвляющий)** Правило 8: «**Unused features are deleted, not
     re-platformed**». Наше место — ревизия `docs/lab/`: что из построенного владелец реально
     открывал?

- **Где мы сильнее:**
  - **Мы работаем по подписке, они — нет.** Это не мелочь: их архитектура требует API-ключа
    структурно.
  - У нас есть **человеческий контур** (манифест, вопросы, дайджест). Они его построили и снесли —
    у нас он востребован ровно тем одним пользователем, ради которого делается.
  - У нас **Jira+GitHub как внешний источник истины**; у них своя `seeds` внутри репо.
  - Их README **разошёлся с кодом** (обещает Plot UI и версию 0.9.10 при фактических 0.10.1 и
    удалённом Plot). У нас `ORCHESTRATION-STATE.md` держится синхронно.

---

### overstory

- **Состояние:** **АРХИВИРОВАН** (`archived: true`), read-only. Последний коммит `ff38f3f`
  2026-05-28 — «docs: mark overstory as no longer maintained / archived». Нового с 07-10 нет:
  `git log ff38f3f..origin/main` пуст. При этом **1331 звезда и 209 форков** — на порядок больше
  warren'а. То есть популярность собрал мёртвый проект, а живой преемник (warren) её не
  унаследовал. Прямая цитата из README: «Active development has moved to **Warren** … overstory's
  spiritual successor».
  Стоит отметить и их же предупреждение (README): «**Agent swarms are not a universal solution.**
  Do not deploy Overstory without understanding the risks … compounding error rates, cost
  amplification, debugging complexity, and merge conflicts are **the normal case, not edge
  cases**». Есть отдельный `STEELMAN.md` с разбором рисков.

- **Что изменилось с 2026-07-10:** ничего. Доказательство: `git fetch` не принёс ни одного
  нового коммита, `pushed_at` = 2026-05-28T17:12:46Z, флаг `archived` = true.

- **Супервизия оркестратора: это главная причина смотреть на overstory, и там лежит готовая
  четырёхэтажная модель.** `src/watchdog/daemon.ts:1-22` объявляет нумерацию этажей дословно:
  ```
  Tier 0 = Mechanical daemon (this file)
  Tier 1 = Triage agent (triage.ts)
  Tier 2 = Monitor agent (not yet implemented)
  Tier 3 = Supervisor monitors (per-project)
  ```
  - **Tier 0 — механический демон** с прогрессивным «подталкиванием» вместо мгновенной эскалации:
    `Level 0 (warn)` → `Level 1 (nudge)` (tmux-нудж) → `Level 2 (escalate)` (вызов Tier-1
    AI-триажа) → `Level 3 (terminate)` (убить tmux-сессию). Уровень вычисляется **по времени
    застоя**, а не по числу тиков: `daemon.ts:920-928` —
    `expectedLevel = min(floor(stalledMs / nudgeIntervalMs), MAX)`; при возврате к работе
    `escalationLevel` и `stalledSince` **сбрасываются** (`daemon.ts:975-979`).
  - **Tier 1 — AI-триаж** (`src/watchdog/triage.ts:1-27`): читает последние 50 строк
    `session.log` и просит Claude классифицировать ситуацию. Вердикт — строго один из трёх:
    `retry` | `terminate` | `extend`. Возвращается структурой с полем **`fallback: boolean`** —
    «True when the verdict is a safe default (no AI analysis performed)», чтобы вызывающий
    отличал реальный вердикт ИИ от подстраховки. Дефолт при недоступности Claude — `extend`,
    то есть **дать ещё время**, а не убить.
  - **ZFC — Zero Failure Crash** (`src/watchdog/health.ts:1-32`). Принцип: «**Observable state is
    the source of truth, not recorded state**». Приоритет сигналов: (1) живость tmux-сессии,
    (2) живость процесса (pid), (3) записанное состояние. Разобраны все конфликты сигналов, в
    том числе неочевидные: «pid dead + tmux alive → the pane's shell survived but the agent
    process exited. Treat as zombie»; «tmux alive + sessions.json says zombie → **investigate,
    don't auto-kill**». Обоснование: «sessions.json is updated asynchronously by hooks and can
    become stale if the agent crashes between hook invocations. tmux and the OS process table are
    always up-to-date because they reflect real kernel state». Отдельно оговорены headless-агенты
    (`tmuxSession === ''`): для них PID — первичный сигнал живости, tmux игнорируется.
  - **Координатор — это агент уровнем выше оркестратора, и он сам под надзором Tier 0.**
    `src/commands/coordinator.ts:1-13`: координатор бежит в корне проекта (не в worktree),
    получает работу через mail и задачи, диспатчит агентов через `ov sling`; у него нет worktree,
    нет назначенной задачи («it creates tasks, not works on them»), нет overlay-CLAUDE.md, и он
    **переживает пачки работы** (persists across work batches).
    Ключевая деталь для нас — **как именно надзирают за долгоживущим координатором, чтобы не
    убить его за простой**. Введена «persistent capability»: тесты
    `src/watchdog/health.test.ts:262-353` фиксируют контракт — координатор с устаревшей
    активностью → «still working, no escalation»; координатор с застоем зомби-уровня → «still
    working»; **но** координатор с мёртвым tmux → зомби (ZFC правило 1), с мёртвым pid → зомби
    (ZFC правило 3). То есть **простой ему прощают, смерть — нет**.
  - **Обратная связь снизу вверх:** `daemon.ts:269-326` — когда все агенты прогона достигли
    терминального состояния (`completed` или `zombie`), демон **нуждит координатора**, чтобы тот
    не завис навсегда в ожидании; в комментарии `daemon.ts:303` прямо сказано, что зомби надо
    включать в этот подсчёт, иначе «strand the coordinator forever (overstory-e130)» — то есть
    это правка по реальному инциденту.

- **Headless / claude -p / подписка:** `src/runtimes/claude.ts:255-272` — тот же headless-набор:
  `-p --output-format … --input-format … --verbose --strict-mcp-config --permission-mode …`,
  опционально `--model` и **`--resume <sessionId>`**. Есть и простой одноразовый режим:
  `claude.ts:95` — `["claude", "--print", "-p", prompt]`. Про ключ — только «*may* include
  `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`» (`claude.ts:547`), обязательным он не является:
  **подписка работает**. Плюс `--strict-mcp-config` (жёстко фиксировать MCP-конфиг прогона) —
  флаг, которого нет у autosk и который нам полезен для воспроизводимости ночных прогонов.

- **Loop engineering:** цикла-как-графа у overstory нет — есть рой worktree-агентов, координируемых
  через SQLite-почту, и слияние с трёхуровневым разрешением конфликтов. Anti-loop реализован не
  в прогоне, а в watchdog'е (лестница эскалации выше). Есть `--resume <sessionId>`, то есть
  восстановление конкретной сессии, а не только перезапуск с нуля.

- **Вопросы к человеку / манифест:** манифеста нет. Есть `ov coordinator ask` с polling
  (`ASK_POLL_INTERVAL_MS = 2_000`, `ASK_DEFAULT_TIMEOUT_S = 120`) — синхронный вопрос
  координатору, а не накопительный буфер к человеку. UI-примитив `PendingBubble.tsx` в
  `ui/src/routes/coordinator/` — ближайшее к «окну накапливающихся вопросов», но это чат
  координатора, а не типизированная очередь.

- **UI и мобильный доступ:** веб-UI через `ov serve`, отдельный роут `coordinator/` (Thread,
  Composer, StatusPill, PendingBubble, ConsolePage, NewRunDialog). `tmux attach` — «opt-in escape
  hatch for live steering». Мобильного нет.

- **Память и состояние:** SQLite-почта (`src/mail/`), `mulch` (память), `beads` (трекер),
  `canopy`, событийный стор + tailer логов, `sessions.json` как записанное состояние — которому,
  по ZFC, доверять нельзя.

- **Что берём себе:**
  1. **(критический)** **ZFC-принцип целиком** — «наблюдаемое состояние важнее записанного», с
     явной таблицей разрешения конфликтов сигналов. Наше место — `tools/watchdog/watchdog.sh`.
     Мы уже близки (наш watchdog судит по mtime heartbeat-файла + живости tmux), но у нас **нет
     явно выписанной матрицы конфликтов** и нет правила «tmux жив + записано зомби → разбираться,
     НЕ убивать». Это ровно тот класс ошибок, который однажды убил живой флот.
  2. **(критический)** **«Persistent capability» для координатора/оркестратора**: долгоживущему
     надзирателю прощается простой, но не смерть. Наше место — правила watchdog'а для панели
     оркестратора. У нас похожая идея реализована через `status:"quiesced"`, но она завязана на
     **самодекларацию оркестратора в heartbeat**; overstory даёт то же свойство **по роли**,
     что надёжнее (мёртвый оркестратор ничего о себе не задекларирует).
  3. **(высокий)** **Прогрессивная лестница с временны́м вычислением уровня**
     `level = floor(stalled/interval)` и сбросом при возврате к работе. Наше место — эскалации
     watchdog'а. У нас лестница есть (нудж → kill → re-wake), но уровень не выводится из времени
     и не сбрасывается формально.
  4. **(высокий)** **Триаж-вердикт из трёх значений с флагом `fallback`.** Наше место — решение
     watchdog'а «что делать с застрявшей панелью». Различать «ИИ посмотрел логи и сказал
     terminate» и «ИИ был недоступен, поэтому extend» — это то, чего у нас нет, и это ровно та
     честность, которой требует владелец от отчётов.
  5. **(высокий)** **Нудж координатора при терминализации всех воркеров.** Наше место — цикл
     watchdog'а. У нас оркестратор, уснувший в ожидании воркера, который умер зомби, будет ждать
     до истечения wakeup; overstory будит его сразу и специально считает зомби завершёнными.
  6. **(средний)** Флаг **`--strict-mcp-config`** для воспроизводимых ночных прогонов воркеров.
  7. **(средний)** `--resume <sessionId>` как альтернатива холодному перезапуску: восстановить
     сессию, а не начинать с handoff'а.

- **Где мы сильнее:**
  - Мы **живы**, а overstory архивирован — весь его код это музей, а не апстрим.
  - У нас **позитивная идентификация панели** (watchdog берёт `pane` из самого heartbeat'а,
    позиционные догадки запрещены, при неподтверждённой идентичности — `kill_refused`). У
    overstory идентификация проще и завязана на имя tmux-сессии.
  - У нас **манифест решений и очередь вопросов**; у них — синхронный `ask` с таймаутом 120с.
  - У нас честнее с рисками роя: мы не спавним больше 3 воркеров (эмпирический cap), у них
    предупреждение о рисках вынесено в README, но лимита нет.

---

### Новые игроки

Отбор — по критерию «полезно для „человек спит, система работает"», а не по звёздам.

#### 5dive (`5dive-ai/5dive`) — самый значимый

- **Состояние:** 28 звёзд, 3 форка, создан 2026-05-15, `pushed_at` = **2026-07-24T11:01Z**,
  **100+ коммитов за 3 недели** (API-запрос упёрся в потолок страницы), релизы **v0.14.1/2/3
  режутся сегодня**. Язык — **Shell**. Автор один (`lodar`), но по их заявлению релизы режут сами
  агенты. MIT, без open-core.
- **Тезис:** «**A company of AI agents, and the orchestrator is just bash.** No framework, no
  protocol, no broker: each agent is its own Linux user running an official coding CLI (claude,
  codex, …) as a **systemd service**, coordinating through one bash CLI they all call. Isolation is
  unix users, supervision is **systemd**, logs are journald. **I used the OS instead of building a
  platform.**»
- **Супервизия:** двухслойная и по-настоящему проработанная.
  - *Что есть сейчас:* systemd как супервизор процессов + `cmd_heartbeat.sh` (cron-тик).
  - *Что проектируется:* `docs/fleet-supervisor-design.md` — «Fleet Supervisor / Self-Healing
    Recovery Layer», статус «design draft». Они сами честно называют текущее состояние
    «heuristic and fragmented … **telling a wedged agent from a slow one is still more art than
    science**, and recovery actions are scattered with no ladder, no audit, no single escalation
    contract». Дизайн: одна cron-управляемая петля **detect → classify → act → escalate** с
    аудит-трейлом.
    - **DETECT** — таблица сигналов: systemd state, живость tmux, timestamp последнего
      токен-прогресса, флаг `stuck` у петли, живость поллера канала, **goal-drift** (активная
      цель против фактических вызовов инструментов — «busy but off-task (burns money)»),
      устаревание CLI, здоровье авторизации (401/cooldown).
    - **CLASSIFY** — три класса: `healthy` / `slow` / `stuck`, причём для `slow` предписано
      **ничего не делать, только записать**. Главное правило: «**Bias toward false-negative**
      (miss a stuck agent) over false-positive (restart a healthy one), because restart is
      disruptive».
    - **ACT** — лестница от наименее к наиболее разрушительному: 1) nudge → 2) resume
      (авто-восстановление после транзиентной ошибки) → 3) rotate (сменить модель/аккаунт при
      401/rate-limit) → 4) restart poller / restart service → 5) reprovision. У каждой ступени —
      экспоненциальный backoff, максимум попыток, строка аудита.
    - **ESCALATE + HARD-GATE** — «The supervisor **auto-acts only on reversible, in-box recovery
      (rungs 1–4)**». Никогда не автовыполняет: reprovision/teardown, биллинг/ёмкость, и всё, что
      уже исчерпало лестницу. Эскалация = завести gate с внятной сводкой «**что я пробовал**»,
      «so the human sees the recovery history, not just „agent down"».
- **Цикл / heartbeat** (`src/cmd_heartbeat.sh:1-30`) — принцип «**1 нудж = 1 задача**»:
  один хостовый cron гоняет `5dive heartbeat tick` раз в несколько минут; на агента задаётся
  ровно один вопрос — «есть ли у него todo на общей доске»; нет задач → **не будить вообще**
  («burns zero tokens and **never starts its 5h usage window**» — прямая экономия квоты); уже
  `in_progress` → пропустить; есть задача → поднять агента, опционально `/clear` для свежего
  контекста, вбросить ОДИН нудж «сделай одну задачу и снова простаивай».
  Три предохранителя, все с обоснованием из инцидентов:
  - **Reaper**: задача в `in_progress` дольше `everyMin * 3` (минимум 45 мин) — принудительно
    закрывается. Мотивация дословно: «This is the real backstop — **/goal's own „stop after N
    turns" is model-judged and was observed to overrun**». Реапнутая задача **возвращается в
    todo, а не отменяется** — «silently losing real mid-flight work is worse than a re-run»; но
    после 2 реапов — блокируется и эскалируется.
  - **Starvation-детектор**: задача, которую нуднули 3 раза, но она так и не покинула `todo`
    (`started_at` пуст) — почти наверняка голодает; вместо бесконечного перенудживания это
    **всплывает**. Комментарий прямо отмечает, что reaper ловит только противоположный сбой.
  - **Gate SLA escalation**: T2-гейт без ответа 5 дней начинает **CC'ить родителя по оргчарту**
    (`agents_org.reports_to`) — «an unanswered gate walks the chain instead of stalling on one
    lane. **NEVER auto-answers a T2 gate: escalation changes WHO is pinged, not what clears.**»
- **Вопросы к человеку — самая сильная часть и прямой апгрейд нашего манифеста.**
  - **Типизированные гейты:** `5dive task need <id> --type=decision|secret|approval|manual|access
    --ask="..." [--options=A|B] [--recommend="A"] [--tier=0|1|2]` (`src/cmd_task.sh:56-61`).
  - **Три уровня риска** (`src/lib/tasks_db.sh:217-224`, дизайн DIVE-861/891):
    `0` = автоклир (рекомендация применяется НЕМЕДЛЕННО, без пинга, только строкой в дайджесте;
    **требует `--recommend`**); `1` = агент-клируемый, **через 48ч TTL heartbeat сам применяет
    рекомендацию**; `2` = жёсткий человеческий гейт, никогда не применяется автоматически, TTL
    лишь батчит напоминания. `NULL` (легаси) трактуется как tier 2.
  - **Пол по категориям не доверяется заявителю:** «Money, public comms, secrets and destructive
    asks are **FLOORED to tier 2 no matter what you pass**; secret is always tier 2» — и это
    enforced в `cmd_task_need`, а не в промпте.
  - **Конституция компании** (`docs/constitution.md`) — YAML-политика в
    `/var/lib/5dive/constitution.yaml`: `hard_gates` как **case-insensitive ERE-паттерны** по
    классам `spend_billing`, `public_comms`, `secrets`, `destructive`; пороги голосования совета,
    veto-принципалы (`human:main`) с posthoc-окном 172800с; `ship.require_ci`,
    `comms.public_requires_human`. Загрузчик атомарен: «If the file is absent or malformed, the
    loader atomically uses the shipped pre-constitution defaults; **it never applies a partial
    document**». Bash предварительно компилирует объединённый паттерн; если не компилируется —
    **вся загруженная карта отбрасывается** с падением на встроенный tier-2 floor. Человеческое
    обоснование живёт в `#`-комментариях: они покрыты цифровым дайджестом, но не парсятся как
    политика.
  - **Обучение на прецедентах** (`tasks_db.sh:243-258`, OSS-11/OSS-20): у каждого гейта считается
    `ask_shape` — нормализованная «форма вопроса» (идентификаторы, числа, суммы, даты, хосты,
    имена схлопнуты в типизированные плейсхолдеры); `precedent_ref` указывает на прошлый
    отвеченный гейт, чья формулировка **преднаполнила** рекомендацию текущего; `precedent_kind` —
    `'exact'` при точном совпадении формы либо `'fuzzy'` при token-set Jaccard ≥ 0.8.
    **Инвариант, который обязательно надо перенять:** «Both advisory-only: **they NEVER mutate
    tier or the clear path** — precedent sources the VALUE of a rec the tier would surface
    anyway, it never widens what a gate can self-clear»; и «**only 'exact' is promotion-eligible**
    (auto-clear reads exact match, never fuzzy)».
  - **Парковка с обязательной датой пробуждения:** `task park --reason --wake=<дата|+Nd|+Nh>`,
    оба параметра **обязательны**: «a park with no revisit date is **the block graveyard**».
  - **Массовый клир с телефона:** «go with recs» из проверенного DM применяет рекомендации ко
    всем гейтам tier<2; **tier-2 пропускаются** и требуют индивидуального тапа.
  - **Merge ≠ подпись человека:** если heartbeat находит в `origin/main` коммит, ссылающийся на
    открытый гейт, гейт **лишь помечается** «likely shipped, verify+close» — «a merge is not a
    human sign-off … this NEVER auto-answers/closes».
- **Метрика автономности** (`docs/zero-human.md`) — то, что владелец просил как «индикатор
  автономности», доведённое до публичного, атакуемого числа. Формула: `1 − asks/shipped` по
  скользящему 7-дневному окну. Определения жёсткие: `shipped` = задачи, дошедшие до `done`,
  причём нетривиальные **грейдит другой агент, не автор** («the maker never grades their own
  work»); `human asks` = гейты, отвеченные человеком (`need_answered_by` с провенансом `human:*`).
  Осознанно **не считаются**: решения, которые агент снял сам, и tier-автоклиры (по прецеденту
  или TTL) — «neither costs the human anything. The metric is **decision interrupts** that reach a
  person»; **один тап на телефоне считается** — «the interrupt is the cost, not the typing».
  Раздел «What it does not claim» перечисляет собственные слабости: self-reported; «direction is
  not counted» (постановка целей человеком не считается прерыванием); «tasks are not equal»;
  «one company». Публикация — ежедневный cron в append-only `history.jsonl` на ветке `status`;
  «The script has **no flag to edit a number**, and bad weeks publish exactly like good ones»;
  «**A stale badge means a broken pipeline, not a curated pause**».
- **Мобильный доступ:** Telegram/Discord на агента, **tap-to-answer кнопки**, рекомендация ведёт
  алерт как «✅ Recommended: <X>» и её кнопка помечена ⭐. Пейринг: DM боту → код → allowlist.
- **Подписка:** явно поддержана — «Requirements: a Linux box with `systemd` and **your own
  agent-CLI subscription or API key (Claude Pro/Max, OpenAI, …)**, no account with us»;
  «**A subscription that's yours.** Official CLIs on your own Pro/Max or keys. No middleman, no
  OAuth proxy». Несколько агентов могут делить один CLI-бинарь и одну подписку.
- **Где мы сильнее:** мы на macOS с tmux, у них Linux+systemd (их модель к нам напрямую не
  переносится — переносятся её *правила*); у нас связка с Jira/GitHub как внешним трекером; у нас
  верификация через отдельные HTML-дашборды приёмки.

#### agx (`ramarlina/agx`)

- **Состояние:** 26 звёзд, 5 форков, создан 2026-02-02, **`pushed_at` = 2026-05-06** — то есть
  **~2.5 месяца без коммитов**. TypeScript, MIT, npm-пакет `@mndrk/agx`, есть десктоп-приложение
  под macOS. Живым назвать нельзя, но не архивирован.
- **Почему попал в отбор:** его описывают как «checkpoint-based execution engine … durable
  **Wake→Work→Sleep** loops that resume instantly across sessions» — терминологически это ровно
  наша задача. Фактическое позиционирование в README мягче: «a local workspace for running coding
  agents across your tickets, repos, and PRs — **you stay the author**».
- **Что берём:** одну идею — «**тикет помнит контекст**»: «Picking up where you left off:
  ad-hoc → re-explain everything from scratch; agx → **instant — the ticket remembers**», плюс
  встроенные human-gates «approve/reject before anything irreversible» и первый проход ревью
  агентом-ревьюером, чтобы человек смотрел только то, что требует его суждения. Наше место —
  `docs/lab/` и утренний дайджест. Ничего уникально-механического сверх того, что уже есть у
  autosk/5dive, я в нём не нашёл; глубже кода не копал из-за неактивности (см. «Что не проверил»).

#### LoopTroop (`looptroop-ai/LoopTroop`)

- **Состояние:** 93 звезды, 7 форков, создан 2026-03-03, `pushed_at` = **2026-07-24** — живой и
  активный. TypeScript.
- **Тезис:** «LLM councils plan it. Ralph loops perfect it. OpenCode worktrees ship it.» Прямая
  атака на контекстную деградацию: «Instead of trusting a single, endless AI chat session — where
  the conversation history gets bloated, the AI gets confused, and code quality falls off a cliff
  — LoopTroop breaks the job into clean, separate stages».
- **Механика:** три слоя — Planning (интервью → PRD → атомарные «beads»), Execution (каждый bead
  прогоняется через несколько узконаправленных авто-фикс-петель **в изоляции**), Shipping
  (worktree → финальная верификация → handoff в main). Есть дашборд с per-bead логами и
  отдельным экраном «bead заблокирован ошибкой».
- **Что берём (средний приоритет):** **«совет LLM» на этапе планирования** — несколько моделей
  голосуют за план до начала работы. Наше место — фаза планирования эпика. И **«bead» как единица
  с собственной изоляцией и собственным циклом автофикса** — это дисциплинированнее нашей «задачи
  Jira», где цикл автофикса не формализован.

#### ralph-orchestrator (`mikeyobrien/ralph-orchestrator`)

- **Состояние:** **3074 звезды**, 290 форков, создан 2025-09-07, `pushed_at` = 2026-07-23 — самый
  популярный ЖИВОЙ проект в нише. **Rust**, MIT, есть Discord, mkdocs-документация, web-дашборд
  (alpha), MCP-сервер.
- **Механика:** «hat-based orchestration framework that keeps AI agents in a loop until the task
  is done». Поток: `ralph init --backend claude` → `ralph plan "…"` (интерактивная PDD-сессия,
  порождает `requirements.md` / `design.md` / `implementation-plan.md` в `.ralph/specs/<фича>/`) →
  `ralph run -p "…"`. **Условие выхода из цикла:** «Ralph iterates until it outputs
  `LOOP_COMPLETE` or hits the iteration limit» — то есть явный сентинел + жёсткий лимит итераций.
- **Что берём (средний):** пара «**явный строковый сентинел завершения + потолок итераций**» как
  двойное условие выхода. Наше место — автономные циклы воркеров. У нас выход из цикла — суждение
  модели; сентинел делает его машинно-проверяемым. И `--workspace-root` с детерминированной
  моделью «один MCP-сервер на репозиторий» — полезно, если мы будем поднимать MCP для лаборатории.

#### Aeon (`aeonfun/aeon`)

- **Состояние:** 579 звёзд, `pushed_at` = **2026-07-24** — живой. Репозиторий переехал
  (`aaronjmars/aeon` → `aeonfun/aeon`).
- **Тезис (описание репо):** «The most autonomous agent framework. **No approval loops. No
  babysitting. Configure once, forget forever.**» По вторичным источникам — работает без
  присмотра на **GitHub Actions**, оркестрирует 90+ скиллов, персистентная память,
  self-healing-петли.
- **Почему важен:** это единственный из найденных, кто ставит **CI как среду обитания
  оркестратора**. Для нас это альтернативный ответ на «кто оркестрирует оркестратора»: раннер CI
  и есть внешний супервизор — он гарантированно стартует, гарантированно имеет таймаут и
  гарантированно логируется. Совпадает с платформенным вариантом Claude Code GitHub Actions.
- **Оговорка:** README по прямой ссылке не отдался (см. «Что не проверил»), поэтому механика — по
  описанию репозитория и вторичным источникам, а не по коду. Приоритет на доизучение — высокий.

#### claude-flow (`ruvnet/claude-flow`)

- **Состояние:** по стороннему каталогу — **~65.2k звёзд**, «Deploy multi-agent swarms with
  coordinated workflows». Репозиторий переехал, метаданные через API у меня не разрешились.
- **Оценка:** самый популярный объект в нише по звёздам, но по позиционированию это swarm-фреймворк
  (много агентов, координированные workflow), а не решение проблемы «человек спит». Ни супервизии
  оркестратора, ни буфера вопросов, ни мобильного контроля в его питче нет. **Для нашей цели —
  низкий приоритет**, отмечаю для полноты картины и как ориентир по тому, за что рынок голосует
  звёздами (за рой, а не за автономию).

---

## Платформенные возможности Claude Code / Anthropic, которые могут закрыть наши проблемы штатно

Это самый важный раздел отчёта: если платформа даёт нужное из коробки, наш самодельный механизм
устарел. Локально установлено **Claude Code 2.1.219**, все перечисленные субкоманды и флаги
присутствуют в `claude --help` (проверено).

### 1. Фоновые сессии под отдельным supervisor-процессом — прямой ответ на «кто оркестрирует оркестратора»

Документация Agent View (`code.claude.com/docs/en/agent-view`), дословно:

> «Background sessions are hosted by a **per-user supervisor process**, separate from your terminal
> and from agent view. The supervisor starts automatically the first time you background a session
> or open agent view, and you don't manage it directly.»

> «Background sessions don't need any terminal open to keep working. A separate supervisor process
> runs them, so you can close agent view, close your shell, or start a new interactive session and
> your dispatched work keeps going.»

Сессии «preserve state on disk through auto-updates and **supervisor restarts**».
Дашборд `claude agents` показывает состояния: **Working / Needs input / Idle / Completed / Failed /
Stopped**. Строка **«Needs input»** — это ровно тот индикатор «оркестратор заблокирован вопросом»,
который владелец просил спроектировать в UI: он уже есть штатно.
В CLI: `--bg, --background` («Start the session as a background agent and return immediately
(manage with `claude agents`)»), в сессии — `/background` (алиас `/bg`), стрелка `←` на пустом
приглашении, и `/fork` (копия сессии, оригинал продолжает жить).
При бэкграундинге переносятся: фоновые shell-команды, backgrounded-субагенты, динамические
workflow и запланированные `/loop`-задачи. **Не переносится** запущенный Monitor.
Ограничения (research preview): фоновые сессии едят ту же квоту подписки (десять агентов = квота
в десять раз быстрее); сессии **локальные** — «preserved across sleep but **stop if the machine
shuts down**».

**Что это значит для нас:** значительная часть работы `tools/watchdog/watchdog.sh` (следить, что
tmux-панель жива; поднимать оркестратора заново) теперь имеет штатный аналог. Наш watchdog
сохраняет уникальную ценность в том, чего платформенный супервизор не делает: он понимает
**семантику** (heartbeat с `context_pct`, режимы `quiesced`, «напиши handoff перед смертью»,
позитивная идентификация панели). Но держать самописную **процессную** живучесть поверх штатной —
это дублирование, которое стоит осознанно сократить.

### 2. Локальные Desktop-задачи по расписанию — штатная замена launchd-обвязке

`code.claude.com/docs/en/desktop-scheduled-tasks`. Минимальный интервал **1 минута**, доступ к
локальным файлам есть, переживают перезапуск, **разрешения настраиваются на задачу**, есть
переключатель изолированного worktree на прогон. Ключевые свойства, которых у нас нет:

- **Catch-up пропущенных прогонов:** «When the app starts or your computer wakes, Desktop checks
  whether each task missed any runs in the last seven days. If it did, Desktop starts **exactly one
  catch-up run for the most recently missed time** and discards anything older.»
- **Самоперепланирование:** «A scheduled task can also modify its own schedule or prompt from
  within a running session using the **`update_scheduled_task` MCP tool**. This lets a task
  reschedule itself based on what it finds».
- **Обучаемые разрешения:** «click **Run now** …, watch for permission prompts, and select
  „always allow" for each one. Future runs of that task auto-approve the same tools».
- **История с причинами пропусков:** «Hover a skipped entry to see why: your computer was asleep,
  the previous run was still in progress, or other scheduled tasks were already running».
- Промпт задачи лежит на диске как `~/.claude/scheduled-tasks/<task-name>/SKILL.md`.
- Ограничение: «Tasks only run while the desktop app is running and your computer is awake», есть
  настройка «Keep computer awake», но закрытие крышки всё равно усыпляет.

### 3. Routines — облачные агенты по расписанию

`code.claude.com/docs/en/routines`. Бегут на инфраструктуре Anthropic, **машина может быть
выключена**; минимальный интервал **1 час**; **нет доступа к локальным файлам** (свежий клон);
**нет промптов разрешений** — «runs autonomously»; триггер может быть не только по расписанию, но
и по API-вызову или событию GitHub. Управление — `/schedule` в CLI. Это единственный вариант,
переживающий выключение ноутбука.

### 4. Session-scoped расписание: `/loop` + CronCreate/CronList/CronDelete

`code.claude.com/docs/en/scheduled-tasks`. Существенные ограничения, которые надо знать до того,
как на это опереться:
- «**Tasks only fire while Claude Code is running and idle.** Closing the terminal or letting the
  session exit stops them firing» — то есть `/loop` **не может воскресить мёртвого оркестратора**;
- нет догоняющих срабатываний: пропущенное окно срабатывает **один раз** при переходе в idle;
- рекуррентные задачи **истекают через 7 дней** («This bounds how long a forgotten loop can run»);
- максимум **50 задач на сессию**, ID из 8 символов;
- **джиттер**: рекуррентные — до 30 минут после назначенного времени (или до половины интервала
  для чаще-часовых); обходится выбором минуты, отличной от `:00`/`:30`;
- новая беседа обнуляет задачи; `--resume`/`--continue` восстанавливает неистёкшие;
- отключается целиком через `CLAUDE_CODE_DISABLE_CRON=1`;
- динамический режим (`/loop` без интервала) — модель сама выбирает паузу от 1 минуты до 1 часа и
  может завершить цикл вызовом `ScheduleWakeup(stop: true)`; если итерация не перепланировала и не
  остановилась, ставится один запасной wakeup ~через 20 минут.
- **`.claude/loop.md` / `~/.claude/loop.md`** — файл, заменяющий встроенный maintenance-промпт;
  правки подхватываются со следующей итерации; больше 25000 байт обрезается.

### 5. Channels — событийный пуш в живую сессию плюс relay разрешений

`code.claude.com/docs/en/channels`. Research preview. «A channel is an MCP server that **pushes
events into your running Claude Code session**, so Claude can react to things that happen while
you're not at the terminal.» В превью — **Telegram, Discord, iMessage** (плюс демо-канал fakechat).
Включение: `claude --channels plugin:telegram@claude-plugins-official`.
Два свойства, критичных для GoSleep:
- **Relay разрешений:** «Channel servers that declare the permission relay capability can forward
  these prompts to you so you can **approve or deny remotely**». То есть промпт разрешения в 3 часа
  ночи можно закрыть из Telegram. Предупреждение оттуда же: «Anyone who can reply through the
  channel can approve or deny tool use in your session, so only allowlist senders you trust».
- **Webhook-приёмник:** событие CI/трекера ошибок/деплоя «arrives where Claude already has your
  files open and remembers what you were debugging» — событийная модель вместо polling.
Ограничение: «Events only arrive **while the session is open**, so for an always-on setup you run
Claude in a background process or persistent terminal» — то есть Channels комплементарны
supervisor'у, а не заменяют его. Безопасность: allowlist отправителей у каждого плагина; мало
попасть в `.mcp.json` — сервер должен быть явно назван в `--channels`.

### 6. Remote Control — мобильный контроль (у нас уже задокументирован)

У нас есть свой скилл `~/.claude/skills/remote-control/SKILL.md` с преflight-скриптом
`tools/rc/rc-preflight.sh` и разбором трёх непереставимых поверхностей. Оттуда главное, что
подтверждается и в этом аудите: **живую сессию нельзя спарить флагом** — только `/rc` изнутри;
`claude --remote-control` создаёт НОВУЮ сессию, а перезапуск оркестратора ради телефона «trades
the entire live context for a phone link, which is almost never the right trade». Второй
push-переключатель (`inputNeededNotifEnabled`, «Push when actions required») — тот, который
превращает заблокированный промпт в жужжание телефона; **оба по умолчанию выключены**.

### 7. `/goal` — работать до выполнения условия, а не по интервалу

Упомянут в доке scheduled-tasks как альтернатива: «To keep the session working turn after turn
until a condition is met rather than on an interval, see `/goal`». Отмечу, что 5dive **уже
обжёгся** на нём: их heartbeat-реапер поставлен именно потому, что «**/goal's own „stop after N
turns" is model-judged and was observed to overrun**» (`src/cmd_heartbeat.sh`). То есть `/goal`
нужен с внешним детерминированным таймаутом.

### 8. Вопрос подписки и `claude -p` — закрыт

- В `claude --help` присутствует `setup-token` — «Set up a **long-lived authentication token
  (requires Claude subscription)**». То есть Anthropic **сама** даёт штатный путь к долгоживущей
  аутентификации на подписке.
- По анонсу об отдельных Agent-SDK-кредитах для `claude -p` на подписочных планах с 15.06.2026:
  по данным вторичных источников **изменение было отменено до выката**. Это снимает главный
  риск, который владелец закладывал в мандат. Оговорка: это не первичный источник Anthropic —
  см. «Что не проверил».
- Практический вывод: подписку ломает **не флаг `-p`**, а **изоляция агента от кредентиалов
  хоста** (случай warren). Пока воркеры бегут на машине владельца с залогиненным CLI — подписка
  работает, что и подтверждают autosk (`docs/shipped.md`: «already authenticated») и overstory
  (`ANTHROPIC_API_KEY` только «may include»).

---

## Сводная таблица: они vs мы

| Механизм (по столпам мандата) | autosk | warren | overstory | 5dive | Платформа CC | **gosleep** |
|---|---|---|---|---|---|---|
| **Кто оркестратор** | детерминированный демон | control plane (сервер) | CLI + координатор-агент | ОС: systemd+cron+bash | сессия под супервизором | **LLM-агент в tmux** |
| **Супервизия оркестратора** | не нужна (демон) + crash recovery | supervisor-процесс + 5-в-60с бюджет + docker | 4 этажа: механич. демон → AI-триаж → монитор → супервизоры | systemd + heartbeat-cron; лестница в дизайне | **per-user supervisor process** | watchdog.sh (launchd) |
| **Circuit breaker** | нет (только парковка) | **есть**: `RestartBudget` 5/60с + экспонента | нет бюджета; лестница по времени | лестница + backoff + max attempts (дизайн) | — | нет бюджета |
| **Anti-loop в прогоне** | **`step_visits` cap=5**, персистентный | гейты качества терминальны | — | reaper (everyMin×3) + starvation-детектор | `/loop` 7-дневное истечение | суждение оркестратора |
| **`claude -p` / подписка** | да / **подписка** | нет (делегирует) / **API-ключ** | да / **подписка** | да / **Pro/Max явно** | `setup-token` на подписке | **подписка** |
| **Расписание** | **нет** | cron-триггеры `.warren/triggers.yaml`, тик 60с single-flight | нет | cron heartbeat, «1 нудж = 1 задача» | Desktop 1мин / Routines 1ч / `/loop` | пульс оркестратора |
| **Буфер вопросов** | статус `human` (без типов) | **был (plot) — удалён** | `ask` с таймаутом 120с | **гейты: типы + tier 0/1/2 + TTL + прецеденты** | «Needs input» в `claude agents` | **queue.jsonl + дедлайны** |
| **Манифест решений** | нет | нет | нет | **`constitution.yaml`, hard_gates = ERE** | — | **manifest.md + provenance** |
| **Обучение на ответах владельца** | нет | нет | нет | **`ask_shape` + precedent (exact/fuzzy)** | — | нет |
| **Метрика автономности** | нет | нет | нет | **zero-human badge, публичный, атакуемый** | — | нет |
| **UI / дашборд** | TUI + Tauri GUI + CLI | React SPA (Workspace UI удалён) | web `ov serve` | CLI + `5dive watch` | `claude agents` | **лаборатория (HTML)** |
| **Мобильный** | **iOS TestFlight + компактный shell** | нет | нет | **Telegram tap-to-answer** | Remote Control + **Channels** | RC (задокументирован) |
| **Память / история** | файлы, транскрипты без GC | SQLite/PG + mulch + seeds | SQLite-почта + mulch + beads | SQLite + журнал решений | сессии на диске | **Jira+GitHub+dev_history+лаб** |
| **Изоляция** | worktree / docker (агент владеет) | bwrap / под K8s | worktree | **unix-пользователи, 3 тира** | worktree на задачу | worktree |
| **Живость проекта** | живой, соло | очень активный, соло | **архивирован** | очень активный, соло | — | — |

---

## Топ-10 заимствований, приоритизированных

1. **Риск-тиры гейтов с TTL-автоприменением** (из 5dive `tasks_db.sh:217-224`, `cmd_task.sh:56-61`).
   *Что:* каждому вопросу присваивается tier 0/1/2; tier 0 применяет рекомендацию сразу (только
   строка в дайджесте), tier 1 — сам применяет её через 48ч, tier 2 никогда не применяется
   автоматически. Категории деньги/публичные коммуникации/секреты/деструктив **принудительно
   опускаются в tier 2 кодом**, а не доверием к заявителю.
   *Куда:* `docs/lab/decisions/manifest.md` (разделы 1/2/3 уже почти совпадают с тирами 0/1/2 —
   не хватает именно floor-механики) + `tools/lab/lab-emit.sh`.
   *Цена:* малая — у нас уже есть `auto_apply_at`; добавляется поле tier и regex-классификатор.
   *Что даст владельцу:* ночью не будет вопросов, которые система могла решить сама, и не будет
   риска, что она сама решит вопрос про деньги или деструктив.
2. **Лестница восстановления detect → classify → act → escalate с уклоном в false-negative**
   (5dive `docs/fleet-supervisor-design.md`, разделы 3-6).
   *Что:* три класса (healthy/slow/**stuck**), причём для `slow` предписано ничего не делать;
   лестница nudge → resume → rotate → restart → reprovision; авто-действия **только на обратимых
   ступенях**; эскалация несёт сводку «что я пробовал».
   *Куда:* `tools/watchdog/watchdog.sh`.
   *Цена:* средняя — у нас есть нудж/kill/re-wake, но нет класса `slow` и нет аудита попыток.
   *Что даст:* перестанет убивать медленно думающего оркестратора; в дайджест попадёт история
   лечения, а не «агент упал».
3. **ZFC-матрица конфликтов сигналов + «persistent capability»** (overstory `health.ts:1-32`,
   `health.test.ts:262-353`).
   *Что:* наблюдаемое состояние важнее записанного, с явной таблицей на каждый конфликт;
   отдельно — правило «tmux жив + записано зомби → **разбираться, не убивать**»; долгоживущей роли
   прощается простой, но не смерть процесса.
   *Куда:* `tools/watchdog/watchdog.sh` (у нас правило quiesce завязано на самодекларацию
   оркестратора — ненадёжно, мёртвый ничего не задекларирует).
   *Цена:* малая (правила, не код).
   *Что даст:* закрывает класс инцидентов «watchdog убил живое».
4. **`RestartBudget`: 5 рестартов в 60с + экспонента 1/2/4/8/16с, затем сдаться наружу**
   (warren `src/supervisor/budget.ts:15-56`).
   *Что:* скользящее окно рестартов; при исчерпании — не маскировать баг, а передать отказ уровнем
   выше.
   *Куда:* `tools/watchdog/watchdog.sh` (re-wake).
   *Цена:* малая — структура данных на 40 строк, уже покрыта тестами у них.
   *Что даст:* оркестратор, падающий сразу после старта, не будет будиться всю ночь; владелец
   утром увидит одну внятную эскалацию вместо сотни.
5. **Осознанная миграция на платформенные фоновые сессии + `claude agents`**
   (docs Agent View).
   *Что:* перестать держать самописную процессную живучесть там, где её даёт per-user supervisor;
   оставить watchdog там, где он уникален (семантика heartbeat, context_pct, handoff-перед-смертью,
   позитивная идентификация).
   *Куда:* граница `tools/watchdog/` ↔ платформа; раздел скилла `orchestrating-delivery-agents`.
   *Цена:* средняя (пилот + ревизия скилла), риск — research preview и «stop if the machine shuts
   down».
   *Что даст:* меньше своего кода, больше гарантий; и штатный экран «Needs input».
6. **Channels (Telegram) с relay разрешений** (docs Channels).
   *Что:* пуш событий внутрь живой сессии + возможность подтвердить/отклонить разрешение с
   телефона.
   *Куда:* дополняет наш `remote-control`; закрывает сценарий «промпт разрешения в 3 ночи».
   *Цена:* малая (плагин + токен бота), но требует явного решения владельца про allowlist —
   «кто может отвечать, тот может одобрять tool use».
   *Что даст:* GoSleep перестаёт останавливаться на разрешении.
7. **Метрика автономности `1 − asks/shipped` за 7 дней с честным разделом «чего она не
   утверждает»** (5dive `docs/zero-human.md`).
   *Что:* число, считаемое из наших же `queue.jsonl`/`archive.jsonl` и закрытых задач; автоклиры
   и самостоятельные решения агента **не считаются** прерываниями, а один тап на телефоне —
   считается.
   *Куда:* `docs/lab/status.json` + утренний дайджест + индикатор автономности в UI (владелец
   просил это явно в мандате).
   *Цена:* малая — данные уже есть.
   *Что даст:* владелец получит одно число «насколько система реально работала без меня» и сможет
   видеть тренд, а не верить на слово.
8. **Обучение на прецедентах: `ask_shape` + precedent-prefill с инвариантом «advisory-only»**
   (5dive `tasks_db.sh:243-258`).
   *Что:* нормализуем формулировку вопроса в «форму», ищем прошлый ответ владельца на такую же
   форму, **преднаполняем рекомендацию** — но никогда не меняем tier и не расширяем то, что
   гейт может закрыть сам; автоклир читает только точное совпадение, никогда fuzzy.
   *Куда:* `docs/lab/questions/` + `manifest.md` (кандидаты в манифест).
   *Цена:* средняя (нормализатор + индекс), но это ровно тот «навык решать вопросы за владельца»,
   который стоит в мандате.
   *Что даст:* система учится на ответах владельца, не получая при этом права на большее.
9. **Anti-loop как персистентный счётчик + hazard guard при старте** (autosk
   `store/metadata.ts:21`, `feature-dev/src/index.ts:82-85`, `extensions/hazard.ts:17-25`).
   *Что:* счётчик посещений шага в durable-состоянии с ручным сбросом; на старте — валидация всех
   in-flight сущностей против живой конфигурации с парковкой несогласованных.
   *Куда:* `docs/lab/status.json` / очередь + процедура старта оркестратора.
   *Цена:* малая.
   *Что даст:* переживает смену оркестратора; задачи, ссылающиеся на исчезнувшие фазы, перестают
   висеть невидимо.
10. **Мобильный как «вторая презентация того же стора»** (autosk `gui/README.md:181-196`).
    *Что:* один media-query, общий стор/редьюсер/данные, ноль новых RPC-точек, вся компактная
    стилизация в одном `mobile.css`, импортируемом последним.
    *Куда:* `docs/lab/site/*.html` + `docs/lab/mobile/` + `tools/lab/ui`.
    *Цена:* средняя (рефакторинг), но снимает целый класс расхождений «на телефоне не то, что на
    десктопе».
    *Что даст:* мобильная лаборатория перестаёт быть отдельным продуктом, который надо
    сопровождать вторым комплектом.

**Отдельным пунктом — развилки, где нужен владелец** (я не блокировался, выбрал защитимый
обратимый вариант «пока ничего не мигрируем, только описываю»):
- **Р1. Мигрировать ли живучесть оркестратора на платформенный supervisor?** Это осознанный
  размен: меньше своего кода против research preview и «сессии умирают при выключении машины».
  Мой обратимый выбор: сначала пилот в параллель с watchdog'ом, ничего не удаляя.
- **Р2. Включать ли Channels с permission relay?** Кто отвечает в Telegram — тот одобряет
  выполнение инструментов. Это решение о доверии, а не техническое. Мой выбор: не включать без
  явного согласия владельца.
- **Р3. Ревизия лаборатории по правилу warren «unused features are deleted».** Нужен ответ
  владельца, какие страницы лаборатории он реально открывал. Мой выбор: ничего не удалять,
  вынести вопрос в пакет.

---

## Где прежние заметки (07-07 / 07-10) устарели или ошибались

1. **Заметки не ошибались по autosk — они по-прежнему точны.** Проверено диффом
   `fd4c22e..8b4f3ec` по путям ядра: изменились только `engine/engine.ts` (+45/−2) и
   `engine/context.ts` (+1/−3), обе правки — hot-reload расширений. Описания планировщика,
   транзит-протокола, per-session MCP-сервера, kickback-бюджета и набора флагов `claude -p`
   остаются верными. **Устарел только инвентарь:** появился `@autosk/gh-review`, появился
   `docs/shipped.md`, релиз v0.2.5.
2. **По warren заметки 07-07 устарели капитально.** В них warren описан как проект с `plot`
   («shared human+agent event-log coordination substrate») и агентом-надзирателем `leveret`
   (overseer). **Обоих больше нет.** Доказательства: `src/plots/` и `src/plot-client/`
   отсутствуют на диске; `leveret.ts` отсутствует в `src/registry/builtins/` (удалён в `5fc9a36f`);
   `docs/PHILOSOPHY.md:50-54` объявляет удаление осознанной поправкой от 2026-07-17 с причиной
   «they have no users». Если где-то в наших PRD/отчётах warren'овский `plot` приводился как
   образец для нашей лаборатории — эта опора исчезла.
3. **Заметки 07-07 фиксировали warren как «Fly.io»-развёртывание.** Теперь Fly.io выпилен
   (`dd40a8e5`), путь развёртывания — GKE/Kubernetes, введён `RuntimeProvider` с двумя
   реализациями (v0.10.0, PR #609).
4. **Версия и статус warren в наших заметках (0.9.10, «33 acceptance tests») устарели**:
   фактически `package.json` = **0.10.1**, тестов **38**. Причём их собственный README всё ещё
   пишет «Stable (`0.9.10`)» — то есть **их README отстал от их кода**, и цитировать его как
   источник истины сейчас нельзя (наши прежние заметки цитировали именно README).
5. **Ключевая посылка мандата про `claude -p` и подписку не подтвердилась.** Мандат
   (строка 11) предполагает: «скорее всего, эти проекты не позволяют работать по claude подписке»
   и «его в будущем Anthropic хотят запретить». Факты: autosk требует лишь «already authenticated»
   CLI (`docs/shipped.md`), overstory помечает `ANTHROPIC_API_KEY` как «*may* include»
   (`claude.ts:547`), в CLI есть штатный `claude setup-token` «requires Claude subscription», а
   анонсированное с 15.06.2026 списание `claude -p` в отдельные Agent-SDK-кредиты было **отменено
   до выката**. По API-ключу завязан только warren — и не из-за `-p`, а из-за изоляции агента в
   контейнере.
6. **Посылка мандата «у нас только один уровень вложенности, поэтому оркестратора некому
   надзирать» технически всё ещё верна для Agent-tool/tmux, но обошлась стороной.** overstory
   решает это НЕ вторым уровнем агентов, а **механическим Tier 0 демоном + AI-триажем**; 5dive —
   systemd+cron; платформа — supervisor-процессом. То есть решение задачи лежит не в «агент над
   агентом», а в «не-агент над агентом». Наш watchdog изначально сделан правильно — просто
   недоукомплектован (нет бюджета рестартов, нет класса `slow`, нет матрицы ZFC).
7. **overstory в мандате назван неактивным — это подтвердилось и усилилось:** он не просто
   неактивен, он **архивирован** (read-only), при этом собрал 1331 звезду против 125 у живого
   преемника.

---

## Что я НЕ смог проверить и почему

1. **Код Aeon (`aeonfun/aeon`, 579 звёзд, пуш сегодня).** Репозиторий переехал с
   `aaronjmars/aeon`; прямой запрос README по raw-ссылке вернул пусто, API по старому пути отдал
   `Moved Permanently`. Всё сказанное о нём — по описанию репозитория и вторичным источникам, **не
   по коду**. Учитывая его тезис («no approval loops, no babysitting, configure once, forget
   forever») и запуск на GitHub Actions, это **первый кандидат на доизучение** в следующей волне.
2. **claude-flow (~65.2k звёзд).** Метаданные не разрешились через API (переезд репозитория);
   цифра звёзд взята из стороннего каталога `bradAGI/awesome-cli-coding-agents`, а не с GitHub.
   По позиционированию отнёс к низкому приоритету, но **число не верифицировано первоисточником**.
3. **Отмена Agent-SDK-кредитов для `claude -p`.** Факт получен из вторичного источника
   (аналитическая статья), **не из официального анонса Anthropic**. Это критичный для нас факт —
   его стоит подтвердить первоисточником прежде, чем закладывать в план.
4. **Файлы autosk под git-lfs.** В окружении нет `git-lfs`, из-за чего `git checkout`/`git
   restore` в клоне падает и 659 файлов не материализуются на диск. Обошёл это чтением через
   `git show HEAD:<path>` (объектная база не затронута, содержимое достоверно), но **бинарные
   LFS-объекты (скриншоты, иконки) прочитать нельзя** — визуальную оценку их GUI я не делал.
5. **Живой прогон ни одного из проектов.** Всё — статический анализ кода и документации; я не
   поднимал ни autoskd, ни warren, ни 5dive. Утверждения о поведении опираются на код и на их
   собственные комментарии/тесты, а не на наблюдение.
6. **Внутренности agx.** Проект без коммитов с 2026-05-06; ограничился README, глубже не копал —
   решение осознанное (не тратить бюджет на неактивный проект), но это значит, что заявленные
   «durable Wake→Work→Sleep checkpoints» я **в коде не подтвердил**.
7. **Ветка `status` 5dive с историей zero-human.** Читал методологию (`docs/zero-human.md`) и
   схему БД, но не выгружал `history.jsonl` — то есть **фактическое значение метрики и её
   динамику не проверял**, только способ вычисления.
8. **Точное число коммитов 5dive за 3 недели.** API вернул ровно 100 (потолок страницы), реальное
   число ≥100; клон делался с `--depth 5`, поэтому локальная история непригодна для подсчёта.
9. **Routines и Desktop scheduled tasks — не проверены на этом аккаунте.** Читал документацию;
   не проверял, доступны ли они владельцу фактически (Routines — research preview, Desktop-задачи
   требуют Desktop-приложения, которое у нас не установлено/не проверено). Прежде чем закладывать
   их в план, нужен преflight.
