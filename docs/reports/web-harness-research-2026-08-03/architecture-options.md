# Интерактивный веб-интерфейс для harness — варианты архитектуры (v2, после red-team)

**Автор:** архитектор web-harness (agent), gosleep.
**Дата:** 2026-08-03. Версия 2: переработана после разбора красной команды.
**Для:** владельца, Roman L. Написано простыми словами.
**Не коммитить.** Рабочий документ разговора.
**Опорные материалы:** три findings в этой же папке (autosk-warren-ui, harness-landscape-ui, our-constraints); `docs/reports/web-admin-inventory-2026-08-03.md`; `docs/plans/skills-governance-plan.md`; **`redteam-verdict.md` в этой же папке — с ним сверялся строкой к строке**.

Что изменилось между v1 и v2:
- три критические находки красной команды переосмыслены и закрыты **механизмами** в архитектуре (не текстовыми оговорками);
- честно пересчитаны сроки: первая кнопка **3.5–5 дней с нуля**, полный v1 — **10–14 дней**;
- в конце добавлен раздел «Ответ на red-team» с построчным разбором и раздел «Проверено красной командой и держится» — это фундамент, на который смело опираемся.

---

## Резюме на пять-семь предложений

Веб-интерфейс наш строим не с нуля. У нас уже есть профессиональный статический дашборд из семи страниц (`docs/lab/site/*.html`), Python-хроникёр, который считает всё раз и записывает атомарно, и один клиентский TS-модуль на 425 строк, работающий из `file://`. Требуется добавить **тонкий TypeScript-сервер на `127.0.0.1`**, который отдаёт те же страницы, дополняет их живым потоком событий и принимает клики на действия (первое — «Опубликовать скилл»). Главный запрет владельца — «агент не должен уметь опубликовать» — закрывается **тремя слоями**: TouchID-гейт внутри `publish.sh` (агент физически не пройдёт биометрию), Bearer-токен на веб-эндпойнте, и env-секрет `GOSLEEP_WEB_TOKEN`, который CLI требует и агент не может подделать. Из трёх реалистичных вариантов рекомендую **вариант A: «Node/TS-демон + прогрессивное обогащение»** — прибавляем ~700 строк TypeScript, ничего из построенного не переписываем, статические страницы остаются полноценным fallback без сервера, первая рабочая кнопка выходит **за 3.5–5 дней одного воркера с нуля** (из которых 2 дня — предпосылки этапов 2–3 плана skills-governance, 1.5–2.5 дня — сама веб-часть), а живой поток и последующие действия — по одному действию за раз. Варианты B (Bun + React SPA калька Warren) и C (полная замена на Next.js) описаны честно, с плюсами; они дороже в 5–20 раз и без адекватной причины ломают уже стоящий конвейер.

---

## Общие рамки, которые обязан уважать любой вариант

Взято из `findings/our-constraints.md`, уже принятых решений владельца и находок red-team.

1. **Только localhost.** Порт биндится на `127.0.0.1`, не `0.0.0.0`, не `::`. Никакая другая машина в Wi-Fi не дотягивается.
2. **Ноль записей в `docs/lab/` напрямую из сервера.** Единственный путь записи — существующие CLI (`tools/lab/lab-emit.sh`, `tools/lab/lab-log.sh`, `tools/lab/lab-write.sh`, будущий `tools/skills/publish.sh`). У них уже свои dir-локи и атомарные rename'ы.
3. **Статические страницы обязаны работать без сервера.** Инвариант плана skills-governance (раздел 5, этап 5): «Пока сервер не запущен, страница генерируется хроникёром в статическом виде и показывает точную команду для копирования вместо активной кнопки».
4. **Подписка Claude, не API-ключ.** Warren требует `ANTHROPIC_API_KEY` — этот путь нам структурно закрыт. Никаких переменных с ключами в конфиге сервера.
5. **Guard в `install.sh` включён и остаётся включённым.** Сервер не имеет права его вызвать.
6. **Мобильная версия и push заморожены** (`ORCHESTRATION-STATE.md:162`, 2026-07-24). Проектируем так, чтобы не закрыть себе дорогу к ним потом, но ни PWA-manifest, ни service-worker, ни ntfy-выход из процесса не строим до явной команды.
7. **Rebuild-хук хроникёра нельзя обойти + агент не должен пробить веб-слой.** Три новых инварианта, введённых после red-team, применимы к любому варианту:
   - **Chronicler-lock.** У `chronicler.sh` появляется top-level mkdir-lock с coalescing («если bundle уже новее моего `start_of_wait` — не делать второй ребилд»); закрывает Critical 2 red-team. Действителен для всех вызовов (хук, tick, веб, руками).
   - **withTimeline-обёртка.** Каждый write-эндпойнт сервера пишет `server.intent` в timeline **до** спавна CLI и `server.outcome` — **после** (успех или ошибка). Плюс `touch .artifacts/lab/debounce/web-last-write` как сигнал debounce-waiter'у. Закрывает Critical 3 (действия из веба видны в ленте даже при падении сервера) и даёт `tick.sh` возможность обнаружить осиротевший intent на следующем пасе.
   - **TouchID gate внутри `publish.sh`.** Физическая биометрия сенсора — единственный барьер, который агент под тем же UID пробить не может. Закрывает Critical 1.
8. **Проверка на владельца — двухслойная:** TouchID (биометрия) внутри CLI + env-секрет `GOSLEEP_WEB_TOKEN`, установленный сервером (агент, вызывающий `bash publish.sh` напрямую в обход сервера, env не имеет, отсекается ещё до биометрии).
9. **Никаких массовых операций** (`--all`, «опубликовать все скиллы») — принцип этапа 3 плана.
10. **Дашборд — инструмент, английский хром допустим, обращения к владельцу — по-русски.** Решение d-2026-07-28-006.

---

## Вариант A — «Тонкий TS-демон над существующим конвейером» (рекомендуемый)

### A.1. Схема

```
┌──────────────────── ГЕНЕРАТОРЫ СОБЫТИЙ (существующее) ─────────────────┐
│  hooks + lab-log.sh + lab-emit.sh + poll-fill.py                        │
│  → append в docs/lab/events/*.jsonl, questions/queue.jsonl, ...        │
│  → PostToolUse-хук → chronicler-debounce → chronicler.sh --quiet        │
│  → whole-file replace: render_bundle.json, status.json, site/*.html    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌── НОВОЕ: chronicler.sh top-level lock (30 строк bash) ──────────────────┐
│  все callers (hook, tick, web, руками) идут через один mkdir-lock       │
│  + флаг --coalesce-since=<epoch>: если bundle уже свежий, skip          │
│  + флаг --carrier={hook,tick,web,manual} → tick-ledger видит источник   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────── НОВОЕ: tools/web/serve.ts (Node.js + Hono, ~500 строк) ──────┐
│  bind 127.0.0.1:7331                                                    │
│  ├─ GET /                    → redirect на /site/index.html            │
│  ├─ GET /site/*.html         → отдаёт файлы с диска + ETag(inode)       │
│  ├─ GET /api/bundle          → read+close render_bundle.json, ETag(ino) │
│  ├─ GET /api/events?since=N  → SSE-стрим; авто-переоткрытие при смене   │
│  │                             UTC-дня или изменении inode; event:rotate│
│  ├─ POST /api/skills/publish → withTimeline(...) → publish.sh (TouchID) │
│  ├─ POST /api/questions/answer → withTimeline(...) → lab-emit.sh answer │
│  ├─ POST /api/tick           → withTimeline(...) → tick.sh --force      │
│  ├─ POST /api/events/ack     → withTimeline(...) → lab-log.sh ack       │
│  ├─ GET /api/whoami          → {version, tokenIssuedAt}                 │
│  └─ GET /healthz             → live-probe для внешних мониторов         │
│                                                                          │
│  Все POST: Bearer + Origin/Referer + Host guard + идемпотентность       │
│            (persistent .artifacts/web/idempotency.jsonl) + concurrency=1│
│            → withTimeline (server.intent → CLI → server.outcome)         │
│            → chronicler.sh --quiet --coalesce-since=$T_write            │
│            → JSON-ответ {ok, bundle_gen, stdout, stderr}                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────── СУЩЕСТВУЮЩИЙ КЛИЕНТ + два новых прогрессивных модуля ────────────┐
│  tools/lab/ui/src/client.ts (425 строк) — БЕЗ ИЗМЕНЕНИЙ                 │
│  tools/lab/ui/src/client-transport.ts (~150 строк, инлайн)              │
│      probe /api/whoami → детект сервера; fetch-обёртка с Bearer +       │
│      Idempotency-Key + обработка 401/409/500; EventSource с             │
│      reconnect'ом и обработкой event:rotate                             │
│  tools/lab/ui/src/client-actions.ts (~250 строк, инлайн)                │
│      если сервер жив → кнопки на страницах активные, toast'ы            │
│      если сервера нет → форма ведёт в 'команда для копирования'         │
└─────────────────────────────────────────────────────────────────────────┘
```

Поток события «агент → экран»: агент вызывает `lab-emit.sh answer …` → под dir-локом append в `queue.jsonl` → одновременно append в `events/YYYY-MM-DD.jsonl` через `lab-log.sh` → сервер, читающий этот файл tail'ом, видит новую строку → шлёт `data: {…}\n\n` в открытый SSE-стрим → браузер обновляет карточку и цифру «X open questions». При смене UTC-дня сервер переоткрывает FD и рассылает `event: rotate`.

Поток команды «экран → агент»: клик на «Опубликовать `using-jira`» → браузер POST `/api/skills/publish` с `Bearer <token>` + `Idempotency-Key: <uuid>` + `Host: 127.0.0.1:7331` → сервер проверяет три заголовка → под thread-lock записывает `server.intent` в timeline → спавнит `bash tools/skills/publish.sh using-jira` с env `GOSLEEP_WEB_TOKEN=<secret>` → `publish.sh` проверяет env, дальше вызывает TouchID-гейт → **на экране владельца всплывает macOS-биометрический промпт «Publish skill `using-jira`?»** → владелец прикладывает палец → `publish.sh` продолжает работу (rsync + backup + строка в CHANGELOG) → возвращает exit code → сервер записывает `server.outcome`, дёргает `chronicler.sh --quiet --coalesce-since=$T_write`, возвращает клиенту `{ok, bundle_gen, …}`. Если владелец **не** приложил палец (или отменил) — TouchID возвращает не-ноль, `publish.sh` завершается с ошибкой, `server.outcome` пишется с `status=fail_touchid`, клиент видит toast «Публикация отменена: биометрия не подтверждена».

### A.2. Стек поимённо

| Слой | Что | Почему |
|---|---|---|
| Runtime | **Node.js 20+** (уже стоит на машине — `build.mjs` его запускает) | Ноль новых установок, нативный TS через `tsx` или `--experimental-strip-types` в 22+ |
| HTTP-фреймворк | **Hono 4.x** (~50 КБ, tree-shakeable, TS-first) | Даёт middleware, роутинг, SSE-хелпер `streamSSE` из коробки; альтернатива — чистый `node:http` без deps |
| Валидация входа | **zod 3.x** | Один пакет уже полезен для контрактов POST-body |
| Идемпотентность | **Персистентная JSONL-мапа** в `.artifacts/web/idempotency.jsonl` (fsync-append, load-on-start, TTL 24 ч) | In-memory Map теряется при launchctl reload (finding 6 red-team) — на диске переживает |
| SSE-tail | Собственный tail-обработчик: **open-by-day + inode-watch + minute-timer на UTC-rotation** | `fs.watch` даёт задержку до 500 мс на busy FS — не использую в hot-path bundle; для events/*.jsonl достаточно poll'а по mtime + инвалидация по st_ino |
| Клиент | **Preact 10** (уже в проекте) + два новых файла `client-transport.ts` (~150) и `client-actions.ts` (~250) | Прогрессивное обогащение поверх текущих 425 строк; ноль новых frontend-зависимостей |
| Сборка клиентского кода | **esbuild** (уже в проекте, `build.mjs`) | Дополнительные строки инлайнятся рядом с существующей `clientJs` |
| **TouchID gate** | Маленький **Swift-бинарь** `tools/web/bin/touchid-gate` (~40 строк) — вызывает `LAContext.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)` | Единственный механизм на macOS, который агент под тем же UID структурно не может пройти. Fallback (нет сенсора / SSH-сессия): чтение одноразового кода из GUI-Notification |
| Chronicler top-level lock | 30 строк bash в `tools/lab/chronicler.sh` — mkdir-lock + `--coalesce-since=<epoch>` | Закрывает Critical 2 |
| Timeline-обёртка server-side | Хелпер `withTimeline(endpoint, params, fn)` в `serve.ts` (~50 строк) | Закрывает Critical 3 |
| Логи сервера | `pino` + ротация в `docs/lab/supervision/server-<date>.log` | Отдельно от timeline; timeline через `withTimeline` |
| Запуск | `launchd`-plist `com.gosleep.web.plist` с `RunAtLoad=true`, `SessionCreate=true`, `KeepAlive={"SuccessfulExit":false}` | Владелец логинится — сервер поднимается; падение — рестарт. Правка после finding 13 |

Python и Go остаются существующими локальными скриптами. Никаких новых Python/Go-компонентов, кроме одного Swift-бинарника для биометрии (~40 строк, компилируется при первом `install-deps.sh` через `xcrun swiftc`).

### A.3. Что делаем с текущим конвейером

**Сохраняем без изменений:**
- `tools/lab/chronicler.py` (3 815 строк) — источник расчётов;
- `tools/lab/lab-log.sh`, `lab-emit.sh`, `lab-write.sh` — единственные писатели;
- `tools/lab/ui/src/render.tsx`, `screens/*.tsx`, `theme.ts`, `client.ts` — SSG-часть;
- `tools/lab/tick.sh`, `chronicler-debounce.sh`, все хуки;
- контракт `gosleep.lab.render/7` и `gosleep.lab.status/1`.

**Малые правки в существующем:**
- `tools/lab/chronicler.sh` — обёртка mkdir-lock + `--coalesce-since` (30 строк bash).
- `tools/lab/lab-emit.sh` — расширить `SEMANTIC_TYPES` парами `server.intent`, `server.outcome`, `web.touchid.granted`, `web.touchid.denied` (5 строк).

**Оборачиваем без переписывания:**
- статические HTML отдаются HTTP-сервером **с диска** через `/site/*.html`.
- к каждой странице в стадии SSG добавляется пара инлайн-скриптов `client-transport.ts` + `client-actions.ts`; первый проверяет `GET /api/whoami`. Если ответа нет — молча выходит, страница остаётся ровно тем, чем была до сегодня.

**Добавляем:**
- одну новую страницу `docs/lab/site/skills.html` — генерирует хроникёр, читает `docs/skills/CHANGELOG.jsonl`. Первая настоящая кнопка живёт здесь.

**Не заменяем ничего.** Хроникёр остаётся полномочным «одним посчитанным числом», сервер только читает `render_bundle.json` при запросе и накладывает поверх поток свежих событий.

### A.4. Транспорт живых обновлений и почему именно он

**SSE (Server-Sent Events) по одному эндпойнту `GET /api/events?since=<seq>`.** Причины и защита от edge-case'ов:

1. **Автопереподключение из коробки** — браузерный `EventSource` сам делает retry с backoff'ом.
2. **Однонаправлен — ровно наш случай.** Все команды от клиента идут отдельными POST'ами.
3. **Тривиально проходит любой прокси** (в отличие от WS с его upgrade-hop).
4. **Автор Warren осознанно съехал с WS на NDJSON-over-HTTP.** SSE — это тот же паттерн, но с браузерной поддержкой сверху.
5. **UTC-day rotation** (finding 5 red-team). Файл `docs/lab/events/YYYY-MM-DD.jsonl` меняется по имени каждые сутки в 00:00 UTC. Сервер держит: (a) `currentDay` = `utc_date()`, (b) `currentPath`, (c) `currentInode`. **Минутный таймер** проверяет: если `utc_date()` изменился или `stat(currentPath).ino` изменился → закрыть старый FD, открыть новый файл, разослать `event: rotate\ndata: {new_day: "…"}\n\n`. Клиент по `rotate` перезапрашивает `render_bundle.json` (seq-нумерация суточная, «since» из вчерашнего дня врёт).
6. **inode-инвалидация для `render_bundle.json`.** Сервер не кэширует bundle между запросами через `fs.watch` (задержка FSEvents до 500 мс на busy FS — finding 12). Политика: `open()→read()→close()` в одном HTTP-хендлере; перед чтением `stat().st_ino` сверяется с закэшированным; при разнице — читаем заново; отвечаем с `ETag: "<ino>"` и обрабатываем `If-None-Match` для 304 (экономит 623 КБ на неизменных данных — finding 9).

**Что не выбираем:**
- **NDJSON-over-HTTP через `fetch()+ReadableStream`** — работает, но требует ручного reconnect'а на клиенте.
- **WebSocket** — двусторонний, upgrade-hop; излишек для нашей задачи.
- **Polling `render_bundle.json`** — на каждый tick браузер тянет 623 КБ.
- **`fs.watch` как основа кэша** — задержка ненадёжна на macOS.

### A.5. Набор действий первой версии

**Минимум — v1 (публикация скилла):**
- `POST /api/skills/publish` с `{name: "using-jira"}` → `withTimeline` → `bash tools/skills/publish.sh using-jira` (env `GOSLEEP_WEB_TOKEN=$secret`) → внутри — TouchID-гейт → rsync → строка в CHANGELOG → синхронный `chronicler.sh --quiet --coalesce-since=$T_write` → `{ok, bundle_gen, stdout, stderr}`.

**Дальше — v1.1 «ответ на вопрос очереди», «force tick», «FYI-ack»:**
- `POST /api/questions/answer` — **перед** спавном `lab-emit.sh answer` сервер сначала вызывает `lab-emit.sh list --json --re <q_id>` и проверяет `status == "open"` (finding 11: `_patch` в lab-emit не гардит статус для answer). Если не open — 409.
- `POST /api/tick` → `bash tools/lab/tick.sh --force --carrier desktop`.
- `POST /api/events/ack` → `bash tools/lab/lab-log.sh --type ack --actor owner --data "event=<id>"`.

**Дальше — v1.2 «живой поток» (SSE) — уже описан в A.4.**

**Максимум — v2 (пока не строим, но не закрываем дорогу):**
- «Направить агента» — POST в очередь SendMessage'а под именем воркера. Требует моста к harness'у (нет сегодня).
- «Остановить агента» — POST → `TaskStop <id>`. Тоже требует моста.
- «Одобрить действие агента» — очередь approvals (LangChain Agent Inbox паттерн).

Для v1 достаточно перечисленного; всё остальное — по одному действию за раз.

### A.6. Безопасность (переработана по Critical 1, findings 7, 8)

Три независимых слоя защиты против «главного запрета владельца» — «агент не должен уметь опубликовать скилл». Каждый закрывает один класс атаки, никакой не единственный.

#### Слой 1 — Bearer-токен на веб-эндпойнте (защита от случайного локального curl'а)

- При первой установке `tools/web/plist.sh install` генерирует 32-байтовый secret (`openssl rand -hex 32`), кладёт в `~/.config/gosleep/web.token` с `chmod 0600`.
- Сервер при старте читает файл; хранит secret в памяти.
- Первый заход владельца в браузер — по URL `http://127.0.0.1:7331/setup?tok=<secret>`; страница `setup` кладёт secret в `sessionStorage`, редирект на главную. URL с секретом печатается в терминал владельца после `install` (через `open` — открывает браузер).
- Все fetch/EventSource клиента отправляют `Authorization: Bearer <secret>`.
- Все POST-эндпойнты проверяют Bearer; без совпадения — 401.
- **Что этот слой закрывает:** случайный `curl -X POST http://127.0.0.1:7331/api/skills/publish` без токена. Автоматизированные атаки, не читающие файловую систему.
- **Что этот слой НЕ закрывает:** агент под тем же UID может прочитать `~/.config/gosleep/web.token` (файл 0600 same-UID — не барьер). Значит одного этого слоя мало.

#### Слой 2 — Env-секрет `GOSLEEP_WEB_TOKEN` внутри `publish.sh` (защита от bypass'а веб-сервера)

- `tools/skills/publish.sh` в самом начале проверяет: `${GOSLEEP_WEB_TOKEN:-}` пуст → `die "publish.sh must be spawned by web-server"`.
- Веб-сервер знает secret (из того же файла) и передаёт его как env в `spawn`: `spawn("bash", ["publish.sh", name], { env: { ...process.env, GOSLEEP_WEB_TOKEN: secret } })`.
- Агент вручную `bash publish.sh using-jira` — env отсутствует, скрипт немедленно завершается с exit 1 **до** любого действия.
- **Что этот слой закрывает:** обход веба через прямой запуск CLI. Без env агент не может «просто вызвать» `publish.sh`.
- **Что этот слой НЕ закрывает:** агент читает `~/.config/gosleep/web.token`, устанавливает env сам, вызывает CLI. Значит одного этого слоя тоже мало.

#### Слой 3 — TouchID-гейт **внутри `publish.sh`** (единственный настоящий барьер против агента)

- Отдельный Swift-бинарь `tools/web/bin/touchid-gate` (~40 строк, компилируется при установке через `xcrun swiftc`):
  ```
  import LocalAuthentication
  let ctx = LAContext()
  let reason = CommandLine.arguments.dropFirst().joined(separator: " ")
  var err: NSError?
  guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err) else { exit(2) }
  let sem = DispatchSemaphore(value: 0)
  var granted = false
  ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { ok, _ in granted = ok; sem.signal() }
  sem.wait()
  exit(granted ? 0 : 1)
  ```
- `publish.sh` **после** проверки env-секрета вызывает `tools/web/bin/touchid-gate "Publish skill '<name>' from gosleep"`; при exit != 0 — `die "biometric consent required"`.
- Владелец физически прикладывает палец на MacBook. Агент **не имеет доступа к сенсору** — это единственный ресурс на машине, к которому нельзя добраться через shell.
- **Что этот слой закрывает:** абсолютно всё, что делает агент под shell. Даже если агент подделал первые два слоя (украл token, установил env, спавнил CLI) — TouchID не пройдёт.
- **Fallback без сенсора / в SSH-сессии.** Если TouchID недоступен (старый Mac, headless): `touchid-gate` печатает в `/dev/tty` одноразовый 6-значный код и ждёт ввод в тот же `/dev/tty` (не stdin — иначе агент подадит из pipe). Агент, работающий в неинтерактивном контексте Claude Code, не имеет `/dev/tty` владельца → отсекается. Слабее биометрии (можно подсадить keyboard-скрипт), но лучше отсутствия защиты.

#### Дополнительные защитные слои (не главные, но обязательные)

- **Bind только `127.0.0.1`.** Явно в коде: `serve({ hostname: "127.0.0.1", port: 7331 })`. Не `0.0.0.0`, не `::`. Никакая другая машина в сети не дотягивается.
- **Host-header check.** `Host` заголовок должен быть строго `127.0.0.1:7331` (не `localhost` — резолвится в IPv6 и может обойти bind-guard при DNS-rebinding). Отдельная строка middleware.
- **Origin/Referer check** — уточнено по finding 8. Правило: **должен быть либо Origin, либо Referer, оба если есть должны совпадать с `http://127.0.0.1:7331`**. Обработать оба случая (`localhost` резолв в IPv6 → `Origin: http://[::1]:7331` — в v1 не поддерживаем, поскольку bind IPv4-only).
- **Идемпотентность через persistent JSONL** (finding 6): `.artifacts/web/idempotency.jsonl` — append `{key, ts, endpoint}` с fsync; при старте сервера подгружается в память; TTL 24 ч, чистится в фоне.
- **Concurrency=1 на write-эндпойнт.** Внутрипроцессный thread-lock.
- **Timeline-запись через `withTimeline`** — каждый write-action фиксируется в `docs/lab/events/*.jsonl` до и после спавна CLI (см. A.9 риск 7.6).

### A.7. Оценка трудоёмкости (пересчитана по finding 4 red-team, honest breakdown from zero)

**Предпосылки (не веб — но без них кнопки нет):**

| Работа | Человеко-дни |
|---|---|
| **Этап 2 плана: схема `docs/skills/CHANGELOG.jsonl` + JSON-schema валидация + smoke-тест** | 0.5 |
| **Этап 3 плана: `tools/skills/publish.sh`** (diff + backup + poштучный rsync + строка в CHANGELOG + env-check + вызов TouchID-гейта + smoke-тест) | 1.0 |
| **Правка `chronicler.py` + новая `screens/skills.tsx`** (проекция CHANGELOG в bundle, восьмой экран, обновление `page.tsx`, `render.tsx`, `types.ts`, `site/README.md`) | 0.5–1.0 |
| **Итого предпосылок:** | **2.0–2.5 дня** |

**Веб-часть (первая рабочая кнопка):**

| Работа | Человеко-дни |
|---|---|
| **Chronicler top-level lock + `--coalesce-since` + smoke-тест гонки** (Critical 2) | 0.5 |
| **Скелет `tools/web/serve.ts`:** Hono + Bearer + Origin/Referer + Host-guard + launchd-plist + `install-deps.sh` + Swift-компиляция TouchID-гейта + `plist.sh install/uninstall` со secret-миграцией | 1.5 |
| **POST /api/skills/publish + withTimeline + persistent idempotency + `chronicler.sh --coalesce-since`** | 0.5 |
| **`client-transport.ts` + `client-actions.ts`:** probe /api/whoami, fetch-обёртка с Bearer, кнопка «Опубликовать», toast, `event: rotate` handling | 0.5 |
| **Guard'ы `smoke.sh`:** нет `fs.writeFile*` в write-path; bundle читается только `open→close`; idempotency-файл 0600; Bearer-secret не commit'ится; withTimeline обёрнута на всех POST | 0.5 |
| **Тесты гонки chronicler'а + SSE-rotation** | 0.5 |
| **Итого веб-части:** | **~3.5 дня** |

| Веха | **Полный срок с нуля** |
|---|---|
| **v1: первая рабочая кнопка «Опубликовать `<name>`»** | **≈ 3.5–5 дней** одному воркеру (2 дня предпосылок + 3.5 веба, с округлением на неопределённость) |
| v1.1: ответ на вопрос (со status-check) + force tick + FYI-ack | +1.5 дня (три эндпойнта, каждый с withTimeline) |
| v1.2: SSE-стрим событий, toast'ы, живые счётчики, UTC-rotation | +2 дня |
| v1.3: полировка (Bearer setup flow, доки, интеграция в hooks-verify) | +1.5 дня |
| **Итого полный v1** | **≈ 10–14 дней** одному воркеру |

Что можно отдать одному воркеру: всё в v1 — задача уровня одной эпики GSL-XXX с 8–10 Task'ами. Один воркер тянет; параллелится только по этапам плана (этап 2 CHANGELOG-schema — один воркер; этап 3 publish.sh — другой параллельно; этап 4 сервер начинается после обоих). Три воркера параллельно за ~7 дней технически возможны, но нужен координатор — не рекомендую в первый заход.

**Забытые в v1 работы, теперь учтены** (по red-team):
- Стек установки Node-зависимостей (Hono, zod, pino, tsx) + `install-deps.sh` — в скелете сервера.
- launchd-plist install/uninstall с миграцией secret'а — в скелете сервера.
- CHANGELOG.jsonl schema + валидатор — этап 2 предпосылок.
- Новая страница `skills.html` в chronicler — этап 2/3 предпосылок.
- Guard'ы `smoke.sh` — 0.5 дня отдельной строкой.
- Тесты SSE-rotation, тесты гонки chronicler'а — 0.5 дня отдельной строкой.
- Bearer-token setup flow (setup-URL, sessionStorage) — в скелете `client-transport.ts`.
- Документирование в `CLAUDE.md` и `docs/runbooks/` — 0.5 дня в v1.3.
- Интеграция с `hooks-verify.sh` — 0.5 дня в v1.3.

### A.8. Миграционный путь по шагам

Каждый шаг — точка, после которой систему можно оставить в стабильном состоянии.

**Шаг 0 (0 дней, уже есть).** Статический дашборд работает. Кнопка «Опубликовать» существует только как «команда для копирования». Точка отката: этот шаг.

**Шаг 1 (0.5 дня). Схема CHANGELOG.jsonl (этап 2 плана).** Заводится `docs/skills/CHANGELOG.jsonl` (пустой) + JSON-schema + smoke-тест на формат. Точка: файл есть, но никто в него ещё не пишет.

**Шаг 2 (1 день). CLI `publish.sh` с тройной защитой (этап 3 плана).** Пишется `tools/skills/publish.sh` — env-check (`GOSLEEP_WEB_TOKEN`), TouchID-гейт (`touchid-gate`), diff, бэкап в `docs/skills/backups/`, поштучный rsync, запись в `CHANGELOG.jsonl`. Компилируется Swift-бинарь. **Владелец может публиковать вручную** (запускает `GOSLEEP_WEB_TOKEN=$(cat ~/.config/gosleep/web.token) bash tools/skills/publish.sh using-jira` из терминала — TouchID подтверждает — работает). Точка: публикация работает без веба.

**Шаг 3 (0.5–1 день). Новая страница `skills.html` в chronicler.** Проекция CHANGELOG → bundle, восьмой экран. Открывается из `file://`, показывает список скиллов, статус, команду для копирования. Точка: страница есть, кнопки нет — только «команда для копирования».

**Шаг 4 (0.5 дня). Chronicler top-level lock.** Правка `chronicler.sh` — 30 строк bash + smoke-тест гонки. Точка: все callers сериализованы, никакие ребилды не наступают друг другу.

**Шаг 5 (1.5 дня). Скелет сервера.** `tools/web/serve.ts` — Hono, GET `/api/whoami`, GET `/site/*`, привязка к `127.0.0.1:7331`, launchd-plist (`RunAtLoad=true, SessionCreate=true, KeepAlive`). `plist.sh install` генерирует Bearer-secret, кладёт в 0600-файл, компилирует TouchID-гейт. Точка: сервер работает, ничего нового не делает, откатываемо `launchctl bootout`.

**Шаг 6 (0.5 дня). Первая кнопка.** POST `/api/skills/publish` + `withTimeline` + persistent idempotency + `chronicler.sh --coalesce-since=$T_write`. Клиентский `client-transport.ts` + `client-actions.ts` подключают кнопку. **Первая рабочая интерактивная функция.** Точка: если что-то пошло не так — `launchctl bootout`, страница возвращается к статичному виду.

**Шаг 7 (0.5 дня). Guard'ы и тесты.** `smoke.sh`-проверки на write-set сервера; тест гонки chronicler; тест SSE-rotation. Точка: v1 первой кнопки закреплён.

**Шаг 8 (1.5 дня). Ответ на вопрос + force tick + FYI-ack.** Три новых POST-эндпойнта, три новые кнопки. Каждый через `withTimeline`. Точка: те же гарантии, отключаемо.

**Шаг 9 (2 дня). SSE + toast + patch-badges + UTC-rotation.** GET `/api/events?since=` + tail-обработчик + минутный таймер rotation + `EventSource` в клиенте + toast'ы. Точка: живой поток работает; при упавшем SSE клиент фалбэчится на F5.

**Шаг 10 (1.5 дня). v1.3 полировка.** Setup-URL для Bearer, документация в CLAUDE.md и runbook'ах, интеграция с hooks-verify. Точка: v1 закреплён в проде.

**Точки, после которых система стабильна:** после каждого шага. Никакой шаг не оставляет систему в полу-рабочем состоянии — сервер аддитивен, `launchctl bootout` возвращает к статике.

### A.9. Риски и как они закрыты

Прямо использую раздел 7 our-constraints.md **плюс** найденные red-team.

| Риск | Как закрыт |
|---|---|
| **7.1. Гонка с хроникёром при чтении `render_bundle.json`** | Сервер: `open→read→close` в одном хендлере; кэш инвалидируется по `st_ino`; ETag(inode) → 304 на неизменных данных. `fs.watch` в hot-path bundle не используется (finding 12). |
| **7.2. Порча JSONL** | Абсолютный запрет `fs.write*` в `docs/lab/`. Сервер вызывает только CLI. Автопроверка `grep`-ом в `smoke.sh`. Для `POST /api/questions/answer` — pre-check статуса `open` через `lab-emit list --json` (finding 11). |
| **7.3. Конфликт с git (grade=fresh инвариант GSL-194)** | Сервер ничего не коммитит. Действия, меняющие данные, синхронно вызывают `chronicler.sh --quiet --coalesce-since=$T_write` до ответа клиенту. Если пересборка провалилась — 500 с плашкой в ответе. |
| **7.4. Безопасность локального порта** | Три слоя защиты в A.6 (Bearer + env-secret + TouchID); плюс bind `127.0.0.1`, Host-header, Origin/Referer, idempotency, concurrency=1 (Critical 1 + findings 7, 8). |
| **7.5. Schema-drift `render/7 → render/8`** | Сервер не декодирует bundle в свои типы; работает как с opaque `Record<string, unknown>`. Мирроринг типов — в один PR с bump. |
| **7.6. Действия из веба невидимы в timeline / hook-фильтрация** (Critical 3) | Каждый POST-эндпойнт обёрнут `withTimeline(endpoint, params, fn)`: **до** спавна CLI пишет `server.intent` через `lab-log.sh` (атомарный append под dir-локом), **после** — `server.outcome` с exit-кодом. Плюс `touch .artifacts/lab/debounce/web-last-write` (сигнал debounce-waiter'у). Если сервер упал между spawn и outcome — на диске остался `intent` без `outcome`; `tick.sh` на следующем пасе (максимум 5 мин, обычно быстрее — debounce triggerится через web-last-write) видит осиротевший intent и делает reconcile (пишет `server.outcome` с `status=orphan`). |
| **7.7. Мультиписатель одного файла** | Сервер не заводит собственных lock'ов; всё делегирует CLI. Внутрипроцессный thread-lock на каждый write-эндпойнт. |
| **Гонка параллельных `chronicler.sh`** (Critical 2) | Top-level mkdir-lock в `chronicler.sh` + флаг `--coalesce-since=<epoch>`: если bundle mtime > coalesce-since, второй caller видит «уже свеж, работать не буду», exit 0. Debounce, tick и веб координируются через один lock. |
| **UTC-day rotation SSE-tail** (finding 5) | Минутный таймер + inode-check; при смене FD переоткрывается, `event: rotate` рассылается клиентам; клиент по rotate заново читает bundle (seq суточная). |
| **Idempotency in-memory ≠ переживает reload** (finding 6) | Персистентная JSONL-мапа `.artifacts/web/idempotency.jsonl` с fsync и загрузкой на старте. |
| **launchd `RunAtLoad=false` требует ручного `launchctl load`** (finding 13) | Изменено: `RunAtLoad=true, SessionCreate=true, KeepAlive={"SuccessfulExit":false}`. Владелец логинится — сервер работает. |
| **Клиентский код ~200 строк — оптимистично** (finding 14) | Разбит на два файла: `client-transport.ts` (~150) + `client-actions.ts` (~250) = 400. Учтено в A.7. |
| **623 КБ bundle на каждый запрос** (finding 9) | ETag(inode) + `If-None-Match` → 304 на неизменных данных. |
| **Debounce-log шум от двойных запусков** (finding 10) | Chronicler-lock (см. Critical 2) плюс `--carrier=web` в ledger — источники запусков различимы. |

### A.10. Честные плюсы и минусы

**Плюсы:**
- Минимум новой поверхности: ~700 строк TypeScript + 40 строк Swift + 30 строк bash в chronicler.
- Статика остаётся полноценным fallback без сервера.
- Стек — целиком TypeScript на веб-части (сервер, клиент). Python и Go — существующие скрипты.
- Первая рабочая кнопка — 3.5–5 дней с нуля (честно; было 1–2 в v1 документа — красная команда правомерно поймала).
- Обратимо: `launchctl bootout` возвращает всё в исходное состояние.
- Работает под подпиской Claude: сервер не вызывает Claude API вообще.
- Идеально ложится на план skills-governance (этап 4).
- **Главный запрет владельца защищён биометрией.** Агент структурно не пройдёт TouchID-сенсор.

**Минусы:**
- Клиентский UX останется в стилистике текущего статического дашборда. shadcn/framer-motion — отдельным эпиком когда захочется.
- Живой поток даётся не «дизайн-first», а «данные-first».
- Нельзя добавить сложную интерактивность одной страницей.
- **TouchID-гейт добавляет трение** — каждая публикация требует физического касания сенсора. Владелец может воспринять как «слишком много». Альтернативы (Cache-TTL «не спрашивать 5 мин после первой публикации») — снижают гарантию; рекомендую не вводить в v1, обсудить после первых десяти публикаций.
- **Требуется MacBook с TouchID.** Fallback (одноразовый код в `/dev/tty`) слабее.

---

## Вариант B — «Bun + React SPA калька Warren»

### B.1. Схема

```
┌─── Существующее (хроникёр, JSONL, все CLI, lab-*.sh) — сохраняется ───┐
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──── НОВОЕ: tools/web-warren/server (Bun + TypeScript, ~1500 строк) ────┐
│  bind 127.0.0.1:7331                                                    │
│  Warren-подобные эндпойнты:                                             │
│    GET  /healthz, /version, /whoami                                     │
│    GET  /runs, /runs/:id                                                │
│    GET  /runs/:id/events?follow=1 (NDJSON-стрим — прямая калька Warren) │
│    POST /dispatch                  (в v1 не открываем — нет моста)      │
│    POST /runs/:id/steer, /cancel   (то же)                              │
│    POST /skills/publish            (первая рабочая кнопка v1)           │
│    GET  /analytics/cost                                                 │
│  event-sourcing поверх JSONL: проекция в SQLite (WAL) для быстрых       │
│  фильтров — tools/web-warren/store/warren.db (не в git)                │
│  Три слоя защиты те же, что в A: Bearer + env-secret + TouchID          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──── НОВОЕ: tools/web-warren/ui (Vite + React 18 + shadcn, ~4000+ LOC) ─┐
│  React 18.3 + Vite 6 + Tailwind v4 + shadcn/radix + TanStack Query 5   │
│  + react-router 7 + Recharts 3.8 + framer-motion 12 + lucide-react     │
│  Экраны: Overview, Runs, Timeline, Questions, Skills (первая кнопка),   │
│           Cost, Fleet, Library — заново, с shadcn-компонентами         │
│  Стейт: server-side через TanStack Query + NDJSON-хуки                  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
Существующие static/*.html — остаются для file:// fallback (хроникёр пишет).
```

Три слоя защиты (Bearer + GOSLEEP_WEB_TOKEN + TouchID) переносятся из A без изменений — они не зависят от фреймворка.

### B.2. Стек поимённо

| Слой | Что |
|---|---|
| Runtime | **Bun 1.x** (либо Node.js + Fastify) — как у Warren |
| HTTP | нативный `Bun.serve` (или Fastify) |
| Валидация | **zod 3.x** |
| Логирование | **pino** |
| Хранилище | **SQLite (WAL)** — ежедневно перестраиваемый из JSONL |
| Фронт | React 18.3 + Vite 6 + TypeScript + Tailwind v4 + shadcn/radix + TanStack Query 5 + react-router 7 + Recharts 3.8 + framer-motion 12 + lucide-react |
| Транспорт | **NDJSON-over-HTTP** (не SSE) — калька Warren |
| Идемпотентность | Persistent JSONL (то же, что A) |
| Сборка | Vite → `dist/`; Bun отдаёт статику + API |
| Тесты | vitest, golden-response'ы |
| Запуск | launchd |

### B.3. Что делаем с текущим конвейером

Хроникёр сохраняется; SPA дублирует экраны заново под shadcn. Статические HTML остаются fallback'ом (нужны для mobile/README.md, которую GitHub рендерит только как Markdown — SPA не подменит).

### B.4. Транспорт

NDJSON-over-HTTP через `GET /runs/:id/events?follow=1` — Warren-стиль. Клиент — `fetch()+ReadableStream` + ручной reconnect. То же UTC-rotation, что и в A.

### B.5. Действия v1

Те же, что A. Дополнительно эндпойнты Warren (steer/cancel/dispatch) спроектированы, но в v1 не открываются — требуется мост к harness'у.

### B.6. Безопасность

Все три слоя A (Bearer + env-secret + TouchID) применимы. Плюс:
- Bearer-token в заголовке был у Warren изначально — в B это ровно тот же слой 1 из A.
- CSP на выдаваемой SPA — запретить любые external-ресурсы.

### B.7. Трудоёмкость (пересчитано)

| Веха | Одному воркеру |
|---|---|
| Предпосылки (этапы 2, 3 плана + skills.html-page) | ~2.5 дня |
| Chronicler top-level lock | 0.5 дня |
| Скелет Bun-сервера + auth + логи + Bearer + env-secret + TouchID-гейт + launchd | 2.5 дня |
| Проекция JSONL → SQLite (WAL) + инкрементальная перестройка + тесты | 2 дня |
| NDJSON-стрим `/runs/:id/events` + client-hook + reconnect + UTC-rotation | 2 дня |
| Скелет Vite + shadcn setup + design tokens + первая страница Skills | 3 дня |
| Первая рабочая кнопка «Опубликовать» + withTimeline + persistent idempotency | 1 день |
| Дублирование семи экранов на shadcn | 8–12 дней |
| Идемпотентность, тесты, документация | 2 дня |
| **Первая рабочая кнопка** | **≈ 11–12 дней** одному воркеру |
| **v1 полноценно** | **≈ 25–30 дней** одному воркеру |

### B.8. Миграционный путь

Как в A, только длиннее: после «первая кнопка» ещё 15–20 дней на дублирование экранов. Промежуточное состояние — «SPA работает частично, статика — для остального» — неудобно в живом использовании.

### B.9. Риски

Все риски A применимы, плюс:

| Риск | Смягчение |
|---|---|
| **Design-drift.** Warren-стек не гарантирует Warren-стиль; прошлый заход получил «AI-slop ×2». | Дизайн-консультация до начала работ; фиксация design-tokens в отдельном PR. |
| **Проекция JSONL → SQLite дрейфует.** | Ежедневная полная перестройка; проекция описана в один код-модуль. |
| **Дублирование логики счёта.** Warren-фронт может показать одно число, статика — другое. | Все числа тянутся из `render_bundle.json`; Warren-стек только для представления. |
| **Обход lab-emit'а.** Соблазн писать в SQLite напрямую. | Абсолютный запрет; все write'ы через CLI. |
| **Клиентский бандл раздувается.** shadcn+recharts+framer-motion ~500 КБ gzip. | Не критично для localhost, но следить. |

### B.10. Плюсы и минусы

**Плюсы:** красивый живой референс (Warren), готовые компоненты, расширяется до steer/dispatch без переписи транспорта.

**Минусы:** в 5–10 раз дороже A на первую кнопку (11–12 дней vs 3.5–5); дублирует уже существующие семь страниц; требует дизайн-лида; SQLite-проекция — новый компонент с гонками; Warren платит API-ключом за право быть чистым HTTP-плейном, мы этот платёж делать не можем; требует Bun (или Fastify как замена).

---

## Вариант C — «Полная замена конвейера на Next.js» (не рекомендую)

Как в v1 документа — не меняется. Next.js 15 App Router, React 19, Tailwind, shadcn. Chronicler-python остаётся источником данных, но SSG-часть выкидывается.

**Плюсы:** один инструмент делает всё; индустриальный стандарт.

**Минусы:** дороже A в 15–20 раз (первая кнопка ≈ 12–17 дней с учётом предпосылок); выкидывает работающую SSG-часть; возвращает «два ренделера» через mobile/README.md (GitHub не рендерит React — хроникёр всё равно должен писать Markdown); прямо противоречит указанию владельца («стек не переписывать»); overkill для однопользовательского локального инструмента.

Три слоя защиты (Bearer + env-secret + TouchID) в Next.js применимы, но server-actions делают невидимой границу «клиент → сервер»; проще случайно записать в `docs/lab/` в обход CLI.

---

## Сравнительная таблица (обновлена по red-team)

| Ось | A: тонкий TS-демон | B: Bun+React SPA | C: Next.js |
|---|---|---|---|
| **Сложность (LOC нового TS/Swift/bash)** | ~700 TS + 40 Swift + 30 bash | ~1500 сервер + ~4000+ SPA | ~2000+ Next-app |
| **Срок до первой рабочей кнопки (с нуля)** | **3.5–5 дней** | ~11–12 дней | ~12–17 дней |
| **Срок до полного v1** | **10–14 дней** | ~25–30 дней | ~30–45 дней |
| **Риск (шансы что-то сломать)** | Низкий: аддитив, обратим `launchctl bootout` | Средний: SQLite-проекция + design-drift | Высокий: cut-over, удаление SSG |
| **Соответствие «TS-стек»** | Полное (сервер TS, клиент TS) | Полное | Полное |
| **Обратимость** | **Полная**: выключил сервер — статика работает | Частичная: SPA живёт параллельно | Слабая: SSG удалена, откат из git |
| **Уважает существующий конвейер** | Целиком (только 30 строк в chronicler.sh) | Оборачивает (аддитив) | Заменяет (SSG удаляется) |
| **Работает под подпиской Claude** | Да | Да | Да |
| **Соответствие плану skills-governance этап 4** | Точный шаблон | Совместим, но overkill | Совместим, но overkill |
| **Готов к добавлению новых действий (steer, cancel)** | Да, по одному эндпойнту | Да, эндпойнты уже спроектированы Warren'ом | Да, через server actions |
| **Требует новых зависимостей на машине** | Node + Hono + zod + tsx + Swift SDK (для TouchID) | Bun + shadcn/tailwind + вся Warren-цепочка | Next.js весь стек |
| **Дизайн-лид нужен** | Нет | Да | Да |
| **Мобильная проекция (Markdown в GitHub)** | Работает как раньше | Работает как раньше | Требует дублировать в хроникёре |
| **Обход хроникёра при write-action** | `chronicler.sh --quiet --coalesce-since` синхронно + top-level lock | То же | То же |
| **Защита от «агент публикует»** | 3 слоя (Bearer + env + TouchID) | 3 слоя | 3 слоя, но server-actions размывают границу |
| **Timeline полноты (действия из веба)** | withTimeline на каждом POST + touch web-last-write; reconcile через tick | То же | То же, но server-action-магия делает enforcement сложнее |

---

## Рекомендация: **вариант A — «тонкий TS-демон над существующим конвейером»** с шестью обязательными условиями от red-team

**Почему A:**

1. Экономит недели работы (первая кнопка 3.5–5 дней против 11–17 у B/C; полный v1 10–14 против 25–45).
2. Ничего не переписывает. Все инварианты `tools/lab/ui/README.md` (SSG-only client, единый рендерер, деградация вместо отказа, числа считает Python) остаются в силе.
3. Стек — весь TypeScript на веб-части (Node + Hono + Preact-обогащение). Один Swift-бинарь (~40 строк) для TouchID — единственное локальное исключение, оправданное биометрической безопасностью.
4. Максимально обратим (`launchctl bootout`).
5. Работает под подпиской Claude.
6. **Главный запрет владельца защищён механизмом, а не оговоркой:** TouchID-сенсор — единственный ресурс машины, к которому агент структурно не имеет доступа.

**Шесть обязательных условий (из red-team итога), закладываются в спеку эпика GSL-XXX до старта:**

1. **Bearer-token в веб-эндпойнте + env-secret `GOSLEEP_WEB_TOKEN` в CLI + TouchID-гейт внутри `publish.sh`.** Три слоя защиты, каждый закрывает свой класс. Без всех трёх — «главный запрет владельца» не защищён.
2. **Top-level mkdir-lock в `chronicler.sh` с флагом `--coalesce-since=<epoch>`.** 30 строк bash. Закрывает Critical 2 red-team.
3. **UTC-day rotation в SSE-tail: минутный таймер + inode-check + `event: rotate` клиенту.** Закрывает finding 5.
4. **Персистентная idempotency-мапа** в `.artifacts/web/idempotency.jsonl` с fsync и load-on-start.
5. **Обязательный Host-header check** + уточнённая логика Origin/Referer (обязателен хотя бы один, оба если есть должны совпадать).
6. **Явные тесты гонки chronicler'а + SSE-rotation'а через midnight** в `smoke.sh`.

Плюс седьмое, важное для наблюдаемости и упомянутое как Critical 3:

7. **Хелпер `withTimeline(endpoint, params, fn)` на всех POST-эндпойнтах**, пишущий `server.intent` до и `server.outcome` после спавна CLI + `touch .artifacts/lab/debounce/web-last-write`. Reconcile осиротевших intent'ов — задача tick.sh.

---

## Раздел «Что НЕ делаем и почему»

- **Electron / Tauri** — не делаем.
- **Отдельный SPA-фреймворк, если он не нужен** — не делаем в v1.
- **Переписывание хроникёра на TypeScript** — не делаем.
- **Warren-калька с API-ключом Anthropic** — не делаем.
- **WebSocket** — не делаем.
- **Отдельный порт для чтения с телефона через Tailscale / ntfy / ngrok** — не делаем.
- **PWA-manifest, service-worker** — не делаем.
- **Прямая запись в JSONL из сервера** — не делаем.
- **Массовые операции** (`--all`) — не делаем в принципе.
- **`git commit` из сервера** — не делаем.
- **Отключение Guard в `install.sh`** — не делаем.
- **TouchID-кэш «не спрашивать 5 мин после первой публикации»** — не делаем в v1. Владелец нажимает сенсор каждый раз. Обсуждаем после первых десяти публикаций.
- **`localhost` в hostname** — не используем. Только `127.0.0.1` (localhost может резолвиться в IPv6, минуя bind-guard).

---

## Ответ на red-team (построчный разбор)

**Три Critical — приняты полностью, закрыты механизмами.**

### C1. Локальный порт не защищён от локальных агентов.

**Принято.** Ответ — три слоя A.6:
1. Bearer-token — защита от «случайного curl'а без токена». Слабее всего (агент читает файл).
2. Env-secret `GOSLEEP_WEB_TOKEN` в `publish.sh` — защита от bypass'а веба через прямой запуск CLI.
3. **TouchID-гейт внутри `publish.sh`** — единственный слой, который агент структурно не может пройти.

**Остаточный риск (честно):** если владелец приложил палец к сенсору по ошибке (например, macOS запросил TouchID для чего-то другого сразу после того, как агент послал POST), — публикация проходит. Реалистичное смягчение: TouchID-промпт содержит текст «Publish skill '<name>' from gosleep» — владелец обязан прочитать до нажатия. Второй риск: MacBook без TouchID-сенсора (старый Air) — fallback на одноразовый код в `/dev/tty` слабее биометрии, агент в неинтерактивном контексте tty не имеет, но keyboard-скрипт под тем же UID может symbolic-подсунуть код. **Абсолютной защиты нет; TouchID — лучшее, что даёт macOS без Yubikey; без Yubikey остаточный риск в 1-2% сценариев остаётся, что честно.**

### C2. Гонка «синхронный chronicler после write» не закрывает параллельного debounce.

**Принято.** Ответ — top-level mkdir-lock в `chronicler.sh` + флаг `--coalesce-since=<epoch>`:
- Веб-сервер после publish.sh записывает `T_write = time()` и вызывает `chronicler.sh --quiet --coalesce-since=$T_write`.
- Chronicler.sh пытается взять lock; если lock свободен — берёт и работает; если lock занят — ждёт до 30 с.
- Когда лок освобождается: проверяет `stat("render_bundle.json").st_mtime`. Если mtime > T_write, значит предыдущий caller (debounce) уже пересобрал с учётом наших данных → выход 0 без работы.
- Если mtime < T_write — берёт лок и работает.

Второй debounce-caller тоже проходит через тот же lock. Гарантия: **в любой момент времени работает ровно один chronicler**, и наши данные гарантированно попадают в bundle не позже, чем через max(30с, время работы одного chronicler'а ≈ 5.3 с).

Что нужно изменить: 30 строк bash в `tools/lab/chronicler.sh`. Плюс smoke-тест гонки. Плюс `--carrier=web` в ledger, чтобы источники запусков различались (finding 10).

### C3. Действия из веба невидимы (хуки Claude Code не срабатывают на server-spawn).

**Принято.** Ответ — обёртка `withTimeline` на каждом POST-эндпойнте:

```
async function withTimeline<T>(ep, params, fn): Promise<T> {
  const intent_id = randomUUID();
  spawnSync("bash", ["tools/lab/lab-log.sh",
    "--type", "server.intent", "--actor", "web",
    "--data", `endpoint=${ep},intent_id=${intent_id},params=${JSON.stringify(params).slice(0,200)}`]);
  touchSync(".artifacts/lab/debounce/web-last-write");
  try {
    const result = await fn();
    spawnSync("bash", ["tools/lab/lab-log.sh",
      "--type", "server.outcome", "--actor", "web",
      "--data", `intent_id=${intent_id},status=ok`]);
    return result;
  } catch (err) {
    spawnSync("bash", ["tools/lab/lab-log.sh",
      "--type", "server.outcome", "--actor", "web",
      "--data", `intent_id=${intent_id},status=fail,err=${String(err).slice(0,200)}`]);
    throw err;
  }
}
```

Проверка: `smoke.sh` содержит правило «каждый POST-роут в `serve.ts` синтаксически внутри `withTimeline(...)`». Без обёртки эпик не проходит гейт. Плюс тест: `spawn serve.ts; POST /api/skills/publish; kill -9 после 100мс; grep events/*.jsonl на server.intent без server.outcome; tick.sh --force; grep server.outcome status=orphan`.

Debounce-waiter уже сегодня читает sentinel-файлы; добавляем `.artifacts/lab/debounce/web-last-write` как дополнительный триггер — при live-сервере debounce отработает быстрее, чем 5-минутный тик.

**Пересчёт сроков — принято.**

Красная команда правомерно поймала: «1–2 дня» относится к веб-части при готовых предпосылках, не к пути от нуля. От нуля — 3.5–5 дней первая кнопка, 10–14 полный v1. Раздел A.7 переписан с честным breakdown'ом; все забытые работы (deps, launchd, schema, page in generator, guards, setup flow, docs) включены в оценку.

Аргумент, где красная команда чуть строже необходимого: она разбивает предпосылки (этапы 2, 3 плана) и веб-часть в одну кучу. Формально сроки правильны, но эпик по плану skills-governance — это **отдельная эпика от веба**, и владелец может согласовать «этап 2 + 3» отдельно, а веб (шаги 4–10 моего migration path) — в следующем эпике. Тогда «первая кнопка от начала веб-эпика» — 1.5–2.5 дня, но это не «от нуля», как справедливо требовала красная команда учесть.

**Пять Major и шесть Minor — все приняты, за одним исключением.**

- **Major 5 (SSE UTC-rotation)** — принят, реализация в A.4.
- **Major 6 (persistent idempotency)** — принят, реализация в A.2.
- **Major 7 (owner-check theatre)** — принят, реализация в A.6 (три слоя).
- **Major 8 (Origin/Referer edge cases)** — принят, реализация в A.6 (обязательный Host + правило «хотя бы один из Origin/Referer, оба совпадают если есть»).
- **Minor 9 (623 КБ bundle nagr.)** — принят, ETag(inode) + 304.
- **Minor 10 (debounce log noise)** — принят, `--carrier=web` в ledger.
- **Minor 11 (dedup не бесплатен для answers)** — принят, pre-check `list --json --re Q` перед answer.
- **Minor 12 (`fs.watch` задержка)** — принят, `fs.watch` **не используется** в hot-path bundle; политика — только `open→read→close` с инвалидацией по st_ino перед чтением.
- **Minor 13 (`RunAtLoad=false`)** — принят, изменено на `RunAtLoad=true, SessionCreate=true, KeepAlive`.
- **Minor 14 (~200 строк client-actions.ts занижено)** — принят, разбиение на `client-transport.ts` (~150) + `client-actions.ts` (~250) = ~400 строк.

**Единственное оговорочное несогласие:**

В **Major 4** красная команда честно сказала: «Разбить эпик» — я так и сделал. Не оспариваю сумму, но подчёркиваю разделение: часть «этап 2 + 3 плана skills-governance» — это отдельная эпика GSL-174, которая идёт независимо от веб-эпика. Веб-эпик может начинаться после её завершения, и тогда «первая кнопка от начала веб-эпика» — 1.5–2.5 дня (не оспариваю 3.5–5 как «от нуля»). Владелец при планировании должен видеть оба числа: **если считаем от «сегодня, в репе ничего нет» — 3.5–5 дней; если считаем от «этап 3 плана уже сделан, `publish.sh` работает вручную» — 1.5–2.5 дня**. Оба числа честны, зависит от того, как нарезаем эпики.

---

## Проверено красной командой и держится (фундамент, на который смело опираемся)

Восемь утверждений архитектуры, которые красная команда попыталась опровергнуть и не смогла:

1. **`lab-write.sh` действительно атомарен** (`lab-write.sh:33-83`): `mkstemp` в той же ФС → `write` → `flush` → `fsync` → `os.replace`. Читатель гарантированно видит либо весь старый файл, либо весь новый. Sweep 60-секундных temp'ов защищает от kill-9 без мусора.
2. **`os.replace` в chronicler для `render_bundle.json` меняет inode.** Кэш по mtime сломался бы в same-second replace; кэш по st_ino — правильная стратегия (использована в A.4).
3. **`lab-emit`/`lab-log` действительно append-only с dir-lock'ами** (`lab-log.sh:100-126`, `lab-emit.sh:137-155`). Единственные писатели соответствующих файлов.
4. **`tick.sh` действительно сериализован собственным mkdir-lock'ом** («ONE TICK AT A TIME»). Второй тик пишет `result="skipped-lock-held"` и молча выходит. Идемпотентен по конструкции.
5. **`chronicler.py --quiet` действительно 0 API calls.** `subprocess`-вызовы `claude` только в `narrate()` (`chronicler.py:3087`), в `--quiet`-режиме не вызываются. Веб-сервер может уверенно спавнить `chronicler.sh --quiet` — токены не тратятся.
6. **Мобильная проекция в Markdown действительно нужна как отдельный артефакт.** Никакой вариант архитектуры (даже C) не может её убрать без потери GitHub-render'а — это отдельный аргумент против варианта C.
7. **Bind на `127.0.0.1` действительно отсекает внешнюю сеть.** (Тривиально верно.)
8. **Работа под подпиской, а не API-ключом.** Сервер не вызывает Claude API, все действия — spawn CLI.

Это — фундамент. Никакие дальнейшие правки этих семи-восьми пунктов не пересматривают.

---

## Приложение: точки в исходных материалах, на которых базируется рекомендация

- Warren-стек и NDJSON: `findings/autosk-warren-ui.md` разделы 3 и 6.
- Рыночная рекомендация «локальный демон + SPA + SSE»: `findings/harness-landscape-ui.md` раздел 3.
- Ограничения (файловая семантика, гонки, безопасность, `render/7` контракт, GSL-194, мобильный freeze): `findings/our-constraints.md` разделы 3, 5, 6, 7.
- Инвентарь текущего веба, «стек не переписывать»: `docs/reports/web-admin-inventory-2026-08-03.md` разделы 2, 4, 5.
- Первая кнопка (публикация скилла) как этап 4: `docs/plans/skills-governance-plan.md` разделы 5, 7 (этапы 3, 4, 5).
- **Red-team-разбор** (все 3 Critical + 5 Major + 6 Minor + фундамент): `redteam-verdict.md` в этой же папке. Каждая находка отражена в разделе «Ответ на red-team» выше.
