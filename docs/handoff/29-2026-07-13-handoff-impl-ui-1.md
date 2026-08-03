# Handoff — gosleep — 2026-07-13 (cycle 53, impl-ui-1: Phase 5 foundation — GSL-92/93/94)

> For a FRESH agent. Read Part 1 → `## ORCHESTRATOR REPORT` → Part 2 → "⭐ RESUME".
> Ground truth = `ORCHESTRATION-STATE.md` (first) + this file. Inherits handoff 28 (gsl90-setup).
> The hard rules of handoffs 21–28 are **not weakened**.

# ── Part 1 · Plain words ──

## 1. Where we are

The Phase 5 foundation is built. The lab got a **view layer in TypeScript**, a **data contract for seven screens** and the **autonomy runway** — that very main indicator for the sake of which the phase was started. Three commits, branch pushed, all three tasks Done.

Open `docs/lab/site/index.html` — at the top of the page there is now a headline answering the only question you have at midnight: **can I go to sleep**.

## 2. What has been done

- **GSL-92** `6b4cbed` — the TypeScript scaffold. The view layer moved out of Python (−290 lines), renders Preact + esbuild (SSG, not SPA). **No node → no crash**: data still regenerates, and pages stay in place under a red banner with the date of the last successful build.
- **GSL-93** `d2b2a20` — data contract (`gosleep.lab.render/3`, seven domains) + seven PRD screens.
- **GSL-94** `9197f88` — **autonomy runway = min() over six exhaustion clocks** (R5.1), acceptance
  **F5-S1** closed by 20 tests.

**smoke: 130 → 174/174.** hooks-verify 14/14. 7 pages well-formed, 0 errors.

## 3. What we do next

**GSL-95** (Questions + countdown, F5-S2). The attribute `data-auto-apply-at` is already set on every question with a deadline — the counter just needs to read it. Next GSL-96 (Tasks, F5-S3), GSL-97 (Timeline + Library + filter), GSL-98 (Fleet + Cost), GSL-99 (self-health), GSL-100 (acceptance).

## 4. Which problems there are

- **The token ceiling does not exist in any machine-readable source.** `manifest · section 5.phase-ceiling` delegates it to "the epic brief", no brief names the number. So `· section 5.warn-80` and `· section 3.budget` (`BUDGET_EXCEEDED` = BLOCKER) are **rules that physically cannot fire**, and the budget hours of runway read `unknown` and drop the whole answer to the upper bound (`≤` instead of `≈`).
  → **DECISION `q-2026-07-13-002`**, default = status quo, reversibility high. Does not hold work.
- **⚠️ A collision for GSL-98.** The C5 invariant greps `chronicler.py` for `tmux|spawn|Agent tool|teammate`, and the **worker name** in events lies only under the key `data.raw.teammate_name` — you cannot read it without breaking C5. I **did not weaken the safety check**: Fleet is built on the `actor` field. GSL-98 has two honest paths: (a) narrow the grep to check **capability** (C5 is about the chronicler not being able to take a pane, not about not being able to read a name from the log); (b) live with `actor`. **What must not be done** is bypassing the grep with tricks like `"team" + "mate_name"`. A safety check being bypassed is a dead safety check.
- **`api.failure` never fired.** The `StopFailure` hook is wired, the type is in the dictionary, the event has not been observed. "Quota not tripped" leans on an unverified mechanism — this is `clear` **with an asterisk**, and the asterisk is printed on the page.
- **The task board is stale (>12h) and knows it.** The lab has no Jira keys (C1), poll is fed by hand. 92 out of 101 rows — with status `unknown`. I **refused** to derive "Done" from the presence of a commit: a commit ≠ Jira said Done. Solve in GSL-96.

## 5. Comments and fresh decisions

- **`min()` over the raw six is a lie by arithmetic, and I did not write it.** Exhaustion means different things on different axes: context ceiling → forced roll (the watchdog does it itself, the night survives); three panes busy → a queue; work ran out → job done. None is a reason to wake a human, and a naive `min(0h, 4h, 8h)` would scream "RUNWAY 0h" because a pane is busy. Therefore each clock declares what **its** zero means: `stops` / `degrades` / `completes`. RUNWAY = the nearest of `stops`; `next_event` = the nearest of **all six**, so a roll does not hide behind a six-hour runway.
- **Not knowing must never read as more slack.** If unreadable clocks silently drop out of the minimum, `min()` **lengthens** — the dashboard promises more sleep because it knows **less**. Therefore unreadable clocks lower the answer to the upper bound, do not disappear. And `clear` (proved not a limit) ≠ `unknown` (could not be read) — this is a load-bearing distinction, not a shade.
- **A positive control uncovered three idle tests** — and they were idle already in the Python renderer. The smoke fixture dates events 20 hours ago (so that grade=dead), i.e. **yesterday**, and Timeline showed only a slice for today → three C8 checks grepped an empty page. Timeline became a through feed (PRD R5.2 "feed newest-first") — this fixes both the test and the real defect: a timeline empty at 00:05 is indistinguishable from a dead hook layer.
- **Fixed ISO-8601 parsing with an offset.** Jira returns `occurred_at` as `…T23:26:24.969+0200`, and `parse_ts` could only handle `…Z`. The board **knew the status but not its age** ("never" over statuses lying right there). Worse: a string with an offset sorts **higher** than a string with `Z` while being an **earlier** moment → naive `>=` was picking a stale record as the freshest.

---

## ORCHESTRATOR REPORT

```
CYCLE_ID: impl-ui-1 #53
CYCLE_STATUS: COMPLETE
EPIC: GSL-90 (In Progress) / GH #103 — PRD Phase 5 "Orchestration UI (static v1)"
BRANCH: GSL-90-ui-orchestration @ 9197f88 — pushed
COMMITS: 3
  6b4cbed GSL-92 — TS scaffold + degrade-without-node          (smoke 130 → 142)
  d2b2a20 GSL-93 — data contract render/3 + 7 screens          (smoke 142 → 154)
  9197f88 GSL-94 — autonomy runway = min(6 axes), F5-S1        (smoke 154 → 174)
JIRA: GSL-92/93/94 → Done. Left: GSL-95..GSL-100 (To Do)
GATES: smoke 174/174 · hooks-verify 14/14 · 7 pages well-formed (0 errors) ·
       tsc --noEmit clean · status.json + render_bundle.json valid ·
       degrade without node: exit 0, 7 pages under the banner · C1 ok · C5 ok
ACCEPTANCE: R5.1 implemented. F5-S1 CLOSED (20 tests on synthetic states).
            R5.2 — seven screens exist, filling in GSL-95..99.
NEW DECISION: q-2026-07-13-002 — token ceiling not on disk; default = status quo;
              reversibility high; does NOT block
BLOCKED_ON_HUMAN: none. Queue: open=3 (0B/3D/0C/0F) — zero BLOCKERs
NEXT: impl-ui-2 — GSL-95 (Questions + countdown, F5-S2)
MODEL: claude-opus-4-8 (verified from transcript c2e36f08-*.jsonl — by session-id path, 285 records)
TELEMETRY: tokens_out=~460940 tokens_in=~582 cache_read=~55349599 cache_write=~729352
```

---

# ── Part 2 · Formal ──

## The architecture GSL-95+ inherits

```
tools/lab/chronicler.py   (Python, stdlib, no network) — the DATA layer: reads tiers, folds,
        │                                                 grades, computes EVERY number
        └── docs/lab/render_bundle.json     ← ONE contract (mirrored in src/types.ts)
                │
                └── tools/lab/ui/render.sh → build.mjs → src/render.tsx   (TypeScript + Preact, SSG)
                        │
                        └── {"index.html": "<!doctype html>…", …}  ← printed to stdout
                                │
                                └── Python writes each page via lab-write.sh (atomic)
```

**Rules that cannot be broken:**

1. **Numbers are computed in Python, once.** Need a counter on a screen — add it to the bundle, do not derive it in TSX. A number the renderer produced itself is a second opinion that will sooner or later diverge from `status.json`.
2. **The renderer does not write to the file system.** `build.mjs` reads stdin, prints stdout. Smoke asserts this (`writeFile` in build.mjs = FAIL). Node killed on the fifth page cannot leave a torn dashboard — it has nothing to write with.
3. **Absence is rendered as absence.** `<Unknown why=…>` / `<Kpi>`. Never `0`, never a plausible default, never a green check mark.
4. **`docs/lab/site/` — DERIVED.** Never edit by hand.

## Bootstrap (once per clone)

```bash
cd tools/lab/ui && npm install     # NEVER automatically: a nightly task
                                   # reaching for the network is a nightly task that hangs
```

Not done — not scary: the pages will say it themselves, in red, with this command inside.

## Traps

- **`chronicler.py` may not contain the words `tmux`, `spawn`, `Agent tool`, `teammate`** — smoke greps (invariant C5). Catches innocent `spawn_cap` in a variable name too. See · section 4 above.
- **`--dry-run` renders but does not write.** Skipping the render in dry-run is a temptation, and it is wrong: then `--dry-run` reports "ok" about a pass whose renderer would have fallen.
- **Bundle schema — a two-sided contract.** The renderer **throws** on an unfamiliar schema (`render.tsx`), does not draw empty cards. Bumping the schema — an edit in three places (`chronicler.py`, `render.tsx`, `smoke.sh`), deliberately.
- **A commit via heredoc the hook does not see** — use `git commit -F <file>`.
- **Dirty tree between commits — norm** (`events/<today>.jsonl` grows on every commit).
- **`docs/prompts/` and `ORCHESTRATION-STATE.md` — owner/orchestrator-sovereign**, workers do not touch.

## ⭐ RESUME POINT — impl-ui-2

```bash
git checkout GSL-90-ui-orchestration     # @ 9197f88, pushed
bash tools/lab/smoke.sh                  # 174/174 — baseline BEFORE edits
bash tools/lab/chronicler.sh --no-poll   # rebuilds 7 pages
open docs/lab/site/index.html            # runway at the top
bash tools/lab/lab-emit.sh list --count  # open=3 (0B/3D/0C/0F) — zero blockers
```

**First task — GSL-95** (`[UI]` Questions + deadline countdown, GH #108, **F5-S2**).

What is already ready for it:
- Screen `tools/lab/ui/src/screens/questions.tsx` — open BLOCKERs and self-resolving questions are split by **two headers**: BLOCKER has no default and no timer (manifest · section 3), DECISION applies itself at `auto_apply_at`. Dumping them into one list buries the only question the owner must answer under four he does not have to.
- Every `auto_apply_at` already has the attribute **`data-auto-apply-at`** — the counter just needs to read it and tick. The client bundle (`src/client.ts`) inlines into every page; add the function next to `regradeStaleness()`.
- The `queue` contract in the bundle carries everything: `open_items`, `closed_items`, `open_blockers`, `seen_by`, `reversibility`, `impact_if_wrong`, `default_rationale`.

**Mandatory:** the countdown must **re-evaluate itself on page open** (like the freshness banner), not be frozen at build time. A deadline expired three hours ago and still showing "auto-applies in 2h" is exactly the lie for whose cleanup Phase 4 spent a cycle.

## Blocked on human

**None.** `open=3 (0B/3D/0C/0F)` — zero BLOCKERs, three DECISIONs with defaults:
- `q-2026-07-12-001` — chronicler (deterministic vs LLM), no deadline;
- `q-2026-07-13-001` — UI framework (**default applied: Preact + esbuild**, works);
- `q-2026-07-13-002` — **token ceiling** (new, see · section 4), default = status quo.
