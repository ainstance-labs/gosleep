# digest/ — утренние дайджесты

`YYYY-MM-DD-morning.md` — один на день С активностью (пустая ночь дайджеста не порождает).
До Фазы 4 пишет оркестратор на morning boundary (SKILL.md, секция "Morning digest"); Фаза 4
передаёт генерацию chronicler'у — шаблон и источники не меняются. Файл НЕ append-only → пишется
атомарно (same-dir temp + rename). Правило 04 §3.6: *дайджест так же важен, как сама работа —
необозримая ночь провалена, даже если все PR смёржены.*

## Canonical template (порядок секций = приоритет владельца, 05 §4.5)

```markdown
# Morning digest — YYYY-MM-DD (night run: HH:MM → HH:MM)

## 1. Waiting for you (N)
<!-- сначала открытые BLOCKER, затем DECISION с обратным отсчётом; из lab-emit.sh list -->
<!-- внутри каждой группы записи с high_impact:true идут выше (это РАНГ в дайджесте, а не право будить ночью) -->
- ! BLOCKER  q-… — <вопрос> — parked: <task>; поднят HH:MM [jira|gh|pr]
- ? DECISION q-… — <вопрос> — default: "<default>"; auto-applies HH:MM (через Xh Ym) [links]

## 2. Decided for you (N)
<!-- каждое авто-решение ОБЯЗАНО цитировать правило манифеста (provenance, F3-S3) -->
- <решение> (q-…, HH:MM) — rule: `manifest §N.bullet`

## 3. What shipped
<!-- задачи/PR/коммиты со ссылками; из git log / gh pr list / Jira, не из памяти -->
- GSL-N <что> @ <sha> — PR #N, Jira Done [dev_history↗]

## 4. Incidents
<!-- что сломалось/восстановилось: рестарты N/M, breaker, quota-wait, RCA-ссылки; или "none" -->

## 5. Cost & runway
<!-- TELEMETRY: за ночь / кумулятив vs потолок; quota-события; slots; breaker line -->

## 6. Manifest candidates
<!-- вывод `tools/lab/lab-emit.sh candidates` verbatim; или "none" -->

## 7. Next
<!-- план на день: следующие разблокированные задачи/фазы -->
```

## Правила

- **Каждая секция читается С ДИСКА** (queue, decisions/log, STATE, git/gh), не из памяти сессии.
- **Каждый пункт ведёт в артефакт:** queue id, PR, commit, dev_history — без ссылок пункт слеп.
- **Дедуп уже сделан очередью:** вопрос от 5 воркеров = ОДИН пункт (seen_by=5).
- **Дайджест показывает, но не закрывает:** открытые записи остаются open, пока владелец не
  ответит (или дедлайн не применит дефолт).
