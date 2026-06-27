Ты — оркестратор доставки для проекта gosleep (Orchestration Harness). Первым делом подними скиллы
/orchestrating-delivery-agents, /handoff, /delivery-workflow, /using-jira. Это передача работы от
предыдущего оркестратора — прочитай всё, затем начни с раздела «ЧТО ДЕЛАТЬ → Шаг 0».

════════ КОНТЕКСТ ════════

ЧТО ЭТО. gosleep — standalone git-репозиторий, который является ИСТОЧНИКОМ ПРАВДЫ для глобального
скилла orchestrating-delivery-agents (+ его эвал-сьют, документация, HTML-отчёты). Цель проекта —
своя система оркестрации доставки на базе скиллов writing-prds, orchestrating-delivery-agents,
delivery-workflow, handoff, using-jira.
Корень: /Users/romanlidovskyi/Documents/dev/harness/gosleep

ГДЕ МЫ. Эпик GSL-1 «инициализация проекта», ветка GSL-1-project-init, открыт PR #5.
- GSL-2 (Done): импортирован harness v0 (skill/, evals/, docs/, reports).
- GSL-3 (Done): якоря — CLAUDE.md, docs/dev_history/, README.
- GSL-4 (In Progress): чинятся устаревшие абсолютные ROOT-пути в генераторах отчёта и eval-runner;
  on-plan WIP лежит НЕЗАКОММИЧЕННЫМ в дереве (4 файла).
- GSL-5 (ещё не создан): синк скилла из глобального — СДЕЛАН в дереве, но не оформлен (см. ниже).

ЧТО ПРОИЗОШЛО В ПОСЛЕДНЕЙ СЕССИИ.
1) Владелец одобрил принять свежую глобальную версию orchestrating-delivery-agents целиком.
   Выполнен reverse-sync global → local:
     rsync -a --delete ~/.claude/skills/orchestrating-delivery-agents/ <repo>/skill/
   Проверено diff -r → ИДЕНТИЧНО. Изменены 3 файла (skill/SKILL.md,
   skill/references/worker-cycle-template.md, skill/references/lifecycle-and-edge-cases.md; +128/−11).
   Смысл изменений — цельный блок про защиту верификации от зависшего браузер-верификатора:
   edge-case E17, паттерн VERIFY-REQUEST (воркер не водит браузер сам — просит оркестратора),
   verification watchdog по steps.log, правило про background-субагентов для hang-prone инструментов.
   ЭТИ ИЗМЕНЕНИЯ skill/ — НЕЗАКОММИЧЕНЫ.
2) Аудит вендоринга скиллов: в репо вендорен ТОЛЬКО orchestrating-delivery-agents. Остальные 4
   (writing-prds, delivery-workflow, handoff, using-jira) в репо ОТСУТСТВУЮТ — только глобально в
   ~/.claude/skills/. Сравнивать их не с чем (single-source). Вендорить ли их в репо — ОТКРЫТОЕ
   РЕШЕНИЕ владельца (меняет структуру skill/, семантику install.sh и конвенции CLAUDE.md).

ПРОБЛЕМА, КОТОРАЯ МОЖЕТ ВЕРНУТЬСЯ (macOS TCC). В прошлой сессии весь каталог проекта под ~/Documents
внезапно стал недоступен: любое чтение/запись содержимого → EPERM «Operation not permitted» (и Bash
даже с отключённой песочницей, и инструменты Read/Write), при этом stat/ls -ld каталога работали.
Причина — ~/Documents защищён macOS TCC, и грант Full Disk Access у хост-приложения отвалился после
многодневного возобновления сессии + смены модели. Лечится только владельцем в GUI (см. Шаг 0).
Сейчас доступ ВОССТАНОВЛЕН.

════════ ПРАВИЛА ВЛАДЕЛЬЦА (соблюдать дословно) ════════
- ОРКЕСТРАТОР НИЧЕГО НЕ ИСПОЛНЯЕТ САМ: вся доставка (коммит, Jira, GitHub, dev_history, эвалы) идёт
  ВОРКЕР-АГЕНТУ; оркестратор только координирует и держит состояние на диске в
  docs/handoff/ORCHESTRATION-STATE.md. Тривиальную команду, которую владелец просит ПРЯМО, можно
  выполнить инлайн.
- Jira: иерархия Epic + Task (free tier, без Story). 1 ветка/эпик, 1 коммит/задача (сообщение
  начинается с ключа: «GSL-N …»), 1 PR/эпик, обычный merge (НЕ squash). Summary задач начинаются с
  тегов [Repo]/[Docs]/[Tooling]/[Process]/[Evals]/[Skill].
- GitHub Issues зеркалят Jira (лейблы epic/task, кросс-ссылки в обе стороны). Каждую Jira-задачу
  назначать на владельца при создании. Idempotent creates: ищи перед созданием, переиспользуй
  совпадение (стабильные ключи в заголовках/ветках).
- skill/ — источник правды. install.sh синкает local → global (rsync --delete). НИКОГДА не запускай
  install.sh, пока локальный позади глобального; подтянуть глобальный вперёд — это ОБРАТНЫЙ rsync
  (global → local). После уже сделанного синка local == global, install.sh не нужен.
- dev_history: один файл на задачу docs/dev_history/<TASK-KEY>-<phase>-<slug>.md + строка в индексе
  docs/dev_history/README.md. Легаси TLM-история — в docs/dev-history/ (через дефис), не трогать.
- Никаких force-push. Не писать символ параграфа — слово «section». Все артефакты оркестрации —
  внутри дерева проекта, никогда не в /tmp.

════════ ЯКОРЯ / СВЯЗИ ════════
- Jira: проект GSL, site ainstance-labs.atlassian.net,
  cloudId 74054cdc-47ef-497d-9684-734149876a8b. Переходы: To Do=11, In Progress=21, In Review=31,
  Done=41. Доска: https://ainstance-labs.atlassian.net/jira/software/projects/GSL/boards/100
- GitHub: ainstance-labs/gosleep (private). PR #5 открыт (ветка GSL-1-project-init).
  Issues: #1→GSL-1, #2→GSL-2, #3→GSL-3, #4→GSL-4. Следующий свободный GH-номер = 6.
- Владелец/assignee: Roman L (rommxx@gmail.com),
  accountId 557058:83b04839-8bde-4331-9c2d-24843d0b8e67.

════════ ТЕКУЩЕЕ СОСТОЯНИЕ (перепроверь живыми инструментами) ════════
- Jira: GSL-1 In Progress (epic) · GSL-2 Done · GSL-3 Done · GSL-4 In Progress. GSL-5 нет.
- git: ветка GSL-1-project-init, HEAD c189a66. Незакоммичено:
    docs/report/build-report.js, docs/report/build-subagents.py,
    evals/runner/eval-runner.js, evals/runner/gen-scenarios.js        (WIP GSL-4)
    skill/SKILL.md, skill/references/worker-cycle-template.md,
    skill/references/lifecycle-and-edge-cases.md                       (синк → GSL-5)
  Untracked: docs/handoff/ORCHESTRATION-STATE.md, docs/handoff/02-2026-06-25-handoff-skill-sync.md.

════════ ЧТО ПРОЧИТАТЬ ПЕРВЫМ ════════
1. docs/handoff/ORCHESTRATION-STATE.md — ЖИВАЯ ground-truth (читать всегда первой).
2. docs/handoff/02-2026-06-25-handoff-skill-sync.md — подробный хендофф этой сессии.
3. CLAUDE.md — якоря и конвенции.
4. skill/SKILL.md — свежесинхронизированный скилл (новое поведение E17/VERIFY-REQUEST/watchdog).
5. Хендофф от 2026-06-09 — фон проекта (частично устарел: TLM-эра).

════════ ЧТО ДЕЛАТЬ ════════
Шаг 0 — проверь доступ (на случай повторного EPERM):
  ls /Users/romanlidovskyi/Documents/dev/harness/gosleep >/dev/null 2>&1 && echo ACCESS_OK || echo STILL_EPERM
  Если STILL_EPERM → попроси владельца (только он, GUI): System Settings → Privacy & Security →
  Full Disk Access → включить хост-приложение Claude Code (Terminal / iTerm / VS Code / Claude Desktop)
  → ПЕРЕЗАПУСТИТЬ его (TCC подхватывается после рестарта). chmod/chflags/xattr НЕ помогут (тоже EPERM).
  Крайний запас (только с согласия владельца): перенести репо из ~/Documents в ~/dev/... (меняет якоря).

Шаг 1 — сверь реальность живыми инструментами: git status -sb, git log --oneline -5,
  gh pr list / gh issue list --repo ainstance-labs/gosleep, Jira JQL «project = GSL ORDER BY key ASC».
  Подтверди, что синк ещё на месте:
    diff -r <repo>/skill/ ~/.claude/skills/orchestrating-delivery-agents/   (пусто = идентично)

Шаг 2 — оформи синк как доставку GSL-5 ЧЕРЕЗ ВОРКЕРА (правило делегирования), idempotent:
  - Jira: найди-или-создай GSL-5 «[Skill] Sync orchestrating-delivery-agents from global» под эпиком
    GSL-1, assignee = владелец, перевод в In Progress (21).
  - GitHub: зеркальный issue #6 (label task, кросс-ссылки в обе стороны).
  - Коммит ТОЛЬКО путей skill/ (НЕ трогая WIP GSL-4 и файлы docs/handoff/):
    «GSL-5 Sync orchestrating-delivery-agents skill from global (E17 / VERIFY-REQUEST / verification watchdog)»
  - dev_history: docs/dev_history/GSL-5-init-skill-sync.md + строка в docs/dev_history/README.md.
  - Jira GSL-5 → Done (41).

Шаг 3 — НЕ делай автономно, спроси владельца (AskUserQuestion) на этих развилках:
  (a) Вендорить ли в репо остальные 4 скилла (writing-prds, delivery-workflow, handoff, using-jira),
      чтобы harness стал самодостаточным? Это меняет структуру skill/, install.sh и CLAUDE.md —
      нужен дизайн (куда класть, направление синка, конвенции). Возможно — отдельный эпик.
  (b) Завершать ли сначала GSL-4 (закоммитить его WIP) перед мержем PR #5.
  (c) Нужны ли новые эвал-сценарии под новое поведение скилла (E17/VERIFY-REQUEST/watchdog) —
      в SC-01..20 покрытия НЕТ. Отдельной задачей.
  (d) Коммитить ли docs/handoff/ORCHESTRATION-STATE.md (и файлы хендоффа) или оставить
      untracked-артефактами оркестрации.
  НЕ закрывай эпик GSL-1 / PR #5 сам — это развилка для владельца.

════════ НА ЧТО ОБРАТИТЬ ВНИМАНИЕ (gotchas) ════════
- В теле документов ссылайся на прошлые хендоффы прозой («хендофф от 2026-06-09»), НЕ как .md-имя с
  датой (ломает docs-чекер).
- Генераторы отчёта/eval-runner: сперва убедись, что path-константа указывает на текущий корень
  (это и чинит GSL-4) — иначе упадут на старых абсолютных путях из tasty-lunch.
- Коммить задачи раздельно: пути skill/ (GSL-5) и пути GSL-4 не смешивать в один коммит.
- Дату для имён файлов бери из `date +%F`, не из памяти.

════════ TELEMETRY ════════
Активной цепочки воркеров нет (cycle 0). Прошлый оркестратор — Opus 4.8 (на старте была Fable 5).