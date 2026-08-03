# Handoff — gosleep — 2026-07-20 (orchestrator roll: Phase 5 reviewed and fixed, only the finalizer remains)

> For a FRESH orchestrator. Read Part 1 → Part 2 → ⭐ RESUME.
> Ground truth = `ORCHESTRATION-STATE.md` (first) + this file + handoff 37 (fixer, · RESUME for the finalizer) + handoff 35 (20 rules and 6 lessons — all in force).
> My predecessor — handoff 35 (roll 2026-07-13). I cold-started 2026-07-20 10:18Z, rolling ~12:16Z on a clean boundary: fixer COMPLETE + terminated, fleet empty, context ~76% (ceiling 70%).

# ── Part 1 · Plain words ──

## 1. Where we are

**Phase 5 UI (epic GSL-90) is fully ready for merge.** PR **#115** OPEN / mergeStateStatus **CLEAN**, branch `GSL-90-ui-orchestration @ 2d2b699` (25 commits from main @ `5fd1de2`: 21 at PR open + 3 fix commits + handoff 37). All 11 epic tasks (GSL-91..GSL-101) in Jira Done, epic In Review. Review passed (verdict FIX → everything fixed and rechecked). What remains is the **finalizer**: merge → close issues → Jira Done → cleanup → **Phase 6 Mobile setup without stopping**.

Fleet empty (0/3). Queue clean (open=0, lines=16). smoke **264/264**, hooks-verify 14/14, tsc clean, schema `render/7` (untouched).

## 2. What was done in my shift (cold-start 10:18Z → roll ~12:16Z, 4 cycles)

- **Cycle 59 (impl-ui-7): GSL-100 Phase 5 acceptance** — `dc2a925` + handoff 36 `9fb5766`. F5-S1..S3 + S4a/b ✅ by live runs; **F5-S4c "readable through private GitHub" REFUTED** (nosniff + text/plain + Pages 404 — recorded by fact, wording not adjusted; this is the entry to Phase 6). Acceptance found and fixed a **real nav defect**: at 390px Cost/Library were unreachable (no wrap points), scrollWidth 850→390. smoke 248→252.
- **Cycle 60 (mechanic-gsl90): PR #115 opened**, epic → In Review. The mechanic found on his own that **GSL-101 is the 11th epic task** (GH #114, not in my brief) and put it into Closes. Along the way: the Jira epic description lists 10 tasks — stale.
- **Cycle 61 (reviewer-gsl90): verdict FIX — 0 CRITICAL / 3 MAJOR / 2 MINOR / 3 NIT** (`docs/reviews/REVIEW-gsl90.md`, gitignored). The three MAJOR hit one point: honesty meters themselves erred in the reassuring direction (false handoff debt; pane.ended ≠ a cycle boundary; frozen Fleet ages). The blindness of 252 tests is explained: the fixture encoded an order the production does not produce.
- **Cycle 62 (fixer-gsl90): everything closed** — `5e6d5ed` (M3) + `7c73aa3` (M1+M2+fixtures in the same commit) + `61fcd86` (m1+n1) + handoff 37 `2d2b699`. **12 new tests, each red on the pre-fix 9fb5766**; M1 proven end-to-end on live data (undocumented_cycles 2→0). smoke 252→264. Honestly deferred: n2-half (risk>benefit), n3 (no action needed), n1 without a DOM test (no harness for client.ts) — named aloud.
- **Shift housekeeping**: 3 overdue DECISIONs (07-13/14) resolved to applied defaults; handoff 35 was untracked → late-commit `66bce16` (same class of debt as 28/29); STATE "At a glance" rewritten (was stale from the GSL-41 era); nav-DECISION q-2026-07-20-001 resolved (d-2026-07-20-004).

## 3. What's next (immediately)

The successor spawns **finalizer-gsl90** (Opus 4.8): REGULAR merge PR #115 → close GH issues → Jira GSL-90 Done → delete branch → fetch main. Then **without stopping Phase 6 Mobile setup** (owner mandate 2026-07-10 continue-at-milestone-boundaries): PRD · "Phase 6", new epic GSL-102+, GH #116+. Detailed steps — in ⭐ RESUME below.

## 4. Problems

No blockers. Inherited debts (NOT Phase 5, for the owner): GSL-30 without dev_history; ledger-naming gap (48 names); `task.completed` not firing since 07-13 12:54; timer defaults nobody applies at night; token ceiling not machine-readable. New: the Jira epic GSL-90 description is stale (10 tasks instead of 11) — the finalizer can fix it in one line or the owner.

## 5. Comments and shift lessons

- **Owner directive 2026-07-20 (IN FORCE):** `orchestrating-delivery-agents` — use the GLOBAL skill ONLY (`~/.claude/skills/`), NOT the local copy `skill/` of this repo (there are problems in it). Do not run `./install.sh` for this skill. Fact at 10:24Z: copies are byte-identical, but the authority is the global.
- **⚠️ My chronic shift failure — the successor should not repeat:** I ended a turn with a tool call (ScheduleWakeup) without a final text to the owner 7+ times; the Stop-hook caught it every time. The rule is simple: **the ScheduleWakeup result = a signal to write text to the owner, not the end of the turn.** This is already HARD ×2 in memory — now ×3.
- All 6 worker lessons (Jira description first tool; grep before believing the description; "no source" verify by hand; ⛔ tree-wide git ops; ⛔ background restore-trap; read prose aloud + positive control) — live in handoff 35 · Part 1.5, bake into every impl brief.
- Amend BEFORE push — legal (the fixer did d7606b6→5e6d5ed before push); after push — forbidden, as before.

---

# ── Part 2 · Formal ──

## ⚠️ Hard rules

**All 20 handoff-35 · Part 2 rules in force without weakening** (turn ends with text; all workers Opus 4.8 transcript-verify; NO Workflow; fleet cap 3; AUTONOMOUS mode; REGULAR merge / no force-push / `gh api -X PUT` for merge; kill-pane by explicit id; ⛔ tree-wide git ops; ⛔ restore-trap; hook shim; settings live; status.json via lab-write.sh; dirty tree norm; poll-fill untouched; no `git add -A`; sovereign files; C5 words + literal `teammate_name` exemption; render/N schema = 4 files; queue read FOLD; assert mechanism + mutation; print your glob). Plus new: **global-skill directive 2026-07-20** (above).

## Connections

| | |
|---|---|
| Jira | project **GSL**, cloudId `74054cdc-47ef-497d-9684-734149876a8b`, transitions 11/21/31/**41=Done** |
| GitHub | `ainstance-labs/gosleep` (private) |
| **PR #115** | OPEN/CLEAN, base main ← `GSL-90-ui-orchestration @ 2d2b699`, Closes #103..#114 |
| Epic GSL-90 | Jira **In Review**; GH issue #103 |
| main | @ `5fd1de2` (Phase 4 = PR #102) |
| Owner | Roman L, accountId `557058:83b04839-8bde-4331-9c2d-24843d0b8e67` |
| Next Jira / GH | **GSL-102+** / **#116+** (Phase 6) |
| PRD | `docs/prd/PRD-gosleep-evolution.md` · "Phase 6" (Mobile) |

## Gates (no CI — by hand)

`bash tools/lab/smoke.sh` → **264/264** (flake :234 pre-existing, do not fix) · `bash tools/lab/hooks-verify.sh` → 14/14 · `(cd tools/lab/ui && npx tsc --noEmit)` → 0 · `bash tools/lab/chronicler.sh --no-poll` → 7 pages. Schema `gosleep.lab.render/7`.

## ⭐ RESUME POINT — successor orchestrator

```bash
# Cold-start orient (in order)
cat docs/handoff/ORCHESTRATION-STATE.md | head -30   # At a glance + LIVE-STATUS
cat docs/handoff/38-2026-07-20-handoff-orchestrator-roll.md   # this file
tail -5 docs/handoff/.orchestrator-heartbeat          # my final status=rolling

# Sanity
tmux list-panes -t "$(tmux display-message -p '#{session_id}')"  # own pane only
git log main --oneline -1                 # 5fd1de2
git ls-remote origin GSL-90-ui-orchestration  # 2d2b699
gh pr view 115 --json state,mergeStateStatus  # OPEN + CLEAN
tools/lab/lab-emit.sh list --count        # open=0 (0B/0D/0C/0F) lines=16

# First heartbeat (cycle 63, closes the watchdog grace)
```

**Task 1 — finalizer-gsl90 (Opus 4.8), brief:**
1. `gh api -X PUT repos/ainstance-labs/gosleep/pulls/115/merge -f merge_method=merge` (NEVER `gh pr merge`, never squash). Verify: `gh pr view 115 --json state,mergedAt`.
2. Close GH issues: #103 will close automatically (first in Closes); **close #104..#114 by hand** `gh issue close N --comment "GSL-9x merged in PR #115"` — verify each.
3. Jira GSL-90 → Done (41), verify `getJiraIssue` status.name="Done".
4. Delete remote branch `GSL-90-ui-orchestration`; local main: `git fetch origin main:main` (WITHOUT checkout; HEAD stays on the local epic branch until the Phase 6 branch).
5. Optional one line: add to the GSL-90 Jira epic description a mention of GSL-101 (stale — 10 tasks instead of 11).
6. Report ≤10 lines + model per transcript + telemetry line.

**Task 2 — Phase 6 Mobile setup (without stopping, owner mandate):** read PRD · "Phase 6" → spawn setup worker (Opus 4.8): epic GSL-102 + tasks in Jira (assignee owner), GH mirror #116+, branch `GSL-102-<slug>` from the new main, ledger commit of owner-sovereign files (STATE, queue.jsonl, decisions/log.jsonl, handoff 38, digest — precedents GSL-82/GSL-91) as the first task. Then impl cycles per tasks with the 6 lessons in briefs.

## Cumulative TELEMETRY (do not reset)

- **cycles_completed = 87**, total ≈ **8 589 000** tokens_out (+ gaps 2a/32/35/48-52/57-cache-write — see STATE TELEMETRY).
- My shift (59-62): impl-ui-7 226k/37.6M · mechanic 19k/1.8M · reviewer 112k/9.1M · fixer 166k/23.5M ≈ **523k out / 72M cache_read**.

## Gotchas

All from handoff 35 in force (site/ DERIVED; commit via `git commit -F`; ORCHESTRATION-STATE is not a handoff; pane.ended boundary — now with debounce 600s; name typos — process gap). New: self-health counts the last cycle's interval as OPEN (a handoff after the last boundary extinguishes the debt); Fleet ages live through the shared Age component (`components.tsx`); `docs/reviews/REVIEW-gsl90.md` gitignored — do not commit.

## Blocked on human

**None.** Queue open=0. Questions for the owner (not blockers, accumulate from handoff 35): GSL-30 dev_history; naming gap; nightly defaults; token ceiling; + Jira description of epic GSL-90 stale.
