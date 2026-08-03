# Наши ограничения: что у нас уже есть и что обязана уважать будущая интерактивная веб-админка

**Автор:** researcher-3 (our-constraints).
**Дата:** 2026-08-03.
**Для:** архитектора будущего этапа v2 веба.
**Не коммитить.** Живёт как рабочий документ разговора.
**Отправная точка:** `docs/reports/web-admin-inventory-2026-08-03.md` (я его не пересказываю, а
углубляю по инфраструктурному контуру).

---

## 1. Карта конвейера — от данных до пикселя

```
                    ┌─── ГЕНЕРАТОРЫ СОБЫТИЙ (0 tokens, fail-open) ───┐
                    │  hooks (.claude/settings.json, 12 матчеров) → tools/hooks/lab-log-hook.sh
                    │       ├─ Stop / SessionStart / SessionEnd
                    │       ├─ SubagentStart / SubagentStop / TeammateIdle / StopFailure
                    │       ├─ PreCompact / PostCompact
                    │       ├─ TaskCreated / TaskCompleted / Notification
                    │       └─ PostToolUse: Bash | Write|Edit|MultiEdit | mcp__atlassian__.*
                    │                       └── ⇒ chronicler-debounce-hook.sh (fire-and-forget)
                    │
                    │  semantic emits (агенты):  tools/lab/lab-emit.sh
                    │       question | answer | resolve | apply-due | decision |
                    │       event | list | candidates | help
                    │  → каждая семантика ЗЕРКАЛИТСЯ в timeline через lab-log.sh
                    │
                    │  reconcile (внешняя правда): tools/lab/poll-fill.py (git/gh/Jira)
                    │  → src="poll-fill", ретроактивные --ts + --supersedes
                    └────────────────────────────────────────────────┘
                                              │
                            ┌─────────────────┼─────────────────┐
                            ▼                 ▼                 ▼
             docs/lab/events/*.jsonl   questions/queue.jsonl   decisions/log.jsonl
                            │           supervision/*.jsonl
                            │
                       (T1/T2 — файлы = источник правды, C8)
                            │
                            ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │  ХРОНИКЁР (bounded, no pane, exits;  3 815 строк Python stdlib)     │
   │  tools/lab/chronicler.sh → chronicler.py                            │
   │     1. читает T1/T2 + git + gh + heartbeat + STATE                  │
   │     2. фолдит вопросы/решения (одна свёртка на всю систему)         │
   │     3. считает staleness, runway, cost, fleet, self-health          │
   │     4. build_render_bundle(ctx, status) →                           │
   │          { schema:"gosleep.lab.render/7", … }                       │
   │     5. render_site(bundle):                                         │
   │          bash tools/lab/ui/render.sh (STDIN=bundle, STDOUT=JSON)    │
   │          └─ build.mjs (esbuild → node + browser)                    │
   │              ├─ src/render.tsx     (SSG через preact-render-to-string) │
   │              └─ src/client.ts      (425 стр, инлайнится как строка)     │
   │     6. status.json (schema "gosleep.lab.status/1")                  │
   │        + digest/YYYY-MM-DD-morning.md                               │
   │     7. запись через tools/lab/lab-write.sh (temp + fsync + rename) │
   │        — атомарная замена всех НЕ-append артефактов.                │
   └─────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │  ПРОИЗВОДНЫЕ АРТЕФАКТЫ (DERIVED — не редактируются руками, C8)      │
   │    docs/lab/render_bundle.json     ← ОДИН КОНТРАКТ, 624 КБ, /7      │
   │    docs/lab/status.json            ← «машинный» вид, 25 КБ, /1      │
   │    docs/lab/site/*.html            ← семь страниц (72–288 КБ)       │
   │    docs/lab/mobile/README.md       ← та же bundle, md-проекция      │
   │    docs/lab/digest/YYYY-MM-DD-morning.md                            │
   └─────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
             Читатели: file:// (владелец), GitHub (телефон),
                       tools/lab/tick.sh (checks freshness, не запускает
                       вторую сборку), архивы (git commit ledger).
```

### 1.1. Ключевые числа замеров

| Измерение | Факт | Источник |
|---|---|---|
| `chronicler.sh --dry-run` (полный проход, render+нет записи) | **≈ 5,3 с** | замер `time` 2026-08-03, `docs/lab/render_bundle.json` grade=fresh |
| `render.sh` (esbuild + Preact SSG, чистый) | **≈ 0,2 с** | замер `time` того же прогона |
| `render_bundle.json` | **624 КБ** | `wc -c docs/lab/render_bundle.json` |
| `status.json` | **25 КБ** | там же |
| `client.ts` (единственный клиентский JS) | **425 строк, 6 функций** | `wc -l tools/lab/ui/src/client.ts` |
| Всего TS/TSX в `tools/lab/ui/src/` | **3 182 строки** | `wc -l …/src/*.ts *.tsx` |
| `chronicler.py` | **3 815 строк** | `wc -l tools/lab/chronicler.py` |
| debounce PostToolUse: quiet-window / max-wait | **90 с / 600 с** | `tools/lab/chronicler-debounce.sh`, env `GOSLEEP_DEBOUNCE_QUIET/_MAX_WAIT` |
| РЕАЛЬНЫЕ длительности debounce-ребилдов (последние 3) | 912 с, 1672 с, 1497 с | `docs/lab/supervision/tick-ledger.jsonl` tail (включает окно ожидания, не только сборку) |
| `RECENT_CAP` (максимум событий в bundle) | **200** | `chronicler.py:2426` (env `GOSLEEP_RECENT_CAP`) |
| `GOSLEEP_LAB_MAX_LINES` (кап на день событий) | **50 000** | `tools/lab/lab-log.sh:78` |
| `MAX_STR` (кламп поля в одном событии) | **500** | `tools/lab/lab-log.sh:79` |
| tick.sh `GOSLEEP_TICK_FRESH` (кэш свежести) | **240 с** | `tools/lab/tick.sh:53–56` |

### 1.2. Схемы и границы данных ↔ представления

- Единственный контракт: **`gosleep.lab.render/7`** — версия строкой в `render_bundle.json:2`.
  Bump-правила описаны в комментарии `build_render_bundle` (`chronicler.py:2624–2685`):
  на «аддитивное поле, которое старый рендер не читает» — bump НЕ делать (пример: `links`,
  `supervision`, `gates` вошли без bump); bump обязателен, когда меняется семантика поля
  или удаляется поле. Мирроринг типов — `tools/lab/ui/src/types.ts:1–200+`.
- Второй, ортогональный контракт: **`gosleep.lab.status/1`** — «машинный» слепок в
  `status.json` для CLI/CI-читателей, не для UI (`chronicler.py:1406`). Bump независим.
- **Граница данных ↔ представления жёсткая по трём инвариантам** (`tools/lab/ui/README.md`
  «Four decisions, and why they are not negotiable»):
  1. **Статическая генерация, не SPA.** `file://` не имеет права на `fetch()` соседних
     файлов (CORS блокирует), поэтому все числа инлайнены на этапе сборки.
  2. **Рендерер ничего не пишет.** `build.mjs` читает stdin, пишет stdout; репо касается
     только Python через `lab-write.sh` (temp + rename).
  3. **Один рендерер, не два.** Раньше HTML собирался и в Python, и в TS — драйф случился
     внутри одной фазы (REVIEW-gsl81 M1, красный DEAD-баннер над «Live — the laboratory is
     writing itself right now»). Python-view выпилен.
  4. **Отсутствие node — деградация, не отказ.** `render.sh` всегда возвращает JSON
     `{ok:false, reason:"no-node"|"no-deps"|"build-failed"|"bad-bundle"}`, хроникёр
     штампует красный баннер и сохраняет предыдущие HTML.
- **Все числа считаются в Python один раз.** «Число, которое рендерер вычислил для себя,
  — это второе мнение, которое рано или поздно разойдётся со `status.json`»
  (`tools/lab/ui/README.md` «Rules that outlive this file»).

---

## 2. Клиентская часть — фактический стек

| Слой | Что | Замер / файл |
|---|---|---|
| Язык | **TypeScript ~5.9.3** (strict-типы, `noEmit` в CI-гейте) | `tools/lab/ui/package.json:22`, `tsconfig.json` |
| Framework | **Preact 10.27.2** + `preact-render-to-string 6.6.2` (SSG) | `package.json:15–18` |
| Сборщик | **esbuild 0.25.10** — две передачи в одном `build.mjs` (~90 строк) | `package.json:20`, `build.mjs:19–72` |
| Артефакт | `.build/render.mjs` (компилят рендерера, вне репо) + строка `clientJs`, которую Python инлайнит в каждый HTML | `build.mjs:52–74` |
| Клиентский код | `src/client.ts` — **425 строк, 6 функций**, инлайн `<script>` внутри `<html>` | `tools/lab/ui/src/client.ts` |
| Стили | `src/theme.ts` — **627 строк** (light/dark, tokens, phone-first), инлайн в head | `theme.ts` |
| Верификатор клиента | `smoke.sh` (~4 500 строк) утверждает, что клиентский JS не минифицирован и что asserty вокруг «stale-verdict» держатся | `tools/lab/smoke.sh` |
| Экраны | `src/screens/*.tsx` — 7 файлов, по одному на страницу | `ls tools/lab/ui/src/screens/` |

**Сколько клиентского кода реально ходит по сети:** 0. Всё инлайн внутри HTML (`page.tsx:1–82`,
блок `data-island` для JSON + блок `<script>` для JS + `<style>` для CSS).

**Сборка запускается**:
1. по хуку PostToolUse (`chronicler-debounce-hook.sh` → debounce-waiter → `chronicler.sh --quiet`),
2. по тику (`tools/lab/tick.sh` — если bundle старше 240 с),
3. в штатном шифт-гейте `bash tools/lab/gate.sh` (`smoke → hooks-verify → tsc --noEmit → chronicler`),
4. руками владельца.

Собранный HTML **никогда не редактируется**. `docs/lab/site/README.md` вслух ставит правило,
`tools/lab/ui/README.md` дублирует: «Never hand-edit it. The next pass overwrites it, and in
the meantime a hand-edit is a lie with a generated_at stamp on it.»

---

## 3. Данные — источники правды, писатели, гарантии

### 3.1. Файлы = источник правды (C8)

| Файл / директория | Тип | Роль | Кто пишет |
|---|---|---|---|
| `docs/lab/events/YYYY-MM-DD.jsonl` | append-only JSONL | T1 «сырые» события (hook:*, emit, poll-fill) | **`tools/lab/lab-log.sh`** — единственный писатель |
| `docs/lab/questions/queue.jsonl` | append-only + patch-записи | вопросы, ответы, resolve-патчи | **`tools/lab/lab-emit.sh`** (единственный) |
| `docs/lab/decisions/log.jsonl` | append-only | зафиксированные решения | `lab-emit.sh decision` |
| `docs/lab/supervision/heartbeat.jsonl` | append-only, самоусекающийся до 200 строк | пульс оркестратора | **`tools/lab/heartbeat.sh`** (единственный) |
| `docs/lab/supervision/tick-ledger.jsonl` | append-only | леджер тика (carrier=manual/launchd/desktop/post-tool-use-hook) | `tools/lab/tick.sh`, `chronicler-debounce.sh` |
| `docs/lab/supervision/watchdog-ledger.jsonl` | append-only | наблюдательный/вооружённый след watchdog | `tools/watchdog/watchdog.sh` |
| `docs/lab/render_bundle.json` | whole-file | контракт данные↔представление, `render/7` | хроникёр (через `lab-write.sh`) |
| `docs/lab/status.json` | whole-file | машинный вид, `status/1` | хроникёр |
| `docs/lab/site/*.html` | whole-file | семь страниц | хроникёр (по одному lab-write на файл) |
| `docs/lab/digest/*.md` | whole-file | утренний дайджест | хроникёр |
| `docs/lab/mobile/README.md` | whole-file | проекция bundle в Markdown | хроникёр |
| `docs/handoff/ORCHESTRATION-STATE.md` | rewrite | «авторитет живой» + Standing rules | оркестратор руками (C8 says: "live git + STATE win on conflict") |

Все семантические события (`question.posed`, `answered`, `deduped`, `decision.made`,
`verify.verdict`, `handoff.written` …) уже перечислены в **`lab-emit.sh:80–96`
`SEMANTIC_TYPES`** — новые типы валидируются, «typo = событие, которое никто не прочитает,
поэтому это ошибка, а не новый тип».

### 3.2. Гарантии атомарности и блокировок

| Дисциплина | Механизм | Где |
|---|---|---|
| **Append-JSONL** | одна `write()` под `O_APPEND` = атомарный append на любом POSIX | `lab-log.sh:253–255` |
| **Read-then-append (seq allocation)** | mkdir-based `DirLock` (10-мс поллинг, steal >30 с) — портируется на macOS bash 3.2 без `flock` | `lab-log.sh:100–126`, `lab-emit.sh:136–160` |
| **Whole-file** | same-dir hidden temp → write → flush → **fsync** → `os.replace()` (POSIX-атомарный `rename(2)` в одной ФС) | `lab-write.sh:33–83` |
| **Sweep hidden temp** | при следующем прогоне temps старше 60 с удаляются — kill-9 не оставит мусор | `lab-write.sh:56–68` |
| **JSON-safe write** | флаг `--json` — `lab-write.sh` парсит содержимое до записи и отказывается публиковать битый JSON («corrupt хуже, чем stale») | `lab-write.sh:45–51` |
| **Debounce lock** | второй PostToolUse не запускает второй ребилд — waiter держит `mkdir` lock, heartbeat-touch раз в цикл; corpse >MAX_WAIT+QUIET+120 крадётся | `chronicler-debounce.sh:137–154` |
| **Tick lock** | «один тик за раз» — mkdir-lock, вторая попытка → `result="skipped-lock-held"` ledger-line + exit 0 | `tick.sh:34–41` (комментарий) |
| **Fail-open** | Все хуки → shim `lab-log-hook.sh` (4 строки) → всегда `exit 0`; выход 2 хука в Claude Code блокирует tool call (жестокий урок 2026-07-12) | `tools/hooks/lab-log-hook.sh:1–20` |
| **Cap-guarded** | 50 000 строк/день — маркер `lab.capped` + drop-count в `scratch/`, «врущий лог хуже отсутствующего» | `lab-log.sh:42–45` |
| **Cross-day supersedes** | `--supersedes 2026-07-12:42` — потому что `seq` уникален только внутри файла суток | `lab-log.sh:175–189` |

### 3.3. Что означает «атомарно» на практике

- Читатель **всегда** видит либо весь старый файл, либо весь новый — никогда префикс.
- Между двумя строками одного JSONL-файла нельзя увидеть «половину строки».
- `render_bundle.json` — критичный файл для будущего интерактивного слоя. Если сервер
  админки поднимется как читатель этого файла, он должен использовать `os.stat().st_ino`
  или `os.stat().st_mtime` как invalidation-ключ; **`inotify`/`FSEvents` на replace()
  выдают событие RENAME**, не MODIFY.

---

## 4. Уже готовые «действия» — что можно дёргать из веба без изобретения

| Инструмент | Подкоманды / вход | Что делает | Уместность как «действие из UI» |
|---|---|---|---|
| **`tools/lab/lab-emit.sh`** | `question`, `answer --re q-ID`, `resolve --re q-ID --applied "…"`, `apply-due`, `decision`, `event`, `list`, `candidates`, `help` | пишет вопрос/ответ/резолв/решение/семантическое событие; дедуп по (task, question-hash); зеркалит в timeline через `lab-log.sh` | ★★★★★ — вся ветка «ответить/зафиксировать/применить дефолт» уже есть, атомарна, идёт под локом |
| **`tools/lab/lab-log.sh`** (direct mode) | `--type <SEMANTIC_TYPES> --actor A --data k=v [--src emit] [--task KEY]` | один семантический эмит | ★★★★ — «отметил FYI прочитанным», «руководитель нажал ACK» |
| **`tools/lab/heartbeat.sh`** | `--cycle N --context-pct N --open-workers N …` | пишет одну строку в heartbeat.jsonl, самоусекается до 200 строк | ★ — не действие владельца, а самоотчёт оркестратора |
| **`tools/lab/tick.sh`** | без аргументов; `--force`; `--carrier launchd/desktop/manual`; `--repo PATH`; `--quiet` | poll-fill → apply-due → chronicler (если stale) → armed-check → watchdog observe → одна ledger-строка; idempotent, лок «один тик за раз» | ★★★★ — «Force refresh dashboard» кнопка |
| **`tools/lab/gate.sh`** | `--offline`, `--fast` | штатный шифт-гейт: smoke → hooks-verify → tsc → chronicler; квитанция `.artifacts/lab/gates/gate.json` | ★★ — «Проверить перед коммитом»; тяжёлый (десятки секунд), не нужен онлайн-UI |
| **`tools/lab/chronicler.sh`** | `--date`, `--narrate`, `--no-poll`, `--dry-run`, `--json`, `--quiet` | «Пересобрать всё» | ★★★ — «Manual rebuild» кнопка (обычно не нужна, но окно управления полезно) |
| **`tools/lab/chronicler-debounce.sh`** | принимает hook-payload через stdin | debounce-waiter, автоматически по PostToolUse | 0 — не UI-действие, инфраструктура |
| **`tools/lab/hooks-verify.sh`** | без/`--offline` | проверяет реальный fire хука через `claude -p` real-run | 0 — админ-диагностика, не действие |
| **`tools/lab/breaker-check.sh`** | — | проверка circuit-breaker | 0 — читатель |
| **`tools/lab/armed-check.sh`** | — | «оркестратор вооружён супервизором?» | 0 — читатель |
| **`tools/watchdog/watchdog.sh`** | `WD_MODE=observe|arm` env | наблюдательный/вооружённый супервизор; наблюдательный уже штатно шагом tick.sh | 0 — уже вызывается тиком, дёргать вручную нет смысла |
| **`tools/lab/verifier-watch.sh`** | — | verifier stalled → семантическое событие | 0 — фоновый |
| **`tools/lab/poll-fill.py`** | как модуль внутри тика/хроникёра | reconcile git/gh/Jira → timeline (src=poll-fill) | 0 — не UI-действие |

**Инвентарь «будущих» админ-действий (в плане `skills-governance-plan.md`):**

- `tools/skills/publish.sh <name>` — **ещё не написан** (этап 3 плана), делает diff,
  бэкап в `docs/skills/backups/<name>-<дата>/`, точечный `rsync local→global` одного скилла,
  строку в `docs/skills/CHANGELOG.jsonl`. Проверка на владельца — внутри CLI (этап 6, layer 2).
- `docs/skills/CHANGELOG.jsonl` — **ещё не заведён** (этап 2). Формат: одна строка на правку,
  `{date, skill, jira, sha, lesson, status: draft|reviewed|published}`.

Ни один из существующих скриптов **не открывает сокет** и не слушает порт (перепроверено
`grep -rE 'http.server|createServer|app.listen|express|fastify|flask|uvicorn|websockets|socket.io' .`
в стартовом инвентаре — 0 совпадений в живых скриптах).

---

## 5. Жёсткие ограничения среды — с источниками

Каждый пункт с датой и файлом. Будущая архитектура не должна их нарушать.

### 5.1. Технические (физика доставки)

1. **`file://` не может делать сетевые запросы к соседним файлам** — CORS блокирует.
   → *`tools/lab/ui/README.md:22–24`*, `docs/lab/site/README.md` (правило в рамке
   «The client may only ever compute over data already inlined at build time. It must never
   make a network request of any kind.»). **Следствие:** любой интерактивный слой должен
   работать через `http://127.0.0.1:PORT`, а не через `file://`.
2. **GitHub Markdown-рендер не выполняет JavaScript и не рендерит HTML в приватном репо** —
   мобильная проекция обязана оставаться Markdown. → *cycle 66 записи в
   `docs/handoff/ORCHESTRATION-STATE.md:410` от 2026-07-20:* «`.md` рендерится **серверно**
   в приватном репо, препятствием было расширение файла, не приватность.» **Следствие:**
   интерактив в мобильном рендере невозможен; поднять флаг на телефоне через ссылку
   можно только на URL, доступный извне (что противоречит правилу «localhost-only»,
   см. §5.2).
3. **CI отсутствует**, все гейты — локальные (`bash tools/lab/gate.sh`; квитанция
   `.artifacts/lab/gates/gate.json`). → *Standing rule 2026-07-28 GSL-203,
   `ORCHESTRATION-STATE.md:172`.* **Следствие:** «сервер админки» не может полагаться на
   pre-merge CI; проверка на владельца — только в CLI и в guard.
4. **Приватный репозиторий**, всё что коммитится — приватно; клоны — в `.research-cache/`.
   → *`ORCHESTRATION-STATE.md:190*, `CLAUDE.md` (project) «GitHub … private».
5. **Машина владельца, а не сервер**, «засыпание машины» — реальная переменная. → PRD
   `docs/prd/PRD-gosleep-evolution.md` пункт «Non-goals» v2: «Server/SSE (Next.js) …
   отложено» (строка 514); тик и debounce построены так, чтобы **пережить сон** (см. фразы
   «bounded job», «no pane, no spawn slot», `chronicler.sh:20–25`).
6. **0 API ключей (C1).** → `chronicler.sh:66`, весь `docs/prd/PRD-gosleep-evolution.md`
   C1-требование в матрице трассируемости (строки 682–688).

### 5.2. Регламентные (Standing rules и IN FORCE решения владельца)

Извлечены из `docs/handoff/ORCHESTRATION-STATE.md` раздел «Standing rules / decisions»:

1. **`install.sh` целиком ЗАПРЕЩЁН агентам** — 2026-07-20 (owner, HARD),
   `ORCHESTRATION-STATE.md:187`. Guard `exit 1` в шапке — четвёртый слой защиты инварианта
   публикации, единственный уже включённый. **Следствие:** сервер админки НЕ должен уметь
   вызывать `install.sh`; кнопка «Опубликовать» дёргает будущий `tools/skills/publish.sh`
   (этап 3 плана), а не installer.
2. **`orchestrating-delivery-agents` — авторитетна ГЛОБАЛЬНАЯ копия** — 2026-07-20 (owner,
   IN FORCE), `ORCHESTRATION-STATE.md:186`. **Следствие:** UI не показывает и не позволяет
   «перезаписать глобальный» скилл (даже под кнопкой) без явного sign-off владельца.
3. **МОБИЛЬНАЯ ВЕРСИЯ И PUSH — НА ПАУЗЕ** — 2026-07-24 ~19:15Z (owner, IN FORCE),
   `ORCHESTRATION-STATE.md:162`. **Следствие:** ни SSE-стрима наружу через ntfy, ни push-события
   в Channels/Telegram, ни QR-пэйринга Remote Control не проектировать в v2 без явной
   команды.
4. **GSL-105/106 + tailscale/F6-S4 ЗАМОРОЖЕНЫ** — 2026-07-20 ~16:50 (owner, IN FORCE),
   `ORCHESTRATION-STATE.md:188`. **Следствие:** «Ответить с телефона через ntfy/Tailscale»
   не строится; путь ответа = сервер на localhost машины владельца.
5. **v2 веба не раскрываем без команды** — 2026-07-28 auto-resolved
   d-2026-07-28-004 (`docs/lab/decisions/log.jsonl:25`). Реверсируется командой
   «раскрываем v2 сейчас» — так и написано в опциях q-2026-07-24-006 (`queue.jsonl:49`).
6. **Дашборд — инструмент, английский хром допустим** — d-2026-07-28-006
   (`decisions/log.jsonl:27`). **Следствие:** сервер админки может оставаться англо-хромым;
   но всё, что адресовано владельцу лично (BLOCKER-баннер, «Waiting for you», формулировки
   ответов), — по-русски.
7. **PRODUCTION SKILLS правит ТОЛЬКО владелец** — 2026-08-03 (owner, IN FORCE),
   `ORCHESTRATION-STATE.md:173`. Ключевое: **план `skills-governance-plan.md` СОГЛАСОВАН**
   владельцем 2026-08-03 (d-2026-08-03-003, `decisions/log.jsonl:44` — «админка встраивается
   в существующий веб-интерфейс»). **Следствие:** архитектура v2 обязана быть встраиванием
   в существующий конвейер, а не переписыванием SPA.
8. **PR-конвенция**: 1 branch/Epic, 1 commit/Task, 1 PR/Epic, **regular merge**;
   `ORCHESTRATION-STATE.md:184`. **Следствие:** любые изменения в конвейер идут одним PR.
9. **Chronicler-инвариант «bundle grade != fresh не коммитить молча»** — GSL-194,
   `ORCHESTRATION-STATE.md:165`. **Следствие:** сервер админки, если он в момент старта
   пересобирает страницы, обязан сам печатать grade и не «замалчивать» stale.
10. **NO Workflow tool, fleet cap 3, PULSE 5–10 мин** — `ORCHESTRATION-STATE.md:177,179`.
    Ортогонально UI, но действие «спавнить агента» из веба нарушило бы «no mass-spawn»
    и «Ask before any Workflow». В будущем UI такое действие не заводить.
11. **Standing autonomy 2026-07-20 ~19:26Z: BLOCKER паркуется, всё остальное решается
    самим** — `ORCHESTRATION-STATE.md:159`. **Следствие:** пользователь-читатель веба
    не должен видеть кнопок для DECISION/CLARIFY/FYI типов, кроме «ответить на open»;
    BLOCKER — единственный класс, требующий ручного разрыва.
12. **Скрипты пишут через `lab-log.sh` / `lab-emit.sh` / `lab-write.sh` — единственные
    писатели** — `chronicler.py:41–48`, `lab-write.sh:6–15`. **Следствие:** любой новый
    писатель — новая поверхность для гонки; правильный путь — сервер вызывает
    существующий CLI.

### 5.3. PRD, что уже заявлено про v2

`docs/prd/PRD-gosleep-evolution.md`:

- **Строка 514** (Ф5, In/Out): «Server/SSE (Next.js), replay-then-tail live-streaming,
  state-aware composer — это v2 (05 §7 item 12).»
- **Строки 689–692** (явные отложенности): «v2 interactive dashboard (SSE/Next.js, autosk
  state-aware composer, replay-then-tail) — **отложено** до проверки JSONL-слоя;
  контракт данных Ф4 спроектирован так, что v2 — **чистая замена потребителя**
  (05 §7 item 12). **Не сирота — сознательный defer.**»
- Раздел «Фаза 6» (`PRD:577–645`): remote-control/ntfy/Telegram/Tailscale — четыре
  контура доставки. Тройка «ntfy + Telegram + Tailscale» **заморожена**; официальный
  Remote Control (`R6.1`) — тоже (мобильная пауза 2026-07-24).

`docs/plans/skills-governance-plan.md` (2026-08-03):

- **Раздел 5** — «Админка — раздел «Скиллы» в веб-лаборатории»: статус, история, diff,
  единственная кнопка «Опубликовать». «Техническое следствие (честно и явно):» —
  локальный сервер требуется, статические страницы такое не умеют.
- **Раздел 7, этап 4** — «**Локальный сервер админки + кнопка публикации**» — процесс на
  localhost, отдаёт страницу «Скиллы», обрабатывает клик, вызывает `publish.sh` из
  этапа 3.
- **Этап 5** — «Пока сервер не запущен, страница генерируется хроникёром в статическом
  виде и показывает точную команду для копирования вместо активной кнопки.» — это
  ключевой инвариант: **страница обязана работать без сервера**.

---

## 6. Точки встраивания — куда именно v2 может подключиться

Все варианты не ломают текущий конвейер, потому что читают тот же контракт `render/7`
и/или дёргают уже существующие CLI.

### 6.1. Точка A. «Читатель того же bundle» (самый дешёвый; рекомендую)

Локальный процесс на `127.0.0.1:PORT` (Python `http.server` + один обработчик POST) читает
`docs/lab/render_bundle.json` при запросе, отдаёт те же семь HTML (или, что дешевле,
проксирует их с диска) и **имеет один POST-эндпойнт**, который вызывает уже существующий
CLI. Пример: `POST /skills/publish?name=<n>` → `bash tools/skills/publish.sh <n>` → редирект
обратно. При каждом запросе:

- **читать bundle** ⇒ обычный `open(…, "rb").read()` (атомарная замена ⇒ читатель никогда
  не увидит префикс; см. §3.2);
- **читать statuses** ⇒ те же файлы, что смотрит любой другой читатель;
- **писать** ⇒ **ТОЛЬКО** вызовом `lab-emit.sh` / `publish.sh` (никакого прямого
  `open(…, "a")` — иначе гонка с хроникёром и хуками, см. §7).

Плюсы: 100–200 строк Python-стдлиба; не добавляет новых зависимостей; не ломает бинарный
контракт схемы; кнопка отсутствует в static-view — страница честно показывает команду
для копирования (этап 5 плана).

### 6.2. Точка B. «Подписчик на файлы» (для будущего live-tail)

Тот же сервер добавляет обработчик `GET /events` (Server-Sent Events, одна строка на
событие), а внутри — **`kqueue`/`FSEvents` (BSD/macOS)** или `select()` над файлом
`docs/lab/events/<today>.jsonl` + `os.stat().st_size`-cursor. Это «v2» из PRD (`R5.3`
non-goal / отложенность 690). Реализация — рабочая, но:

- **Только при работе с localhost.** В `file://` не подключить.
- **Не нарушать GSL-194**: если хроникёр в этот момент делает whole-file replace bundle,
  SSE-приёмник должен обработать RENAME/INODE-смену, а не MODIFY. Точный пример:
  `render_bundle.json` меняет inode при каждом ребилде — открытый файловый дескриптор
  указывает на ПРЕДЫДУЩИЙ. Правильная стратегия — стрим по `events/*.jsonl` (append-only
  внутри inode), для bundle — poll по mtime.

### 6.3. Точка C. «Отдельный порт для read-only mobile»

`http://127.0.0.1:PORT` на машине владельца через **уже существующий Tailscale-путь**
(ЗАМОРОЖЕН, `ORCHESTRATION-STATE.md:188` — не проектируем без явной команды).

**Не рекомендую:** нарушает пункт 5.2.4 (заморозка) и пункт 5.2.3 (мобильная пауза).

### 6.4. Что общего у всех трёх точек

- **Ничего не пишет в `docs/lab/` напрямую.** Единственный путь записи — существующий
  CLI (`lab-emit.sh`, будущий `publish.sh`), которые уже под локом и уже атомарны.
- **Клиент bundle остаётся тем же** — сервер обслуживает те же семь HTML; страница
  живёт из `file://` в фаллбэке; статическая копия — единственная истина в отсутствие
  сервера.
- **Порт биндится только на `127.0.0.1`**, не на `0.0.0.0`. Никакая другая машина в сети
  до сервера не дотягивается. Обязательно.
- **Проверка на владельца — в CLI, не в UI.** Это критично: агент, случайно попавший
  на страницу и «нажавший» кнопку, всё равно ничего не публикует, потому что CLI
  откажется от не-владельца (этап 6 плана, layer 2).

---

## 7. Риски и как их закрыть

### 7.1. Гонка с хроникёром и debounce-хуком

**Что ломается:** сервер начинает читать `render_bundle.json` в момент, когда хроникёр
делает `os.replace()`. На macOS/APFS это атомарно — читатель либо увидит прежний inode
(если открыл до replace), либо новый (если открыл после). Проблема появится, если сервер
читает **по кусочкам** и держит FD между операциями: FD прибит к inode, а inode после
replace относится к «удалённой» версии, которую ФС держит открытой, пока есть ссылка.
Читатель увидит **stale**-версию до closo/reopen.

**Смягчение:**
- всегда `open() → read() → close()` в одном обработчике HTTP;
- инвалидация кэша по `os.stat().st_ino` (не по mtime — mtime не меняется при same-second
  replace);
- поддерживать «мягкий stale» — если `render_bundle.staleness.grade != "fresh"`, страница
  печатает баннер (это уже делает хроникёр; сервер не должен «врать вслед»).

Дополнительно: **debounce работает как «trailing edge»** — между окончанием rebuild
и снятием lock есть окно ms, в котором новая запись «уйдёт в никуда» (`chronicler-debounce.sh:31–35`).
Тик добирает промашки, но UI-сервер должен помнить: свежесть — не немедленная, а
«tail-latency = QUIET + build_time = 90 с + ~5 с = ~95 с».

### 7.2. Порча JSONL

**Что ломается:** сервер решает «удобно» переписать `queue.jsonl` (например, для
«очистки закрытых»). Это **немедленный C8-грех**: append-only + patch-записи — вся
семантика фолда завязана на неизменности истории. Хроникёр отфолдит битые данные, а
timeline потеряет прошлое.

**Смягчение:**
- **абсолютный запрет** прямых записей в `docs/lab/events/`, `questions/`, `decisions/`,
  `supervision/`;
- сервер **вызывает только** `lab-emit.sh` / `lab-log.sh` / (будущий) `publish.sh`;
- дедуп даётся бесплатно: `lab-emit question` дедупит по (task, question-hash);
- поверх этого — код-ревью с грепом:
  `grep -RnE "open\(.*(queue|log)\.jsonl.*(w|a)" tools/lab-server/` должен возвращать
  нулевые совпадения.

### 7.3. Конфликт с git (grade=fresh инвариант)

**Что ломается:** сервер положил в repo производный HTML/bundle в момент, когда
хроникёр ещё не отработал ⇒ коммит несёт stale-версию. Standing rule GSL-194 запрещает
это молча (`ORCHESTRATION-STATE.md:165`).

**Смягчение:**
- **сервер ничего не коммитит**;
- если действие требует пересборки (напр., publish изменил файл, за который хроникёр
  считает какой-нибудь counter), сервер вызывает `tools/lab/chronicler.sh --quiet`
  синхронно в ответ на POST — пользователь видит редирект только после fresh;
- альтернатива — не пересобирать вовсе (кнопки не меняют bundle-данные, они меняют
  файлы вне `docs/lab/`).

### 7.4. Безопасность локального порта

**Что ломается:** порт слушает на `0.0.0.0`, любая машина в Wi-Fi может дёргать
«Опубликовать». Или порт слушает на `127.0.0.1`, но агент в этом же процессе видит и
дёргает. Или порт остаётся живым после ухода владельца.

**Смягчение:**
- бинд **только** `127.0.0.1`, `SO_REUSEADDR=0`, `AF_INET` (не `::`);
- CLI-проверка на владельца — второй слой (этап 6, layer 2);
- launchd-агент с `RunAtLoad=false` / owner-only trigger — процесс живёт только пока
  владелец залогинен;
- CSRF-токен из cookie/`X-CSRF`; на loopback можно жёстче — принимать POST только с
  `Referer: http://127.0.0.1:PORT/…`; браузер запретит нативно.

### 7.5. Схема-drift (render/7 → render/8)

**Что ломается:** сервер декодит bundle в свои типы; при bump в render/8 старый сервер
падает.

**Смягчение:**
- сервер **не декодит** bundle в структуры вообще (насколько возможно); использует его
  как «непрозрачный dict» и обращается к отдельным полям через `.get()` с умолчаниями;
- если структурная работа нужна — мирроринг `tools/lab/ui/src/types.ts` в
  `tools/lab-server/types.py` рядом, ревью — с обеих сторон в одном PR (это же правило
  применяется к render/8 today: bump = синхронный правкой в 4 местах, см. cycle=55 в
  STATE `line 75`).

### 7.6. Hook-фильтрация «мимо интерактива»

**Что ломается:** сервер шлёт HTTP-запрос сам себе → debounce-хук не срабатывает
(сервер — не Bash/Edit tool call). Значит **изменения, которые сделал сервер, не
триггерят ребилд**. Владелец видит устаревший бандл.

**Смягчение:**
- сервер сам вызывает `chronicler.sh --quiet` синхронно **после** любого write-action;
- альтернатива: пишет в `docs/lab/events/YYYY-MM-DD.jsonl` через `lab-log.sh` — тогда
  next-tick добьёт (5 мин), но это дольше, чем ожидание владельца после клика.

### 7.7. Мультиписатель того же файла

**Что ломается:** одновременно в очередь пишут (а) сервер (обрабатывая клик), (б)
хук/агент через `lab-emit.sh`. `DirLock` защищает append, но `heartbeat.sh` использует
собственный локер (temp+rename), `tick.sh` — mkdir-lock отдельного namespace. Пересечения
контролируются лишь потому, что каждый писатель знает свою поверхность.

**Смягчение:**
- сервер не заводит собственных lock-файлов;
- любой write делегируется CLI, у которого свой lock;
- сервер сам себя ограничивает concurrency = 1 на write-эндпойнт (thread-lock в процессе).

---

## Приложение А. Точные пути и строки, на которые я ссылаюсь

| Что | Файл : строка / дата |
|---|---|
| Контракт render bundle | `docs/lab/render_bundle.json:2` (schema), `tools/lab/chronicler.py:2624–2685` (build), `tools/lab/ui/src/types.ts:1–200+` (mirror) |
| Контракт status.json | `tools/lab/chronicler.py:1406` |
| Четыре инварианта UI | `tools/lab/ui/README.md:19–43` |
| Rebuild-хук | `.claude/settings.json:98–121` |
| Debounce | `tools/lab/chronicler-debounce.sh:1–154` |
| Тик | `tools/lab/tick.sh:1–80+` |
| Атомарная запись файла | `tools/lab/lab-write.sh:33–83` |
| Атомарный append + DirLock | `tools/lab/lab-log.sh:100–126, 253–255` |
| Дедуп вопросов | `tools/lab/lab-emit.sh:44–52` |
| Fail-open shim | `tools/hooks/lab-log-hook.sh:1–20` |
| SEMANTIC_TYPES | `tools/lab/lab-emit.sh:80–96` |
| GSL-194 «не коммитить stale bundle» | `docs/handoff/ORCHESTRATION-STATE.md:165` |
| Заморозка мобильного/push | `docs/handoff/ORCHESTRATION-STATE.md:162` (2026-07-24 owner IN FORCE) |
| Заморозка GSL-105/106/tailscale | `docs/handoff/ORCHESTRATION-STATE.md:188` (2026-07-20 owner IN FORCE) |
| Install.sh guard | `docs/handoff/ORCHESTRATION-STATE.md:187` (2026-07-20 owner HARD) |
| Production skills правит только владелец | `docs/handoff/ORCHESTRATION-STATE.md:173` (2026-08-03) |
| Skills-plan согласован владельцем | `docs/lab/decisions/log.jsonl:44` (d-2026-08-03-003) |
| v2 не раскрываем (default-applied) | `docs/lab/decisions/log.jsonl:25` (d-2026-07-28-004) |
| Дашборд = инструмент, англ. хром | `docs/lab/decisions/log.jsonl:27` (d-2026-07-28-006) |
| PRD Ф5 In/Out v2 | `docs/prd/PRD-gosleep-evolution.md:505–560, 689–692` |
| План этап 4 — локальный сервер | `docs/plans/skills-governance-plan.md:117–121` |
| План этап 5 — «пока сервер не запущен» | `docs/plans/skills-governance-plan.md:122–124` |
| Открытая развилка «v2 сейчас» | `docs/lab/questions/queue.jsonl:49` (q-2026-07-24-006) |
