# Handoff — gosleep — 2026-07-13 (cycle 54, impl-ui-2: GSL-95 — deadline countdown, F5-S2)

> For a FRESH agent. Read Part 1 → `## ORCHESTRATOR REPORT` → Part 2 → "⭐ RESUME".
> Ground truth = `ORCHESTRATION-STATE.md` (first) + this file. Inherits handoff 29 (impl-ui-1).
> The hard rules of handoffs 21–29 are **not weakened**.

# ── Part 1 · Plain words ──

## 1. Where we are

The Questions screen came alive. Every self-resolving question has a countdown that **ticks every second** and **recomputes itself the moment you opened the page**.

Open `docs/lab/site/questions.html`: `auto-applies in 52m 30s`. Refresh a minute later — it becomes `51m 30s`. A number visibly moving is the cheapest proof that the page is live, not a screenshot of a live one.

**F5-S2 is closed.** Left: GSL-96 (Tasks), GSL-97 (Timeline+Library+filter), GSL-98 (Fleet+Cost),
GSL-99 (self-health), GSL-100 (acceptance).

## 2. What was done

**GSL-95** `164bfa5` — Questions deadline countdown. **smoke 174 → 182/182** (+8), hooks-verify 14/14,
tsc clean, 7 pages well-formed.

Three states, and the third is the reason this is not a one-line ternary:

- **deadline ahead** → `auto-applies in 2h 15m`; under an hour seconds appear (`52m 30s`);
- **deadline past** → `PAST DUE by 3h 21m — still open, so nobody applied the default`, in red;
- **no deadline at all** → "waits for you… it simply never had a clock". Never `0h 0m`, never red.

## 3. What we do next

**GSL-96** (Tasks, F5-S3) — the board, keyed by Jira, with Jira/GH/commit/dev_history links. See ⭐ RESUME. There waits an inherited problem: **92 of 101 board rows with status `unknown`**, because the lab has no Jira keys (C1) and poll is fed by hand.

## 4. Which problems there are

- **⚠️ Timer defaults are applied by NO ONE. This is new and it is important.** I went to check how to honestly name an expired deadline and discovered: the repository has no mechanism that applies a default by the clock. `lab-emit.sh list --due` has **exactly one consumer — a live orchestrator on its own pulse** (`skill/orchestrating-delivery-agents/SKILL.md` · section 516: "DECISION past `auto_apply_at`: apply the default NOW"). Neither cron nor chronicler does this.
  → Consequence: **an open DECISION with an expired deadline means the pulse did not arrive.** This is a fact not about the question but **about the fleet**. The page says exactly that: `still open, so nobody applied the default`. Writing a soft "auto-applied" would mean declaring done what no line of code does.
  → **For the owner/orchestrator:** this may be an autonomy hole (a night without a pulse = defaults not applied), but fixing it is **not** a UI task, and I did not fix it. I pass it as a fact.
- **The token ceiling does not exist in any machine-readable source** (DECISION `q-2026-07-13-002`, default = status quo, reversibility high). `BUDGET_EXCEEDED` physically cannot fire, runway reads `unknown` on the budget axis. Not a blocker. *(Heritage GSL-94; today its deadline expires at 14:48Z — and now this is **visible on the screen**.)*
- **`api.failure` never fired.** Quota-wait clock = `clear` **with an asterisk**. Norm.
- **GSL-98 collision (passed as is, not my task).** The C5 invariant greps `chronicler.py` for `tmux|spawn|Agent tool|teammate`, and the worker name lies only in `data.raw.teammate_name`. impl-ui-1 **did not weaken the safety-check**: Fleet is built on the `actor` field. Two honest paths: (a) narrow the grep to check **capability** to take a pane; (b) live with `actor`. **Bypassing the grep with tricks like `"team" + "mate_name"` is not allowed** — a safety check being bypassed is a dead safety check. I applied the same principle myself (see Part 2 · "What I did not do").
- **The task board is stale (>12h) and knows it.** 92/101 rows `unknown`. Solve in GSL-96.

## 5. Comments and fresh decisions

- **"Stale number" and "lie" are different, and the second is more dangerous.** A page built at 23:00 with a caption `auto-applies in 2h` and opened at 04:00 does not show stale data — it **offers you two hours spent three hours ago**. A lie in the **reassuring** direction, the only one that matters at four in the morning. Exactly the defect class Phase 4 spent a cycle on (the freshness banner), and therefore the counter recomputes **on open**, not just ticks.
- **One formatting function, two clocks.** `src/countdown.ts` is imported by **both** sides: SSR (clock = `generated_at`, this is the verdict for the reader **without JS**) and the client (clock = `Date.now()`). Two formatters would be **two opinions about one deadline** and would diverge on the first day when one learned days and the other did not.
- **A clock cannot go backwards.** `regradeStaleness()` promises "the verdict can only worsen". The countdown gives the same promise in another unit: **it can only shorten**. A naive `deadline - Date.now()` breaks this: for a reader whose clock is an hour behind, every deadline would get an extra hour it does not have — the page bargains itself a delay. Therefore `clock = max(now, generated_at)`: a broken clock can only **leave the build-time verdict in force**. There is a test.
- **A missing deadline is not an expired one.** A DECISION without `auto_apply_at` renders as "waits for the owner, no clock", not as `0h 0m` and not in red. A screen that paints absence as zero is a screen that files a question no one put a clock on under the heading "you are already late".

---

## ORCHESTRATOR REPORT

```
CYCLE_ID: impl-ui-2 #54
CYCLE_STATUS: COMPLETE
EPIC: GSL-90 (In Progress) / GH #103 — PRD Phase 5 "Orchestration UI (static v1)"
BRANCH: GSL-90-ui-orchestration @ 164bfa5 — pushed
COMMIT: 164bfa5 GSL-95 [UI] Questions deadline countdown (F5-S2)   (smoke 174 → 182)
JIRA: GSL-95 → Done (verified). Left: GSL-96..GSL-100 (To Do)
GATES: smoke 182/182 · hooks-verify 14/14 · tsc --noEmit clean · 7 pages well-formed ·
       chronicler.py NOT touched (C5 ok) · schema render/3 NOT bumped
ACCEPTANCE: F5-S2 CLOSED. ⚠️ MUST re-grade on open — verified by a SYNTHETIC FIXTURE:
            the page's client bundle is executed in node with a stub DOM and a substituted Date;
            deadline +2h30m at build time, opening 5h later → require PAST DUE.
            MUTATION-VERIFIED: froze paint() → the test reddens. Positive control is real.
NEW FACT: timer defaults are applied by NO ONE (`list --due` is read only by a live orchestrator) —
          an expired open DECISION = a missed pulse. Possible autonomy hole; not a UI task.
BLOCKED_ON_HUMAN: none. Queue: open=2 (0B/2D/0C/0F) — zero BLOCKERs
NEXT: impl-ui-3 — GSL-96 (Tasks, F5-S3)
MODEL: claude-opus-4-8 (verified from transcript 2198edb8-*.jsonl — 117 records, no other models)
TELEMETRY: tokens_out=163066 tokens_in=229 cache_read=11759377 cache_write=413748
```

---

# ── Part 2 · Formal ──

## What was built

| file | what |
|---|---|
| `tools/lab/ui/src/countdown.ts` | **new** — `dur()`, `countdownText()`, `remainingMs()`. SHARED for SSR and client |
| `tools/lab/ui/src/client.ts` | `tickCountdowns()` next to `regradeStaleness()`: re-grade on open + tick 1s |
| `tools/lab/ui/src/screens/questions.tsx` | `<Deadline>` (3 states), `by_type` stripe, `by` column (`answered_by`) |
| `tools/lab/ui/src/theme.ts` | `.countdown` / `.countdown.past-due` / `.dim`; `tabular-nums` |
| `tools/lab/smoke.sh` | throwaway repo `f5s2` + 8 checks |

`chronicler.py` **not touched**. `auto_apply_at` was already in the bundle → schema `gosleep.lab.render/3` was not bumped. The rule "numbers are computed in Python once" is not broken: the countdown is not data but **a projection of data onto the reader's clock**, and Python cannot compute it by definition.

## A test you cannot pass on broken code

The REVIEW-gsl81 M1 lesson is written directly into smoke: "assert the mechanism (id, `<script>`) — this is what let 119/119 be green while the page contradicted itself". Therefore the ⭐ test **executes the page's client bundle** in node with a stub DOM and a substituted `Date`:

```
deadline +2h30m at build time → open with Date.now() = build + 5h → require PAST DUE
```

A counter baked at build time passes **all** other checks (span in place, attribute in place, number even correct for the moment of build) and fails this one. Only the environment is mocked — the JS the owner's browser will get is executed as is.

**Mutation-verified:** froze `paint()` → `FAIL … (LATER_TXT=auto-applies in 2h 30m`. Red.

The fixture lives in **its own** repo (`$WORK/f5s2`), not in the chronicler's fixture: there is a test counting open questions and reading the digest, and my three DECISIONs would have silently rewritten its arithmetic. I did that first — got 3 FAIL and rolled back. **A test that has to be kept in sync with someone else's fixture is a test that will one day be "fixed" by deletion.**

## What I did not do

- **Did not add `auto_apply_in_s` to the bundle.** The temptation was there: the rule "numbers are computed in Python". But then two formatters would format the prose (Python for build-time, TS for the client) and they would diverge. One formatter, two clocks — strictly more honest.
- **Did not build auto-application of defaults** (see Part 1 · section 4). This is not a UI task, and silently building the missing autonomy mechanism in a UI commit would mean hiding a hole, not showing it.
- **Did not give BLOCKERs a timer** — not even empty. By the manifest · section 3 they do not have one **by construction**.

## Traps (inherited, not weakened)

- **`chronicler.py` may not contain the words `tmux|spawn|Agent tool|teammate`** (C5). Catches `spawn_cap` in a variable name too.
- **`--dry-run` renders but does not write.**
- **Bundle schema — a two-sided contract.** The renderer **throws** on an unfamiliar schema. Bump — an edit in three places (`chronicler.py`, `render.tsx`, `smoke.sh`) deliberately.
- **`theme.ts` is a TS template literal.** A backtick in a CSS comment closes the string (I tripped on this; `tsc` caught it).
- **A commit via heredoc the hook does not see** — `git commit -F <file>`.
- **Dirty tree between commits — norm** (`events/<today>.jsonl` grows on every hook).
- **`docs/lab/site/` — DERIVED.** Do not edit by hand; regenerate `chronicler.sh --no-poll`.
- **`docs/prompts/` and `ORCHESTRATION-STATE.md` — owner/orchestrator-sovereign.**

## ⭐ RESUME POINT — impl-ui-3

```bash
git checkout GSL-90-ui-orchestration     # @ 164bfa5, pushed
bash tools/lab/smoke.sh                  # 182/182 — baseline BEFORE edits
bash tools/lab/chronicler.sh --no-poll   # rebuilds 7 pages
open docs/lab/site/questions.html        # counters tick; F5 → recompute
bash tools/lab/lab-emit.sh list --count  # open=2 (0B/2D/0C/0F) — zero blockers
```

**First task — GSL-96** (`[UI]` Tasks — the board, keyed by Jira, **F5-S3**).

What is already ready for it:
- Screen `tools/lab/ui/src/screens/tasks.tsx` — a skeleton exists (GSL-93).
- The `tasks` contract in the bundle: `TaskRow` carries `key`, `status`, `status_ts`, `status_age_s`, `status_age_human`, `summary`, `commits[]` (sha/subject/ts/url), `dev_history[]` (name/href).
- **Live age counter** — if you need to show "status went stale N hours ago" **at open time**, the pattern is ready: `src/countdown.ts` + `tickCountdowns()`. Do not invent a second one.

**An inherited problem GSL-96 will have to solve honestly:** 92 out of 101 board rows with status `unknown` (the lab has no Jira keys — C1; poll is fed by hand). impl-ui-1 **refused** to derive "Done" from the presence of a commit: **a commit ≠ Jira said Done**. Do not give in to the temptation — a plausible default here is that very tasty-lunch.

## Blocked on human

**None.** `open=2 (0B/2D/0C/0F)` — zero BLOCKERs:
- `q-2026-07-13-001` — UI framework (**default applied: Preact + esbuild**, works);
- `q-2026-07-13-002` — **token ceiling**, default = status quo, deadline **today 14:48Z**
  (and now visible on the screen — the first real countdown that will expire before your eyes).
