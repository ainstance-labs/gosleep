# GSL-28 — v2 SC-11: concrete state-update mechanics on suspect handoff / late ID

## Part 1 — Plain language

### What was done

Edited `skill/orchestrating-delivery-agents/SKILL.md` to add concrete, step-by-step mechanics
for two state-update scenarios that SC-11 exposed as incomplete:
(a) when live git/gh contradicts a handoff (suspect handoff), and
(b) when a late-arriving ID (PR#, GH issue#) needs to reconcile a TBD placeholder.

Four concrete changes, all in the same file:

1. **Handoffs section** — added two "Concrete mechanics" blocks immediately after "Live git wins
   over any handoff":
   - **Suspect-handoff state update:** three mandatory steps — (1) overwrite LIVE-STATUS block
     with the live fact, (2) append a `CORRECTION:` note to the cycle log, (3) never carry a
     contradicted ID forward. Verbatim example:
     ```
     - CORRECTION: handoff claimed pr=TBD; live gh shows PR #42 open. LIVE-STATUS updated.
     ```
   - **Late-arriving ID:** find the TBD/placeholder line in ORCHESTRATION-STATE.md and REPLACE
     it in-place (idempotent atomic rewrite). Never add a second line; never leave TBD standing.
     Verbatim example: log entry `- GSL-30: gh issue TBD` → replace with `- GSL-30: gh issue #34
     (https://github.com/org/repo/issues/34)`.

2. **Recovering section** — added a note in step 4 pointing to the Handoffs section for the
   suspect-handoff mechanics: "live truth wins — immediately overwrite LIVE-STATUS and append
   a CORRECTION note to the log."

3. **Quick reference table** — added two rows: "Live git/gh contradicts handoff" and
   "Late-arriving ID (PR#/issue# after TBD written)" with compact action descriptions.

4. **Common mistakes** — added entry: "Carrying a stale/contradicted ID or TBD forward" naming
   both sub-cases and their corrections.

### Problems solved

SC-11 GREEN=0.75 (close to passing, but still missing): the skill said "live git wins" and
"sanity-check the handoff" but didn't specify the EXACT mechanics — what to overwrite, in what
format, where to write the correction note, and how to handle TBD placeholders. v2 makes these
concrete: named fields, example lines, and the idempotent in-place-replace rule for late IDs.

### Problems remaining

None for this scenario specifically. The eval (GSL-29) will confirm.

### Pitfalls & workarounds

The existing "Live git wins" line was correct but under-specified. The fix keeps the line and
adds the concrete mechanics blocks directly below it — no removal needed. The in-place-replace
rule for late IDs is important for idempotence: without it, multiple reconciliations could produce
duplicate lines.

### What didn't make it

Considered adding the mechanics to the Recovering section in full. Instead, a forward reference
was added there (step 4) to avoid duplication and keep the Handoffs section the single source of
truth for these mechanics.

---

## Part 2 — Technical reference

**Commit:** this commit (GSL-28 v2 SC-11: concrete state-update on suspect handoff / late ID + example)

**Key files changed:**
- `skill/orchestrating-delivery-agents/SKILL.md` — Handoffs section (two concrete mechanics
  blocks), Recovering section (step 4 addition), Quick reference table (two new rows),
  Common mistakes (new entry).

**How verified:**
- Re-read all four changed locations — each provides concrete step-by-step mechanics with
  verbatim examples for both the suspect-handoff and late-ID cases.
- `./install.sh` run after all four skill tasks are committed.
- `diff -r` confirms global copy identical to local.
