# Handoff — gosleep — 2026-08-11 (shift 77: web QUALITY-ready, awaiting owner on PR #307)

> For a FRESH orchestrator (or my summarized self). Read Part 1 → Part 2 → RESUME. Ground truth = ORCHESTRATION-STATE.md.
> Supersedes handoff 59. Shift 77 open (orchestrator: Fable 5, pane %10). Owner ENGAGED (day), last messaged ~13:00Z.

## ORCHESTRATOR REPORT
Shift 77 delivered two big arcs the owner asked for. ARC 1 (independent web QA): fresh agents ran QA runs
03/04/05 (96/78/98), fixed the 3 MAJOR they found (GSL-311, PR #317 merged), web READY. ARC 2 (live-fire
E2E burn-in, owner mandate "exercise the whole harness with real agents until fully proven + all problems
fixed"): 5 live-fire runs (06-10) + 5 fix cycles, all merged. The live-agent DEFER round-trip is PROVEN;
every finding found→fixed→re-verified on the REAL dev-agent path. Web is now QUALITY-READY @ 60cc5ae.
Awaiting owner on the next block: PR #307 (skills-management) — the owner gated it on web being ready
(now ready). Every worker Opus 4.7, transcript-verified. Fleet EMPTY.

# ── Part 1 · Plain words ──

## 1. Where we are
The web control plane has been battle-tested end to end and is quality-ready. Over this session we ran a
real Claude agent building a to-do app *through* the harness while controlling it from the web panel, five
times, fixing everything that broke. The last uncovered interaction — deferring a question in the panel and
having a live agent wait then resume — is now proven. All fixes are merged to main @ 60cc5ae. The fleet is
empty and the orchestrator is idle, waiting for the owner to say how to approach PR #307 (the skills-
management system), which the owner said to start only after the web was ready — it now is.

## 2. Owner decisions / feedback (this shift — matter most)
- Independent web QA by fresh agents, each run its own HTML report w/ per-step screenshots. DONE (runs 03-05).
- Live-fire E2E: exercise the whole harness with REAL agents, use resources, keep running + fixing until
  fully proven ("quality over speed"). DONE (runs 06-10, all fixes merged).
- Haiku BANNED for every role; minimum tier = Sonnet (owner 2026-08-10 ~18:08Z, mid-run). Workers still
  Opus 4.7; Fable 5 point-wise. Memory: model-policy-by-complexity.
- Do NOT watch/narrate my own context (I over-reported 77% vs real 36%). Memory: no-context-obsession-just-execute.
- Skills-management (PR #307) starts AFTER web is ready (owner 2026-08-11 ~11:03Z). Web now ready.
- GSL-182-188 (skill-lesson edits) unblocked but owner wants to SEE the diffs before publishing (global skills).
- Workers VISIBLE tmux panes; close = kill-pane + TaskStop <name> + telemetry. Prod (data/, :7331, TouchID) paused/untouched.

## 3. What's next
1. ⭐ PR #307 (GSL-174 skills-management system) — owner review surface, OPEN since 2026-08-09. Owner gated it
   on web readiness (now met). Do NOT merge without owner review. Offer the owner a read-only summary of what's
   in the PR (registry / validator / skills screen / publish.sh / test-guard) if they want it. Await owner's word.
2. GSL-182-188 skill-lesson edits — unblocked; prepare diffs for owner review BEFORE any publish (global skills).
3. Backlog (minor, from the E2E arc, non-blocking): permission-timeout TUI-parallel semantic; Questions client
   status filter case-sensitive. File if/when convenient.

## 4. Problems / lessons this shift
- run 06: I launched the dev-agent in default permission mode → permission FLOOD hit the owner (frustration);
  and a confused Haiku dev-agent ran `git checkout -b` in the SHARED tree (branch-pointer only, 0 file changes,
  restored + orchestrator-verified). Both fixed: Sonnet + bypass + HARD sandbox OUTSIDE the gosleep tree; Haiku banned.
- The QUALITY MANDATE VINDICATED 3 layers deep: unit tests + in-process proofs kept passing while a real
  live agent kept finding what they missed (fleet-model boot-race twice; the C3 permission-timeout fix itself
  had a missing Origin header that only the real-agent path exposed). Lesson: user-facing interaction fixes
  MUST be re-verified with a real live agent, not just in-process.
- Adversarial adjudication of my own workers mattered: I stopped two premature "confirmed" claims (run 07
  FIX-B fable-5-vs-sonnet; run 08 API-vs-live evidence) and forced honest labeling / real proof.

## 5. Comments & recent decisions
- Test fixtures created + reused: private repo ainstance-labs/gosleep-e2e-todo (permanent throwaway); Playwright
  standalone package at tools/e2e (bun runtime; NOT in root workspaces). Test Jira epics GSL-315/322/326/330 and
  their tasks all closed as test artifacts / shipped.
- Owner's OTHER project (tasty-lunch) runs dev-tlm* workers in panes %0/%298/%307 — NEVER touch them; they are
  not this session's.

# ── Part 2 · Formal ──

## Hard rules (full set in ORCHESTRATION-STATE.md + memory MEMORY.md)
Workers default Opus 4.7 (settings.local.json pin), Fable 5 point-wise; **Haiku BANNED all roles, min = Sonnet** ·
verify EVERY worker model from transcript JSONL · NO Workflow tool for workers · REGULAR merge, closes-before-each-
number · no force-push · NO git stash/reset in shared tree + no `git add -A` · install.sh under guard, agents NEVER
write ~/.claude/skills (global authoritative, global→local only) · .claude/settings.json UNFROZEN · workers VISIBLE
tmux panes + close = kill-pane + TaskStop <name> + telemetry · dev-agents HARD-sandboxed OUTSIDE the gosleep tree
(bypass has no gate) · DO NOT watch/narrate own context · pulse: heartbeat FIRST → wakeup EARLY (never last tool)
→ probes → owner TEXT last.

## Connections
Jira GSL cloudId 74054cdc-47ef-497d-9684-734149876a8b, transitions 11/21/31/41 · GitHub ainstance-labs/gosleep
(+ test fixture ainstance-labs/gosleep-e2e-todo) · owner Roman L accountId 557058:83b04839-8bde-4331-9c2d-24843d0b8e67 ·
main @ 60cc5ae.

## Gates
bun x tsc per package · bun test apps/core (292 as of GSL-330) · bash tools/lab/tests/core-smoke.sh (102) ·
web build · bash -n tools/hooks/*.sh. Live-fire E2E harness: tools/e2e (Playwright, bun); dev-agent interception
needs a clone with its own .claude/settings.json wiring PreToolUse[AskUserQuestion] + top-level PermissionRequest[.*]
to ABSOLUTE gosleep shim paths + exported GOSLEEP_WEB_QUESTIONS=1 + GOSLEEP_INTERNAL_SECRET + GOSLEEP_CORE_URL.

## Delivered this shift (merged to main @ 60cc5ae)
GSL-311 web functional-QA hotfix (PR #317) · GSL-318 harness interaction fixes — permission-card command, fleet
real-model, PR-link surface (PR #324) · GSL-325 fleet boot-window race (in #324) · GSL-326 cosmetic polish —
friendly model label, Latest-PR empty-state, PR #N link (PR #330) · GSL-330 run-09 fixes — boot-race for real
session, tool-observed PR-URL from real gh (stderr), permission-timeout expire + Origin-header follow-up (PR #335).
Verification dossiers: docs/reports/verifications/web-e2e-2026-08-10/runs/03..10.
NOT merged: PR #307 (GSL-174 skills-management) = owner review surface.

## RESUME POINT — orchestrator
1. ⭐ Await owner direction on PR #307 (skills-management). Web is quality-ready (the gate the owner set). Offer a
   read-only PR summary if asked; do NOT merge without owner review; do NOT touch ~/.claude/skills / install.sh /
   global (global authoritative). GSL-182-188 = prepare diffs for owner before publish.
2. Fleet is EMPTY. Standing pulse: heartbeat FIRST → wakeup EARLY → probes → owner TEXT last. Night boundary
   ~22:00Z → mode=night + reversible-green-only.
3. Panes %0/%298/%307 = tasty-lunch (owner's OTHER project) — NEVER touch. Only %10 is this orchestrator.
4. Cold-start: load skills (orchestrating-delivery-agents, tmux-agents-orchestration, handoff, delivery-workflow,
   using-jira) → this handoff → ORCHESTRATION-STATE.md → memory MEMORY.md. Sanity: git log origin/main -1
   (60cc5ae+), gh pr list (PR #307 open), lab-emit list --count (open=0, lines=94), tmux list-panes (own %10).

## Gotchas
- dev-agent interception is PROJECT-SCOPED ($CLAUDE_PROJECT_DIR) — a clone needs its own settings.json w/ absolute
  shim paths; env must be EXPORTED in the parent shell before `claude` (settings-env doesn't propagate).
- headless `--print` DISABLES AskUserQuestion — the interactive tmux pane is the only proof shape for questions.
- bypass mode has NO permission gate — dev-agent MUST be sandboxed OUTSIDE the gosleep tree (run-06 incident).
- worker telemetry: /cost not exposed to workers; recover tokens from transcript JSONL usage sums (done per cycle in STATE).

## Blocked on the human
- PR #307 direction (how to approach the skills-management review). Web-readiness gate now satisfied.
- GSL-182-188: owner wants to see skill-lesson diffs before any global publish.
