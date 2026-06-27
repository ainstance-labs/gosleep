# GSL-6 — Require a dated handoff at every orchestrator session boundary

## What was done

Edited `skill/SKILL.md` in four places to make a dated handoff file mandatory at every orchestrator
session boundary (restart, roll, compaction, planned pause) — not merely encouraged or optional.

## Problems solved

Observed gap (2026-06-26): an orchestrator restarted leaving ONLY `ORCHESTRATION-STATE.md` updated
plus a chat message, with no dated handoff file written. Root cause: the skill framed handoffs as
worker batons; the orchestrator roll/recovery sections never explicitly required the orchestrator
itself to write a dated handoff; `handoff` was listed as "optional" in Related skills. The next
orchestrator had no self-contained resume point and had to probe live tools blind.

## Problems remaining

None for this task. The STATE file + dated handoff combo is now the required exit artifact.

## Pitfalls & workarounds

The four edits must be coherent: the self-monitoring section now says "write/refresh a dated
handoff", recovery section says "prior orchestrator MUST have left a dated handoff", Common mistakes
adds the anti-pattern, Red flags adds the "STATE+chat is enough" mistake, and Related skills upgrades
`handoff` from optional to REQUIRED. All four are consistent.

## What didn't make it

Did not add a quick-reference row — the existing "Lost the thread" row already covers reading
ORCHESTRATION-STATE.md, and adding a second row would duplicate guidance. The mandatory handoff
requirement is better placed in the self-monitoring and recovery sections where an orchestrator
naturally looks.

---

## Part 2 — Technical

- **Commit:** see commit
- **Files touched:** `skill/SKILL.md` — 5 edits across 4 sections
  1. `## Orchestrator self-monitoring`: added "write/refresh a DATED handoff file" + "EVERY session boundary"
  2. `## Recovering / cold-starting`: step 1 now says prior orchestrator MUST have left a dated handoff; read BOTH files
  3. `## Common mistakes`: new bullet — "Rolling with only STATE updated, no dated handoff"
  4. `## Red flags — STOP`: new bullet — "Updated STATE + chat summary, that's enough to restart." → No
  5. Related skills: `handoff` changed from "optional" to "REQUIRED at orchestrator session boundaries"
- **How verified:** Read the updated sections and confirmed internal consistency; no contradictions introduced.
