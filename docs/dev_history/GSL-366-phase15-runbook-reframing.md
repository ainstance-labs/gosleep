# GSL-366 — Runbook reframing note in gosleep-core.md § 8

**Epic:** GSL-361 · **Branch:** `GSL-361-observer-mode-phase-b` · **Base:** `origin/main` @ `7e44e59`.

Text-only. Adds a two-paragraph "Runtime toggle reframing" block inside
`docs/runbooks/gosleep-core.md` § 8 (Web question-loop pilot), right after the widening-gate
note. Fulfils PRD R15.5.

## What the note says

- The shim guard is no longer env-flag-only; it's a compound-OR of `GOSLEEP_WEB_QUESTIONS=1`
  and the core's `/internal/sessions/:id/control` fast lookup.
- Owner decision `d-2026-08-08-001` ("widening interception is an owner-gated act") is
  REFRAMED, not violated: pressing the Take-control button IS the owner command; the
  surface moved from a launch-time env export to a per-session runtime click.
- Env flag stays as legacy bootstrap + outage fallback (env-locked sessions render
  distinctly, cannot be released from the panel — restart in a shell without the flag to
  release).
- Core-unreachable falls back to env-flag-only (binding decision: never fail-open into
  interception).
- Sub-second cutover on release is bounded by the shim cache TTL (1s).
- Points readers at `docs/prd/09-phase15-observer-mode-runtime-control.md` for the full
  acceptance spec (F15-S1..S6).

## Rationale for the note format

The PRD asked for a two-paragraph reframing (R15.5). Kept it in the same section as the
widening-gate note so a reader hitting § 8 sees the historical env-flag pilot, then the
widening-gate note explaining how to widen via env, then the runtime-toggle note explaining
the new per-session surface — in that order. The three notes chain naturally.

## Follow-ups

None.
