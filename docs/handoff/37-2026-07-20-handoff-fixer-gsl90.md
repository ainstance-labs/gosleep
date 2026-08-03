# Handoff 37 — cycle 62 (fixer-gsl90): review findings on PR #115 closed

**Date:** 2026-07-20 · **Worker:** fixer-gsl90 · **Model:** Opus 4.8 (verified from the transcript
`94eaac6e-2f93-438a-acc7-3c0aeaf0c5ac.jsonl`: `claude-opus-4-8`, 172 records, no other values)
**Branch:** `GSL-90-ui-orchestration @ 61fcd86` · **Jira:** GSL-98, GSL-99 · **PR:** #115 (OPEN, CLEAN)

---

## Part 1 — what you need to know without reading the code

### Where we are

The reviewer (cycle 61) issued the **FIX** verdict: 0 CRITICAL, 3 MAJOR, 2 MINOR, 3 NIT. **All
three MAJOR closed, plus both MINOR and one NIT.** Gates green, PR #115 — `CLEAN`, ready for merge.

The three MAJOR turned out to be one illness in three places: **the lab was showing the owner the
wrong number exactly on the screens built so numbers could be trusted.** This is not an
architectural problem — no finding touched the `render/7` schema or required new client JS.

### What was broken — plain words

**1. Worker ages on the Fleet screen were frozen (M3).** The Fleet screen exists for one
question: "how long since we heard from a worker". This number was drawn as dead text. The script
that makes ages tick looks on the page for the attribute `data-age-ts` — and on Fleet there was
not a single one. A worker rendered as "silent for 12m" and read three hours later still said
**12m**. An error in the reassuring direction, on a screen opened to understand whether the
fleet is alive. Meanwhile `site/README.md` promised in writing that ages on Tasks/Fleet tick: for
Tasks it was true, for Fleet — not.

**2. A handoff committed after a cycle closed documented nothing (M1).** The debt meter counted a
cycle as documented only if a handoff fell inside the interval between two boundaries. But a
handoff is **committed**, and a commit by definition happens after the pane has closed — on this
branch handoffs 28/29/35 were even added by late ledger commits hours later. Everything newer
than the last boundary did not land in any interval. **Measured on live data: a handoff
committed right now left all 22 boundaries standing as an outstanding debt** — with 36 committed
handoffs. The alarm rang loudest on a night that is fully written up.

**3. The meter counted panes and called them cycles (M2).** `pane.ended` is emitted for **every**
pane, and a cycle normally holds up to three — the Fleet screen itself prints this limit. Two
panes of one cycle that closed 9 seconds apart were seen by the pass as two cycles, and into
those 9 seconds a handoff physically cannot fit. So every extra pane **guaranteed** produced a
unit of debt: an ordinary cycle of three workers invented two phantom cycles — exactly the alarm
threshold.

**Why 252 green tests missed all this — and this is the main lesson of the cycle.** The tests
were not idle: they held a real mechanism. But the fixture encoded an **order that does not
happen in this repository** — a handoff committed *inside* its own cycle and exactly one
boundary per cycle, spaced neatly 60 minutes apart. Production does not produce either. The
defect was invisible **by construction**. Therefore the fixtures were fixed in the **same
commit** as the code: otherwise the fix would have shipped under the same greens that let the
defect through.

### Two MINOR — also about honesty of numbers

**m1 — Cost printed two different numbers under one word.** In sequence: "83 cycles ledgered",
then "Per cycle — 54 ledgered". Both numbers are correct (the first is the running ledger
counter, the second — parsed line-by-line bulletins), but the one word made them look like one
fact, and **the 29 cycles between them were named nowhere**. A reader who summed the table did
not get the total and did not know why. This is a deviation from a rule the repository holds
everywhere: **a filter must name what it hid** (Timeline writes "the other 308 are on disk, not
here"). It was broken on the most expensive screen. Now two labels for two numbers plus a line
naming the gap **and its direction**: "…every sum below is LOW by an unknown amount".

**n1 — `parseInt(...) || 1800` swallowed a legitimate zero.** `||` does not distinguish `0` from
an absent attribute. One line above the same thing is already done correctly via `isNaN`. Today
the threshold is never zero — that is exactly why this was invisible.

### What is deferred — honestly

- **n2 (the second half).** `load_events` sorts raw `e["ts"]` without going through `iso_utc`.
  The half that touched the debt meter I closed (boundaries normalize on entry — they are
  compared with already normalized commit dates). The second half I **did not touch**: this is a
  global order of all events, risk disproportionate to benefit, today all 550 events carry `Z`.
- **n3.** The reviewer himself writes: "nothing to change in this PR".
- **n1 stayed without a test, and this is said aloud** (in the commit too): the set has no
  harness that executes `client.ts` in a DOM — it renders HTML and asserts against it. The test
  would have had to be written for a threshold the repository does not set today. Deferred
  consciously, not by oversight.

### Problems

Not a single unresolved. The flake `smoke.sh:234` (pre-existing) did not fire once in the cycle.

---

## ORCHESTRATOR REPORT

**Status:** all three MAJOR closed, both MINOR closed, one NIT closed, one NIT deferred with
justification, one NIT needs no action. PR #115 `mergeStateStatus=CLEAN`.

**Commits (3 + this handoff):**

| SHA | What |
|---|---|
| `5e6d5ed` | GSL-98 — M3: ages on Fleet tick |
| `7c73aa3` | GSL-99 — M1 + M2 + m2 fixtures (one commit, as prescribed) |
| `61fcd86` | GSL-98 — m1 (Cost) + n1 (`isNaN`) |

**Gates (after each commit):** smoke **264/264** (252 base + 12 new), hooks **14/14**,
`tsc --noEmit` exit 0, chronicler **7 pages**.

**Positive controls — every new test run against the pre-fix version `9fb5766`:**

| Control | On 9fb5766 | After fix |
|---|---|---|
| Age mechanics on Fleet | **FAIL** (zero `data-age-ts`) | PASS |
| Fleet prose (double suffix) | *green* — the detector is verified by a **naive fix**: with the caption "silent for" + a ticking age it gives **FAIL** | PASS |
| M1: handoff later than the last boundary | **FAIL** (undoc=4 instead of 0) | PASS |
| M2: four pane closes → two boundaries | **FAIL** (boundaries=4, undoc=2) | PASS |
| m1: 5-cycle gap named on the page | **FAIL** ×2 | PASS |
| "trap is armed" ×3 | PASS on both versions (by construction — they check the fixture, not the code) | PASS |

The recovery method — as prescribed: `cp` of one file, synchronous foreground, no
`trap restore EXIT`, order "commit first — mutations after", after each run `git diff --quiet`
confirmed restoration, `pgrep` — absence of background writers.

**Effect on live data:** `undocumented_cycles` 2 → 1 (the phantom is gone), 22 pane closes
collapsed into 19 cycles. The remaining 1 is real: it is the current cycle 62, and it will
become zero after this handoff is committed (which is itself a demonstration of M1).

**No deviations from the task.** Schema `/7` not bumped, no new client JS, C5 denylist in
`chronicler.py` clean (`grep -Ei 'tmux|spawn|Agent tool|teammate'` → 0 hits), other-people's
dirty files (`ORCHESTRATION-STATE.md`, events, queue, decisions, digest, `docs/prompts/`)
untouched, commits per file, messages via `git commit -F`, no force-push, no `--amend` after push.

---

## Part 2 — technical part

### Changes

| File | What |
|---|---|
| `ui/src/components.tsx` | new **shared** `Age` (nullable `ts`, optional `id`, `fallback`) |
| `ui/src/screens/fleet.tsx` | worker cards and the roster "last seen" column — via `Age`; captions became named groups |
| `ui/src/screens/tasks.tsx`, `ui/src/selfhealth.tsx` | local duplicates `Age`/`LiveAge` removed, import shared |
| `chronicler.py` | `CYCLE_DEBOUNCE_S=600` + collapsing panes into cycles; the last interval's upper bound open to `now`; boundaries normalize via `iso_utc` |
| `ui/src/screens/cost.tsx` | two labels for two numbers + a gap line with direction |
| `ui/src/client.ts` | `isNaN` instead of `\|\|` for `freshS`/`deadS` |
| `smoke.sh` | +12 tests, 2 new fixtures, Fleet ledger fixture got a 9 vs 4 gap |

**Why `Age` moved to `components.tsx`.** It was already written **twice** (Tasks, Self-health),
and the third screen that needs it most — Fleet, whose whole subject is age — forgot it. A
component existing in one place cannot be forgotten by the screen that needs it most.

**A prose trap the phase already fell into.** `ageText` ends in "old". A caption "silent
**for**" would give "silent for 12m old", and `{age} ago` — "12m old ago": this is exactly the
"0s old ago" defect class that once slipped past 246 greens. Therefore captions are rewritten
into named groups ("silent · last event"), and prose is read by a separate test — with a
positive control for both forms of the defect across a tag boundary.

**The direction of the debounce error is named on the page, not hidden.** Collapsing boundaries
understates debt (two cycles inside the window count as one) — this is the reassuring direction
the repository does not accept silently. Therefore the page prints **both** numbers and the
window: "22 pane close(s) debounced into 19 cycle boundary(ies) at 600s … which UNDER-states this
debt". A reader who does not trust the collapse divides it themselves. No new bundle fields were
introduced for this — both numbers ride in the existing `searched` prose, so the `/7` schema did
not move.

### New tests — and why they can be trusted

12 of them, all assert **the mechanism** (id / attribute / value), not the shadow of a string:

- each worker's age is pinned to **its own** `last_ts`, positionally matched to the card — a
  foreign attribute somewhere on the page will not satisfy the test; counters ride next to the
  verdict, so "MISSING=0" cannot pass having found nothing;
- two new fixtures encode orders the production **actually** produces: (a) a handoff committed
  later than the last boundary → `undocumented_cycles == 0`; (b) four pane closes, three of them
  seconds apart → **two** boundaries, not four;
- before every substantive assert stands "trap is armed" — a check that the fixture really carries
  the tested condition.

### What was NOT committed

`ORCHESTRATION-STATE.md`, `docs/lab/events/*`, `docs/lab/questions/queue.jsonl`,
`docs/lab/decisions/log.jsonl`, `docs/lab/digest/*`, `docs/prompts/*` — foreign/live.
Regenerated `docs/lab/site/*.html`, `render_bundle.json`, `status.json` **included** by
precedent `83f49f8`.

---

## ⭐ RESUME POINT for the finalizer

**Branch:** `GSL-90-ui-orchestration @ 61fcd86` (+ this handoff's commit), pushed.
**PR #115:** OPEN, `mergeable=MERGEABLE`, `mergeStateStatus=CLEAN`.

**Task: merge PR #115 with a regular merge (REGULAR), not squash** — the repository convention
preserves the "one commit per task" history.

**Before merge run the gates — nothing should fall:**

```
bash tools/lab/smoke.sh          # expected PASS=264 FAIL=0
bash tools/lab/hooks-verify.sh   # 14/14
(cd tools/lab/ui && npx tsc --noEmit)
bash tools/lab/chronicler.sh --no-poll   # 7 pages
```

**Things to note:**

- The review verdict was **FIX**, and all mandatory findings are closed. Only n2 (the second
  half, `load_events`) is deferred — with the justification above; if you want to close it too,
  that is a separate task, not a PR blocker.
- Worth updating the PR body checklist: three review commits (`5e6d5ed`, `7c73aa3`, `61fcd86`)
  were added after the PR was opened.
- After merge: epic GSL-90 → **Done** in Jira (tasks GSL-91..GSL-101 are already Done).
- The flake `smoke.sh:234` is pre-existing, needs no fixing; did not fire once this cycle.
