# Runbook — watchdog над оркестратором (операции для владельца)

**Что это.** Механический (без LLM) скрипт `tools/watchdog/watchdog.sh`. Он смотрит на пульс
оркестратора (`docs/handoff/.orchestrator-heartbeat`) и на **ростер платформы** — `claude agents
--json`, штатный машинный список живых сессий Claude Code (с v0.6 именно он источник истины о
жизни; tmux — только адрес действий и корроборация), — и по ним решает: всё хорошо / подтолкнуть /
оживить ту же сессию (`claude --resume`) / поднять свежего / остановиться и позвать вас.

**Два режима (v0.6, d-2026-07-28-001).** `WD_MODE=observe` — ПО УМОЛЧАНИЮ: всё дерево решений
работает, но каждое действие только ЗАПИСЫВАЕТСЯ в леджер как `would_*`; ничего не убивается,
не спавнится и не уведомляется. `WD_MODE=armed` — действия живые; включается ТОЛЬКО явной
строкой в вашем `watchdog.conf` (раздел 1) после наблюдательного прогона (раздел 0) и зелёного
`armed-check`. Раздвоение флота, найденное аудитом (F2), исключено конструктивно: личность
сессии едет в самом пульсе (`session`/`session_id`, пишет `tools/lab/heartbeat.sh` из ростера),
несовпадение = отказ от всех действий.

Версия, задокументированная здесь: **watchdog.sh v0.6.5** (эпик GSL-178; база — GSL-49,
PRD Phase 1, `docs/prd/PRD-gosleep-evolution.md`).

**Важно с v0.5.0 (review C1):** watchdog находит панель оркестратора ТОЛЬКО по полю
`"pane":"%N"` в heartbeat-строке (оркестратор сам называет себя через `$TMUX_PANE`).
Позиционного поиска («первая панель окна») больше нет — после смерти оркестратора первой
панелью обычно оказывается живой ВОРКЕР. Пульс без проверяемого `pane` при живой сессии =
watchdog ничего не трогает и эскалирует (см. `identity_unverified` в таблице §2).

**Компоненты:**

| Файл | Что делает |
|---|---|
| `tools/watchdog/watchdog.sh` | сам watchdog: один запуск = один «тик» (проверил → решил → записал) |
| `tools/watchdog/watchdog.conf.example` | все настройки с пояснениями; копируется в `watchdog.conf` (не коммитится) |
| `tools/watchdog/install-watchdog.sh` | рендерит launchd-plist и **печатает** команды установки; сам НИЧЕГО не устанавливает |
| `tools/watchdog/com.gosleep.watchdog.plist.template` | шаблон launchd-агента (заполняется рендером) |
| `tools/watchdog/smoke.sh` | самопроверка: все ветки решений в dry-run (168 проверок, v0.6.5) |
| `tools/watchdog/LEDGER.md` | спецификация формата журнала |
| `tools/lab/heartbeat.sh` | писатель пульса: сам вписывает `session`/`session_id`/`cli` из ростера (GSL-212/219) |
| `tools/lab/armed-check.sh` | reality-гейт (GSL-211): конфиг против живой машины; источник веб-плитки «вооружено» |
| `tools/lab/breaker-check.sh` | пункт HEARTBEAT_OK: читает строку `breaker=` из STATE (GSL-214) |
| `tools/lab/verifier-watch.sh` | поллер steps.log верификатора, реакция ≤3 мин (GSL-218) |

**Файлы, которые появляются в работе (все gitignored, не коммитятся):**

| Путь | Что это |
|---|---|
| `docs/handoff/.orchestrator-heartbeat` | пульс оркестратора: 1 JSON-строка на пульс, пишет оркестратор |
| `docs/handoff/.watchdog-ledger.jsonl` | журнал действий watchdog (append-only, никогда не очищается) |
| `.artifacts/watchdog/watchdog.log` | тик-лог: одна строка `DECISION=...` на каждый тик |
| `.artifacts/watchdog/launchd.out.log`, `launchd.err.log` | stdout/stderr от launchd |
| `.artifacts/watchdog/*.marker`, `*.count`, `restarts.history` | память между тиками (nudge, cooldown, бюджет рестартов) |
| `.artifacts/watchdog/reaps/*.txt` | reap-снапшоты: что происходило в момент kill |

---

## 0. Наблюдательный прогон (GSL-220) — то, что уже идёт само

Решение d-2026-07-28-001: несколько суток watchdog **тикает и записывает, ЧТО он сделал бы**,
при выключенных kill и re-wake; потом вы читаете леджер и решаете, вооружать ли по-настоящему.

**Носитель — мотор тика (q-2026-07-28-006):** `tools/lab/tick.sh` на каждом проходе делает один
watchdog-тик в ПРИНУДИТЕЛЬНОМ observe (шаг 4b) — леджер копится с первого тика любого носителя
(launchd-плист тика, Desktop-задача, ручной запуск), без единого действия с вашей стороны.
Тик-носитель наблюдает всегда; действовать может только собственный plist сторожа (раздел 1).

**Читать утром (все команды read-only):**

```bash
cd /Users/romanlidovskyi/Documents/dev/harness/gosleep
# решения за ночь одной строкой на тик (decision + class + основание):
grep '"event":"tick"' docs/handoff/.watchdog-ledger.jsonl | tail -20 | jq -r '[.ts,.class,.decision,.reason]|@tsv'
# что сторож СДЕЛАЛ БЫ (лестница would_*):
grep -E '"would_' docs/handoff/.watchdog-ledger.jsonl | jq .
# сводка классов за всю историю:
grep '"event":"tick"' docs/handoff/.watchdog-ledger.jsonl | sed -nE 's/.*"class":"([a-z]+)".*/\1/p' | sort | uniq -c
```

Трекаемая копия для истории — `docs/lab/supervision/watchdog-ledger.jsonl` (архиватор GSL-225).

**Критерий «прогон состоялся» (приёмка эпика):** леджер за трое суток подряд, в каждой
tick-строке решение и основание, ни одного события `kill` / `orchestrator_restarted` /
`orchestrator_resumed` с `mode:"observe"` (только `would_*`).

**Что смотреть перед вооружением:** частоту ложных `would_nudge` на owner-standby (лечится
объявлением standby как `quiesced` в пульсе, не порогами), эпизоды `progress_frozen` против
реальности, `session_mismatch`/`platform_unknown` (должны быть нулём при живом флоте), сработал
бы ли RestartBudget. Затем — раздел 1.

---

## 1. Установка (= вооружение; шаги владельца)

### Шаг 1 — конфиг (делаете один раз)

```bash
cd /Users/romanlidovskyi/Documents/dev/harness/gosleep
cp tools/watchdog/watchdog.conf.example tools/watchdog/watchdog.conf
```

Откройте `tools/watchdog/watchdog.conf` и раскомментируйте минимум три значения:

- `WD_MODE="armed"` — **сам акт вооружения** (v0.6): без этой строки watchdog в любом запуске
  только наблюдает. Ставить её — только после прочитанного наблюдательного леджера (раздел 0)
  и зелёного `bash tools/lab/armed-check.sh`;
- `WD_TMUX_SESSION` — имя tmux-сессии для окна re-wake (жизнь judged по ростеру, это только
  адрес спавна);
- `WD_TMUX_BIN="/opt/homebrew/bin/tmux"` — **абсолютный** путь до tmux: launchd запускает скрипт
  с минимальным PATH и без этого не найдёт tmux (watchdog тогда откажется стартовать — см. §7.4).

Перед вооружением снесите наблюдательную память, чтобы would-история не смешалась с боевой
(память mode-scoped, это гигиена, не необходимость): `rm -rf .artifacts/watchdog/observe`.

`watchdog.conf` — локальная настройка машины, в git не добавлять.

### Шаг 2 — рендер plist (безопасно, ничего не ставит)

```bash
tools/watchdog/install-watchdog.sh
```

Скрипт подставит пути этого репозитория и интервал (по умолчанию 180 с; можно
`--interval 120..300`) и положит готовый plist в `.artifacts/watchdog/com.gosleep.watchdog.plist`.
Реальный вывод (проверен запуском):

```text
Rendered: .artifacts/watchdog/com.gosleep.watchdog.plist  (interval 180s)

This script has NOT installed anything. To install (OWNER decision — runbook GSL-57):
  # 1. Put the rendered plist in place:
  cp ".artifacts/watchdog/com.gosleep.watchdog.plist" ~/Library/LaunchAgents/com.gosleep.watchdog.plist
  # 2. Load it (modern launchctl):
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.gosleep.watchdog.plist
  ...
```

### Шаг 3 — включение (⚠️ выполняет ВЛАДЕЛЕЦ, вручную)

Ни один скрипт и ни один агент в этом репозитории не запускает `launchctl` — это ваше решение.
Точные команды:

```bash
# 1. Положить plist на место:
cp "/Users/romanlidovskyi/Documents/dev/harness/gosleep/.artifacts/watchdog/com.gosleep.watchdog.plist" \
   ~/Library/LaunchAgents/com.gosleep.watchdog.plist

# 2. Загрузить агент:
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.gosleep.watchdog.plist

# 3. (не обязательно) форсировать первый тик прямо сейчас:
launchctl kickstart gui/$(id -u)/com.gosleep.watchdog
```

После `bootstrap` launchd сам запускает тик каждые 180 секунд и переживает перезагрузку Mac.

---

## 2. Как проверить, что watchdog работает

Три уровня проверки, все команды read-only:

**а) launchd видит агента:**

```bash
launchctl print gui/$(id -u)/com.gosleep.watchdog | head -20
```

Если агент НЕ установлен, вы увидите `Could not find service "com.gosleep.watchdog"` — это
нормальный ответ до шага 3 установки.

**б) тики идут** — в тик-логе появляется строка на каждый запуск:

```bash
tail -5 /Users/romanlidovskyi/Documents/dev/harness/gosleep/.artifacts/watchdog/watchdog.log
```

Здоровая строка выглядит так (реальный вывод):

```text
2026-07-10T05:56:12Z DECISION=ok reason=fresh_heartbeat_live_session hb_age=8 hb_status=ok ctx=41 workers=2 dry_run=0
```

Частые значения `DECISION` (полный список веток — в шапке `watchdog.sh`):

| DECISION | Значение |
|---|---|
| `ok` | пульс свежий, сессия жива — ничего не делал |
| `ok_grace` | сессия только что стартовала, стаж пульса не судится (warm-up ~120 с) |
| `ok_quiesced` | оркестратор сам завершил цепочку (`status:"quiesced"`) — рестартов не будет |
| `nudged` / `waiting_nudge` | пульс протух → отправил напоминание, ждёт реакции (лестница GSL-216, ступень 1) |
| `kill_resume` / `waiting_resume` / `resume` | ступень 2 лестницы (v0.6.3): та же сессия оживляется на месте через `claude --resume <session_id>` — контекст цел; существует только когда пульс назвал свой `session_id` (GSL-212); `resume` — оживление мёртвой сессии без kill. Тратит общий бюджет рестартов |
| `zombie_watch` | панель жива, а процесса агента под ней нет — считает циклы (kill после 3 подряд) |
| `handoff_requested` / `waiting_handoff` | контекст ≥ потолка → велел писать handoff |
| `kill_rewake` | убил зависшего (по явному id панели) и поднял свежего через cold-start |
| `rewake` | сессия умерла целиком → поднял свежего без kill |
| `kill_deferred` | kill отложен: cooldown ≥5 мин между force-kill |
| `identity_unverified` | сессия жива, но пульс не несёт проверяемого id панели оркестратора (поле `pane` отсутствует/битое/панели уже нет) — watchdog отказывается наджить/убивать наугад и эскалирует (v0.5.0, review C1) |
| `kill_failed` | kill не сработал (rc≠0 или панель пережила kill) — эскалация, БЕЗ re-wake: живая старая панель + свежий оркестратор = двойной диспатч (v0.5.0, review M2) |
| `mass_death` / `escalated` | системный сбой или исчерпан бюджет — рестартов НЕТ, зовёт вас (§4) |

**в) пульс оркестратора свежий:**

```bash
cd /Users/romanlidovskyi/Documents/dev/harness/gosleep
tail -1 docs/handoff/.orchestrator-heartbeat        # последняя JSON-строка пульса
stat -f '%Sm' docs/handoff/.orchestrator-heartbeat  # время последней записи
# возраст пульса в секундах (протухание = 3900 с по умолчанию, v0.6.4 —
# пороги согласованы с измеренной каденцией, GSL-217):
echo $(( $(date +%s) - $(stat -f %m docs/handoff/.orchestrator-heartbeat) ))
```

В последней строке должно быть поле `"pane":"%N"` — id панели самого оркестратора
(обязательно с v0.5.0: без него watchdog не может безопасно адресовать nudge/kill).

Если файла нет — оркестратор ещё ни разу не запускался с heartbeat-протоколом (GSL-51), либо
цепочка не идёт. Для watchdog «нет файла + мёртвая сессия» = поднять оркестратора; «нет файла +
живая свежая сессия» = warm-up grace; «нет файла (или нет поля `pane`) + живая сессия после
grace» = `identity_unverified` → эскалация, никаких действий вслепую.

---

## 2а. Классы состояния — матрица ZFC (GSL-215)

С v0.6.2 каждый тик несёт вычисленный **класс** состояния оркестратора (поле `class` в строке
`tick` леджера и в тик-логе). Матрица — заимствование ZFC из overstory (Zombie / Frozen /
Crashed), натянутое на наш контур: жизнь судится по ростеру платформы (`claude agents --json`,
GSL-212), прогресс — по детектору заморозки (GSL-213), tmux — только корроборация.

**Уклон сознательно false-negative:** неоднозначность всегда сводится к более мягкому классу —
лучше пропустить залипание на один тик, чем убить живого оркестратора.

| Класс | Сигналы | Реакция |
|---|---|---|
| `healthy` | сессия в ростере; пульс свежий и молодой (< `WD_HB_SLOW_SECS`); счётчики двигаются | никакой |
| `slow` | сессия в ростере; пульс свежий, но старше `WD_HB_SLOW_SECS` (по умолчанию stale/2), ЛИБО свежий-но-замороженный (F: `progress_frozen`, GSL-213) | **только запись** — по конструкции: зона slow лежит строго ниже порога протухания, где дерево решений и так бездействует; инвариант `slow < stale` проверяется на старте (exit 78) |
| `stuck` | сессия в ростере, пульс протух (write-divergence; зомби-панель — Z — живёт здесь же) | лестница вмешательств (GSL-216); в observe — только `would_*` |
| `dead` | ростер не видит ни одной нашей сессии нигде (C) | путь re-wake (в observe — `would_rewake`) |
| `shielded` | заявленный стенд-даун: `status:"quiesced"` (обе формы) или `rolling` при свежем пульсе | никакой — это не отказ |
| `unknown` | ростер не читается (`platform_unknown`) или заявленная сессия не совпала при живых сессиях в репо (`session_mismatch`) | отказ от действий + эскалация; никогда не действие |

Прочитать классы за ночь одной командой:

```bash
grep '"event":"tick"' docs/handoff/.watchdog-ledger.jsonl | sed -nE 's/.*"class":"([a-z]+)".*/\1/p' | sort | uniq -c
```

---

## 3. Как читать watchdog-ledger

`docs/handoff/.watchdog-ledger.jsonl` — журнал всех действий watchdog. Одна JSON-строка = одно
событие; файл только дописывается, никогда не переписывается. Полная спецификация —
`tools/watchdog/LEDGER.md`. Читать удобно так:

```bash
tail -10 docs/handoff/.watchdog-ledger.jsonl | jq .   # или просто tail, если без jq
```

Примеры записей и что они означают:

```json
{"ts":"2026-07-10T05:55:54Z","event":"nudge","target":"%4","reason":"stale_heartbeat","hb_age":10554,"dry_run":1}
```
→ пульс протух (возраст 10554 с > порога) при живой панели `%4`; watchdog отправил в неё
напоминание «запиши heartbeat сейчас». Kill'а ещё не было. (`dry_run:1` = запись от тестового
прогона, для истории её игнорируют; у боевых записей `dry_run:0`.)

```json
{"ts":"...","event":"reap","role":"orchestrator","target":"%4","reason":"stale_after_nudge","branch":"GSL-49-orchestrator-watchdog","head":"322cf30","snapshot":"/…/.artifacts/watchdog/reaps/1783948631-orchestrator.txt","dry_run":0}
{"ts":"...","event":"kill","target":"%4","reason":"stale_after_nudge","dry_run":0}
{"ts":"...","event":"orchestrator_restarted","reason":"stale_after_nudge","hb_age":1350,"open_workers":2,"cycle":12,"dry_run":0}
```
→ полный цикл рестарта. Порядок гарантирован: сначала `reap` (ПЕРЕД kill'ом собран снапшот:
ветка, HEAD, хвост пульса, содержимое панели — файл по пути из `snapshot`), потом `kill`
(только по явному id `%N`, никогда `-a`), потом `orchestrator_restarted` — свежий оркестратор
поднят через cold-start и должен ре-присоединить живых воркеров, не пере-спавнить. Закоммиченная
работа не теряется: ветка и SHA зафиксированы в самой записи `reap`.

```json
{"ts":"...","event":"escalation","reason":"restart budget exhausted (…)","restarts_in_window":3,"budget":3,"window_secs":3600,"dry_run":0}
```
→ бюджет рестартов исчерпан (3 за 60 мин по умолчанию). Watchdog **перестал** рестартить —
«never mask an orchestrator bug with a restart loop» — и позвал вас. Что делать — §4.

```json
{"ts":"...","event":"mass_death","open_workers":2,"reason":"whole_session_gone","dry_run":0}
{"ts":"...","event":"worker_died","count":2,"reason":"whole_session_gone","observed":"heartbeat_vs_tmux","dry_run":0}
```
→ пропала ЦЕЛАЯ tmux-сессия, в которой по последнему пульсу было ≥2 живых воркеров. Это похоже
на системный сбой (умер tmux-сервер, ребут, сон Mac), поэтому watchdog НЕ рестартит вслепую —
только фиксирует смерть воркеров и эскалирует.

Ещё встречаются: `handoff_requested` (контекст ≥ потолка, велено писать handoff);
`kill_refused` (цель не прошла проверку — либо не явный id `%N`, либо
`reason=identity_unverified`: пульс не назвал панель оркестратора или её уже нет —
никакое действие не выполнено, следом идёт `escalation`); `kill_failed` (kill выполнен,
но rc≠0 или панель пережила его — re-wake ОТМЕНЁН, следом `escalation`; защита от двух
живых оркестраторов); `rewake_brief_missing` (warning: шаблон re-wake-brief.md не найден,
использован встроенный fallback-промпт). Полный список — `tools/watchdog/LEDGER.md`.

---

## 4. Эскалации — как выглядят и что делать

Эскалация = watchdog решил, что автоматика дальше опасна. Происходит в двух случаях:
исчерпан бюджет рестартов ИЛИ mass-death. Повторная эскалация — не чаще раза в час, пока
проблема сохраняется.

**Как выглядит:**
1. macOS-уведомление с заголовком **«gosleep watchdog»** (через osascript);
2. строка `event:"escalation"` в ledger + строка `ESCALATION: ...` в `watchdog.log`;
3. если в конфиге задан `WD_ESCALATE_HOOK` (свой исполняемый файл — задел под push на телефон,
   Фаза 6) — он вызывается с текстом эскалации.

**Что делать (по порядку):**

```bash
cd /Users/romanlidovskyi/Documents/dev/harness/gosleep
tail -20 .artifacts/watchdog/watchdog.log            # что решал watchdog в последние тики
tail -10 docs/handoff/.watchdog-ledger.jsonl | jq .  # его действия + причины
ls -t .artifacts/watchdog/reaps/ | head -3            # свежие reap-снапшоты
cat .artifacts/watchdog/reaps/<самый-свежий>.txt      # состояние в момент смерти
tmux attach -t gosleep                                # посмотреть на флот глазами
```

Дальше — руками: понять, ПОЧЕМУ оркестратор умирал (снапшот + `docs/handoff/ORCHESTRATION-STATE.md`
это обычно показывают), устранить причину, и запустить оркестратора самостоятельно (обычный
cold-start по скиллу `orchestrating-delivery-agents`). Watchdog сам возобновит рестарты, когда
скользящее окно (60 мин) освободится; чтобы разрешить их немедленно после починки:

```bash
rm .artifacts/watchdog/restarts.history .artifacts/watchdog/escalated.marker
```

**Важно:** не удаляйте счётчик, не поняв причину, — иначе watchdog снова будет биться в ту же
стену все 3 рестарта.

---

## 5. Как приостановить или выключить

Маркер-файла паузы в v0.4.0 нет — пауза делается через launchd (⚠️ команды выполняет владелец):

```bash
# Пауза (выгрузить агента; plist остаётся на месте):
launchctl bootout gui/$(id -u)/com.gosleep.watchdog

# Возобновить после паузы:
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.gosleep.watchdog.plist

# Полная деинсталляция:
launchctl bootout gui/$(id -u)/com.gosleep.watchdog
rm ~/Library/LaunchAgents/com.gosleep.watchdog.plist
```

Два смежных способа «выключить», о которых стоит знать:
- если оркестратор завершил цепочку правильно (последний пульс `status:"quiesced"`,
  `open_workers:0`) — watchdog и так ничего не рестартит, выгружать его не обязательно;
- runtime-хвосты (`.artifacts/watchdog/`, `docs/handoff/.watchdog-*`) можно удалять после
  деинсталляции — в git они не попадают.

---

## 6. Самопроверка (safe, ничего не трогает)

```bash
tools/watchdog/smoke.sh
```

Прогоняет все ветки решений в dry-run без tmux и без kill'ов. Ожидаемый финал (реальный вывод):
`RESULT: 65 passed, 0 failed`. Артефакты — в `.artifacts/watchdog-smoke/` (gitignored).

Диагностический тик против живой установки — ТОЛЬКО так (иначе dry-run съест боевые
маркеры/бюджет; см. NOTE в `watchdog.conf.example`):

```bash
WD_STATE_DIR=/tmp/wd-scratch WD_LEDGER_FILE=/tmp/wd-scratch/ledger.jsonl \
  tools/watchdog/watchdog.sh --dry-run
```

---

## 7. Troubleshooting

### 7.1 Пульс протух, а оркестратор жив

Так бывает: оркестратор занят длинным ходом и не начал следующий пульс, или забыл писать
heartbeat первым актом. Это штатная ситуация для watchdog — он НЕ убивает сразу:
сначала `nudge` (напоминание прямо в панель), затем ждёт `WD_NUDGE_GRACE_SECS` (240 с),
и только если пульс так и не обновился — kill + re-wake. В тик-логе это видно как
`DECISION=nudged` → `waiting_nudge` → (`ok` если очнулся | `kill_rewake` если нет).
Ничего делать не нужно; если nudge'и повторяются каждый час — оркестратор систематически
нарушает heartbeat-протокол, стоит сказать ему об этом или проверить скилл (GSL-51).

### 7.2 Zombie-панель (панель есть, агента в ней нет)

Признак: `DECISION=zombie_watch reason=zombie_1_of_3` в тик-логе. Watchdog помечает zombie
только после **3 последовательных** тиков (защита от ложняков: во время handoff'ов сигналы
расходятся). После 3-го цикла — обычный kill + re-wake с reap-записью. Если zombie ловится
регулярно, посмотрите reap-снапшот: чем панель была занята перед смертью процесса.

### 7.3 «Бюджет исчерпан» / рестарты не происходят

Признаки: уведомление «gosleep watchdog», `event:"escalation"` в ledger, в тик-логе
`DECISION=escalated reason=restart_budget_exhausted(3/3):...`. Это НЕ поломка watchdog —
это его главная защита: три рестарта за окно не помогли, значит, четвёртый тоже не поможет.
Действия — §4 (диагноз → починка → при необходимости сброс `restarts.history`).

### 7.4 Watchdog вообще не тикает / конфиг-фейл (exit 78)

Watchdog проверяет конфиг при каждом старте и при ЛЮБОЙ ошибке отказывается работать —
громко, кодом 78, ничего не проверив (тихо мис-armed watchdog хуже отсутствующего).
Реальный вывод (проверен запуском):

```text
watchdog: FATAL CONFIG ERROR: WD_HB_STALE_SECS must be a non-negative integer, got: 'oops'
watchdog: refusing to arm with invalid config (a mis-armed watchdog is worse than none).
```

Где искать: `tail .artifacts/watchdog/launchd.err.log`. Самая частая причина под launchd —
не найден tmux (минимальный PATH): пропишите `WD_TMUX_BIN` абсолютным путём в `watchdog.conf`.
После правки конфига ничего перезапускать не надо — следующий тик подхватит.
Проверить конфиг руками: `tools/watchdog/watchdog.sh --dry-run` (см. §6 про scratch-режим) —
код возврата 0 = конфиг валиден.

### 7.5 Тик-лог говорит `rate-limited` или `another watchdog tick is running`

Норма. Watchdog сам себя ограничивает: не чаще одного тика в `WD_MIN_TICK_INTERVAL_SECS` (60 с)
и строго один тик одновременно (single-flight lock; протухший lock от упавшего тика крадётся
через 15 мин). Так и задумано — например, ручной запуск сразу после launchd-тика честно выйдет.

### 7.6 Mac уснул — и всё остановилось

macOS sleep ставит на паузу И watchdog, И флот (известный риск, PRD Phase 1). Варианты: держать
машину бодрой на ночной прогон (`caffeinate -i -t 28800` = 8 часов) или принять, что сон = пауза
всего; после пробуждения launchd продолжает тики сам. Отдельный случай: после ребута/смерти
tmux-сервера первый тик увидит «сессия пропала с N воркеров» → это mass-death (§3), watchdog
эскалирует, а не рестартит вслепую — так и должно быть.

---

## 8. Ограничения (честно)

- **Live end-check (F1-S1) не проводился.** Все ветки решений проверены smoke-харнессом в
  dry-run (65 сценариев), но настоящий ночной прогон «убить панель оркестратора при 2 живых
  воркерах → watchdog поднимает свежего → воркеры ре-присоединены, не задублированы → после
  3-го рестарта эскалация» ещё не выполнялся. **Первая реальная сработка требует пригляда:**
  запланируйте её на вечер, когда можете посматривать в `tmux attach` и тик-лог.
- Re-wake поднимает свежий интерактивный `claude` в окне `orchestrator` — это единственное
  обращение watchdog к claude; самих LLM-вызовов в скрипте ноль (проверяется smoke-гейтом).
- `WD_ESCALATE_HOOK` (push на телефон и т.п.) — пока только точка расширения; из коробки
  эскалация = macOS-уведомление + ledger.
- Контекстная ветка по умолчанию ВЫКЛЮЧЕНА (`WD_CONTEXT_CEILING_PCT=100`, v0.6.4/GSL-217):
  `context_pct` — самооценка модели о доле ИЗРАСХОДОВАННОГО окна (медиана на живых данных 93,
  максимум 98), харнесс сжимает контекст сам, а правило владельца запрещает ролл по самооценке.
  Значение пишется в каждую tick-строку для истории; включение (≤99) — только когда GSL-182
  даст реальный сигнал харнесса.
