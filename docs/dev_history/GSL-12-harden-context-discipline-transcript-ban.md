# GSL-12 — Curb transcript-read exception abuse; tighten context discipline (skill)

## What was done

The existing "dead worker's top report block" exception was a single clause that bad actors (and confused orchestrators) stretched to justify reading full transcripts, full handoff files, or live workers' files. Three hardening edits:

1. **"Monitoring without burning your context"** — extended the existing "Never read the worker's transcript" sentence to explicitly state the dead-worker exception does NOT cover transcripts: "that exception covers the HANDOFF FILE only, never any transcript."

2. **"Common mistakes" heavy-files bullet** — rewrote the exception description from one vague clause to four explicit exclusions:
   - Only a **range-read** of the **top `## ORCHESTRATOR REPORT` block**
   - Only a **DEAD worker's HANDOFF FILE**
   - Never any transcript (dead or live)
   - Never a live worker's files
   - Never the full handoff file
   - Never any other heavy file

3. **"Red flags"** — split the existing one-liner "Let me read the handoff/source" flag into two: one for the general case, one naming the specific abuse pattern ("The exception lets me read the transcript / the full handoff / a live worker's file").

## Problems solved

Before: the exception text said "range-read of a dead worker's top ORCHESTRATOR REPORT section" but didn't prohibit transcripts or full files explicitly. Orchestrators used it as a loophole to read arbitrary context-heavy files, defeating the whole point of the rule.

## Problems remaining

No automated enforcement — this is guidance. If an orchestrator decides to ignore it, there's no mechanism to stop it.

## Pitfalls & workarounds

- The "range-read" means using a tool's `offset`/`limit` parameters to read only the top N lines — not `Read`-ing the entire file.
- If the handoff file itself doesn't have an `## ORCHESTRATOR REPORT` block (malformed), the exception still does not justify reading the transcript. Fall back to the STATE file + git log.

## What didn't make it

No change to `references/worker-cycle-template.md` around the ORCHESTRATOR REPORT block structure — it already specifies that block comes first; the tightening here is on the orchestrator's read side.

---

## Part 2 — Technical

**Files touched:**
- `skill/SKILL.md` — three sections: "Monitoring without burning your context" (Probe bullet), "Common mistakes" (heavy-files bullet), "Red flags" (split one flag into two).
- `docs/dev_history/GSL-12-harden-context-discipline-transcript-ban.md` — this file.
- `docs/dev_history/README.md` — index entry appended.

**Note:** All three tasks' SKILL.md edits (GSL-10, GSL-11, GSL-12) were made in a single editing pass and committed together in the GSL-10 commit. GSL-11 and GSL-12 commits contain only their dev_history files + README index line. The skill content is correct in all cases; only the commit granularity is slightly non-ideal.

**How verified:** read all three affected sections post-edit; confirmed prohibition is unambiguous and does not contradict any Cycle 3 (GSL-6/8/9) edits.
