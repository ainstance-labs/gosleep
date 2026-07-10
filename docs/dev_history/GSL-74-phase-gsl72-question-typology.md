# GSL-74 — Типология вопросов: 4 типа, 4 поведения (skill + worker-template)

**Epic:** GSL-72 — Question buffer + decision manifest (PRD Phase 3)
**Branch:** GSL-72-question-buffer
**Phase:** PRD Phase 3, requirement R3.1 (typология и поведения)

---

## Part 1 — Story

### What was done
New SKILL.md section **"Question buffer — four question types, four behaviors"** (placed right
after Night mode — it's the mechanism the night question-row now delegates to):

- **Inversion pinned:** the question RECORD is primary; a live `AskUserQuestion` is just one
  delivery channel for the same record when the owner is present. Owner absent → typed record in
  `docs/lab/questions/queue.jsonl` (queue mechanics land in GSL-75) + behave per type.
- **Typology table** (05 §4.1): BLOCKER (no safe default — park ONLY the affected item, reroute,
  push now), DECISION (defensible reversible default + `auto_apply_at` — keep working, apply at
  deadline), CLARIFY (take default NOW, answered-by-default, retroactive veto), FYI (record only).
  A "wakes the owner at night?" column makes the push policy explicit per type.
- **Classification rules, ordered, first-match-wins** — the key rail: irreversibility alone forces
  BLOCKER; buffering-and-defaulting is licensed by reversibility. Defines the "type ≤ DECISION"
  severity shorthand used by worker briefs.
- **Night-mode wiring:** BLOCKER is the only question type on the night critical list; DECISION/
  CLARIFY/FYI buffer + surface at the morning boundary. Day uses the SAME records — day/night
  changes only the delivery channel, never the record.
- **Dedup rule** (question-spam guard): same `(task, question-hash)` open → `seen_by` patch, never
  a second record.

`QUESTIONS-PENDING` формализован: все 7 упоминаний в SKILL.md (night-таблица, morning boundary,
re-wake таблица, 2 quick-ref строки, 2 red flags) переведены на typed queue records;
`re-wake-brief.md` пишет в queue с fallback на `QUESTIONS-PENDING` если тулинга нет (брифы
машинно-потребляемые, деградация должна быть определена). `worker-cycle-template.md` получил
hard-rule bullet «Ownable questions never block your pane» с командой `lab-emit.sh question` и
правилом «CONTINUE on the default if type ≤ DECISION» (R3.6 worker-brief line).

### Problems solved
- **Вопрос ночью = стоп панели** (#1 autonomy gap, 05 §2.3-4). Теперь у каждого вопроса есть тип,
  и только BLOCKER паркует — и то per-task, не per-fleet.
- **QUESTIONS-PENDING был ad-hoc STATE-механикой** без типов, дедлайнов и дедупа — заменён
  единым домом (queue), который переживает сессии и читается дашбордом/дайджестом/пушем.

### Where the bodies are buried
- Секция ссылается на «Question queue section», которая появляется следующим коммитом (GSL-75) —
  внутри одного эпика/PR это осознанный порядок, отдельно коммит не самодостаточен на ~1 форвард-
  ссылку.
- Fallback на QUESTIONS-PENDING оставлен ТОЛЬКО в re-wake-brief (деградация без тулинга); в самом
  скилле имя осталось лишь как «superseded» упоминание в новой секции.

## Part 2 — Reference

- **Files:** `skill/orchestrating-delivery-agents/SKILL.md` (new H2 after Night mode; 7 reference
  updates), `references/worker-cycle-template.md` (hard-rule bullet), `references/re-wake-brief.md`
  (unattended rules paragraph).
- **Source design:** `docs/research/2026-07-07-orchestration/05-lab-ui-mobile-autonomy.md` §4.1;
  PRD Phase 3 R3.1 (+R3.6 worker line). Acceptance F3-S1 (behavior per type), part of SC-D.
- **Gates:** `./install.sh` + `diff -r` global copy — clean.
