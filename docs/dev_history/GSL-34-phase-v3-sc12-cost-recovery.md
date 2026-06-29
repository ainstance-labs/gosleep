# GSL-34 v3 SC-12: cost recovery via range-read + mandatory telemetry in briefs/STATE

**Phase:** v3 eval-gap closure  
**Branch:** GSL-31-close-eval-gaps  
**Date:** 2026-06-29

## Problem

SC-12 eval scenario: when a completed cycle's token/cost data was not reported (worker gone, no
telemetry line in its COMPLETE message), the orchestrator said "data not available" and moved on —
leaving a silent gap in the cumulative TELEMETRY block. v2 fixed the telemetry-append mechanics
(format + example), but did not address: (a) how to RECOVER when data is already missing, or
(b) how to FIX THE PROCESS FORWARD so the gap doesn't happen again.

## Fix (mechanism-level, two explicit imperative steps)

### Step 1: RECOVER
Added to "Cost & runaway control": when a dead worker failed to report tokens:
- Range-read ONLY the `## ORCHESTRATOR REPORT` block of the dead worker's handoff file (the
  existing read-exception covers exactly this use case — see "Common mistakes").
- Extract token counts from that block and tally them.
- If unrecoverable (block absent or file missing): record `tokens_this_cycle=UNRECOVERED — gap
  flagged` in the TELEMETRY block. NEVER fabricate an aggregate; NEVER say "unavailable" and
  move on as if the cost didn't happen.

### Step 2: FIX FORWARD
Added mandatory TELEMETRY requirement in every worker brief: every brief MUST instruct the worker
to end its COMPLETE report with `tokens_out=N tokens_in=N cache_read=N`. This is the upstream
fix — if the brief never asks for it, the data goes dark from the start.

## Insertion points

1. **Cost & runaway control** — two new bullets: "Mandatory TELEMETRY in every worker brief" +
   "Token recovery when a dead worker failed to report tokens."
2. **Red flags** — new entry: "The worker didn't report its tokens..." → NO + recovery path.
3. **Quick reference** — new row: "Dead worker's tokens not reported" → recovery procedure.
4. **Common mistakes** — two new bullets: silent omission + omitting TELEMETRY from brief.

## Files changed

- `skill/orchestrating-delivery-agents/SKILL.md` — cost section, red flags, quick reference,
  common mistakes.
