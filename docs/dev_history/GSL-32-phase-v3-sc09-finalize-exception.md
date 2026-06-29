# GSL-32 v3 SC-09: finalize-boundary exception — time-ceiling check before pane-alive→WAIT

**Phase:** v3 eval-gap closure  
**Branch:** GSL-31-close-eval-gaps  
**Date:** 2026-06-29

## Problem (root cause, from GSL-35 calibration)

SC-09 eval scenario: at a finalize stall (all tasks committed, no PR opened, no COMPLETE report),
the orchestrator sees the pane is alive and keeps monitoring — never sending the one concrete
nudge — even after the patience window has elapsed.

Root cause: the idle/lifecycle decision flowchart hard-routes `pane alive → WAIT` BEFORE any time
check. The liveness diamond sees "alive" and immediately routes to the WAIT box, bypassing the
"no report ~45–60m" check entirely. Prior prose additions ("send one nudge when the window
elapses") were unreachable because the flowchart routing never got there.

## Fix (mechanism-level — target the routing, not the prose)

### 1. Flowchart: added FINALIZE EXCEPTION node

Inserted a new diamond node between `Liveness → alive` and `Alive/moving → WAIT`:

```
"FINALIZE EXCEPTION: all tasks committed + no PR/report + patience window elapsed?"
  → yes (finalize stall):  "Send ONE concrete finalize nudge NOW (pane-alive does NOT exempt you past the ceiling)"
  → no (mid-cycle):        "Alive/moving -> WAIT (mid-cycle idle only — NOT a finalize stall past the ceiling)"
```

The routing from `Liveness → alive` now hits the FINALIZE EXCEPTION check FIRST, before falling
back to WAIT. This means the time ceiling is checked at the exact point the flowchart was
previously short-circuiting. The WAIT node label is updated to make its scope explicit.

### 2. Added a prose annotation directly after the flowchart

Explains WHY the exception exists, so a reader understands the routing intent and doesn't
inadvertently "fix" it back.

### 3. PR/finalize-boundary section: pane-alive ≠ exempt

Added a "CRITICAL" bullet to the patience-vs-nudge section making explicit that `pane-alive →
WAIT` applies to mid-cycle idle ONLY — not to a finalize stall past the ceiling — and restating
the one-nudge example wording in context.

### 4. Red flags: pane-alive at finalize stall

Added a Red-flag entry: *"The pane is still alive, so I'll keep waiting."* (at a finalize stall,
window elapsed) → NO + redirect to FINALIZE EXCEPTION + example nudge wording.

### 5. Quick reference: finalize stall with pane alive

Added row: pane alive + all tasks committed + no PR + patience window elapsed → FINALIZE
EXCEPTION path; send ONE nudge NOW regardless of pane state.

## Where the SC-09 flowchart exception landed

In the dot digraph, between the `Liveness` diamond and the `Alive/moving → WAIT` box — a new
`FINALIZE EXCEPTION` diamond routes finalize stalls to an immediate nudge action, and mid-cycle
idle to the WAIT box. The WAIT node label is updated to scope it to mid-cycle only.

## Files changed

- `skill/orchestrating-delivery-agents/SKILL.md` — flowchart, finalize-boundary section, red
  flags, quick reference.
