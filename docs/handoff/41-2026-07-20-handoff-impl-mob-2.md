# Handoff — gosleep — 2026-07-20 (cycle 66, impl-mob-2: GSL-108 phone-readable dashboard closed)

> For the orchestrator and the next Phase 6 impl-worker. Read Part 1 → ORCHESTRATOR REPORT → Part 2 → ⭐ RESUME.
> Ground truth = `ORCHESTRATION-STATE.md` (first) + handoff 39 (Phase 6 rollout) + handoff 40 (RC) +
> this file + handoff 35 (20 rules and 6 lessons — all in force).
> I am the impl-worker of cycle 66. Did exactly one task: **GSL-108**.

# ── Part 1 · Plain words ──

## 1. What was done

**GSL-108 closed** (Jira **Done**, commit `e0b71e8`, pushed). The owner now reads the morning
screen from the phone via a single link that does not go stale:

```
https://github.com/ainstance-labs/gosleep/tree/main/docs/lab/mobile
```

(until Phase 6 is merged — `…/tree/GSL-102-mobile/docs/lab/mobile`).

This is a **folder**, not a file: GitHub renders its `README.md` itself.

## 2. Main result: it was not the Phase 5 measurement that was wrong, but the conclusion from it

Phase 5 recorded F5-S4c as **refuted**, and its measurements are correct — I reproduced them
first thing, converges down to the header: `raw` returns `text/plain` + `nosniff`, Pages on a
private repo → 404.

But the conclusion recorded in `chronicler.py` (the generator of `docs/lab/site/README.md`) went
like this:

> "There is no URL on github.com that renders these pages. **GitHub is a transport for the
> bytes, not a viewer.**"

The first sentence is true — **for `.html`**. The second is broader than its own evidence: we
measured `.html` and `raw` and concluded about **the whole of GitHub**. This is exactly the
generalization that held the hole open across the whole phase, because it closes not the path
that was checked but all paths at once.

**Remeasurement** (same private repo, authenticated):

| What | What came back |
|---|---|
| `.md` via Contents API (`Accept: html`) | `<article class="markdown-body">` — **server-rendered** |
| `.html` via the same API | `<pre class="plain">&lt;!doctype html&gt;` — **escaped**, source shown |
| A folder's `README.md` (`GET /readme/<dir>`) | also rendered |
| A folder **without** `README.md` | `404` |

**Mechanism:** `nosniff` never controlled Markdown because Markdown is **not given** to the
browser for interpretation — GitHub renders it on their side and sends ready HTML. The obstacle
was not the private repository but the **file extension**. GitHub is both transport and viewer,
depending on what it is given.

> Lesson in the same pile as cycle 65: there the conclusion was drawn from one `--help`, here
> — from one file extension. Both times the measurement was correct and the **generalization**
> was not, and both times the cost of the generalization turned out higher than the cost of a
> check.

## 3. A negative control that was invalid at first

I first checked the line "folder without README → 404" on `docs/lab/events`, got **200** and
almost recorded that GitHub serves the README of any folder. Saved by a disk check before the
conclusion: **that folder has a README**, so 200 was correct and the control was meaningless.
Redone against three folders that really lack README (`docs/handoff`, `docs/prompts`,
`docs/runbooks`) — all three give 404.

## 4. Where I caught myself in AI slop

The owner that same day called the Laboratory UI "AI slop". The first run of my page was itself
one. I read it aloud — and heard four defects, two of them substantive:

* **"Latest decisions" printed the four oldest decisions.** `decisions.recent` comes
  **oldest-first**, and I took `[:4]`. The caption directly contradicted the list — the page lied
  exactly where it promised freshness.
* **A decision was printed as `d-2026-07-13-001 — q-2026-07-12-001`** — an identifier whose
  description is another identifier. My fallback `d.get("what") or d.get("re")` fell through to
  `re`, because the `what` field does not exist in the record; the real one is `decision`. On a
  phone this is worse than a missing section: costs a tap and communicates nothing.
* "101 unknown" as the first item (descending sort put "no information" up front) and "in 0.46h"
  instead of "28m".

Both substantive ones are pinned by ⭐ tests on a decisions fixture 1900…2099: any unsorted slice
puts the wrong record up front.

## 5. The property that made it worth building it exactly this way

Seven HTML screens require node. This page — **does not**: Python writes it from a bundle Python
has already written, and the write stands **outside** the "render succeeded" branch. Otherwise
the only surface available from bed would disappear exactly on the night the build breaks. Plus
the page **tells** the reader that the HTML next to it is stale. Verified by cutting node from
`PATH`.

## 6. Problems

No blockers on my task. For the next worker — see ⭐ RESUME.

---

# ── ORCHESTRATOR REPORT ──

| | |
|---|---|
| **Task** | **GSL-108** `[Tooling][Docs]` → Jira **Done** (verified), GH #122 **not closed** |
| **Commit** | **`e0b71e8`** — 7 files, +680/−15, per-file, pushed to `GSL-102-mobile` |
| **Gates** | smoke **285/285** (276 + 9) · hooks-verify **14/14** · `tsc --noEmit` **0** · chronicler **FRESH**, 7 pages |
| **Mutations** | 7 run in APFS clones (live tree untouched); **each ⭐ reddens its own**; m3/m4/m7 — exactly 1 red, the rest cascade semantically |
| **Live run** | pushed folder on GitHub: `200`, `markdown-body`, 7×`h2`, **0** source leaks; `POST /markdown` → `text/html`; a snapshot at **390px** without overflow |
| **Schema** | `render/7` **untouched** (I am only a bundle reader) |
| **Decisions** | no new DECISION filed; queue `open=0` |
| **install.sh** | **not run** (owner directive) |
| **Acceptance** | ✅ path found and implemented · ✅ Non-goals respected (0 infra, nothing public) · ✅ regenerated, schema intact · ✅ live run by headers + screenshot · ⏳ **owner's eyes on a real phone** |

---

# ── Part 2 · Formal ──

## What was changed

| File | Role |
|---|---|
| `tools/lab/chronicler.py` | `build_mobile()` + `_hours()`/`_ml()`; call in `main()` **outside** the render success branch; false generalization in `SITE_README` fixed |
| `tools/lab/smoke.sh` | +9 checks (276 → **285**) |
| `docs/lab/mobile/README.md` | **DERIVED** — phone page, 7 sections |
| `docs/runbooks/phone-dashboard.md` | owner runbook (RU): what to open, why it works, section 5 what is left to him, section 6 "verified / not verified" table |
| `docs/dev_history/GSL-108-phase6-cycle66-…md` + `README.md` | dev history + index |

## Tests (⭐ = has a mutant that reddens exactly it)

| Check | Mechanism | Mutant |
|---|---|---|
| ⭐ file name | the page is exactly `mobile/README.md` — otherwise opening the folder does not render | rename → red (+cascade: without the file everything reading it falls) |
| ⭐ derived | carries `generated_at` from **this** pass (cross-check with `status.json`) | hardcoded string → red |
| ⭐ only working links | not a single link to `.html` | insert a `.html` link → red, **exactly it** |
| ⭐ "latest" means latest | first goes `NEWEST-DECISION-TEXT` (fixture 1900…2099) | `recent_dec[:4]` → red, **exactly it** |
| ⭐ decision reads as a decision | prints `decision`, not `re` | `d.get("re")` → red |
| ⭐ survives no-node | node cut from `PATH`: `ui.reason=no-node`, the page is written and fresh | write inside the "render ok" branch → red |
| ⭐ and says so | warning about stale HTML on the page | condition → `if False` → red, **exactly it** |
| PC ×2 | the page is not empty and carries 7 sections; the no-node fixture actually lost the renderer | — |

## Connections

| | |
|---|---|
| Branch | `GSL-102-mobile` @ **`e0b71e8`** (pushed) |
| Epic | GSL-102 = GH #116; tasks GSL-103…GSL-110 = GH #117…#124 |
| Phase 6 PR | **not yet open** |
| Jira | cloudId `74054cdc-47ef-497d-9684-734149876a8b`, transitions 11/21/31/**41=Done** |
| Queue | `open=0` |

## Phase 6 task status (verified by JQL, not from memory)

**Done (3):** GSL-103 ledger · GSL-104 RC · **GSL-108 phone-readable** (this cycle).
**To Do (5):** GSL-105, GSL-106, GSL-107, GSL-109, GSL-110.

## ⚠️ Hard rules

All 20 handoff-35 rules in force without weakening: ⛔ tree-wide git ops · ⛔ force-push · ⛔ `--amend`
after push · ⛔ Workflow tool · ⛔ `git add -A` · fleet cap 3 · NO Story · REGULAR merge ·
`docs/lab/site/*.html` DERIVED · commit via `git commit -F` · dirty tree — norm.
**Owner directive 2026-07-20 (IN FORCE):** `./install.sh` whole not run; point-
`rsync -a skill/<name>/ ~/.claude/skills/<name>/`. In `CLAUDE.md` the owner strengthened this
today with a wording about the authority of the global copy — read it, not my quote.

## Gotchas

All prior ones in force. New from me:

- **`tools/lab/chronicler.py` ends with `sys.exit(main())` at module level**, without
  `if __name__ == "__main__"`. Any `import` triggers a **full pass** and writes 12 files — I
  stepped on that trying to test the generator in isolation. Only derived files suffered,
  sovereign untouched. Consequence: **an import-based unit test is impossible**, only a
  subprocess in a throwaway repo (same as all of `smoke.sh`).
- **Mutation runs are cheap via APFS copy-on-write:** `cp -Rc <repo> <clone>` is almost free on
  space and time, 7 clones went in parallel and the live tree was not touched once. The full
  `smoke.sh` takes **>120 s** — run in background, otherwise the tool timeout.
- **`docs/lab/digest/*.md` is already marked in the header of `chronicler.sh` as "(owner,
  phone)"** — Markdown as a phone surface was conceived back in Phase 4; only an entry point
  without a date in the name was missing.

---

## ⭐ RESUME POINT — next Phase 6 impl-worker

```bash
# Orient
head -30 docs/handoff/ORCHESTRATION-STATE.md
cat docs/handoff/41-2026-07-20-handoff-impl-mob-2.md   # this file
git branch --show-current                 # GSL-102-mobile
git log --oneline -1                      # e0b71e8 (GSL-108)
ls -la .env.local 2>/dev/null || echo "GSL-105 still blocked"
tools/lab/lab-emit.sh list --count
```

### Verified by me by fact, not inherited

| | |
|---|---|
| `.env.local` | **ABSENT** — GSL-105 blocker in force, nothing changed |
| `tailscale` CLI | **not installed** on the machine |
| question queue | `open=0` |

### Recommendation: **GSL-109 `[UI][Design]` design pass on 7 screens**

Why it and not the next by number:

1. **Unblocked** — requires no secrets, unlike GSL-105 (`.env.local` absent) and GSL-106 (PRD
   directly requires it be done **after** 105).
2. **The owner asked for it himself** — the task materializes DECISION `q-2026-07-20-002`,
   raised after he called the UI "AI slop". This is the only task of the phase with a direct
   owner wish.
3. The description already carries hard invariants (do not move the `render/7` schema, do not
   weaken mechanism asserts, edit the **renderer** `tools/lab/ui/`, not `site/*.html`) and three
   lessons from cycles 59/61. Read the description **first tool** — half of the acceptance
   lives there.

**Warning from me about GSL-109:** the design pass does **not** cover my phone page — it is
Markdown, GitHub formats it, and CSS cannot be taken away from it. If after the design pass the
screens and the phone page start saying different words about the same numbers — that is a
regression; both read the same `render_bundle.json`, and this is the only guarantee they will not
diverge.

### Alternative, if a docs cycle is needed

**GSL-107** `[Docs]` Tailscale/mosh break-glass runbook — independent, but `tailscale` is not on
the machine, so an honest F6-S4 check will hit installation by the owner. You can write; you
cannot close acceptance; record as `⏳`, not "should work".

### What is left to the owner on GSL-108 (not to a worker)

One visit, ~1 minute: open the link from section 1 from the phone and confirm he sees
**rendered text**, not source and not 404. Record the result **including a negative** — as
Phase 5 did. Known reasons for failure: not logged in to GitHub on the phone; the account has no
access to the private repo; opened a file, not a folder.

## Blocked on human

- **GSL-108 / F5-S4c:** final look from a real phone (see above). Does not block other tasks.
- **GSL-104 / F6-S1:** hands-on pairing + the second push toggle (handoff 40). Does not block.
- **GSL-105:** BLOCKER on the ntfy topic secret — `.env.local` **verified, still absent**.
- **GSL-107 / F6-S4:** `tailscale` is not installed — acceptance requires installation by the owner.
