# GSL-77 — decisions/log.jsonl + learning loop (manifest candidates)

**Epic:** GSL-72 — Question buffer + decision manifest (PRD Phase 3)
**Branch:** GSL-72-question-buffer
**Phase:** PRD Phase 3, requirement R3.4 (learning loop)

---

## Part 1 — Story

### What was done
- **`lab-emit.sh decision`** — append в `docs/lab/decisions/log.jsonl` (id `d-YYYY-MM-DD-NNN`,
  свой mkdir-lock): каждое автономное решение оркестратора И каждый ответ владельца. С `--re`
  хелпер сам подтягивает question/task/type из очереди (контекст полный — R3.4 «с полным
  контекстом»). **Механическое правило provenance:** `made_by=orchestrator` без
  `--rule "manifest §N.bullet"` — отказ с внятной ошибкой («no citable rule → это DECISION с
  дедлайном, не автономный акт»); owner-решения могут без rule.
- **`qshape`** — форма вопроса для майнинга: ключи (`GSL-45`), `#refs`, пути и числа
  нормализуются в плейсхолдеры → «merge strategy for PR #47?» и «…PR #52?» = одна форма.
- **`lab-emit.sh candidates [--min N] [--json]`** — скан лога: одна форма + одинаковое решение
  ≥ N (default 3) раз → строка `CANDIDATE ×N: "…" → promote to manifest §2?` для секции
  «Manifest candidates» дайджеста. Сортировка по частоте; --json для тулинга Ф4/Ф5.
- **SKILL.md** — секция «Learning loop — answers become manifest rules»: пара appends
  (queue-патч = ЧТО, log-запись = ПОЧЕМУ) ходят вместе; майнинг на morning boundary; повышение —
  ТОЛЬКО владелец (или «да» в канале → оркестратор правит и логирует owner-decision); KPI
  questions-per-night → 0, повторяющаяся форма без правила = process bug, выносить в дайджест.
- **`docs/lab/decisions/README.md`** — схема log.jsonl + описание петли; seed пустого
  `log.jsonl` (коммитится, как queue.jsonl).
- **smoke.sh** расширен: +7 проверок (id, контекст по --re, отказ без --rule, owner без rule,
  candidates ×3 через 3 разных task/#ref, --min, --json fold) — 28/28 PASS.

### Problems solved
- **Ответы владельца испарялись** (чат-scrollback) — теперь каждый ответ = данные, из которых
  растёт манифест; петля репо-видима и owner-auditable (05 §4.4).
- **Provenance держится механизмом, не дисциплиной:** нельзя записать «автономное» решение без
  пункта манифеста.

### Where the bodies are buried
- Кандидаты НЕ сверяются с самим манифестом (уже-повышенная форма продолжит светиться, пока
  решения по ней пишутся в лог) — фильтр «uncovered by manifest» осознанно оставлен chronicler'у
  Ф4; для дайджеста, который читает владелец, это шум одного взгляда.
- Нормализация qshape грубая (регексы) — ложные слияния/расщепления форм возможны; порог ×3 и
  человеческое подтверждение это компенсируют.

## Part 2 — Reference

- **Files:** `tools/lab/lab-emit.sh` (+decision, +candidates, DirLock generalized),
  `tools/lab/smoke.sh` (+7 checks), `docs/lab/decisions/README.md`,
  `docs/lab/decisions/log.jsonl` (seed), `skill/orchestrating-delivery-agents/SKILL.md`
  ("Learning loop" section).
- **Acceptance:** R3.4 — «при 3 одинаковых ответах кандидат появляется» проверено smoke-сценарием
  (3 решения с разными task/#ref → один CANDIDATE ×3).
- **Gates:** `./tools/lab/smoke.sh` 28/28; `./install.sh` + `diff -r` — clean.
