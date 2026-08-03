# Handoff 50 — 2026-07-28 — impl-175: epic GSL-175 "Evening hygiene" delivered in full

## Part 1 — what happened, plain words

I am worker impl-175, shift 74. In one session I executed the whole of epic GSL-175 (priority 2
of the 2026-07-24 audit improvement plan): seven tasks, seven commits, one PR.

What is different now:

- **The question archive no longer loses resolved items.** The chronicler compared statuses to
  `auto_resolved` (with an underscore), while the queue writes hyphens — the archive held 2
  records out of 21+. Now "closed" is `status != open`, and after a rebuild the archive has all
  27 closed questions, the number verified against `lab-emit list`. Smoke has an assert
  "archived == closed" that will not let this come back.
- **The spend tile has stopped lying in the reassuring direction.** It took the last line of the
  hand-written ledger instead of the maximum (undercount was 1 672 000 tokens). Now max() and a
  sorted table; on live data the tile is 18 900 000 == max of the table.
- **The library sees everything it exists for.** Reports and Reviews shelves became recursive:
  verification runs (5 top pages) and the entire 2026-07-24 system audit (11 md) are now on the
  shelves; a Skills shelf appeared for the project's own skills (10 files).
- **The queue's README starts with a prohibition** on reading queue.jsonl line by line — only
  `lab-emit list` (auditors themselves tripped on raw reading).
- **I did not touch the sovereign ORCHESTRATION-STATE.md.** An errata is prepared for it
  (`docs/handoff/GSL-195-errata-orchestration-state.md`): two verbatim replacements for the
  cycle=105 line (13 of 19 → 10 of 20; "at the same second" → −2h; 0 of 21 → 3+~8) plus a ready
  Standing rules line on "do not silently commit a bundle with grade != fresh". Applied by the
  orchestrator or owner.
- **GH #146 closed** (Jira GSL-144 has long been Done); GSL-107/#121 deliberately not touched — the
  contour the owner froze, this is recorded in the close comment.
- **The bundle was rebuilt as the branch's last commit and at commit time was fresh** — exactly
  what finding 23 required. The rule on grade is written in docs/lab/README.md (Rebuild discipline).

A small inaccuracy to be aware of: commit GSL-193 also carried 7 append-only queue patches that
the orchestrator had not yet committed (auto-resolves 06:52Z + owner's answer 07:23Z). The data
is correct and identical, the merge with the orchestrator ledger will be clean, but by rights they
should have been carried by the ledger — I stopped staging queue.jsonl in later commits.

## ORCHESTRATOR REPORT

- **Branch:** `GSL-175-evening-hygiene` from 77353f7, pushed. **PR #252** (title `GSL-175 …`,
  Implements + checklist + Mirrors GH #175 + closes before each number). **NOT merged** — merge on
  the orchestrator, regular merge (one commit per task).
- **Jira:** epic GSL-175 → In Review; all 7 tasks (GSL-191..197) → Done. GH mirrors #191..#197
  will close on merge (in closes); #146 closed manually with a comment.
- **Commits:** GSL-191 `a7d0e1c` · GSL-192 `f4ba846` · GSL-193 `20ec411` · GSL-196 `456c36a` ·
  GSL-195 `71fb0b6` · GSL-197 `c308eba` · GSL-194 `376fe74` (last = rebuild, grade fresh).
- **Gates:** smoke 450/452 → **460/462** (+10 epic asserts, all green; 2 failures pre-existing —
  fixture waits for the morning digest of the current date; NOT masked, backlog candidate);
  hooks-verify 14/14; tsc 0 errors; chronicler 7 pages. Gates were run in the clone
  `.artifacts/gsl175-gate` (gotcha: main() at import); the clone had origin reset to the GitHub URL,
  otherwise R4.2 falsely fails (gh resolves the repo from remote).
- **NEEDS ORCHESTRATOR/OWNER ACTION:** apply the errata
  `docs/handoff/GSL-195-errata-orchestration-state.md` to sovereign STATE (2 replacements + 1
  Standing rules line). After merge — a standard chronicler pass on main (merge residue, norm
  GSL-150).
- **Questions:** q-2026-07-28-001 (DECISION, mask width for the Reports shelf: `**/index.html`
  shows sub-pages of runs too; default "completeness" applied, reversibility high). No BLOCKERs.
- **Deviation:** commit GSL-193 also carried 7 foreign append-only queue.jsonl patches (see Part 1);
  I do not consider it an incident, but I record it.

## Formal part

- **Session:** teammate impl-175 (Opus/Fable 5, pane %11), shift 74, 2026-07-28 ~07:15–08:10Z.
- **Task files:** histories — `docs/dev_history/GSL-19{1,2,3,4,5,6,7}-hygiene-*.md` + index;
  code — `tools/lab/chronicler.py` (archive filter, cost max+sort, LIBRARY_SECTIONS),
  `tools/lab/ui/src/screens/cost.tsx`, `tools/lab/smoke.sh` (+10 asserts: GSL-191 ×2,
  GSL-192 ×4, GSL-193 ×4 + updated test 14); docs — `docs/lab/questions/README.md`,
  `docs/lab/README.md`, `docs/handoff/GSL-195-errata-orchestration-state.md`;
  derivatives GSL-194 — render_bundle/status/7 pages/mobile/digest-2026-07-28/archive.jsonl.
- **Epic acceptance ("counts as done when"):** archive == closed (27 == 27) ✓; tile ≥ max
  of its own table (18 900 000 == max) ✓; the 2026-07-24 system audit visible from the Library (11 md
  on the Reviews shelf; dashboard on Reports) ✓; committed bundle grade = fresh ✓.
- **Not done:** PR merge; edits to sovereign files; mobile/push contour; Workflow tool;
  force-push/amend/stash; browser checks (not needed — only file:// pages, verified from bundle
  data and smoke).
