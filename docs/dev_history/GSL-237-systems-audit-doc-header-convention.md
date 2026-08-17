# GSL-237 — data-valid-as-of header convention

Epic: GSL-236 (systems-audit process tail).
Branch: `GSL-236-systems-audit-process-tail`.
Source-of-truth: `docs/reviews/system-audit-2026-07-24/SYNTHESIS.md`, finding 28
(MAJOR); PRD-delta-draft.md operation 14 (Reporting pillar).

## What landed

- `docs/process/document-header-convention.md` — the aging rule: every
  document under `docs/reports/`, `docs/reviews/`, `docs/handoff/`,
  `docs/runbooks/`, `docs/process/` (and standard READMEs in those trees)
  opens with a three-line block: data-valid-as-of date, updated-by handle +
  Jira key, one-line scope. Silence = defect.
- Exemptions named explicitly: `docs/dev_history/*` (already point-in-time,
  keyed by task) and `docs/prd/*` (has its own Status / delta history contract
  per GSL-238).
- HTML dashboards get the equivalent contract via a byline block in the report
  header (the `agentic-report-creator` template update is a follow-up, not
  this task).

## What is out of scope

- Backfilling the header into every legacy document — the rule bites forward.
  The doc names the five audit-flagged reports as the priority backfill and
  leaves the rest for the shifts that touch them next.
- Automated gate that rejects headerless docs — mission bans additions to
  gate.sh here; the enforcement layer is careful self-review at closing time.

## Verification

- Doc lint: two files land (the convention itself + this dev_history entry);
  both carry the header block per the convention they codify.
- No script changes → no `bash -n` needed.
- Cross-reference from `docs/process/phase-acceptance-checklist.md` (GSL-236)
  is already in place ("Data-valid-as-of header" item in the four-item
  closing checklist).
