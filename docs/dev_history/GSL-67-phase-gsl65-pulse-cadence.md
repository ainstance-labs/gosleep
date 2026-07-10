# GSL-67 — Таблица каденции пульса (cache-окна) + правило armed-wake-up

**Epic:** GSL-65 — Self-pulse + night mode (PRD Phase 2)
**Branch:** GSL-65-self-pulse-night
**Phase:** GSL-65 — PRD Phase 2, requirement R2.1 (cache-aware pulse cadence)

---

## Part 1 — Story

### What was done
The owner's pulse rule ("check every 5–10 min, never end a turn without an armed wake-up" —
mandate 2026-07-07) existed only in memory and prose; the skill said "re-check on a timer" with no
mechanism, no cadence, no economics. This task formalizes it as a new SKILL.md section, **"Pulse
cadence — self-pacing on cache windows"**, right after the Heartbeat protocol it generates:

- **Armed-wake-up rule (HARD):** a turn ending with `open_workers > 0` MUST end with
  `ScheduleWakeup`. The only legal alternatives at end-of-turn are "chain done"
  (`status:"quiesced"`, `open_workers:0`) or an armed wake-up. This is PRD F2-S1 / SC-C verbatim.
- **Cadence table** priced against the ~5-min prompt-cache TTL (04 §3.5: TTL dropped 1h → 5min on
  2026-03-06; poll inside the window or sleep long and eat ONE amortized miss):
  ~270s active monitoring / ~540s stable waiting / 1200–1800s long waiting / **300–540s = dead
  zone, never** (pays the miss without amortizing it).
- **Pulse = cheap triage tick** (OpenClaw heartbeat shape): heartbeat first, delta-scan only, act
  only on deltas, heavy work only because a delta demanded it — never because you woke up
  (claude-code #54086 hazard).
- **Watchdog alignment rule:** a standing delay ≥ `WD_HB_STALE_SECS` (default 900s) schedules your
  own false-stale nudge. Long-waiting cadence requires the owner to raise the conf threshold
  (e.g. 2100s); with defaults, cap standing delays below ~840s.
- Anti-patterns (round-number thinking, over-polling, heavy wake-ups, threshold-straddling sleeps),
  a Quick-reference row and a Common-mistakes entry for the unarmed end-of-turn.

### Problems solved
- **The 5–10-min rule had no cost model.** Under the 5-min cache TTL, "every 5–10 min" is the
  single worst band: every tick pays a full cold re-read. The table replaces it with the two
  rational bands on either side of the dead zone.
- **"Never end a turn without a wake-up" was un-enforceable prose.** Now it has a place in the
  skill's normative tables (Quick reference + Common mistakes) where eval scenarios and replacement
  orchestrators actually look.
- **Skill vs watchdog cadence conflict surfaced, not hidden:** the Phase-1 watchdog was tuned for a
  5–10-min pulse (`WD_HB_STALE_SECS=900`); the Phase-2 long-waiting tier legitimately sleeps past
  that. The section makes the conflict explicit and owner-resolvable (raise conf, or cap delays) —
  never resolvable by skipping heartbeats.

### Problems remaining
Night mode (when the long tier becomes the default) is GSL-68; the HEARTBEAT_OK fast-path the
section forward-references is formalized in GSL-71; quota-wait pacing (ETA-driven wake-ups) is
GSL-69. `watchdog.conf.example` gets its night-threshold comment in GSL-68 together with
activeHours.

### Pitfalls & workarounds
- ScheduleWakeup clamps to [60, 3600] — the long tier's 1200–1800s fits natively; anything longer
  (quota resets hours away) must chain wake-ups (GSL-69).
- The table deliberately names ~270s / ~540s (not "<300" / "'≥540") so an agent picking a number
  has a concrete default instead of an inequality to satisfy creatively.

### What didn't make it
No mechanism-level enforcement of the armed-wake-up rule (a Stop-hook that checks `open_workers`
before letting a turn end) — prompt-level for now; a hook is a natural Phase-4 hooks-layer
candidate.

---

## Part 2 — Technical reference

**Files changed:**
- `skill/orchestrating-delivery-agents/SKILL.md` — new section "Pulse cadence — self-pacing on
  cache windows" (armed-wake-up rule, triage-tick definition, 4-row cadence table, watchdog
  alignment, 5 anti-patterns) inserted after "Heartbeat protocol"; heartbeat section's closing
  parenthetical now points at it; Quick reference row "Ending a turn, open_workers > 0"; Common
  mistakes entry for the unarmed end-of-turn.

**Sources:** PRD Phase 2 R2.1/F2-S1/F2-S2; `docs/research/2026-07-07-orchestration/04-loop-engineering.md`
§3.5 (cache TTL economics, OpenClaw heartbeat, #54086), §6 item 1; MEMORY "Orchestrator pulse rule".

**Verified by running** `./install.sh` → all 5 skills installed; `diff -rq skill/orchestrating-delivery-agents/
~/.claude/skills/orchestrating-delivery-agents/` → identical.

## Review fixes (2026-07-10, REVIEW-gsl65 M2 / m1 / m2 / m3)

- **M2 — rolling exit carve-out.** "Ending a turn = quiesced+0 or armed. Nothing else" excluded
  the legitimate roll boundary; a literal reader would arm a wake-up before rolling and
  double-dispatch against the successor. Now exactly three exits: armed wake-up / final
  `quiesced`+`open_workers:0` / final `status:"rolling"` with **NO** wake-up armed (workers
  already terminated per the roll HARD GATE).
- **m1 — dead zone made half-open:** ≥300s and <540s; 540s itself is the stable-tier floor
  (table row, quick-ref, common-mistakes aligned).
- **m3 — Monitoring probe timer:** "~5 min" → ~270s (active-monitoring tier).
- **m2 — watchdog.sh `WD_HB_STALE_SECS` comment:** stale "pulse is 5-10 min" → GSL-67 cadence
  (~270/~540s ticks; raise to ~2100 for the long-waiting/night tier).
