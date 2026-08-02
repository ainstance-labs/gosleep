# Handoff — gosleep — 2026-08-02 (итог смены 74: четыре эпика; передача оркестрации на Opus 4.7)

> Для НОВОГО оркестратора (ожидаемо на Opus 4.7). Читай Part 1 → Part 2 → RESUME.
> Supersedes handoff 53 (промежуточный) и 54 (worker impl-178). Ground truth = ORCHESTRATION-STATE.md.

# ── Part 1 · Простыми словами ──

## 1. Где мы

Смена 74 (28 июля — 2 августа, с пятидневным простоем подписки посередине) закрыла ЧЕТЫРЕ эпика
плана аудита из восьми: гигиена лаборатории (GSL-175), потолок токенов (GSL-179), мотор внешнего
тика (GSL-176) и наблюдательный супервизор (GSL-178). Все слиты обычными мержами — PR #252, #253,
#254, #255; ledger-цепочка из пяти коммитов, последний 8b23ffb. Смоук вырос с 452 до 545 (плюс
отдельный смоук сторожа 75→168), гейт стал одной командой `gate.sh` и по умолчанию сверяется с
трекером. Watchdog live: идёт наблюдательный прогон, боевые строки пишутся в трекаемый архив.

Незаблокированной работы не осталось: всё упирается в решения владельца (кто правит скиллы q-002;
разрешения агентов q-003; вооружение сторожа после трёх суток прогона; дата контрольной ночи;
состав GSL-181 — проверить).

## 2. Модели — как теперь устроено

Оркестратор смены 74 — Fable 5 (лимиты на исходе — потому и передача). Воркеры получают модель из
`CLAUDE_CODE_SUBAGENT_MODEL=claude-opus-4-7` в ~/.claude/settings.json владельца — проверено
транскриптом finalizer-178 (первый воркер на конфиге). Параметр model в Agent tool на этой
поверхности НЕ работает (наследование, доказано трижды); модель воркера сверять ТОЛЬКО по
транскрипту (self-report врёт — finalizer-178 назвал себя «4.5», был 4-7).

## 3. Что чинили в процессе (важно для преемника)

Болезнь «немой ход»: ответ ScheduleWakeup («Nothing more to do…»), прочитанный последним,
обрывает ход до финального текста владельцу. По команде владельца поправлены глобальный скилл
orchestrating-delivery-agents (Turn order: heartbeat → wakeup ВТОРЫМ → пробы → текст; HARD
COROLLARY «ScheduleWakeup никогда не последний tool-вызов»; worked example; Quick reference) и
память wakeup-first-text-last. Также в скилл внесена эррата GSL-178 (heartbeat-протокол: писатель
tools/lab/heartbeat.sh, поля session/session_id/cli, пункт breaker-check, verifier-watch.sh).
Проверено грепами. Stop-hook по-прежнему стоит и ловит нарушения.

## 4. Проблемы и хвосты

- tools/lab/heartbeat.sh не имеет бита +x (запускать `bash tools/lab/heartbeat.sh …`) — чинится
  в ledger части 6 этой смены.
- Панели %28 (impl-178-2) и %44 (finalizer-178) живы-idle по приказу владельца «не терминировать»;
  новый оркестратор их НЕ наследует как рабочих — они отработали; спросить владельца про чистку.
- Токены finalizer-178 не отданы харнессом — в TELEMETRY оценка по аналогии, gap flagged.

## 5. Комментарии

Владелец активен и отвечает быстро; правки скиллов сегодня шли по его прямым командам (прецедент
q-002 залогирован d-2026-08-02-004, сам BLOCKER открыт). apply-due работает в бою. Дебаунс-хук
жив и сам держит бандл свежим — при гонке с полным гейтом бывает транзиентная краснота smoke,
одиночный повторный прогон честен (урок GSL-218).

# ── Part 2 · Формально ──

## Hard rules
Полный свод — Standing rules в ORCHESTRATION-STATE.md (читать ПЕРВЫМ). Ключевое смены: гейт =
`bash tools/lab/gate.sh` (GSL-203); бандл grade!=fresh не коммитить молча (GSL-194); лимиты
токенов настраиваемые + unlimited (d-007); пульс heartbeat→wakeup ВТОРЫМ→пробы→ТЕКСТ последним;
«handoff», не «батон»; воркеры Opus 4.7 конфигом; NO Workflow (ask-first); REGULAR merge; closes
перед каждым номером; sovereign не трогать; мобильное/push на паузе.

## Connections
Jira GSL, cloudId 74054cdc-47ef-497d-9684-734149876a8b, транзиции 11/21/31/41 · GitHub
ainstance-labs/gosleep · владелец Roman L, accountId 557058:83b04839-8bde-4331-9c2d-24843d0b8e67 ·
main @ 8b23ffb (+ ledger часть 6 сверху) · скиллы глобальные ~/.claude/skills/ (5 шт).

## Gates (база main)
`bash tools/lab/gate.sh` — smoke 545/545 FAIL=0 · hooks-verify 19 · tsc 0 · chronicler С опросом
(фид docs/lab/scratch/jira-poll.json по чек-листу GSL-223). Watchdog smoke: `bash
tools/watchdog/smoke.sh` 168/0. Проверка breaker-строки STATE: `bash tools/lab/breaker-check.sh`.

## Очередь и решения
open=2: q-2026-07-24-002 BLOCKER (кто правит скиллы; прецедент d-2026-08-02-004),
q-2026-07-24-003 BLOCKER (разрешения агентов). Решения смены: d-2026-07-28-001…016 +
d-2026-08-02-001…005 в docs/lab/decisions/log.jsonl.

## TELEMETRY (нарастающий итог)
cycles_completed=151, total≈19 462 000 tokens_out (+исторические гэпы — см. STATE). Смена 74:
10 воркеров (8 отработали, 1 ранний kill по d-011, финализатор-178 первый на Opus 4.7).

## RESUME POINT — новый оркестратор (Opus 4.7)
1. Cold start по скиллу: 5 глобальных скиллов → ORCHESTRATION-STATE.md (At a glance, LIVE-STATUS,
   Standing rules, строки cli=/breaker= над TELEMETRY) → этот handoff.
2. Sanity: tmux list-panes (своя панель; %28/%44 — отработавшие idle по приказу владельца) ·
   git log origin/main -1 (8b23ffb или новее) · gh pr list --state open (пусто) ·
   tools/lab/lab-emit.sh list --count (open=2 2B) · bash tools/lab/lab-emit.sh apply-due ·
   bash tools/lab/breaker-check.sh.
3. Пульс: `bash tools/lab/heartbeat.sh --cycle 153 --context-pct N --open-workers N --status ok`
   ПЕРВЫМ актом каждого хода; ScheduleWakeup ВТОРЫМ; пробы; ТЕКСТ владельцу последним.
4. Работы без владельца НЕТ — спросить владельца, что дальше: ответы на q-002/q-003 разблокируют
   GSL-174/GSL-180; GSL-181 — проверить состав в Jira; через ~3 суток наблюдательного прогона —
   отчёт по runbooks/watchdog.md раздел 0 и решение о вооружении; дата контрольной ночи за
   владельцем (всё для preflight готово: вечер preflight-arm.sh / утро tick-preflight-report.sh).
5. Мерж-цепочки эпиков — по образцу finalizer-176/178 в логе STATE (merge regular → зеркала →
   Jira Done → граница цикла GSL-223 → ledger).

## Gotchas
- Модель воркера — только по транскрипту (grep '"model"' по ~/.claude/projects/.../\*.jsonl,
  файл искать по фразе брифа). Ответ ScheduleWakeup — ловушка. Пустой idle-notification живого
  воркера = обязательный capture-pane; после kill — шум. Тесты lab-emit только под
  GOSLEEP_LAB_DIR. chronicler.py запускает main() при импорте. Handoff'ы воркеров коммитит ledger.
- Не роллиться по самооценке context_pct (правило владельца) — только по реальному сигналу.

## Blocked on the human
1. q-2026-07-24-002 — кто и как правит скиллы (GSL-174).
2. q-2026-07-24-003 — разрешения агентов (GSL-180).
3. Вооружение сторожа: 3 суток прогона → runbooks/watchdog.md разделы 0-1 (launchctl — руки владельца).
4. Дата контрольной ночи (d-005). 5. Судьба панелей %28/%44. 6. Состав GSL-181.
