# Handoff — gosleep — 2026-09-07 (ROLL to shift 80: quiet boundary after the harness+web program)

> For a FRESH orchestrator. Read Part 1 → Part 2 → RESUME. Ground truth = ORCHESTRATION-STATE.md.
> Supersedes handoff 62. Predecessor (shift 79, Fable 5, pane %10) ROLLED at R's command on a
> PERFECTLY CLEAN boundary: fleet EMPTY (open_workers=0), no open PRs, question queue open=0
> (lines=94), main @ 82564b0, shared tree ON main, port 7331 FREE (no panel running).
> R is called "R" in chat (standing preference). Chat with R is Russian; all artifacts English.

## ORCHESTRATOR REPORT
Shift 79 (2026-08-16 18:31Z → 2026-08-17 ~09:00 local active; then quiet duty until roll 2026-09-07)
delivered R's ENTIRE directive: harness + web-interface refinement program, executed and live-verified.
13 PRs merged to gosleep main (now @ 82564b0) + 1 fixture PR (gosleep-e2e-todo #14 @ dc05ac6) +
2 ledger commits (253cb38, 82564b0). ~60 Jira issues closed. Verification convergence proven by
three fresh-eyes E2E cycles on REAL Claude fixtures: 82 → 87 → 92 (READY) + runtime Take/Release
leg 98/100 (GSL-403 runs/02). ~24 workers closed, every model transcript-verified = claude-opus-4-7
(fixtures Sonnet 5; two self-report hallucinations caught — transcripts are the only truth).
R's ~/.claude never modified by agents (one mtime-only probe incident, content byte-identical,
documented). Plugins untouched per directive.

# ── Part 1 · Plain words ──

## 1. Where we are
- **The harness+web program is DONE and TRIPLE-VERIFIED.** Panel now has: clickable answer variants,
  short defer presets + manual Reopen, permission cards with formatted headings + SSE pushes,
  observer screens with correct ranked attribution (server + client), runtime Take/Release control,
  and Phase C — task submission from the panel (dry-run preview → confirm → delivery, full audit
  incl. released_mid_submit). Shims are −31..36% faster with a synchronous first heartbeat and
  robust real-CC prompt detection. TouchID gate exists but is DEFAULT-OFF (stub) per R.
- **Verification dossiers (EN+RU):** docs/reports/verifications/harness-web-e2e-2026-08-17/runs/01..03/
  + GSL-403/runs/02/ (supersedes stale runs/01) + per-epic dossiers (GSL-370/373/374/288/243/387).
- **Nothing is running:** no panel on 7331, no workers, no scratch cores. Tree clean except the
  roll ledger (committed at this boundary) and local-only .claude/backups/.

## 2. Owner decisions in force (all dated in STATE)
- d-2026-08-16-001: TouchID NOT a priority; deliberate stub; gate ships DEFAULT-OFF behind
  GOSLEEP_TOUCHID=1; real activation is a future phase (GSL-266 with it); GSL-385 hardening landed.
- d-2026-08-18-001: question-loop WIDENING DECLINED — the dev loop with R must not change; standing
  mode = opt-in flag + runtime Take/Release per session; orchestrator session stays unintercepted.
  Revisit ONLY on R's explicit command; preconditions then: opt-out flag + pane breadcrumb.
- Plugins track (G1 install, structure edits, month trial, GSL-182..188 and all skill-content
  edits GSL-235/242/256/257) remains FROZEN. R's unfreeze condition (program done+verified) is
  now met — but unfreezing is R's explicit call, do not start it yourself.
- Merges autonomous after verification (regular, never squash); fix-first-then-merge on
  MERGE-with-followup verdicts; no silent default decisions for owner-significant forks.

## 3. What's next — a MENU awaiting R (nothing is urgent, nothing blocks)
1. Fresh panel boot from current main when R wants to click through the results (worktree + build
   + serve per docs/runbooks/gosleep-core.md; 7331 free).
2. Plugin track unfreeze — R's call.
3. Optional autonomous work if R says "go": E2E run 04 (regression soak), GSL-395 (qshape negation
   + delegation provenance), GSL-368 stays WATCH (dtruss on 2nd production 3s+ outlier),
   deferred-status hygiene for GSL-242 & co (R was asked, no answer yet).
4. Remaining backlog is deferred-by-ruling only (plugins/skills/TouchID/tailscale GSL-105/106/107,
   soak GSL-271, mobile GSL-102) — do not schedule any of it without R.

## 4. Lessons of shift 79 (carry into every brief)
- Live-path rule paid 5+ times: green units hid real bugs (heartbeat silent-fail, prompt-detect
  missing real CC, PRD deviation, cross-session idem-key escape) that only REAL-fixture legs caught.
  Never merge a user-facing surface without a live leg; verify cycles then fix-first.
- STALE-BASE trap ×3: workers named 253cb38 as HEAD without fetching. MANDATE now in every brief:
  "git fetch FIRST + state origin/main SHA in your FIRST PROGRESS message". One run (verify-403)
  was VOIDED for this — both correction mails were lost to the mail flake mid-flight.
- Mail is flaky: COMPLETE reports cross with extensions; empty idle after active work → tmux
  capture-pane IMMEDIATELY. Nudge once, never spawn a duplicate.
- Worker transcripts of worktree-cwd workers live under a DIFFERENT project dir
  (~/.claude/projects/...--claude-worktrees-<name>/) — search there when verifying models.
- Model self-reports hallucinate (claimed "Sonnet 4.5", wrong session ids) — always verify
  structurally: jq assistant .message.model over the transcript JSONL.
- Claude Code 2.1.233 silently disables project hooks when cwd is not the trusted git root —
  launch fixtures with cwd=repo-root + CLAUDE_PROJECT_DIR=repo-root.

# ── Part 2 · Formal ──

## Hard rules (full set in ORCHESTRATION-STATE.md + memory MEMORY.md)
Workers default Opus 4.7 (settings.local.json pin), Fable 5 point-wise; Haiku BANNED, min Sonnet ·
verify EVERY worker model from transcript JSONL · NO Workflow tool for workers · REGULAR merge ·
no force-push · NO git stash/reset/add -A in shared tree · agents NEVER write ~/.claude · workers
VISIBLE tmux panes, close = kill-pane + TaskStop <name> + telemetry line · worktrees NEVER in /tmp
(ban verbatim in every brief) · pulse: heartbeat FIRST → wakeup EARLY (never last tool) → probes →
owner TEXT last (Stop-hook enforces) · night 00:00-08:30 local: BLOCKER-only wake, digest at
morning boundary · panes of R's OTHER projects (tasty-lunch etc., other tmux sessions) NEVER touch.

## Connections
Jira GSL cloudId 74054cdc-47ef-497d-9684-734149876a8b, transitions 11/21/31/41 · GitHub
ainstance-labs/gosleep (+ gosleep-plugins frozen, + fixture gosleep-e2e-todo with expense-tracker
@ dc05ac6) · owner Roman L accountId 557058:83b04839-8bde-4331-9c2d-24843d0b8e67 · main @ 82564b0
(+ this roll's ledger commit) · no open PRs · queue open=0 lines=94 · breaker CLOSED.

## Gates
bun x tsc per package · bun test apps/core (442) + apps/web (125) · core-smoke 106 · shim-control-
gate 9/9 · touchid-gate-smoke 17/17 · prod-dir-override-smoke 7/7 · web build · bash -n
tools/hooks/*.sh · wave-4 lab suites (rule 7/7, tier2 23/23, qshape 5/5, park 7/7, self-health 6/6,
integrity 8/8) · smoke.sh baseline ~405/161 (pre-existing frozen-site fails — compare vs main).

## RESUME POINT
1. Cold-start: this handoff → ORCHESTRATION-STATE.md (LIVE-STATUS line 14 + shift-79 log) → memory
   MEMORY.md. Census: expect ONLY your own pane. Sanity: git fetch && git log origin/main -1
   (82564b0+), gh pr list (empty), port 7331 FREE, lab-emit list --count (open=0 lines=94).
2. There is NO active program. Report to R that you are up, then WAIT for R's pick from the menu
   (section 3) — or execute any standing instruction R gives at launch. Do not start the plugin
   track, widening, or TouchID on your own initiative.

## Blocked on the human
- Menu items 1-3 (panel boot / plugin unfreeze / optional autonomous batch) — R's explicit choice.
- Deferred-status hygiene question (GSL-242 & co) — asked 2026-08-17, unanswered, non-urgent.
