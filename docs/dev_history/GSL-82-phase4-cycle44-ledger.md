# GSL-82 — Леджер-коммит: STATE + handoff'ы 19/20/21 + Stop-hook + багрепорт + .gitignore/SKILL

**Эпик:** GSL-81 — [Repo][Tooling] Фаза 4 — Laboratory (auto-doc) · PRD Phase 4
**Ветка:** `GSL-81-laboratory-auto-doc` (от `origin/main` @ `4af66d2`)
**Фаза:** GSL-81, цикл 44 — setup / housekeeping

---

## Part 1 — Рассказ

### Что сделано

Открыт эпик Фазы 4 и закоммичен оркестраторский леджер — всё то, что накопилось в рабочем дереве
за хвост Фазы 3 и по правилу «воркеры не трогают леджер-файлы» ждало именно этого коммита.

Содержательно в коммит вошли три разные вещи. Первая — **состояние оркестрации**: обновлённый
`ORCHESTRATION-STATE.md` и три handoff'а (19, 20, 21), которыми предыдущие оркестраторы передавали
эстафету через паузу, фикс-хвост и, наконец, свежему оркестратору после мержа PR #92. Вторая —
**материалы инцидента «немые ходы»**: багрепорт для поддержки Anthropic и техническое противоядие к
нему — Stop-hook `tools/hooks/stop-require-final-text.sh`, подключённый через `.claude/settings.json`.
Хук механически блокирует конец turn'а, если агент не написал владельцу финальный текст; правило
жило в скилле, но одного правила оказалось мало — два оркестратора подряд на нём сгорели, поэтому
теперь его держит не только текст, но и код. Третья — **чистка самого скилла**
`orchestrating-delivery-agents`: из него вырезан паттерн-ловушка, который прямо провоцировал
заканчивать ход tool call'ом.

Параллельно поставлены леса Фазы 4: эпик GSL-81 (In Progress) и восемь задач GSL-82..GSL-89 в Jira,
зеркало в GitHub Issues (#93 эпик, #94..#101 задачи), перекрёстные ссылки в обе стороны, ассайни —
владелец на каждой. Список задач взят из PRD дословно (семь задач раздела «Фаза 4»), леджер-коммит
добавлен первым.

### Какие проблемы решены

Дерево было «грязным» на уже смёрженной ветке `GSL-72-question-buffer`: незакоммиченный леджер не
давал сделать обычный `checkout main`. Решено тем же приёмом, что и в прошлых циклах — ветка эпика
нарезана прямо от `origin/main` (`git checkout -b GSL-81-laboratory-auto-doc origin/main`), и
незакоммиченные правки переехали на неё без конфликтов. Перед этим переезд был **проверен, а не
предположен**: `git diff --stat d86ba0f origin/main` дал пустой вывод — деревья кончика GSL-72 и
merge-коммита в main идентичны, значит конфликтовать физически не с чем.

Второе: `.claude/scheduled_tasks.lock` — runtime-файл планировщика, который лез в каждый
`git status`. Добавлен в `.gitignore`, благодаря чему всю директорию `.claude/` теперь можно
безопасно ставить в индекс: `settings.json` коммитится, lock — нет.

### Какие проблемы остались

По самой задаче — никаких. Под эпиком остаются открытыми семь содержательных задач
(GSL-83..GSL-89): T1-хуки и `lab-log.sh`, семантические события в `lab-emit`, layout `docs/lab/`,
chronicler, poll-fill, одна строка в handoff-конвенцию и закрывающий dev_history с контрактом
свежести. Содержимое Фазы 4 в этом коммите **не реализовано** — это setup, и только.

Главный риск фазы записан в PRD и остаётся не проверенным: хуки Claude Code могут не срабатывать на
этой машине так, как задокументировано (`TeammateIdle` не тестирован никем). Проверять придётся
на build-time и деградировать **с логом**, а не молча.

### Подводные камни и «костыли»

- **`docs/prompts/2-deep-orchestrating-research.md` намеренно НЕ закоммичен.** Владелец не принял
  решения, коммитить ли его. Это тот же standing call, что в циклах GSL-59 / GSL-66 / GSL-73.
  Поэтому индексирование велось **пофайлово** (`git add <path>`), и `git add -A` / `git add .` не
  применялись ни разу — иначе untracked-промпт вымело бы в коммит вместе с новыми handoff'ами.
  После коммита `git status --porcelain` содержит ровно одну строку — этот файл.
- **Имя файла dev_history.** Соседи по Фазе 3 названы `GSL-NN-phase-gsl72-cycleN-*.md` (фаза
  названа ключом эпика). Здесь взята схема `GSL-82-phase4-cycle44-ledger.md` — фаза по номеру PRD,
  цикл по сквозному счётчику оркестратора (44-й, а не «первый цикл эпика»). Обе формы подходят под
  конвенцию `<TASK-KEY>-<phase>-<cycle>-<slug>`; будущему читателю просто не надо пугаться двух
  стилей в одной директории.
- **Stop-hook уезжает в репо.** С этого коммита `.claude/settings.json` — часть проекта, а не
  локальная настройка машины. Это осознанно: правило «ход заканчивается текстом владельцу» слишком
  дорого стоило, чтобы жить только в голове агента.

### Что не вошло

PR не открыт — по конвенции «один PR на эпик» его откроет механик-цикл, когда содержательные задачи
лягут в ветку. Ничего не выброшено.

---

## Part 2 — Технический справочник

**Коммит:** `GSL-82 [Docs] Леджер: STATE + handoff'ы 19/20/21 + Stop-hook + багрепорт + gitignore/SKILL`
на ветке `GSL-81-laboratory-auto-doc`.

**Файлы в коммите (10):**

| Файл | Что это |
|---|---|
| `.gitignore` (M) | +3 строки: `.claude/scheduled_tasks.lock` в игнор |
| `.claude/settings.json` (new) | подключение Stop-hook'а (`Stop` → команда, timeout 10s) |
| `tools/hooks/stop-require-final-text.sh` (new, +x) | сам хук: блокирует конец turn'а без финального текста владельцу |
| `docs/handoff/ORCHESTRATION-STATE.md` (M) | состояние оркестрации + телеметрия циклов |
| `docs/handoff/19-2026-07-10-handoff-gsl72-pause-orchestrator-roll.md` (new) | handoff на паузе |
| `docs/handoff/20-2026-07-10-handoff-gsl72-fix-tail-orchestrator-roll.md` (new) | handoff фикс-хвоста |
| `docs/handoff/21-2026-07-12-handoff-gsl72-merge-tail-fresh-orchestrator.md` (new) | handoff свежему оркестратору (merge-хвост) |
| `docs/reports/bugs/2026-07-10-fable5-silent-turns-incident.md` (new) | инцидент-репорт «немые ходы» для поддержки Anthropic |
| `skill/orchestrating-delivery-agents/SKILL.md` (M) | вырезан паттерн-ловушка «turn заканчивается tool call'ом» (+52/−31) |
| `docs/dev_history/GSL-82-phase4-cycle44-ledger.md` (new) | этот файл |
| `docs/dev_history/README.md` (M) | индекс: новая секция «Phase 4 (Laboratory) — GSL-81» |

**Намеренно НЕ закоммичено:** `docs/prompts/2-deep-orchestrating-research.md` — решение владельца
не принято (owner-sovereign).

**Git:**
- `origin/main` @ `4af66d2` (merge PR #92, Фаза 3 закрыта); ветка эпика нарезана от него.
- Идентичность деревьев перед переездом подтверждена: `git diff --stat d86ba0f origin/main` → пусто.
- Ветка запушена с `-u` (upstream = `origin/GSL-81-laboratory-auto-doc`). Force-push не применялся.

**Леса эпика:**
- Jira: Epic **GSL-81** (In Progress) + Tasks **GSL-82..GSL-89**, ассайни — владелец на всех.
- GitHub: **#93** (epic) + **#94..#101** (tasks), метки `epic` / `task`, перекрёстные ссылки Jira ↔ GH.
- Соответствие: GSL-82→#94 · GSL-83→#95 · GSL-84→#96 · GSL-85→#97 · GSL-86→#98 · GSL-87→#99 ·
  GSL-88→#100 · GSL-89→#101.

**Проверено запуском:**
- `git diff --stat d86ba0f origin/main` → пусто (переезд леджера безопасен).
- `git status --porcelain | wc -l` → `10` до коммита, `1` после (остаётся только owner-sovereign
  промпт).
- `git show --stat HEAD` → ровно 10 намеченных путей, `docs/prompts/` отсутствует.
- `gh api repos/ainstance-labs/gosleep/branches/GSL-81-laboratory-auto-doc` → ветка на origin.
- `./install.sh` не запускался: `skill/orchestrating-delivery-agents/SKILL.md` попал в коммит уже
  правленным (правку делал предыдущий цикл и он же синхронизировал глобальную копию); этот цикл
  содержимое скиллов не менял.

**Ссылки:** Jira [GSL-82](https://ainstance-labs.atlassian.net/browse/GSL-82) ·
GitHub [#94](https://github.com/ainstance-labs/gosleep/issues/94) · Эпик
[GSL-81](https://ainstance-labs.atlassian.net/browse/GSL-81) /
[#93](https://github.com/ainstance-labs/gosleep/issues/93) ·
PRD: `docs/prd/PRD-gosleep-evolution.md`, раздел «Фаза 4 — Laboratory (авто-документация)».
