# GSL-273 — PRD Phase 7 «Interactive control plane» appended (Phase 5 marked superseded)

## What was done

I added a superseded banner above `## Фаза 5` in `docs/prd/PRD-gosleep-evolution.md` — three-line quote block pointing at owner decision `d-2026-08-03-004` and at the new Phase 7, and appended a full new phase section `## Фаза 7 — Interactive control plane` immediately before the traceability matrix. Phase 7 follows the same structural template as the other five phases (Цель / Scope table / Success criteria F7-S1..S5 / Требования R7.1..R7.7 / Задачи with Jira keys / Оценка / Зависимости / Non-goals / Риски / Критерии приёмки). Every owner requirement from `d-2026-08-03-007` (as restated in `coverage.md` section 2 as R1..R7) gets its own R7.\* entry and its own success-criteria coverage. All references cross-link to `target-architecture.md` revision 2 and the rev-3 addendum.

The Phase 7 task list explicitly names the linchpin GSL-274 as the first executable task and lists the twelve reconciliation tasks the addendum spun off plus the five extension notes on GSL-263/264/265/267/268. Non-goals are called out explicitly (mobile, live steering, second SessionAdapter implementation, Vite 8, channels as v1 answer path, external Prometheus scrape, manifest-rule auto-synthesis) so a later reader does not try to fold them back in.

## Problems solved

Phase 5 in the PRD still described a static HTML dashboard as the target — the owner superseded that on 2026-08-03. Reading the PRD without knowing the decision log would leave anyone confused about "which UI is the target?" The banner + Phase 7 section makes the answer unambiguous: read Phase 7, not Phase 5; Phase 5 is archive.

The other problem this solves is anchoring — before Phase 7 was written, the seven owner requirements only lived in the audit `coverage.md` file. That file is a working artefact; the PRD is the durable source. Every downstream planner (this shift and future) can now cite `Phase 7 R7.4` (for example) instead of quoting a paragraph from a report.

## Problems remaining

Phase 5 tasks (1..6 under its own epic) are marked as archive by the superseded banner but not deleted or migrated to Phase 7 as concrete GSL keys. If Phase 5 had already spawned Jira tasks, those would need explicit closure. On inspection Phase 5 lived only as PRD text (no dedicated GSL epic — GSL-250 is Phase 7's epic, filed 2026-08-03), so nothing to close in Jira for Phase 5.

The traceability matrix (below Phase 7) still lists Phase 5 requirements (Ф5 · R5.1..R5.3) as active. Rewriting the matrix would be a separate change of concern — I left it as-is; the banner alone is enough to signal that Phase 5 is superseded.

## Pitfalls & workarounds

- The PRD mixes Russian narrative with English artefact names — Phase 7 continues that convention (same as Phase 5). A future contributor might be tempted to convert Phase 7 to full English to match the addendum; the PRD is Russian by design (owner-facing), only artefact names stay English.
- The Non-goals list is essential. Without it, a future reader could easily interpret "future-proofing" (R7.7) as "we ship two SessionAdapter implementations in v1" — the non-goal spells out seed only.
- Phase 7 references twelve new tasks by number in-line (GSL-272, GSL-273, GSL-274, plus nine more created in the same reconciliation cycle). If Jira numbering ever drifts (or the sub-tasks are re-parented), the PRD Task list becomes stale — the risk is small (one epic never re-numbers within itself) but worth noting.

## What didn't make it

- I did not rewrite the traceability matrix to include Ф7 · R7.\* rows. That's a follow-up worth doing but not blocking; the matrix stays consistent with itself and Phase 7 is comprehensively covered inside its own section.
- I did not update the Non-goals section of the "Общие Goals / Non-goals / Success criteria" top block. The Phase 7-specific non-goals are inside Phase 7 (canonical scoping); the top-level non-goals section is untouched.

## Technical reference

- Commit: (this file lands with the commit `GSL-273 [Docs][Web] PRD Phase 7 appended` on branch `GSL-250-control-plane`).
- Files touched: `docs/prd/PRD-gosleep-evolution.md` (superseded banner on Phase 5 + new Phase 7 section inserted before the traceability matrix). `docs/dev_history/GSL-273-web-prd-phase-7.md` (this file).
- Verified by running: none — this is a documentation artefact. Structural check: `grep -c '^## Фаза 7' docs/prd/PRD-gosleep-evolution.md` = 1; `grep 'SUPERSEDED' docs/prd/PRD-gosleep-evolution.md` shows the Phase 5 banner.
- Links: Jira [GSL-273](https://ainstance-labs.atlassian.net/browse/GSL-273); parent epic [GSL-250](https://ainstance-labs.atlassian.net/browse/GSL-250); sibling doc [GSL-272](https://ainstance-labs.atlassian.net/browse/GSL-272); sources — `docs/reports/web-harness-research-2026-08-03/target-architecture.md`, `docs/reports/web-harness-research-2026-08-03/target-architecture-rev3-addendum.md`, `docs/reports/web-stack-audit-2026-08-06/coverage.md`, `docs/lab/decisions/log.jsonl` entries `d-2026-08-03-004`/`006`/`007`.
