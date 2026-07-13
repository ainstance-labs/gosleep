# Handoff — gosleep — 2026-07-12 (Phase 4 impl 5/8 done; fresh orchestrator for impl-lab-3 → mechanic → reviewer → finalizer)

> ДЛЯ FRESH ОРКЕСТРАТОРА. Читай: Part 1 → ⚠️ Hard rules → ⭐ RESUME POINT. Ground truth = `docs/handoff/ORCHESTRATION-STATE.md` (первым) + этот файл. Supersedes handoffs 21/22/23/24. Автономный режим по приказу владельца — не останавливайся на мелочах.

# ── Part 1 · Простыми словами ──

## 1. Где мы
Phase 4 «Laboratory» (auto-doc) — **5/8 задач landed на ветке `GSL-81-laboratory-auto-doc` @ `101836c`** (пушнута, PR НЕ открыт). Готово: GSL-82 ledger + GSL-83 hooks/lab-log + GSL-84 lab-emit semantic + GSL-85 docs/lab layout + GSL-86 chronicler + GSL-87 poll-fill. Осталось 3 шага: GSL-88 + GSL-89 (маленький impl цикл) → mechanic PR → reviewer → (fixer) → finalizer merge. Jira: эпик GSL-81 In Progress, GSL-82..87 Done, GSL-88..89 To Do.

## 2. Что произошло
Владелец 2026-07-12 ~20:35 приказал: «Другой агент делает spawn opus 4.8 и просто работает и не останавливается постоянно. Давай решаем задачи и не останавливаемся. Переходи в автономный режим.» После этого — три цикла подряд без пауз: gsl81-setup (эпик + 8 задач + ветка + ledger) → impl-lab-1 (GSL-83..85, hooks 13/13 live-verified на headless Claude Code 2.1.207) → impl-lab-2 (GSL-86 chronicler + GSL-87 poll-fill). Модели транскрипт-verified: **все Opus 4.8**. Утренний приказ «все на 4.7» отменён этим сообщением; `model: opus` в Agent tool резолвится в 4.8 (проверено на всех 4 циклах).

## 3. Что делаем дальше
Спавнить **impl-lab-3** на Opus 4.8 сразу — маленький цикл (GSL-88 = одна строка `lab-emit handoff.written` в `skill/handoff/SKILL.md` + `./install.sh`; GSL-89 = dev_history Phase 4 summary + generated-at/staleness contract doc + добавить `--ts` и `--supersedes` флаги в `tools/lab/lab-log.sh`, чтобы poll-fill вставлял бэкфилл в правильную точку таймлайна). После — mechanic worker (открывает PR), reviewer, fixer если нужно, finalizer (merge REGULAR, close #94..#101, Jira Done, delete remote branch, `git fetch main:main` без checkout — ledger не трогать). После Phase 4 merge — **без остановки Phase 5 UI** (owner mandate continue-at-milestone-boundaries).

## 4. Проблемы / известные ловушки
- **⚠️ КРИТИЧЕСКАЯ находка cycle 46:** PostToolUse hook в текущей версии `tools/lab/lab-log.sh` **тихо промазал 2 коммита** (heredoc внутри command substitution → парсер потерял `git commit`; коммит записан с пустым sha). **Лог выглядел полным и врал.** Оба факта восстановил poll-fill (GSL-87). **poll-fill — единственная защита; НИКОГДА не удаляй.** Парсер сознательно НЕ чинили в текущем цикле: `.claude/settings.json` live-watched (правка = live effect), а exit 2 = block operations (урок cycle 45 — недописанный скрипт заблокировал каждый Write/Edit).
- **DECISION в очереди `q-2026-07-12-001`** (chronicler LLM-narration mode — `--narrate` под `--max-budget-usd` с пустым `--allowedTools`). **Автоприменение default (deterministic skeleton) 2026-07-13 08:00.** Владелец может возразить утром через `tools/lab/lab-emit.sh answer --re q-2026-07-12-001 --answer …`. Проверь на morning boundary.
- **Дерево грязное между коммитами — норма** (`docs/lab/events/<today>.jsonl` растёт при каждом коммите; правило «porcelain=1 после ledger» УСТАРЕЛО). Механику/финализатору знать.
- Handoff 24 (impl-lab-2) + этот handoff 25 — untracked ledger; уйдут в следующий ledger-commit (Phase 5 setup).

## 5. Комментарии
- **Владелец нетерпелив с паузами.** Автономный режим строго: кларификации только по BLOCKER'у (denylist, credentials, irreversible). DECISION-fork'и → typed queue record с default + продолжаем.
- **Каждый спавн/стоп объяснять коротко** в тексте владельцу (почему этот воркер, почему сейчас, почему эта модель).
- **Отвечать на каждое сообщение владельца** (даже если оно раздражённое — не молчать).
- **Каждый turn заканчивается ТЕКСТОМ владельцу** (после всех tool calls). Правило спасло проект дважды (2026-07-10 инциденты видимости). Stop-hook `tools/hooks/stop-require-final-text.sh` блокирует молчаливые ходы.
- **Модель воркера verify по транскрипту**, не по self-report. Cycle 40 fixer self-report'нул fable-5, был opus-4-8 по jsonl. Cycle 43 finalizer verify'ем поймал 4-8 (владелец в тот момент требовал 4.7 — вот тогда всплыла ловушка `model: opus` → 4.8).
- **События dogfooding:** слой auto-doc записывает сам себя. F4-S1 — runnable jq запрос: `jq -r 'select(.src|startswith("hook:"))|.type' docs/lab/events/2026-07-12.jsonl`.

# ── Part 2 · Формально ──

## ⚠️ Hard rules (нарушение первого = немедленная остановка проекта)

1. **КАЖДЫЙ turn заканчивается ТЕКСТОМ владельцу — после ВСЕХ tool calls, ноль tool calls после текста.** Любой tool result (в т.ч. `ScheduleWakeup` «Nothing more to do this turn») — НЕ разрешение закончить turn. Двух предшественников это правило не спасло — оно спасает только привычкой: последний акт = текст. Stop-hook (`.claude/settings.json` → `tools/hooks/stop-require-final-text.sh`) подстрахует.
2. **Все агенты + оркестратор = Opus 4.8** (`model: opus`, транскрипт-verified). Owner-approved 2026-07-12 20:35. Проверяй модель каждого воркера по его jsonl (`grep '"model"' ~/.claude/projects/.../<UUID>.jsonl`).
3. **Автономный режим:** reversible in-repo delivery без вопросов. DECISION-fork'и → typed queue record с default + продолжаем. BLOCKED_ON_HUMAN блокирует ТОЛЬКО ту задачу, не флот. Denylist (force-push, deletes shared, prod deploy, secrets rotation, destructive DB, external comms) → BLOCKED.
4. **NO Workflow tool.** Все спавны = tmux teammates через `Agent(subagent_type:"claude", name:"...", model:"opus")`. Fleet cap 3 (четвёртая падает `fork failed: Device not configured`).
5. **REGULAR merge никогда squash. `git push` никогда `--force`.**
6. **kill-pane только по явному id после re-list.** Никогда `-a`. tmux сессии кроме 11:0 (моя) — чужие проекты (V4 orchestrator в 10, tasty-lunch в 5, etc — не трогать).
7. **Hook shim обязателен** для новых bash-хуков (`tools/hooks/lab-log-hook.sh`, exit 0 always). Bare exit 2 в хуке = «заблокировать операцию» → syntax error = exit 2 → блокирует Write/Edit во всём флоте.
8. **`.claude/settings.json` подхватывается live** — правка = live effect без restart.
9. **Дирти дерево между коммитами — норма** (`docs/lab/events/<today>.jsonl` растёт). Ledger boundary compacts.
10. **`status.json` только через `tools/lab/lab-write.sh`** (atomic hidden-temp + rename; kill-9 survival в smoke).
11. **Ownable questions** → typed record через `tools/lab/lab-emit.sh question --type <T> --from <cycle> --task <KEY> --question "..." --default "..." --reversibility high|med`. Continue on default if type ≤ DECISION. Park только BLOCKER, только affected task.
12. **HARD GATE перед roll'ом:** confirm EVERY worker TERMINATED. Никогда не ролить с живым воркером — orphan.

## How we work (skills)
- `orchestrating-delivery-agents` (main methodology, PULSE cadence, HEARTBEAT_OK, question buffer, decision manifest, morning digest, quota auto-wait, breaker, re-wake).
- `delivery-workflow` + `using-jira` — Epic+Task, `[Tag]` summaries, key-first commits/branches, one PR per Epic REGULAR merge, GH issues mirror Jira.
- `handoff` skill — write handoff at session boundary, `NN-YYYY-MM-DD-...md`.
- Cycle-worker template в `~/.claude/skills/orchestrating-delivery-agents/references/worker-cycle-template.md`.

## Connections
| | |
|---|---|
| Jira project | **GSL**, site `ainstance-labs.atlassian.net`, cloudId `74054cdc-47ef-497d-9684-734149876a8b` |
| Jira transitions | To Do=11, In Progress=21, In Review=31, Done=41 |
| GitHub | `ainstance-labs/gosleep` (private) |
| Owner accountId | `557058:83b04839-8bde-4331-9c2d-24843d0b8e67` (assign every issue) |
| Owner email | rommxx@gmail.com |
| Branch | `GSL-81-laboratory-auto-doc` @ **`101836c`** (pushed, PR НЕ открыт) |
| Local main | @ `4af66d2` (post-GSL-72 merge) |
| Local HEAD | остался на GSL-72-question-buffer (не был удалён — там ledger) — impl-lab-3 сам checkout'ит нужную ветку |
| Next Jira key | **GSL-88**, **GSL-89** (Phase 4 remaining); **GSL-90+** Phase 5 |
| Next GH issue | **#102** (Epic GSL-81=#93, Tasks GSL-82..89=#94..#101) |

## Gates
- No CI.
- `./install.sh` если тронул `skill/` (source of truth в `skill/`, sync local → global; глобальная копия должна быть identical).
- Smoke (cycle 46 baseline: 105/105 tests + hooks-verify 13/13).
- Manual verification: real-run hooks after edit; `jq . docs/lab/status.json` parseable; poll-fill idempotency (`bash tools/lab/poll-fill.sh; bash tools/lab/poll-fill.sh` → второй прогон 0 новых строк).

## What exists in code (post-cycle 46)
Merged into main (past epics):
- Phase 1 (GSL-49) watchdog `tools/watchdog/*`, `.watchdog-*`.
- Phase 2 (GSL-65) pulse + night mode + quota-wait + breaker + HEARTBEAT_OK fast-path.
- Phase 3 (GSL-72) question buffer + decision manifest + `tools/lab/lab-emit.sh` + Stop-hook + `tools/hooks/stop-require-final-text.sh`.

On branch `GSL-81-laboratory-auto-doc` (Phase 4 in-flight):
- `tools/hooks/lab-log-hook.sh` — shim, exit 0 always (protects from block-on-error).
- `tools/lab/lab-log.sh` — 0-token event capture (append `events/<date>.jsonl` atomically), called through shim.
- `tools/lab/lab-emit.sh` (extended) — semantic events layer over Phase 3 queue.
- `tools/lab/lab-write.sh` — atomic writer (kill-9 survives; ONLY writer for status.json).
- `tools/lab/chronicler.sh` + `.py` — regen site/{index,timeline,library}.html + digest + status.json (0.7s pass, self-contained file://).
- `tools/lab/poll-fill.sh` + `.py` — event gap filler; runs as step 0 of chronicler; tagged `src="poll-fill"`.
- `docs/lab/README.md` — layout + retention (45 days for events, then compacted) + staleness contract.
- `docs/lab/events/README.md` — schema + provenance table + honest hook status (which fire, which lie).
- `docs/lab/events/2026-07-12.jsonl` — today's events, committed as artifact in GSL-87 (first time on-tree).
- `docs/lab/schemas/*.md` — event schemas.
- `docs/lab/digest/2026-07-12-morning.md` — уже сгенерирован smoke chronicler'а.
- `docs/dev_history/GSL-82..87-*.md` + updated README index.

Untracked ledger (waits for next ledger commit):
- `docs/handoff/22-*.md`, `docs/handoff/23-*.md`, `docs/handoff/24-*.md`, `docs/handoff/25-*.md` (этот файл), плюс мои STATE-редакты, плюс `docs/prompts/2-*.md` (owner-sovereign, НЕ коммитить).

## ⭐ Immediate next steps (RESUME POINT)

### Первое действие: сверить реальность
```
tmux list-panes -a -F '#{session_name}:#{window_index}.#{pane_index} #{pane_id} #{pane_current_command}' | grep '^11:'   # моя pane должна быть одна
git rev-parse --abbrev-ref HEAD                       # локально может быть GSL-72-question-buffer — не критично, impl-lab-3 checkout'ит
git log main --oneline -1                             # 4af66d2
git ls-remote origin GSL-81-laboratory-auto-doc       # 101836c
gh pr list --state open                               # пусто (PR открывает mechanic)
mcp__atlassian__searchJiraIssuesUsingJql project=GSL AND key in (GSL-88, GSL-89)  # обе To Do
tools/lab/lab-emit.sh list                            # должна показать q-2026-07-12-001
```

### 1. Spawn impl-lab-3 (cycle 47, Opus 4.8)
- Cycle name: **impl-lab-3**, `subagent_type: "claude"`, `model: "opus"`.
- Two tasks — small cycle (~15-30 мин):
  - **GSL-88**: добавить в `skill/handoff/SKILL.md` (в шаге write handoff) одну строку — вызов `tools/lab/lab-emit.sh` с типом `handoff.written` (event schema — в `docs/lab/schemas/`). После правки: `./install.sh` из корня; verify `diff -r skill/handoff/ ~/.claude/skills/handoff/` пуст.
  - **GSL-89**: (a) dev_history summary Phase 4 в `docs/dev_history/GSL-89-phase4-cycle47-staleness-contract.md`; (b) doc generated-at / staleness contract (уже реализован в chronicler, надо задокументировать в docs/lab/README.md если ещё не); (c) добавить `--ts <ISO>` и `--supersedes <id>` в `tools/lab/lab-log.sh` для бэкфилла (poll-fill нужно точно вставлять по timeline).
- Commits: `GSL-88 [Skill] handoff.written event emit line + install`; `GSL-89 [Docs][Tooling] dev_history Phase 4 + staleness contract + --ts/--supersedes lab-log`.
- Handoff `docs/handoff/26-2026-07-12-handoff-impl-lab-3.md`.
- Jira: обе → Done.

### 2. Spawn mechanic (cycle 48, Opus 4.8, чистая механика)
- Verify branch pushed, все commits на месте.
- `gh pr create --title "GSL-81 [Repo][Tooling] Фаза 4 — Laboratory (auto-doc)" --body "$(cat <<'EOF'
Implements GSL-81.

Tasks:
- [x] GSL-82 [Docs] Леджер (#94) @ 9a056bb
- [x] GSL-83 [Tooling] hooks + lab-log.sh (#95) @ 2e33632
- [x] GSL-84 [Tooling] lab-emit semantic events (#96) @ b0599db
- [x] GSL-85 [Docs] docs/lab layout (#97) @ e9a1ccc
- [x] GSL-86 [Docs][Tooling] chronicler (#98) @ 3f52736
- [x] GSL-87 [Tooling] poll-fill (#99) @ 101836c
- [x] GSL-88 [Skill] handoff.written event line (#100) @ <SHA>
- [x] GSL-89 [Docs][Tooling] dev_history + staleness contract + --ts/--supersedes (#101) @ <SHA>

Gates: smoke 105/105 (impl-lab-2 baseline; impl-lab-3 to re-run), hooks-verify 13/13 live, status.json valid, docs/lab/events log committed as artifact.

Mirrors GH #93.
Closes #93, #94, #95, #96, #97, #98, #99, #100, #101.
EOF
)"`
- Jira epic → In Review (21→31).
- Verify PR CLEAN (`gh pr view <N> --json mergeStateStatus` == CLEAN).
- Report ≤12 lines.

### 3. Spawn reviewer (cycle 49, Opus 4.8, off-tree ревью)
Читает pushed diff off-tree (`git show <SHA>` для каждого коммита). Проверяет:
- Gates green (smoke, hooks-verify).
- Правила cycle 45/46 соблюдены (shim, live-watched settings, dirty-tree norm, status.json only via lab-write).
- Provenance-таблица в events/README честна (какой хук что пишет).
- Retention реализована (chronicler cleaner работает по README-политике).
- poll-fill idempotency + tagging (`src="poll-fill"`).
- DECISION q-2026-07-12-001 фиксирован правильно.
- Stop-hook первый в hooks-цепочке и не сломан.
- `skill/handoff/SKILL.md` изменён только по GSL-88; глобальная копия identical.

Пишет `docs/reviews/REVIEW-gsl81.md` с CRITICAL/MAJOR/MINOR + вердикт FIX / MERGE.
Report ≤12 lines.

### 4. Если FIX → spawn fixer (cycle 50, Opus 4.8)
Применяет findings + `./install.sh` если skill/ тронут + push. Re-verify PR CLEAN.

### 5. Spawn finalizer (cycle 50 или 51, Opus 4.8, чистая механика)
- `gh pr merge <N> --merge` (REGULAR).
- Close #94..#101 individually (`Closes` auto-closes только #93).
- Jira GSL-81 → Done (transition 41).
- `git push origin --delete GSL-81-laboratory-auto-doc`.
- `git fetch origin main:main` (FF local main, БЕЗ checkout).
- **Не трогать локальный ledger** (STATE + handoffs 22/23/24/25/26 + docs/prompts/2-*.md + любой untracked).
- Verify: `gh pr view <N> --json state` == MERGED; все 9 issues CLOSED; Jira Done; remote branch gone; local main advanced.

### 6. Phase 5 UI setup (cycle ~52, Opus 4.8) — БЕЗ ОСТАНОВКИ
Owner mandate continue-at-milestone-boundaries.
- Прочитать PRD Phase 5 UI (`docs/prd/PRD-gosleep-evolution.md`).
- Спавнить `gsl<N>-setup` — epic + tasks + branch + **ledger-commit первой задачей** (в ledger попадут STATE + все накопленные handoffs 22..27 + updated SKILL если что + любые untracked owner-approved files; **docs/prompts/2-*.md НЕ коммитить**).
- Дальше конвейер impl → mechanic → reviewer → (fixer) → finalizer.

## Gotchas (absorb before spawning)
1. **poll-fill = safety net; НИКОГДА не удаляй.** Hooks silently lie on heredoc/command-substitution mishaps (GSL-86 и GSL-82 SHA'ы — оба ложно записаны пустыми в первом проходе; восстановил poll-fill).
2. **DECISION q-2026-07-12-001** — chronicler LLM-narration `--narrate`. Автоприменение default 2026-07-13 08:00. Владелец может возразить утром.
3. **TeammateIdle DOES work** (в cycle 45 handoff 23 было записано «untested/degraded» — оказалось fires; TaskCreated/TaskCompleted тоже). Обнови ожидания.
4. **events/2026-07-12.jsonl committed** в GSL-87 (первый раз on-tree как artifact — доказательство работы poll-fill'а). Дальнейшие дни: коммитятся на ledger boundaries.
5. **Handoff 24 + этот handoff 25 — untracked ledger** до следующего ledger-commit.
6. **`git status --porcelain | wc -l`** сейчас ~15-17 (штатно после cycle 46 push): docs/prompts + docs/handoff/22/23/24/25 + docs/lab/events/2026-07-12.jsonl (частично трекнут, растёт) + мои STATE-edits (untracked изменения не должны быть — STATE в дереве изменён). Финализатор не трогает.
7. **Финализатор GSL-72** был transcript-verified 4-8 при действующем приказе «все на 4.7» — работа не пострадала (чистая механика). Владелец потом разрешил 4.8 как норму.
8. **Handoff 21 §Hard-rule-2 «ALL agents = Opus 4.8»** — устарел, потом снова стал верным. STATE Standing rules отражает актуальную политику.

## Blocked on human
- **q-2026-07-12-001** DECISION (chronicler --narrate); автоприменение default 2026-07-13 08:00.
- Иначе — none.

## Telemetry (cumulative — не сбрасывать, продолжать)
~76 cycles, running total ≈ **6.166M tokens**. Гэпы 2a/32/35 задокументированы в STATE. Cycle 46 добавил ~95k out.

## Модельная политика (IN FORCE)
Owner 2026-07-12 20:35: «Другой агент делает spawn opus 4.8 и просто работает и не останавливается постоянно. Давай решаем задачи и не останавливаемся. Переходи в автономный режим.» → **все агенты + оркестратор = Opus 4.8**. `model: opus` в Agent tool резолвится в **claude-opus-4-8** (транскрипт-verified в циклах 43/44/45/46 без пропусков). Утренний приказ 4.7 (~14:00) отменён.

## Session boundary discipline
Финальный heartbeat перед exit: `status:"rolling"` (успешник ожидается), `open_workers:0`. НЕ армить `ScheduleWakeup` — armed wake-up после rolling запустит старую сессию параллельно с новой (два оркестратора). Финальный owner-visible TEXT — последним. Fresh orchestrator запускается вручную владельцем со STATE + этим файлом.
