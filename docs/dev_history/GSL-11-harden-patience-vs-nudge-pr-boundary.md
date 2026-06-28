# GSL-11 — Disambiguate patience vs single active nudge at the PR/finalize boundary (skill)

## What was done

Added an explicit named distinction between "patience" and "active nudge" at a PR/finalize boundary, which was previously conflated:

- **Patience** = idle between turns is normal; do NOT send any message just because a worker is quiet after committing all its tasks.
- **Active nudge** = a deliberate one-shot message sent only after the patience window elapses (~45–60 min) with no PR opened and no report received. Send EXACTLY ONE "finalize-or-handoff" nudge. Never re-send; never spawn a duplicate; never wait indefinitely past the hard ceiling.

Added a dedicated "PR / finalize boundary" sub-section immediately after the iron-rule paragraph in "The lifecycle decision that keeps the chain stable." Also expanded the Quick reference table: split the prior single row "Committed all tasks but no PR/report" into two rows — one for the in-patience period (do nothing) and one for past the patience window (one nudge, then kill-path).

## Problems solved

Before: the skill didn't name the distinction. Orchestrators would either (a) send repeated nudges that confused a worker still finalizing, or (b) wait indefinitely because the rule said "ONE nudge" but didn't say when to send it. Both failure modes appear in TLM-73 / SC-09 post-mortems.

## Problems remaining

The patience window values (~45–60 min) are approximations inherited from the existing liveness section. No change to those numbers; they're already set.

## Pitfalls & workarounds

- "Patience window" is measured from last known liveness (last `PROGRESS` message or last git commit), not from spawn time.
- After sending the one nudge, the orchestrator must record that it was sent in ORCHESTRATION-STATE.md — else on a restart it may resend and violate the one-nudge rule.

## What didn't make it

No change to the flowchart DOT source (the existing "ONE nudge: send PROGRESS or finalize" node already exists there; the new prose adds the missing context without duplicating the diagram).

---

## Part 2 — Technical

**Files touched:**
- `skill/SKILL.md` — "The lifecycle decision that keeps the chain stable": added "PR / finalize boundary" paragraph after the iron-rule. Quick reference table: replaced one row with two.
- `docs/dev_history/GSL-11-harden-patience-vs-nudge-pr-boundary.md` — this file.
- `docs/dev_history/README.md` — index entry appended.

**How verified:** read the affected section; no overlap with GSL-6/8/9/10 edits (those touch handoff atomicity, state recovery, telemetry — orthogonal).
