# GSL-306 — [Docs] PRD Phase 8: skills management system

**Date:** 2026-08-10 (night-autonomy session `d-2026-08-09-005`)
**Author:** impl-174-1
**Commit:** (see `git log docs/prd/02-phase8-skills-management.md`)

## What landed

- New per-phase PRD file `docs/prd/02-phase8-skills-management.md`, English, ~230 lines. Metadata block names epic GSL-174, parent PRD, design source of truth (`docs/plans/skills-governance-plan.md`), the target-architecture rev-2 + rev-3 addendum Delta 4, this worker's execution plan, and the language-rule pointer.
- Success criteria F8-S1..F8-S7 per plan section 3.
- Scope table (In / Out) covering the ten tonight-buildable tasks and calling out the eleven owner-gated tasks as explicit deferrals.
- Requirements R8.1..R8.6 (owner-gesture layer non-optional, four-layer defense stays intact, live filesystem read, idempotent+auditable publish, git-tracked registry, authority-inversion respect).
- Tasks section mapping every one of the 21 GSL-174 children to a T1..T10 / O1..O11 slot (with the T1 slot filed as GSL-306 itself for PRD provenance).
- Dependencies + non-goals + risks (from plan section 5) + open questions (with recommended defaults) + sources.
- `docs/prd/README.md` gets a new index row for `02-phase8-skills-management.md`.
- `docs/plans/skills-governance-plan.md` gets a header pointer at the English PRD (Russian doc stays as historical reference per owner rule 2026-08-07).

## Why this shape

- The PRD is written to match the Phase 7 file's skeleton so the pattern stays uniform (metadata block → positioning → goal → scope table → success criteria → requirements → tasks → dependencies → non-goals → risks + open questions → sources). Anyone who already read Phase 7 finds their way here without re-orienting.
- Terminology enforced verbatim per memory `terminology-skills-management-system.md` (owner 2026-08-07): "skills management system" / «система управления скилами», never "skills" alone.
- No section-sign glyph anywhere in the text — owner rule 2026-08-07, memory `no-section-sign-in-text.md`.
- Only the safe (already-zero-diff) content edits are named as tonight-buildable — the authority inversion (`d-2026-07-20`) is called out explicitly on GSL-182..190 minus GSL-186 + GSL-189.
- The TouchID pause (`d-2026-08-09-001`) is threaded through every relevant success criterion so tonight's interim TTY-confirm shape does not accidentally get promoted to "shipped" — it is an explicit interim, one function call from the TouchID leg.

## Verification

- Read the PRD end-to-end after write.
- README row is placed after the Phase 7 row for chronological ordering.
- Governance-plan header pointer added at the top so a reader landing on the Russian doc first sees the pointer immediately.
- Dev-history file follows the owner's `<KEY>-phaseNN-slug.md` convention (see `docs/dev_history/README.md`).

## Next in the epic

T1 lands under GSL-252 (registry file + JSON schema + validator), then T2..T10 per plan section 4.3 execution order. Owner-gated tasks (O1..O11) are named in the PRD and the epic PR body but are not touched tonight.
