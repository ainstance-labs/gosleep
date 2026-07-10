# GSL-80 — Сводка фазы GSL-72: Question buffer + decision manifest + morning digest (PRD Phase 3)

**Epic:** GSL-72 — Question buffer + decision manifest (PRD Phase 3)
**Branch:** GSL-72-question-buffer
**Phase:** PRD Phase 3 целиком — итог и указатели

---

## Part 1 — Story

### Что дала фаза (одним абзацем)
Закрыта #1 дыра автономии: **вопрос ночью больше не блокирует панель.** У каждого ownable-вопроса
теперь есть тип (BLOCKER / DECISION / CLARIFY / FYI), дом на диске (`docs/lab/questions/
queue.jsonl`, append-only + patch-записи + дедуп), правила решения за владельца
(`docs/lab/decisions/manifest.md`, owner-sovereign, 6 секций), аудируемый след каждого решения
(`decisions/log.jsonl` с обязательной цитатой правила), петля обучения (одинаковая форма ×3 →
кандидат в манифест) и утренний экран (`digest/YYYY-MM-DD-morning.md`, 7 секций). Пульс сканирует
очередь каждый тик: ответы применяются, дедлайны исполняют дефолты, BLOCKER'ы ре-эскалируются.
`BLOCKED_ON_HUMAN` стал состоянием одной задачи, а не стоп-краном флота.

### Задачи фазы (указатели)
| Задача | Что | Req | dev_history |
|---|---|---|---|
| GSL-73 | Ledger цикла 1 (handoffs 17, 18 + STATE) | — | [GSL-73](GSL-73-phase-gsl72-cycle1-ledger.md) |
| GSL-74 @ 501a86f | Типология 4×4 + классификация + night-wiring; worker-template; re-wake-brief | R3.1 | [GSL-74](GSL-74-phase-gsl72-question-typology.md) |
| GSL-75 @ 4b30bc9 | `tools/lab/lab-emit.sh` (question/answer/resolve/list) + queue.jsonl + дедуп; smoke | R3.2 | [GSL-75](GSL-75-phase-gsl72-lab-emit-queue.md) |
| GSL-76 @ e351b7b | manifest.md v1 (6 секций, seed Standing rules + denylist verbatim) + правило «решай по манифесту» | R3.3 | [GSL-76](GSL-76-phase-gsl72-decision-manifest.md) |
| GSL-77 @ 703ec66 | log.jsonl + `decision`/`candidates` (provenance-принуждение, qshape ×3) | R3.4 | [GSL-77](GSL-77-phase-gsl72-decision-log-learning-loop.md) |
| GSL-78 @ 3e9269c | Morning digest: шаблон 7 секций + процедура morning boundary | R3.5 | [GSL-78](GSL-78-phase-gsl72-morning-digest.md) |
| GSL-79 @ d3eb02c | PULSE-дельты: queue-скан, apply-at-deadline, LIVE-STATUS, queue+reroute | R3.6 | [GSL-79](GSL-79-phase-gsl72-pulse-deltas.md) |

### Критерии фазы — честный статус
- **F3-S1** (вопрос ≤ DECISION не блокирует панель; park-per-task) — механика прописана
  (типология, пульс, quick-ref, worker-брифы); живой прогон — на ближайшую ночь.
- **F3-S2** (auto_apply_at → дефолт + `decision.made`) — механика в lab-emit (`--due` → `resolve`
  + `decision`), проверена smoke-сценарием с истёкшим дедлайном.
- **F3-S3** (каждое авто-решение цитирует правило) — принуждение МЕХАНИЗМОМ: `decision
  --by orchestrator` без `--rule` отказывает.
- **F3-S4** (дубликат от 5 воркеров = один пункт) — дедуп по `(task, qhash)` + `seen_by`,
  проверено smoke.
- **SC-E** (дайджест с секциями и цитатами) — шаблон и процедура готовы; сам файл появится после
  первой ночи с активностью.
- **Gates фазы:** `./install.sh` + `diff -r` — clean на каждом коммите; JSONL-схема валидна
  (smoke 28/28); манифест парсится.
- **End-check «ночь с развилкой»** — процессный, исполняется живым флотом (оркестратор+владелец);
  вся механика под ним прогнана smoke'ом по шагам.

### Что дальше (для Ф4/Ф5/Ф6)
- Ф4-chronicler забирает: компакцию queue → archive.jsonl, генерацию дайджеста, фильтр
  «candidate уже покрыт манифестом», `lab-emit` расширяется семантическими событиями.
- Ф5 читает: queue (Questions-экран с countdown), log (Decided), digest (Overview).
- Ф6 пушит BLOCKER и пишет ответы владельца в queue (`answered_by=owner, channel=telegram`).

## Part 2 — Reference

- **Новые поверхности:** `docs/lab/` (README, questions/, decisions/, digest/),
  `tools/lab/lab-emit.sh` + `tools/lab/smoke.sh` (28 проверок).
- **Скилл:** SKILL.md +5 секций (Question buffer / Question queue / Decision manifest /
  Learning loop / Morning digest) + дельты в Night mode, HEARTBEAT_OK, Decision forks, Handoffs,
  LIVE-STATUS, quick-ref; `worker-cycle-template.md` (ownable-questions bullet, report line);
  `re-wake-brief.md` (queue вместо QUESTIONS-PENDING, с fallback).
- **Дизайн-источник:** 05 §4 (typология/queue/manifest/learning/digest/интеграция), PRD Phase 3
  (R3.1–R3.6, F3-S1..S4, SC-D/SC-E).
- **Git-политика:** queue.jsonl / log.jsonl / digest — live project data, коммитятся на границах
  ledger (решение по PRD 05 §3.3 «committable except scratch»; телефонные пути Ф5/Ф6).
