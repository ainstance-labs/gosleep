# GSL-240 — lessons-learned/ and adr/ folders created

Epic: GSL-236 (systems-audit process tail).
Branch: `GSL-236-systems-audit-process-tail`.
Source-of-truth: `docs/reviews/system-audit-2026-07-24/SYNTHESIS.md`, finding
77 (MAJOR); tasty-lunch reference the owner named.

## What landed

Two new top-level directories under `docs/`, each with its own README (index
+ template + relationship-to-other-stores) and one seed entry:

- **`docs/lessons-learned/`**
  - `README.md` — durable home for lessons that survive the shift that
    bought them; template with cost / class / mechanism fields; explicit
    boundary between "belongs in a skill" vs "belongs here" vs "belongs in
    an ADR"; index at the bottom.
  - `LL-0001-no-git-stash-in-shared-tree.md` — the 2026-07-13 data-loss
    incident (resolve-patches to `queue.jsonl` destroyed by `git stash` in
    the shared tree); the current mitigation lives in the CLAUDE.md HARD
    BANS and in every worker brief.
- **`docs/adr/`**
  - `README.md` — durable home for architectural / process decisions with
    context, options, consequences; supersession contract (superseded ADRs
    stay); template; boundary vs PRD, decision manifest, ORCHESTRATION-STATE,
    lessons-learned, skills; index at the bottom.
  - `ADR-0001-adopt-phase-acceptance-checklist.md` — first accepted
    decision: the four-item epic-closure gate (armed-check + PRD delta +
    data-valid header + skill-lesson checklist) shipped in Wave-4b under
    GSL-236 / GSL-238 / GSL-237 / GSL-189.

## Adjudication

The audit named the tasty-lunch reference as the owner-approved source of
the pattern (both directories with indexed entries). I did not have
tasty-lunch's tree in scope, so the two READMEs draw the template + boundary
rules from the pattern language the audit used and from the surrounding
project's existing stores. Any future imports from tasty-lunch's own ADR /
LL corpus can land as separate serialised entries.

## Why one seed entry each (and not the full backlog)

The audit named "three-to-four homeless lessons" as the immediate need. The
Jira acceptance criterion is: "each folder has an index and at least one
entry; no audit-listed lesson stays homeless". Landing more than one entry
per store in this task would either duplicate content already in CLAUDE.md
/ MEMORY / skills (a naming decision, not new knowledge) or would front-run
future shifts that have live context on those lessons. The seed entries
prove the pattern works; the shifts that touch those areas add their own.

## Verification

- No script changes → no `bash -n` needed.
- File-tree check: `ls docs/lessons-learned` = README.md + LL-0001; `ls
  docs/adr` = README.md + ADR-0001. Both indexes list their one entry.
- Cross-refs: ADR-0001 points at `docs/process/phase-acceptance-checklist.md`
  (GSL-236, committed in this branch). LL-0001 points at the CLAUDE.md HARD
  BANS (already in place). Both READMEs point at each other under
  "Relationship to other stores".
