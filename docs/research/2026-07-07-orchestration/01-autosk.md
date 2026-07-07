# AutoSK — deep dive (GSL-41 orchestration research)

**Sources:** https://github.com/wierdbytes/autosk (cloned to `.research-cache/autosk/`, HEAD `fd4c22e` "release v0.2.4"), https://autosk.app/
**Date:** 2026-07-07 · **Researcher:** res-autosk

---

## 1. Identity & maturity

**What it is:** A local-first **task tracker + workflow engine + interface** for coding agents. Three-layer pitch (README.md:3-14): (1) file-based task tracker under `.autosk/` in your repo; (2) opt-in workflow engine where each workflow is a directed graph of steps, each step owned by an agent managed by a daemon; (3) three front ends — `autosk` CLI, `autosk lazy` TUI, and a Tauri desktop/mobile GUI. Explicitly inspired by **beads** (Steve Yegge), **pi.dev** (extensibility), and **sandcastle** (programmatic workflows) (README.md:16-19).

**Facts:**
- Author: GitHub user `wierdbytes` — solo project, **1 contributor, 374 commits** (GitHub API). Account created 2019, 8 followers, no company/bio.
- Repo created **2026-05-13**, last push **2026-06-28** (v0.2.4 release) — ~6.5 weeks of life, very high commit velocity for that window.
- **27 stars, 5 forks, 8 open issues/PRs** (2 issues), 2 watchers — early, near-zero external adoption.
- License: **MIT**.
- Releases automated via GitHub Actions (release author = github-actions[bot]); latest v0.2.4 (2026-06-28). v2 was "a clean break from v1" — no migrator, old DB abandoned (README.md:29-36).
- Stack: **Go** front end (Cobra CLI + `jesseduffield/gocui` TUI), **Bun/TypeScript daemon** (`autoskd`, compiled with `bun build --compile` to a standalone binary embedding the Bun runtime), **Tauri (Rust + React/Vite)** desktop/mobile GUI, **Astro + Tailwind v4** static marketing site (AGENTS.md:6-19, 97-135).
- Distribution: Homebrew cask (signed + notarized, macOS), GitHub Releases binaries + .AppImage/.deb (Linux), **iOS app in TestFlight beta** (commit 1f33984 "feat(website): add iOS app (beta) TestFlight install option").

**Implications for gosleep:**
- This is a serious solo-engineered reference architecture, not a toy — but with essentially no community validation (27 stars). Treat its *design decisions* as one senior engineer's opinions, well-documented ones.
- The "clean break v1→v2" (DB → plain files, npm-agents → code extensions) is a strong signal: the author tried DB-backed state and installed-package agents first and **abandoned both** for files + code. gosleep already bets on files; this validates it.

---

## 2. Architecture

**Components (AGENTS.md:6-19):**
1. **`autosk`** — Go binary: Cobra CLI + `autosk lazy` TUI (lazygit-style, `jesseduffield/gocui`). A *pure JSON-RPC client*: owns no storage, no DB; auto-spawns and talks to the daemon over a Unix socket ("proto-v2").
2. **`autoskd`** — Bun/TypeScript daemon compiled to a standalone binary (`bun build --compile`, embeds the Bun runtime — no runtime dependency on installed bun/node). Sole owner of `.autosk/`. **One daemon per host serves any number of projects** — each RPC request carries `{cwd}` and the daemon resolves the project (README.md:238-239).
3. **Tauri GUI** — React/Vite front end + thin Rust backend, also a pure JSON-RPC client of `autoskd`.
4. **Extensions** — workflows + agents are **TypeScript code**, loaded in-process by the daemon from `~/.autosk/extensions/*.ts`, `<project>/.autosk/extensions/*.ts`, or npm packages under `~/.autosk/packages/` (README.md:153-170).

### Domain model
- **Task**: file-backed record, statuses `new → work → (done | cancel | human)`; `human` = parked, waiting for a person (README.md:183). Blockers between tasks; `autosk ready` = ready set (new + unblocked). Free-form metadata bag; engine keeps per-workflow `step_visits` counters there (README.md:185-188).
- **Workflow**: a **directed graph of steps**; each step's value IS an inline `AgentDefinition` (has `onRun`) — "the step key is the agent's name" (README.md:193-200); a `statusStep("human")` is the only non-agent step (a human gate). Reference workflow `feature-dev`: `dev → review → docs → validator → accept → cleanup → done` (README.md:219-221).
- **Session**: one `onRun` invocation for one task step; also `interactive` (taskless chat) sessions.

### How agents are launched (exact mechanism)
Agents are spawned as **headless CLI subprocesses speaking NDJSON over stdio** — no PTY, no tmux, no Agent SDK:
- `@autosk/claude-agent` spawns **`claude -p --output-format stream-json --input-format stream-json --verbose --include-partial-messages --replay-user-messages`** (`daemon/extensions/claude-agent/src/index.ts:386-396`). Default `--permission-mode acceptEdits`, optional `--dangerously-skip-permissions` "intended for runs under worktree isolation" (index.ts:99-105,409-413), optional `--model/--effort/--append-system-prompt/--bare`.
- `@autosk/pi-agent` is the structural twin driving `pi --mode rpc`.
- The `ClaudeDriver` (`driver.ts`) wraps the child: parses the stream-json events (`system/assistant/user/stream_event/result`), mirrors messages 1:1 into the autosk transcript, coalesces partial deltas at ~40ms into an ephemeral "partial" channel (driver.ts:60-126), ends turns on `result`.
- **Steering a live run**: stream-json stdin accepts new user messages; a `steer` while streaming writes a `{type:"control_request", request:{subtype:"interrupt"}}` then the message; a `followup` queues after the current turn (driver.ts:254-272,487-489).

### The transit protocol (how a step ends)
The agent must call an MCP tool **`mcp__autosk__transit`** with `{to: "<step>|done|cancel|human"}`. Design subtlety: the tool is **ack-only** on the MCP server — the *driver observes* the `tool_use` on the stream and the *host-side agent code* commits `ctx.transit(target)` after the turn ends (driver.ts:18-21,385-389; index.ts:254-260). A **kickback/corrections loop** (default budget 3) re-prompts the model if it ends a turn without transiting or the transition is rejected by `workflow.onTransit`; after the budget, the run returns without a transit and the engine **parks the task to `human`** with `agent_did_not_transit` (index.ts:225-269).

### Per-session MCP server (the agent's tool surface)
The engine mints a **per-session host-side HTTP MCP server** (`ctx.newMCPServer()`) with a random port + **bearer token**, passed to claude via inline `--mcp-config {type:"http", url, headers:{Authorization: Bearer …}}` (index.ts:365-375). Tools: `transit` (task mode only), `task`, `comment` — executed against the store directly (no CLI child, no mounted socket). Auto-allowlisted via `--allowedTools` so headless runs never die on a permission prompt (index.ts:398-406). The engine is the backstop owner: closes every minted server on settle/detach so a forgetful agent never leaks a port (session.ts:541-586).

### Scheduler / parallelism / queue (engine.ts:1-20 header doc + code)
- **Single scheduler loop + global FIFO worker pool**, default **4 workers** (`--workers`), shared across ALL projects (engine.ts:48-49,77-92).
- **Event-driven, not polled**: a transit/enroll/resume/finished-session kicks a *coalesced scan* (scans never overlap — guard flag); a **30s safety rescan** is the backstop for out-of-band file edits (engine.ts:51-57,363-388).
- A scan finds schedulable tasks (`status=work`, agent step, not blocked, no live session) and **claims each by creating a `queued` session** — session-creation-as-claim guarantees one session per task (engine.ts:17-19,391-453). Dispatch **re-reads the task fresh** before claiming ("the snapshot is never trusted", engine.ts:405-411).
- Commit ordering prevents double-dispatch: a closing session writes the task's new position FIRST while still `running` (live → scan skips it), only then flips the session meta terminal (session.ts:30-35,309-341).
- **Interactive chat sessions run OFF the bounded pool** — an idle chat blocking `onRun` for its whole lifetime would starve/deadlock the 4-worker task scheduler (engine.ts:280-287).

### Isolation is agent-owned, not engine-owned
The engine "abolished the IsolationProvider abstraction" — `ctx.cwd` is always the project root; an agent that wants isolation wraps its harness via `@autosk/sandbox` (`worktreeSandbox()` — per-task git worktree, or `dockerSandbox()` — container that reaches the host MCP via `host.docker.internal`) and a final `cleanup` workflow step tears it down (engine.ts:6-8; session.ts:12-18; index.ts:29-49,110-119). `feature-dev` runs each step in a per-task worktree (README.md:149-151).

**Implications for gosleep:**
- **`claude -p` stream-json bidirectional stdio is the proven headless harness interface** — including mid-run steer (interrupt control_request) and followup queuing. gosleep's worker layer can adopt this exact wire pattern instead of PTY/tmux scraping.
- **Session-creation-as-claim + commit-before-seal ordering** is a clean, DB-free solution to the double-dispatch race — directly reusable in gosleep's orchestrator.
- **Transit-as-MCP-tool with kickback loop** is the strongest pattern here: the model *declares* the workflow transition as a tool call; the engine validates (`onTransit` can reject → correction message), bounds retries, and parks to human on failure. This is exactly the "agent must explicitly hand off or park" discipline gosleep needs.
- **Park-to-`human` as the universal failure sink** (crash, abort, no-transit, unknown step) — never silent retry loops. gosleep equivalent: everything unclear escalates to the owner's morning queue.
- **Per-session ephemeral HTTP MCP server with bearer token** is a tidy way to give each worker a scoped control-plane tool surface without a global socket.

---

## 3. State & resilience

**All state is plain files under `<project>/.autosk/` — no DB anywhere** (v2 dropped v1's DB). Layout (store/paths.ts:1-15): `tasks/<id>/task.json` (pretty-printed, human-editable), `tasks/<id>/comments.jsonl`, `sessions/<id>.json` (meta) + `sessions/<id>.jsonl` (transcript: header line + one compact entry per line). The daemon is the sole writer, but files are an explicitly *hybrid-ownership* contract — humans/agents may edit task.json directly.

**Byte-stable on-disk contract:** serializers reassemble records with fixed key order before `JSON.stringify`; golden tests pin the exact bytes — "any byte-level change must fail a test" (store/records.ts:1-15, records.golden.test.ts). Task metadata is a free-form bag, omitted when empty so old files round-trip byte-for-byte.

**Write discipline (store/atomic.ts:1-24):** every mutation = temp file in same dir → fsync temp → rename → fsync parent dir. Readers never see torn writes; crash can't resurrect old name with new bytes. Change signature `mtimeMs:ctimeMs:size:ino` per file powers (a) mtime-keyed read cache, (b) watcher echo-suppression (daemon recognizes its own writes). Residual blind spot (same-ms same-size same-ctime in-place edit) documented and accepted.

**Concurrency without a DB:** a `KeyedMutex` (store/lock.ts) serializes read-modify-write per task id; distinct keys run parallel. Combined with atomic rename this replaces transactions entirely.

**External-edit reconciliation (store/watcher.ts:1-14):** recursive `fs.watch` + 5s periodic rescan safety net both funnel into one Store reconciliation (signature compare → accept/reject per ownership policy: engine owns `status/step/workflow` while a session is live). The watcher is "intentionally dumb — no diffing".

**Crash recovery (engine.ts:483-508):** on daemon start, for each project: any session meta left `running` OR `queued` → patched to `failed: daemon_restart`, structural `autosk:error` + `autosk:session_end` lines appended to its transcript, and its `work` task **parked to `human`**. No auto-resume of in-flight agent runs; interactive sessions are simply not resumed. No retention/GC — session files accumulate forever.

**Surviving agent context end:** there is NO within-run checkpoint/compaction handling. The model: each workflow step = a **fresh `claude -p` process with fresh context**; durable state crosses steps via task.json + comments + the git worktree, never via the agent's context. `ClaudeDriver` captures the claude `session_id` "for future `--resume`" but it is unused today (driver.ts:195-196,363).

**Loop-state persistence:** the engine keeps `metadata.step_visits[step]` counters in task.json — the persistent, *human-resettable* answer to max-visits guards (transition.ts:80-95). A human can un-park a task and reset its budget by editing a JSON file.

**Implications for gosleep:**
- The **"fresh process per step + files carry state"** model is the cleanest answer to context exhaustion — don't fight compaction, design so no context needs to survive a step boundary. gosleep's per-task worker restarts fit this exactly.
- **Atomic-write + fsync-dir + change-signature echo suppression** is the production-grade version of "state as files"; gosleep handoff/state files should adopt at minimum temp+rename (cheap, prevents torn handoffs mid-crash).
- **Reap-then-park on restart** (never silently re-run) is the safe default for an unattended system: work interrupted by a crash needs a decision, and `human` status + an engine comment IS that decision queue.
- Human-resettable loop budgets in a plain-text metadata bag = owner can "pardon" a parked task from a phone text editor. Very gosleep-compatible.

---

---

## 4. Auth: subscription vs API

**Verdict: AutoSK is subscription-native.** There is **zero** `ANTHROPIC_API_KEY` / OAuth / token handling anywhere in the codebase (grep across daemon/, gui/, cmd/ — no hits). The claude-agent extension simply spawns the **operator's already-authenticated `claude` CLI** from `$PATH` (`$AUTOSK_CLAUDE_BIN` override; index.ts:386). Whatever the CLI is logged in as — Claude subscription OAuth or an API key the user configured themselves — is what runs. Docs state the contract explicitly: "The `claude` CLI, already **authenticated**. The run is unattended — a headless Claude that hits an auth or permission prompt aborts" (docs/extensions-tutorial-claude.md:25-27).

Two supporting mechanisms make this work in practice:
- **PATH enrichment from the login shell** (rpc/path-env.ts): at startup the daemon runs the operator's shell `-ilc` to capture its real `$PATH` (Homebrew/asdf/nvm dirs), because a GUI/launchd-spawned daemon has a bare PATH and would fail to find `claude`. Hard 5s-style cap so a broken rc file can't wedge startup.
- **Docker sandbox reuses subscription creds by bind-mount:** the documented pattern is mounting `~/.claude/.credentials.json:ro` into the container, with `--user` + container `HOME` set "so `~/.claude` mounts land where the harness looks" (sandbox/src/docker.ts:52-59). I.e., even containerized agents run on the host's subscription login — no API key path exists at all.

**Implications for gosleep:**
- Direct validation of gosleep's core constraint: a full autonomous orchestrator **can** run purely on a Claude subscription by treating the authenticated `claude` CLI as the only auth boundary and never touching keys. Headless `claude -p` + `--allowedTools` allowlisting (so no permission prompt ever fires) is the whole recipe.
- Adopt the login-shell PATH probe if gosleep's daemon/launcher ever starts from launchd/GUI — it's a classic unattended-run failure mode solved in ~150 lines.
- The credentials-bind-mount pattern is the subscription answer for sandboxed workers (note: mounting long-lived creds RO into a container that runs `--dangerously-skip-permissions` is a real blast-radius tradeoff — see §8).

---

---

## 5. UI

Three front ends, all **pure JSON-RPC clients of the daemon** (no client owns storage):

1. **CLI** (`autosk`) — Cobra; auto-spawns the daemon over UDS.
2. **TUI** (`autosk lazy`) — lazygit-style (`jesseduffield/gocui`): stacked panels, `n` new task, `?` hotkeys (README.md:75-85, docs/lazy.md).
3. **Tauri GUI** (desktop + iPhone) — React/Vite front end, thin Rust backend; "feature parity with `autosk lazy`" (gui/README.md:1-9).

**GUI architecture discipline (gui/README.md "Architecture"):** exactly **one invoke chokepoint** (`services/ipc.ts` — only file calling Tauri `invoke`; every RPC method gets a typed shim through a single generic `daemon_request` command) and **one listen chokepoint** (`services/events.ts` — ref-counted fan-out hub). A CI script (`scripts/check-ipc-discipline.mjs`) *enforces* the single-site rule. Rust backend is the local(UDS+auto-spawn)-vs-remote(TCP+token) switch; daemon notifications (`session-event`, `task-changed`, `project-changed`) are re-emitted verbatim so React is transport-oblivious.

**Screens / affordances:**
- Frameless two-panel workspace: left sidebar = Tasks / Sessions / Workflows accordion; main panel = polymorphic entity view (Session | Task | Workflow) + **state-aware composer** — the same input box becomes steer / follow-up / abort on a running session, comment / resume on a parked task, enroll on a bare task (README.md:88-91).
- **Live transcript streaming:** replay-then-tail `session.subscribe` with a monotonic line cursor for dedupe; during a live turn, ~40ms-coalesced `partial` frames render a growing assistant bubble, cleared when the durable line commits. `thinking` + tool-call blocks are collapsible disclosures — tool call merged with its `toolResult` by `toolCallId` into one block with running…/error badges; thinking auto-expands live, collapses on commit (gui/README.md ~:100-120; commit 55187d3).
- **Human-attention surface:** task status `human` is the wait-on-a-person state; the composer's resume affordance un-parks. Workflow panel doubles as an extension browser/installer (npm registry search, install scope modal).
- Projects sidebar with diagnostics + add-project modal; Settings modal holds local/remote mode + host/token.

**Implications for gosleep:**
- The **state-aware composer** is the single best UI idea here: one text box whose semantics (steer/follow-up/comment/resume) follow the selected entity's state. A gosleep morning-review UI needs exactly this — the owner shouldn't choose a verb, the state should.
- **Replay-then-tail with a line cursor + ephemeral partial channel** is the correct transcript-streaming contract (durable lines vs cosmetic partials cleanly split). Reusable verbatim for any gosleep dashboard.
- Enforced single-invoke/single-listen chokepoints keep a 3-frontend system honest — cheap discipline worth copying for any gosleep GUI.

---

---

## 6. Mobile / remote access

**Transport: raw TCP JSON-RPC + token. That's the whole stack.**
- The daemon listens on **TCP `0.0.0.0:7077` BY DEFAULT** (in addition to the UDS); the first request on any TCP connection must be `meta.auth {token}` or every other call is rejected (docs/daemon.md:69-90, 444-451). Token: 32 random bytes hex at `~/.autosk/daemon-token`, mode 0600, auto-minted at startup (rpc/token.ts:1-40). UDS is exempt — filesystem perms authenticate the local peer.
- The GUI's remote mode is a plain `TcpStream::connect(host)` + `TCP_NODELAY` + `meta.auth` (gui/src-tauri/src/client/remote.rs:14-40). **No TLS anywhere** — no cert code, no `rustls`, no tunnel/relay guidance in the docs (no Tailscale/SSH mention at all). The token crosses the wire in cleartext.
- **Transparent reconnect + single retry** per call, with epoch-guarded connection replacement so concurrent callers don't clobber a fresh connection (commands.rs:85-115); per-connection subscriptions (`task.subscribe`) are re-issued by the front end after reconnect.

**iOS specifics:**
- Same Tauri app compiled for iOS; **TestFlight beta**, uploaded per tag by CI (gui/README.md:258). iOS builds do **not** embed the daemon (gui/README.md:273-274) → the phone is a **remote-only client**: "Companion to the daemon — watch and steer sessions on the go" (website FinalCTA.astro:61).
- On iPhone the same React store drives a **compact single-pane layout** — bottom tab bar + push-to-detail (MobileShell/MobileTopBar/MobileTabBar, `useIsCompact` activation predicate, `styles/mobile.css` imported last; gui/README.md:20-28,183; plan docs/plans/20260618-iphone-compact-layout.md).
- **No push notifications** — zero APNs code in src-tauri; the only "notification" plumbing is in-app event routing. The phone must be foreground + connected to see anything.

**Practical shape:** the phone reaches the daemon only if it can reach `host:7077` — i.e., same LAN, or a VPN/tunnel the user builds themselves (undocumented). Full parity once connected: live transcript streaming, steer/abort mid-turn, park/resume, task CRUD.

**Implications for gosleep:**
- The killer capability is real: **steering a live headless agent from a phone** is just (a) daemon-side event stream + steer RPC, (b) any thin client, (c) reachability. AutoSK proves the daemon side is the easy 90%.
- Their gap = gosleep's opportunity: **no TLS, no relay, no push**. For an owner-asleep system, push notifications on `human`-parked events are the single highest-value mobile feature — AutoSK doesn't have them. A Tailscale-assumed (or SSH-tunnel) transport + ntfy/APNs push would leapfrog this.
- Auto-minted 0600 token file + auth-before-anything handshake + UDS-exempt-by-fs-perms is a sane minimal auth model worth copying for any local daemon.

---

---

## 7. Loop engineering: claimed vs implemented

**What autosk.app claims (modest, honest):** the site does NOT market "sleep while it works" autonomy. Positioning is "a real pipeline you can **watch, steer, and trust**" (Hero.astro:25); "Enroll into a workflow… the daemon picks it up and starts driving it through the graph"; "Watch it run… Steer or abort mid-turn" (HowItWorks.astro:8-21). The why-not section sells *pipeline + parallelism + observability* over raw agents, and "process lives in code, not a config UI" over ticket boards (Comparison.astro:5-22). No claims of scheduling, overnight runs, or self-healing.

**What the code actually implements — three nested, bounded loops:**
1. **Turn-level: the kickback/corrections loop.** If a `claude -p` turn ends without calling `transit`, or `workflow.onTransit` rejects the target, the agent host re-prompts with a correction message; **default budget 3** attempts, then the run returns without transit and the engine parks the task to `human` with `agent_did_not_transit` (claude-agent/index.ts:225-269).
2. **Step-level: workflow bounce loops with persistent visit caps.** `feature-dev` lets `review → dev` and `validator → dev` bounce work back; `onTransit` throws when `ctx.visits("dev") >= 5` (DEV_VISIT_CAP) → park to human with an explanatory engine comment (feature-dev/index.ts:37-39,81-86). Visits are persisted in `task.json` `metadata.step_visits` — human-resettable (transition.ts:80-95).
3. **System-level: the scheduler loop.** Event-driven coalesced scans (transit/enroll/resume/finish all kick a scan) + a **30s safety rescan** backstop; 4-worker global FIFO pool; session-creation-as-claim (engine.ts:48-57,363-453). Once enrolled, a task genuinely runs unattended through the whole graph until `done` or a park.

**What is NOT implemented:** no cron/scheduled enrollment (grep: zero hits), no retry-with-backoff on agent failure (any crash → park), no auto-resume after daemon restart (§3), no watchdog on hung agents beyond turn/park semantics, no cost/token budgets — the only budgets are visit counts and correction counts. **Every loop's exit is `human`** — the design philosophy is "bounded autonomy, park early, never spin".

**Implications for gosleep:**
- The three-tier budget structure (turn corrections → step visit caps → park) is a complete, minimal loop-safety vocabulary. gosleep should adopt it wholesale: every autonomous loop needs a persisted, human-resettable counter and a single park sink.
- The counters living in the *task file* (not engine memory) is what makes overnight autonomy auditable: the morning owner sees `step_visits: {dev: 5}` and an engine comment explaining the park.
- Gap to exploit: AutoSK has no time-based autonomy (schedules, overnight batching, deadline-aware retry). gosleep's "owner sleeps" scenario needs exactly the layer AutoSK stops short of.

---

---

## 8. Weaknesses / risks

**Counterweight first:** code quality is unusually high — ~45 daemon test files including golden byte-format tests, concurrency/recovery/resilience suites, an enforced GUI IPC-discipline lint, and every module opens with a design-rationale header referencing a written plan. The risks below are architectural/operational, not sloppiness.

1. **Network exposure by default.** The daemon binds TCP `0.0.0.0:7077` **out of the box** with token-only auth and **no TLS** (docs/daemon.md:444-451; remote.rs uses raw `TcpStream`). The token crosses the wire in cleartext; anyone holding it gets full RPC control — which includes enrolling tasks that spawn code-executing agents (with `acceptEdits`, optionally `--dangerously-skip-permissions`). The per-session MCP HTTP server also binds `0.0.0.0` on an ephemeral port (docs/daemon.md:169, for `host.docker.internal` reachability), bearer-token only.
2. **No rate-limit / usage-cap awareness.** `api_retry`/`api_error` system events are merely logged as warnings (driver.ts:374-376); a run that dies on exhausted limits → park to `human`, no backoff, no reschedule-when-window-resets. For subscription-powered overnight runs this means **the 5-hour usage window parks the whole fleet and nothing resumes on its own** — the exact failure mode gosleep must engineer around.
3. **Parks are silent.** Nothing notifies anyone when a task parks to `human` — no push, no email, no webhook. Parked work is only discovered by opening a UI. Combined with (2), an unattended night can quietly end at 1am.
4. **Daemon restart = fleet reset.** All in-flight sessions fail (`daemon_restart`) and park; the captured claude `session_id` is never used for `--resume` (driver.ts:195-196). Every daemon upgrade is an operational event that fills the human queue.
5. **Extensions are unsandboxed in-process code.** Workflows/agents are TS loaded into the daemon (including npm-installed ones browsable from the GUI); a malicious or compromised extension is daemon-privilege RCE. `hazard.ts` guards only *structural* drift (missing workflow/step → park), not security.
6. **Credential blast radius in Docker mode:** the documented pattern bind-mounts `~/.claude/.credentials.json` into containers that may run `--dangerously-skip-permissions` (docker.ts:52-59).
7. **No GC:** session metas/transcripts accumulate forever (engine.ts:490 comment).
8. **Bus factor 1, adoption ~0:** solo author, 27 stars; 6 external PRs sit open/unmerged; known TUI bugs (#7 paste/dictation freeze, #8 enroll picker ignores chosen step). v1→v2 was a no-migration clean break — the author will do it again.
9. **Always-resident daemon:** idle-shutdown is disabled whenever TCP is on (the default) (docs/daemon.md:456-458).

**Implications for gosleep:** items 2+3 are the roadmap: *usage-window-aware scheduling* (pause fleet, auto-resume when the subscription window resets) and *push-on-park* are the two capabilities that separate "runs unattended" from "safe to sleep on". Item 4 says: invest in resumable sessions (`claude --resume`) early.

---

---

## 9. What to adopt in gosleep

Ranked: **value / effort / risk** + one-line rationale.

1. **`claude -p` stream-json bidirectional harness** (spawn flags + steer-via-interrupt + followup queuing, driver.ts) — HIGH / LOW / LOW: a proven, PTY-free worker interface on pure subscription auth; copy the exact flag set and control_request pattern.
2. **Park-to-`human` as the single failure sink + engine-authored explanatory comment** — HIGH / LOW / LOW: every failure mode (crash, no-transit, cap hit, structural drift) converges on one reviewable queue; this IS the owner's morning inbox.
3. **Three-tier loop budgets, persisted & human-resettable** (turn corrections ×3 → `step_visits` caps → park) — HIGH / LOW / LOW: complete loop-safety vocabulary in ~100 lines; counters in the task file make overnight autonomy auditable.
4. **Transit-as-explicit-tool-call with kickback re-prompt** — HIGH / MED / LOW: the model must *declare* handoffs via a validated tool call; host rejects bad transitions and re-prompts within budget. Directly maps to gosleep's phase-gate discipline.
5. **Fresh-context-per-step + all state in files** — HIGH / LOW / LOW: don't engineer context survival; engineer step boundaries so nothing needs to survive. Validates gosleep's handoff-file architecture.
6. **Session-creation-as-claim + commit-position-before-sealing-session ordering** — MED / LOW / LOW: race-free multi-worker dispatch with no DB, no locks beyond a keyed mutex; adopt if gosleep runs parallel workers off shared file state.
7. **Atomic write discipline** (temp-in-dir + fsync file + fsync dir + change signatures for echo suppression) — MED / LOW / LOW: cheap insurance that a crash never tears a handoff/state file.
8. **Per-session ephemeral MCP server with bearer token + `--allowedTools` auto-allowlist** — MED / MED / LOW: scoped control-plane per worker; the allowlist trick is what keeps headless runs from dying on permission prompts.
9. **Replay-then-tail transcript protocol + state-aware composer** — MED / MED / LOW: if/when gosleep grows a dashboard, this is the streaming + interaction contract to copy (durable lines vs partial frames; one input whose verb follows entity state).
10. **Login-shell PATH probe before spawning anything** — LOW / LOW / LOW: solves a classic launchd/GUI unattended-run failure; ~150 lines.
11. **Docker creds bind-mount for sandboxed subscription workers** — MED / LOW / **MED**: works today, but pair with read-only mounts and never with skip-permissions on untrusted tasks.

**Build-better (gaps AutoSK leaves open — gosleep differentiators):**
- **Usage-window-aware scheduling**: detect subscription limit exhaustion, quiesce the fleet, auto-resume when the window resets (AutoSK just parks).
- **Push-on-park** (ntfy/APNs/Telegram): notify the owner the moment work needs a human; AutoSK has zero notification path.
- **Session resume** (`claude --resume` with the captured session_id) so daemon restarts and transient failures don't reset in-flight work.
- **TLS/tunnel-first remote access** (Tailscale-assumed) instead of cleartext token TCP on 0.0.0.0.

---

## COVERAGE

**Covered (high confidence, all claims anchored to file:line in clone @ fd4c22e or URLs):**
- §1 Identity/maturity (GitHub API + README/AGENTS) · §2 full architecture incl. exact agent-spawn mechanism, scheduler, MCP transit protocol · §3 state layout, atomic-write/reconcile machinery, crash recovery, context-end model · §4 auth (subscription-native, verified by absence of any key handling + docs) · §5 all three front ends + GUI architecture · §6 remote/mobile transport (TCP+token, no TLS, no push, iOS remote-only) · §7 claimed-vs-implemented loops (three bounded loops, no scheduling) · §8 weaknesses incl. open issues · §9 ranked adoption list.

**NOT covered / lower confidence:**
- autosk.app fetched only via the repo's `website/` source (site is generated from it, so content should match; live site not re-fetched this session).
- `pi-agent` / pi.dev harness internals (structural twin of claude-agent; skimmed only).
- Go CLI/TUI internals (`cmd/`, `internal/`) — treated as thin RPC clients per docs, not read line-by-line.
- Did not run the system; all findings are static analysis. No review of `docs/plans/*` beyond those cited; CHANGELOG not mined for regressions.
- GitHub PR contents (#1-#6) not read — only titles.

**Overall confidence:** high on architecture/auth/state/loops (read the primary sources); medium on UI behavioral details (from README/plans, not running the app).
