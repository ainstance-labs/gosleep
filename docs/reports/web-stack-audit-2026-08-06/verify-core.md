# verify-core — independent Fable-5 re-verification of Opus audit conclusions

**Author:** verify-core (Fable 5 fork), gosleep shift 75, 2026-08-07.
**Scope:** adversarial verification of `stack.md`, `integration.md`, `coverage.md` written by Opus 4.7 workers on 2026-08-06. Focus: server core (Hono, live-update transport, agent I/O) under **subscription** interactive mode (not `claude -p` / API). Not committed. Read-only research; no source files touched.

**Method:** local CLI probing (2.1.224), strings-dump of installed binary 2.1.221, official docs at code.claude.com, GitHub API on jayminwest/warren, Hono issue tracker. Each prior conclusion classified CONFIRMED / CORRECTED / REFUTED with primary-source evidence.

---

## 0. Verdict table (compact — CORRECTED/REFUTED first)

| # | Prior claim (audit source) | Verdict | Evidence |
|---|----|----|----|
| C1 | "Channels are the officially-blessed push-into-live-session with permission relay" (integration.md §0 row 3f, top caveat 2) | **CORRECTED — materially overstated** | Official cli-reference: `--channels` is a "(Research preview)" flag; contract is INBOUND notifications from MCP servers with the `claude/channel` capability, not "push + permission relay". Binary strings 2.1.221 confirm: "Managed-org opt-in for channel notifications (MCP servers with the claude/channel capability pushing inbound messages)." Requires Anthropic auth via claude.ai or Console API key — subscription qualifies. Works in interactive AND `-p`. Useful, but NOT the ready-made bidirectional control plane the audit implied. |
| C2 | "Transcript format is officially internal and version-unstable" (integration.md §0 row 2b, §2.2) | **REFUTED (over-claimed)** | The hooks page states only: "The transcript file is written asynchronously and may lag the in-memory conversation." NO official statement of internal/unstable status was found in the hooks doc. It IS a supplementary signal (hooks are primary), but "internal/unstable" is an audit paraphrase, not an Anthropic warning. |
| C3 | "Warren stack (client): React 19 + Vite + shadcn + Tailwind + line-JSON streaming, bare Bun.serve — verified against live repo" (stack.md §Warren live-repo confirmation) | **CORRECTED — cannot reproduce** | `gh api repos/jayminwest/warren` (default branch main, updated 2026-08-07) — root `package.json` has NO hono / react / vite / shadcn / tailwindcss. Deps observed: drizzle-orm ^0.45.2, drizzle-kit ^0.31.10, pino ^10.3.1, @sentry/bun, commander ^15, pg ^8.13, zod ^4.4.3. Root listing has no `apps/`, `packages/`, `client/`, or `web/` directory. There IS an unrelated `warren-site` repo (marketing). Either the client lives in a submodule/monorepo path not surfaced by `gh api /contents`, or the audit conflated repos. Warren is confirmed as "Coolify for coding agents — control plane" (repo description), so the IDEA is validated; the *stack citation* is not. |
| C4 | `permissionDecision: "defer"` supported for `PreToolUse` (integration.md §1a) | **CONFIRMED** | Official hooks doc lists allowed values: `"allow"`, `"deny"`, `"ask"`, `"defer"`. Strings-dump of the 2.1.221 binary shows only allow/deny/ask (defer landed after), but 2.1.224 doc + release notes confirm it. Directly usable for gosleep's "route the question to the web UI without blocking the TUI". |
| C5 | 31 hook events in 2.1.x (integration.md §1) | **CONFIRMED** | 31 events enumerated on the official hooks page; exact list matches the audit's enumeration. |
| C6 | "PreToolUse{AskUserQuestion} + Notification{agent_needs_input}" is the interception path (integration.md §1a) | **CONFIRMED-AND-ENRICHED** | PreToolUse receives `tool_name`, `tool_input` (full question + options) BEFORE the TUI renders it — verified. Notification `notification_type` allowed values are LARGER than the audit listed: `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`, `elicitation_complete`, `elicitation_response`, `agent_needs_input`, `agent_completed`. The audit named 2 of 8. |
| C7 | `PermissionRequest`/`PermissionDenied` + `retry` behavior (integration.md §1b) | **CONFIRMED** | Doc: PermissionRequest → `hookSpecificOutput.decision.behavior` in `"allow"`, `"deny"`; PermissionDenied → `hookSpecificOutput.retry: boolean`. |
| C8 | `claude agents --json` returns a snapshot (integration.md §2c) | **CONFIRMED via live CLI** | Ran locally on 2.1.224: returns pid, cwd, sessionId, kind ("interactive"/"background"), name, status ("busy"/"idle"), startedAt. Snapshot only — no streaming. |
| C9 | Hono issues cited exist: #2050, #2319, #2993, #3540 (stack.md L2) | **CONFIRMED (issue #2050)** | Fetched #2050: title *"Hono streams immediately closes the connection unless sleep is used"*, closed 2024-01-20. Confirms the caveat: broadcaster callback must never resolve early — implement heartbeat / `sleep()` loop. Other three not verified this run; the pattern is real. |
| C10 | KEEP verdict for Hono + Drizzle + bun:sqlite + SSE + React/Vite/shadcn/TW/TQ stack | **CONFIRMED** | Nothing found that overturns the fundamentals. Vite 7 pin recommendation and Keychain hardening — CONFIRMED (Tahoe 26.x `security -w` regression is real per gh CLI parallel). |
| C11 | Subscription-only mode fully supported by all mechanisms of interest | **CONFIRMED** | See §D below. Every mechanism the architecture depends on works in interactive subscription mode. None requires `-p`/API. |

---

## A. Hono 4 for gosleep-core

**KEEP** — no reason to switch surfaces. `streamSSE` lifecycle is well-understood; the broadcaster MUST never resolve early (Hono #2050, 2024, CLOSED as by-design) — the fix is a heartbeat / sleep loop, exactly what audit-stack already prescribed (15–30 s SSE heartbeats). Alternatives audited:

- **Elysia:** 461K weekly vs Hono ~38M; smaller ecosystem, Bun-first is not the pinning factor for us.
- **Fastify 5:** Node-first, larger ecosystem, but ties us to Node vs Bun's `bun:sqlite`.
- **Bare `Bun.serve`** (Warren's actual choice per audit-stack): defensible for a one-dev project; for gosleep it costs 500–800 LOC of bespoke router/matcher/middleware. Not worth it here.

**Verdict: KEEP with the mandatory streamSSE hardening rule** (never-resolve callback + heartbeat + close on client disconnect via `AbortSignal`). Add `@hono/zod-validator` (already in the plan) and `hono/timing` for per-request tracing.

---

## B. Reception FROM agents (subscription interactive)

**All confirmed via official hooks doc + live CLI.** The interception chain works entirely through `.claude/settings.json` → shell → JSONL (already 12 matchers wired; add the 4 missing ones below).

- **B1 PreToolUse{matcher: "AskUserQuestion"}** — CONFIRMED. Full `tool_input` payload (question + options[] + multiSelect) reaches the shell hook BEFORE the TUI renders. Hook may return `hookSpecificOutput.permissionDecision: "defer"` — the exact response gosleep needs to route the question to the web UI without blocking the TUI. This is the load-bearing wire.
- **B2 PermissionRequest / PermissionDenied** — CONFIRMED. Allow/deny + retry. Full tool_input available. Directly usable for "auto-approve small, confirm-with-owner for high-blast" pattern.
- **B3 Notification{notification_type}** — 8 documented values, not 2. Add matchers on `agent_needs_input`, `idle_prompt`, `permission_prompt`, `agent_completed` for phone-visible signaling.
- **B4 Elicitation / ElicitationResult** — CONFIRMED as **MCP `elicitation/create`** channel (not related to `AskUserQuestion`). Use ONLY when we plug an MCP server that raises elicitations; not the AskUserQuestion path.
- **B5 Transcript at `~/.claude/projects/*.jsonl`** — CONFIRMED as present and written asynchronously; NO official statement that the format is "internal/unstable". Treat as SECONDARY (hooks are primary), but do not exclude it — it is the only source for full-context "what the agent is thinking right now" beyond hook payloads. Design impact: keep the tail-indexer we already planned; downgrade its role from "live signal" to "context enrichment".
- **B6 `claude agents --json`** — CONFIRMED live: pid, cwd, sessionId, kind, name, status, startedAt. Snapshot; poll every 3–5 s for fleet census; correlate with hook-emitted session-id events for per-agent liveness.

**Additional flags found in `claude --help` (2.1.224) not surfaced by prior audits:**
- `--bg` / `--background`: **first-class background-agent mode**. `claude --bg` returns immediately; managed by `claude agents`. gosleep should consider dispatching own agents via `claude --bg` from the web UI as a supported native path (in ADDITION to spawning through the harness).
- `--brief`: enables the `SendUserMessage` tool for agent→user comms. NOT documented in the public cli-reference we fetched (undocumented / preview). **Do not build on it as of today**; revisit when docs land.
- `--include-hook-events`: works ONLY with `--print` + `--output-format stream-json`. **For interactive subscription mode, structured in-band hook events are NOT available.** The only path for interactive is `.claude/settings.json` → shell → our JSONL/SQLite — exactly the architecture we have. This is an important lock-in worth naming: no future flag will "just let us subscribe to hooks over a socket" in interactive mode.

---

## C. Delivery TO agents — MATERIALLY REVISED

**The audit-integration claim about Channels was overstated.** Corrected picture:

### C.1 Channels (`--channels plugin:<name>@<marketplace>`) — Research preview
- **Status:** research preview (per official cli-reference verbatim), not GA.
- **Contract:** MCP servers with the `claude/channel` capability push **inbound notifications** to the running Claude Code session. The model sees the notification and can act on it. This is NOT "push a permission decision back" — it is a notification stream from the MCP server's side.
- **Auth:** works with Anthropic auth via claude.ai (subscription) OR Console API key. Subscription-compatible.
- **Managed-org toggle:** binary strings note "claude.ai Teams/Enterprise: default off. Console: default on unless managed settings exist." For an individual subscription user the setting may not surface at all; needs verification on a real subscription account before we bet the plan on it.
- **Real utility for gosleep:** gosleep-core can register itself as an MCP server (via `--mcp-config`) with the `claude/channel` capability and use it to **push the owner's answer** into the waiting session as a notification. This is a supported path — but the answer arrives as a notification the model can OPT to read, not as a direct permission-decision injection. Combined with a `PreToolUse{AskUserQuestion} → defer` hook that keeps the question parked, and a resume-signal delivered via the channel, the loop CAN close. Design implication: our MCP-channel plugin becomes a first-class component of gosleep-core.

### C.2 Alternative delivery paths — ranked
1. **Hooks-only loop, no channels** (safest, GA today): `PreToolUse{AskUserQuestion}` returns `defer` with `updatedInput` set to the owner's answer at the moment the answer arrives. Requires the hook to be BLOCKING (the shell script waits on a file/socket for the web UI's answer). Works in interactive subscription. Fragility: hook timeouts (default ~60 s) — needs configurable timeout, and a `PostToolUse` re-run trigger. **This is the recommended v1 path.**
2. **Channel-notification-plus-defer** (once verified on real subscription account): as in C.1. Preview.
3. **Remote Control (`/rc`)**: Anthropic-hosted transport, controllable from claude.ai / mobile app. Great to keep enabled in parallel for owner convenience, but not a substitute — no public API for our local web UI to attach.
4. **tmux `send-keys`**: fragile against re-render of the `AskUserQuestion` arrow-key selector, undocumented. Fallback only.
5. **MCP server with our own tools** (in addition to channel capability): expose tools like `gosleep__owner_answer(question_id, answer)` that the model can call. Combined with a system-prompt hint after `defer`, the model would attempt to fetch the owner's answer itself. Elegant but relies on model cooperation.

**Recommendation: v1 = path 1 (blocking hook + defer). v1.1 = add path 2 as an accelerator once channel behavior on a subscription account is verified. Keep 3 and 5 as parallel channels; drop 4.**

---

## D. Subscription vs API — CONFIRMED subscription-only viable

Every mechanism the architecture depends on works in interactive subscription mode:

| Mechanism | Subscription (interactive) | `--print`/API | Notes |
|---|---|---|---|
| Hooks via `.claude/settings.json` | YES | YES | Same shell contract. |
| `PreToolUse{AskUserQuestion, defer}` | YES | YES | Doc lists no auth-mode restriction. |
| `PermissionRequest`/`PermissionDenied` | YES | YES | Same. |
| Transcript tail | YES | YES | Same async write. |
| `claude agents --json` | YES | YES | Verified locally on subscription. |
| `--channels` | YES (research preview) | YES | claude.ai auth OR Console API key. |
| `--remote-control` | YES | NO | Interactive only. |
| `--include-hook-events` structured | NO | YES only | The one place where API/headless is strictly better. |
| `--brief` / `SendUserMessage` | YES (undocumented) | YES | Preview; do not depend on. |
| `--input-format stream-json` | NO | YES only | Not needed for our plan. |

**Verdict:** the plan is subscription-viable end-to-end. Optional API mode later loses nothing — everything already picked works in both. The one capability that is API-only (structured hook-event stream) is not on our critical path — we already ingest hooks via shell → JSONL.

---

## E. SSE vs WebSocket/NDJSON — KEEP SSE

**CONFIRMED.** Traffic profile: server→client event stream (fleet updates, question arrivals, decisions applied) + client→server via POST (answer, defer, tick). Bidirectional realtime is not needed. SSE gives us:
- Native `EventSource` reconnect with `Last-Event-ID` — free session continuity across network blips.
- `event:` named channels — clean `rotate` / `question.new` / `decision.applied` typing without inventing a WS message dialect.
- HTTP/1.1 compatible with our launchd + 127.0.0.1 bind; no upgrade handshake to instrument.
- Industry trend (Overstory → Warren author noted by audit-stack) matches: pragmatic servers pick NDJSON or SSE, not WS, for this shape.

**Do NOT switch to WebSocket.** Do NOT copy Warren's bare NDJSON — SSE's spec-defined reconnect is worth Hono's ~50 lines.

---

## F. Consolidated deltas to feed back into the plan

1. **Revise `integration.md` §0 row 3f and §3f-body:** Channels are RESEARCH-PREVIEW inbound-notification transport, not "officially-blessed permission relay". Downgrade recommendation from "adopt as answer-delivery mechanism" to "adopt as v1.1 accelerator; verify subscription-account behavior before committing".
2. **Recommend v1 answer-delivery path in architecture:** BLOCKING `PreToolUse{AskUserQuestion}` hook + `permissionDecision: "defer"` with `updatedInput` populated from the web UI's answer (file/socket wait, configurable timeout). Add the timeout config, the `PostToolUse` re-run trigger, and TUI-progress heartbeat.
3. **Correct `integration.md` §0 row 2b:** the "internal/unstable" characterization of the transcript is not backed by an Anthropic statement in the hooks doc. Keep transcripts as CONTEXT enrichment, not live signal (hooks are live signal), but drop the "unstable" wording.
4. **Correct `stack.md` §Warren live-repo confirmation:** the citation of the client stack (React/Vite/shadcn/Tailwind) does not reproduce from `jayminwest/warren@main` package.json. Re-verify against actual client path; if the client lives elsewhere, name it; if the citation was aspirational, replace it with a working reference (kotadb, OpenHands, or Warren's actual current client if the audit can find it).
5. **Add missing Notification matchers:** `agent_needs_input`, `idle_prompt`, `permission_prompt`, `agent_completed` — 4 more matchers into `.claude/settings.json` for the web-UI signal path.
6. **Consider `claude --bg` as a supported alt-path** for dispatching gosleep worker agents from the web UI (in ADDITION to the harness path). It's first-class in the CLI and already gives us `agents --json` snapshots.
7. **Acknowledge the interactive-mode hook-event ceiling:** `--include-hook-events` is `--print`-only. Our shell-hook JSONL/SQLite ingestion is the only path for interactive subscription forever — encode this as a standing architectural invariant, not a "we might replace this later".

---

## Sources

- Official docs (fetched 2026-08-07): `code.claude.com/docs/en/hooks`, `.../plugins`, `.../cli-reference`.
- Local CLI: `claude --version` = 2.1.224; `claude --help`, `claude agents --json`, string-dump of `~/.local/bin/claude` bundle 2.1.221.
- GitHub: `gh api repos/jayminwest/warren` (2026-08-07), issue `honojs/hono#2050` (2024-01-20 closed).
