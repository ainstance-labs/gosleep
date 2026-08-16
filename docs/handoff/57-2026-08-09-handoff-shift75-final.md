# Handoff — gosleep — 2026-08-09 (shift 75 closed: stack audit, Fable verification, epic GSL-250 built+merged)

> For a NEW orchestrator. Read Part 1 → Part 2 → RESUME. Ground truth = ORCHESTRATION-STATE.md.
> Supersedes handoff 56. Shift ran 2026-08-06 → 08-09 (orchestrator: Fable 5, cycles 184-218, ~24 workers).

## ORCHESTRATOR REPORT
Shift 75 delivered: (1) stack audit + true-Fable verification of shift-74 decisions; (2) epic GSL-250
(interactive web control plane) built end-to-end, independently verified (runs/01 42→runs/02 100),
MERGED to main @ 56f57d1, finalized (24 Jira transitions, 26 GH mirrors closed). Tokens: per-worker
counters were NOT surfaced by the harness this shift — TELEMETRY lines carry flagged gaps/estimates.

# ── Part 1 · Plain words ──

## 1. Where we are
The web control plane EXISTS and is merged: gosleep-core (Bun+Hono+SQLite/Drizzle, SSE, /metrics,
auth layers) + web client (React 19 + Vite 7 + Tailwind 4 + shadcn + Geist; 6 screens light/dark,
served by the core at 127.0.0.1:7331). The answer-delivery loop (blocking PreToolUse hook →
allow+updatedInput) is proven live and installed as a GUARDED PILOT: only sessions started with
GOSLEEP_WEB_QUESTIONS=1 route questions to the web. Verification dossier:
docs/reports/verifications/GSL-250/runs/{01,02}/ (run 02 = score 100, all fixes hold).

## 2. Owner decisions (2026-08-08/09 — matter most)
- **Design APPROVED as-is** (screens from runs/02 assets). Continue in this visual direction.
- **TouchID/Keychain PAUSED** (d-2026-08-09-001): OWNER-VERIFY items + plist-install wait until the
  web version is feature-complete; nothing currently blocks (touchid-gate is NOT wired into write
  paths — that wiring moved to GSL-174 scope anyway). Do not let this block web work.
- **Interception widening deferred**: enable the hook for ALL sessions only when the planned web
  functionality is complete and the owner starts really testing the web version.
- **NO silent default decisions (HARD, memory: no-silent-default-decisions)**: never auto-apply
  defaults on owner questions; ask explicitly and WAIT. apply-due is NOT to be run for owner
  decisions. Auto-apply timers abolished.
- **Auto-merge green PRs** (memory: auto-merge-green-prs): verified green epic PRs merge
  autonomously (regular merge), no permission asks.
- **English everywhere** (global ~/.claude/CLAUDE.md): PRDs (one file per phase, NN-phaseMM-slug),
  Jira, GH, handoffs, STATE. Russian only for human-facing reports + chat.
- **PRD Phase 7 re-scoped** (d-2026-08-08-002): skills-publish items moved to the skills-management
  phase; tickets GSL-266/286/287/288/292 re-parented to GSL-174.

## 3. What's next
1. Small tails: GSL-272/273 sit at To Do in Jira though merged (2-min transition fix);
   Atlassian MCP was DISCONNECTED at shift close — reconnect before Jira work.
2. Ask the owner what to take next: GSL-174 (skills management system — publish button lives there
   now) vs remaining web polish. GSL-271 (final SoT switchover/retirement) is soak-gated (30-60d).
3. Backlog seeds: PermissionRequest live-session proof ticket; channels dangerous-flag supervised
   proof; pilot observation of GSL-267.

## 4. Lessons of the shift
- Worker model self-reports LIED 7 times. Verify EVERY worker structurally: parse its transcript
  JSONL, count type=assistant entries' message.model. Bare grep is contaminated by quoted strings.
- Model control: CLAUDE_CODE_SUBAGENT_MODEL is re-read AT SPAWN TIME from settings files. Project
  .claude/settings.local.json (currently claude-opus-4-7) is the knob; Fable 5 point-runs via
  toggle; Agent-tool model param is IGNORED under any pin; forks inherit parent model FIRST TURN
  ONLY. Details: memory worker-model-toggle-settings-local.
- One git-stash incident (worker, self-reported, recovered) — the ban is now verbatim in every
  brief. One orchestrator telemetry miss (retro-fixed). Stop-hook caught one silent turn.
- Post-merge local sync: dirty live files (STATE, docs/lab) block checkout — per-file backup +
  pinpoint checkout + byte-exact restore; NEVER stash/reset.

# ── Part 2 · Formal ──

## Hard rules (full set in ORCHESTRATION-STATE.md Standing rules + memory MEMORY.md)
Production skills owner-only · gate: bash tools/lab/gate.sh (--offline without tracker) · NO
Workflow tool for workers · REGULAR merge, closes-before-each-number · no force-push, no
stash/reset in shared tree · install.sh under guard · project .claude/settings.json frozen after
GSL-267 (hooks live there) · .claude/settings.local.json = orchestrator's model knob, hands off ·
pulse: heartbeat FIRST → wakeup EARLY (never last tool call) → probes → owner TEXT last · workers:
PROGRESS every 5-7 min + mail at turn start + telemetry line (usually "unavailable" — flag, never
fabricate) · empty idle from a LIVE worker = mandatory capture-pane; after kill = noise.

## Connections
Jira GSL cloudId 74054cdc-47ef-497d-9684-734149876a8b, transitions 11/21/31/41 (MCP disconnected at
shift end — reconnect) · GitHub ainstance-labs/gosleep · owner Roman L accountId
557058:83b04839-8bde-4331-9c2d-24843d0b8e67 · main @ 56f57d1.

## Gates
bash tools/lab/gate.sh --offline → green on main (smoke 562/562, hooks-verify 11/11, tsc,
chronicler). Web-specific: bun test apps/core (191+), tools/lab/tests/core-smoke.sh (89 scenarios),
bun x tsc per package. Runbook: docs/runbooks/gosleep-core.md.

## Delivered this shift (all in main via PR #295, merge 56f57d1)
Audit corpus docs/reports/web-stack-audit-2026-08-06/ (6 reports) · rev-3 addendum + EN PRD
docs/prd/01-phase7-interactive-control-plane.md · 28 branch commits GSL-258..296 (see PR #295
checklist) · verification docs/reports/verifications/GSL-250/runs/01+02 · pilot hooks in
.claude/settings.json (guarded).

## Queue / decisions
Queue open=0 (lines=94). Key decisions: d-2026-08-08-001 (guarded pilot), d-2026-08-08-002 (Phase 7
re-scope), d-2026-08-09-001 (design approved + TouchID pause + widening deferred). Incident record
q-2026-08-08-001 (git stash, recovered).

## TELEMETRY
Shift 75: cycles 184-218, ~24 workers (3 audit + 2 fork-verify + 4 probes + 1 Fable-final +
14 impl/mechanic/verify cycles). Models: orchestrator Fable 5; workers Opus 4.7 (every one
transcript-verified); Fable 5 point-runs: impl-274 (68/68), fable-final-verify (53/53).
Per-worker tokens: unavailable from harness — gaps flagged in STATE TELEMETRY block.

## RESUME POINT — new orchestrator
1. Cold start: skills orchestrating-delivery-agents + tmux-agents-orchestration + handoff +
   delivery-workflow + using-jira → ORCHESTRATION-STATE.md → this handoff → memory MEMORY.md.
2. Sanity: tmux list-panes (own pane only) · git log origin/main -1 (56f57d1+) · gh pr list (empty)
   · lab-emit.sh list --count (open=0) · breaker-check.sh. ⚠️ do NOT run apply-due for owner
   decisions (abolished).
3. First heartbeat: bash tools/lab/heartbeat.sh --cycle 191 --context-pct N --open-workers 0 --status ok.
4. Fix the GSL-272/273 Jira status tail (after MCP reconnect), then ask the owner: GSL-174 vs web
   polish.
5. Worker briefs: include the git-stash ban verbatim, PROGRESS rule, transcript model verification,
   English-artifacts rule, and "Jira description + architecture win over the brief".
