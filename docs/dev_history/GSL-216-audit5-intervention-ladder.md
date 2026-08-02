# GSL-216 — Лестница nudge → resume → restart с backoff, RestartBudget и аудитом попыток

Эпик GSL-178 (аудит 2026-07-24, эпик 5 «Супервизия»). Смена 74, исполнитель impl-178.

## What was done

Между «напомнить» и «убить и поднять свежего» появилась средняя ступень: **оживить ту же самую
сессию** через `claude --resume <session_id>` — процесс новый, мозг тот же, контекст цел.
Лестница целиком: ступень 1 — nudge (send-keys в панель); ступень 2 — kill + resume той же
сессии (после `WD_NUDGE_GRACE_SECS`); ступень 3 — kill + cold-start рестарт свежего оркестратора
из handoff (после `WD_RESUME_GRACE_SECS`). Для мёртвой сессии (ростер пуст) — сначала resume без
kill, cold-start только если оживление не взялось. Обе спавнящие ступени проходят через ОДИН
`do_restart`-гейт: общий RestartBudget, общий экспоненциальный backoff, kill-cooldown, и каждая
попытка журналируется с номером (`attempt=N` в `orchestrator_resumed` / `orchestrator_restarted`
/ `would_*`). В наблюдательном режиме вся лестница только записывается (`would_resume` и т.д.),
ничего не спавнится. Заимствования: 5dive (ступенчатость), warren (RestartBudget «never mask an
orchestrator bug with a restart loop» — теперь и resume-loop).

## Problems solved

- **Совместимость без ветвления истории**: ступень 2 существует только когда пульс назвал свой
  `session_id` (поле GSL-212) — легаси-пульс деградирует к исторической двухступенчатой лестнице
  ПО КОНСТРУКЦИИ. Ни одно из 30+ легаси-ожиданий смоука не изменилось; единственная правка —
  мой же кейс GSL-212 `roster-dead-observe` (его фикстура несёт session_id и теперь честно идёт
  через resume; рядом добавлен legacy-парный кейс).
- **Бюджет общий по построению**: resume и restart оба идут через record_restart в одном окне —
  исчерпанный бюджет блокирует resume так же, как restart (кейс ladder-budget-shared).
- **Эпизодная память**: маркер resume-attempt отделяет «уже пробовали оживить» от «ещё не
  нуджили»; свежий пульс закрывает эпизод (маркер чистится вместе с nudge).

## Problems remaining

- `claude --resume <sid>` в бою не исполнялся (armed-ветка); семантика проверена только на
  уровне конструкции лаунчера + observe-записей. Первое боевое оживление — после вооружения
  владельцем, под приглядом (то же ограничение, что у re-wake с GSL-49).
- Resume оживлённой сессии стартует интерактивный `claude` без стартового промпта — расчёт на
  то, что возобновлённый оркестратор продолжит по своему транскрипту; если он молчит, ступень 3
  добьёт через grace. Наблюдательный прогон покажет, как часто ступень 2 была бы достаточной.

## Pitfalls & workarounds

- Порядок веток в 5c важен: resume-attempt проверяется РАНЬШЕ nudge-маркера — иначе после
  оживления сторож снова нуджил бы вместо ожидания resume-grace.
- В dead-ветке resume выбирается только при отсутствии resume-attempt маркера — второй мёртвый
  тик после неудавшегося оживления идёт в cold-start (и чистит маркер).
- `attempt` читается ПОСЛЕ record_restart — номер попытки в журнале равен позиции в окне
  бюджета, а не «сколько было до».
- В observe act_resume пишет resume-attempt, но НЕ last-started — оживления не было, grace не
  положен (тот же принцип, что у would_rewake в GSL-212).

## What didn't make it

- Отдельная конфигурация «сколько resume-попыток до cold-start» — сознательно нет: одна
  resume-попытка на эпизод, дальше ступень 3; больше состояний = больше способов зависнуть
  самой лестнице.

## Technical reference

- **Files:** `tools/watchdog/watchdog.sh` (v0.6.3: act_resume, do_restart(pane, rung),
  WD_RESUME_GRACE_SECS, ветка 5c-лестница, dead-ветка с выбором ступени, attempt в журнале);
  `tools/watchdog/smoke.sh` (125→137: пять ladder-кейсов + legacy-пара dead);
  `tools/watchdog/LEDGER.md` (orchestrator_resumed / would_resume / attempt);
  `tools/watchdog/watchdog.conf.example`; `docs/runbooks/watchdog.md` (строки DECISION).
- **Verified by running:** смоук 137/0 — синтетический зависший оркестратор проходит все три
  ступени в правильном порядке (nudged → kill_resume → kill_rewake), между ступенями ждёт
  grace, исчерпанный RestartBudget останавливает лестницу с записью причины (escalation),
  каждая попытка несёт attempt. Гейт GSL-203: smoke 545/0, hooks 19, tsc 0, chronicler fresh.
- **Links:** Jira GSL-216, GH #216, эпик GSL-178/#178; находки 4, 6 (обе MAJOR);
  заимствования 5dive/warren (rivals-findings).
