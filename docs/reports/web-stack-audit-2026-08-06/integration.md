# gosleep integration-mechanism audit — 2026-08-06

Scope: verify each Claude-Code integration mechanism the current gosleep
architecture relies on, against official docs (code.claude.com) and the local
CLI (`claude 2.1.223`, subscription, interactive tmux mode). Read-only audit.

## 0. Verdict table (compact)

| # | Mechanism | Verdict | Why |
|---|-----------|---------|-----|
| 1a | Hooks: full event set is rich enough | **WORKS** | 31 documented events; payload carries `tool_name` + `tool_input`. |
| 1b | Hook signal on `AskUserQuestion` | **WORKS-WITH-CAVEATS** | No dedicated event; use `PreToolUse{matcher: "AskUserQuestion"}` + `Notification{notification_type: "agent_needs_input"}`. |
| 1c | Hook signal on permission prompt | **WORKS** | `PermissionRequest` (manual mode) and `PermissionDenied` (auto mode) events with full `tool_name`/`tool_input`. |
| 1d | Hook signal on idle / waiting-for-input | **WORKS** | `Notification{notification_type: "idle_prompt"}`. `Stop` fires on turn end (superset, not idle). |
| 2a | Detect "waiting" via hooks | **WORKS** | Only real-time officially-supported channel. |
| 2b | Detect "waiting" via transcript tail (`~/.claude/projects/<enc>/*.jsonl`) | **WORKS-WITH-CAVEATS** | Written in real time (verified on a live session), but format is officially **internal and version-unstable**; docs redirect to hooks / stream-json. |
| 2c | `claude agents --json` | **WORKS-WITH-CAVEATS** | Exists, returns snapshot of interactive+bg sessions (pid, cwd, sessionId, status busy/idle). Snapshot only — not streaming. |
| 3a | tmux `send-keys` back into TUI | **WORKS-WITH-CAVEATS** | Undocumented, fragile against re-render of `AskUserQuestion` arrow-key selector, but the only path that requires nothing else. |
| 3b | `claude --remote-control` / `/rc` | **WORKS-BUT-NOT-FOR-US** | First-party surface for exactly this use case, BUT the transport is Anthropic-hosted; no public API for a local web UI to attach. Only claude.ai/code + Claude mobile can pair. |
| 3c | `--permission-prompt-tool` | **DOESN'T WORK** here | Headless/SDK-only. Not applicable to interactive TUI subscription sessions. |
| 3d | Agent SDK `canUseTool` / hooks | **DOESN'T WORK** here | Requires the SDK to spawn the session. gosleep starts `claude` as an interactive CLI in tmux — canUseTool is not exposed. |
| 3e | `--input-format stream-json` | **DOESN'T WORK** here | Docs: "only works with `--print`". Not usable for interactive sessions. |
| 3f | **Channels** (`--channels plugin:foo@…`) | **WORKS — RECOMMENDED** | Officially-supported way for an MCP-server plugin to PUSH events into a running interactive session and RELAY permission prompts back. This is the shape gosleep should adopt. |
| 4  | Existing Anthropic remote surface | **EXISTS** | Remote Control (claude.ai/code + iOS/Android app + Desktop app), Channels, Dispatch. gosleep's core "answer permission prompts from bed" scenario is already shipped by `/rc`. |
| 5  | Multi-provider generalisation | **CLAUDE-SPECIFIC** | Hooks, transcript path, `--remote-control`, `--channels`, `stream-json` are all Claude Code names. Codex CLI has a different lifecycle. Isolate a `SessionAdapter` interface now. |

---

## 1. Hooks — event set, payloads, blocking

Source: https://code.claude.com/docs/en/hooks.md (fetched 2026-08-06).

### Full documented event list (31 events in 2.1.x)

- **Session lifecycle:** `SessionStart`, `Setup`, `SessionEnd`
- **Per turn:** `UserPromptSubmit`, `UserPromptExpansion`
- **Tool execution:** `PreToolUse`, `PermissionRequest`, `PermissionDenied`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`
- **Turn completion:** `Stop`, `StopFailure`
- **Subagents / team:** `SubagentStart`, `SubagentStop`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`
- **User interaction:** `Notification`, `Elicitation`, `ElicitationResult`
- **Display:** `MessageDisplay`
- **Environment:** `CwdChanged`, `DirectoryAdded`, `FileChanged`, `InstructionsLoaded`, `ConfigChange`
- **Worktree:** `WorktreeCreate`, `WorktreeRemove`
- **Compaction:** `PreCompact`, `PostCompact`

The gosleep `.claude/settings.json` already wires 12 of these (Stop, SessionStart/End, SubagentStart/Stop, TeammateIdle, StopFailure, Pre/PostCompact, TaskCreated/Completed, Notification, three PostToolUse matchers). **Missing but immediately useful for the web-stack:** `PreToolUse` (as a matcher on `AskUserQuestion`), `PermissionRequest`, `PermissionDenied`, `Elicitation`, `ElicitationResult`.

### (a) What fires when the model calls `AskUserQuestion`?

There is **no dedicated event**. `AskUserQuestion` is a regular tool call, so:

1. `PreToolUse` fires with `tool_name: "AskUserQuestion"` and `tool_input` carrying the full question payload (`question` + `options[]`). **This is where the web UI can intercept the question BEFORE the user is prompted in the TUI.**
2. `Notification` fires with `notification_type: "agent_needs_input"` (informational).
3. The tool completes when the user selects an option.
4. `PostToolUse` fires with the recorded response.

Payload example (`PreToolUse` schema, docs):
```json
{
  "hook_event_name": "PreToolUse",
  "session_id": "...", "prompt_id": "...", "cwd": "...",
  "tool_name": "AskUserQuestion",
  "tool_input": { /* the AskUserQuestion arg block: question, options[], multiSelect, ... */ },
  "tool_use_id": "..."
}
```

A hook can respond with `hookSpecificOutput.permissionDecision: "allow"|"deny"|"ask"|"defer"` plus `updatedInput`. `defer` is exactly the state gosleep wants when the web UI queues the question for the owner without letting the TUI render it.

### (b) What fires on a permission prompt?

- Manual mode: `PermissionRequest` — carries `tool_name`, `tool_input`, `tool_use_id`. Hook can return `hookSpecificOutput.decision.behavior: "allow"|"deny"` and even mutate `updatedInput`.
- Auto mode: `PermissionDenied` — carries `denial_reason`. Hook can return `hookSpecificOutput.retry: true` to tell the model it may retry the denied tool. Directly usable for gosleep's "auto-approve then confirm with owner" pattern.

### (c) What fires when session goes idle waiting for input?

`Notification` with `notification_type: "idle_prompt"`. **Not** `Stop` — `Stop` fires when the assistant's response is complete (regardless of whether it asked a question). The two notification types to watch:

- `idle_prompt` → generic "cursor is at the prompt box, no work in flight"
- `agent_needs_input` → model is actively blocked on an AskUserQuestion
- `permission_prompt` → permission dialog is up

Full list of `notification_type` values (docs): `permission_prompt | idle_prompt | auth_success | elicitation_dialog | elicitation_complete | elicitation_response | agent_needs_input | agent_completed`.

**Verdict:** Hooks give gosleep everything it needs to detect and pre-empt each blocking state, with the question text and options in the payload.

---

## 2. Detecting "session is waiting" from OUTSIDE

### (a) Hooks (recommended)

Hook events fire as shell commands (or HTTP webhooks). Each carries `session_id`, `transcript_path`, `cwd` — enough to correlate to the right tmux pane. **This is the only real-time channel that Anthropic documents as stable.**

### (b) Tailing `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`

Live verification on this very session (`0a482241-…`, cwd `~/…/gosleep`):

```
size=390115 mtime=Aug  6 17:14:38 2026  (fresh, updated within seconds)
distinct types observed: agent-setting, assistant, attachment,
                         bridge-session, last-prompt, mode,
                         permission-mode, user
```

The file **is** written in real time (append-per-event), so a `tail -f` + jq loop can observe messages as they happen. **BUT** the sessions doc is explicit:

> "The entry format is internal to Claude Code and changes between versions, so scripts that parse these files directly can break on any release. To build on session data, use `/export` or the script interfaces instead."
> — https://code.claude.com/docs/en/sessions.md

So the transcript file is a supplement, not a primary signal. Also, the file records `assistant`/`user`/`mode` messages but not, e.g., a specific "waiting for AskUserQuestion answer" marker — that state has to be inferred from message shape, which is the version-unstable bit.

**Verdict:** WORKS-WITH-CAVEATS. Fine for read-only history rendering; not for the live "is it waiting?" signal. Use hooks for the signal, transcript tail for pretty rendering.

### (c) `claude agents --json`

Verified: the subcommand exists in 2.1.223 and returns a JSON array. Local output (2 live sessions on this box):

```json
[
  {"pid":15588,"cwd":"…/tasty/tasty-lunch","kind":"interactive",
   "sessionId":"be112c7c-…","name":"tasty-lunch-d8","status":"busy"},
  {"pid":27169,"cwd":"…/gosleep","kind":"interactive",
   "sessionId":"a3303154-…","name":"gosleep-93","status":"busy"}
]
```

Fields: `pid, cwd, kind (interactive|background), startedAt, sessionId, name, status (busy|idle|…)`. `--all` also includes completed background sessions.

**Verdict:** WORKS-WITH-CAVEATS. Excellent for the fleet-list panel of the web UI (matches sessions to tmux panes via pid/cwd). It is a **snapshot** command though — no streaming — so it can't replace hooks for per-turn interception.

---

## 3. Delivering an answer BACK into a live interactive session

### (a) tmux `send-keys` into the TUI

- Not documented as an integration path. Works today because Claude Code is a real terminal application.
- `AskUserQuestion` renders an **arrow-key selector** in the TUI. Programmatic send-keys must send `Down/Up` a known number of times then `Enter` — brittle against re-render (long labels, terminal resize), and options may render in a different order than the payload if the model shuffles them.
- For a free-form prompt (idle input box) it is reliable enough (`send-keys -l "text" Enter`).
- No API contract; a Claude Code release can change TUI layout at any point.

**Verdict:** WORKS-WITH-CAVEATS. Keep it as a fallback for the "just type a message into the prompt box" case; do NOT rely on it for AskUserQuestion selection.

### (b) `claude --remote-control` / `/rc` pairing surface

Source: https://code.claude.com/docs/en/remote-control.md.

Design summary:
> "When you start a Remote Control session on your machine, Claude keeps running locally the entire time … With Remote Control [claude.ai/code](https://claude.ai/code) or the Claude iOS/Android app connects to a Claude Code session running on your machine."

Transport (per doc):
> "Your local Claude Code session makes outbound HTTPS requests only and never opens inbound ports on your machine. When you start Remote Control, it registers with the Anthropic API and polls for work. When you connect from another device, the server routes messages between the web or mobile client and your local session over a streaming connection. All traffic travels through the Anthropic API over TLS…"

Push toggles (docs): `Push when Claude decides` + `Push when actions required` (permission prompts and questions). Requires the Claude mobile app registered.

Critical implications for gosleep:

1. There is **no public HTTP/WebSocket API** for a local, third-party web UI to attach as "another device." The other devices are hard-coded to claude.ai/code, the Claude iOS/Android app, or Claude Desktop.
2. Transport is Anthropic-hosted; not usable for zero-data-retention orgs (docs: "Organizations with compliance requirements such as Zero Data Retention can't enable Remote Control").
3. Not available on Bedrock/Vertex/Foundry, or when `ANTHROPIC_BASE_URL` is customised.
4. One remote session per interactive process (or `claude remote-control` server mode with `--capacity`); the fleet-of-many view still isn't first-party.

**Verdict:** WORKS — as a first-party mobile/web surface for one owner steering one session. **DOES NOT WORK** as a bring-your-own-frontend integration point. gosleep's local Bun+Hono UI can co-exist with `/rc` (both can be attached at once) but cannot be a peer of the mobile app.

### (c) `--permission-prompt-tool`

Not present in `claude --help` output for 2.1.223. Historical use was headless (`claude -p`) or SDK-only: the flag names an MCP tool the model may call to request permission decisions programmatically. The interactive TUI does not surface it.

**Verdict:** DOESN'T WORK for interactive subscription tmux sessions. Only viable if gosleep migrates to headless / Agent SDK spawning.

### (d) Agent SDK `canUseTool` / hooks (Python & TS)

Source: https://code.claude.com/docs/en/agent-sdk/permissions.md.

- `canUseTool` is a Python/TypeScript callback fired at step 6 of the permission-eval flow: after hooks, deny, ask, permission-mode, allow. It's the SDK-native way to prompt for approval.
- **It is only reachable when the app OWNS the session** (spawns via `query()` / `ClaudeSDKClient`). It is not exposed to an externally-started interactive `claude` process in a tmux pane.

**Verdict:** DOESN'T WORK for gosleep's current architecture. Only relevant if gosleep switches from "spawn `claude` in tmux" to "embed the Agent SDK." That switch loses the interactive TUI experience the owner wants, so it is not a fit.

### (e) `--input-format stream-json`

Docs (headless.md): the flag is documented as **"only works with `--print`"**. Delivers `type: "user"` messages line-by-line into a running `claude -p` process; not applicable to interactive TUI.

**Verdict:** DOESN'T WORK for interactive tmux sessions.

### (f) **Channels (`--channels plugin:foo@marketplace`) — the missed win**

Source: https://code.claude.com/docs/en/channels.md (fetched 2026-08-06).

> "A channel is an MCP server that pushes events into your running Claude Code session, so Claude can react to things that happen while you're not at the terminal. Channels can be two-way: Claude reads the event and replies back through the same channel, like a chat bridge."

Key facts:

- The channel is installed as a plugin and enabled per-session with `claude --channels plugin:<name>@<marketplace>`.
- The plugin runs a local MCP server (Bun script — same stack gosleep uses).
- The plugin can **inject messages** into the session (`<channel source="plugin:foo:foo">` events reach the model).
- The plugin can declare a "permission relay" capability that lets it **forward permission prompts to a remote surface** so the surface can approve/deny remotely.
- Fakechat reference plugin runs a browser UI at `http://localhost:8787` and pushes messages in / receives replies out.
- Anthropic ships a demo (`fakechat`) plus Telegram / Discord / iMessage plugins in `claude-plugins-official`. Custom channels are supported via `--dangerously-load-development-channels` while in preview.
- Managed via `channelsEnabled` and `allowedChannelPlugins` for Team/Enterprise.

**This is the shape of the integration surface gosleep is trying to build.** The gosleep local web UI can be re-cast as a channel plugin: the session registers with it at startup (`--channels plugin:gosleep@…`), and the channel gets first-party rights to push messages in and relay permission prompts out — instead of the current design that steals control via hooks + tmux send-keys.

**Verdict:** WORKS — **and is the officially-blessed integration surface** for a third-party local control plane over an interactive subscription session.

---

## 4. Does Anthropic already ship remote control for local sessions in 2026?

Yes, three separate surfaces are in production or research preview:

| Surface | What it is | What gosleep is trying to build that overlaps |
|---------|------------|-----------------------------------------------|
| **Remote Control** (`claude remote-control`, `--remote-control`, `/rc`) | claude.ai/code + Claude iOS/Android app + Desktop app pair with a local session over Anthropic-hosted HTTPS. Approves permission prompts remotely; long-turn "check in from your phone" nudges; push notifications for actions-required. | The "answer permission prompts from bed" scenario, on one session at a time. |
| **Channels** (research preview) | MCP-plugin-based push events into a running session, with permission-relay capability. Reference plugins: fakechat (local browser at :8787), Telegram, Discord, iMessage. | Almost the whole gosleep control-plane concept, but pluggable. |
| **Desktop app + Dispatch** | Message a task from mobile → Desktop app spawns a session to handle it. | The remote initiation scenario. |
| **Claude Code on the web** | Cloud-hosted session on Anthropic infra, not local. Different product. | N/A — gosleep is explicitly about LOCAL. |
| **Scheduled tasks / Routines** | Cron-shaped triggers. | Adjacent, not overlapping. |

**Limits of the first-party surfaces that gosleep can legitimately fill:**

1. **Fleet view.** `/rc` is one-remote-session-per-process. Server mode (`claude remote-control --capacity N`) is closer, but the mobile UI still lists sessions one-at-a-time; there is no "wall of 12 live tmux panes" view.
2. **Local-only / air-gapped / zero-data-retention.** Remote Control cannot enable on ZDR orgs; requires `api.anthropic.com`. gosleep localhost transport has none of those blockers.
3. **Decision-manifest-driven autonomy.** `/rc` push notifications ask the human. gosleep's manifest can answer without a human when the question matches a pre-declared rule.
4. **Multi-provider.** `/rc` is Claude-only. gosleep can add Codex CLI, Gemini CLI, etc.

Everything else (mobile push on question/permission, per-session transcript sync, tunneled control) `/rc` already does better. gosleep should not re-pitch itself on that overlap.

---

## 5. Multi-provider future (Codex CLI etc.)

The current abstraction — "spawn CLI in tmux + settings.json hooks + JSONL transcript tail + question queue in DB" — is **Claude-Code-shaped**:

- Hook names, payloads, blocking semantics: Anthropic-specific.
- `~/.claude/projects/<enc>/*.jsonl` layout: Claude Code.
- `--remote-control`, `--channels`, `--input-format stream-json`, `--permission-prompt-tool`: Claude Code flags.
- `claude agents --json`: Claude Code subcommand.
- OpenAI Codex CLI, Gemini CLI, aider, etc. each have their own event surface, own transcript file layout, own way (or non-way) to intercept a mid-turn question.

**Recommendation:** isolate a thin `SessionAdapter` interface now, before the second provider lands:

```
SessionAdapter:
  list_sessions() -> [{id, kind, cwd, pid, status}]
  subscribe(session_id) -> stream of typed events:
    { type: "question" | "permission" | "idle" | "output" | "started" | "ended",
      payload: { text, options?, tool_name?, tool_input? } }
  answer(session_id, response) -> ok | error
  interrupt(session_id) -> ok | error
```

Adapters:

- **ClaudeCodeAdapter (v1, recommended):** `claude agents --json` for the list; hooks → HTTP webhook → adapter → event bus for the stream; `answer()` delivered through, in order of preference: (1) channels-plugin bridge (this repo becomes a `--channels`-loaded plugin), (2) `--remote-control` steered from a headless client if/when Anthropic exposes one, (3) tmux send-keys fallback for free-form text.
- **CodexCLIAdapter (v2):** whatever Codex ships when it ships.

This way the DB schema, the web UI, and the decision manifest speak the adapter's typed events — not Claude Code hook names — and adding a provider is one file.

---

## What the architecture missed / overbuilds (concrete list)

### Missed

1. **Channels are the officially-blessed integration surface for third-party control planes.** The current design uses hooks + tmux send-keys to bolt gosleep on. Channels flips the polarity: the session registers with gosleep at startup (`--channels plugin:gosleep@…`), gosleep pushes messages in and relays permission prompts out with first-party support. Cost: gosleep has to distribute as a plugin under `claude-plugins-official` or in a private marketplace; benefit: no send-keys, no permission-prompt-tool workaround, no format-instability risk on JSONL tail.

2. **Remote Control already exists for the primary "answer permission prompts from bed" scenario.** gosleep should not fight that. The differentiated pitch has to be fleet-view + decision-manifest autonomy + local-only transport (ZDR / air-gapped) + multi-provider — not "web UI for a running session."

3. **`Notification.notification_type` routing.** Right now every `Notification` fires the same `lab-log-hook.sh`. The event has 8 distinct types (`permission_prompt`, `idle_prompt`, `agent_needs_input`, `agent_completed`, elicitation family, `auth_success`). The web-stack needs separate matcher entries (or dispatch inside the hook) so `agent_needs_input` and `permission_prompt` go into a live question queue while `idle_prompt` only updates a status marker.

4. **`Elicitation` / `ElicitationResult` events.** Missing from settings.json. MCP servers can also block for user input, and gosleep's UI should intercept them alongside AskUserQuestion.

5. **`PermissionDenied` with `retry: true`.** A hook can tell the model to retry after auto-mode denied a call. Useful for the "auto-approve then confirm with owner" pattern in the decision manifest.

6. **`PreToolUse` with `matcher: "AskUserQuestion"` and `permissionDecision: "defer"`.** This is the primary interception surface for the question flow, and it is not in the current settings.json. Right now gosleep sees the question only via `Notification{agent_needs_input}` (informational) or by tailing the transcript; a `defer` decision from PreToolUse would prevent the TUI from ever prompting the user in the first place, which is what the web-UI-answers-questions design actually needs.

### Overbuilds

7. **Tailing the JSONL transcript as a live signal.** The docs explicitly call the format internal and version-unstable. Real-time appending is confirmed (verified on this session), but the schema can shift between 2.1.x releases. Reserve transcript tail for read-only history rendering; use hooks for the live "is it waiting?" signal.

8. **tmux send-keys as the primary write channel.** Should be the last-resort fallback, not the primary. Channels + first-party permission relay is the durable path. The `AskUserQuestion` arrow-key selector is especially bad for send-keys (option order can change; re-render on resize; no way to atomically transact "send this exact answer").

9. **Custom hook event names in settings.json** (`TeammateIdle`, `SubagentStart`) — these are correctly documented, so this is not a bug — but the labor of wiring 12 matchers to shell scripts is being spent to reconstruct a bus that channels would provide as a first-party MCP stream. Consider whether the SETTINGS.json hook layer is a permanent architecture or a bridging layer while gosleep is packaged as a channel.

10. **Not distinguishing snapshot vs stream signals.** `claude agents --json` gives a fleet snapshot; hooks give a stream. Right now the design treats them as interchangeable inputs. In practice the snapshot is for the sidebar list ("what sessions exist?") and the stream is for the main queue ("what is happening RIGHT NOW"). Keep them on separate code paths so a `--json` slow-poll never delays a hook-driven question popup.

---

## Sources

- https://code.claude.com/docs/en/hooks.md
- https://code.claude.com/docs/en/remote-control.md
- https://code.claude.com/docs/en/headless.md
- https://code.claude.com/docs/en/sessions.md
- https://code.claude.com/docs/en/channels.md
- https://code.claude.com/docs/en/agent-sdk/permissions.md
- Local CLI: `claude --version` = `2.1.223 (Claude Code)`; `claude --help`; `claude agents --help`; `claude agents --json`
- Local file evidence: `~/.claude/projects/-Users-…-gosleep/0a482241-…jsonl` (this session, live-appended)
- `/Users/romanlidovskyi/Documents/dev/harness/gosleep/.claude/settings.json` (12 currently-wired hook matchers)
