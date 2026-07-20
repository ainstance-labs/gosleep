# Handoff — gosleep — 2026-07-20 (цикл 64, gsl102-setup: Фаза 6 Mobile развёрнута, ledger закрыт)

> Для оркестратора и первого impl-воркера Фазы 6. Читай Part 1 → Part 2 → ⭐ RESUME.
> Ground truth = `ORCHESTRATION-STATE.md` (первым) + этот файл + handoff 38 (roll) + handoff 35 (20 правил и 6 уроков — все в силе).
> Я — setup-воркер цикла 64. Кода фазы не писал: только Jira/GH/ветка/ledger/handoff.

# ── Part 1 · Простыми словами ──

## 1. Что сделано

**Фаза 6 «Mobile» развёрнута и готова к реализации.** Создан эпик **GSL-102** (In Progress) с
**8 задачами** GSL-103…GSL-110, каждая зазеркалена в GitHub (#116 эпик, #117…#124 задачи), каждая
назначена на владельца. Ветка **`GSL-102-mobile`** отведена от main @ `c4dafed` (тот самый merge
PR #115, которым закрылась Фаза 5) и запушена. Ledger-коммит **`40497bd`** зафиксировал 17
owner-sovereign файлов закрытия Фазы 5 — as-is, ничего в них не правил.

Очередь вопросов чиста: **open=0**. Висевший DECISION `q-2026-07-20-002` (владелец назвал UI
«AI-слопом») закрыт по дефолту — из него родилась задача **GSL-109**, и решение записано в журнал
как `d-2026-07-20-005`.

## 2. Что я проверил руками, прежде чем поверить PRD

PRD писался 2026-07-08 — двенадцать дней назад. Проверил всё, на что он опирается в Фазе 6:

- **Remote Control реально доступен.** CLI на машине — **2.1.215**, порог из исследования 2.1.181.
  НО: PRD называет команду `claude remote-control` / `--rc` / `/rc`, а фактический флаг в
  `claude --help` — **`--remote-control [name]`** (+ `--remote-control-session-name-prefix`). Это
  вписано в описания эпика и GSL-104: реализация опирается на `claude --help`, не на цитату PRD.
- **Хуки для ntfy уже стоят.** `Notification`, `StopFailure`, `SubagentStop` сконфигурированы в
  `.claude/settings.json` ещё с Фазы 4. GSL-105 — это **расширение** существующих обработчиков, а не
  стройка с нуля. Написал это в задаче явно, чтобы воркер не начал переизобретать hook-слой и не
  сломал живой event-поток.
- **`.env.local` отсутствует** → `ATLASSIAN_API_TOKEN` нет → обратные ссылки Jira↔GH сделаны
  комментариями, а не remote-link REST. Это же ограничение ждёт GSL-105 (секрет ntfy-топика хранить
  негде — воркеру придётся завести `.env.local` самому).
- **Исследование сверено:** `docs/research/2026-07-07-orchestration/05-lab-ui-mobile-autonomy.md` §6
  подтверждает состав Фазы 6 дословно (RC / ntfy / Telegram / Tailscale). Hands-on тестирования RC
  не было ни у кого — в задаче это названо честно.

## 3. Где я отклонился от PRD (и почему)

PRD § Фаза 6 перечисляет 5 задач. Я создал 8. Три добавления, ни одного сокращения:

1. **GSL-103 ledger-коммит** — не работа фазы, а гигиена: owner-sovereign файлы Фазы 5 висели
   незакоммиченными. Прецеденты GSL-82 (Фаза 4) и GSL-91 (Фаза 5). Уже сделан и закрыт.
2. **GSL-108 phone-readable дашборд** — закрывает **опровергнутый F5-S4c**. Приёмка Фазы 5 честно
   записала: приватный GitHub отдаёт `text/plain` + `nosniff`, Pages на приватном репо → 404, то
   есть **HTML с телефона не читается**, и позитивный контроль на `README.md` показал, что это
   универсальное поведение, а не дефект нашей страницы. Значит **SC-F не выполнен**. Фаза 5 закрыта
   и смёржена — дыру некуда девать, кроме Фазы 6, а Фаза 6 ровно про мобильную досягаемость.
3. **GSL-109 дизайн-проход** — по DECISION `q-2026-07-20-002`, как и предписано брифом.

## 4. Что дальше

Первый impl-воркер берёт **GSL-104** (Remote Control) — это R6.1, от него зависит ценностная
цепочка «пуш → ответ → буфер», и его же PRD ставит первым. GSL-106 (Telegram) по PRD ставится
**после** R6.1+R6.2 — не запускать раньше. GSL-109 (дизайн) независим и может идти параллельно.

## 5. Проблемы

Блокеров нет. Наследуемые долги (не мои, для владельца) — в handoff 38 §4: GSL-30 без dev_history;
ledger-naming gap; `task.completed` не стреляет с 07-13; ночные дефолты по таймеру никто не
применяет; token ceiling не машиночитаем.

---

# ── ORCHESTRATOR REPORT ──

| | |
|---|---|
| **Эпик** | **GSL-102** «[Tooling][Docs] Фаза 6 — Mobile (Remote Control + hook→ntfy + answer-path + break-glass)» → Jira **In Progress**, GH **#116** (label `epic`) |
| **Задачи** | **GSL-103…GSL-110** (8) = GH **#117…#124** (label `task`); привязка `parent = GSL-102` проверена JQL, `hasNextPage=false` → ровно 8; assignee = owner на всех |
| **Статусы Jira** | GSL-103 **Done** (ledger сделан); GSL-104…GSL-110 **To Do** (7) |
| **Ветка** | `GSL-102-mobile` от main @ `c4dafed`, запушена, remote = `40497bd` |
| **Ledger-коммит** | **`40497bd`** — 17 файлов, as-is, пофайлово; `docs/prompts/` НЕ включён (проверено grep'ом перед коммитом) |
| **Handoff 39** | этот файл, отдельным коммитом |
| **Очередь** | open=0 (0B/0D/0C/0F), lines=18; `q-2026-07-20-002` resolved → `d-2026-07-20-005` |
| **Отклонения от PRD** | +3 задачи (ledger / phone-readable F5-S4c / дизайн-проход), 0 сокращений — обоснования в Part 1 §3 и в описании эпика |

---

# ── Part 2 · Формально ──

## Состав Фазы 6

| Задача | GH | Требование | Критерий |
|---|---|---|---|
| GSL-103 `[Docs]` Ledger: Phase 5 close + orchestration state | #117 | — (гигиена) | **Done** |
| GSL-104 `[Skill][Docs]` Remote Control обёртка + runbook пэйринга | #118 | R6.1 | F6-S1 |
| GSL-105 `[Tooling]` hook→ntfy fleet/lab push + ACL/self-host | #119 | R6.2 | F6-S3 |
| GSL-106 `[Tooling]` Telegram answer-path → queue.jsonl | #120 | R6.3 | F6-S2 |
| GSL-107 `[Docs]` Tailscale + Blink/mosh break-glass runbook | #121 | R6.4 | F6-S4 |
| GSL-108 `[Tooling][Docs]` Phone-readable дашборд (F5-S4c) | #122 | добавлено | SC-F |
| GSL-109 `[UI][Design]` Дизайн-проход 7 экранов Laboratory | #123 | q-2026-07-20-002 | — |
| GSL-110 `[Docs]` dev_history Фазы 6 + приёмка F6-S1..S4 | #124 | PRD задача 5 | F6-S1..S4 |

**Порядок реализации:** GSL-104 → GSL-105 → GSL-106 (PRD: «оценить после 1+2»). GSL-107 / GSL-108 /
GSL-109 независимы. GSL-110 — последней.

## Connections

| | |
|---|---|
| Jira | project **GSL**, cloudId `74054cdc-47ef-497d-9684-734149876a8b`, транзиции 11/21/31/**41=Done** |
| GitHub | `ainstance-labs/gosleep` (private) |
| main | @ `c4dafed` (Фаза 5 = PR #115, merged) |
| Ветка Фазы 6 | `GSL-102-mobile` @ `40497bd` |
| PR Фазы 6 | **ещё не открыт** — открывается, когда все задачи закоммичены |
| Owner | Roman L, accountId `557058:83b04839-8bde-4331-9c2d-24843d0b8e67` |
| PRD | `docs/prd/PRD-gosleep-evolution.md` § «Фаза 6» — **последняя фаза PRD** |

## Gates (CI нет — руками)

`bash tools/lab/smoke.sh` → **264/264** (флейк :234 pre-existing, не чинить) ·
`bash tools/lab/hooks-verify.sh` → 14/14 · `(cd tools/lab/ui && npx tsc --noEmit)` → 0 ·
`bash tools/lab/chronicler.sh --no-poll` → 7 страниц. Схема `gosleep.lab.render/7`.
Gates Фазы 6 сверх этого: ntfy-hook — валидный async command; RC-обёртка задокументирована.

## ⚠️ Железные правила

Все 20 правил handoff 35 § Part 2 в силе без ослаблений. Ключевое для Фазы 6:
⛔ tree-wide git ops (`reset --hard` / `stash` / `checkout -- .` / `clean`) · ⛔ force-push ·
⛔ `--amend` после push (до push — легально) · ⛔ Workflow tool · ⛔ `git add -A` ·
fleet cap 3 · kill-pane только по явному id · NO Story (Epic+Task only) · REGULAR merge, не squash ·
`docs/lab/site/*.html` DERIVED — править рендерер · коммит через `git commit -F` ·
дирти дерево после ledger'а — норма (оркестратор пишет heartbeat/events параллельно).

**Owner directive 2026-07-20 (IN FORCE):** `orchestrating-delivery-agents` — использовать ТОЛЬКО
глобальный скилл (`~/.claude/skills/`), НЕ локальную копию `skill/` этого репо. `./install.sh` для
ЭТОГО скилла не гонять.

## 6 уроков воркеров (вшивать в каждый impl-бриф)

1. Jira description читать **первым тулом**. 2. Грепать прежде чем верить description.
3. «Нет источника» — проверяй руками. 4. ⛔ tree-wide git ops. 5. ⛔ background restore-trap.
6. Прочитай прозу вслух + поставь позитивный контроль.

## Gotchas

Все из handoff 35 и 38 в силе. Новое от меня: **`.env.local` в репо нет** — GSL-105 (секрет
ntfy-топика) и любые токены упрутся в это первыми; создавать git-ignored, никогда не коммитить и не
echo'ить. Нумерация GH общая с PR — доверять ссылкам в телах issue, не номерам.

## ⭐ RESUME POINT — первый impl-воркер Фазы 6

```bash
# Orient
cat docs/handoff/ORCHESTRATION-STATE.md | head -30
cat docs/handoff/39-2026-07-20-handoff-gsl102-setup.md   # этот файл
git branch --show-current                 # GSL-102-mobile
git log --oneline -1                      # 40497bd (ledger)
tools/lab/lab-emit.sh list --count        # open=0

# Задача GSL-104 — описание ПЕРВЫМ тулом, не по памяти
# (mcp__atlassian__getJiraIssue GSL-104), затем:
claude --help | grep -i remote-control    # фактическая поверхность, НЕ цитата PRD
```

**Первая задача — GSL-104 `[Skill][Docs]` Remote Control обёртка + runbook пэйринга (R6.1 → F6-S1).**

1. Прочитать описание GSL-104 в Jira первым тулом; затем `docs/research/2026-07-07-orchestration/05-lab-ui-mobile-autonomy.md` §6 (строки ~428–446).
2. **Сверить поверхность руками:** `claude --help`, официальные доки. На CLI 2.1.215 флаг —
   `--remote-control [name]`, а НЕ `--rc`. PRD здесь устарел — писать по факту.
3. Тонкая **swappable** скилл-обёртка (research-preview может поменяться) + runbook пэйринга
   оркестраторской сессии + оба push-тоггла.
4. Честно задокументировать ограничения: локальный процесс должен жить; ~10 мин offline убивают
   сессию; RC зеркалит ОДНУ сессию (fleet-level — это GSL-105).
5. Проверить, ведёт ли себя **Agent-Teams LEAD-сессия** нормально под RC — hands-on этого не делал
   никто. Результат записать **по факту**, не подгоняя под критерий.
6. Один коммит `GSL-104 …`, dev_history по конвенции, Jira → Done, отчёт + telemetry line.

## Blocked on human

**Нет.** Очередь open=0.
