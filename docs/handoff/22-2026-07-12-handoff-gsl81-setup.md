# Handoff — gosleep — 2026-07-12 (эпик GSL-81 «Laboratory» открыт, леджер закоммичен, ветка запушена)

> Для СВЕЖЕГО агента. Читай Part 1 (простыми словами) → `## ORCHESTRATOR REPORT` → Part 2 → «⭐ RESUME».
> Ground truth = `ORCHESTRATION-STATE.md` (первым) + этот файл. Дополняет handoff'ы 19/20/21 (Фаза 3 закрыта,
> они теперь в истории git), не отменяет их железные правила.

# ── Part 1 · Простыми словами ──

## 1. Где мы

Фаза 3 закрыта и смёржена (PR #92, `main @ 4af66d2`). Начата **Фаза 4 «Laboratory» — авто-документация**:
цель в том, чтобы ночь фиксировала себя сама. Сейчас за ночь работы остаются handoff'ы и коммиты, которые
пишет модель; после Фазы 4 останется ещё и машинный след — события, которые пишутся **хуками, вообще без
участия и токенов модели**, и статический дашборд, который перегенерируется скриптом.

Этот цикл — **только леса**: заведён эпик, разбиты задачи, создана ветка, закоммичен накопившийся леджер.
Кода Фазы 4 ещё нет ни строки.

## 2. Что уже сделано

Эпик **GSL-81** и восемь задач (**GSL-82..GSL-89**) заведены в Jira и зазеркалены в GitHub Issues
(**#93** эпик, **#94..#101** задачи), у всех проставлен владелец и перекрёстные ссылки в обе стороны.
Список задач взят **дословно из PRD** — семь задач раздела «Фаза 4», плюс леджер-коммит первым.

Ветка эпика `GSL-81-laboratory-auto-doc` нарезана от свежего `origin/main` и запушена. В неё лёг первый
коммит — **леджер** (`9a056bb`): состояние оркестрации, три handoff'а хвоста Фазы 3, багрепорт про
«немые ходы», и главное — **Stop-hook уехал в репозиторий**. Теперь правило «ход заканчивается текстом
владельцу» держит не только текст скилла, но и код: хук механически не даёт закончить ход молча.

## 3. Что делаем дальше

Три яруса Фазы 4, в порядке PRD. **T1** — хуки Claude Code пишут события в `docs/lab/events/YYYY-MM-DD.jsonl`
(ноль токенов, вне модели). **T2** — существующие конвенции (handoff, dev_history) не трогаем вообще, кроме
одной строки. **T3** — «летописец» (chronicler): не живой агент в панели, а ограниченная бюджетом задача,
которая перегенерирует дашборд и дайджест из этих событий.

Следующий цикл — impl-воркер берёт **GSL-83** (хуки + `lab-log.sh`). Почему именно с него: это фундамент,
на данных которого стоит всё остальное — и chronicler, и poll-fill, и вся Фаза 5 (UI).

## 4. Какие есть проблемы

Одна, и она записана в самом PRD как риск: **хуки могут не срабатывать на этой машине так, как написано в
документации**. `TeammateIdle`, например, не проверял никто. Требование к impl-воркеру жёсткое: проверять
каждый хук **фактическим прогоном**, а не верой в документацию, и если хук молчит — **деградировать с
логом, а не молча**, и честно записать в dev_history, что не сработало. Событийный лог, который врёт,
хуже отсутствующего.

Блокеров, требующих владельца, нет. Очередь вопросов пуста (open=0).

## 5. Комментарии и свежие решения

- `docs/prompts/2-deep-orchestrating-research.md` так и **не закоммичен** — владелец не решил, коммитить ли
  его. Он лежит в дереве untracked, и это **штатно**: `git status` после леджер-коммита показывает ровно
  одну строку — этот файл. Никаким `git add -A` его не подхватывать (именно поэтому индексирование велось
  пофайлово).
- Chronicler **запрещено** делать четвёртым живым агентом в панели: панелей всего три, и он съел бы слот
  доставки. Только bounded-задача под `--max-budget-usd`.

---

## ORCHESTRATOR REPORT

```
CYCLE_ID: gsl81-setup #44
CYCLE_STATUS: COMPLETE
EPIC: GSL-81 (In Progress) / GH #93 — PRD Phase 4 «Laboratory (auto-doc)»
TASKS: GSL-82 (Done) · GSL-83..GSL-89 (To Do) / GH #94..#101
BRANCH: GSL-81-laboratory-auto-doc @ 9a056bb — запушена, upstream установлен
COMMITS: 1 (GSL-82 леджер — 11 файлов, docs/prompts исключён)
TREE: porcelain=1 (docs/prompts/2-*.md — owner-sovereign, не коммитить)
PR: не открыт (по конвенции откроет механик-цикл, когда лягут содержательные задачи)
NEXT: impl-цикл на GSL-83 (hooks + lab-log.sh), Opus 4.8
BLOCKED_ON_HUMAN: нет. Очередь вопросов: open=0
MODEL: claude-opus-4-8 (сверено по транскрипту, не по самоотчёту)
```

---

# ── Part 2 · Формально ──

## ⚠️ Железные правила (перенесены из handoff 21 — не ослаблять)

1. **Каждый turn заканчивается ТЕКСТОМ владельцу — после ВСЕХ tool calls, ноль tool calls после текста.**
   Любой tool result (включая ответ `ScheduleWakeup`, что бы он ни говорил) — НЕ разрешение закончить turn.
   Знание правила НЕ спасает: двух предшественников оно не спасло. Спасает привычка: последний акт = текст.
   Stop-hook (`.claude/settings.json` → `tools/hooks/stop-require-final-text.sh`, **теперь в репо**)
   подстрахует блокировкой, но правило соблюдай сам. Пульс/wake-up взводится В СЕРЕДИНЕ turn'а.
2. **Модели: ВСЕ агенты — Opus 4.8** (`model: opus`); оркестратор — Fable 5. Модель воркера сверяется
   **по его транскрипту**, self-report врёт (fixer назвался fable-5, будучи opus-4-8).
3. NO Workflow tool; максимум **3** воркер-панели (4-я падает: `fork failed`); kill-pane только по явному id;
   **no force-push**; **regular merge** (никогда squash); идемпотентность создания (сначала SEARCH, потом
   CREATE); телеметрия в STATE после каждого цикла; оркестратор не исполняет delivery сам; **воркеры не
   трогают леджер-файлы** (их коммитит setup-воркер эпика первым коммитом).
4. tmux: наше окно `1:0`; сессии 0/2/3/4 — ЧУЖИЕ проекты, их панели не трогать.
5. `docs/lab/decisions/manifest.md` — **owner-sovereign**: агенты читают и предлагают правки в дайджесте,
   но НИКОГДА не правят сами.

## Как мы работаем

Скиллы (поднимать до работы): `orchestrating-delivery-agents`, `delivery-workflow`, `using-jira`, `handoff`.
Конвенции: Epic+Task (без Story) · **одна ветка на эпик** (`<EPIC-KEY>-<slug>`) · **один коммит на задачу**
(сообщение начинается с ключа) · **один PR на эпик** (regular merge) · GitHub Issues зеркалят Jira ·
`[Tag]`-маркеры в заголовках · ассайни = владелец на каждой задаче · dev_history — файл на задачу
(`docs/dev_history/<TASK-KEY>-…md`, ключ первым, UPPERCASE) + строка в индексе.

## Connections

| Что | Значение |
|---|---|
| Jira | проект **GSL**, site `ainstance-labs.atlassian.net`, cloudId `74054cdc-47ef-497d-9684-734149876a8b` |
| Переходы Jira | To Do=11 · In Progress=21 · In Review=31 · **Done=41** |
| GitHub | `ainstance-labs/gosleep` (private) |
| Владелец | Roman L (rommxx@gmail.com), accountId `557058:83b04839-8bde-4331-9c2d-24843d0b8e67` |
| Ветка эпика | `GSL-81-laboratory-auto-doc` @ `9a056bb` (origin ↔ локально совпадают) |
| `main` | `4af66d2` (merge PR #92) |
| Следующие свободные | Jira **GSL-90** · GH **#102** |
| PRD | `docs/prd/PRD-gosleep-evolution.md`, раздел «Фаза 4 — Laboratory (авто-документация)» |
| Blueprint layout | `docs/research/2026-07-07-orchestration/05-lab-ui-mobile-autonomy.md` §3.2–3.3 |

## Gates (CI нет — руками, перед каждым коммитом)

- Правил `skill/` → **обязательно** `./install.sh` (sync local → global; `skill/` — источник правды).
- Правил `.claude/settings.json` → `jq . .claude/settings.json` (парсится) **и** Stop-hook продолжает работать.
- Писал jsonl → строки валидны (`jq -c . < docs/lab/events/*.jsonl > /dev/null`).
- Трогал `tools/lab/` → прогнать существующий smoke: `tools/lab/smoke.sh` (Фаза 3 оставила 37/37 зелёными —
  не сломать).
- Перед push: `git show --stat HEAD` — в коммите ровно намеченные файлы, сообщение начинается с ключа задачи.

## Что уже есть в коде (терраин Фазы 4)

- `tools/lab/lab-emit.sh` — **существует** (Фаза 3): `question` / `answer` / `resolve` / `decision` поверх
  `docs/lab/questions/queue.jsonl` и `docs/lab/decisions/log.jsonl`. GSL-84 его **расширяет**, не переписывает.
- `tools/lab/smoke.sh` — существует, 37/37 зелёных.
- `tools/hooks/stop-require-final-text.sh` + `.claude/settings.json` — **существуют** (леджер-коммит). В
  settings.json пока ТОЛЬКО Stop-hook: GSL-83 добавляет хуки рядом, **не ломая его**.
- `docs/lab/` — есть `questions/`, `decisions/` (`manifest.md` + `log.jsonl`), `digest/`, `README.md`.
  **Нет** `events/`, `status.json`, `telemetry.jsonl`, `site/`, `scratch/` — их достраивает GSL-85.
- `tools/watchdog/` — Фаза 1, не трогать.

## ⭐ RESUME POINT

**Impl-воркер (Opus 4.8) стартует с GSL-83.** Ветка уже есть и запушена — переключиться и работать:

```bash
git checkout GSL-81-laboratory-auto-doc   # @ 9a056bb, upstream настроен
git log --oneline -1                      # ожидается 9a056bb (GSL-82 леджер)
git status --porcelain                    # ожидается РОВНО 1 строка: docs/prompts/2-*.md — НЕ коммитить
```

Порядок задач (PRD-порядок, зависимости соблюдены):

| Ключ | GH | Задача | Зависит от |
|---|---|---|---|
| **GSL-83** | #95 | T1 event layer: hooks в `.claude/settings.json` + `tools/lab/lab-log.sh` (envelope `{ts,run_id,seq,actor,type,data}` → дневной jsonl) | — |
| GSL-84 | #96 | `lab-emit`: семантические события (`cycle.started`, `question.posed`, `decision.made`, `verify.verdict`) | GSL-83 (envelope) |
| GSL-85 | #97 | `docs/lab/` layout + `scratch/` в `.gitignore` + дисциплина atomic/append-only | GSL-83 |
| GSL-86 | #98 | chronicler: build-скрипты (`status.json`, Library index) + `claude -p` glue (budget, allowedTools) | 83/84/85 |
| GSL-87 | #99 | poll-fill reconcile (gh/jira/git → пропущенные события) | GSL-86 |
| GSL-88 | #100 | одна строка `lab-emit handoff.written` в `skill/handoff/SKILL.md` (T2 больше не трогать!) | GSL-84 |
| GSL-89 | #101 | dev_history Фазы 4 + контракт `generated-at` / staleness | все |

Разумная нарезка на циклы: **impl-1** = GSL-83 → GSL-84 → GSL-85 (три коммита, фундамент);
**impl-2** = GSL-86 → GSL-87 (chronicler + reconcile); **impl-3** = GSL-88 → GSL-89 (скилл + доки).
Дальше: механик открывает PR на эпик → ревьюер → (фиксер) → финализатор (merge, эпик → Done).
Затем **Фаза 5 (UI)** — чистый потребитель `docs/lab/`.

## Gotchas (ловушки, которые уже кусали)

- **`docs/prompts/2-deep-orchestrating-research.md` — не коммитить.** Owner-sovereign, решение не принято.
  Отсюда правило: **никогда `git add -A` / `git add .`**, только пофайловое индексирование.
- **`.claude/scheduled_tasks.lock`** — runtime-файл, уже в `.gitignore`. Поэтому `git add .claude/` безопасен.
- **Хуки могут молча не сработать** (`TeammateIdle` не тестирован). Проверять фактическим прогоном;
  деградировать С ЛОГОМ; честно писать в dev_history, что не завелось. (Риск зафиксирован в PRD.)
- **Chronicler — не teammate.** Живых панелей три, четвёртая падает с `fork failed`. Chronicler обязан быть
  bounded-задачей (`claude -p --max-budget-usd --allowedTools`), иначе съест слот доставки.
- **Мёртвая страница обязана выглядеть мёртвой.** Каждый производный артефакт несёт `generated_at` +
  `max_event_age`. Урок tasty-lunch: протухший хаб, который молчит о своей протухлости, хуже отсутствующего.
- **Никаких API-ключей** (C1). Grep по chronicler'у должен подтверждать их отсутствие — движок это
  подписка, а стрей `ANTHROPIC_API_KEY` молча её перехватывает.

## Blocked on human

Нет. Очередь вопросов пуста: `tools/lab/lab-emit.sh list` → open=0. Единственное «висящее» решение владельца —
коммитить ли `docs/prompts/2-*.md`; до ответа файл просто лежит untracked и никому не мешает.
