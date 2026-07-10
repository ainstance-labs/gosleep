# pi-agent — the second agent runtime of autosk, dissected (GSL-60, GH #69)

**Sources:** clone `.research-cache/autosk` @ `fd4c22e` (v0.2.4) — `daemon/extensions/pi-agent/` + `pi-tools/` read line-by-line · clone `.research-cache/pi` (earendil-works/pi, the pi runtime; npm `@earendil-works/pi-coding-agent`, latest 0.80.6) · baseline 01-autosk.md §2 (claude-agent twin)
**Date:** 2026-07-10 · **Researcher:** res-anatomy · **Method:** static read only, nothing executed

The "pi stack" inside autosk is **three cooperating pieces on two sides of a process boundary**:

| Piece | Runs inside | Role |
|---|---|---|
| `@autosk/pi-agent` (`daemon/extensions/pi-agent/`) | autosk daemon (Bun) | AgentDefinition: spawns & drives `pi --mode rpc` per workflow step |
| `pi-transit-extension.ts` (shipped by pi-agent, loaded via `pi -e`) | the spawned pi process | registers the ack-only `autosk_transit` tool |
| `@autosk/pi-tools` (`pi-tools/`) | the spawned pi process (from pi's own config) | `autosk_task` / `autosk_comment` tools, transport-aware (CLI vs MCP) |

pi itself is an external product: **earendil-works/pi** ("pi.dev"), a TypeScript coding-agent CLI. autosk treats it exactly like `claude` — an operator-installed, operator-authenticated binary found on PATH (`$AUTOSK_PI_BIN` override, src/index.ts:368).

---

## 1. `@autosk/pi-agent` — the daemon-side driver

### 1.1 Entry point & registration
- `piAgent(opts)` returns an `AgentDefinition` `{onRun, onSteer, onFollowup, onAbort}` (src/index.ts:136-224). No `name` — a pi agent is an **inline step value**; the step key IS the agent name, taken at run time from `ctx.workflows.current.step` (src/index.ts:43-47, README.md:38-41).
- The default extension export additionally registers ONE named agent `"@autosk/pi-agent"` so **interactive (taskless) chat sessions** can be opened against pi (src/index.ts:390-396).
- Options (src/index.ts:48-91): `model` (pi spec like `"sonnet:high"`), `thinking` (`off…xhigh`), `firstMessage`/`firstMessageFile` (inline wins; file read once per daemon process because the loader caches modules — src/index.ts:138-142,341-345), `extraArgs`, `piExtensions` (`-e` each), `piSkills` (`--skill` each), `maxCorrections` (default 3), `piBin`, `sandbox`.

### 1.2 Spawn & argv
`buildPiCommand` (src/index.ts:367-382): `pi --mode rpc [--model M] [--thinking T] -e <transit-extension> [-e …] [--skill …] [extraArgs…]`. Two crucial details:
- The transit extension is **not injected in interactive mode** — a chat session must not offer a tool that would throw (src/index.ts:363-365,377).
- Env: `AUTOSK_CWD=<projectRoot>` + `AUTOSK_AGENT=<step>` (src/index.ts:353-358) so any `autosk` CLI the model runs inside a throwaway worktree still resolves the ORIGINAL project and attributes comments to the running step. This is the whole worktree-isolation account: **project identity travels via env, not cwd** (pi-tools/README.md:26-38).

### 1.3 The wire driver (`src/driver.ts`, 505 lines) — JSONL RPC client over stdio
`PiDriver` wraps the engine's `ChildHandle` and speaks pi's `--mode rpc` protocol:
- **Outbound commands** get `id: "d<n>"` and resolve on the matching `{type:"response", id}` line (driver.ts:411-421,341-351). `sendPrompt` throws if pi rejects the prompt (driver.ts:195-198). All writes are NDJSON lines (driver.ts:423-426).
- **Inbound event dispatch** (driver.ts:293-339): `response` → pending map; `agent_start`/`agent_end` → streaming flag + activity hook + turn-boundary queue; `tool_execution_start` → transit observation; `message_update` → partials; `message_end` → mirror durable line; `extension_ui_request` → auto-reply. Non-JSON lines are **skipped, not fatal** — "line-oriented resync" (driver.ts:299-301).
- **Turn model:** `waitForTurnEnd()` returns `"ended" | "exited" | "aborted"`; turn-end events are **buffered in a queue** so an `agent_end` racing the await is never lost (driver.ts:151-153,236-244,393-401).
- **Steer/followup dispatch is state-dependent** (driver.ts:200-234,453-461): idle → `{type:"prompt"}` starts a fresh turn; streaming+steer → `{type:"steer"}`; streaming+followup → `{type:"follow_up"}` (snake_case, a real pi command type). If pi rejects with a **state-mismatch** (our streaming view raced pi's — detected by substring heuristics over the error text, driver.ts:468-483), retry ONCE with the opposite dispatch shape. Best-effort; never throws. This is a direct port of the retired v1 Rust daemon's `dispatch_input`/`build_input_command` (`crates/autoskd/src/server.rs` — cited at driver.ts:201-211).
- **Partials:** a leading+trailing-edge `Coalescer` bounds `message_update` snapshots to one emission per 40ms (driver.ts:50-127). Two distinct teardown semantics, carefully separated: `flush()` at message/turn boundaries (emit the buffered frame BEFORE the durable line commits, driver.ts:94-110,311-317,327-332) vs `stop()` on exit/abort (DROP the buffered frame so a late timer can never repaint a stale live bubble after the session sealed, driver.ts:112-126,177-190,403-409). Only `role:"assistant"` snapshots stream (driver.ts:360-371).
- **Transcript mirroring 1:1:** committed `user|assistant|toolResult` messages → `ctx.log.message`; anything with `customType` → `ctx.log.custom` (driver.ts:373-382). So the autosk session transcript speaks pi's message schema natively.
- **Headless hardening:** blocking `extension_ui_request` dialogs are auto-answered `{cancelled:true}`; fire-and-forget methods (`notify/setStatus/setWidget/setTitle/set_editor_text`) are ignored (driver.ts:129-130,384-389) — a headless run can never hang on a modal. stderr is always drained (a full pipe would deadlock the child), ANSI-stripped (pi bursts terminal control sequences on teardown even in rpc mode), forwarded via `warn` with a 100-line cap (driver.ts:135-136,172-176,277-291,489-505).
- **Shutdown ladder:** `abort` command → close stdin → 500ms grace → `kill()`; idempotent (driver.ts:253-273). Child exit fails all pending requests with `"pi exited"` and emits a terminal turn event (driver.ts:177-187).

### 1.4 The kickback/corrections loop (`runTurns`, src/index.ts:233-278)
The engine no longer knows about corrections — this loop is **private to the agent** (src/index.ts:7-8):
1. Send initial prompt (seed + role header + task + declared transition targets + comments — see §1.6).
2. `waitForTurnEnd()`: `aborted` → return (engine finalises); `exited` → **throw** (`pi exited (code=N) before recording a transition`) → engine fails the session and parks.
3. If the driver observed an `autosk_transit` call this turn: `ctx.transit(target)`. Success → return (engine seals the step). Rejection (workflow `onTransit` threw) → feed the error back as a corrective prompt listing valid targets, `corrections++`.
4. No transit this turn → kickback prompt (`You stopped without calling autosk_transit…`), `corrections++`.
5. `corrections > maxCorrections` (default 3) → return WITHOUT transit → engine parks the task `human` with `agent_did_not_transit`.

Identical semantics to claude-agent's loop (01-autosk.md §2 "transit protocol") — the two runtimes are deliberate structural twins with different wire protocols underneath.

### 1.5 Transit channel: observe-the-tool-call, commit-host-side
`pi-transit-extension.ts` (56 lines) is passed by absolute host path via `pi -e` and loaded by **pi's** toolchain, not the daemon's (pi-transit-extension.ts:13-16). It registers `autosk_transit {to: string}` whose `execute` only returns an **ack text** ("transition to X submitted", pi-transit-extension.ts:41-53). The real commit happens daemon-side: `PiDriver` watches `tool_execution_start` events for `toolName === "autosk_transit"` and parses the target (`{to}` primary; `{step}`/`{status}` accepted for robustness; `done|cancel|human` map to statuses, anything else to a step — driver.ts:353-358,434-445). Rationale documented: "core stays closed and no session-scoped daemon RPC is needed" (pi-transit-extension.ts:9-11). Tool description + `promptGuidelines` both hammer "call exactly once" (pi-transit-extension.ts:32-39).

### 1.6 Prompts (`src/prompt.ts`, 99 lines)
- `renderInitialPrompt` (prompt.ts:45-73): `firstMessage` seed → `You are agent "X" on step "Y" of workflow "Z"` → task id/title/description → **explicit menu of valid transitions** (the engine's conservative target superset) → "call `autosk_transit` exactly once… Do not stop before calling" → full comment history oldest-first (`[author] text`). Comments are the **inter-step memory** — this is how work crosses fresh-context boundaries.
- `kickbackMessage` / `rejectionMessage` (prompt.ts:76-99): both re-list valid targets as literal call examples (`autosk_transit { "to": "review" }`) and state `This is correction attempt N of M. If you ignore it the run will be marked failed.` — budget transparency to the model itself.

### 1.7 Sandbox integration & the two tool transports
`sandbox` is a **structural** interface (`thin?, workspace(), wrap(), endpointFor(), stop()` — src/index.ts:100-118), so workflows can hand in `worktreeSandbox()`/`dockerSandbox()` or anything hand-rolled. The key design split (src/index.ts:71-90,153-176):
- **Host / worktree (not thin):** pi-tools shells out to the `autosk` CLI on PATH; no MCP server minted. This is the default `feature-dev` path.
- **Thin sandbox (Docker, no `autosk` binary inside):** the agent mints the per-session HTTP MCP server (`ctx.newMCPServer()`), rewrites its host via `sandbox.endpointFor(port)` (→ `host.docker.internal`), and injects `AUTOSK_MCP_URL` + `AUTOSK_MCP_TOKEN` env; pi-tools then POSTs `tools/call` instead of shelling out. Same tool surface either way.
- The transit extension file is host FS; a container must bind-mount it at the identical path (`roFiles: [TRANSIT_EXTENSION_PATH]`, src/index.ts:171-175).
- Lifecycle care: driver registered in `liveSessions` **before the first await** so a steer landing during first-message resolution isn't silently dropped (src/index.ts:186-190); finally-block order = deregister → driver.shutdown → sandbox.stop (a lingering `--rm` container outlives the killed `docker run` client) → mcp.close (src/index.ts:194-205); `onAbort` also best-effort sandbox-stops to cover SIGKILL orphans (src/index.ts:211-222).

### 1.8 Interactive chat mode (`runChat`, src/index.ts:289-322)
Chat = spawn pi **without** transit extension, send NO initial prompt, register driver, then just `await ctx.signal`. Composer messages arrive as `onFollowup` → state-dependent dispatch (idle → fresh `prompt` turn). `onActivity` wires pi's `agent_start/agent_end` to `ctx.setActivity("busy"|"idle")` so clients render working-vs-idle (src/index.ts:299-302). The session runs off the bounded worker pool (01-autosk.md:58).

## 2. `@autosk/pi-tools` — the pi-side tool surface (`pi-tools/`, ~1140 lines)

- A **pi extension** (loaded from pi's own `~/.pi/agent/settings.json` `packages: ["npm:@autosk/pi-tools"]`, README.md:15-23) registering `autosk_task` (`create/update/show/list`) and `autosk_comment` (`add/list`) (src/index.ts:26-29). Deliberately NO transit tool here — transit only exists inside a workflow run, via the injected channel (src/index.ts:22-25, README.md:41-47).
- **Transport seam** (src/mcp.ts:1-22): each call checks `mcpEnabled()` (= `AUTOSK_MCP_URL` set, mcp.ts:49-52). MCP path: JSON-RPC `tools/call` POST with bearer, response adapted to the same `{content, details, isError}` shape the CLI path builds so renderers are transport-oblivious (mcp.ts:60-97). CLI path: `pi.exec("autosk", […, "--json"])` with 30s default timeout (cli.ts:4-5,62-109,133-142).
- **Error taxonomy** is explicit and stable: `aborted | cli_error | missing_binary | parse_error | invalid_args` carried in a typed `AutoskCliError` with stdio context (cli.ts:20-48). Notable heuristic: pi's `exec` swallows ENOENT into `code=1, empty stdio`, so "non-zero + empty stdout + empty stderr" is treated as **missing binary** with an actionable install message (cli.ts:58-61,92-100,144-147).
- **Pure argv builders** live dependency-free in `src/argv.ts` (flag names mirror the Go CLI files `cmd/autosk/create.go`, `comment.go` — argv.ts:1-8) and are the only unit-tested part (test/argv.test.ts) — a clean testability seam.
- Tools also ship pi-TUI **custom renderers** (task.ts imports `Component/Text/truncateToWidth` from `@earendil-works/pi-tui`, task.ts:1-4) so `autosk_task` results render as widgets in an interactive pi, while agents get plain text.
- Version note: peerDeps pin `@earendil-works/pi-coding-agent >= 0.74.0` (package.json) while pi npm latest is 0.80.6 — loose coupling, drift accepted.

## 3. pi runtime itself (earendil-works/pi) — see §4 anatomy

Cloned to `.research-cache/pi`. Cross-pollination finding worth stating up front: **autosk's own extension loader is adapted from pi's** — `daemon/core/src/extensions/discovery.ts:5` cites `pi/packages/coding-agent/src/core/extensions/loader.ts` as its source. The author didn't just support pi as a harness; he copied pi's extension architecture into the daemon.

## 4. The pi runtime itself (earendil-works/pi @ `34582ef`, 2026-07-10 — actively developed)

Deep-read pass by Explore subagent (sonnet); paths relative to `.research-cache/pi`. Unlike frozen autosk, pi's HEAD commit is from **today** — it is alive.

### 4.1 Monorepo
| package | npm | role |
|---|---|---|
| `packages/ai` | `@earendil-works/pi-ai` | unified LLM API: ~30 providers, OAuth flows, retry/overflow classifiers, streaming event protocol (148 files) |
| `packages/agent` | `@earendil-works/pi-agent-core` | provider-agnostic agent loop (`agent-loop.ts`) + stateful `Agent` |
| `packages/coding-agent` | `@earendil-works/pi-coding-agent` | **`pi` itself**: CLI, modes (interactive/print/json/rpc), tools, extensions, sessions, settings (163 files) |
| `packages/tui` | `@earendil-works/pi-tui` | differential-rendering terminal UI lib |
| `packages/orchestrator` | `@earendil-works/pi-orchestrator` | **experimental first-party orchestrator: spawns & supervises multiple `pi --mode rpc` children** (rpc-process.ts:37-61, supervisor.ts:63-343) — direct prior art for gosleep |

### 4.2 Entry points & modes
- bin `pi` → `dist/cli.js` (coding-agent/package.json:9-10); a dedicated **`./rpc-entry` subpath export force-prepends `--mode rpc`** so hosts can `require.resolve(...)` and spawn with node instead of needing `pi` on PATH (src/rpc-entry.ts:1-13) — exactly what the orchestrator package does.
- Mode resolution (src/main.ts:100-111): `rpc` wins; else `json`; else non-TTY stdio forces `print`; else interactive. RPC mode seizes raw stdout via `takeOverStdout()` so ONLY protocol JSONL reaches stdout (main.ts:541-543, core/output-guard.ts).
- **Fail-fast trap:** ANY `type:"error"` startup diagnostic — including "Failed to load extension" — causes `process.exit(1)` for ALL modes **before the RPC channel opens** (main.ts:791-797). A broken extension ⇒ the child dies with code 1 having emitted zero JSONL.

### 4.3 RPC protocol (stdio)
- **Framing:** strict LF-delimited JSONL; deliberately NOT Node readline (which also splits U+2028/U+2029, legal inside JSON strings) — manual `\n` scan (modes/rpc/jsonl.ts:10-58; docs/rpc.md:28-37).
- **Command catalog** (rpc-types.ts:20-72; handlers rpc-mode.ts:385-694): `prompt` (+images, streamingBehavior), `steer`, `follow_up`, `abort`, `new_session`, `get_state`, `set_model`/`cycle_model`/`get_available_models`, `set_thinking_level`/`cycle_thinking_level`, `set_steering_mode`/`set_follow_up_mode` (`all` vs `one-at-a-time` queue drain), `compact`, `set_auto_compaction`, `set_auto_retry`/`abort_retry`, `bash`/`abort_bash` (host-side shell!), `get_session_stats`, `export_html`, `switch_session`, `fork`, `clone`, `get_fork_messages`, `get_entries{since}` (durable cursor), `get_tree`, `get_last_assistant_text`, `set_session_name`, `get_messages`, `get_commands`. Unknown type → error response, loop keeps reading. Parse errors likewise never desync the loop (rpc-mode.ts:728-775).
- **Responses:** `{id?, type:"response", command, success, data|error}`; the `prompt` ack fires after preflight, NOT after turn completion (rpc-mode.ts:393-415; docs/rpc.md:71-76).
- **Events:** every `AgentSessionEvent` republished verbatim (rpc-mode.ts:354-359): base loop events (`agent_start/agent_end{messages}/turn_start/turn_end/message_start/message_update/message_end/tool_execution_start|update|end` — packages/agent/src/types.ts:413-429) plus session-level `agent_settled`, `queue_update`, `compaction_start/end`, `entry_appended`, `auto_retry_start/end`, `thinking_level_changed`… (core/agent-session.ts:127-153). Streaming deltas ride inside `message_update.assistantMessageEvent` (`text_delta/thinking_delta/toolcall_delta/…`, packages/ai/src/types.ts:453-465). Extension failures surface as `extension_error` events (rpc-mode.ts:347-349).
- **THE completion signal is `agent_settled`, not `agent_end`:** `agent_end` may be followed by auto-retry, overflow-compaction-retry, or a queued follow-up; `agent_settled` fires only when the `while(_handlePostAgentRun()) agent.continue()` drain is done (agent-session.ts:1023-1065,534-542; docs/rpc.md:848-854). NB: autosk's `PiDriver` keys its turn loop on **`agent_end`** (driver.ts:311-318) — workable because autosk disables nothing but treats each turn independently, but `agent_settled` is the correct contract.
- **Steering internals:** `steer`/`follow_up` enqueue into a `PendingMessageQueue` and are drained **between turns** via `getSteeringMessages()`/`getFollowUpMessages()` hooks (packages/agent/src/agent.ts:123-157,273-297; agent-loop.ts:167,182-190,259-268) — they never interrupt an in-flight LLM call; only `abort` does (AbortController threaded through the provider call and every tool's `execute(…, signal)`, agent.ts:310-312, agent-loop.ts:668-709).
- **Shutdown:** stdin EOF → exit 0; SIGTERM → 143; SIGHUP → 129; detached bash children killed first (rpc-mode.ts:365-379,702-719). The mode function never returns — process ends only via `process.exit` (rpc-mode.ts:794).

### 4.4 Session model
Append-only **JSONL tree** (not a linear log): header `{type:"session", version:3, id, cwd, parentSession?}` then entries with `{id, parentId}` links — kinds `message | thinking_level_change | model_change | compaction | branch_summary | custom | label | session_info | custom_message` (core/session-manager.ts:30-137). A mutable `leafId` advances on append (session-manager.ts:975-980); `getBranch`/`getTree` walk the links; fork/clone/switch_session are tree operations, history is never mutated (session-manager.ts:1226-1238). Location: `~/.pi/agent/sessions/--<cwd-mangled>--/<timestamp>_<id>.jsonl` (session-manager.ts:472-477,882-885; overridable `--session-dir`/`PI_CODING_AGENT_SESSION_DIR`). Resume surface: `-c/--continue`, `-r/--resume` picker, `--session <path|id>`, `--fork`, `--session-id` (create-if-missing), `--no-session` in-memory (main.ts:264-355); on-disk version migration on open (session-manager.ts:848-850).

### 4.5 Agent loop, auth, resilience
- **Providers:** one module per vendor under packages/ai/src/providers/. Anthropic: `ANTHROPIC_OAUTH_TOKEN` checked BEFORE `ANTHROPIC_API_KEY` (providers/anthropic.ts:14), plus a full **Claude Pro/Max OAuth PKCE flow** (`claude.ai/oauth/authorize` → token exchange, refresh; ai/src/utils/oauth/anthropic.ts:232-381) with creds cached in `~/.pi/agent/auth.json`. **pi is subscription-native like claude CLI** — the whole autosk→pi→Anthropic chain can run on a Claude subscription with zero API keys.
- **Turn cycle** (agent-loop.ts:155-275): stream response → if `stopReason:"length"` fail ALL tool calls without executing (truncated args are dangerous — agent-loop.ts:383-408) → else execute (parallel or sequential per tool's `executionMode`), each through validate→beforeToolCall→execute→afterToolCall with per-call abort checks; a thrown tool becomes an `isError` result, never a crash (agent-loop.ts:602-754).
- **Retry layers:** session-level auto-retry with exponential backoff (default 3 attempts, base 2s — settings-manager.ts:28-33) gated by a regex classifier that retries overloaded/rate-limit/5xx/network but explicitly NOT quota/billing exhaustion (ai/src/utils/retry.ts:7-101); context overflow is a separate path — detected 3 ways incl. "silent overflow" (ai/src/utils/overflow.ts:129-158), triggers auto-compaction with at most ONE recovery retry per turn (`_overflowRecoveryAttempted`, agent-session.ts:1900-1989).
- **Hard-failure shape:** any loop exception synthesizes a fake assistant message with `stopReason: error` and emits the normal event sequence (packages/agent/src/agent.ts:469-510) — clients always get a well-formed turn end.
- **Resilience gaps (both directly relevant to a supervisor):** (1) RPC mode installs **no `uncaughtException` handler** (only interactive does — interactive-mode.ts:3572); a buggy async extension handler crashes the whole child with no protocol farewell. (2) bash tool has **no default timeout** — a hung command blocks the turn until an explicit `abort`/`abort_bash` (tools/bash.ts:24-38).

### 4.6 Tools & extensions
- Built-ins: `read, bash, edit, write` active by default; `grep, find, ls` exist but OFF by default (core/sdk.ts:245; cli/args.ts:386-388). Shared truncation 2000 lines / 50KB (tools/truncate.ts:11-12); bash streams updates at ≥100ms cadence and spills full output to a temp file when truncated (bash.ts:301-393); edit requires unique non-overlapping `oldText` and serializes same-path mutations through a queue (edit.ts:22-53). All tool I/O goes through pluggable `*Operations` seams explicitly designed for remote/SSH/container redirection.
- **Extensions load IN-PROCESS via jiti** (TS-transpiling require — loader.ts:389-395): discovery = project `.pi/extensions/` → global `~/.pi/agent/extensions/` → explicit `-e`/settings → npm packages via the `"pi"` manifest field in package.json (loader.ts:539-602,651-699; docs/packages.md:123-187 — the exact field `@autosk/pi-tools` uses). API surface: ~30 lifecycle events (several can **veto/rewrite** — `tool_call`, `user_bash`, `session_before_*`), `registerTool` (same ToolDefinition as built-ins — extension tools are first-class), `registerCommand`/`registerShortcut`/`registerFlag`/`registerProvider`, runtime actions incl. `exec`, `sendMessage`, `setModel`, `shutdown` (extensions/types.ts:1165-1368).
- **No sandbox, by declared policy:** "Extensions… run with the same permissions… Real isolation needs to come from the OS" (docs/security.md:31-37). The only gate is project trust — and **headless modes never prompt: untrusted project-local extensions are SILENTLY skipped** unless `defaultProjectTrust:"always"` or the cwd is pre-trusted in `~/.pi/agent/trust.json` (docs/security.md:29). A supervisor spawning pi in fresh worktrees must pre-seed trust or pass extensions explicitly via `-e` (which autosk does — absolute path, no trust dependency).
- Config inventory: `~/.pi/agent/{settings.json, models.json, auth.json, trust.json, sessions/, bin/}` + project `.pi/settings.json` merged over global (settings-manager.ts:83-196; config.ts:495-561). `rg`/`fd` are auto-downloaded to `~/.pi/agent/bin` at first grep/find use unless `PI_OFFLINE` (utils/tools-manager.ts:241-358) — a startup network dependency to know about.

## 5. Implications for gosleep

1. **The driver pattern generalizes:** autosk proves one engine can drive N heterogeneous agent runtimes (claude stream-json, pi JSONL-RPC) behind one tiny AgentDefinition contract (`onRun/onSteer/onFollowup/onAbort` + `ctx.transit`). gosleep's worker abstraction should be this thin; everything runtime-specific (framing, steer semantics, partials) lives in a per-runtime driver.
2. **State-dependent input dispatch + one retry on state-mismatch** (driver.ts:200-234) is the correct answer to the inherent race between "what I think the agent is doing" and reality. gosleep's steer path over `claude -p` control_request has the same race — adopt the retry-with-opposite-shape idiom.
3. **Buffered turn-end queue** (driver.ts:151-153): never `await` a turn boundary you didn't subscribe to before sending the prompt. Trivial to get wrong, silently loses completions.
4. **Two teardown semantics for streaming UI state** — flush-at-boundary vs drop-at-death (Coalescer flush/stop) — is a subtle correctness rule any live dashboard needs: a stale partial repainting after the terminal frame is a real bug class autosk explicitly engineered away (driver.ts:112-126).
5. **Headless hardening checklist** from this one file: auto-cancel interactive UI requests; drain stderr always; strip ANSI; cap forwarded lines; treat non-JSON stdout lines as resync-not-fatal. Every item applies verbatim to a gosleep `claude -p` harness.
6. **Env-carried project identity (`AUTOSK_CWD`)** beats cwd-derived identity the moment worktree isolation exists. gosleep workers in worktrees need the same: an env var pointing at the orchestration root, honored by all owner tooling.
7. **Ack-only tool + host-side observation** keeps the sandboxed process powerless: even a hijacked pi can only *request* a transition; the daemon validates and commits. Right trust boundary for gosleep's phase gates.
8. **Prompt-level budget transparency** ("correction attempt N of M, then failed") — cheap and likely improves compliance; gosleep's kickback prompts should count down too.
9. **pi is a subscription-native second harness.** `ANTHROPIC_OAUTH_TOKEN` first + full Claude Pro/Max OAuth PKCE flow (ai/src/utils/oauth/anthropic.ts) means gosleep could drive pi workers on the same subscription auth as `claude -p` — a real diversification option (different loop, same account), and pi's RPC surface (fork/get_entries-cursor/get_state/bash) is materially richer than claude's stream-json.
10. **Wait for `agent_settled`, not `agent_end`** — the single most bug-prone contract in pi's protocol; auto-retry/compaction can continue a "finished" run. Any gosleep pi driver must key on `agent_settled` (autosk's driver keys on `agent_end` — a latent race with pi's auto-retry).
11. **Supervisor lessons from pi's own gaps:** RPC children can die pre-protocol (exit 1 on any startup diagnostic) and mid-flight without farewell (no uncaughtException handler) — a supervisor must treat exit-code/stderr as first-class signals, never rely on protocol framing alone. Also: pre-seed project trust (or pass `-e` absolute paths) for workers in fresh worktrees, and set explicit bash timeouts (pi has none by default).
12. **`packages/orchestrator` is first-party prior art for gosleep itself** — experimental supervisor spawning N `pi --mode rpc` children via the `./rpc-entry` export with an instance registry (rpc-process.ts:37-61, supervisor.ts:63-343). Worth a dedicated read before designing gosleep's worker-pool API.

## COVERAGE

**Covered:** `@autosk/pi-agent` — every source file read in full (index.ts 396, driver.ts 505, prompt.ts 99, pi-transit-extension.ts 56, README, package.json); `@autosk/pi-tools` — index/mcp/cli/argv read in full, task.ts schema head, README in full; spawn mechanics, wire driver, turn loop, transit channel, prompts, sandbox/transport split, chat mode; pi runtime (§4) via dedicated deep-read pass @ HEAD `34582ef`: entry points/modes, full RPC command+event catalog, agent_settled semantics, steering/abort internals, session tree format, providers/auth (Anthropic OAuth), retry/overflow layers, tools+truncation, extension loader/trust, config inventory, resilience gaps, orchestrator package existence.
**Not covered:** pi-agent's `test/unit.test.ts` + `docker/` (Dockerfile for the thin-sandbox image — skimmed as inventory only); pi-tools `task.ts`/`comment.ts` renderer bodies (~500 lines of TUI formatting — schema captured, cosmetic detail skipped); in pi: the ~30 non-Anthropic provider modules, interactive-mode/TUI internals, `packages/agent/src/harness/**`, compaction prompt bodies, and `packages/orchestrator` beyond rpc-process.ts+supervisor.ts (flagged as follow-up worth its own task); nothing was executed (CODE-ONLY constraint), so all runtime behavior claims derive from code + doc comments.
