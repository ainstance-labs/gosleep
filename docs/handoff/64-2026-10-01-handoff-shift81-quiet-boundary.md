# Handoff — gosleep — 2026-10-01 (ROLL to shift 81: quiet boundary, nothing running)

> For a FRESH orchestrator. Read Part 1 → Part 2 → RESUME POINT. Ground truth = ORCHESTRATION-STATE.md.
> Supersedes the 2026-09-07 shift-80 handoff (number 63). Predecessor (shift 80, Fable 5.1, pane %10)
> ROLLED at R's command on a CLEAN boundary: fleet EMPTY (open_workers=0), no open PRs, question queue
> open=0 (lines=94), main @ a61fac7 (+ this roll's ledger commit GSL-406), shared tree ON main, port 7331
> FREE (no panel running), no worktrees. R is called "R" in chat; chat is Russian, all artifacts English.

## ORCHESTRATOR REPORT
Shift 80 (2026-09-12 cold start → 2026-10-01 roll) was a QUIET shift: no program, zero PRs, zero merges,
zero code changes. One incident (2026-09-16): R pasted a tasty-lunch task into this session by mistake; I
spawned 3 read-only probe workers + an analysis worktree in the tasty-lunch repo before R stopped it one
minute later. Cleanup verified complete (panes killed + TaskStop, worktree + local branch removed, no prod
access, no DB queries, tasty-lunch shared tree untouched). Two owner directives came out of it — see
section 5 and Hard rules. Telemetry: 3 aborted probes (tokens unknown, negligible), no completed cycles.

# ── Part 1 · Plain words ──

## 1. Where we are now
gosleep is the orchestration harness + local web control plane (Bun/Hono core on 127.0.0.1:7331, React
panel) that R uses to run delivery agents. The big program of shift 79 (harness + web-panel refinement)
is DONE, triple-verified and merged. Since then nothing has been built: shift 80 was a standby shift.
Right now nothing is running — no panel, no workers, no scratch cores — and there is NO active program.

## 2. What's already done
Everything listed in the 2026-09-07 handoff still stands: clickable answer variants, defer presets +
Reopen, permission cards with SSE pushes, observer screens, runtime Take/Release, Phase C task submission
from the panel, faster shims with synchronous first heartbeat, TouchID gate as a DEFAULT-OFF stub.
Verification dossiers (EN+RU) live under docs/reports/verifications/harness-web-e2e-2026-08-17/runs/01..03
and docs/reports/verifications/GSL-403/runs/02. Convergence proof: E2E 82 → 87 → 92 READY + Take/Release
98/100.

## 3. What we're doing next
Nothing until R picks. The MENU is unchanged from the previous handoff:
1. Boot a fresh panel from main so R can click through the shift-79 results (worktree + build + serve
   per docs/runbooks/gosleep-core.md; port 7331 is free).
2. Unfreeze the plugin track — R's explicit call only.
3. Optional autonomous batch if R says "go": E2E run 04 (regression soak), GSL-395 (qshape negation +
   delegation provenance; Jira To Do), GSL-368 (WATCH: dtruss on the next production 3s+ outlier; Jira In
   Progress), GSL-374 (shim fast-path follow-ups; Jira In Progress), deferred-status hygiene for GSL-242
   & co (R was asked 2026-08-17, no answer).
4. Everything else in the backlog is deferred-by-ruling (plugins/skills GSL-182..188, 235/242/256/257,
   TouchID real activation, tailscale GSL-105/106/107, soak GSL-271, mobile GSL-102) — do not schedule
   without R.

## 4. Problems we have
None technical. Two process points R raised on 2026-09-16, both now hard rules (Part 2):
- A task that obviously belongs to ANOTHER project (its own repo, its own live orchestrator in tmux)
  must be flagged in one line and confirmed BEFORE any spawn or write. I acted first and asked never —
  R: "you could have figured out it wasn't your task and warned me".
- The memory directory (~/.claude/projects/<project>/memory/) is OFF-LIMITS for agents and the
  orchestrator unless R explicitly commands a write. I wrote a lesson there on my own; R ordered it
  deleted (done, index line removed). Do NOT "save lessons to memory" on your own initiative.

## 5. Comments & recent decisions
- 2026-09-16 incident timeline: R posted "prod test bed for tasty-lunch (shared org for two accounts, full
  dish catalog, suppliers from the V5 design)" here → I created a worktree in the tasty-lunch repo and
  spawned probe-code / probe-prod / probe-design (read-only briefs) → ~1 min later R: "wrong orchestrator,
  stop everything" → kill-pane ×3 by explicit id + TaskStop ×3, worktree verified EMPTY (0 files, 0
  commits) and removed, local branch deleted, `git worktree prune` clean, tasty-lunch dirty entries all
  foreign. R copied the task to the tasty-lunch orchestrator himself. gosleep untouched.
- Model policy delta (harness-level, seen 2026-10-01): the Agent tool now offers a `worker-opus-xhigh`
  agent type (Opus 5.5 at xhigh effort) "per the owner's model policy of 2026-09-22", to be used instead
  of general-purpose for every orchestrator-spawned worker. `.claude/settings.local.json` in this repo
  still pins CLAUDE_CODE_SUBAGENT_MODEL=claude-opus-4-7 at the time of this roll. Before the FIRST spawn
  of your shift: use `worker-opus-xhigh`, verify the actual model structurally from the worker's
  transcript JSONL, and if pin and policy disagree ask R which one wins — do not pick silently.
- Skill-lessons checklist (handoff skill step 7): one lesson identified (cross-project directive → flag &
  confirm first). NOT filed as a [Skill] task and NOT written to any skill or memory this shift, at R's
  direction. If R wants it codified, a `[Skill]` GSL task + edit of orchestrating-delivery-agents (global
  copy authoritative) via tools/skills/publish.sh is the path.
- Jira hygiene snapshot (latest 50 keys GSL-356..405): all Done except GSL-395 (To Do), GSL-374 (In
  Progress), GSL-368 (In Progress). GitHub: 0 open PRs, 26 open issues — mirrors of the deferred/frozen
  items plus watch items (#400 GSL-403, #396 GSL-400, #389 GSL-395, #364 GSL-368, #362 GSL-374).
- Ledger task for this roll: GSL-406 (no GitHub mirror — same as the GSL-405 precedent).

# ── Part 2 · Formal ──

## ⚠️ Hard rules (full set in ORCHESTRATION-STATE.md; memory MEMORY.md is READ-ONLY for you)
Workers in VISIBLE tmux panes (regular Agent, never background/isolation:worktree; a worker that needs
isolation does `git worktree add` itself — NEVER under /tmp, ban it verbatim in every brief) · worker
model per the 2026-09-22 policy (`worker-opus-xhigh`), Haiku BANNED, minimum Sonnet, verify EVERY
worker's model from its transcript JSONL (worktree-cwd workers write transcripts under a different
project dir ~/.claude/projects/...--claude-worktrees-<name>/) · every brief: "git fetch FIRST + origin/main
SHA in your FIRST PROGRESS" · NO Workflow tool for workers · REGULAR merge, never squash, no force-push ·
NO git stash/reset/add -A in the shared tree · agents NEVER write ~/.claude (settings, skills, AND the
memory directory — owner directive 2026-09-16) · a directive that belongs to another project → flag in one
line + confirm BEFORE any spawn/write (owner feedback 2026-09-16) · close = kill-pane by explicit id +
TaskStop <name> + telemetry line · empty idle after active work = immediate capture-pane · nudge once,
never spawn a duplicate · pulse: heartbeat FIRST → ScheduleWakeup EARLY (never the last tool) → probes →
owner TEXT last (Stop-hook enforces) · night 00:00-08:30 local: BLOCKER-only wake, digest at the morning
boundary · panes of R's OTHER projects (tasty-lunch sessions 0/2/26/60 etc.) NEVER touched · no silent
default decisions for owner-significant forks (d-2026-08-08-001) · merges autonomous after verification.

## How we work
Skills: orchestrating-delivery-agents + tmux-agents-orchestration from the first turn; delivery-workflow +
using-jira for mechanics; handoff at every session boundary. Epic+Task only; one branch per Epic
(`GSL-N-slug`), one commit per Task (`GSL-N …`), one PR per Epic (regular merge), GitHub issues mirror
Jira, dev_history file per Task under docs/dev_history/. Ledger commits (handoff/STATE/events) get their
own `[Process][Repo]` Task (precedent GSL-405, GSL-406).

## Connections
Jira GSL — site ainstance-labs.atlassian.net, cloudId 74054cdc-47ef-497d-9684-734149876a8b, transitions
To Do=11 / In Progress=21 / In Review=31 / Done=41, board 100 · GitHub ainstance-labs/gosleep (private;
gosleep-plugins frozen; fixture repo gosleep-e2e-todo @ dc05ac6) · owner Roman L accountId
557058:83b04839-8bde-4331-9c2d-24843d0b8e67 · main @ a61fac7 (+ this roll's ledger) · no open PRs ·
queue open=0 lines=94 · breaker CLOSED · core Bearer lives in Keychain (service gosleep-web, account
$USER) — names only, never values.

## Gates
bun x tsc per package · bun test apps/core (442) + apps/web (125) · core-smoke 106 · shim-control-gate
9/9 · touchid-gate-smoke 17/17 · prod-dir-override-smoke 7/7 · web build · bash -n tools/hooks/*.sh ·
wave-4 lab suites (rule 7/7, tier2 23/23, qshape 5/5, park 7/7, self-health 6/6, integrity 8/8) ·
smoke.sh baseline ~405/161 (pre-existing frozen-site fails — compare vs main).

## What exists in code
Unchanged since the 2026-09-07 handoff: apps/core (Bun + Hono API, security, metrics, snapshots, plist
launchd), apps/web (React 19 + Vite 7 + shadcn panel), packages/schema + packages/sdk, tools/lab (lab-emit
question queue, chronicler, gates), tools/hooks (shims for AskUserQuestion/PermissionRequest, opt-in via
GOSLEEP_WEB_QUESTIONS=1), docs/runbooks/gosleep-core.md (setup, rotate, troubleshooting, section 8 for the
question-loop pilot).

## ⭐ RESUME POINT
1. Cold-start: this handoff → ORCHESTRATION-STATE.md (LIVE-STATUS line 14 + shift-80 log) → memory
   MEMORY.md (read only). Census: `tmux list-panes -t "$(tmux display-message -p '#{session_id}')"` —
   expect ONLY your own pane. Sanity: `git fetch && git log origin/main -1` (a61fac7 + ledger GSL-406),
   `gh pr list` (empty), port 7331 FREE (`lsof -nP -iTCP:7331 -sTCP:LISTEN`), `bash tools/lab/lab-emit.sh
   list --count` (open=0 lines=94). Write your first heartbeat (docs/handoff/.orchestrator-heartbeat,
   gitignored) with your own $TMUX_PANE.
2. There is NO active program. Report to R that you are up, then WAIT for R's pick from the menu (Part 1
   section 3) — or execute a standing instruction R gives at launch. Do not start the plugin track,
   question-loop widening, TouchID, or any deferred item on your own initiative.
3. Before the first spawn: settle the worker-model question (section 5, second bullet) with R.

## Read first
docs/handoff/ORCHESTRATION-STATE.md · docs/runbooks/gosleep-core.md · docs/lab/decisions/manifest.md ·
the 2026-09-07 shift-80 handoff (number 63) for the full shift-79 lessons list · CLAUDE.md (monorepo
layout, gates, skill source-of-truth rules).

## Gotchas
- Mail is flaky: COMPLETE reports cross with extensions; empty idle after active work → capture-pane.
- Model self-reports hallucinate — transcripts are the only truth.
- Claude Code silently disables project hooks when cwd is not the trusted git root — launch fixtures with
  cwd=repo-root + CLAUDE_PROJECT_DIR=repo-root.
- STALE-BASE trap: workers named an old SHA as HEAD without fetching — the "git fetch FIRST" mandate.
- R sometimes pastes a message into the wrong tmux pane. A foreign-project directive is a question, not a
  mandate.
- The Jira MCP search for `project = GSL` returns ~78 KB — grep the saved tool-result file, never read it.

## Blocked on the human
- Menu items 1-3 (panel boot / plugin unfreeze / optional autonomous batch) — R's explicit choice.
- Worker-model policy confirmation (settings.local.json Opus 4.7 pin vs 2026-09-22 `worker-opus-xhigh`).
- Deferred-status hygiene question (GSL-242 & co) — asked 2026-08-17, unanswered, non-urgent.
