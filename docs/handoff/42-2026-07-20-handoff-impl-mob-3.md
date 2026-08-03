# Handoff — gosleep — 2026-07-20 (cycle 67, impl-mob-3: GSL-109 design pass closed)

> For the orchestrator and the next Phase 6 impl-worker. Read Part 1 → ORCHESTRATOR REPORT → Part 2 → ⭐ RESUME.
> Ground truth = `ORCHESTRATION-STATE.md` (first) + handoff 39 (Phase 6 rollout) + handoff 40 (RC) +
> handoff 41 (phone-readable) + this file + handoff 35 (20 rules and 6 lessons — all in force).
> I am the impl-worker of cycle 67. Did exactly one task: **GSL-109**.

# ── Part 1 · Plain words ──

## 1. What was done

**GSL-109 closed** (Jira **Done**, commit `fa7bdcf`). The seven Laboratory screens got a design
system instead of a set of ad-hoc values. The task existed because the owner opened the site and
called it "just some AI slop" — this is a direct wish, not a guess about taste.

BEFORE/AFTER screenshots — `docs/dev_history/assets/GSL-109/` (all 7 screens on one sheet,
light+dark × desktop+390px, 8 files).

## 2. Main result: the design pass found a defect the markup did not see

The very first BEFORE screenshot showed "FRESH" in **amber** — the warning color. Meanwhile the
markup class was correct (`class="stale fresh"`), the data correct, and the test for
`class="stale dead"` green. The grade rule was written like this:

```css
.stale.fresh{color:var(--ok)} .stale.stale{color:var(--warn)} .stale.dead{color:var(--dead)}
```

`.stale.stale` is **not** "an element stale AND grade stale". It is `.stale` written twice. It
matches **any** banner with the same specificity (0,2,0) as `.stale.fresh`, and standing later in
the source, wins the cascade.

**A fresh build was printing its banner in the alarm color. On all seven screens. All of Phase 5.**

Catching this with a markup assert was impossible in principle: markup was correct every time. The
error was made by the **style layer**, which lacked the language to express the required
distinction. The cost is not cosmetic: a dashboard permanently painted in the alarm color can no
longer raise the alarm — the amber channel lost its meaning before it was used even once.

> Lesson to the same pile as cycles 65 and 66. There we generalized from a single `--help` and a
> single file extension. Here we **checked the wrong layer**: three years of markup asserts do not
> cover the question "which rule wins the cascade", and it was visible at first glance at the page.

**Fix:** grades are chosen by `data-grade`, which is already part of the contract checked by
`smoke.sh`. The three rules became mutually exclusive.

## 3. Second defect: "unknown" wore someone else's color

`runway.tsx` spends its entire docstring on the distinction between "nothing is going to zero" and
"I cannot read the clock" — verbatim: *"nothing is wrong" and "I cannot see whether anything is
wrong" — different sentences*. And right below it maps `bound === "unknown"` to the tone
**`warn`**: the same amber as "less than four hours remaining". A reading and the absence of a
reading were painted the same.

`unknown` got its own tone — purple, dashed, **off the green-amber-red axis** — because unknown is
not a rating on that axis. The same was done for `.unknown`, `.clock.unknown`, `.sh-m.unknown`,
`.tag.sev.unknown`: earlier all of them were painted `--dim`, that is, **in the color of
footnotes and captions**.

The tone is a CSS class and only that. No number, no threshold, no formula was touched.

## 4. Palette chosen by measurement, not by taste

The first candidate for `unknown` was violet. The `dataviz` skill's validator **rejected** it:
against the blue that colors links, it gives ΔE **8.7** for normal vision (threshold 15) — the
two colors would be indistinguishable. Replaced with purple.

Then the validator rejected the whole palette: red↔green gives ΔE 4.2 under deuteranopia. Before
redoing anything I ran a **control — the skill's own reference status palette**. It fails the same
gate **worse** (ΔE 4.1) and additionally fails a contrast check that mine passes. So the gate is
applied to the wrong thing: it is for categorical series, and traffic-light semantics cannot pass
it by construction (which the validator itself writes in its scope line). For status colors you
measure WCAG contrast and require a mandatory second channel.

**Contrast was not a defect, and claiming a fix for it would have been a lie** — the old palette
too passed AA in all roles. What changed is different:

| | old | new |
|---|---|---|
| AA (≥4.5:1), 5 roles × 2 themes | ✅ | ✅ |
| Dark theme | `#4ade80`/`#fbbf24`/`#f87171` — **9.9:1 and 10.3:1**, neon on black | **5.2–5.7:1** |
| `unknown` as a role | ❌ = `--dim` (footnote color) | ✅ own tone |

For a dashboard read from bed at 4 in the morning, "too bright" is also a defect.

## 5. Design system

Four scales, declared once; no rule has the right to take a value outside them. Typography — **7
steps instead of 18** ad-hoc sizes. Spacing — 4px base, **7 steps instead of 12** ad-hoc. Plus 3
radii and 5 semantic color roles across 3 surfaces.

The hierarchy is under the question "what must the owner see in 3 seconds": runway — the only
element on the top step of the scale; chrome (masthead, nav, banner, footer) pushed down; nav
became tabs with an explicit active state.

The freshness banner now **scales with what it says**: FRESH — a quiet line, STALE — amber with a
backing, DEAD — fill and doubled border. Asymmetry is the honesty rule aimed at the banner
itself: a page allowed to be silent when all is well will spend loudness where loudness is needed.

## 6. Problems

No blockers on my task. For the next worker — see ⭐ RESUME.

---

# ── ORCHESTRATOR REPORT ──

| | |
|---|---|
| **Task** | **GSL-109** `[UI][Design]` → Jira **Done** (verified by GET), GH #123 **not closed** |
| **Commit** | **`fa7bdcf`** — 14 files, +481/−133, per-file (`git add` by list, not `-A`) |
| **Gates** | smoke **287/287** (285 base + 2 new, **not a single old one weakened**) · hooks-verify **14/14** · `tsc --noEmit` **0** · chronicler **FRESH**, 7 pages |
| **390px** | live run across **all 7** screens: `scrollWidth == clientWidth == 390` everywhere, nav does not overflow, 7/7 links — **GSL-100 did not regress** |
| **Schema** | `render/7` **untouched**; data contracts, thresholds, formulas, `client.ts` — same |
| **Markup** | two wrappers without new prose (`header.masthead`, `main`) + one tone class; **no new visible text anywhere** |
| **Defects found** | 2 substantive, both fixed: cascade collision `.stale.stale` (Phase 5, all 7 screens) and `unknown` painted with the `warn` tone |
| **Decisions** | no new DECISION filed (no disputed forks arose); queue `open=0` |
| **install.sh** | **untouched**, guard not removed |
| **Acceptance per description** | ✅ typography/spacing/color/hierarchy/consistency of 7 screens · ✅ 390px + light/dark · ✅ invariant 1 (schema) · ✅ invariant 2 (asserts) · ✅ invariant 3 (renderer edited) · ✅ invariant 4 (honesty not softened — strengthened) · ⏳ **owner's eyes** |

---

# ── Part 2 · Formal ──

## What was changed

| File | Role |
|---|---|
| `tools/lab/ui/src/theme.ts` | design system in full: 4 scales, palette, cascade fix for grades, `@media (max-width:26rem)`; all previous comment-lessons preserved |
| `tools/lab/ui/src/runway.tsx` | `bound === "unknown"` → tone `unk` instead of `warn` (class only) |
| `tools/lab/ui/src/page.tsx` | `header.masthead` around h1+nav, `main` around the body |
| `tools/lab/smoke.sh` | +2 ⭐ (285 → **287**) |
| `docs/dev_history/GSL-109-…md` + `README.md` | dev history + index |
| `docs/dev_history/assets/GSL-109/*.jpeg` | 8 BEFORE/AFTER screenshots |

`docs/lab/site/*.html` **not committed** — DERIVED, same convention as in `e0b71e8`.

## Tests (⭐ = has a mutant that reddens exactly it)

| Check | Mechanism | Mutant |
|---|---|---|
| ⭐ each grade — its own color | **simulates the cascade**: resolves `color` for a real element of each grade against the released style, as the browser does | rollback to `.stale.stale` → `fresh=var(--warn)`, red, exactly it |
| ⭐ unreadable runway does not take a foreign tone | `class="runway unk"` present, `class="runway warn"` absent (fixture RWU) | tone back to `"warn"` → red |

The first mutant was run on a **copy of the released page** in scratchpad — live tree untouched —
and reproduced the original defect verbatim:
`fresh=var(--warn) stale=var(--warn) dead=var(--dead)`.

## Connections

| | |
|---|---|
| Branch | `GSL-102-mobile` @ **`fa7bdcf`** |
| Epic | GSL-102 = GH #116; tasks GSL-103…GSL-110 = GH #117…#124 |
| Phase 6 PR | **not yet open** |
| Jira | cloudId `74054cdc-47ef-497d-9684-734149876a8b`, transitions 11/21/31/**41=Done** |
| Queue | `open=0 (0B/0D/0C/0F)` |

## Phase 6 task status (verified by JQL, not from memory)

**Done (4):** GSL-103 ledger · GSL-104 RC · GSL-108 phone-readable · **GSL-109 design pass** (this cycle).
**To Do (4):** GSL-105, GSL-106, GSL-107, GSL-110.

## ⚠️ Hard rules

All 20 handoff-35 rules in force without weakening: ⛔ tree-wide git ops · ⛔ force-push · ⛔ `--amend`
after push · ⛔ Workflow tool · ⛔ `git add -A` · fleet cap 3 · NO Story · REGULAR merge ·
`docs/lab/site/*.html` DERIVED · commit via `git commit -F` · dirty tree — norm.
**Owner directive 2026-07-20 (IN FORCE):** `./install.sh` whole not run (GUARD in it, exit 1 —
do not remove and do not bypass); point-`rsync -a skill/<name>/ ~/.claude/skills/<name>/`; the
global copy `orchestrating-delivery-agents` is authoritative.

## Gotchas

All prior ones in force (including `chronicler.py` with `sys.exit(main())` at module level).
New from me:

- **Naive `re.sub(r"<[^>]+>", "", html)` lies on attributes containing `>`.** Reading aloud gave
  `…self-report alone"> orchestrator context…` — it looked like an attribute leak into the text.
  Arbiter — the DOM, not a regex: `document.body.innerText` returned `leaksQuoteGt: false`.
  `title` legitimately contained `->`, my stripper broke. The second signal (`<path` in text) —
  also escaped prose. **Both false, both verified by hand, none recorded as a defect.**
- **A measurement in a polluted window measures pollution.** The first 390px run gave
  `scrollWidth 402` — the culprit was **my own iframe** left in the DOM from an aborted script.
  Reload → 390.
- **A `file://` iframe does not give `contentDocument` to a `file://` parent** (opaque origin),
  but **renders**. A contact sheet of 7 iframes is fine for screenshots and **not fine** for
  measurements — all measurements were done by navigating to each page separately.
- **`evaluate_script` with sequential iframe loads hangs** on the 120s tool timeout and goes to
  the background (`TaskStop` removes it). One page per call is more reliable.
- **Screenshots are heavy.** 8 sheets came out to 9.5 MB; `sips -Z <w> -s formatOptions 45`
  squeezed them down to 1.8 MB without losing readability.

---

## ⭐ RESUME POINT — next Phase 6 impl-worker

```bash
# Orient
head -30 docs/handoff/ORCHESTRATION-STATE.md
cat docs/handoff/42-2026-07-20-handoff-impl-mob-3.md   # this file
git branch --show-current                 # GSL-102-mobile
git log --oneline -1                      # fa7bdcf (GSL-109)
ls -la .env.local 2>/dev/null || echo "GSL-105 still blocked"
tools/lab/lab-emit.sh list --count
```

### Verified by me by fact, not inherited (2026-07-20, end of cycle 67)

| | |
|---|---|
| `.env.local` | **ABSENT** — GSL-105 blocker in force, nothing changed |
| `tailscale` CLI | **not installed** on the machine |
| question queue | `open=0 (0B/0D/0C/0F)`, 20 lines |

### Phase remainder

- **GSL-105** — **BLOCKER** on the ntfy topic secret: `.env.local` verified, still absent.
  Parked, do not take.
- **GSL-106** — PRD requires it be done **after** 105, so transitively blocked.
- **GSL-107** `[Docs]` Tailscale/mosh break-glass runbook — **the only unblocked meaningful
  one**. You can write; you cannot close F6-S4 acceptance: `tailscale` is absent on the machine,
  an honest check will hit installation by the owner. Record as `⏳`, not "should work".
- **GSL-110** `[Docs]` Phase 6 dev_history + acceptance F6-S1..S4 — by meaning **the last** of
  the phase. Its acceptance will partly hit the same: F6-S4 without tailscale does not close.

**Recommendation:** GSL-107 (write the runbook, leave acceptance in `⏳`), then GSL-110 as the
closer. If the owner installs tailscale or puts down `.env.local` — the priority flips to
107-acceptance / 105 accordingly.

### Warning about my work

The phone page GSL-108 (`docs/lab/mobile/README.md`) — **Markdown, GitHub formats it, its CSS
cannot be taken away**, and the design pass did not touch it. Both surfaces read the same
`render_bundle.json`, and this is the only guarantee they will not diverge. If after some edit the
screens and the phone page start saying different words about the same numbers — that is a
regression.

## Blocked on human

- **GSL-109 (mine):** owner's look at 7 screens — agree that this is no longer "AI slop".
  Screenshots in `docs/dev_history/assets/GSL-109/`, live pages in `docs/lab/site/*.html`.
  Does not block other tasks. **Record the result including a negative.**
- **GSL-108 / F5-S4c:** final look from a real phone (handoff 41 · "What is left to the owner").
- **GSL-104 / F6-S1:** hands-on pairing + the second push toggle (handoff 40).
- **GSL-105:** BLOCKER on the ntfy topic secret — `.env.local` **verified, absent**.
- **GSL-107 / F6-S4:** `tailscale` is not installed — acceptance requires installation by the owner.
