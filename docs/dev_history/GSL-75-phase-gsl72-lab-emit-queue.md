# GSL-75 — lab-emit: queue.jsonl схема + dedup helper (append-only, patch-записи)

**Epic:** GSL-72 — Question buffer + decision manifest (PRD Phase 3)
**Branch:** GSL-72-question-buffer
**Phase:** PRD Phase 3, requirement R3.2 (queue-файл + dedup)

---

## Part 1 — Story

### What was done
- **`tools/lab/lab-emit.sh`** — bash-обёртка + встроенный python3 (stdlib-only, 0 LLM — C1):
  субкоманды `question` / `answer` / `resolve` / `list`. Схема записи — 05 §4.2 полностью
  (`id, ts, type, from, task, links, question, options[pros/cons], default, default_rationale,
  reversibility, impact_if_wrong, auto_apply_at, status`) + поле `qhash` (дедуп-ключ хранится,
  не пересчитывается). Правила зашиты в код, не в вежливость:
  - **append-only + patch-записи:** статус меняется ТОЛЬКО новой записью `{"re":<id>,...}`;
    файл никогда не переписывается; текущее состояние = fold (последний патч побеждает).
  - **dedup:** открытая запись с тем же `(task, question-hash)` → патч `seen_by`, не второй
    вопрос (спам-гард 05 §4.2); хэш = sha256(task|normalized-question)[:10].
  - **атомарность:** mkdir-lock (macOS без flock) вокруг read-then-append (генерация id, дедуп);
    одно-строчный O_APPEND; протухший лок (>30s) отбирается.
  - **типы → статусы:** BLOCKER/DECISION → `open`; CLARIFY → `answered-by-default`; FYI →
    `noted`. DECISION/CLARIFY ТРЕБУЮТ `--default` (форк без дефолта = BLOCKER — переклассифицируй).
  - **дефолтный дедлайн DECISION** (манифест §2): ночь (00:00–08:30 local) → сегодня 10:00,
    день → +2h; переопределяется `--auto-apply-at`.
  - **чтение для пульса:** `list --due` (DECISION за дедлайном), `list --count` → готовая строка
    `open=N (xB/yD/zC/wF)` для LIVE-STATUS (GSL-79 её просто вставляет).
- **`tools/lab/smoke.sh`** — 21 проверка (стиль tools/watchdog/smoke.sh): id-формат, авто-дедлайн,
  дедуп/seen_by-fold, статусы по типам, валидация (bad type, DECISION без default, патч на
  несуществующий id), answer/resolve provenance, --due границы, append-only (первая строка
  неизменна), lock released. Артефакты в `.artifacts/lab-smoke/`, при PASS удаляются.
- **`docs/lab/`** заведён: README слоя (C8-правила: STATE авторитет; append-only; live data —
  коммитится, как STATE/handoffs), `questions/README.md` (полная схема), `questions/queue.jsonl`
  (пустой seed, коммитится).
- **SKILL.md** — новая секция «Question queue»: дисциплина файла, схема, команды хелпера,
  git-политика. Закрывает форвард-ссылку из GSL-74.

### Problems solved
- **У вопросов не было дома, переживающего сессию** — queue.jsonl читается дашбордом (Ф5),
  пушится (Ф6), наследуется replacement-оркестратором с диска (R3.6 handoff-пункт).
- **Question spam от N воркеров** → механический дедуп в хелпере, не в дисциплине агентов.

### Where the bodies are buried
- git-политика: queue.jsonl НЕ gitignored (решение по PRD/05 §3.3 «committable except scratch» и
  Ф5/Ф6 phone-путям — владелец читает/отвечает через приватный репо). Runtime-мусора нет: файл —
  живые данные, коммитится на границах ledger-коммитов.
- `archive.jsonl` НЕ создаётся здесь — компакция это Ф4-chronicler; до него очередь просто растёт.
- Лок-steal 30s — грубый, но безопасный: худший случай — два процесса сгенерят один id при
  зависшем держателе; fold по id это переживает (последняя запись побеждает).

## Part 2 — Reference

- **Files:** `tools/lab/lab-emit.sh`, `tools/lab/smoke.sh`, `docs/lab/README.md`,
  `docs/lab/questions/README.md`, `docs/lab/questions/queue.jsonl` (seed),
  `skill/orchestrating-delivery-agents/SKILL.md` (new "Question queue" section).
- **Acceptance:** R3.2 (append-only, patch-записи, dedup) — smoke 21/21 PASS; F3-S4 (дубликат от
  5 воркеров = ОДНА запись с seen_by) — проверено дедуп-сценарием.
- **Gates:** `./tools/lab/smoke.sh` (21/21), `./install.sh` + `diff -r` global — clean.
