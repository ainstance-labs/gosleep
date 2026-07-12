# GSL-78 — Morning digest: шаблон + секции + provenance-цитаты

**Epic:** GSL-72 — Question buffer + decision manifest (PRD Phase 3)
**Branch:** GSL-72-question-buffer
**Phase:** PRD Phase 3, requirement R3.5 (morning digest)

---

## Part 1 — Story

### What was done
- **`docs/lab/digest/README.md`** — канонический шаблон `YYYY-MM-DD-morning.md`: 7 секций в
  порядке приоритета владельца (05 §4.5): (1) Waiting for you — BLOCKER'ы, затем DECISION'ы с
  обратным отсчётом; (2) Decided for you — каждое авто-решение с цитатой `manifest §N.bullet`;
  (3) What shipped — задачи/PR/коммиты со ссылками; (4) Incidents; (5) Cost & runway;
  (6) Manifest candidates — вывод `lab-emit.sh candidates` verbatim; (7) Next. Плюс правила:
  каждая секция читается С ДИСКА; каждый пункт ведёт в артефакт; дедуп уже сделан очередью;
  дайджест показывает, но не закрывает.
- **SKILL.md** — новая секция «Morning digest — the night on one screen»: когда (morning
  boundary + on-demand), куда (один файл на день С активностью; пустая ночь — ничего), как
  (атомарная запись — non-append файл), кто (оркестратор сам до Ф4-chronicler'а), источники
  посекционно (lab-emit list/--due, decisions/log, TELEMETRY, git/gh, breaker line, candidates),
  финальный акт — ОДНА строка владельцу с путём, тело в чат не вставлять. Эпиграф 04 §3.6:
  необозримая ночь провалена, даже если все PR смёржены.
- **Night mode morning boundary** и quick-ref строка обновлены: «short message + pointer (пока
  дайджеста нет)» → «write the morning digest + one owner line» — обещание GSL-68 исполнено.

### Problems solved
- **At-a-glance в STATE перезаписывается и не имеет истории** — дайджест даёт дневной артефакт
  с датой, ссылками и provenance (SC-E: каждое авто-решение цитирует правило).
- **Морнинг-переход был «сводкой в чат»** — теперь это файл, который читают дашборд (Ф5) и пуш
  «digest ready» (Ф6), а chronicler Ф4 просто перенимает генерацию по тому же шаблону.

### Where the bodies are buried
- Дайджест пишет ОРКЕСТРАТОР (LLM) — по PRD это осознанно (out: «авто-генерация chronicler'ом —
  механизируется в Ф4»); поэтому же нет helper-скрипта: механизация без T1-событий дала бы
  полудайджест из двух источников вместо семи.
- Секция Cost зависит от честности TELEMETRY-блока — если телеметрия за ночь дырявая
  (UNRECOVERED-гэпы), дайджест обязан показать гэп, не сфабрикованный итог (существующее правило).

## Part 2 — Reference

- **Files:** `docs/lab/digest/README.md` (new, template), `skill/orchestrating-delivery-agents/
  SKILL.md` (new "Morning digest" section; Night mode morning-boundary bullet; quick-ref row).
- **Acceptance:** R3.5 / SC-E — шаблон содержит все 7 секций, provenance-обязательность прописана
  в шаблоне И в скилле; F3-S2 отражение auto-apply в «Decided for you».
- **Gates:** `./install.sh` + `diff -r` global — clean.
