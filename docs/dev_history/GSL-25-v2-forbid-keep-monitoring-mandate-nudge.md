# GSL-25 — v2 SC-09: forbid vague "keep monitoring"; mandate ONE concrete nudge

## Part 1 — Plain language

### What was done

Edited `skill/orchestrating-delivery-agents/SKILL.md` to make the SC-09 anti-pattern
("keep monitoring" at a finalize stall) impossible to miss and the correct action unmissable.

Four concrete changes, all in the same file:

1. **Patience-vs-nudge section** — added an explicit FORBIDDEN PHRASES list ("keep monitoring",
   "wait and see", "give it more time", "continue watching", "I'll check back later") with a direct
   declaration that these are not actions and permanently stall the chain. Added a numbered list of
   the THREE VALID MOVES ONLY (keep waiting / ONE nudge / kill+escalate) with verbatim example
   nudge wording:
   *"All tasks are committed but no PR or handoff report after [elapsed time]. Please open the
   PR (or write the handoff) now — I will wait for your reply before taking any other action."*

2. **Quick reference table** — replaced the vague finalize row text with a version that quotes the
   exact nudge wording and explicitly bans "keep monitoring".

3. **Red flags — STOP** — added a bold entry quoting the exact forbidden phrases and mandating the
   ONE concrete nudge with verbatim wording.

4. **Common mistakes** — added entry naming the anti-pattern and pointing to the nudge wording.

### Problems solved

The v1 edit added correct prose in the patience-vs-nudge section, but it was abstract: "send
EXACTLY ONE nudge" without telling the orchestrator WHAT to say. Eval SC-09 consistently produced
"I'll keep monitoring / wait and see" behavior because (a) the forbidden phrases were never named,
(b) the nudge had no example wording, and (c) the anti-pattern didn't appear in any scannable
section (Red flags, Quick reference, Common mistakes) where an agent under pressure would see it.
v2 fixes all three gaps.

### Problems remaining

None for this scenario specifically. The eval (GSL-29) will confirm.

### Pitfalls & workarounds

The existing prose already said "send EXACTLY ONE nudge" — the fix was not to remove/replace it
but to surround it with: named forbidden phrases, example wording, and scannable-section hooks.
Stacking beats replacing here because the prose context still matters.

### What didn't make it

A flowchart-level annotation was considered but not added — the existing dot-graph already shows the
nudge branch; adding more text there would bloat it without adding clarity beyond what the three
edits already provide.

---

## Part 2 — Technical reference

**Commit:** this commit (GSL-25 v2 SC-09: forbid vague "keep monitoring" — mandate ONE concrete nudge + example)

**Key files changed:**
- `skill/orchestrating-delivery-agents/SKILL.md` — patience-vs-nudge section, Quick reference
  table finalize row, Red flags section, Common mistakes section.

**How verified:**
- Re-read all four edited sections — each names the forbidden phrases, provides the verbatim nudge
  wording, and specifies the three valid moves only.
- `./install.sh` run after all four skill tasks are committed (per task order).
- `diff -r` confirms global copy identical to local.
