# Phase acceptance checklist

> **Data valid as of:** 2026-08-17.
> **Updated by:** wave4b (GSL-236, systems-audit process tail).
> **Scope:** every closure of a delivery phase or major epic — this is the
> minimum receipt the shift owes the project before the phase can be marked
> DONE. Silence on any item is a defect regardless of how good the code reads.

The audit of shift 73 (`docs/reviews/system-audit-2026-07-24/SYNTHESIS.md`) named
one meta-defect above all others: **built ≠ armed**. Phases were closed on the
strength of green code and green tests while the mechanism they shipped was
never observed running on this machine. This checklist encodes the fix.

---

## The one hard rule (constraint C9)

**A mechanism counts as delivered only when it is ARMED on this machine.** Code
plus green tests is not acceptance. Every phase that ships a mechanism
(supervisor, breaker, tick, server, hook, listener) closes only after
`tools/lab/armed-check.sh` has run and its result is quoted in the closing
artifacts.

The closing artifacts (dev_history file + handoff) MUST carry an
`ARMED-CHECK` block. A phase closure without one is treated the same way as a
missing handoff: incomplete.

## What the block looks like

Copy this template into the dev_history file for the acceptance task and into
the handoff's "Comments" section:

```
ARMED-CHECK (2026-08-17 UTC)
  verdict     : armed | armed-unscheduled | observing | unarmed | misconfigured
  session     : <heartbeat session id>  (alive: yes|no)
  cadence     : median <N>s vs stale-threshold <M>s     -> pass|fail
  plist       : com.gosleep.watchdog                    -> present|absent
  ledger      : <path>                                  -> fresh|stale|absent
  receipt     : .artifacts/lab/gates/armed-check.json
  mechanisms not covered by armed-check (list + why off-record):
    - <mechanism>: <reason it is intentionally not armed right now>
```

If the phase ships a NEW mechanism that `armed-check` does not yet know how to
verify, the same block still runs. Every unknown mechanism goes into the "not
covered" list with the reason. A phase MAY ship without arming a mechanism, but
never silently: the off-record entry is the receipt.

## How to run it

```
bash tools/lab/armed-check.sh
```

Exit code:

- `0` — the machine is consistent with the resolved mode. Copy the JSON receipt
  into the block above.
- non-zero — the phase is NOT-ARMED. Either fix the arming and re-run, OR add
  the mechanism to the "not covered" list with an owner-approved reason.

Full behaviour and every check the script performs is documented in the
header of `tools/lab/armed-check.sh` (GSL-211, epic GSL-178).

## Where the receipt lives

- `.artifacts/lab/gates/armed-check.json` — one line JSON, overwritten every
  run. The chronicler reads it into the "armed / not armed" tile of the web UI.
- The dev_history file for the closing task quotes the block verbatim so the
  receipt survives even if `.artifacts/` is wiped.

## Interaction with other closing gates

The armed-check block is one of four items every phase closure carries. The
full list (in order):

1. **Armed-check block** (this doc) — proves the shipped mechanism is armed on
   this machine, or explicitly names why it is off-record.
2. **PRD delta** (`docs/process/prd-maintenance.md`, GSL-238) — updates the
   phase's Readiness cell + records fact-vs-plan gaps in the same commit as the
   dev_history file.
3. **Data-valid-as-of header** (`docs/process/document-header-convention.md`,
   GSL-237) — every new report/review/handoff carries the header.
4. **Skill-lesson checklist** (`skill/handoff/SKILL.md` Procedure step 7,
   GSL-189) — silence must be explicit ("no skill lessons this shift"), never
   implicit.

Any missing item = phase not closed.

## Why this exists (one-paragraph history)

Phase 1 of the PRD (`docs/prd/PRD-gosleep-evolution.md`) was marked DONE while
the watchdog it delivered had never been installed. The GSL-49 PR shipped 75/75
smoke, but `launchctl list | grep com.gosleep.watchdog` returned nothing for
104 orchestrator cycles. The armed-check gate exists so that class of failure
becomes visible at the closing step, not after the fact in an audit.

## Downstream references

- PRD constraint C9 (in `docs/prd/PRD-gosleep-evolution.md` after the
  2026-08-17 delta) points here.
- Delivery-workflow doc mentions the checklist as part of epic closure.
