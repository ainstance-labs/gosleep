---
name: tmux-agents-orchestration
description: Практические правила управления tmux panes при оркестрации Agent tool воркеров — определение среды, spawn/kill lifecycle воркеров, лимиты сессии, cleanup протокол. Использовать при любой оркестраторской работе с teammate-агентами в tmux. Родилось из инцидента 2026-07-13 (16 idle panes оставлены живыми после SendMessage release → tmux fork failed при 17-м spawn).
---

# tmux-agents-orchestration

Практический skill для оркестратора, работающего с Agent-teammate воркерами внутри tmux. **Расширяет `orchestrating-delivery-agents`** конкретными командами и ловушками tmux.

## 1. Определение среды — первый шаг любой оркестраторской сессии

```bash
# Проверка что я в tmux вообще
if [ -z "$TMUX" ]; then
  echo "NOT_IN_TMUX — оркестраторский протокол tmux-panes не применим"
  exit 0
fi

# Мой pane id — записать в heartbeat
echo "TMUX_PANE=$TMUX_PANE"

# Мой session + window + pane — один запрос
tmux display-message -p '#{session_id} #{session_name} #{window_id} #{pane_id} #{pane_index}'
```

- `$TMUX_PANE` — форматом `%N` (например `%181`). **Стабильный ID для всей жизни pane.**
- Запиши его в heartbeat поле `"pane"` — watchdog / преемник по нему идентифицирует тебя.
- **НИКОГДА не guess'ай себя позицией** (первая pane и т.д.). При твоей смерти «первая pane» — это, скорее всего, воркер, не ты.

## 2. Инвентарь panes

```bash
# Быстро — только id из моей session
tmux list-panes -t "$(tmux display-message -p '#{session_id}')" -F '#{pane_id}'

# С деталями
tmux list-panes -t <session> -F \
  '#{pane_index}: #{pane_id} pid=#{pane_pid} dead=#{pane_dead} title=#{pane_title}'

# Все sessions разом (для аудита — использовать редко)
tmux list-panes -a -F '#{session_name}:#{window_index}.#{pane_index} #{pane_id} #{pane_title}'
```

Поля:
- `#{pane_id}` — `%N`, стабильный.
- `#{pane_pid}` — PID процесса (обычно `zsh` или `claude`).
- `#{pane_title}` — устанавливается клиентом. У Agent-teammate обычно `✳ general-purpose` или `⠐/⠂ <task>` (busy-state символы). **Не надёжно** для идентификации по имени.
- `#{pane_dead}` — `1` если процесс завершился, но pane ещё висит (редко).

**Всегда `-t <session>`, не `-a`.** `-a` даст panes из чужих sessions (терминалы владельца, другие оркестраторы) — риск случайного kill.

## 3. Spawn воркера — Agent tool ↔ tmux pane

`Agent` tool с `subagent_type: general-purpose` в tmux-среде **автоматически создаёт новый pane** в текущей session и запускает там clone claude-агента. Ты не выбираешь номер pane — tmux назначает.

**Лимит panes на session:** обычно ~16 одновременных. При превышении Agent tool падает с:

```
Failed to send command to pane %NNN: respawn pane failed: fork failed: Device not configured
```

Это **жёсткий отказ**. Воркер не спавнится, agent_id не возвращается.

**Правило перед каждым spawn (проактивный check):**
```bash
n=$(tmux list-panes -t <session> | wc -l | tr -d ' ')
if [ "$n" -ge 14 ]; then
  echo "PANE_LIMIT_APPROACHING ($n/16) — kill idle воркеров сначала"
fi
```

Если ≥14 — сначала kill idle-freed воркеров (section 4/6), потом spawn.

## 4. **КРИТИЧЕСКОЕ ЗНАНИЕ**: SendMessage «свободен» НЕ закрывает pane

Урок, который родил этот skill:

- Отправка `SendMessage {content: "ты свободен"}` → доставляет сообщение агенту.
- Агент, получив release, идёт в idle-режим (перестаёт активно работать).
- **Pane остаётся живым.** Процесс `claude` в pane тоже.

Через N таких release'ов (у меня было 16) — сессия под лимитом panes, следующий `Agent` spawn падает.

**Правильный cleanup после release:**

### A. Мягкий (graceful shutdown) — предпочтительно для чистоты
```json
SendMessage → {"type":"shutdown_request","reason":"work delivered, cleanup"}
```
Агент отвечает `{"type":"shutdown_response","approve":true}` на своей следующей turn boundary и exit'ся. Pane помечается dead, tmux подметает (или добей `tmux kill-pane` для чистоты списка).

### B. Жёсткий (kill-pane) — быстро для idle
```bash
tmux kill-pane -t %<pane_id>
```
Мгновенно. Процесс убит SIGKILL, pane исчезает.

**Когда что:**
- Воркер сдал COMPLETE + PR смёржен + ты отправил thanks → **B** (быстро, экономит контекст).
- Воркер MID-CYCLE и ты хочешь остановить → **A** (chance на graceful save state).
- **НИКОГДА kill-pane активного mid-cycle воркера** — orphan-риск (потерянная работа).

## 5. Трекинг pane_id ↔ worker_name

**Проблема:** Agent tool возвращает `agent_id: <name>@session-<uuid>`, SendMessage работает по `name`. Но `pane_id` (tmux) ↔ `name` (Agent) — **явной связи не видно**.

**Практика — записывать в state сразу после spawn:**
```
worker=dev-tlm400 pane=%215 spawned=2026-07-13T09:30Z task=TLM-400
worker=dev-tlm377 pane=%217 spawned=2026-07-13T09:31Z task=TLM-377
...
```

**Как узнать pane_id только что созданного воркера:**
```bash
# Сразу после Agent tool вызова
tmux list-panes -t <session> -F '#{pane_id} #{pane_pid} #{pane_title}' | tail -1
```
Обычно последний в списке — только что созданный. Не 100%, но hint.

**Или** заранее до spawn'а фиксируй `count_before`, после — `count_after`, разница = новый pane.

## 6. Kill-протокол — правила безопасности

### НЕ убивай:
- **Свой pane** (`$TMUX_PANE`) — суицид сессии, оркестратор внезапно умрёт.
- **Pane активного воркера** (mid-cycle без COMPLETE) — orphan-риск.
- **Pane неизвестного назначения** (нет в state) — может быть чужой оркестратор или user's terminal с работой.

### Убивай:
- **Idle-freed воркеры** — уже сдали COMPLETE, отправлен release.
- **Zombie воркеры** — title `✳ general-purpose` но >30 мин молчания И их нет в state.
- Всегда `-t <session>`, никогда `-a`.

### Batch cleanup — pattern «убить всех кроме меня в моей session»
```bash
tmux list-panes -t <session> -F '#{pane_id}' \
  | grep -v "^${TMUX_PANE}$" \
  | while read p; do tmux kill-pane -t "$p"; done
```

Использовать когда:
- Все воркеры idle-freed, готовимся к продолжению работы или handoff.
- **Перед session boundary** (roll/handoff) — свежий оркестратор не унаследует зомби.

## 7. Cleanup протокол после merge PR

**Обязательный порядок после каждого merged PR:**
```bash
# 1. Merge через gh
gh pr merge NNN --merge --delete-branch
# 2. Если знаешь pane_id воркера из state:
tmux kill-pane -t %<pane_id>          # мгновенно освобождает pane
# 3. Cleanup git worktree + локальный branch
git worktree remove ../<worktree-name> --force
git branch -D <branch-name>
```

**Порядок:** kill-pane **после** merge (воркер уже отчитался в COMPLETE), **до** `worktree remove` (если конфликт — можно ещё написать воркеру, но актуально редко).

## 8. Ловушки

- **⚠️ ПУСТОЙ idle-notification после активной работы = ОБЯЗАТЕЛЬНО capture-pane.** Инцидент 2026-07-13: dev-tlm170 отправил полноценный COMPLETE-отчёт с тремя требованиями к владельцу (verify Resend domain, положить `RESEND_API_KEY` в Vercel + Trigger.dev env, применить миграцию 0034). **Harness доставил оркестратору пустой idle-notification без summary/content.** Оркестратор решил что это turn boundary и не проверил дальше — три требования владельца потерялись. **Правило**: при любом idle-notification без summary после активной работы (worker недавно писал код, открывал PR и т.д.) — **немедленно** `tmux capture-pane -t %<pane> -p | tail -80`. COMPLETE / BLOCKER / вопрос владельцу могут быть только в pane content. Никогда не считать «пустой notification» = «нечего сказать».
- **idle_notification после kill-pane**: агент мог отправить в пути → приходит после kill. Игнорируй как noise (это исключение к предыдущему правилу — pane уже мёртв, capture-pane бесполезен).
- **`tmux list-panes -a` vs `-t <session>`**: `-a` = ВСЕ sessions (включая окна владельца и другие оркестраторы). Всегда указывай `-t <моя session>`.
- **Fork failure vs message-timeout**: разные симптомы:
  - Fork failure → tmux/OS лимит → `kill-pane` idle воркеров помогает.
  - Message-timeout → агент застрял → `shutdown_request` (мягко) или `kill-pane` (жёстко, если >30 мин молчания).
- **Ложное `pane_dead=1`**: pane помечен dead, но не удалён. `tmux kill-pane` явно решает.
- **`pane_title` — busy-state символы** (`⠐/⠂/⠁/⠈/✳`) — визуальный индикатор активности, не идентификатор. Меняется у одного pane много раз в секунду.
- **Race при быстром spawn+list**: между `Agent` вызовом и `tmux list-panes` — иногда tmux ещё не создал pane. Дай 100–200 ms или проверь по `count_before != count_after`.
- **kill-pane за пределами session**: `tmux kill-pane -t %<id>` без `-t <session>` в некоторых версиях убивает pane по глобальному id — безопасно, но привыкай указывать session при list.

## 9. Handoff / roll — обязательный tmux-аудит

**Перед `heartbeat status:"rolling"` (session boundary):**

```bash
sess=$(tmux display-message -p '#{session_id}')
tmux list-panes -t "$sess" -F '#{pane_id} #{pane_pid} #{pane_title}'
```

Если ≥ 2 panes (кроме твоей `$TMUX_PANE`) → **Действия:**

1. **Убить всех** через batch pattern (section 6) — свежий оркестратор с пустой сессией не унаследует зомби. Рекомендуется по умолчанию.
2. **Или упомянуть в handoff файле:**
   - Список pane_id → worker_name → task_id.
   - Что они «в idle, могут быть переиспользованы через SendMessage».
   - Риск: их контекст устарел, лучше kill и спавнить свежих.

## 10. Мини-чеклист (для каждого пульса оркестратора)

1. **`$TMUX_PANE` записан в heartbeat?** (`"pane": "%NNN"`).
2. **`tmux list-panes -t <session> | wc -l`** — не приближаемся к лимиту (>14)?
3. **State ↔ tmux match?** Все pane_id в state есть в live panes? (проверка периодически, не каждый пульс — 1–2 раза за цикл).
4. **Idle-released воркеры** убиты (kill-pane) или сохранены с явной причиной?

## Связанное

- **Родительский skill:** `orchestrating-delivery-agents` — общие правила оркестратора, spawn/handoff/state file, cadence, breaker.
- **Инцидент, породивший skill:** 2026-07-13 — 16 idle-released воркеров оставили panes живыми, tmux fork failed при попытке спавнить 17-го (dev-tlm379 недельная полоса). Владелец увидел «огромное количество агентов» в session 10 и попросил разобраться. Полный контекст в handoff #115 проекта `tasty-lunch`.
