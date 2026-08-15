# GSL-189 (T9) — shift-closing checklist for skill edits

**Date:** 2026-08-10 · **Branch:** `GSL-174-skills-management`

Root-cause treatment for R5 ("learning loop has no executor" — audit finding 3, MAJOR). The lesson-to-skill loop worked for 30 days and stopped on 2026-07-10 because nothing in the shift-closing procedure *required* an agent to record what it just learned back into an authoritative skill.

## What landed

- New Procedure step 7 in `skill/handoff/SKILL.md` — a three-item checklist the shift-closing agent runs BEFORE writing the handoff:
  - **(a)** Skim shift transcript / dev-history / decisions for a lesson worth re-recording. If none, explicit "no skill lessons this shift" line in the handoff Comments — silence is not the same as absence.
  - **(b)** If yes: open a `[Skill]`-tagged GSL Task, edit the right copy (repo for non-authoritative; owner-only for `orchestrating-delivery-agents` per authority-inversion `d-2026-07-20`), publish via `tools/skills/publish.sh <name>` (or the Skills web page once TouchID unpauses). Never bypass `publish.sh`.
  - **(c)** Record the lesson-to-Task link in the handoff's "Comments & recent decisions" section so the next shift can see what improved.
- New "Editing a skill IS a shift-closing item" paragraph in `CLAUDE.md` "Skill source of truth" section, pointing at the three-item checklist in `skill/handoff/SKILL.md` step 7 and citing GSL-189 + R5 explicitly.

## Design notes

- **The checklist LIVES in the handoff skill, not in orchestrating-delivery-agents.** The Jira description names `orchestrating-delivery-agents` as the target — but that skill is authoritative-in-global (`d-2026-07-20`), so an agent editing its repo copy tonight would either lose the change on stage-1 reverse-sync or produce a merge conflict. Handoff SKILL.md is zero-diff, safe to edit + pointwise-sync. Owner can port the same rule into `orchestrating-delivery-agents` at their global copy when convenient; the CLAUDE.md rule + the handoff step ensure the rule takes effect for every shift-closing worker regardless.
- **Handoff is the natural venue.** The handoff IS the shift-closing artifact; adding the check to its Procedure means every shift-closing agent already reads the rule before writing anything.
- **Explicit silence.** "No skill lessons this shift" is a valid outcome — this closes the ambiguity that let 30 days pass with no lessons recorded because nobody had to say "none".
- **Never bypass publish.sh.** Threads the four-layer defense into the shift-closing loop: any skill edit tonight goes through `tools/skills/publish.sh` (T3), which enforces the owner gate + verify-local + backup + CHANGELOG + registry.
- **No section-sign glyph** anywhere in the new text (owner rule 2026-08-07).

## Live-proof

- `grep 'Shift-closing checklist' skill/handoff/SKILL.md` → matches step 7 in Procedure.
- `grep 'shift-closing item' CLAUDE.md` → matches the new paragraph after Safety rules.
- Both new blocks cross-reference each other and the GSL-189 + R5 audit finding.

## Follow-ups

- Owner ports the same rule into `~/.claude/skills/orchestrating-delivery-agents/SKILL.md` shift-closing checklist (owner-only, out of scope tonight per authority inversion).
- The pointwise rsync `rsync -a skill/handoff/ ~/.claude/skills/handoff/` takes the new step 7 into the global copy under owner control.
