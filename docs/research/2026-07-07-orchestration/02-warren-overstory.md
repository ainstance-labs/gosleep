# Warren & Overstory — deep dive (jayminwest / os-eco)

> GSL-41 orchestration research, worker `res-warren`, 2026-07-07.
> Sources: local clones at `.research-cache/warren` (HEAD `c3508c5`, 2026-07-06) and
> `.research-cache/overstory` (HEAD `ff38f3f`, archived 2026-05-28). All `file:line`
> references are relative to those clones.

## 1. Warren — identity & maturity

- **What it is:** "Self-hostable control plane for ephemeral cloud agents — spawn sandboxed
  agents at your GitHub repos, watch them work live, steer them, get a branch back"
  (`warren/package.json:4`). Runs are short-lived: complete a task, validate, push a branch,
  spin down (`warren/README.md:16`).
- **Maturity:** 1,586 commits, 2026-05-08 → 2026-07-06 (≈2 months, extremely active — the
  author dogfoods it continuously against real repos on Fly.io). Version `0.9.10`
  (`package.json:3`). MIT license, author Jaymin West. 33 scenario-based acceptance tests
  incl. *restart recovery* (`README.md:26`).
- **Stack:** Bun runtime (TS executed directly, no build step), strict TypeScript, Biome,
  SQLite via `bun:sqlite` + drizzle (optional Postgres via `WARREN_DB_URL`), `Bun.serve`
  HTTP API + React/Vite/shadcn SPA in one process (`CLAUDE.md` Tech Stack section).
- **Sandbox substrate:** [burrow](https://github.com/jayminwest/burrow) — a separate os-eco
  tool, co-tenanted in the same container, `bwrap` (bubblewrap) isolation per run, talks to
  warren over a unix socket with shared bearer token (`README.md:30-31`, `docker-compose.yml`
  bwrap flags).
- **Auth: API key, not subscription.** `ANTHROPIC_API_KEY` is a required env var "forwarded
  to agent runtimes that need it" (`README.md:58`). No OAuth/Claude-subscription path
  anywhere in the repo. Cost tracked per run (`runs.cost_usd`, `runs.tokens_*`).
- **os-eco ecosystem:** warren bundles 5 sibling tools as opt-in features — canopy (versioned
  prompt/agent library), mulch (persistent agent memory in `.mulch/`), seeds (git-native issue
  queue in `.seeds/`), sapling (steerable headless harness), plot (shared human+agent event-log
  coordination substrate in `.plot/`) (`CLAUDE.md`).

## 2. Warren — architecture: how agents are spawned & managed

- **No direct process spawning of agents.** Warren never runs `claude -p`/`Bun.spawn` for
  agents itself. It delegates to **burrow** (sandbox runtime, sibling process) over HTTP on a
  unix socket: `spawnRun` = 3 steps — (1) resolve cached rendered agent definition, frozen onto
  `runs.rendered_agent_json`; (2) `POST /burrows` provision (workspace + seed files `.canopy/`,
  `.mulch/`, `.seeds/`, `.pi/` in one atomic round-trip, burrow rolls back on seed failure);
  (3) `POST /burrows/:id/runs` dispatch (`src/runs/spawn/dispatch.ts:1-45`).
- **Run row created BEFORE any burrow call** with burrow IDs nulled; `attachBurrow` fills them
  as calls succeed — so the warren run id exists through the whole flow and failures from step 2
  onward transition `queued → cancelled` + best-effort burrow destroy (`dispatch.ts:36-42`).
- **Placement before row-creation:** `BurrowClientPool.placeFor` picks a worker first so
  `runs.worker_id` lands at creation; burrow→worker pinning is sticky for cancel/steer/reap
  (`dispatch.ts:24-31`). Multi-worker placement is acceptance-tested.
- **Agents are prompt definitions, not code.** Built-ins in `src/registry/builtins/`:
  `claude-code`, `sapling`, `pi` (default runtime), `planner`, `pr-fixer`, `leveret` (overseer),
  `healer`, and two patrol agents — `nightwatch` (nightly cron: scan repo → produce a seeds plan
  of fixes, never fixes itself; `auto_plan_run: true` → reap auto-dispatches a plan-run per plan,
  warren-a32a) and `bugwatch` (2×/week cron: triage filed bugs → ≤3 fix-plans per run,
  conservative qualification rules) (`src/registry/builtins/nightwatch.ts:1-17`,
  `bugwatch.ts:1-23`).
- **The claude-code builtin's system prompt encodes delivery discipline** we should steal:
  "Quality gates are terminal, not advisory. You are NOT done until the gate exits zero… Do not
  declare the task complete with a red gate… If genuinely unfixable, say so explicitly and leave
  the work open rather than claiming success"; agent commits but never pushes — warren pushes
  host-side after the run terminates (`claude-code.ts:24-30`).
- **Model tiering:** builtins pin tiers (`model-tiers.ts`); claude-code pinned to Sonnet tier
  for "decomposed/scoped coding work; operators raise to Opus per-run".

### Implications for gosleep
- The "freeze the rendered agent definition onto the run row" move gives reproducibility — our
  orchestrator could snapshot the worker prompt + skill versions per task.
- The row-before-spawn + rollback pattern is precisely the crash-safe dispatch we lack: if the
  orchestrator dies mid-spawn, a reconciler can find rows with null runtime IDs and clean up.
- nightwatch/bugwatch = "planner agents that only plan, executors execute" — same separation as
  our orchestrator/worker split, but *scheduled* and fully autonomous (cron → plan → auto
  plan-run → PR), i.e. a working owner-sleeps loop on API-key economics.

## 3. Warren — state, persistence, recovery

- **All state in SQLite** (`bun:sqlite` + drizzle; optional Postgres): runs, events (NDJSON
  event log per run), agents, projects, conversations, messages. Events are the source of truth
  for liveness — the watchdog computes heartbeat from the newest event row.
- **Restart recovery is a first-class, acceptance-tested path.** On boot,
  `recoverActiveRunStreams` walks the runs table for `{queued, running}` rows with a
  `burrow_run_id` and re-attaches an event-stream bridge to each; a resume-seq filter makes
  re-subscription idempotent ("re-subscribing to a run we already have full history for is
  harmless") (`src/runs/stream/recover.ts:1-13,39-50`). Rows in active states *without* a
  burrow_run_id are surfaced as `skipped` partial spawns for the operator.
- **Belt-and-suspenders terminal detection:** a run-state poller polls burrow `runs.get` in
  parallel with the event stream, so agents that never emit a terminal envelope still reach
  terminal state in warren (`src/runs/stream/run-state-poller.ts:1-11`).
- **Conversation re-wake — recovery from a dead long-lived agent.** When a conversation's
  anchoring run has died (idle-finalized, crash-recovered, force-failed), warren spawns a
  *fresh* run that **replays the DB transcript into a brand-new session** — "re-wake does NOT
  resume the old burrow state… the new session is seeded purely from the DB transcript, so it
  survives the old workspace being destroyed"; token cost grows with transcript length —
  accepted v1 trade-off (`src/runs/conversation-rewake.ts:1-21`).
- **Reap pipeline** (`src/runs/reap/`) is the single terminal path: push partial branch, open
  PR, mirror mulch/seeds/plot state, destroy workspace, GC. Even watchdog-killed runs go through
  reap so committed work is never lost.

### Implications for gosleep
- Durable event-log + "recover by re-attach, not restart" is the model for orchestrator
  restarts: our handoff files are the transcript; a cold-started orchestrator should re-attach
  to live tmux workers, not respawn them.
- Re-wake-from-transcript is the direct answer to context exhaustion: kill the exhausted
  orchestrator, spawn a fresh one seeded from the durable ledger (our ORCHESTRATION-STATE.md /
  handoff docs), never try to "resume" the dead context.

## 4. Warren — queues, priorities, scheduling, budgets

- **Cron triggers:** `.warren/triggers.yaml` per project; in-process scheduler tick
  (`src/triggers/tick.ts`) dispatches on the same composition path as manual runs
  (`README.md:34`). Per-trigger `maxCostUsd` overrides agent-level cap.
- **Serial plan-run dispatch:** `POST /plan-runs` walks a seeds plan's children one at a time,
  **gating each on the previous PR merging** before the next dispatches; re-dispatching a
  partially-done plan resumes from the next open child (`README.md:35`,
  `src/plan-runs/coordinator*.ts`). This is warren's "epic executor".
- **Cost caps enforced mid-run:** per-agent (`frontmatter.maxCostUsd`) and per-trigger caps;
  the event bridge cancels + reaps the run when cumulative `turn_end` cost crosses the cap.
  Malformed cap values **fail OPEN** ("a budget typo must never silently cancel every run at
  $0") (`src/runs/cost-cap.ts:1-31`).
- **Pause/answer loop for human questions:** batch agents emit `question_posed` on the Plot
  event log → warren flips run to `paused`; human answers via API OR the pause budget
  (`agent.pauseTimeoutMs`, default 30 min) elapses → warren respawns an agent turn with the
  answer *or a timeout warning* folded into the prompt; the respawned agent re-reads state from
  disk — "no in-process state carry-over" (`src/runs/pause.ts:1-16`). Autonomy never blocks
  forever on a human.
- **Conversation idle coordinator:** on-by-default, finalizes idle conversations after 20 min
  (`conversation.idleTimeoutMs`) — reclaims resources without closing the conversation.

## 5. Warren — UI & steering

- Web UI (React SPA), `warren` CLI, and raw HTTP are "three thin clients of one pipeline" — all
  flow through the same composition path (`README.md:37`).
- Live NDJSON event tail: `GET /runs/:id/events?follow=1`; steer mid-run via
  `POST /runs/:id/steer` (message lands in the agent's inbox, next turn picks it up); clean
  abort via `POST /runs/:id/cancel` (`README.md:31-33`).
- Workspace UI (opt-in via `.plot/`): per-Plot detail page walks Shape (conversation with the
  **leveret** overseer agent) → Plan (planner run + human sign-off gate that arms dispatch) →
  Run (serial plan-run with per-child PR-merge status) → Activity (unified human+agent event
  timeline with inline answer-cards on open questions) (`README.md:36`).

### Implications for gosleep
- Steering-by-inbox (message picked up at next turn boundary) matches our tmux `send-keys`
  steering but with durable delivery — worth mirroring via a file-based inbox per worker.
- The sign-off gate that "arms dispatch" is a clean pattern for our plan-approval boundary.

## 5b. Warren — the self-supervision stack (supervisor, watchdog, healer)

Warren layers **four** independent supervision mechanisms, each watching a different failure
class. This is the most directly transferable material in the whole repo.

1. **Process supervisor** (`src/supervisor/main.ts:1-23`) — the container ENTRYPOINT. Owns:
   boot ordering (burrow socket must exist before warren boots), signal forwarding
   (SIGTERM/SIGINT → both children, 5s grace then SIGKILL), and restart policy. Two deliberate
   asymmetries:
   - burrow (substrate) is restarted **in-process** with exponential backoff (1s base, 16s cap)
     under a **5-restarts-in-60s budget** (`budget.ts`, `main.ts:78-80`); budget exhausted →
     exit non-zero so the *outer* orchestrator (docker/fly restart policy) recycles the whole
     container.
   - warren (the orchestrator) is **never restarted in-process**: "if it crashes, hand the
     failure to docker/fly so its restart policy decides — **never mask a warren bug with an
     in-process restart loop**" (`main.ts:12-14`). Crash-loop detection belongs to the layer
     above.
   - Anomaly detection: burrow exiting **0 without a shutdown signal** is treated as a failure
     ("supervisor giving up", `main.ts:199-205`) — clean-but-unexpected exit is as suspicious as
     a crash.
2. **Run heartbeat watchdog** (`src/runs/watchdog.ts:1-47`) — detects **silent-but-busy hangs**
   the exit-code layer can't see. Motivated by a real incident (2026-06-05: a stuck bash tool
   pinned biome at ~57 CPU-min forever; nothing reaped it). Mechanics: 30s tick scans `running`
   runs; heartbeat = timestamp of newest event (fallback `startedAt`); older than budget
   (default **45 min**, deliberately generous — "well above any legitimately slow-but-silent
   tool") → emit `watchdog.timed_out` event → best-effort cancel → **route through reap, not
   bare finalize**, so partial committed work is still pushed as a branch (`watchdog.ts:22-31`).
   Design details worth copying: **on by default** ("a lifecycle-reclaim safety net must not
   depend on an operator remembering an env var", `watchdog.ts:38-41`); single-flight ticks
   (overlapping tick dropped, not stacked); per-run error isolation (one bad row can't kill the
   loop); long-lived `conversation` runs exempted so idle ≠ hung (`watchdog.ts:133-138`);
   invalid config **throws at boot** ("a typo… fails loud rather than silently mis-arming the
   safety net").
3. **Closed-loop healer** (`src/healer/`) — production alerts (Sentry/Grafana webhooks) →
   normalize to a fingerprint → route to a warren project (static mapping, payload fallback) →
   dispatch a healer agent run, guarded by per-fingerprint **max-retries + cooldown** and
   per-project opt-in (`dispatch.ts:1-22`). The system heals the *product*; the guard rails
   stop an alert storm from becoming an agent storm.
4. **Detector suite** (booted in `detector-wiring.ts`): pause detector (question timeout),
   conversation-idle coordinator, watchdog, plan-run tick, conversation-merge poller — all the
   same shape: periodic tick over DB state, single-flight, isolated errors, on by default.

**The unifying principle:** every liveness decision is made from **durable state (DB event
timestamps), never from in-memory beliefs** — so every detector survives a warren restart for
free, and the same logic works on the recovery path.

### Implications for gosleep
- Copy the layering: (a) inner watchdog ticks over durable worker state; (b) orchestrator
  itself never self-restarts — an outer dumb supervisor (launchd/cron for us) does; (c)
  restart budget so a crash-looping component escalates instead of thrashing.
- Copy the heartbeat definition: newest *observable output* (tmux pane content hash / ledger
  mtime), not process existence — our real failure mode is "alive but wedged".
- Copy "route through reap": when we kill a hung worker, still harvest its committed work.

## 6. Overstory — the archived predecessor

- **What it is:** "Multi-agent orchestration for AI coding agents" — turns one coding session
  into a team: workers in isolated **git worktrees**, coordinated through a **custom SQLite
  mail system** (WAL, ~1-5ms/query, typed protocol messages, broadcast), merged back via a
  FIFO merge queue with 4-tier conflict resolution (`README.md:11,~178`).
- **Maturity/status:** 1,712 commits, archived read-only 2026-05-28: "No longer maintained…
  Active development has moved to **Warren**… overstory's spiritual successor"
  (`README.md:9`, `git log ff38f3f`). MIT, npm `@os-eco/overstory-cli`.
- **Agent substrate = local processes, not sandboxes.** Two modes:
  - **headless (default for new projects):** `claude -p --output-format stream-json
    --input-format stream-json` subprocess; NDJSON events parsed by
    `ClaudeRuntime.parseEvents`; surfaced in the `ov serve` web UI
    (`src/runtimes/claude.ts:242-259`, `README.md:~185`).
  - **tmux (opt-in escape hatch):** `ov sling --no-headless` → tmux session the operator can
    `tmux attach` to and steer live. This is exactly gosleep's current architecture.
- **Auth: Claude-subscription compatible.** Overstory spawns the `claude` CLI (headless `-p`
  or interactive in tmux) — it rides whatever auth the CLI has (subscription login or API
  key). No `ANTHROPIC_API_KEY` requirement in the spawn path — unlike warren.
- **Pluggable runtimes:** `AgentRuntime` interface, 11 adapters (Claude Code, Pi, Copilot,
  Codex, Gemini, Cursor, Sapling, OpenCode, Aider, Goose, Amp), per-runtime guard mechanisms
  (Claude = `settings.local.json` hooks) (`README.md` runtime table).
- **Spawn-per-turn worker model** (late-phase redesign): task-scoped workers
  (builder/scout/reviewer/merger/lead) have **no persistent process between turns** — each
  turn (mail delivery, nudge, dispatch) spawns a fresh `claude --resume <session-id>`,
  processes the turn, exits on stdin EOF (`src/agents/capabilities.ts:5-9`). Only
  coordinator/orchestrator/monitor stay long-lived.
- **Self-critique shipped in-repo:** `STEELMAN.md` — the strongest case *against* agent
  swarms, with real numbers: a 20-agent swarm did 15 tasks in 6h for ~8M tokens (~$60); a
  single agent did the same in 8h for ~1.2M tokens (~$9) — "the 2-hour speedup cost $51 in
  coordination overhead" (`STEELMAN.md` §2). Also: compounding error rates at merge
  boundaries, debugging-as-forensics across worktrees, premature decomposition.
- **Why archived (inference from evidence):** README points to warren; STEELMAN documents the
  economics (coordination tax on local swarms); warren's design inverts the weak points —
  sandboxed ephemeral runs instead of long-lived local sessions, event-log instead of mail,
  serial PR-gated plan-runs instead of parallel merge queues, one durable DB instead of
  sessions.json+SQLite mail+tracker sprawl.

## 7. Overstory — the supervision stack (who watches whom)

The hierarchy (top → bottom): **operator → orchestrator (multi-repo, optional) → coordinator
(per-project, persistent) → workers (spawn-per-turn)**, watched sideways by a **tiered
watchdog**:

- **Tier 0 — mechanical daemon** (`src/watchdog/daemon.ts:1-22`): plain non-AI process,
  started with `ov watch --background` (PID file `.overstory/watchdog.pid`), usually armed by
  `ov coordinator start --watchdog` (`coordinator.ts:174-191`). Each tick checks every active
  session and applies **progressive escalation** for stalls: Level 0 warn → Level 1 tmux/mail
  nudge → Level 2 invoke Tier 1 AI triage → Level 3 kill session. Escalation level advances
  with elapsed stall time; recovery resets it; `maxTriagePerTick` caps AI spend per tick.
- **Tier 1 — AI triage** (`src/watchdog/triage.ts:1-7,29-75`): on escalation, reads the last
  50 lines of the stalled agent's session.log, spawns a **one-shot `claude -p`** (30s timeout)
  to classify: `retry` | `terminate` | `extend`. **Fails safe:** Claude unavailable/no logs →
  `extend` (don't kill what you can't diagnose).
- **Tier 2 — monitor agent** (`src/commands/monitor.ts:1-14`): a persistent Claude agent at
  the project root (no worktree, no task) that "continuously patrols the agent fleet, sends
  nudges to stalled agents, and reports health summaries to the coordinator". An *agent
  watching agents* — the AI layer above the mechanical layer.
- **Tier 3 — per-project supervisor: DEPRECATED** (`src/commands/supervisor.ts:453,472` —
  "Use `ov sling --capability lead` instead"). The author tried a 4th supervision level and
  retired it in favor of a work-hierarchy role (lead) rather than a watch-hierarchy role.

**Key mechanics (with our supervision problem in mind):**

- **ZFC principle ("Zero Failure Crash")** — `src/watchdog/health.ts:4-31`: *observable* state
  is the source of truth, never recorded state. Signal priority: tmux liveness > pid liveness
  (signal 0) > sessions.json. Conflict rules: tmux dead + recorded "working" → zombie
  immediately; tmux alive + recorded "zombie" → **investigate, don't auto-kill**; pid dead +
  tmux alive → zombie (pane shell survived, agent gone). Headless → PID primary;
  spawn-per-turn workers → **`lastActivity` recency is the only signal** (no process between
  turns is normal) (`health.ts:88-103`).
- **The coordinator IS watched — but only for liveness, not hangs.** Persistent capabilities
  (coordinator/orchestrator/monitor) are **exempt from time-based stale/zombie detection**
  ("expected to have long idle periods… only tmux/pid liveness applies",
  `capabilities.ts:42-50`). So Tier 0 detects a *dead* coordinator, but a *wedged-but-alive*
  coordinator is invisible to the machinery — only the Tier 2 monitor or a human at the UI
  can notice. **And nothing auto-restarts a dead coordinator** — no respawn path exists in
  `daemon.ts`; the operator runs `ov coordinator start` again. This is the same gap gosleep
  has, one level up.
- **Death notification protocol:** when the watchdog terminates a worker it sends a synthetic
  `worker_died` mail to the worker's parent (dedup on first zombify, overstory-c111) so the
  coordinator never blocks forever waiting for `worker_done` (`daemon.ts:556-611`). Run
  completion: the daemon counts terminal workers (completed + zombie — zombies must count or
  "a run that mixes them strands the coordinator forever", overstory-e130) and **nudges the
  coordinator** with a qualified message (`daemon.ts:231,269-326`).
- **Human escalation = `decision_gate` mail type:** an agent that sent a `decision_gate`
  message is "intentionally paused waiting for a human decision — not a stall"; the watchdog
  skips escalation entirely (`daemon.ts:892-903`). Explicit typed states beat inference.
- **Forward-only state machine with CAS guards:** `booting < working/in_turn/between_turns <
  completed < stalled < zombie`; `completed → *` transitions are rejected so a late watchdog
  tick can't reclassify a cleanly-stopped agent as zombie (overstory-a993,
  `health.ts:38-57`, `daemon.ts:815-825`). ZFC "complete" fallback: process gone + stale +
  looks finished → mark completed *without* death notification (missed session-end hook ≠
  crash, overstory-e74b).
- **Failure memory:** every watchdog-detected failure is recorded to mulch (`recordFailure`,
  `daemon.ts:91-120`) with agent, capability, reason, triage verdict — institutional memory
  of *how agents die*, fire-and-forget so recording can't break the watchdog.
- **Watchdog self-management gap acknowledged in code:** a leftover watchdog from a previous
  session blocks `ov coordinator start` unless `--accept-existing-watchdog`
  (overstory-3f0c, `coordinator.ts:355-358`) — the daemon itself has no supervisor, only
  collision detection.
- **Coordinator self-termination:** `ov coordinator check-complete` evaluates configured exit
  triggers (`allAgentsDone`, `taskTrackerEmpty`, `onShutdownSignal`); complete only if ALL
  enabled triggers met; **no enabled triggers → never complete (safety default)**
  (`coordinator.ts:1474-1530`). Recovery of work: `ov sling --recover` re-dispatches against
  any-status tasks re-linking the prior session; per-agent `checkpoint.json`
  (`src/agents/checkpoint.ts`) persists session state for resume.

## 8. Evolution: what warren kept, changed, dropped from overstory

Warren's SPEC frames overstory as "**sibling, not subordinate**. Multi-agent orchestration is
overstory's domain; warren is single-agent-per-run" (`warren/SPEC.md:2897`) — but overstory is
archived and warren is where all energy goes, so in practice the author *abandoned the
parallel-swarm model* and rebuilt around its failure analysis.

**Kept (carried forward):**
- The os-eco data plane: seeds (issues), mulch (memory), canopy (prompts) — identical CLIs in
  both repos; warren adds plot (event-log coordination substrate).
- Headless `claude -p --output-format stream-json` spawn contract → became burrow's runtime
  contract.
- Watchdog concept — but see "changed".
- Persistent overseer/patrol agents → reborn as cron-scheduled `nightwatch`/`bugwatch` and the
  `leveret` conversation overseer; no free-running patrol loop.
- Nudge/steer → steer-by-inbox (`POST /runs/:id/steer`); `decision_gate` mail → Plot
  `question_posed`/`question_answered` **with a pause budget** (30 min default) so an
  unanswered question times out instead of blocking forever — an upgrade over overstory,
  where decision_gate just paused the watchdog indefinitely.
- Checkpoint/resume → conversation re-wake from DB transcript (cleaner: no session-file
  coupling).

**Changed (the lessons):**
1. **LLM coordinator → deterministic control loops.** Overstory's coordinator/orchestrator
   were *Claude agents* that needed their own watchdog, triage, exit triggers, and restart
   story. Warren has **no persistent LLM orchestrator at all**: coordination is plain code —
   tick loops over durable DB state (plan-run tick, triggers tick, detectors). Code doesn't
   hallucinate, doesn't exhaust context, and restarts idempotently. The LLM only lives inside
   bounded runs. This dissolves the "who watches the orchestrator" problem instead of solving
   it.
2. **Parallel swarm + merge queue → serial PR-gated plan-runs.** Overstory's FIFO merge queue
   with 4-tier conflict resolution existed because parallel branches conflict; warren
   sidesteps it: one child at a time, next dispatch gated on previous PR *merging*. STEELMAN's
   own economics (the $60-vs-$9 example) predicted this.
3. **4-tier watchdog with AI triage → one mechanical heartbeat watchdog.** Overstory: warn →
   nudge → `claude -p` triage → terminate, plus a Tier 2 monitor agent. Warren: a single 30s
   tick, one threshold (45 min event-heartbeat), force-fail through reap. No AI in the
   supervision loop — the triage tier's value evidently didn't survive contact.
4. **Local worktrees + tmux → ephemeral bwrap sandboxes.** Session state on the operator's
   box (sessions.json, tmux liveness, ZFC signal conflicts) was replaced with cloud runs whose
   whole lifecycle is rows + events in one DB. tmux is gone entirely.
5. **Recorded-state reconciliation (ZFC) → event-log heartbeats.** Overstory needed elaborate
   rules for when sessions.json lies; warren's liveness is *defined* as "newest event
   timestamp" — one source of truth, no conflict matrix.
6. **Subscription-CLI auth → API key.** Overstory rode the operator's `claude` CLI login;
   warren's cloud-headless model requires `ANTHROPIC_API_KEY` and adds per-run cost caps
   because API spend is now unbounded by a subscription ceiling.

**Dropped:** 11-runtime adapter matrix (→ 3 builtins), SQLite mail bus (→ plot event log),
task groups, TUI dashboard, per-project supervisor tier (deprecated even before the archive).

### Implications for gosleep
- The single most important lesson: **push coordination logic out of the LLM and into
  deterministic code wherever possible**; keep LLM turns bounded and resumable-from-durable
  state. Our orchestrator should be a thin LLM layer over a code-shaped ledger, not a
  long-lived reasoning process that accumulates un-reconstructible context.
- Where we *do* keep an LLM orchestrator (Agent Teams), the overstory→warren arc says:
  supervision must key off durable observable state (files/ledger mtimes, tmux liveness), the
  watchdog should be mechanical (no AI in the loop), and human-gates need timeouts.

## 9. Supervision options for gosleep (the "who watches the orchestrator" problem)

Our gap: Agent Teams/tmux gives ONE nesting level — the orchestrator spawns workers, but
nothing sits above the orchestrator. Failure modes to detect:
**D1** death (pane/process gone) · **D2** hang (alive but wedged: stuck tool, permission
prompt, API-error loop) · **D3** context exhaustion (alive but compacted/degraded) ·
**D4** silent quiesce (ended a turn without an armed wake-up) · **D5** crash-loop.

Prerequisite for every option — a **written heartbeat protocol**: each orchestrator pulse
appends `{ts, context%, fleet summary}` to a fixed file (e.g.
`docs/handoff/.orchestrator-heartbeat`). Both warren and overstory converge on the same rule:
liveness must be judged from **durable observable state**, never from pane-content scraping or
in-memory belief (warren `watchdog.ts` heartbeat = newest event row; overstory ZFC).

### A. External mechanical watchdog (launchd/cron + tmux probe + auto-respawn) — RECOMMENDED CORE
- **Mechanics:** a launchd LaunchAgent (interval 2–5 min; cron works but launchd survives
  reboots and handles wake-from-sleep better on macOS) runs a dumb script: (1) tmux session
  exists? (2) heartbeat file age < threshold? (3) heartbeat `context%` < ceiling? On dead →
  respawn `claude` in tmux with the cold-start prompt from `orchestrating-delivery-agents`
  (re-attach to live workers, don't respawn them — warren `recover.ts` pattern). On stale →
  one `send-keys` nudge; still stale next tick → kill (explicit session id ONLY — the
  2026-07-07 `kill-pane -a` lesson) + respawn. On context ceiling → send-keys "write handoff
  now", then respawn fresh from handoff (warren re-wake: new session seeded from durable
  transcript). **Restart budget** 3-in-60-min (warren `RestartBudget`); exhausted → stop
  respawning, escalate to human (push notification / email) — "never mask an orchestrator bug
  with a restart loop" (warren `supervisor/main.ts:12-14`).
- **Detects:** D1, D2 (via heartbeat age), D3 (via reported context%), D4 (staleness), D5
  (budget).
- **Subscription:** fully compatible — respawns the interactive `claude` CLI under the
  logged-in account; the watchdog itself is plain bash/bun, zero tokens.
- **Risks:** respawn prompt must be idempotent (cold-start = reconcile from ledger, never
  double-dispatch); macOS sleep pauses everything (run on a box that stays awake, or accept
  that sleep also pauses the fleet); heartbeat lies if the orchestrator wedges *mid-pulse*
  (mitigate: heartbeat write is the FIRST act of each pulse).

### B. Self-pulse (ScheduleWakeup — the owner's existing pulse rule)
- **Mechanics:** orchestrator never ends a turn without an armed wake-up; each pulse checks
  workers, writes heartbeat, re-arms.
- **Detects:** worker-level D1/D2; for the orchestrator itself — nothing. It IS the thing
  that dies. Covers D4 by discipline only.
- **Subscription:** native, zero extra cost.
- **Risks:** single point of failure remains; a missed wake-up (harness bug, crash) is
  silent. **Necessary but not sufficient — it's the heartbeat *generator* for option A, not a
  supervisor.**

### C. Headless AI supervisor (`claude -p` triage on anomaly) — Tier 1, invoked by A
- **Mechanics:** when the mechanical watchdog sees an anomaly it can't classify (heartbeat
  stale but session alive), it spawns a one-shot `claude -p` (30s timeout) with the last
  heartbeat, ledger tail, and `tmux capture-pane` output: verdict `nudge | restart | extend |
  escalate`. Fail-safe default `extend` when the call fails (overstory `triage.ts:66-74`).
- **Detects:** D2/D3 with semantic judgment a hash can't provide (e.g. "it's waiting on a
  permission prompt — send y", "it's in a compaction loop").
- **Subscription:** works via CLI login; costs quota per invocation — acceptable if invoked
  only on anomaly, not as continuous patrol.
- **Risks:** overstory built continuous AI patrol (Tier 2 monitor) and warren *dropped AI from
  the supervision loop entirely* — evidence that continuous AI supervision doesn't pay. Wrong
  verdicts can kill a healthy fleet → AI may only *recommend*; the mechanical layer enforces
  budgets.

### D. Paired orchestrators (active/standby) — NOT recommended
- **Mechanics:** two orchestrator sessions heartbeat each other; standby takes over on miss.
- **Detects:** D1/D2 mutually — but D3/D4 hit both equally.
- **Subscription:** compatible, but burns a teammate slot (hard cap ~3 panes on this machine)
  and doubles idle context burn.
- **Risks:** split-brain double-dispatch; neither author ever shipped this; overstory
  *deprecated* its extra supervision tier (Tier 3) — supervision hierarchies above one watcher
  didn't earn their keep. The standby adds a second LLM to watch instead of removing the
  problem.

### E. Warren-style inversion: no persistent orchestrator (tick-mode) — night-mode experiment
- **Mechanics:** move the standing loop into code. launchd fires every N minutes; the tick
  script runs a **short-lived** orchestrator turn (`claude -p` with the orchestrating skill):
  reconcile ledger vs. reality (tmux ls, git, PRs), harvest finished workers, dispatch next
  task, write ledger, exit. Nothing long-lived exists to supervise; the "orchestrator" is
  reborn each tick from durable state.
- **Detects:** dissolves D1–D5 for the orchestrator by construction; workers still watched
  each tick from the ledger.
- **Subscription:** `claude -p` rides CLI auth; cost = re-reading the ledger each tick (no
  warm cache across ticks) — keep the ledger compact.
- **Risks:** loses the live interactive steering pane; inter-tick latency; a mid-turn tick
  death still needs the A-style budget around the tick script (cheap — the tick is a bounded
  process, exactly what launchd supervises well). This is the overstory→warren lesson
  applied whole: LLM in bounded turns, coordination in code.

### Recommended composite
1. **Now:** B (pulse + heartbeat write, already mandated) + A (launchd mechanical watchdog
   with respawn budget + human escalation). Covers D1–D5 with zero token overhead.
2. **Next:** C as an on-anomaly triage step inside A (bounded, fail-safe `extend`).
3. **Experiment:** E for the unattended overnight window — interactive orchestrator by day,
   tick-mode while the owner sleeps; compare delivery throughput and failure rates.

## What to adopt in gosleep

Ranked by (value / effort / risk):

1. **Heartbeat file + launchd mechanical watchdog with restart budget + human escalation**
   (high / medium / low) — the composite above; direct transplant of warren
   `supervisor`+`watchdog` semantics onto tmux. The single change that removes "orchestrator
   died at 3am, fleet idled until morning".
2. **Recovery = re-attach + reconcile, never blind respawn** (high / low / low) — warren
   `recover.ts` (walk durable state, re-attach to live workers, surface partial spawns) +
   re-wake (fresh orchestrator seeded from handoff/ledger, never "resume" dead context).
   Encode as the cold-start path in `orchestrating-delivery-agents`.
3. **Watchdog design details** (high / low / low): on by default; single-flight ticks;
   per-worker error isolation; generous thresholds (45 min-scale, not 5); exempt
   interactive/long-idle sessions from staleness; invalid config fails loud at arm time;
   heartbeat computed from durable writes, not pane scraping.
4. **Harvest-through-reap on kill** (high / low / low) — when killing a hung worker, still
   collect its committed work (branch, ledger notes) and write a `worker_died` entry to the
   orchestrator's ledger so no task silently vanishes (warren watchdog→reap; overstory
   `worker_died` mail + zombie-counts-as-terminal, overstory-e130).
5. **Human gates with timeouts** (medium / low / low) — every "ask the owner" pause carries a
   wall-clock budget; on expiry the flow continues with a recorded timeout warning (warren
   `pause.ts`), so the sleeping owner never wedges the fleet.
6. **Deterministic serial plan-execution gated on PR merge** (high / medium / medium) —
   warren plan-runs: one task at a time, next dispatch armed by the previous PR merging;
   resumable from "next open child". Matches our one-commit-per-task convention and the ~3
   pane cap; STEELMAN's economics argue against wide fan-out anyway.
7. **Failure memory** (medium / low / low) — every watchdog intervention appends a structured
   record (agent, reason, tier, verdict) to a learnings file (overstory `recordFailure`→mulch);
   feeds retros and threshold tuning.
8. **Worker prompt discipline from the claude-code builtin** (medium / low / low) — "quality
   gates are terminal, not advisory… leave work open rather than claiming success"; workers
   commit, orchestrator pushes.
9. **Forward-only worker state machine with CAS guards** (medium / medium / low) — ledger
   states `booting < working < completed < stalled < zombie`; `completed` is sticky so a late
   watchdog tick can't reclassify clean exits (overstory-a993).
10. **Tick-mode night orchestrator pilot** (potentially high / high / medium) — option E;
    prototype after 1–5 are stable.

## COVERAGE

**Covered:** warren identity/maturity/stack/auth (§1); spawn & agent management incl. builtins
and patrol agents (§2); state/persistence/recovery incl. restart recovery and re-wake (§3);
queues/scheduling/budgets (§4); UI/steering (§5); warren's 4-layer self-supervision stack read
at source level (§5b); overstory identity, spawn modes, auth, spawn-per-turn model, STEELMAN
(§6); overstory's full supervision hierarchy + tiered watchdog + ZFC + coordinator gap at
source level (§7); evolution lessons (§8); supervision options + recommendation (§9); ranked
adoption list.

**Not covered / thin:** burrow internals (sandbox runtime — separate repo, not cloned); warren
UI code beyond docs; overstory merge-queue internals (`src/merge/`) and mail store schema
details; GitHub-side issue/PR history for either repo (worked from local clones only — no
stars count verified, no issues read); sapling/pi runtime details; warren SPEC read only in
targeted excerpts (it is ~3k lines); no dynamic testing of either tool.
