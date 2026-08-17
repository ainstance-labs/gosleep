# ADR-0001 — Adopt phase-acceptance checklist as the epic-closure gate

> **Status:** Accepted.
> **Date:** 2026-08-17.
> **Decided by:** shift-73 audit synthesis
>   (`docs/reviews/system-audit-2026-07-24/SYNTHESIS.md`, root cause R2:
>   "built ≠ armed") + Wave-4b implementation (GSL-236 through GSL-241).
> **Related lesson:** none directly — this ADR codifies a positive
>   convention; it is not born of a data-loss incident.

## Context

The shift-73 global audit found that phases had been closed on the strength
of green code and green test suites while the mechanism the phase shipped
was never observed running on the machine. The most-cited example: Phase 1
(Watchdog over the orchestrator) merged with GSL-49 marked DONE and 75/75
smoke passing, but `launchctl list | grep com.gosleep.watchdog` returned
nothing for 104 orchestrator cycles. Fixtures had never been reconciled with
the live machine.

The audit named this pattern as the meta-defect above every other individual
finding, and its finding 89 (MAJOR) proposed introducing an `armed-check` as
a phase acceptance criterion. That check was subsequently built (GSL-211
under epic GSL-178) but had no procedural home: no doc said "run this at
closure and quote the receipt".

## Decision

Every phase / epic closure runs `tools/lab/armed-check.sh` and quotes an
`ARMED-CHECK` block in the dev_history file for the closing task + in the
shift handoff. The block declares the verdict (`armed` /
`armed-unscheduled` / `observing` / `unarmed` / `misconfigured`), names the
session, cadence, plist, and ledger state, and points at the JSON receipt
under `.artifacts/lab/gates/armed-check.json`.

Mechanisms that `armed-check` does not yet verify are listed explicitly with
the reason they are off-record. Silence is a defect.

The convention is codified in `docs/process/phase-acceptance-checklist.md`
and cross-referenced from PRD constraint C9 (`docs/prd/PRD-gosleep-evolution.md`).
It is one of four items in the epic-closure gate:

1. Armed-check block (this ADR)
2. PRD delta (`docs/process/prd-maintenance.md`, GSL-238)
3. Data-valid-as-of header on new reports / reviews / handoffs
   (`docs/process/document-header-convention.md`, GSL-237)
4. Skill-lesson checklist (`skill/handoff/SKILL.md` Procedure step 7,
   GSL-189)

## Consequences

- **Positive.** The single most-cited class of failure ("code merged, thing
  never armed") becomes visible at closing time, not weeks later in an
  audit. The receipt is machine-checkable (JSON) and human-readable (block
  in the dev_history). A future auditor can grep the closing artifacts and
  discover armed/not-armed history without spelunking the machine.
- **Negative.** Every phase-closing shift now owes one extra artefact.
  Shifts that ship only text (docs, refactors, process work) still owe the
  block; a "not-applicable" entry is short but not zero.
- **Neutral.** The check runs against the current machine — it is
  intentionally machine-specific. Verifying on the owner's laptop does not
  prove the mechanism is armed on any other environment; that is by design
  because "this machine" is where the project lives.

## Alternatives considered

- **Enforce via `gate.sh` at pre-commit.** Rejected: `gate.sh` is a fast,
  side-effect-free per-commit gate; `armed-check` probes `launchctl` and
  the live tmux, which is a phase-closing action, not a per-commit one.
  Wiring it into `gate.sh` would slow every commit and would still fail on
  machines where the checked mechanism is not the current shift's target.
- **Rely on the audit cadence.** Rejected: the audit is monthly at best.
  The pattern the ADR fixes is that phases sat closed-but-unarmed for weeks
  before the audit surfaced them.
- **Add a warning line to the handoff template only.** Rejected as
  insufficient: a warning without a required receipt reproduces the pattern
  ("I meant to run it; time ran out"). The block IS the receipt; its
  presence is checkable at review time.

## When to revisit

- If the project migrates off the current single-machine model to a shared
  runtime, `armed-check` will need to run in whichever environment the
  mechanism is supposed to live in. The doc's "mechanisms not covered"
  clause bridges the transition but a wholesale rewrite of the check would
  land a new ADR that supersedes this one.
- If Anthropic changes the Claude Code launch topology such that
  `launchctl` is no longer the correct arming surface, this ADR + the
  `armed-check` implementation both need review.
- If the pattern the ADR fixes is measured as extinct across two full
  audit cycles, the "off-record" allowance may be tightened.
