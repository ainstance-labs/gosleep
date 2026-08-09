# GSL-186 (T8) — handoff path + wiki + dev_history filename

**Date:** 2026-08-10 · **Branch:** `GSL-174-skills-management`

Root-cause fix for three cheap discrepancies audit-flagged as findings 72, 73, 74 (see GSL-186 description). Zero-diff skills before this landed — both target skills (`handoff`, `delivery-workflow`) had identical global + repo copies, so a pointwise `rsync -a skill/<name>/ ~/.claude/skills/<name>/` is safe once the owner signs off (CLAUDE.md rule).

## What landed

- `skill/handoff/SKILL.md` quick-paths table (line 107): "Where it goes" cell now names `docs/handoff/<NN>-<YYYY-MM-DD>-handoff-<topic>.md` with `<NN>` explicit and a one-liner on how to compute it (`ls docs/handoff/ | grep -oE '^[0-9]+' | sort -n | tail -1` + 1). Matches the top-of-file spec at line 10 — the quick-paths table was previously missing `<NN>`, so a fresh cold-start following the table produced non-ordinal filenames that a docs-anchor checker mis-parses.
- `skill/delivery-workflow/SKILL.md` §3:
  - Path spec (line 67): `docs/dev_history/<TASK-KEY>-<phase>-<slug>.md` — matches `CLAUDE.md` verbatim. Cycles (`-cycle<N>-`) are documented as an OPTIONAL insertion between phase and slug for projects that use them (TLM-era); explicit note that gosleep is cycle-less, so the tight `GSL-N-phaseM-slug.md` form applies.
  - Wiki bullet (line 89): rewritten from "If the project keeps an LLM wiki…" to a stronger "IF AND ONLY IF" with explicit "gosleep does NOT" and "do NOT create the directory on the fly". Removes the pre-existing implicit "if" ambiguity that pushed some agents to try to touch `docs/wiki/` in gosleep.
  - Close-out step (line 112): dev-history index update stays unconditional; wiki update is explicitly conditional on the wiki existing.

## Live-proof (grep verifications)

- `grep -n docs/handoff/ skill/handoff/SKILL.md` → both the top-of-file spec AND the quick-paths table now include `<NN>`.
- `grep -n docs/dev_history/ skill/delivery-workflow/SKILL.md CLAUDE.md` → both files' path forms match: `<TASK-KEY>-<phase>-<slug>.md` (with cycles noted as optional in the skill).
- `grep -n docs/wiki skill/delivery-workflow/SKILL.md` → three occurrences remain, all inside conditional prose ("If AND ONLY IF", "otherwise skip it").

## Design notes

- **Zero-diff → safe pointwise rsync.** Both skills' global copies match the repo copies exactly before this commit (verified against the governance-plan measurement 2026-08-03 which reported both as 0 lines drift). After this commit lands and the owner runs `rsync -a skill/handoff/ ~/.claude/skills/handoff/` + same for `delivery-workflow/`, the global copy carries the fix without waiting on stage 1 (GSL-251) full reverse-sync. The full publish flow (T3, T5) is the recommended path once the TouchID pause lifts.
- **Cycle-friendly.** The `-cycle<N>-` insertion is optional, not removed — the skill supports both the TLM-era cycle-based history and the gosleep cycle-less form without a fork.
- **Conservative wiki language.** "IF AND ONLY IF" + "do NOT create the directory on the fly" closes the door on the ambiguity that let the old wording get interpreted as "always update the wiki".

## Follow-ups

- After merge: owner runs `rsync -a skill/handoff/ ~/.claude/skills/handoff/` and `rsync -a skill/delivery-workflow/ ~/.claude/skills/delivery-workflow/` — pointwise, allowed under the CLAUDE.md rule for non-orchestrating-delivery-agents skills. Or waits for a real publish via T3/T5 when TouchID lifts.
- GSL-190 (`tmux-agents-orchestration` reverse-sync) stays owner-gated; not this ticket.
