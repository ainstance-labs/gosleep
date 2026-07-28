# questions/queue.jsonl — the typed question buffer

The durable home of every ownable question (skill `orchestrating-delivery-agents`, sections
"Question buffer" + "Question queue"; PRD Phase 3 R3.2; design 05 §4.2). Written ONLY via
`tools/lab/lab-emit.sh` (id generation, dedup, locking). Append-only: records are never edited —
every status change is a new patch record appended after the original.

## Record schema (question record)

```json
{"id":"q-2026-07-08-003", "ts":"2026-07-08T01:12:40Z", "type":"DECISION",
 "from":"orchestrator", "task":"GSL-45", "links":{"jira":"GSL-45","gh":"#52"},
 "question":"…", "options":[{"label":"…","pros":"…","cons":"…"}],
 "default":"…", "default_rationale":"…", "reversibility":"high",
 "impact_if_wrong":"…", "auto_apply_at":"2026-07-08T10:00:00Z",
 "status":"open", "qhash":"ab12cd34ef", "high_impact":true}
```

- `type`: `BLOCKER | DECISION | CLARIFY | FYI` (typology in the skill).
- `reversibility`: `high | med` — REQUIRED on DECISION/CLARIFY; `low` (irreversible) is rejected by
  the helper: an irreversible fork is never decided by default, it is a BLOCKER (skill "Question
  buffer" rule 1; manifest §3). A BLOCKER carries no `default`.
- `high_impact`: optional, DECISION/BLOCKER — ranks the record higher inside morning-digest §1.
  It is a RANK, never a channel: it does not license a night wake-up.
- `status` (current = fold of question record + later patches, last wins):
  `open` (BLOCKER/DECISION awaiting) · `answered` (by owner/orchestrator, with channel) ·
  `auto-resolved` (default applied at `auto_apply_at`) · `answered-by-default` (CLARIFY —
  proceeded immediately, owner may veto retroactively) · `noted` (FYI).
- `auto_apply_at`: DECISION only; defaulted by the helper per manifest §2 (+2h, clamped so the
  deadline never LANDS before 10:00 local) when not passed explicitly — a default may only apply at
  a moment the owner could have seen the question (morning digest + veto cushion).
- `qhash`: dedup key = sha256(task|normalized question)[:10]; a second worker posing the same
  open question becomes a `{"re":<id>,"seen_by":"<worker>"}` patch, never a new record.

## Patch records

```json
{"re":"q-…","ts":"…","status":"answered","answer":"…","answered_by":"owner","channel":"telegram"}
{"re":"q-…","ts":"…","status":"auto-resolved","applied":"…"}
{"re":"q-…","ts":"…","seen_by":"cycle-14"}
```

## Reading

**НЕЛЬЗЯ читать `queue.jsonl` построчно — только через `lab-emit.sh list`.** Файл append-only:
запись никогда не переписывается, каждый смен статуса — НОВЫЙ patch-запись ниже по файлу, и
текущий статус вопроса — это свёртка исходной записи со ВСЕМИ последующими патчами (`re:` по id,
последний побеждает). Наивное построчное чтение видит исходные записи со `status: "open"` и не
видит закрывших их патчей: на живых данных сырой файл читался как «20 открытых» при фактических
0 открытых (находка 69 аудита 2026-07-24 — на этом споткнулись сами аудиторы). Это относится к
любому читателю: человеку с `cat`/`grep`, агенту, скрипту. Единственный корректный читатель —
`lab-emit.sh list`, он применяет patch-семантику; летописец читает очередь только через него.

`lab-emit.sh list` (open) · `list --due` (DECISIONs past deadline — the pulse acts on these) ·
`list --count` (`open=N (xB/yD/zC/wF) lines=L` — the LIVE-STATUS `questions:` line; `lines=` is the
raw append-only line count HEARTBEAT_OK check 5 compares against) · `list --status all --json` (everything,
folded). Answered/expired records are compacted into `archive.jsonl` by the Phase-4 chronicler;
until then the queue just grows (it is tiny). Owner may answer from a phone by editing nothing:
reply via any channel and the orchestrator appends the `answered` patch.
