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

---

## Correction note — GSL-273 rework (2026-08-07, shift 75 cycle 197, worker `web-docs-fix`)

**Why reworked.** The original cycle-195 landing (commit `4197157`) violated two owner rules that were pinned as authoritative on 2026-08-07:

1. **Language rule (owner, 2026-08-07):** ALL work artefacts are ENGLISH — PRDs, technical files, Jira issue texts/comments, GitHub mirrors, handoff and state files. Russian is retained only in human-facing HTML reports. A legacy file's existing language does NOT override this rule — the "PRD monolith is Russian by design" defence encoded in the original dev history "Pitfalls & workarounds" section was wrong.
2. **PRD file-layout rule (owner, 2026-08-07):** ONE file per phase, named `<NN>-phase<MM>-<slug>.md` (e.g. `28-phase37-tool-surface-config.md`). New phases MUST NOT be appended to the monolith.

**What changed in this follow-up.**

- New per-phase PRD created: `docs/prd/01-phase7-interactive-control-plane.md` — the full Phase 7 content translated 1:1 into English, scope unchanged, structure preserved (Goal / Scope / Success criteria F7-S1..S5 / Requirements R7.1..R7.7 / Tasks / Effort / Dependencies / Non-goals / Risks / Acceptance + end-check / References). Adds a line noting the GSL-274 smoke-test result (PASS, primary primitive = `allow`+`updatedInput{questions, answers}`).
- The Russian Phase 7 section previously appended to `docs/prd/PRD-gosleep-evolution.md` (lines 665-854 as of `4197157`) was removed and replaced with a 3-line English pointer that names the per-phase file and dates the extraction.
- The Phase 5 supersede banner (which was previously mixed English + Russian header + inline pointer) is now fully English, and includes a pointer to `01-phase7-interactive-control-plane.md`.
- `docs/prd/README.md` — English rewrite of the index plus a new "Convention — per-phase PRD files" section documenting the 2026-08-07 owner rule for future contributors.
- Legacy Phases 1-6 in `PRD-gosleep-evolution.md` are intentionally NOT translated — they remain a Russian historical archive per the mission scope from team-lead. The traceability matrix, risk register, and decision log in that file are likewise left in place unchanged.

**Jira / GitHub sweep.** Cycle 195's own artefacts (epic reconciliation comment on GSL-250, descriptions of GSL-272..283, extension comments on GSL-263/264/265/267/268, GitHub mirror bodies #282..#293) were already English on inspection — no rework needed. Six legacy "Зеркало GitHub: #N" one-liner comments from 2026-08-03 on GSL-250/263/264/265/267/268 were updated to English "Mirrors GH #N" as an incidental cleanup under the same owner language rule.

**Files touched by this correction.**

- `docs/prd/01-phase7-interactive-control-plane.md` (new).
- `docs/prd/PRD-gosleep-evolution.md` (Phase 5 banner fully English; Russian Phase 7 body replaced with a 3-line English pointer).
- `docs/prd/README.md` (English index + per-phase convention note).
- `docs/dev_history/GSL-273-web-prd-phase-7.md` (this correction note).
- Jira comments 12891/12904/12905/12906/12908/12909 (Russian → English one-liners) — content-level Jira edits, no repo change.

**Owner rules referenced.**

- `/Users/romanlidovskyi/.claude/CLAUDE.md` — "Language of artifacts (ALL projects — owner rule, 2026-08-07)" and the PRD per-phase filename convention.
- Memory note: `prd-english-per-phase-files` and `terminology-skills-management-system`.

**Verified by.** `grep -n "^## Phase 7\|^## Фаза 7" docs/prd/PRD-gosleep-evolution.md` returns exactly one hit (the English pointer heading). `ls docs/prd/*.md` shows both the monolith and `01-phase7-interactive-control-plane.md`. Structural read confirmed the traceability matrix directly follows the pointer with no orphan block.
