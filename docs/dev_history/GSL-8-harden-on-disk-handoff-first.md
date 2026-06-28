# GSL-8 — Recovery: fall back to on-disk handoff FIRST before live probes

## What was done

Edited `skill/SKILL.md` — section "## Recovering / cold-starting an in-progress chain" — to make
explicit that the first fallback on context loss or missing STATE file is to READ THE
HIGHEST-NUMBERED ON-DISK HANDOFF, before running any live probes or tools. Also added a matching
Red flag entry.

## Problems solved

Gap (ports TLM-64 / eval SC-03): on context loss, agents declared `ORCHESTRATION-STATE.md`
"missing" and jumped straight to live probes (tmux, /workflows, gh, git), skipping the on-disk
handoff layer. This is slower, noisier, and risks disorienting the orchestrator on large chains
where the handoff has context the STATE file summarises away. The on-disk layer is cheaper and
usually sufficient to orient.

## Problems remaining

None for this task.

## Pitfalls & workarounds

The new step 2 is inserted between the GSL-6 "read BOTH" step and the former step 2 (now step 3).
Numbering was updated (old 2→3, old 3→4, old 4→5). The new language echoes the existing "Handoffs"
section: "Live git wins over any handoff" still holds — the on-disk-first rule applies to
orientation under context loss, not to trusting handoff data over live git facts.

## What didn't make it

Did not add a quick-reference row — the existing "Lost the thread" row covers the base case; the
on-disk-first rule is a refinement that belongs in the narrative section.

---

## Part 2 — Technical

- **Commit:** see commit
- **Files touched:** `skill/SKILL.md` — 2 edits
  1. Recovery section: new step 2 — "stay on-disk-first; read the highest-numbered handoff BEFORE
     any live probes"; renumbered old steps 2→3, 3→4, 4→5.
  2. Red flags: new bullet — "STATE file not found → I'll just probe live tools." → No: read the
     newest on-disk handoff first.
- **How verified:** Read the updated sections; confirmed no contradiction with the existing
  "Live git wins over any handoff" principle (orientation vs. trust are different concerns).
