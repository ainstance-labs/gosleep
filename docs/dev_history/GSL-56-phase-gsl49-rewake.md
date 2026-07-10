# GSL-56 — Cold-start re-wake: watchdog-driven orchestrator restart

**Epic:** GSL-49 — Watchdog над оркестратором (PRD Phase 1)
**Branch:** GSL-49-orchestrator-watchdog
**Phase:** GSL-49 — PRD Phase 1, task 6 «Cold-start как точка re-wake» (supports R1.2 re-wake path)

---

## Part 1 — Story

### What was done
Closed the loop between the watchdog and the skill: when the watchdog kills a dead/wedged/
context-exhausted orchestrator, *something* has to tell the fresh session who it is and how to
resume — at 3am, with nobody around. This task added a «Re-wake — automated restart by watchdog»
section to `orchestrating-delivery-agents` plus a machine-consumed prompt template
(`references/re-wake-brief.md`) that the watchdog script reads, fills placeholders in
(`{{PROJECT_DIR}}`, `{{REASON}}`, `{{RESTART_N}}/{{RESTART_BUDGET}}`, `{{TS}}`), and passes as the
fresh session's first prompt. Re-wake deliberately *reuses* the existing cold-start protocol
(steps 1–6, on-disk-first) — per the warren pattern, the new orchestrator is seeded purely from
durable state (STATE → newest dated handoff → heartbeat tail), never from the corpse's context —
and adds only the unattended deltas: adopt live workers instead of respawning, buffer questions
instead of blocking, record the restart, resume the pulse.

### Problems solved
- **Duplicate protocol risk.** The PRD forbids rewriting cold-start («существующий cold-start
  протокол — переиспользуется, не переписывается»). The new section is a thin delta layer: a
  3-row manual-vs-unattended table + idempotency rules + first-acts order, all pointing back at
  cold-start steps 1–6 verbatim. The brief template likewise repeats as little as possible and
  tells the session to load the skill.
- **Where does the template live so a bash script can use it?** In the skill's `references/` (it
  installs globally with the skill, so the watchdog works in ANY project). The template sits
  between `<!-- BRIEF-START -->` / `<!-- BRIEF-END -->` markers so `watchdog.sh` (GSL-52) can
  extract it mechanically; unfillable placeholders are passed literal and read as "unknown".
- **Double-dispatch (PRD risk: «Re-wake не идемпотентен»).** Three rails: fleet re-census before
  any acting step with explicit ADOPT semantics (a dead orchestrator does not invalidate its
  workers); "never spawn until every pane/task is accounted for" (cold-start rule 5); and a
  same-brief-twice check — STATE already records this restart + heartbeat advancing ⇒ another
  orchestrator won the race ⇒ exit quietly, no writes.
- **Unattended ≠ interactive.** Manual cold-start assumes a human who can answer. Re-wake bans
  AskUserQuestion-blocking: questions accumulate in a `QUESTIONS-PENDING` section of STATE, work
  continues on unblocked items; only denylist items stay parked as `BLOCKED_ON_HUMAN`. (Phase 3's
  question buffer will supersede this lightweight list.)

### Problems remaining
Nothing consumes the brief yet — `watchdog.sh` (GSL-52) must implement the extract-substitute-
inject contract, and the restart budget it cites is GSL-53's counter. The `QUESTIONS-PENDING`
list is a Phase-1 stopgap; Phase 3 replaces it with the typed queue + manifest.

### Pitfalls & workarounds
- **Crash-loop ownership split.** The budget (N-in-window, backoff, escalate-and-STOP) belongs to
  the watchdog (GSL-53) — the skill references it and explicitly does NOT re-implement it. The
  orchestrator's half is behavioral: heartbeat tail + STATE log show predecessors dying repeatedly
  at the same point ⇒ don't repeat that action — park it, advance elsewhere, or wind down
  deliberately (`status:"quiesced"` once `open_workers` is 0) so the watchdog stops instead of
  burning budget on the same wall.
- **Suspect handoff by default.** A manually-rolled orchestrator leaves a clean dated handoff; a
  killed one likely died mid-flight. The re-wake deltas make the suspect-handoff rules (live git
  wins) the default posture, not an exception.

### What didn't make it
No changes to `tools/` (GSL-52/53/54/55 own the consumer side, running in parallel). No pulse
cadence policy (Phase 2). No question typology/buffer files (Phase 3).

---

## Part 2 — Technical reference

**Files changed:**
- `skill/orchestrating-delivery-agents/SKILL.md` — new section «Re-wake — automated restart by
  watchdog» (after «Recovering / cold-starting»): brief mechanics, manual-vs-unattended delta
  table, idempotency rails, first-acts order, anti-crash-loop split (references GSL-53 restart
  budget); 1 Quick-reference row; 1 Red-flag entry (unattended + adopt-don't-respawn); frontmatter
  description now names watchdog re-wake as a trigger; Reference-files list updated.
- `skill/orchestrating-delivery-agents/references/re-wake-brief.md` — NEW: machine-consumed
  template (`BRIEF-START`/`BRIEF-END` markers, placeholder table, 6-step unattended brief).
- `docs/dev_history/GSL-56-phase-gsl49-rewake.md` + `README.md` index — this entry.

**Contract (for GSL-52's watchdog.sh):**
- Read `~/.claude/skills/orchestrating-delivery-agents/references/re-wake-brief.md` (or the repo
  copy), extract between `<!-- BRIEF-START -->` and `<!-- BRIEF-END -->`, substitute
  `{{PROJECT_DIR}} {{REASON}} {{RESTART_N}} {{RESTART_BUDGET}} {{TS}}`, inject as the first prompt
  of the fresh `claude` session. `{{REASON}}` ∈ `dead-session|stale-heartbeat|zombie|context-ceiling`.

**Verified by running:**
- `./install.sh` → 5 skills installed; `diff -r` local vs `~/.claude/skills/
  orchestrating-delivery-agents` → identical; grep finds the new section + brief markers in the
  global copy.

**PRD acceptance (Phase 1, task 6):** watchdog calls the EXISTING cold-start (re-attach, not
respawn) — section defers to cold-start steps 1–6 and makes ADOPT explicit; re-wake idempotency
(no double-dispatch) — three rails above; consistent with R1.2 (re-wake path), R1.3 (budget
referenced, not duplicated), C7/C8 (durable-state seeding, atomic STATE writes).

**Links:** Jira [GSL-56](https://ainstance-labs.atlassian.net/browse/GSL-56) ·
GitHub [#64](https://github.com/ainstance-labs/gosleep/issues/64) · Epic
[GSL-49](https://ainstance-labs.atlassian.net/browse/GSL-49) / [#57](https://github.com/ainstance-labs/gosleep/issues/57)

---

## Review fixes (2026-07-10, epic review M1 — `docs/reviews/REVIEW-gsl49.md`)

«Nothing consumes the brief yet» (Problems remaining above) closed: `watchdog.sh v0.5.0`
implements the extract-substitute-inject contract — BRIEF-START/END block extracted, the five
placeholders substituted, result passed as the fresh session's first prompt (smoke-asserted,
incl. a no-leftover-`{{...}}` sweep and RESTART_N progression). The `{{REASON}}` dictionary in
this file's placeholder table was re-synced to the watchdog's actual decision reasons
(`dead_session | stale_after_nudge | zombie_confirmed_<n>_cycles | handoff_overdue`) — the
hyphenated draft values never matched the implementation. Fallback: template missing →
inline prompt + `rewake_brief_missing` ledger warning.
