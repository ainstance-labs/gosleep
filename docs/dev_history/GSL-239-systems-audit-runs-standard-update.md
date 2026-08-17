# GSL-239 — verification runs standard updated to match practice

Epic: GSL-236 (systems-audit process tail).
Branch: `GSL-236-systems-audit-process-tail`.
Source-of-truth: `docs/reviews/system-audit-2026-07-24/SYNTHESIS.md`, finding
55; on-disk practice across `docs/reports/verifications/GSL-138/runs/01..04/`
+ `GSL-250/runs/01-02/` + `GSL-174-night/runs/01/`.

## What landed

Update to `docs/reports/verifications/README.md`:

- **Data-valid-as-of header** added at the top (per GSL-237 convention).
- **`regression/` lane described** — appears from run 02 onward as a separate
  HTML sub-page (`regression/index.html`) that carries the status of previous
  runs' items. Ran the on-disk survey: GSL-138 runs 02/03/04 all carry
  `regression/`; run 01 does not, as expected (no prior run).
- **`design/ru/` fate documented** — required only in the reference run 01;
  runs 02+ reference the same visual system overview by link and skip the
  bilingual copy unless the design system materially changed. Confirmed
  on-disk: GSL-138/runs/01/design/ carries `ru/`, runs 02/03/04 carry only
  `pages/` (design system unchanged across the cycle).
- **LANDED / PARTIAL / NOT-LANDED assert made explicit** — three-constant
  status is the only allowed value; each numbered item must carry one;
  status-less items are equivalent to NOT-LANDED and MUST be resolved to one
  of the three at run assembly. Every constant carries a one-line meaning so
  writers of new runs cannot invent a fourth or drop a status silently.

## Verification of the assert on existing runs

On-disk sampling with `grep` across the four GSL-138 runs shows the
constants are present in the HTML (LANDED / PARTIAL / NOT-LANDED tokens
render as status pills). The audit finding 55 noted absence in runs 02 + 04;
that absence is now a defect against the standard (the standard was silent
before this update — now it names the assert). A dedicated backfill task
across the four flagged runs is out of scope here (it would touch built HTML
dashboards and belongs with the shift that produces the next run of each
epic).

## What is out of scope

- Backfilling the standard onto the four flagged legacy runs — the rule
  bites forward. The next run of each of those epics carries the assert.
- Adding an automated linter that greps for the constants at
  gate.sh time — mission bans additions to gate.sh here; the enforcement is
  careful self-review at run publication time (same posture as the
  document-header convention, GSL-237).

## Files touched

- Edit: `docs/reports/verifications/README.md`
- New: `docs/dev_history/GSL-239-systems-audit-runs-standard-update.md`
- Index: `docs/dev_history/README.md`
