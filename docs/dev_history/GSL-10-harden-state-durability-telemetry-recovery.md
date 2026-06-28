# GSL-10 — On-disk state durability + telemetry recovery across orchestrator rollover (skill)

## What was done

Added two durability requirements to the orchestrator's on-disk STATE file:

1. **Atomic writes.** ORCHESTRATION-STATE.md must now be written via a same-directory hidden temp (`docs/handoff/.ORCHESTRATION-STATE.md.tmp`) followed by an atomic rename — exactly the same pattern already required for handoff files. A crash mid-write can no longer leave a truncated or half-updated STATE file.

2. **Persisted telemetry block.** Added a required TELEMETRY block to the STATE file structure (`cycles_completed`, `tokens_total`, `tokens_workers`, `tokens_orchestrator`, `open_workers`). This block is updated cumulatively on every STATE write; a rolled-over or restarted orchestrator reads it on startup and resumes running totals rather than resetting to zero.

3. **Rollover carry-over.** In the "Orchestrator self-monitoring" section, tightened the rollover step to explicitly require carrying the cumulative telemetry + budget tallies into the fresh orchestrator via the STATE file.

4. **Cost & runaway control.** Clarified that `TELEMETRY` tallies are cumulative and never reset on rollover or restart.

## Problems solved

Before: an orchestrator restart meant telemetry (cycle count, token totals, open-worker list) was silently lost; the next orchestrator started from zero and could blow the agreed budget ceiling without knowing it. Also, a crash mid-write to ORCHESTRATION-STATE.md could produce a truncated file indistinguishable from a valid (short) one.

## Problems remaining

None specific to this task. The STATE-write atomicity is guidance only — workers writing their own handoffs already follow the atomic pattern; the orchestrator applying it to STATE is analogous and straightforward.

## Pitfalls & workarounds

- Same-directory rename is atomic on POSIX; across filesystems it is not — keep temp and final in `docs/handoff/` (same dir).
- Detect and remove stale `.tmp` on startup before reading STATE, to avoid treating an old partial as current.

## What didn't make it

No schema/format validation for the TELEMETRY block — left to the orchestrator's discretion.

---

## Part 2 — Technical

**Files touched:**
- `skill/SKILL.md` — three sections:
  - "The orchestrator's own state lives on disk..." — added TELEMETRY block (item 3) and atomic-write requirement (new paragraph before closing sentence).
  - "Orchestrator self-monitoring..." — tightened rollover step to carry cumulative telemetry.
  - "Cost & runaway control" — added "cumulative — never reset on rollover or restart" to the tally bullet.
- `docs/dev_history/GSL-10-harden-state-durability-telemetry-recovery.md` — this file.
- `docs/dev_history/README.md` — index entry appended.

**How verified:** read the edited sections; confirmed coherence with Cycle 3 edits (GSL-6/8/9) — no overlap, additive only.
