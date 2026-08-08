# PRD index — GoSleep

| File | Type | Status | One-liner |
|---|---|---|---|
| [`PRD-gosleep-evolution.md`](./PRD-gosleep-evolution.md) | Initiative (Phases 1-6, historical monolith) | Draft — 2026-07-08 | "Orchestrator that lets the owner sleep": watchdog → self-pulse/night → question-buffer/manifest/digest → laboratory → UI → mobile. Phases 1-6 retained in Russian as archive. |
| [`01-phase7-interactive-control-plane.md`](./01-phase7-interactive-control-plane.md) | Per-phase PRD (Phase 7) | Draft — 2026-08-07 | Live web control plane at `http://127.0.0.1:7331` (SQLite = source of truth, gosleep-core on Bun+Hono, React+Vite+shadcn client). Supersedes Phase 5 (owner decision `d-2026-08-03-004`). Epic [GSL-250](https://ainstance-labs.atlassian.net/browse/GSL-250). |

## Convention — per-phase PRD files (owner rule, 2026-08-07)

All new PRD phases from Phase 7 onward are written as **standalone per-phase files**, named
`<NN>-phase<MM>-<slug>.md`, in **English only**. The parent `PRD-gosleep-evolution.md` monolith
carries a short English pointer at the location where the phase used to be appended. Legacy
phases 1-6 stay in the monolith as a historical Russian archive and are not translated
retroactively — but every new PRD artefact is English by construction.

## Global traceability

Это единый консолидированный PRD (все 6 фаз в одном файле), поэтому авторитетная
**сквозная матрица трассируемости** (источник findings → фаза → req-ID → критерий приёмки) и
список явных отложенностей живут внутри самого файла — раздел «Сквозная матрица трассируемости
(seam-guard)». Здесь нет швов между несколькими PRD-файлами, через которые требование могло бы
утечь: матрица в одном файле покрывает ту же роль.

## Фазы (порядок = ценность/зависимости)

| Фаза | Название | Даёт | Зависит от | Усилие |
|---|---|---|---|---|
| 1 | Watchdog над оркестратором | Флот переживает смерть оркестратора ночью | cold-start/STATE (+ heartbeat) | M |
| 2 | Self-pulse + night mode | Дешёвые пробуждения; ночной режим; quota auto-wait | Ф1 | M |
| 3 | Question buffer + manifest + digest | Вопросы не блокируют ночь; решения по манифесту; утренний дайджест | Ф2 | M |
| 4 | Laboratory (auto-doc) | Ночь фиксируется сама (events→JSONL, chronicler) | Ф3 | L |
| 5 | UI оркестрации | Один утренний экран (runway, вопросы, задачи) | Ф4 | M |
| 6 | Mobile | Пуш BLOCKER; ответ из кровати; break-glass | Ф3 + Ф4 | M |

Источник фактов: `docs/research/2026-07-07-orchestration/{01..05}-*.md`.
Что НЕ меняется: `skill/orchestrating-delivery-agents/SKILL.md` (+ handoff/delivery-workflow/using-jira).
