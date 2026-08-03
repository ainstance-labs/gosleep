# Handoff 34 — cycle 58 (impl-ui-6), GSL-99 closed

**Date:** 2026-07-13 · **Worker:** impl-ui-6 · **Model:** Opus 4.8 (verified from the transcript: `claude-opus-4-8`)
**Branch:** `GSL-90-ui-orchestration @ cbdcb26` (pushed) · **Jira:** GSL-99 → Done · **GH:** #112

---

## Part 1 — what you need to know without reading the code

### What was done

The Laboratory got **three meters about itself** (R5.3, anti-wiki-rot alarm). They live on Overview — right under the answer "can I sleep", because they say **what that answer is worth**.

One rule over all three: **a meter without a source is `unknown`, not green.** Green is a claim and it requires evidence. Not knowing is not evidence.

### The meters found two real debts — on the very first pass

This is not a fixture. This is a live repository.

1. **GSL-30 has no dev_history — nowhere.** 14 epics, 87 tasks, exactly one hole. Verified independently of my own code: commit `80b1e3f GSL-30 Track v2 orchestration ledger` exists, epic-GSL-24 neighbors (GSL-29, GSL-32) have their files, GSL-30 has no file in the index and no file in the working tree. The debt sat for several phases and nobody was looking for it.

2. **Handoffs 28 and 29 are written and never committed.** They hang in `git status` as `??` cycle after cycle. For a fresh clone — for the very reader for whom a handoff is written — **they do not exist**. The screen now says this in words.

### Three decisions, any of which could have been taken wrong

**1. There are two ages, not one.** `grade` judges data **at build time**. A reader who opens the page five hours later holds a five-hour-old verdict. The banner recomputes the sum on open since Phase 4 — but **it showed one number**. Now both are on the page: build age (live, ticks from the reader's clock) and data age (a frozen fact about the build). **No new client JS was added** — the live age is taken by the existing `data-age-ts` mechanism (`client.ts: tickAges`), which already powers the Tasks board.

**2. Coverage is read from the git index, not from the working tree.** `git ls-files` — this is what `git show :<path>` resolves. An uncommitted dev_history **does not exist** for the one who comes after a compaction with a clone — and he is the only one for whom it is written. Files "in the tree but not in any commit" the meter shows on a separate line: "written and lost" ≠ "not written".

And the refusal that matters more than the found hole: **an epic whose task list git cannot read** (fast-forwarded, without a merge commit) gets `unknown`, **not 100%**. Zero of zero is the cheapest false green on this page.

**3. ⚠️ `ORCHESTRATION-STATE.md` — NOT a handoff, though it lies in `docs/handoff/`.** This is a live state file the orchestrator rewrites constantly. **The `handoff.written` hook fires on it too** — verified with grep, such an event is in the log. Counting it as a handoff means showing green **exactly when the fleet has stopped writing handoffs**: green in the reassuring direction, the only direction in which errors are unacceptable. Therefore the source — **committed files**, dated by the commit that added them, and the state file is excluded by name (and the page writes about the exclusion). In smoke this trap is **armed**: in the fixture the state file is committed later than all handoffs and all boundaries, and the test fails if it is counted (mutation M2).

### A fact obtained by grep: `task.completed` stopped firing

The obvious candidate for "cycle boundary" was `task.completed`. Grepped the log — and it **turned out to be wrong**: the last such event is at **12:54** (impl-ui-1), and cycles 53–57 worked afterwards. It is emitted by the task system, which a worker may simply not use (this is the "9 nameless sessions" from handoff 33).

The cycle boundary is taken as **`pane.ended`** — the only closing signal that lived to the last worker (17:23), and the same one on which Fleet holds the end of a card's life.

Debt is counted **as a series, not a ratio**: how many cycles **in a row** closed without a record (PRD: "a fleet that worked three cycles and did not write a single handoff"). We go back from the last boundary and stop on the first cycle inside which a handoff did exist. The naïve version ("boundaries newer than the last handoff") errs **by one**: a worker writes a handoff **before** their pane closes. Mutation M9 catches this (`got 4, want 3`).

### 🔥 Lesson of the cycle: the mechanism can be immaculate and the sentence broken

All 246 tests were green. The page meanwhile printed:

> **"this page was built 0s old ago"**

`ageText()` already returns the suffix `old`, and I appended my own ` ago`. **No assert saw this** — and they could not: they all assert the mechanism (id, data attribute, value), and this is right. But **none of them reads English.**

Found only one way: **pull the text of your section out of HTML and read it aloud.**

**And the second half of the lesson, more important than the first.** I wrote a guard test (`grep 'old ago'`) — and **the positive control killed it**: on the *broken* page the test did not redden. In raw HTML the string "old ago" is not there at all — between the words stands a closing tag (`0s old</span> ago`). The test would have been a green check mark over emptiness — exactly what it was written to prevent. Now it **strips tags before reading**, and the positive control proves the detector fires across a tag boundary: on the parent commit it finds the defect **three times**.

> **Rule for future cycles:** after green smoke — read the text of your section aloud. And after writing a prose guard test, **run it against the broken version** (`git show <parent>:<file>`), otherwise you checked that it does not fall, not that it catches.

---

## ORCHESTRATOR REPORT

```
CYCLE_ID: 58 / impl-ui-6
STATUS: COMPLETE
EPIC: GSL-90 (Phase 5 UI)
BRANCH: GSL-90-ui-orchestration
COMMIT: 83f49f8 (self-health) + cbdcb26 (prose fix — see "Why two commits")
JIRA: GSL-99 → Done (verified in transitionJiraIssue response)
GATES: smoke 248/248 (was 230) · hooks-verify 14/14 · tsc clean · C5 clean · chronicler 7 pages
ACCEPTANCE: all Jira description items met (table below)
MUTATION-TESTED: 9 mutations + a positive control on prose (matrix below)
BLOCKED_ON_HUMAN: none
MODEL: Opus 4.8 (claude-opus-4-8, verified from transcript)
```

### Acceptance (per Jira description, item by item)

| Requirement | Status |
|---|---|
| generated-at: **two ages**, not one | ✅ `#sh-build-age` (live, `data-age-ts`) + `#sh-data-age` (frozen) |
| Phase 4 contract: `grade` judges data, the consumer adds `now − generated_at` | ✅ arithmetic printed in words; the banner does the sum on open |
| dev_history coverage — **by name**, not a general number | ✅ `[data-missing-task="GSL-30"]`; percentages — a footnote to names |
| Coverage on **committed** files (`git show :path`), not on the tree | ✅ `git ls-files`; uncommitted shown separately as "lost" |
| handoff age vs **last cycle boundary** | ✅ `pane.ended`; debt = a series of undocumented cycles |
| A fleet that worked 3 cycles without a handoff → alarm | ✅ `data-alarm="1"` when ≥3 (threshold from the PRD) |
| **No source → `unknown`, not green** | ✅ 4 separate tests: no boundary, no events, no epic topology, no git |

### Why two commits under one key

The prose defect ("0s old ago") was found **after** the first commit was pushed. Force-push is forbidden (rule 12), `--amend` after push requires it. The choice was between a second commit and a page lying to the owner in English. A second commit is the lesser evil, and it is recorded here explicitly, not hidden.

---

## Part 2 — technical part

### Schema `render/6 → /7`

`self_health` — a **mandatory** bundle field. Edit in 4 places at once: `chronicler.py`, `types.ts`, `render.tsx`, `smoke.sh`. Mandatory deliberately: an anti-rot alarm the producer could silently stop emitting is an alarm that rots itself.

```
self_health.generated_at / data_age_s / latest_event_ts / grade
self_health.dev_history.{state, epics[], covered, missing, uncommitted, searched}
self_health.handoffs.{state, last, boundary, undocumented_cycles, alarm, uncommitted, undated, searched}
```

States: `ok` / `gaps` / `debt` / `empty` / `unknown`. **`empty`** (an epic with no task commits — nothing to cover) is painted **gray, not green**: it too has proved nothing.

### New in chronicler.py

- `git_index_files(pathspec)` — **`None` = git did not read (unknown); `[]` = git responded, no files (fact).** The difference is principled and pinned by a test.
- `git_untracked_files(pathspec)` — "written and lost".
- `handoff_add_times()` — **one** call to `git log --diff-filter=A --name-only`, not per-file. **mtime is not used at all**: checkout rewrites it, and on a fresh clone all handoffs look second-fresh.
- `dev_history_coverage(epics)` / `handoff_debt(events)` / `build_self_health(ctx, status)`.
- Constants: `NOT_A_HANDOFF`, `CYCLE_BOUNDARY_TYPE`, `GOSLEEP_HANDOFF_ALARM_CYCLES` (default 3).

### Acceptance surfaces (asserts MECHANISM)

`#self-health[data-grade|data-dh|data-ho]` · `#sh-build-age[data-age-ts]` · `#sh-data-age[data-data-age-s]` ·
`#sh-devhistory[data-state]` · `[data-sh-epic][data-missing]` · `[data-missing-task]` ·
`#sh-handoff[data-state][data-undocumented-cycles][data-alarm]` · `#sh-dh-searched` · `#sh-ho-searched`

### Fixtures

Two **real git repos** (`$WORK/f5-selfhealth`, `$WORK/f5-sh-unknown`): two of the three meters read git, and a fixture that faked it would be testing the mock.

- **`f5-selfhealth`**: epic branch `GSL-500` with tasks 501/502/503; a history only for 501; **502's history lies in the tree and in no commit** (the "fact vs intent" trap); `ORCHESTRATION-STATE.md` committed **later** than the real handoff and later than all boundaries (the "state file pretends to be freshness" trap) + a `handoff.written` event pointing at it; five cycle boundaries, one handoff inside the second → **three undocumented** → alarm.
- **`f5-sh-unknown`**: epic merged **fast-forward** (topology is silent) + a handoff exists + **no events at all** → both meters must say `unknown`, not `ok`. The handoff here is a **positive control**: it proves one cycle is recorded, but never that others did not close without a record.

**Positive controls before every grep-on-absence** (impl-ui-5 lesson): the test first proves that the uncommitted file is **really** on disk and that the state-file trap is **armed**.

### Mutation matrix (9 mutations)

| Mutation | What reddens |
|---|---|
| **M1** coverage reads the tree, not the index | ⭐ an uncommitted file is counted as covered · names of the missing · a covered one is not counted · the page does not print names (4 — one facet of the defect from four sides) |
| **M2** `ORCHESTRATION-STATE.md` counted as a handoff | ⭐ the state file is not a handoff · ⭐ the meter cannot say where it looked |
| **M3** an unattributable epic = 100% | ⭐ zero-of-zero is not green |
| **M4** no boundary → the meter says `ok` | ⭐ unknown instead of ok · render unknown on the page |
| **M5** no events → data age `0s` | ⭐ an empty log does not look fresh |
| **M6** build age is baked (no `data-age-ts`) | ⭐ two ages from two sources |
| **M7** the meters do not print the glob | ⭐ the meter cannot say where it looked |
| **M8** missing tasks — a counter, not names | the page does not print the names |
| **M9** debt is counted naively, not as a series | ⭐ series of undocumented cycles (`got 4, want 3`) |

Plus a **positive control on prose**: the double-suffix detector run against the parent commit — finds the defect **3 times**; on the fixed one — 0.

### Mutation harness — without a restore trap (impl-ui-5 lesson)

The mutation script is **synchronous, in one foreground process**, without `trap restore EXIT`: the backup is a `cp` of a named file, restoration is also `cp`, right after the run. No git operations, nothing tree-wide. Plus safety by order: **commit first, mutate after** — then the run physically cannot lose work. On completion: `RESTORED CLEAN` + `git status tools/` empty + `pgrep` confirms there are no background writers.

---

## ⭐ RESUME POINT for impl-ui-7 (GSL-100, F5-S4 acceptance)

**Branch:** `GSL-90-ui-orchestration @ cbdcb26`, pushed. Schema `render/7`.

### Mandatory reading
1. **This handoff, Part 1** — two found debts, three decisions, and **the lesson about prose** (mechanism ≠ sentence).
2. **Read the Jira GSL-100 description yourself** — half the acceptance lives there (impl-ui-2/3 lesson).
3. **Grep the code before believing the Jira description** (impl-ui-4 lesson: the description is a snapshot of intent).

### What you will need from my cycle
- **`self_health` in the bundle** — if F5-S4 acceptance requires "the page is honest about itself", the evidence is already computed: `dev_history.state`, `handoffs.state`, `data_age_s`, `undocumented_cycles`. Do not compute again.
- **`git_index_files()` / `git_untracked_files()`** — index vs tree, with an honest `None` = unknown.
- **The "print your glob" rule** — for me this is `dev_history.searched` and `handoffs.searched`.
- **The "read aloud" rule** — pull your section text out of HTML and read it. Mechanism asserts do not catch this class of defects **by construction**. And a prose guard test **run against the broken version**.

### Open tails (NOT bugs, but know)
- **GSL-30 without dev_history** — a real debt, found by the meter. Decision on the owner.
- **Handoffs 28/29 not committed** — a real debt, found by the meter. Untracked in the tree right now.
- **`task.completed` stopped firing after 12:54** — process gap (workers do not close a task through the task system). Not a UI bug.
- **48 ledger names do not match cards**, **9 nameless sessions**, **token ceiling does not exist machine-readably** — from handoff 33, still open.
- **`smoke.sh` "stale temp survives"** — pre-existing flake (kill -9 race). Do NOT fix.
- **The committed site lags one build** — a page built before the commit honestly shows its own dev_history as uncommitted. This is not a lie (correct on its own `generated_at`); the next chronicler pass fixes it.

### Gates that must not fall
```bash
bash tools/lab/smoke.sh          # 248/248
bash tools/lab/hooks-verify.sh   # 14/14
(cd tools/lab/ui && npx tsc --noEmit)
bash tools/lab/chronicler.sh --no-poll   # 7 pages
```
If you bump the schema to `/8` — edit in **4 places at once**: `chronicler.py`, `render.tsx`, `types.ts`, `smoke.sh`.
