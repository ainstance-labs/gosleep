# PRD index — GoSleep

| Файл | Тип | Status | Одной строкой |
|---|---|---|---|
| [`PRD-gosleep-evolution.md`](./PRD-gosleep-evolution.md) | Инициатива (6 фаз) | Draft — 2026-07-08 | «Оркестратор, при котором владелец спит»: watchdog → self-pulse/night → question-buffer/manifest/digest → laboratory → UI → mobile |

## Глобальная трассируемость

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
