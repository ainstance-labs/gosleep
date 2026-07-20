# Handoff — gosleep — 2026-07-20 (оркестраторский roll: Phase 5 отревьюена и пофикшена, остался finalizer)

> Для СВЕЖЕГО оркестратора. Читай Part 1 → Part 2 → ⭐ RESUME.
> Ground truth = `ORCHESTRATION-STATE.md` (первым) + этот файл + handoff 37 (fixer, § RESUME для finalizer'а) + handoff 35 (там 20 правил и 6 уроков — все в силе).
> Мой пред — handoff 35 (roll 2026-07-13). Я cold-started 2026-07-20 10:18Z, ролюсь ~12:16Z на чистой границе: fixer COMPLETE + terminated, флот пуст, контекст ~76% (потолок 70%).

# ── Part 1 · Простыми словами ──

## 1. Где мы

**Phase 5 UI (эпик GSL-90) полностью готова к мержу.** PR **#115** OPEN / mergeStateStatus **CLEAN**, ветка `GSL-90-ui-orchestration @ 2d2b699` (25 коммитов от main @ `5fd1de2`: 21 на открытии PR + 3 фикс-коммита + handoff 37). Все 11 задач эпика (GSL-91..GSL-101) в Jira Done, эпик In Review. Ревью пройдено (вердикт FIX → всё пофикшено и перепроверено). Остался **финализ**: merge → close issues → Jira Done → cleanup → **Phase 6 Mobile setup без остановки**.

Флот пуст (0/3). Очередь чиста (open=0, lines=16). smoke **264/264**, hooks-verify 14/14, tsc чист, схема `render/7` (не двигалась).

## 2. Что сделано в моей смене (cold-start 10:18Z → roll ~12:16Z, 4 цикла)

- **Cycle 59 (impl-ui-7): GSL-100 приёмка Фазы 5** — `dc2a925` + handoff 36 `9fb5766`. F5-S1..S3 + S4a/b ✅ живыми прогонами; **F5-S4c «читается через приватный GitHub» ОПРОВЕРГНУТ** (nosniff + text/plain + Pages 404 — записано по факту, формулировка не подгонялась; это вход Фазы 6). Приёмка нашла и починила **настоящий nav-дефект**: на 390px Cost/Library были недостижимы (нет точек переноса), scrollWidth 850→390. smoke 248→252.
- **Cycle 60 (mechanic-gsl90): PR #115 открыт**, эпик → In Review. Механик сам нашёл, что **GSL-101 — 11-я задача эпика** (GH #114, в моём брифе её не было) и внёс в Closes. Попутно: описание Jira-эпика перечисляет 10 задач — устарело.
- **Cycle 61 (reviewer-gsl90): вердикт FIX — 0 CRITICAL / 3 MAJOR / 2 MINOR / 3 NIT** (`docs/reviews/REVIEW-gsl90.md`, gitignored). Тройка MAJOR била в одну точку: метры честности сами ошибались в успокаивающую сторону (ложный handoff-долг; pane.ended ≠ граница цикла; замороженные возрасты Fleet). Слепота 252 тестов объяснена: фикстура кодировала порядок, которого прод не производит.
- **Cycle 62 (fixer-gsl90): всё закрыто** — `5e6d5ed` (M3) + `7c73aa3` (M1+M2+фикстуры тем же коммитом) + `61fcd86` (m1+n1) + handoff 37 `2d2b699`. **12 новых тестов, каждый красный на до-фиксовом 9fb5766**; M1 доказан end-to-end на живых данных (undocumented_cycles 2→0). smoke 252→264. Отложено честно: n2-половина (риск>выгоды), n3 (не требует действий), n1 без DOM-теста (нет харнесса под client.ts) — названо вслух.
- **Housekeeping смены**: 3 просроченных DECISION (07-13/14) resolved к применённым дефолтам; handoff 35 был untracked → late-commit `66bce16` (тот же класс долга, что 28/29); STATE «At a glance» переписан (был протухшим с эры GSL-41); nav-DECISION q-2026-07-20-001 resolved (d-2026-07-20-004).

## 3. Что дальше (немедленно)

Successor спавнит **finalizer-gsl90** (Opus 4.8): REGULAR merge PR #115 → close GH issues → Jira GSL-90 Done → удалить ветку → fetch main. Затем **без остановки Phase 6 Mobile setup** (owner mandate 2026-07-10 continue-at-milestone-boundaries): PRD § «Фаза 6», новый эпик GSL-102+, GH #116+. Детальные шаги — в ⭐ RESUME ниже.

## 4. Проблемы

Блокеров нет. Наследуемые долги (НЕ Phase 5, для owner'а): GSL-30 без dev_history; ledger-naming gap (48 имён); `task.completed` не стреляет с 07-13 12:54; дефолты по таймеру ночью никто не применяет; token ceiling не машиночитаем. Новое: описание Jira-эпика GSL-90 устарело (10 задач вместо 11) — может поправить finalizer одной строкой или owner.

## 5. Комментарии и уроки смены

- **Owner directive 2026-07-20 (IN FORCE):** `orchestrating-delivery-agents` — использовать ТОЛЬКО глобальный скилл (`~/.claude/skills/`), НЕ локальную копию `skill/` этого репо (в ней проблемы). `./install.sh` для этого скилла не гонять. Факт на 10:24Z: копии byte-identical, но авторитет — глобальная.
- **⚠️ Мой хронический фейл смены — successor'у не повторять:** я 7+ раз закончил turn tool-вызовом (ScheduleWakeup) без финального текста владельцу; Stop-hook ловил каждый раз. Правило простое: **результат ScheduleWakeup = сигнал писать текст владельцу, а не конец хода.** Это уже HARD ×2 в памяти — теперь ×3.
- Все 6 уроков воркеров (Jira description первым тулом; grep прежде чем верить description; «нет источника» проверяй руками; ⛔ tree-wide git ops; ⛔ background restore-trap; прочитай прозу вслух + позитивный контроль) — живут в handoff 35 § Part 1.5, вшивать в каждый impl-бриф.
- Amend ДО push — легально (fixer делал d7606b6→5e6d5ed до пуша); после push — запрещён, как и раньше.

---

# ── Part 2 · Формально ──

## ⚠️ Железные правила

**Все 20 правил handoff 35 § Part 2 в силе без ослаблений** (turn кончается текстом; все воркеры Opus 4.8 транскрипт-verify; NO Workflow; fleet cap 3; AUTONOMOUS mode; REGULAR merge / no force-push / `gh api -X PUT` для мержа; kill-pane по явному id; ⛔ tree-wide git ops; ⛔ restore-trap; hook shim; settings live; status.json через lab-write.sh; дирти дерево норма; poll-fill не трогать; no `git add -A`; sovereign-файлы; C5 слова + literal `teammate_name` exemption; схема render/N = 4 файла; queue читать FOLD; ассертить mechanism + mutation; print your glob). Плюс новое: **global-skill directive 2026-07-20** (выше).

## Connections

| | |
|---|---|
| Jira | project **GSL**, cloudId `74054cdc-47ef-497d-9684-734149876a8b`, транзиции 11/21/31/**41=Done** |
| GitHub | `ainstance-labs/gosleep` (private) |
| **PR #115** | OPEN/CLEAN, base main ← `GSL-90-ui-orchestration @ 2d2b699`, Closes #103..#114 |
| Эпик GSL-90 | Jira **In Review**; GH issue #103 |
| main | @ `5fd1de2` (Phase 4 = PR #102) |
| Owner | Roman L, accountId `557058:83b04839-8bde-4331-9c2d-24843d0b8e67` |
| Next Jira / GH | **GSL-102+** / **#116+** (Phase 6) |
| PRD | `docs/prd/PRD-gosleep-evolution.md` § «Фаза 6» (Mobile) |

## Gates (CI нет — руками)

`bash tools/lab/smoke.sh` → **264/264** (флейк :234 pre-existing, не чинить) · `bash tools/lab/hooks-verify.sh` → 14/14 · `(cd tools/lab/ui && npx tsc --noEmit)` → 0 · `bash tools/lab/chronicler.sh --no-poll` → 7 страниц. Схема `gosleep.lab.render/7`.

## ⭐ RESUME POINT — successor orchestrator

```bash
# Cold-start orient (по порядку)
cat docs/handoff/ORCHESTRATION-STATE.md | head -30   # At a glance + LIVE-STATUS
cat docs/handoff/38-2026-07-20-handoff-orchestrator-roll.md   # этот файл
tail -5 docs/handoff/.orchestrator-heartbeat          # мой финальный status=rolling

# Sanity
tmux list-panes -t "$(tmux display-message -p '#{session_id}')"  # только твоя pane
git log main --oneline -1                 # 5fd1de2
git ls-remote origin GSL-90-ui-orchestration  # 2d2b699
gh pr view 115 --json state,mergeStateStatus  # OPEN + CLEAN
tools/lab/lab-emit.sh list --count        # open=0 (0B/0D/0C/0F) lines=16

# Первый heartbeat (cycle 63, закрывает watchdog grace)
```

**Задача 1 — finalizer-gsl90 (Opus 4.8), бриф:**
1. `gh api -X PUT repos/ainstance-labs/gosleep/pulls/115/merge -f merge_method=merge` (НИКОГДА `gh pr merge`, никогда squash). Verify: `gh pr view 115 --json state,mergedAt`.
2. Close GH issues: #103 закроется авто (первый в Closes); **#104..#114 закрыть вручную** `gh issue close N --comment "GSL-9x merged in PR #115"` — проверить каждый.
3. Jira GSL-90 → Done (41), верифицировать `getJiraIssue` status.name="Done".
4. Удалить remote-ветку `GSL-90-ui-orchestration`; локальный main: `git fetch origin main:main` (БЕЗ checkout; HEAD остаётся на локальной эпик-ветке до Phase 6 ветки).
5. Опционально одной строкой: дописать в Jira-описание эпика GSL-90 упоминание GSL-101 (устарело — 10 задач вместо 11).
6. Отчёт ≤10 строк + модель по транскрипту + telemetry line.

**Задача 2 — Phase 6 Mobile setup (без остановки, owner mandate):** прочитать PRD § «Фаза 6» → spawn setup-воркер (Opus 4.8): эпик GSL-102 + задачи в Jira (assignee owner), GH mirror #116+, ветка `GSL-102-<slug>` от нового main, ledger-коммит owner-sovereign файлов (STATE, queue.jsonl, decisions/log.jsonl, handoff 38, digest — прецеденты GSL-82/GSL-91) первой задачей. Затем impl-циклы по задачам с 6 уроками в брифах.

## Cumulative TELEMETRY (не сбрасывать)

- **cycles_completed = 87**, total ≈ **8 589 000** tokens_out (+гэпы 2a/32/35/48-52/57-cache-write — см. STATE TELEMETRY).
- Моя смена (59-62): impl-ui-7 226k/37.6M · mechanic 19k/1.8M · reviewer 112k/9.1M · fixer 166k/23.5M ≈ **523k out / 72M cache_read**.

## Gotchas

Все из handoff 35 в силе (site/ DERIVED; коммит через `git commit -F`; ORCHESTRATION-STATE не handoff; pane.ended граница — теперь с дебаунсом 600s; opechatки имён — process gap). Новые: self-health считает интервал последнего цикла ОТКРЫТЫМ (handoff после последней границы гасит долг); Fleet-возрасты живые через общий Age-компонент (`components.tsx`); `docs/reviews/REVIEW-gsl90.md` gitignored — не коммитить.

## Blocked on human

**Нет.** Очередь open=0. Вопросы для owner'а (не блокеры, копятся с handoff 35): GSL-30 dev_history; naming gap; ночные дефолты; token ceiling; + Jira-описание эпика GSL-90 устарело.
