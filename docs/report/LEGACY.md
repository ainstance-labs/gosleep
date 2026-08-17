# LEGACY — `docs/report/` is historical, not maintained

> **Data valid as of:** 2026-08-17.
> **Updated by:** wave4b (GSL-241, systems-audit process tail).
> **Status:** FROZEN. This directory is preserved as an historical artefact
> and is NOT the active reports location.

---

## Where to go instead

- **Verification runs** (per-epic HTML dashboards, EN + RU, screenshots,
  regression lane): `docs/reports/verifications/<EPIC-KEY>/runs/NN/` — the
  active standard is `docs/reports/verifications/README.md` (see also GSL-239
  update).
- **Ad-hoc reports** (audits, research, benchmarks, incident post-mortems):
  `docs/reports/<slug>/index.html` — one folder per report, English primary,
  Russian mirror under `<slug>/ru/`, per the reporting convention.
- **Live control-plane data** (armed/not-armed tile, RUNWAY, fleet, cost,
  tasks, questions): served by the web control plane at
  `http://127.0.0.1:7331` — see `docs/runbooks/gosleep-core.md` and
  `docs/prd/01-phase7-interactive-control-plane.md`.

## What this directory is

The `docs/report/` tree was the project's original HTML knowledge base:
static pages (`agents.html`, `architecture.html`, `study.html`,
`subagents.html`, etc.) built by `build-*.py` / `build-*.js` generators
against the pre-GSL research corpus. It predates the current reports layout
(`docs/reports/`, plural, GSL-138 era) and the web control plane (GSL-250
era).

## Why it is kept

- **Reference for historical claims.** Several early dev_history files and
  handoffs reference specific pages under `docs/report/` (see e.g.
  `docs/dev_history/GSL-2-init-harness-import.md`,
  `docs/handoff/03-2026-06-26-*.md`). Removing the tree would break those
  historical citations.
- **Rollback surface.** If a future need surfaces to inspect what the
  project's own understanding looked like at that time, the pages are
  intact and openable from `file://`.

## What the project does NOT do here

- **No new content lands under `docs/report/`.** New reports go to
  `docs/reports/**`. If a shift finds itself wanting to edit a file under
  `docs/report/`, the shift is on the wrong path.
- **No generators are re-run.** The `build-*.py` / `build-*.js` scripts in
  this directory are not part of any current gate, hook, or cron.

## Relationship to the sibling deletion

The audit finding 77 named two duplicate-path pairs: `docs/report` vs
`docs/reports/`, and `docs/dev_history/` vs `docs/dev-history/` (hyphen).
The second pair was resolved by owner directive 2026-07-26: the legacy
`docs/dev-history/` (hyphen) tree was deleted outright as no longer
relevant, and CLAUDE.md's "Delivery conventions" section explicitly
instructs future shifts not to recreate it. This directory takes the
softer path (mark, preserve, redirect) because its content is still cited
by tracked historical files under `docs/dev_history/` and `docs/handoff/`.
