# PRD maintenance — delta at every epic closure

> **Data valid as of:** 2026-08-17.
> **Updated by:** wave4b (GSL-238, systems-audit process tail).
> **Scope:** rule that keeps `docs/prd/**` from decaying into an historical
> document; the closing gate that binds a PRD update to every epic merge.

The shift-73 audit found 24 (MAJOR): the master PRD had not been updated once
across six delivered phases and had drifted into an historical document.
Follow-up findings 29 (MAJOR — economic premise about `claude -p` frozen in
PRD without a source) and 30 (MAJOR — `telemetry.jsonl` declared in PRD but
never existed on disk) were the symptoms. The root cause: nothing in the
delivery workflow forced a PRD look-in when the epic that changed reality
merged. This convention closes that gap.

---

## The rule (one sentence)

**A PRD delta is a mandatory part of every epic closure, in the same commit
scope as the closing dev_history file, and its absence blocks the "phase
DONE" state.**

## What counts as a PRD delta

A delta is one of:

- **Readiness cell update** — the phase map's Readiness column moves to the
  new value with a proof reference (Jira epic + PR, or an `armed-check`
  receipt line). This is the minimum: a phase that shipped any user-visible
  change must move its Readiness cell.
- **Fact-vs-plan reconciliation** — the epic's outcome differs from what the
  PRD promised (a requirement was dropped, redirected, or something the PRD
  did not name landed anyway). The delta names the difference and, when
  material, records why.
- **New owner directive** — the epic captured a new standing rule from the
  owner. The rule lands in the PRD's constraints table or the relevant phase's
  requirements block, with the date and a pointer to the decision (the
  `docs/lab/decisions/manifest.md` entry or the ORCHESTRATION-STATE line).
- **Removal of a stale claim** — the epic proved something the PRD stated no
  longer holds. The claim is struck through or replaced, with the delta note
  citing the receipt (`GSL-238` operations 3 + 10 for `claude -p` billing and
  `telemetry.jsonl` respectively are the reference case).

## Where the delta lives

- **Master PRD** (`docs/prd/PRD-gosleep-evolution.md`): the phase map, the
  constraints table, and the risk / decision-log sections. The status block
  at the top ("Data valid as of / Updated by / last delta") moves to the
  current shift date.
- **Per-phase PRD** (`docs/prd/NN-phaseMM-<slug>.md`): the affected
  requirement's Readiness cell, plus a "Delta 2026-MM-DD" note when the
  requirement's meaning changed.
- **Decision log** at the bottom of the master PRD: a row for any new owner
  directive or audit-derived rule that was applied.

## When the delta lands

Same commit as the closing dev_history file for the acceptance task, so PR
history preserves the "epic done" and "PRD reflects it" as an atomic pair.
This is the same commit-scope rule that binds dev_history to code (`CLAUDE.md`
delivery conventions).

## Interaction with the closing checklist

PRD delta is item 2 of the four-item phase acceptance checklist
(`docs/process/phase-acceptance-checklist.md`, GSL-236):

1. `ARMED-CHECK` block (GSL-236)
2. **PRD delta (this doc)**
3. Data-valid-as-of header on new reports/reviews/handoffs (GSL-237)
4. Skill-lesson checklist (`skill/handoff/SKILL.md` Procedure step 7, GSL-189)

Any missing item = phase not closed.

## Two concrete fixes this rule ships in its own commit

The audit named two live drifts that must be corrected as part of introducing
this rule (so the rule is not born already broken):

- **`claude -p` billing claim.** The PRD's constraint C3 and Risk section (b)
  both stated `claude -p` is billed from the programmatic credit pool at API
  rates. Anthropic's own source page (`support.claude.com`, verified
  2026-07-24 and re-verified 2026-08-17) reads: "Update June 15: We're
  pausing the changes… For now, nothing has changed: Claude Agent SDK,
  `claude -p`, and third-party app usage still draw from your subscription's
  usage limits." Live runs on this machine confirm subscription usage
  (`provider: firstParty`, no API key). C3 and Risk (b) both rewritten to
  reflect: (1) the billing model is NOT established, (2) the pause is
  reversible, (3) polling via `-p` is forbidden on cost grounds regardless
  (≈ $0.30 per call × zero cache reuse ≈ $48 for an eight-hour night).
- **`telemetry.jsonl` phantom file.** Phase 4 layout (`R4.3`) listed
  `telemetry.jsonl` as a gitignored artefact. No writer ever existed; no
  reader depends on it (Cost view builds telemetry from
  `ORCHESTRATION-STATE.md`). Removed from the layout with a delta note that
  cites the removal and instructs any future re-introduction to ship the
  writer alongside the layout entry (constraint C9).

## Failure signal

If the master PRD's "last delta" date is more than two closed epics behind
`main`, this rule is not being enforced and the enforcement needs to be a
mechanism, not a reminder — see constraint C9 and the historical class of
failures where prose rules held zero times and mechanisms held every time
(shift-73 audit synthesis).

## What this doc consciously does NOT do

- Does not require rewriting phase-body text on every epic — only the
  Readiness cell + material changes. Wholesale rewrites are a separate,
  larger authoring effort (Phase-7 and Phase-8 authoring PRDs exist as
  separate per-phase files under `docs/prd/`).
- Does not backfill the phase map for every historical epic. The rule bites
  forward from 2026-08-17; anything before that is a snapshot in dev_history
  and stays there.
- Does not extend to the per-phase PRDs' own drafts before they are marked
  Live. A PRD in `Draft` state is under active authoring; the delta rule
  starts applying once the phase's first task lands.
