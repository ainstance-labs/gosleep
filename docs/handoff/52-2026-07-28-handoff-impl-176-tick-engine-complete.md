# Handoff 52 — impl-176: epic GSL-176 (cadence engine) delivered, PR #254 waiting for merge

**Date:** 2026-07-28. **Author:** impl-176 (shift-74 worker). **Epic status:** In Review, PR NOT merged.

## Part 1 — what happened, plain words

The system got an engine. Before, everything "regular" — rebuild the dashboard, apply an overdue
decision, check against Jira — hung on the memory of a live agent: forget it, and the dashboard
lied about its age and the decision hung open until morning. Now this is done by two mechanisms
without a single LLM call.

First is the debounce hook, which was designed back in the original research and simply dropped
during implementation: any write into `docs/lab/`, after 90 seconds of silence, rebuilds the lab
by itself. It is already working — the log `docs/lab/supervision/tick-ledger.jsonl` holds real
lines from this very shift.

Second is the safety tick `tools/lab/tick.sh` for hours when there are no agents: poll external
truth, apply overdue defaults (the new `apply-due` command; separately, `resolve` no longer allows
closing decisions early or twice — the audit caught this in half the cases), rebuild surfaces if
stale, and leave a single line in the log. If there is no work — the tick honestly writes "idle"
and spends nothing. What remains is picking the tick carrier — this is the night-time preflight
the owner runs with a single action once he picks the date.

The standard shift gate has also become code (`tools/lab/gate.sh`) and no longer turns the tracker
check off, and how to run it all is described in the runbook `docs/runbooks/tick-engine.md`.

## ORCHESTRATOR REPORT

**Branch:** `GSL-176-tick-engine` from 746e98c (origin/main), pushed.
**PR:** https://github.com/ainstance-labs/gosleep/pull/254 — `Implements GSL-176`, closes #176,
#198–#204. **DO NOT MERGE without owner/orchestrator** (brief rule).
**Jira:** GSL-176 In Review; GSL-198, 199, 200, 201, 202, 203, 204 — all Done, summary comment
on the epic.

**Commits (one per task + finalizer):**
1. `ffa5f32` GSL-198 — debounce hook (engine + fail-open shim + 2 records in settings.json)
2. `9df9f86` GSL-200 — `lab-emit apply-due` + `resolve` guards (early → only `--early` =
   answered-by-default; double close and BLOCKER — refused)
3. `3e0a20a` GSL-199 — `tick.sh` (poll-fill → apply-due → chronicler on stale → armed-check
   → ledger line; lock; `--repo` for fixtures)
4. `803704d` GSL-202 — idle gate ("don't wake if there is no work", trace in the ledger)
5. `1e945e1` GSL-201 — carrier preflight (plist template, OWNER's arm/disarm, morning report)
6. `44882b3` GSL-203 — `gate.sh` (standard gate without `--no-poll`; offline only if explicit) + errata
7. `0fb475f` GSL-204 — runbook `docs/runbooks/tick-engine.md`
8. `af65d73` GSL-176 — bundle rebuild grade=fresh as the last commit (rule GSL-194)

**Gates (before → after):** smoke 497 → 545, FAIL=0; hooks-verify 14 → 19, FAIL=0; tsc 0;
chronicler WITH polling FRESH. Receipts in `.artifacts/lab/gates/`.

**Actions waiting on the sovereign (orchestrator/owner):**
1. **Merge PR #254** (regular merge) and close GH issues #176, #198–#204 (auto-close will take
   only the first in the list).
2. **Apply the gate errata** — `docs/handoff/GSL-203-errata-shift-gate.md`: in worker briefs and
   STATE the gate formula changes to `bash tools/lab/gate.sh` (without `--no-poll`).
3. **Pick the preflight-night date** (d-2026-07-28-005). Evening run:
   `bash tools/lab/preflight/preflight-arm.sh` (owner; prints the Desktop task instruction too) +
   ordinary caffeinate. Morning: `bash tools/lab/tick-preflight-report.sh` — a per-carrier table
   for the question-5 fork (main — who ticked; launchd — safety net, d-2026-07-28-003).

**Deviations and findings:**
- Incident-lesson (no damage): during a manual test of tick.sh a single `lab-emit question` went
  into the live queue without `GOSLEEP_LAB_DIR` (record `q-2026-07-28-005`); closed honestly
  with `answer --by impl-176`, queue as it was (3 open). Rule: every hermetic lab-emit call starts
  with `GOSLEEP_LAB_DIR=fixture`.
- `armed-check` does not exist (GSL-211 in GSL-178 builds it) — the tick honestly writes
  `"armed_check":"absent"`; the script will pick it up automatically once present
  (`-x tools/lab/armed-check.sh`).
- The debounce hook is LIVE since the settings.json edit (reread on the fly): background rebuilds
  run during any session; kill switch — `GOSLEEP_DEBOUNCE_DISABLE=1`; runbook describes.
- In tick.sh the chronicler runs with `--no-poll` BY COMPOSITION (step 1 has already polled) — this
  is not offline; do not "fix".
- The ledger `docs/lab/supervision/tick-ledger.jsonl` — tracked append-only (like events/): the
  tree will regularly get dirty with its lines between commits; this is the norm for the
  supervision archive.

**dev_history:** 7 files `GSL-19x/20x-audit3-*.md` + index (epic GSL-176 section).
**Runbook:** `docs/runbooks/tick-engine.md` (armed status / disarming / diagnosis without reading code).

**Summary for the next agent:** the engine is built and partly already live (debounce ticks, tick
was dogfooded manually); the preflight night is on the owner; after PR merge and the errata the
gate formula is one command.
