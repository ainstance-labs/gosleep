# Handoff — gosleep — 2026-07-13 (оркестраторский roll: Phase 5 impl 6/9 Done, impl-ui-7 GSL-100 remains)

> Для СВЕЖЕГО оркестратора. Читай Part 1 → Part 2 → ⭐ RESUME.
> Ground truth = `ORCHESTRATION-STATE.md` (первым) + этот файл + `34-2026-07-13-handoff-impl-ui-6.md` (последний impl handoff, содержит § RESUME для impl-ui-7).
> Мой пред — я же, cold-started этой сессии ~13:35Z. Ролюсь на границе impl-ui-6 COMPLETE, context ~67%, roll ceiling 70%. Все воркеры terminated, флот пуст.

# ── Part 1 · Простыми словами ──

## 1. Где мы

**Phase 5 UI** («Дашборд оркестрации», PRD задача R5.1-R5.3) в разгаре. Эпик **GSL-90**, ветка **`GSL-90-ui-orchestration @ 8258e30`** (8 коммитов от main @ 5fd1de2). **6 из 9 impl задач Done** + мой orchestrator ledger commit сегодня. Следующая — **GSL-100 (F5-S4 приёмка)**, ещё не спавнена — это твоя первая работа.

Флот пуст (0/3). Очередь чиста (open=3, 0 BLOCKER — все три applied default'ы). Watchdog может быть включён.

## 2. Что сделано в моей смене (cold-start ~13:35Z, roll ~18:20Z)

**7 коммитов на ветке `GSL-90-ui-orchestration` за 5 часов** (@6355aee до @8258e30):

- **GSL-95** `164bfa5` (impl-ui-2) — Questions deadline countdown F5-S2 CLOSED. Mutation-tested countdown, `clock = max(now, generated_at)` (часы не могут идти назад).
- **GSL-96** `c965089` (impl-ui-3) — Tasks board keyed by Jira F5-S3 CLOSED. 0 битых ссылок из 475. Схема render/3 → /4.
- **GSL-97** `fccc720` (impl-ui-4) — Timeline+Library+клиентский JS-фильтр R5.2 CLOSED. 103 артефакта в Library с print-your-glob. Схема /4 → /5.
- **GSL-98** `33b9343` (impl-ui-5) — Fleet+Cost R5.1 fleet+budget axes readable. Схема /5 → /6. C5 exemption через DECISION q-2026-07-13-005 (strict — только literal `teammate_name`).
- **GSL-99** `83f49f8` + `cbdcb26` (проза fix) + `e49cf71` (handoff) (impl-ui-6) — Laboratory self-health metrics R5.3. Схема /6 → /7. Три коммита — правило 1-per-task нарушено честно (force-push запрещён).
- **GSL-90** `8258e30` (orchestrator ledger) — late-commit orphaned handoffs 28+29 (impl-ui-6 self-health finding: они лежали `??` в git status 6 циклов).

**smoke прогрессия: 130 → 174 → 182 → 192 → 208 → 230 → 248/248.** hooks-verify 14/14 всегда. tsc чист.

## 3. Что делаем дальше (немедленно)

**GSL-100 (impl-ui-7)** — «[Docs] Приёмка Фазы 5: end-check (light/dark, file:// vs GitHub) + сводный dev_history + контракт site/». Задача 6 PRD-списка, закрывающая эпик. **F5-S4 буквально проверить**: «читается с телефона через приватный GitHub-репо» — GitHub не рендерит HTML из приватного репозитория как страницу, факт может быть raw/download; записать по факту, не подогнать формулировку. **Приёмка = ДОКАЗАТЕЛЬСТВО, не наблюдение** (урок Фазы 4 R4.2 → PENDING).

Оценка: ~40-90 мин (documentation + acceptance sweep, не сложный код).

**Затем без остановки** (owner mandate 2026-07-10, вписано в память): mechanic PR (открывает GH PR, транзиция GSL-90 → In Review) → reviewer → (fixer если найдёт CRITICAL/MAJOR) → finalizer (REGULAR merge, close issues, GSL-90 → Done, cleanup) → **Phase 6 Mobile setup** (эпик после GSL-90 в PRD).

## 4. Открытые проблемы (не блокеры, но передаю)

- **2 REAL DEBTS найдены impl-ui-6 self-health метрами** на живом репо: (1) **GSL-30 никогда не имел dev_history** (14 эпиков, 87 задач, ровно одна дыра, коммит 80b1e3f существует). Не Phase 5, старая фаза. Для owner'а. (2) **Handoffs 28/29 orphaned** — закрыл сам в 8258e30.
- **Ledger vs log naming gap** (impl-ui-5): 48 несопоставленных имён леджера — `gsl81-reviewer` в TELEMETRY vs `reviewer-lab` в логе. Fleet экран показывает 5/8 промахов и печатает несопоставленные имена. Process gap, не bug кода. Для owner'а.
- **9 безымянных сессий** — воркер не закрывший через task-систему не получает Fleet карточку. Process gap.
- **`task.completed` перестал стрелять после 12:54** (impl-ui-1 close). Циклы 53-57 не закрывались через task-систему; граница цикла = `pane.ended`.
- **Дефолты по таймеру не применяет никто** — только живой оркестратор на пульсе (impl-ui-2 finding). Ночь без пульса = defaults не срабатывают. Не UI-задача.
- **Token ceiling не существует машиночитаемо** (q-2026-07-13-002 auto-resolved к status quo). BUDGET_EXCEEDED не может файриться. Runway budget-час = unknown, runway = верхняя граница.
- **`api.failure` hook wired but never fired** — quota clock = `clear*` со звёздочкой.
- **smoke.sh:234 «stale temp survives»** — pre-existing flake (kill -9 race), до цикла 56. НЕ чинить.

## 5. Комментарии и уроки этой смены (важно для брифа impl-ui-7)

**Шесть накопленных уроков, каждый следующий воркер их наследует** (вписаны в брифы impl-ui-2 через impl-ui-6):

1. **Читай Jira description ПЕРВЫМ ТУЛОМ** (impl-ui-2/3 lesson, 2 раза подряд — половина acceptance была в description, не в брифе).
2. **Grep код чтобы проверить актуальность описания Jira** (impl-ui-4 lesson): описание — снимок намерения на момент написания, не ground truth. `build_timeline`/`build_library` не существовали к моменту GSL-97, а Jira требовало их удалить.
3. **«Нет источника» есть утверждение — проверяй руками, не наследуй** (impl-ui-3 lesson): impl-ui-1 записал «нет Jira→GH mapping» — прожило 2 цикла, impl-ui-3 нашёл через `gh issue list`. impl-ui-5 применил тот же принцип к C5 (нашёл strict exemption).
4. **⛔ НИКОГДА tree-wide git ops в общем дереве** (impl-ui-4 incident, memory `no-git-stash-in-shared-tree.md`): `git reset --hard`, `git stash push` (внутри = reset --hard), `git checkout -- .`, `git clean` — уничтожают чужую работу. Для сравнения → только `git worktree add /tmp/x <sha>`.
5. **⛔ Background restore-trap = tree-wide писатель** (impl-ui-5 incident): `trap restore EXIT` мутационного скрипта сработал ПОСЛЕ начала правки дерева, затёр фикстуру бэкапом. Тот же класс что git stash. Признак: счётчик тестов не вырос после добавления. Правило: `pgrep` подтвердить restore-процесс мёртв.
6. **🔥 Читай текст своей секции ВСЛУХ после зелёного smoke** (impl-ui-6 lesson): «0s old ago» прожил под 246 зелёными тестами (все ассертят механизм, ни один не читает по-английски). **Тест на прозу прогни против сломанной версии** (`git show <parent>:<file>`) — иначе проверил что не падает, а не что ловит.

**Про меня самого:** cold-started ~13:35Z сегодня после roll предыдущего оркестратора (impl-ui-1 прочитал МОЙ live heartbeat 76→78→80% = force-roll ceiling). Все воркеры этой смены = Opus 4.8, транскрипт-verified (session-id path → jsonl → поле `model`). Модель self-report врёт — сверять только по транскрипту (impl-ui-5 self-check 240/240, impl-ui-6 168/168).

**Стек:** shell hooks + Python data (chronicler.py = data layer) + TypeScript UI (Preact + preact-render-to-string + esbuild, SSG не SPA — `file://` не даёт fetch). Стек утверждён владельцем. Схема сейчас `render/7` (impl-ui-6 бампнул для self_health). Bump до /8 требует правки в 4 файлах разом (`chronicler.py`, `render.tsx`, `types.ts`, `smoke.sh`).

---

# ── Part 2 · Формально ──

## ⚠️ Железные правила (не ослаблять — накоплены handoff'ами 21-34 + инциденты 2026-07-13)

1. **Каждый turn кончается ТЕКСТОМ владельцу** после ВСЕХ tool calls. Stop-hook блокирует молчаливые turn'ы механически.
2. **Модели: ВСЕ агенты — Opus 4.8** (`model: opus` резолвится в 4.8). Сверять по транскрипту (`~/.claude/projects/-Users-.../<session-id>.jsonl`, поле `model`). Self-report врёт.
3. **NO Workflow tool.** Fleet cap 3.
4. **AUTONOMOUS mode** (owner mandate 2026-07-12 20:35): не останавливайся на кларификациях мелочей. DECISION-forks → typed queue record (`tools/lab/lab-emit.sh question`), продолжай. Только BLOCKER (denylist/credentials/irreversible) паркуется, и только affected task.
5. **REGULAR merge никогда squash. Никогда `git push --force`.** `gh api -X PUT` для merge (verb "gh pr merge" в VERBS hook писал бы дубликат; см. R4.2 addendum handoff 28).
6. **kill-pane только по явному id после re-list.** `-a` запрещён (killed live fleet 2026-07-07).
7. **⛔ НИКОГДА tree-wide git ops** в общем дереве: reset --hard, stash push, checkout -- ., clean. Для сравнения → `git worktree add /tmp/x <sha>`.
8. **⛔ Background restore-trap = tree-wide писатель.** `pgrep <script>` подтвердить restore-процесс мёртв.
9. **Hook shim обязателен** для новых bash-хуков (`tools/hooks/lab-log-hook.sh`, exit 0 always). Bare exit 2 в хуке = «заблокировать операцию» (impl-lab-1 инцидент 2026-07-12).
10. **`.claude/settings.json` подхватывается live** — правка = эффект без рестарта.
11. **`status.json` только через `tools/lab/lab-write.sh`** (atomic temp+rename).
12. **Дирти дерево между коммитами — норма** (`events/<today>.jsonl`, `queue.jsonl`, `ORCHESTRATION-STATE.md`, `.orchestrator-heartbeat` растут). НЕ «чинить».
13. **poll-fill — страховочная сетка, никогда не удалять**.
14. **Никогда `git add -A`** — пофайлово.
15. **`docs/prompts/`, `ORCHESTRATION-STATE.md`, `docs/lab/decisions/manifest.md`** — owner/orchestrator-sovereign. Воркеры не трогают.
16. **C5 денилист СЛОВ** (`tmux/spawn/Agent tool/teammate`), не файлов. Файл `chronicler.py` трогать можно (impl-ui-3/4/5/6 трогали). **impl-ui-5 explicit strict exemption**: только literal `teammate_name` разрешён, 3 CI-теста держат границу.
17. **Схема render/N — двусторонний контракт.** Рендерер бросает на незнакомой схеме. Bump — правка в 4 файлах одновременно.
18. **Queue state читай FOLD (`lab-emit.sh list`), не grep** по `"status"` — базовая запись всегда open, resolve — отдельная append-строка (impl-ui-4 lesson).
19. **Ассертить MECHANISM** (id/attr/isolation), не тень строки. Mutation — единственное доказательство что ассерт живой. Каждый ⭐ краснит РОВНО свой. Позитивный контроль на прозу.
20. **Print your glob** для пустых секций (impl-ui-4 pattern) — пустая полка ДОКАЗЫВАЕТ откуда искала.

## Connections

| | |
|---|---|
| Jira | project **GSL**, site `ainstance-labs.atlassian.net`, cloudId `74054cdc-47ef-497d-9684-734149876a8b` |
| Jira transitions | To Do=11, In Progress=21, In Review=31, **Done=41** |
| GitHub | `ainstance-labs/gosleep` (private) |
| Epic GSL-90 | = **GH #103** (issue, НЕ PR — GSL-90 не имеет PR ещё; mechanic откроет) |
| Owner accountId | `557058:83b04839-8bde-4331-9c2d-24843d0b8e67` (Roman L, rommxx@gmail.com) |
| Ветка | `GSL-90-ui-orchestration @ 8258e30` (запушена, tracking origin, 8 коммитов от main) |
| Local main | @ `5fd1de2` (= PR #102 merged, Phase 4 Laboratory) |
| Following Jira key | **GSL-102+** (GSL-101 = Phase 4 R4.2 fix закрыт); Phase 6 стартует с GSL-102 |
| Following GH number | **#115** (после #114 = GSL-101) |

## Gates (CI нет — руками)

- `bash tools/lab/smoke.sh` — сейчас **248/248**. Знай `smoke.sh:234` "stale temp survives" pre-existing flake (kill -9 race, до цикла 56, не чинить).
- `bash tools/lab/hooks-verify.sh` — 14/14 на живом процессе.
- `(cd tools/lab/ui && npx tsc --noEmit)` — чисто.
- `bash tools/lab/chronicler.sh --no-poll` — 7 страниц, всё well-formed.
- Схема сейчас `gosleep.lab.render/7`.

## Что есть в коде (короткая карта)

- `tools/lab/chronicler.py` — data layer (Python stdlib, 0 API keys). Реализует `load_events()`, `load_heartbeat()`, `fleet_workers()` с join по `session_id`, `session_models()` для модели по транскрипту, self-health метры.
- `tools/lab/chronicler.sh` — регенерация 7 страниц + status.json + morning digest.
- `tools/lab/ui/src/render.tsx` — TS/Preact SSG рендерер.
- `tools/lab/ui/src/screens/` — 7 экранов (overview, timeline, tasks, questions, fleet, cost, library).
- `tools/lab/ui/src/client.ts` — клиентский JS (staleness re-grade, countdown, tickCountdowns, tickAges, FilterBar/FilterCount/initFilters паттерн общий).
- `tools/lab/ui/src/countdown.ts` — общий SSR+client форматтер (`clock = max(now, generated_at)`).
- `tools/lab/ui/src/types.ts` — контракт схемы `gosleep.lab.render/7`.
- `tools/lab/smoke.sh` — 248 тестов, mutation-friendly assertions.
- `tools/hooks/` — 13 hooks + shim.
- `tools/lab/lab-emit.sh` — семантические события + question queue helper.
- `tools/lab/lab-write.sh` — atomic status.json writer.
- `.claude/settings.json` — hooks config, Stop-hook `stop-require-final-text.sh` blocking silent turns.

## ⭐ RESUME POINT — successor orchestrator

```bash
# Cold-start orient
cat docs/handoff/ORCHESTRATION-STATE.md | head -80  # LIVE-STATUS + At a glance
cat docs/handoff/35-2026-07-13-handoff-orchestrator-roll.md  # этот файл
cat docs/handoff/34-2026-07-13-handoff-impl-ui-6.md  # последний impl handoff, § RESUME для impl-ui-7
tail -5 docs/handoff/.orchestrator-heartbeat  # мой финальный status:"rolling"

# Reality sanity check
tmux list-panes -a | grep '^11:'  # должно быть только твоя pane
git log main --oneline -1  # 5fd1de2
git ls-remote origin GSL-90-ui-orchestration  # 8258e30
git status --porcelain | head 10  # owner-sovereign штатно
tools/lab/lab-emit.sh list --count  # open=3 (0B/3D/0C/0F), 0 BLOCKER

# ⚠️ FIRST HEARTBEAT (заканчивает watchdog startup grace)
hb="docs/handoff/.orchestrator-heartbeat"
line='{"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","cycle":59,"context_pct":<TWO_DIGITS>,"open_workers":0,"status":"ok","pane":"'"${TMUX_PANE}"'","note":"re-wake from handoff 35 orchestrator roll"}'
{ [ -f "$hb" ] && tail -n 199 "$hb"; printf '%s\n' "$line"; } > "$hb.tmp" && mv "$hb.tmp" "$hb"
```

**Первая задача — спавнить `impl-ui-7`** (Opus 4.8) на **GSL-100** (F5-S4 приёмка + сводный dev_history + контракт site/).

Что уже прочитано мной и передано (полностью в этом файле выше):
- **Jira `GSL-100` description** — три части: end-check (light/dark, file:// vs GitHub), dev_history (per-task + сводка Phase 5), site/README.md контракт (пере­писать «no JS» устарело).
- **F5-S4 буквально проверить**: приватный GitHub-репо не рендерит HTML как страницу; факт = raw/download; записать по факту.
- **Приёмка = ДОКАЗАТЕЛЬСТВО, не наблюдение** (урок Фазы 4 R4.2). Критерий, который нечем подтвердить = ⏳ PENDING с планом закрытия, а не ✅ по памяти.

**Бриф impl-ui-7** должен содержать все 6 накопленных уроков (см. Part 1 § 5 выше) + известные факты + правила + первые действия.

**После impl-ui-7 COMPLETE:**
1. Спавнить `mechanic-gsl90` (Opus 4.8) — открывает PR `GSL-90 <title>`, body `Implements GSL-90.` + Tasks checklist + `Mirrors #103.` + `Closes #103, #105..#113, #115.` (если ещё есть GH issues из моего orchestrator ledger commit). Транзиция GSL-90 → In Review (31).
2. Спавнить `reviewer-gsl90` (Opus 4.8) — off-tree review пинн'ится к SHA, 3-4 линзы, report в `docs/reviews/REVIEW-gsl90.md`. Если CRITICAL/MAJOR → fixer, если FIX/MERGE → finalizer.
3. Спавнить `finalizer-gsl90` (Opus 4.8) — REGULAR merge через `gh api -X PUT repos/ainstance-labs/gosleep/pulls/<N>/merge -f merge_method=merge` (verb "gh pr merge" не использовать), close оставшиеся GH issues вручную, транзиция GSL-90 → Done (41), удалить remote+local branch, `git fetch origin main:main` + оставаться на локальной ветке для леджера.
4. **Phase 6 Mobile SETUP без остановки** (owner mandate 2026-07-10 continue-at-milestone-boundaries). Стартует с GSL-102+, GH #115+. Прочитать PRD § «Фаза 6».

## Cumulative TELEMETRY (persistent across rolls — never reset)

- **cycles_completed ≈ 83** (from handoff 21 total ≈5464000 → сейчас **≈8066000**, delta моей смены ≈ 2600k tokens_out across 7 impl workers)
- **Гэпы flagged**: 2a/32/35/48-52/57-cache-write (see STATE TELEMETRY block detail)
- **Моя смена (cycles 53-58, impl-ui-1 через impl-ui-6)**:
  - cycle 53 impl-ui-1: ~461k out, 55M cache_read
  - cycle 54 impl-ui-2: 163k out, 11.8M cache_read
  - cycle 55 impl-ui-3: 245k out, 21.7M cache_read
  - cycle 56 impl-ui-4: 299k out, 29.9M cache_read
  - cycle 57 impl-ui-5: ~360k out estimate (TELEMETRY line не отдан в SendMessage — gap flagged), ~40M cache_read
  - cycle 58 impl-ui-6: 292k out, 51.1M cache_read
  - Sum моя смена: ~1820k out, ~210M cache_read
- Total ≈ 8066k tokens_out through 83 cycles + gaps flagged.

## Gotchas (унаследованные, не ослаблены)

- **`chronicler.py` C5 денилист СЛОВ** (`tmux/spawn/Agent tool/teammate`) — грепает smoke. impl-ui-5 explicit exemption: literal `teammate_name` разрешён + 3 CI-теста держат границу. Другие слова под запретом.
- **Схема `gosleep.lab.render/7`** — bump в 4 файлах разом (`chronicler.py`, `render.tsx`, `types.ts`, `smoke.sh`).
- **`docs/lab/site/` — DERIVED**. Не править руками; регенерация `chronicler.sh --no-poll`.
- **Коммит через heredoc хук не видит** — `git commit -F <файл>`.
- **`ORCHESTRATION-STATE.md`** лежит в `docs/handoff/`, но НЕ handoff. Хук `handoff.written` на неё стреляет ложно. impl-ui-6 исключил поимённо + M2 mutation краснит.
- **`task.completed` перестал стрелять после 12:54** — граница цикла = `pane.ended`.
- **Опечатки/дубли имён воркеров** между леджером и логом (48 промахов) — process gap.

## Blocked on human

**Нет.** Очередь `open=3 (0B/3D/0C/0F)`:
- `q-2026-07-13-001` — фреймворк UI, **дефолт применён** (Preact + esbuild), работает.
- `q-2026-07-13-004` — schema render/4 → /5 в GSL-97, **default applied**.
- `q-2026-07-13-005` — C5 exemption для literal `teammate_name`, **default applied strict**.

Все reversible high, работу не держат.

**Возможные вопросы для owner'а после Phase 5 close** (передаю, не эскалирую сам — не блокер):
- GSL-30 никогда не имел dev_history (16 фаз назад, старая дыра).
- Ledger vs log naming gap (48 несопоставленных имён — единая конвенция или явное поле).
- Дефолты по таймеру не применяет никто в ночь без пульса (impl-ui-2 finding).
- Token ceiling не машиночитаем (q-2026-07-13-002 auto-resolved к status quo).

**Owner directive 2026-07-12 20:35 IN FORCE**: AUTONOMOUS MODE — не останавливайся на кларификациях. Continue-at-milestone-boundaries на границе GSL-90 → GSL-102 без остановки.
