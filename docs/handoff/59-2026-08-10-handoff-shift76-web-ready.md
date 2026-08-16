# Handoff — gosleep — 2026-08-10 (shift 76 day: web version ready for owner testing)

> For a NEW orchestrator (or my summarized self). Read Part 1 → Part 2 → RESUME. Ground truth = ORCHESTRATION-STATE.md.
> Supersedes handoff 58. Shift 76 still open (orchestrator: Fable 5, ~13h, context ~98%). Owner is ENGAGED (day).

## ORCHESTRATOR REPORT
Since handoff 58: merged the web feature-complete epic GSL-297 (PR #303) and the PermissionRequest fix GSL-304
(PR #306) overnight; this morning ran a FUNCTIONAL QA of the web version (run 01 = 62/100, 3 MAJOR defects),
fixed them (GSL-307 hotfix, PR #312 merged @ dfe8448), re-verified (run 02 = 96/100 READY), and did the
owner-sanctioned reverse-sync O1 (GSL-251). Also cleaned a FleetView roster problem (kill-pane leaves teammate
tombstones — now deregister via TaskStop by name). Web version is now READY for the owner to test. Every worker
model transcript-verified Opus 4.7.

# ── Part 1 · Plain words ──

## 1. Where we are
The web control plane is done, tested, and ready for the owner to actually use. A full click-through QA with
screenshots found 3 real bugs (typing a custom answer crashed the dialog; the page fired 5000+ failing
background requests; refreshing any non-home page returned an error) — all three are now fixed and confirmed
fixed on main. The skills-management system (epic GSL-174) has a night-built slice sitting in PR #307 for the
owner to review, and its reverse-sync step (GSL-251) is done, which unblocks the next 7 skill-content tasks.

## 2. Owner decisions / feedback (this shift — matter most)
- Web to feature-complete FIRST, then skills management (d-2026-08-09-002). DONE — web is ready.
- FULL night autonomy + `.claude/settings.json` UNFROZEN (d-2026-08-09-005). Do NOT stop work to ask when you
  hold full rights and there's clear work — the owner called that "sabotage" (memory night-autonomy-and-unfreeze).
- Do NOT dump ragged / low-level / plumbing questions on the owner; questions must be plain, self-contained,
  owner-meaningful (memory no-ragged-context-to-owner).
- Web readiness must be proven by FUNCTIONAL verification cycles, each run = its own HTML report with per-step
  screenshots (memory web-verification-html-runs).
- Workers must be VISIBLE tmux panes, never isolation:worktree (invisible). Close a worker = kill-pane +
  TaskStop <name> (deregister from FleetView) + telemetry (memory workers-visible-in-tmux).
- TouchID/Keychain stays PAUSED until the owner tests the working web version (d-2026-08-09-001).
- Reverse-sync O1 (GSL-251) sanctioned — GLOBAL skills NEVER modified (global→local only). DONE.

## 3. What's next
1. ⭐ OWNER DIRECTIVE (2026-08-10 ~12:25Z, roll to fresh orchestrator): the NEW orchestrator runs its OWN
   INDEPENDENT web-version testing — fresh QA agents, one or more additional runs (runs/03+), each with its own
   HTML report + per-step screenshots. Do not rely on the prior run 01/02. See RESUME POINT task 1.
2. GSL-174 skills management: PR #307 (night slice + GSL-251) awaits owner review. The 7 content-edit tasks
   GSL-182-188 are now unblocked, but they add lessons to skill copies — the owner may want to steer/review
   what goes in. GSL-266/288/257 remain TouchID-gated (paused).
3. Backlog minor from web QA: Questions client status filter is case-sensitive (non-blocking).

## 4. Problems / lessons this shift
- FleetView showed ~14 worker "tombstones" (10-12h since spawn) because kill-pane frees the pane but does NOT
  deregister the teammate. Fixed all via TaskStop by name; new close protocol codified.
- I launched one fix worker with isolation:worktree = invisible background agent; the owner couldn't see it.
  Re-launched visibly. Rule saved: always visible tmux panes.
- chrome-devtools MCP disconnected; workers used raw Chrome headless + CDP successfully (real screenshots).
- I once stopped to ask the owner a low-level settings.json question — flagged as sabotage/ragged-context.

# ── Part 2 · Formal ──

## Hard rules (full set in ORCHESTRATION-STATE.md + memory MEMORY.md)
Workers default Opus 4.7 (settings.local.json pin), Fable 5 point-wise at orchestrator discretion · verify EVERY
worker model from transcript JSONL · NO Workflow tool for workers · REGULAR merge, closes-before-each-number ·
no force-push · NO git stash/reset in shared tree (q-2026-08-08-001) + no `git add -A` (grabs orchestrator dirty
files) · install.sh under guard, agents NEVER write ~/.claude/skills (global authoritative, global→local only) ·
.claude/settings.json UNFROZEN · workers VISIBLE tmux panes only + close = kill-pane + TaskStop <name> +
telemetry · pulse: heartbeat FIRST → wakeup EARLY (never last tool) → probes → owner TEXT last.

## Connections
Jira GSL cloudId 74054cdc-47ef-497d-9684-734149876a8b, transitions 11/21/31/41 · GitHub ainstance-labs/gosleep ·
owner Roman L accountId 557058:83b04839-8bde-4331-9c2d-24843d0b8e67 · main @ dfe8448.

## Gates
bash tools/lab/gate.sh --offline: NOTE lab-smoke is data-state-sensitive — it shows ~14 fails purely from the
orchestrator's uncommitted docs/lab live state, NOT real regressions (adjudicate vs a pinned main worktree, as
prior verifiers did). Web: bun x tsc per package, bun test apps/core (245), core-smoke.sh (102), web build.

## Delivered this shift (merged to main)
GSL-272/273 (Jira tail) · Epic GSL-297 web feature-complete PR #303 @ c953872 · Epic GSL-304 PermissionRequest
fix PR #306 @ baa3ddb · Epic GSL-307 web functional-QA hotfix PR #312 @ dfe8448 (GSL-308 answer crash / GSL-309
request storm / GSL-310 SPA-401). Verification dossiers: docs/reports/verifications/{GSL-297,GSL-304,GSL-174-night,web-e2e-2026-08-10}/runs/**.
NOT merged: PR #307 (GSL-174 skills-management night slice + GSL-251 reverse-sync) = owner review surface.

## RESUME POINT — new orchestrator (owner directive 2026-08-10 ~12:25Z: ROLL to a fresh orchestrator)
⭐ **TASK 1 — OWNER DIRECTIVE: run INDEPENDENT web-version functional testing with FRESH agents.** Do NOT trust
the prior orchestrator's run 01/02 (62→96). Spawn NEW, INDEPENDENT QA verifiers (fresh eyes) for one or MORE
additional runs (runs/03, runs/04, …) that exercise the web version's functionality from their own side.
- Each run = its OWN self-contained HTML report (EN primary + RU shell, agentic-report-creator skill) with a
  per-step SCREENSHOT + description, under docs/reports/verifications/web-e2e-2026-08-10/runs/NN/ (memory
  web-verification-html-runs). Walk all screens + interactive actions as real test scenarios.
- The merged web version is on main @ dfe8448 (also present on the GSL-174-skills-management branch = the
  current working tree, main + additive skills work). Boot a SCRATCH core (own port + own seeded DB under
  .artifacts/, NEVER production data/gosleep.db, NEVER port 7331). Browser: raw Chrome headless + CDP works
  (chrome-devtools MCP may be disconnected). Prior fixes verified: GSL-308 answer-crash, GSL-309 request-storm,
  GSL-310 SPA-401 — an independent run should confirm they hold AND probe anything run 01/02 missed.
- If a fresh run finds new defects: fix on a hotfix branch off main (visible tmux worker + its own `git worktree
  add`), verify, PR, re-QA — same loop that shipped GSL-307.
2. Workers: VISIBLE tmux panes ONLY (normal Agent, never isolation:worktree — it makes them invisible). Close
   each worker = kill-pane + `TaskStop <name>` (deregisters from FleetView roster — kill-pane alone leaves
   tombstones) + append telemetry line. Verify EVERY worker's model structurally from its transcript JSONL.
3. Do NOT merge PR #307 — owner reviews it. Do NOT touch ~/.claude/skills (global authoritative, global→local
   only), TouchID/Keychain (paused until owner tests web), or push local→global. settings.json is UNFROZEN.
4. Do NOT dump ragged/low-level questions on the owner; night autonomy in effect; don't stop work when you hold
   full rights and there's clear work (see memory: night-autonomy-and-unfreeze, no-ragged-context-to-owner).
5. After the independent web QA: PR #307 (skills mgmt night slice + GSL-251) awaits owner review; GSL-182-188
   skill-content edits are unblocked (they change skill lessons — surface what goes in); GSL-266/288/257
   TouchID-gated (paused). GSL-271 soak-gated (30-60d).
6. Cold-start: load skills (orchestrating-delivery-agents, tmux-agents-orchestration, handoff, delivery-workflow,
   using-jira) → this handoff → ORCHESTRATION-STATE.md → memory MEMORY.md. Sanity: tmux list-panes (own pane),
   git log origin/main -1 (dfe8448+), gh pr list (PR #307 open), lab-emit.sh list --count (open=0), breaker-check.
   First heartbeat: tools/lab/heartbeat.sh --cycle 210 --context-pct N --open-workers 0 --status ok.
