# GSL-79 — PULSE-дельты: scan queue, apply-at-deadline, reroute; LIVE-STATUS questions-поле

**Epic:** GSL-72 — Question buffer + decision manifest (PRD Phase 3)
**Branch:** GSL-72-question-buffer
**Phase:** PRD Phase 3, requirement R3.6 (интеграция с PULSE/STATE — минимальные дельты)

---

## Part 1 — Story

### What was done
- **HEARTBEAT_OK fast-path** получил пятый чек «Queue quiet»: один `lab-emit.sh list --due`
  (пусто) + line-count очереди против census в LIVE-STATUS (рост = есть что триажить); в «clocks»
  добавлен BLOCKER re-push таймер (manifest §4); target cost скорректирован ≤4–5 дешёвых вызовов;
  worked example дополнен queue-пробой.
- **Секция Question queue** — блок «Every pulse scans the queue» (триаж-действия по 05 §4.6, по
  порядку): (a) новоотвеченные → act + `decision --re … --by owner` + un-park/reroute обратно;
  (b) DECISION за `auto_apply_at` → применить дефолт СЕЙЧАС + `resolve` + `decision` с цитатой
  правила — истёкший дедлайн = истёкший clock, на следующий тик не переезжает; (c) BLOCKER висит
  долго → re-push по manifest §4 (ночью один пуш, повтор — в дайджест).
- **LIVE-STATUS** — новое поле `questions: open=N (xB/yD/zC/wF)` (строка `list --count`
  verbatim) в формате блока; обновляется при каждом изменении очереди.
- **Decision forks / BLOCKED_ON_HUMAN → «queue + reroute», не «stop»:** список форков не
  тронут (R3.6 требует именно это), но механический ответ переопределён — запись FIRST, доставка
  по типу/присутствию, парк ТОЛЬКО затронутого item; `BLOCKED_ON_HUMAN q-…` — состояние задачи,
  никогда не состояние цепи.
- **Handoffs** — session-boundary handoff перечисляет открытые q-ids (наследник берёт очередь с
  диска; ids делают связь явной и greppable). Worker-report строка → `BLOCKED_ON_HUMAN: <q-id +
  specifics>`.
- **Quick-ref:** строка пульса дополнена queue-шагом; +2 новые строки («Queue delta on a pulse»,
  «Worker hits an ownable fork»).

### Problems solved
- **Буфер без пульса — мёртвый буфер:** ответы владельца и истёкшие дедлайны теперь
  обнаруживаются максимум через один пульс-интервал, механикой чек-листа, а не памятью.
- **BLOCKED_ON_HUMAN как стоп-кран флота** упразднён: паркуется item, воркер переезжает на
  разблокированное (park-per-task, autosk 01 §7).

### Where the bodies are buried
- «Новоотвеченные» детектятся line-count'ом против census в LIVE-STATUS — дёшево, но требует
  дисциплины освежать поле при каждом изменении очереди (правило прописано в двух местах).
- Веса пульса выросли на 1 вызов (`list --due`) — принято: это единственный способ ловить
  дедлайны без чтения всего файла.

## Part 2 — Reference

- **Files:** `skill/orchestrating-delivery-agents/SKILL.md` (HEARTBEAT_OK чек + пример; queue
  triage блок; LIVE-STATUS формат; Decision forks; Handoffs; quick-ref ×3),
  `references/worker-cycle-template.md` (BLOCKED_ON_HUMAN строка отчёта).
- **Acceptance:** R3.6 / F3-S1 — park-per-task + reroute прописаны механикой пульса и quick-ref;
  handoff-ids — R3.6 item 5.
- **Gates:** `./install.sh` + `diff -r` global — clean.
