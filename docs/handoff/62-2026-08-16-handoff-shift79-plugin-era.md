# Handoff — gosleep — 2026-08-16 (ROLL to shift 79: plugin era + observer mode live)

> For a FRESH orchestrator. Read Part 1 → Part 2 → RESUME. Ground truth = ORCHESTRATION-STATE.md.
> Supersedes handoff 61. Predecessor (shift 78, Fable 5, pane %10) ROLLED at R's command. R ENGAGED (day).
> HARD GATE at roll: fleet EMPTY (open_workers=0, only predecessor's own pane). The trial web-panel instance
> on 127.0.0.1:7331 was CLOSED at R's command at roll time (process killed, port free, worktree removed) —
> there is NO live panel and nothing to adopt. R is called "R" in chat (his standing preference).

## ORCHESTRATOR REPORT
Shift 78 (2026-08-15 18:35Z → 2026-08-16 ~18:1xZ, one session) delivered the ENTIRE plugin foundation +
observer-mode phases A/B. 5 PRs merged to main (now @ 53bab60): #339 phase-0 orphan rescue, #340 plugin PRD,
#307 skills-management (GSL-174, finally landed after verify cycle), #349 observer phase A, #351 observer
phase B. 5 epics + ~30 Jira tasks closed. gosleep-plugins repo v0.1.0 live. 2 plugin-era E2E runs (90/100,
94/100). ~15 workers closed, every model transcript-verified (Opus 4.7 default; 1× Fable 5 point-run for the
strategy writer). R's ~/.claude NEVER touched by agents (sha proofs in every run). Fleet at roll: EMPTY.

# ── Part 1 · Plain words ──

## 1. Where we are
- **Plugins:** strategy FINAL (docs/reports/plugin-migration-research-2026-08-15/strategy.md, 1367 lines, all
  owner corrections in: SOFT transition, G1-G4 global sub-plan, D3/D4 DECIDED = dedicated private repo
  `ainstance-labs/gosleep-plugins`); PRD phases 9-13 in docs/prd/; repo v0.1.0 @ b5f56fd (3 bundles:
  gosleep-delivery 4 skills / gosleep-orchestration 3 / gosleep-evals 5 = 12 owner skills, validate 4/4,
  --plugin-dir load-proof). NOTHING installed into ~/.claude — G1 (global parallel install) awaits the
  owner's explicit command and STARTS THE ~1-MONTH TRIAL.
- **Observer mode:** PRD phases 14-16 merged; Phase A (passive machine-wide observation: tmux map, /observed
  screen + routes, zero-influence sentinel) merged @ 7e44e59; Phase B (runtime Take/Release control replacing
  the env-flag opt-in) merged @ 53bab60 — both after adversarial verify cycles incl. LIVE-agent legs
  (dossiers docs/reports/verifications/GSL-347/runs/01-02). Phase C = task submission from web —
  REQUIREMENTS ONLY (10-phase16), build awaits owner GO.
- **Web panel:** the trial observer-mode instance on 7331 is CLOSED (R's command at roll). When R wants the
  panel again, boot a FRESH one from current main (worktree + build + serve; recipe pattern in STATE cycle
  281 and docs/runbooks/gosleep-core.md) — it will include the Observed screen and the control toggle.

## 2. Owner decisions this shift (all in STATE, dated)
- Merges are AUTONOMOUS, do not stop at merge — result = merged PRs (memory auto-merge-green-prs HARD).
- Plugin transition ONLY by owner approval; SOFT coexistence; direction stays global→local until far-future
  gate (gosleep = full PRODUCTION). D3 = dedicated repo, D4 = gosleep-plugins. Owner WILL ADJUST plugin
  structure/composition later — nothing is installed yet, renames are still free.
- Observer privacy = show ALL project names (opt-out hide list); depth = facts + inferred work-topic.
- Auto-mode prompts were interrupting workers → .claude/settings.json got permissions.allow (43 rules).
  Bypass per-pane via shift+tab remains the full-autonomy option.

## 3. What's next — R's directive at roll (2026-08-16, supersedes earlier ordering)
⛔ PLUGINS ARE FULLY DEFERRED (G1 install, structure corrections, month trial, GSL-182-188 reframing — ALL
of it) until the harness + web-interface refinements are DONE and verified. Do not spend cycles on plugins.
✅ CURRENT PROGRAM: refine the HARNESS itself + the web interface. Start IMMEDIATELY, autonomously — do not
wait for R's instructions. Build the work queue from:
1. Jira GSL backlog: every open To Do / In Progress task EXCEPT frozen (GSL-105/106, tailscale), soak-gated
   (GSL-271) and anything plugin-program-related. There are MANY tasks — sweep JQL, triage, execute.
2. Follow-ups filed this shift: GSL-359 (pidtree primacy), GSL-360 (collector chunked folds), GSL-367
   (lighter shim stdin peek), GSL-368 (9.4s cutover outlier).
3. Panel UX minors from the E2E runs — file as tasks and fix: Answer dialog has no clickable variant
   options; Defer preset ladder lacks short presets.
4. Observer Phase C (task submission from web, PRD 10-phase16) — counts as web-interface refinement, in the
   queue per this directive.
5. Housekeeping: shared tree on stale local branch GSL-174-skills-management (sync to main at a safe
   boundary — per-file backup, NEVER stash/reset).
Then: SEVERAL REAL VERIFICATION CYCLES (live agents + adversarial skeptics, HTML run-reports EN+RU per the
established runs/NN convention) over the refreshed harness + web — R measures readiness by those cycles.

## 4. Problems / lessons (carry these)
- Live-path rule paid again ×3: PR #307 registry hardcoded 7 skills (units green, screen wrong); Phase A
  pidtree declared-not-implemented; Phase B verified contract-only until I required the live leg. ALWAYS
  demand the live-agent lane before merge of user-facing surfaces.
- Teammate mail is FLAKY: two workers' COMPLETE reports arrived only via pane capture, one arrived minutes
  late. On empty idle after active work → tmux capture-pane immediately (tmux-agents skill rule). Briefs now
  say "COMPLETE via SendMessage BEFORE idling".
- Permission dialogs "sent to team leader" can wedge a worker indefinitely (no actionable prompt arrives).
  Unstick: mail the authorization, then `tmux send-keys Escape` to cancel the dialog; worker resumes and
  reads mail. Two occurrences (verify-361).
- /tmp worktrees keep sneaking in (3 slips) — the ban must be VERBATIM in every brief.
- Skill-lesson checklist (handoff skill step 7): 2 lesson candidates above belong in
  tmux-agents-orchestration; global skills are owner-edited only, and under the plugin model these become
  versioned releases — filed as digest items for the owner, no global edit made.

# ── Part 2 · Formal ──

## Hard rules (full set in ORCHESTRATION-STATE.md + memory MEMORY.md)
Workers default Opus 4.7 (settings.local.json pin), Fable 5 point-wise; Haiku BANNED, min Sonnet · verify EVERY
worker model from transcript JSONL · NO Workflow tool for workers · REGULAR merge · no force-push · NO git
stash/reset/add -A in shared tree · agents NEVER write ~/.claude (global authoritative; plugins repo populated
by owner-commanded snapshots global→repo) · workers VISIBLE tmux panes, close = kill-pane + TaskStop <name> +
telemetry · worktrees NEVER in /tmp · pulse: heartbeat FIRST → wakeup EARLY (never last tool) → probes → owner
TEXT last (Stop-hook enforces) · panes %0/%298/%307 = tasty-lunch (owner's other project) NEVER touch.

## Connections
Jira GSL cloudId 74054cdc-47ef-497d-9684-734149876a8b, transitions 11/21/31/41 · GitHub ainstance-labs/gosleep
(+ gosleep-plugins, + fixture gosleep-e2e-todo) · owner Roman L accountId 557058:83b04839-8bde-4331-9c2d-24843d0b8e67
· main @ 53bab60 · no open PRs in gosleep · queue open=0 lines=94 · breaker CLOSED.

## RESUME POINT
1. Cold-start: this handoff → ORCHESTRATION-STATE.md → memory MEMORY.md. Census: own pane only. Sanity:
   git log origin/main -1 (53bab60), gh pr list (empty), port 7331 FREE (panel closed by design),
   lab-emit list --count (open=0 lines=94).
2. START WORKING IMMEDIATELY — R's explicit order: no waiting for instructions. First cycle: JQL-sweep the
   GSL backlog (exclusions per section 3), produce a triaged execution plan, spawn the first workers, report
   the plan to R while work is already running. Plugins = untouchable until the harness program completes.

## Gates
bun x tsc per package · bun test apps/core (350) + apps/web (58) · core-smoke 102 · shim-control-gate 5/5 ·
prod-dir-override-smoke 7/7 · web build · bash -n tools/hooks/*.sh · smoke.sh baseline 406/160 (pre-existing
frozen-site fails — compare against main before blaming a branch).

## Blocked on the human
- NOTHING blocks the start — the harness-refinement program runs autonomously (R's order).
- Deferred until the program completes: the entire plugin track (G1, structure corrections, trial).
- R's call when he wants it: fresh panel boot from current main.
- Digest items 2026-08-16: auto-mode allowlist review, permission-dialog wedge, mail flakiness.
