# GSL-236 — armed-check as phase acceptance criterion

Epic: GSL-236 (systems-audit process tail).
Branch: `GSL-236-systems-audit-process-tail`.
Source-of-truth: `docs/reviews/system-audit-2026-07-24/SYNTHESIS.md`, finding 89
(MAJOR); PRD-delta-draft.md operation 5 (constraint C9).

## What landed

- `docs/process/phase-acceptance-checklist.md` — the new closing convention:
  every phase acceptance runs `tools/lab/armed-check.sh` and quotes an
  `ARMED-CHECK` block in the dev_history file + handoff. Off-record mechanisms
  are named explicitly with a reason; silence = defect.
- The doc names the receipt path (`.artifacts/lab/gates/armed-check.json`) and
  the four other closing items that ride alongside it (PRD delta, data-valid
  header, skill-lesson checklist).

## Why this shape (not code)

`tools/lab/armed-check.sh` already exists (GSL-211, epic GSL-178). It reads
config, checks session identity, cadence, plist, and ledger, then writes the
JSON receipt. The gap the audit named was not tooling — it was the closing
convention that owed the receipt a home. That is what the new doc supplies.

## What is out of scope

- Wiring `armed-check` into `gate.sh`: `gate.sh` is a fast, side-effect-free
  pre-commit gate; `armed-check` probes launchd and the live tmux, so it is a
  phase-closing action, not a per-commit one. The right hook is the checklist,
  which the shift owner runs at closure time.
- PRD constraint C9 itself — recorded separately under GSL-238 (PRD delta),
  which cross-references this doc.

## Verification

- `bash -n` clean on `tools/lab/armed-check.sh` (script untouched; sanity only).
- Doc lint (self-review): headings hierarchical; no broken cross-refs; English
  throughout per owner rule 2026-08-07; carries data-valid header per GSL-237.
