# decisions/ — manifest + decision log + learning loop

- **`manifest.md`** — owner-sovereign правила автономии (ЕДИНСТВЕННЫЙ рукотворный файл в
  `docs/lab/`). Агенты читают каждый цикл, предлагают правки через дайджест, никогда не правят
  молча. См. шапку самого файла.
- **`log.jsonl`** — append-only лог решений: каждое автономное решение оркестратора И каждый
  ответ владельца (live или из буфера). Пишется ТОЛЬКО через `tools/lab/lab-emit.sh decision`.

## Record schema (log.jsonl)

```json
{"id":"d-2026-07-10-001","ts":"2026-07-10T03:14:07Z","re":"q-2026-07-10-003",
 "task":"GSL-96","type":"DECISION","question":"…","qshape":"ab12cd34ef",
 "decision":"regular merge","made_by":"orchestrator","rule":"manifest §2.merge-strategy",
 "channel":""}
```

- `re` — id вопроса в `questions/queue.jsonl` (пусто для решения без записи-вопроса);
  с `--re` хелпер сам подтягивает `question/task/type` из очереди.
- `rule` — provenance-цитата пункта манифеста (`manifest §N.bullet`). Для
  `made_by=orchestrator` ОБЯЗАТЕЛЬНА (F3-S3): решение без цитируемого правила — не автономный
  акт, а DECISION-запись, ждущая дедлайна. Для `made_by=owner` — опциональна.
- `qshape` — форма вопроса для learning loop: ключи/числа/пути нормализованы, sha256[:10] —
  «merge strategy for PR #47?» и «merge strategy for PR #52?» имеют одну форму.

## Learning loop

`tools/lab/lab-emit.sh candidates [--min N]` — скан лога: одна форма вопроса, решённая одинаково
≥ N (default 3) раз → строка-кандидат для секции «Manifest candidates» утреннего дайджеста:

```
CANDIDATE ×3: "regular merge" — for "merge strategy for pr <ref> after main moved?" (tasks: …) → promote to manifest §2?
```

Владелец подтверждает правкой манифеста (или «да» в канале — тогда оркестратор вносит правку и
логирует её как owner-decision). KPI: questions-per-night → 0 для повторяющихся форм.
