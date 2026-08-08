# GSL-296 — Phase 7 re-scope: skills-publish items moved to skills-management phase

**Owner decision:** `d-2026-08-08-002` (2026-08-08, re: `q-2026-08-08-005`).
**Epic:** [GSL-250](https://ainstance-labs.atlassian.net/browse/GSL-250) — Interactive management web interface (control plane).
**Cycle:** 216 (shift 75, worker `rescope-250`).
**Branch:** `GSL-250-control-plane`.

---

## What was done

I executed the owner's re-scope decision. The "publish a skill" vertical — the button, the Skills screen, wiring the TouchID gate into a live write path, and the skills-registry writer — moved out of PRD Phase 7 (epic GSL-250) and into the skills-management epic ([GSL-174](https://ainstance-labs.atlassian.net/browse/GSL-174)), which the owner postponed. The web control plane epic now closes honestly on its own scope: SQLite as the source of truth, the Bun + Hono core on `127.0.0.1:7331`, the React 19 client, the questions loop, the permissions request card, the fleet view, the tasks view, cost, `/metrics`, the SessionAdapter seam, and the dev-flag-gated channels skeleton.

Concretely, one commit under this task carries every change: the PRD file `docs/prd/01-phase7-interactive-control-plane.md` sprouts a clearly-labelled "Moved to the skills-management phase (d-2026-08-08-002)" section that carries the removed acceptance items verbatim (F7-S3, the Scope table row about the "First write button 'Publish'", the "Skills" clause of F7-S1, the "publishes a skill via the TouchID prompt" End-check step, and the GSL-174 stages 2-3 dependency). Nothing is deleted — every item is relocated and annotated with a cross-link to the new home. Every existing "live" section (Goal, Scope, Success, Dependencies, End-check) got a short parenthetical pointing at the moved section so a reader arriving from a Slack link never has to reconstruct what changed.

On Jira, five tickets were re-parented from GSL-250 → GSL-174 (team-managed Jira supports this via the `parent` field): [GSL-266](https://ainstance-labs.atlassian.net/browse/GSL-266) (the first-write-button task itself), and the four verifier tickets [GSL-286](https://ainstance-labs.atlassian.net/browse/GSL-286), [GSL-287](https://ainstance-labs.atlassian.net/browse/GSL-287), [GSL-288](https://ainstance-labs.atlassian.net/browse/GSL-288), [GSL-292](https://ainstance-labs.atlassian.net/browse/GSL-292). Each got its `GSL-250` label rewritten to `GSL-174` plus two new labels (`moved-from-GSL-250`, `rescope-2026-08-08`); GSL-266 got the extra label `skills-publish`. A per-ticket comment cites the decision id, quotes the owner, and explains why the finding is still valid but scoped to a different epic. Epic-level summary comments landed on both GSL-250 (from-side) and GSL-174 (to-side). GH issue #266 (the only GH mirror any of these tickets have) got a matching move-comment.

PR #295 (the epic PR for GSL-250) had its body updated: the unchecked line for GSL-266 gained an inline "moved to skills-management phase per owner decision (d-2026-08-08-002)" annotation, and a new "Re-scope 2026-08-08" section names every moved ticket and links to this task. The PR stays open under GSL-250 acceptance and merges without the moved items. GSL-296 itself was added to the checklist as ticked, so the tasks list reads honestly.

## Problems solved

The main risk was Jira's free-tier hierarchy: I did not know up front whether the team-managed board would let me re-parent a Task across Epics via `editJiraIssue` `parent`, or whether I would have to fall back to link-only comments plus label-and-remove. I tested on the lowest-severity ticket first (GSL-292, MAJOR) and confirmed the re-parent worked cleanly — the new parent showed up on the very next `getJiraIssue`. That let me batch the other four without risking a half-migrated state.

The other trap was quiet content loss. The PRD is the design source of truth for anyone touching Phase 7 later; if I just deleted F7-S3 and the Scope row, a future reader would have zero context on why the "Publish skill" button they see everywhere in the target-architecture doc is missing from the PRD. The "Moved to the skills-management phase" section carries the removed content verbatim so the record survives in git without a spelunk into the diff, and every affected live section carries a parenthetical breadcrumb.

## Problems remaining

The four verifier tickets have no GH mirror. That is a general drift (GH numbering shares one counter with PRs, so the 1:1 mapping broke long before this task), not something to fix under a docs-only re-scope task. If the owner wants the GH mirror parity restored for the verifier tickets after this, a small companion task under GSL-296 (or a separate mirror-drift-fix task) is the right shape — not this commit.

The moved items are not yet re-planned inside GSL-174. That is deliberate: this task only re-parents and annotates. The next time the skills-management epic is picked up, its PRD will state F7-S3 as a GSL-174 success criterion and add tasks under it that discharge the moved verifier findings.

## Pitfalls & workarounds

- **Free-tier `parent` field is fully mutable in team-managed projects.** No custom-field `Epic Link` dance is needed; `editJiraIssue({fields: {parent: {key: "GSL-174"}}})` does it. The MCP `editJiraIssue` return payload does not always echo `parent` in its `fields`, which looks like a silent failure — verify with a follow-up `getJiraIssue` request, don't trust the write's mirror.
- **Labels replace, not merge.** `editJiraIssue({fields: {labels: [...]}})` overwrites the label array entirely. I had to read the previous labels off each ticket first and pass the full new list (rewritten `GSL-250` → `GSL-174`, existing tags kept, three new tags appended). Skipping this would have silently dropped tags like `architecture`, `security`, `verifier`.
- **PR body regenerated wholesale via `gh pr edit --body`, not appended.** `gh` has no append flag; a partial `--body` overwrites. I pasted the existing body verbatim, then edited only the two touched sections (the GSL-266 line and the new "Re-scope 2026-08-08" section) plus the new GSL-296 line. The SHA in the GSL-296 checklist line was left as `<SHA-296>` because the commit does not exist yet at PR-body-edit time; the next handoff or a follow-up PR-body-edit can substitute the real SHA after the commit lands. Not a data loss; just a small courtesy that will need one more one-line edit.
- **The "2 unchecked rows" mentioned in the brief.** The pre-rescope PR body had two unchecked lines: GSL-266 (moved by this rescope) and GSL-271 (final SoT switch — deferred for a 1-2 month soak, unrelated to the skills-publish move). I annotated GSL-266 with the moved-to-skills-management note and left GSL-271's annotation untouched — its "deferred (chronicler keeps writing JSONL as a 1-2 month rollback surface; flip after soak)" note is accurate and the owner has not asked to change it. If a future reader thought both unchecked lines should carry the same rescope note, that would be wrong — GSL-271 is a separate deferral with a different reason.

## What didn't make it

Nothing was attempted-and-dropped in this task. Every planned step landed. Two adjacent items were deliberately deferred out of this commit's scope: the substantive re-planning of the moved work inside GSL-174 (that belongs to the skills-management epic's own planning cycle), and the GH mirror parity fix for the four verifier tickets (a general mirror-drift issue, not this task's job).

---

## Technical reference

- **Files touched (docs only):** `docs/prd/01-phase7-interactive-control-plane.md`, `docs/dev_history/GSL-296-phase7-cycle216-rescope-skills-publish.md` (new), `docs/dev_history/README.md` (index entry).
- **Jira writes:** re-parent + label-rewrite + comment on GSL-266, GSL-286, GSL-287, GSL-288, GSL-292 (all → `parent: GSL-174`); create + transition-to-In-Progress on GSL-296 (`parent: GSL-250`); epic-level summary comments on GSL-250 and GSL-174.
- **GitHub writes:** PR #295 body updated (rescope annotation + new "Re-scope 2026-08-08" section + GSL-296 checklist entry); comment on issue #266 mirroring the Jira move-note.
- **Sources of truth read:** `docs/lab/decisions/log.jsonl` (`d-2026-08-08-002` verified), `docs/lab/questions/archive.jsonl` (`q-2026-08-08-005` answered by owner, channel=chat), `docs/prd/01-phase7-interactive-control-plane.md` (pre-edit).
- **Verification of intent:** post-edit `grep` on the PRD confirms every affected clause carries a pointer to the "Moved to the skills-management phase (d-2026-08-08-002)" section; post-edit `getJiraIssue` on GSL-292 confirms `parent.key = GSL-174`.
- **Gates:** `tools/lab/gate.sh --offline` — docs-only change, no code paths touched.
- **Model self-report:** Opus 4.7 (`claude-opus-4-7`, per owner's 2026-08-07 global pin; env=`ANTHROPIC_MODEL=claude-opus-4-7`).
- **Links:** Jira [GSL-296](https://ainstance-labs.atlassian.net/browse/GSL-296) · PR [#295](https://github.com/ainstance-labs/gosleep/pull/295) · Decision `d-2026-08-08-002`.
