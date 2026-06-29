# GSL-33 v3 SC-19: forbid killing a live/productive worker to force a roll boundary

**Phase:** v3 eval-gap closure  
**Branch:** GSL-31-close-eval-gaps  
**Date:** 2026-06-29

## Problem

SC-19 eval scenario: orchestrator sends `shutdown_request` to a productive, mid-cycle worker
specifically to force a clean boundary so it can roll/handoff sooner. The v2 HARD GATE text
("never roll with a live worker; terminate/confirm-dead first") was being misread as permission
to kill the worker so you *can* roll — i.e., "terminate first, then roll" was interpreted as
"kill it to create the terminate state, then roll."

The defect: forcing a boundary by shutting down / killing productive live work just to roll is
itself orphaning by another name — the in-progress output is lost.

## Fix (mechanism-level)

Three insertion points, all targeting the decision mechanism not prose:

1. **Self-monitoring/roll section** — added a "CRITICAL" clarification block immediately after
   the "Terminate first" bullet. Makes explicit that `shutdown_request` is ONLY for workers at
   a natural exit point; the clean boundary must arrive NATURALLY (worker self-quiesces with
   COMPLETE, then you terminate), never FORCED. Names the exact anti-pattern ("kill to roll
   faster") and provides two valid alternatives (wait for COMPLETE, or let current task finish).

2. **Red flags section** — added a distinct entry:
   *"I'm low on context and a worker is busy mid-cycle — I'll shut it down so I can roll at a
   clean boundary."* → NO + rationale + correct action.

3. **Quick reference** — added a row: "Low on context, worker mid-cycle (productive)" →
   wait for COMPLETE / current task finish; NEVER force-terminate; cannot wait → BLOCKED_ON_HUMAN.

4. **Common mistakes** — added a bullet calling out `shutdown_request` to a productive worker
   as "orphaning by another name."

## Files changed

- `skill/orchestrating-delivery-agents/SKILL.md` — self-monitoring section, red flags, quick
  reference, common mistakes.
