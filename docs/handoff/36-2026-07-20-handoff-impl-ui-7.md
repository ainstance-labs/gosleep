# Handoff 36 — cycle 59 (impl-ui-7), GSL-100 closed, Phase 5 accepted

**Date:** 2026-07-20 · **Worker:** impl-ui-7 · **Model:** Opus 4.8 (verified from the transcript: `claude-opus-4-8`, 262 records, no other values)
**Branch:** `GSL-90-ui-orchestration @ dc2a925` · **Jira:** GSL-100 → Done · **GH:** #113

---

## Part 1 — what you need to know without reading the code

### Where we are

**Phase 5 is finished.** All ten tasks of epic GSL-90 are closed, acceptance done, the epic is ready for PR. Exactly one action remains — open the epic PR, and that is the next work (see RESUME POINT).

### What was done

Acceptance of the closing task. There was one rule, and it stands in the Jira description itself: **a criterion is closed by evidence, not by observation.** Lesson from Phase 4 — R4.2 was green on evidence that turned out not to be in the repository. Therefore each of F5-S1..S4 here is closed by a command output or a browser measurement that can be reproduced.

**And the acceptance worked as acceptance should: it found what nobody was looking for.**

### Two real defects — on the phase's own criterion

Before this cycle **nobody ever opened these pages at phone width**. Opened them — and two things turned up:

1. **The nav did not wrap, and two out of seven pages were unreachable.** At 390px seven links lay in a single unbreakable 469px string inside a 358px column; "Cost" and "Library" went off the screen. The cause turned out not to be what you would expect: it was not a missing breakpoint but the fact that the renderer prints `<a>Overview</a><a>Timeline</a>` **without whitespace between elements**, and inline boxes without whitespace text have **no soft break point at all**. `margin-right` drew the gaps but not a single break site.

2. **The mono card was silently cutting its own quote.** An orchestrator note broke off at `"context_pct":26,"o` — the rest of the sentence was lost, **and there was nothing on the screen that admitted the loss**. Silent truncation — exactly the failure this lab exists to prevent.

Both fixed. Measurement after: `scrollWidth` **850 → 390** (exactly the viewport), zero unrestrained overflows, all seven links on the screen.

### F5-S4 in the PRD turned out wrong — and recorded as is

The PRD promised the owner would open the page "through a private GitHub repo from the phone". **GitHub does not know how to do that**, and this is verified, not assumed:

- Contents API returns `application/vnd.github.raw`;
- `raw.githubusercontent.com` returns `text/plain`;
- **both set `nosniff`** — the browser is directly forbidden to consider the file as HTML, even though it is HTML;
- CSP `default-src 'none'` would kill all inline JS even if it did render;
- Pages for a private repo on the free plan is unavailable (404).

**Control:** the same raw returns `text/plain` for `README.md` too — so this is universal raw behavior, not something about our file. **GitHub is a transport for the bytes, not a viewer.**

The wording was **not adjusted** to fit the desired. What is true and worth defending: the page is one file with no dependencies, and it fully renders as soon as it reaches the phone by any means that lays the file on the device.

### Three lessons of the cycle — all three about what I did wrong myself

**1. My own detector was broken and would have shown a "bug" no matter the outcome.** Checking the Library filter, I read visibility via `style.display`, while the filter hides via the `hidden` property, and took scope from the wrong attribute. The test cheerfully reported "the filter is broken" — while the filter works perfectly. Only the rule "read the mechanism's code before believing your own measurement" saved me.

**2. Right there a second time, in the same direction.** The next run showed "on load all 107 rows are hidden". Also a lie: **pollution from my own previous test**, which had left a value in a select. A reload gave an honest "107 of 107".

> **Rule:** a measurement on a page you have already touched is not a measurement.

**3. I edited a DERIVED file, and it was wiped.** I rewrote `docs/lab/site/README.md` by hand — the next chronicler pass returned the old text, because README too is generated (constant `SITE_README` in `chronicler.py`). A file whose **first line** says "DERIVED. Do not hand-edit" was hand-edited — by a worker who was in the same cycle rewriting the rule about that. Moved to the source and verified with two passes in a row.

**Bonus — about warnings.** I broke the build with a backtick inside CSS (the whole style is one template literal). The line `NOTE: no backticks in here, ever` was **already in the file**, ten lines from where I edited. The conclusion is not "add a warning" — it was there. The conclusion: a warning in the middle of a 250-line file does not work, and it is raised to the header.

### What's next

**Phase 6 (Mobile).** The F5-S4 finding passes into it **as an entry, not a tail**: since GitHub is not a viewer, delivery of the page to the phone is a separate task, and it must be solved by transport (a file on the device), not by hoping for web rendering.

### Problems

- **GSL-30 without dev_history** — the only hole in the whole repository, found by the GSL-99 meter. Alive, decision on the owner.
- **One class of devices verified** — 390×844. Tablet and ≤320px not measured.
- **`smoke.sh:234` "stale temp survives"** — pre-existing flake (kill -9 race). DO NOT fix.
- Tails from handoff 33/34 alive (48 unmatched names, 9 nameless sessions, no machine-readable token ceiling, `task.completed` silent since July 13).

### Comments

Phase 5 ended by doing what it had been doing: **refusing to paint green what is not proven.** Acceptance could have closed F5-S4 with a check mark from memory — nobody would have verified it. Instead it refuted its own criterion and found two defects in what was considered done. That is what a working acceptance looks like.

---

## ORCHESTRATOR REPORT

```
CYCLE_ID: 59 / impl-ui-7
STATUS: COMPLETE
EPIC: GSL-90 (Phase 5 UI) — ALL TASKS CLOSED, epic ready for PR
BRANCH: GSL-90-ui-orchestration
COMMIT: dc2a925 (main) + handoff commit (this file)
JIRA: GSL-100 → Done (verified: status.name = "Done")
GATES: smoke 252/252 (was 248) · hooks-verify 14/14 · tsc clean · chronicler 7 pages · C5 clean
SCHEMA: gosleep.lab.render/7 — UNCHANGED
DECISION: q-2026-07-20-001 (fix scope; continued by default, AUTONOMOUS)
BLOCKED_ON_HUMAN: none
MODEL: Opus 4.8 (claude-opus-4-8, verified from transcript)
```

### Acceptance F5-S1..S4 — by fact of run

| Criterion | Verdict | Evidence |
|---|---|---|
| **F5-S1** runway = `min()`, binding constraint + ETA | ✅ MET | Live measurement: `RUNWAY unknown`, badge "no readable stopping clock", 6 cards, ETA "orchestrator context in 1.7h" + screenshot |
| **F5-S2** live countdown | ✅ MET (**first time live**) | 116 min = computed from the reader's clock; a baked value at build time would give 117 — the discriminator distinguishes |
| **F5-S3** Tasks with links | ✅ MET | 115 Jira / 255 GH / 122 commit from `file://` |
| **F5-S4a** `file://` without a server | ✅ MET | 1 network request (the file itself), 0 console errors; filter 107→36→107→0 |
| **F5-S4b** light/dark on phone | ✅ MET **after fix** (initially ❌) | `scrollWidth` 850→390, 4 before/after screenshots |
| **F5-S4c** "through private GitHub" | ❌ **REFUTED** | `nosniff` + `text/plain` + Pages 404; control on `.md` |

---

## Part 2 — technical part

### Changes

| File | What |
|---|---|
| `tools/lab/ui/src/theme.ts` | `nav` → `display:flex;flex-wrap:wrap;column-gap:.9rem`; `.mono:not(table):not(.wrap *){overflow-wrap:anywhere}`; backtick warning raised to the header; false premise about the blob view corrected |
| `tools/lab/ui/src/screens/timeline.tsx` | Same false premise corrected, correct conclusion preserved |
| `tools/lab/chronicler.py` | `SITE_README` — contract rewritten **in the source** |
| `tools/lab/smoke.sh` | +4 tests (2 ⭐ + 2 positive controls) |
| `docs/dev_history/` | `GSL-100-phase5-cycle59-acceptance.md`, index + **Phase 5 summary**, `assets/GSL-100/` (6 screenshots) |

### New tests — and why they can be trusted

```
sh_nav_wraps()  -> grep -E 'nav\{[^}]*flex-wrap:wrap'   on the GENERATED page
sh_mono_wraps() -> grep -E 'overflow-wrap:anywhere'      on the GENERATED page
```

Asserted against the page, not the source: **the reader gets the page**. Before each ⭐ test comes a **positive control** — both detectors are shown a synthetic pre-fix style and are obliged to **reject** it. A detector that does not recognize the defect is a green check mark over emptiness (exactly what the double-suffix test was until impl-ui-6 ran it against the parent commit). No tree mutations were done: the control is synthetic, so the harness could not lose anything.

### What was NOT committed (by precedent `83f49f8`/`cbdcb26`)

`ORCHESTRATION-STATE.md`, `decisions/log.jsonl`, `events/*.jsonl`, `questions/queue.jsonl`,
`digest/*`, `docs/prompts/` — orchestrator and hook territory. My DECISION
`q-2026-07-20-001` sits in `queue.jsonl` **uncommitted** deliberately.

---

## ⭐ RESUME POINT for the mechanic (PR of epic GSL-90)

**Branch:** `GSL-90-ui-orchestration @ dc2a925` (+ handoff commit), pushed. Schema `render/7`.

**Task: open the PR of epic GSL-90.** All epic tasks in Done, acceptance done, gates green.

1. **Title:** `GSL-90 UI orchestration, static v1 (PRD Phase 5)`.
2. **Body:** `Implements GSL-90.` + task checklist GSL-91..GSL-100 (all `[x]`) + `Mirrors GH #103.`
   + `Closes #…` with the list of task issues (**#113** — GSL-100).
3. **Merge — regular, NOT squash** (preserves one commit per task).
4. **GH issues of tasks** close via the `Closes` list; GitHub will auto-close only the first — the rest by
   hand `gh issue close`.
5. Epic GSL-90 in Jira → **In Review** on PR open, → **Done** after the merge.

**Before the PR run the gates** (nothing should fall):
```bash
bash tools/lab/smoke.sh          # 252/252
bash tools/lab/hooks-verify.sh   # 14/14
(cd tools/lab/ui && npx tsc --noEmit)
bash tools/lab/chronicler.sh --no-poll   # 7 pages
```

**What is important NOT to lose in the PR description:** F5-S4 is closed **partially and honestly** — local `file://` and light/dark ✅, but "through a private GitHub repo" ❌ refuted. If the PR body says "Phase 5 complete, all criteria met", that would be exactly the false green the whole phase was built against. The wording — from the summary in `docs/dev_history/README.md`.

**Open tails (NOT bugs, but know):** GSL-30 without dev_history · tablet/≤320px not measured ·
`smoke.sh:234` flake (kill -9 race, do NOT fix) · handoff 33/34 tails.
