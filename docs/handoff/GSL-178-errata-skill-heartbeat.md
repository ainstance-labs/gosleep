# Эррата GSL-178: дельты «Heartbeat protocol» для ГЛОБАЛЬНОГО скилла orchestrating-delivery-agents

**Статус:** подготовлена impl-178 (смена 74). **Применяет оркестратор или владелец** к
`~/.claude/skills/orchestrating-delivery-agents/SKILL.md` — глобальная копия авторитетна
(инверсия 2026-07-20), агентам её править запрещено; локальная `skill/` не тронута тем более
(она отстаёт от глобальной, и правка отстающей копии — мёртвая буква). Развилка оформлена
вопросом q-2026-07-28-007, дефолт применён.

**Проверено:** раздел «Heartbeat protocol» в локальной и глобальной копиях побайтово идентичен
(diff пуст, 2026-07-28), поэтому каждый «старый» фрагмент ниже действителен для обеих; перед
применением сверить `grep -cF` = 1 на каждый фрагмент.

Источники истины на стороне репозитория, с которыми эти дельты синхронизируют скилл:
шапка `tools/lab/heartbeat.sh` (схема пульса), `tools/watchdog/watchdog.sh` v0.6.x,
`tools/watchdog/watchdog.conf.example` (семантика context_pct и пороги),
`tools/watchdog/LEDGER.md`.

---

## Замена 1 — семантика context_pct (GSL-217; одна фраза, одинаковая во всех источниках)

Старый фрагмент (в списке Required, начинается на строке ~218):

```
`context_pct` (your HONEST estimate —
  the watchdog compares it to the roll ceiling; a fabricated number defeats roll-at-~70%)
```

Новый:

```
`context_pct` (your HONEST estimate of the share of the context window CONSUMED so far,
  0-100 — "how much is spent", never "how much remains"; it freezes when work freezes,
  which is what powers the watchdog's frozen-progress detector (GSL-213). The watchdog
  RECORDS it on every tick and — until GSL-182 lands a real harness signal instead of
  this self-estimate — enforces nothing on it)
```

## Замена 2 — пример строки формата (GSL-212: поля session / session_id)

Старый фрагмент (строка ~217):

```
`{"ts":"2026-07-10T03:14:07Z","cycle":12,"context_pct":41,"open_workers":2,"status":"ok","pane":"%4"}`
```

Новый (включая `cli` из GSL-219):

```
`{"ts":"2026-07-10T03:14:07Z","cycle":12,"context_pct":41,"open_workers":2,"status":"ok","pane":"%4","session":"gosleep-21","session_id":"a716426f-…","cli":"2.1.220"}`
```

## Замена 3 — session/session_id в списке Required (GSL-212)

Старый фрагмент (конец описания `pane`, строка ~224):

```
watchdog refuses to act on a live session and escalates to the owner instead). Optional:
```

Новый:

```
watchdog refuses to act on a live session and escalates to the owner instead) ·
  `session` + `session_id` (the Claude Code session NAME and sessionId UUID exactly as
  `claude agents --json` reports them — the watchdog's LIFE identity since GSL-212: life is
  judged against the platform roster, and a declared identity absent from it while other live
  sessions run in this repo freezes every action (session_mismatch). NEVER type these by
  hand — the writer below derives them) ·
  `cli` (the Claude Code CLI version this line was written under, GSL-219 — the writer
  resolves it from the harness itself; the watchdog turns a change between consecutive
  lines into a cli_version_changed ledger event, so a 03:00 breaking update is on the
  record instead of invisible). Optional:
```

## Замена 4 — сниппет ручной записи → писатель tools/lab/heartbeat.sh (GSL-212)

Старый фрагмент (bash-блок, строки ~238-240):

```
  hb="docs/handoff/.orchestrator-heartbeat"
  line='{"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","cycle":12,"context_pct":41,"open_workers":2,"status":"ok","pane":"'"${TMUX_PANE:-}"'"}'
  { [ -f "$hb" ] && tail -n 199 "$hb"; printf '%s\n' "$line"; } > "$hb.tmp" && mv "$hb.tmp" "$hb"
```

Новый:

```
  # GSL-212: use the writer — it derives session/session_id from `claude agents --json`
  # by this process's own $CLAUDE_CODE_SESSION_ID (identity is never typed by hand),
  # validates the fields, truncates the note, and does the atomic tail-199 append:
  tools/lab/heartbeat.sh --cycle 12 --context-pct 41 --open-workers 2 --status ok
```

## Замена 5 — пункт HEARTBEAT_OK, читающий строку breaker= (GSL-214)

Старый фрагмент (таблица «Pulse / wake-up tick begins», строка ~946; `grep -cF` = 1):

```
inbox / census / progress probe / queue (`lab-emit.sh list --due` + line-count vs census) / clocks — all green
```

Новый:

```
inbox / census / progress probe / queue (`lab-emit.sh list --due` + line-count vs census) / breaker (`tools/lab/breaker-check.sh` — the STATE `breaker=` line exists, parses, and is not OPEN; rc 2 = deliberate STOP, rc 1 = the line is missing/malformed/tripped-but-closed — fix the line, not the checklist) / clocks — all green
```

---

Дельта GSL-219 (поле `cli`) уже включена в замены 2 и 3 выше. Оставшаяся дельта эпика —
GSL-214 (пункт HEARTBEAT_OK, читающий строку `breaker=` из STATE) — добавится ниже своей
задачей.

Сопутствующая эррата для суверенного `docs/handoff/ORCHESTRATION-STATE.md` (строки `cli=` и
`breaker=`) — отдельным файлом `docs/handoff/GSL-178-errata-orchestration-state.md` по образцу
GSL-195; вставляет оркестратор.
