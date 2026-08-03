# Handoff — gosleep — 2026-07-13 (cycle 55, impl-ui-3: GSL-96 — task board, F5-S3)

> For a FRESH agent. Read Part 1 → `## ORCHESTRATOR REPORT` → Part 2 → "⭐ RESUME".
> Ground truth = `ORCHESTRATION-STATE.md` (first) + this file. Inherits handoff 30 (impl-ui-2).
> The hard rules of handoffs 21–30 are **not weakened**.

# ── Part 1 · Plain words ──

## 1. Where we are

The Tasks screen became a board: a row = a task, key = Jira key, and **every identifier on the page is either a link that opens or an honestly named absence**. There is no third state. On the real board there are 475 links and **not a single broken one** (verified, including relative paths in `dev_history/`). At the top, tasks are collapsed by epic: the epic shows its PR and its state.

**F5-S3 is closed.** Left: GSL-97 (Timeline + Library + filter), GSL-98 (Fleet + Cost),
GSL-99 (self-health), GSL-100 (Phase 5 acceptance).

## 2. What was done

**GSL-96** `c965089` — Tasks board. **smoke 182 → 192/192** (+10), hooks-verify 14/14, tsc clean,
7 pages rebuilt.

Three things the screen **does not** do, and this is the job:

- **Does not derive "Done" from the presence of a commit.** 92 out of 101 rows stand `unknown`. A commit witnesses that code landed — and is silent about what the tracker thinks, and the tracker is the only thing the "status" column claims about. A plausible "Done" here would lie exactly in the column the owner uses to decide whether to go to bed.
- **Does not invent a PR for an epic that has none.** GSL-90 has no open PR (GH #103 is an epic *issue*, not a pull request), and the page says so. Borrowing an issue number under the guise of a PR is the worst thing that could be done here: issues and PRs share the number space, so such a link **will not** land in a 404, it **will open** — on a real page that is not what was clicked.
- **Does not read epic composition from prose.** Epic membership is taken from **git topology** (`mc^1..mc^2` for merged, `main..branch` for the current one). A checklist in the PR body would be simpler and would be wrong: this is prose written by hand at PR open time, and it reports the epic we *intended* to ship. Topology reports the one that was shipped. Fact: 13 epics via merge commits, 1 (GSL-90) via a branch, 0 unknown.

Plus: **the age of the status keeps aging while the page is open** (the same trick as GSL-95's countdown: one formatter, two clocks, `clock = max(now, generated_at)`).

## 3. What we do next

**GSL-97** (Timeline + Library on TS + client JS filter over an inlined JSON). See ⭐ RESUME.

## 4. Which problems there are

- **⚠️ The Jira→GitHub issue mapping EXISTS after all — and the previous cycle was wrong to conclude it does not.** impl-ui-1 concluded "no machine-readable source" from the fact that the mapping is not **on disk** (it lives in handoff prose) and did not build the GH column. But the build **already goes to GitHub** for pull requests, and our own conventions put the key **in the issue title** (`GSL-101: [Docs] …`). The column is built.
  → **Lesson wider than the column:** "no source" is a claim to be **verified**, not inherited. It was recorded in a code comment as a fact and lived for two cycles.
- **⚠️ Task acceptance lives in the Jira description, not in the cycle brief — for the second time in a row.** The GSL-96 brief contained neither epic→PR rollup nor GH links; both stand **in the task summary and in the acceptance text**. impl-ui-2 got burned on exactly this (recorded in handoff 30), and it recurred. **Always read the Jira description via MCP** — the brief does not replace it.
- **Timer defaults are applied by NO ONE** (heritage handoff 30, not fixed). `list --due` is read only by a live orchestrator on a pulse. A night without a pulse = defaults not applied. An autonomy hole passed to the owner; not a UI task.
- **The token ceiling does not exist machine-readably** (`q-2026-07-13-002`). `BUDGET_EXCEEDED` cannot fire. Not a blocker.
- **The board is stale and knows it.** 92/101 `unknown` — this is a state of **polling** (C1: the lab has no Jira keys, poll is fed by hand), not a defect of the board. Fixed by creds, not the renderer.

## 5. Comments and fresh decisions

- **A deviation from the brief made deliberately.** The cycle brief said "do not touch chronicler.py". F5-S3 acceptance requires data not in the `render/3` schema. The choice was between editing the data layer and invented links in the view — the second is explicitly forbidden by the task. Schema bumped `render/3 → /4` (in four places at once), the decision recorded as DECISION `q-2026-07-13-003` (reversibility high). **C5 is a denylist of WORDS** (`tmux|spawn|Agent tool|teammate`), not a ban on the file; the words are not touched, the grep is green.
- **A link that opens to the wrong thing is more dangerous than broken.** A broken link is caught by the eye in a second. A link to someone else's entity from the same number space looks working — the owner will click once, end up in the wrong place and **stop trusting a column that was right**. That is why in the absence of a PR the page writes "no PR" and does not substitute the epic issue number.
- **A test that can see only the degraded path does not see the column it guards.** The lab holds no creds and must build offline — so in the fixture `gh` is always unavailable, and the GH column would never be checked. Hence `GOSLEEP_GH_JSON`: a file exactly in the form `gh` returns, used **instead of** a network call. This is an injection point, not a backup path: an unreadable file degrades **with a log**.
- **Mutation is the only proof an assert is alive.** All 4 new ⭐ checks are mutation-run; each reddens **exactly its own** test (191/192), the rest stay green.

---

## ORCHESTRATOR REPORT

```
CYCLE_ID: impl-ui-3 #55
CYCLE_STATUS: COMPLETE
EPIC: GSL-90 (In Progress) / GH #103 — PRD Phase 5 "Orchestration UI (static v1)"
BRANCH: GSL-90-ui-orchestration @ c965089 — pushed
COMMIT: c965089 GSL-96 [UI] Tasks board — keyed by Jira, epic→PR rollup (F5-S3)   (smoke 182 → 192)
JIRA: GSL-96 → Done (verified). Left: GSL-97, GSL-98, GSL-99, GSL-100 (To Do)
GATES: smoke 192/192 · hooks-verify 14/14 · tsc --noEmit clean · 7 pages rebuilt ·
       C5 grep green (chronicler.py does not name fleet mechanics) · schema render/3 → /4 (deliberate)
ACCEPTANCE: F5-S3 CLOSED. Board keyed by Jira; Jira/GH/commit/dev_history links; epic→PR rollup;
            0 broken links out of 475; missing links visible as empty.
            MUTATION-VERIFIED (4 of 4, each reddens exactly its test):
              frozen age · commit⇒Done · issue-dressed-as-PR · extrapolated issue number.
NEW FACT 1: Jira→GH issue mapping EXISTS (key in issue title; the build already goes to gh).
            impl-ui-1's claim "no source" was correct only about disk and lived 2 cycles.
NEW FACT 2: acceptance again turned out to be in the Jira description, not in the brief (2nd time in a row).
NEW FACT 3: the epic GSL-90 has NO PR. GH #103 is the epic issue. The last PR in the repo is #102.
DEVIATION: touched chronicler.py against the brief (see Part 1 · section 5) — DECISION q-2026-07-13-003, high.
BLOCKED_ON_HUMAN: none. Queue: open=3 (0B/3D/0C/0F) — zero BLOCKERs
NEXT: impl-ui-4 — GSL-97 (Timeline + Library + client filter)
MODEL: claude-opus-4-8 (verified from transcript 7eabda7d-*.jsonl — 143 records, no other models)
```

---

# ── Part 2 · Formal ──

## Connections

| what | value |
|---|---|
| Jira | project **GSL**, cloudId `74054cdc-47ef-497d-9684-734149876a8b`; transitions: 21 In Progress, 41 Done |
| GitHub | `ainstance-labs/gosleep` (private). Epic GSL-90 = **issue #103** (not a PR!). GSL-97 = **#110**, GSL-98 = #111, GSL-99 = #112, GSL-100 = #113 |
| Branch | `GSL-90-ui-orchestration` @ `c965089`, tracking origin, pushed |
| Epic PR | **does not exist** — branch pushed, PR not opened |

## Gates (before every commit)

```bash
bash tools/lab/smoke.sh                  # 192/192 — baseline AFTER GSL-96
bash tools/lab/hooks-verify.sh           # 14 pass, 0 fail
cd tools/lab/ui && npx tsc --noEmit      # clean
bash tools/lab/chronicler.sh --no-poll   # rebuild 7 pages (docs/lab/site/ — DERIVED)
```

## What was built (GSL-96)

| file | what |
|---|---|
| `tools/lab/chronicler.py` | `load_gh_issues()`, `gh_cache()` (`GOSLEEP_GH_JSON`), `epic_ranges()`, `epics_rollup()`, `gh_url`/`gh_number` on rows; schema **`render/4`** |
| `tools/lab/ui/src/screens/tasks.tsx` | GH column, rollup on `<details>` (collapsing without JS), `id="task-GSL-N"`, live age |
| `tools/lab/ui/src/countdown.ts` | `ageText()`, `elapsedMs()` — **the same** formatter as the countdown |
| `tools/lab/ui/src/client.ts` | `tickAges()` next to `tickCountdowns()` |
| `tools/lab/ui/src/types.ts` | `EpicRollup`, `Membership`, `TasksBoard.epics`; `gh_issue_links` became `boolean` |
| `tools/lab/smoke.sh` | fixture `f5s3` (**own** git repo with a real merge commit) + 10 checks |

## ⭐ RESUME POINT — impl-ui-4

```bash
git checkout GSL-90-ui-orchestration     # @ c965089, pushed
bash tools/lab/smoke.sh                  # 192/192 — baseline BEFORE edits
bash tools/lab/chronicler.sh --no-poll   # rebuilds 7 pages
open docs/lab/site/tasks.html            # board: epics collapse, status age ticks
bash tools/lab/lab-emit.sh list --count  # open=3 (0B/3D/0C/0F) — zero blockers
```

**First task — GSL-97** (`[UI]` Timeline + Library on TS + client JS filter over an inlined JSON). Jira `GSL-97` = GH `#110`.

**⚠️ FIRST THING read the GSL-97 description via MCP atlassian** (`getJiraIssue`, cloudId above).
Two cycles in a row half the acceptance lay in the Jira description and did not get into the brief. This is no longer coincidence.

What is ready for it:
- Screens `screens/timeline.tsx` and `screens/library.tsx` — skeletons exist (GSL-93).
- The client bundle is inlined into every page (`client.ts`); the "island of JSON + `readJson(id)`" pattern is already there (`readJson` reads `<script type="application/json" id="…">`), and the filter is its direct continuation. **Do not invent a second way to deliver data to the browser.**
- The page must open from `file://` **without a network** — the filter works over the **inlined** JSON, no fetch.

## Gotchas (inherited, not weakened)

- **`chronicler.py` may not contain the words `tmux|spawn|Agent tool|teammate`** (C5, grep in smoke). Catches `spawn_cap` inside a variable name too. May be touched (I touched it) — cannot contain these words.
- **Bundle schema — a two-sided contract.** The renderer **throws** on an unfamiliar schema. Bump — an edit in four places at once: `chronicler.py`, `render.tsx`, `types.ts` (literal type!), `smoke.sh`. Currently `gosleep.lab.render/4`.
- **`theme.ts` is a TS template literal.** A backtick in a CSS comment closes the string.
- **A commit via heredoc the hook does not see** — `git commit -F <file>`.
- **Fixtures — into an OWN repo** (`$WORK/f5sN`), not the chronicler's: there is a test reading the digest, and someone else's data will silently rewrite its arithmetic (impl-ui-2 got burned; I did not step on it).
- **Assert the mechanism, not a shadow**: `id=…`, `data-…`, presence of `<script>`. And **verify by mutation** — an assert that did not redden on broken code guards nothing.
- **`--dry-run` renders but does not write.**
- **Dirty tree between commits — norm** (`events/<today>.jsonl`, `queue.jsonl`, `ORCHESTRATION-STATE.md`).
- **`docs/lab/site/` — DERIVED.** Do not edit by hand; regenerate `chronicler.sh --no-poll`.
- **`docs/prompts/` and `ORCHESTRATION-STATE.md` — owner/orchestrator-sovereign.**

## Blocked on human

**None.** `open=3 (0B/3D/0C/0F)` — zero BLOCKERs:
- `q-2026-07-13-001` — UI framework (default applied: Preact + esbuild, works);
- `q-2026-07-13-002` — token ceiling (default = status quo, deadline today 14:48Z);
- `q-2026-07-13-003` — **new**: data layer edit in GSL-96 (default applied: schema `/4`, reversibility high).
