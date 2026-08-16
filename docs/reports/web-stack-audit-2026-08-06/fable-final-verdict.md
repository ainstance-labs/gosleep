# fable-final-verdict — final adjudication of the web-stack audits

**Author:** fable-final-verify, gosleep shift 75, 2026-08-07. **Model:** Claude Fable 5 (session model; transcript-verifiable).
**Scope:** final adjudication pass over `coverage.md`, `stack.md`, `integration.md` (Opus 4.7, 2026-08-06) and `verify-core.md`, `verify-claims.md` (Fable 5 forks, 2026-08-07). Every claim re-checked against PRIMARY sources only: official docs fetched raw from code.claude.com (hooks.md 3330 lines, sessions.md, channels.md, channels-reference.md), strings-dump of the installed **2.1.224** binary (build 2026-08-06, git 8a2a469), `gh api` on jayminwest/warren and sameh0/op-gate, vite.dev blog, web corroboration for Tahoe. Not committed. No source files touched.

---

## 1. THE ANSWER-DELIVERY LOOP — definitive verdict

### (a) Is `defer` documented? YES — but it is PRINT-MODE ONLY. This kills verify-core's v1 path.

- Official hooks reference, PreToolUse decision control (hooks.md:1663): `permissionDecision` = `"allow" | "deny" | "ask" | "defer"`. `defer` IS a documented value. verify-core C4 and integration.md §1a were right about its existence.
- **BUT** — "Defer a tool call for later" (hooks.md:1698), verbatim: *"`"defer"` is for integrations that run `claude -p` as a subprocess and read its JSON output… **Claude Code honors this value only in non-interactive mode with the `-p` flag. In interactive sessions it logs a warning and ignores the hook result.**"*
- The 2.1.224 binary confirms at runtime: `"returned permissionDecision=defer in interactive mode; ignoring (defer is print-mode only)"` (strings dump, installed binary).
- Discrepancy resolved: the "internal schema with only allow/deny/ask" is (i) the older 2.1.221 strings and (ii) a legacy summary doc-string still embedded in 2.1.224 (*"permissionDecision - 'allow', 'deny', or 'ask' (PreToolUse only)"*). The current schema string in the same binary is `"allow" | "deny" | "ask" | "defer" (optional)`. Both reports saw real strings; only the doc's mode restriction settles it.
- Additional print-mode constraints (doc): defer only works when Claude makes a **single** tool call in the turn; the process exits with `stop_reason: "tool_deferred"`; no timeout/retry limit; resume via `claude -p --resume`.

**Verdict: `defer` is unusable for gosleep's interactive subscription fleet. verify-core's recommended v1 ("blocking hook + defer + updatedInput on the SAME hook invocation") conflated the print-mode defer/resume cycle with interactive mode — REFUTED. integration.md's "defer is exactly the state gosleep wants" — REFUTED for interactive.**

### (b) Hook timeout semantics — a blocking wait IS viable, with a benign failure mode

- Default timeout for `command`/`http`/`mcp_tool` hooks is **600 s** (hooks.md:415: *"Seconds before canceling. Defaults: 600 for `command`…"*) — NOT ~60 s as verify-core stated. Per-hook `timeout` field, in seconds, **no documented ceiling**.
- On timeout the hook is canceled → it has produced no decision. Doc (hooks.md:223): *"Exit code 0 with no output means the hook has no decision to report, so the tool call continues through the normal permission flow."* Only exit 2 (or JSON deny) blocks. A canceled/failed hook is a non-blocking error — **the tool call proceeds, i.e. the AskUserQuestion dialog renders in the TUI as normal. The session is NOT killed, NOT errored.**
- So the hook can be configured to wait e.g. 1800–3600 s for an owner answer; if the owner doesn't answer, the question gracefully falls back to the terminal. Waiting "all night" inside one hook invocation is undocumented territory (untested ceiling, blocked TUI, Esc-interrupt behavior unknown) — do not design for >1 h waits; design for a bounded window + graceful TUI fallback.

### (c) Can `updatedInput` inject the owner's answer? YES — this is the documented mechanism

- AskUserQuestion input schema (hooks.md:1643), verbatim: `answers` — *"Maps question text to the selected option label. Multi-select answers join labels with commas. **Claude doesn't set this field; supply it via `updatedInput` to answer programmatically**"*.
- hooks.md:1688: *"Returning `permissionDecision: "allow"` together with `updatedInput` satisfies that requirement: the hook … collects the answer through your own UI, and returns it in `updatedInput` so the tool runs without prompting. Returning `"allow"` alone is not sufficient… For `AskUserQuestion`, echo back the original `questions` array and add an `answers` object."*
- **One residual unknown:** that paragraph is framed around non-interactive blocking. hooks.md:1663 notes plain `"allow"` does NOT skip prompts for interaction-required tools; 1688 says allow+updatedInput satisfies the interaction requirement. Whether interactive mode then skips the TUI dialog entirely is not stated in so many words. **Mandatory 30-min smoke test on 2.1.224 before rev 3 commits** (hook returns allow+updatedInput{questions, answers} in a live interactive session; expected: tool completes, no dialog). Documented fallback if it fails: see (d)-2.

### (d) The v1 answer-delivery design (this replaces verify-core §C.2)

1. **Intercept:** `PreToolUse{matcher: "AskUserQuestion"}` command hook. It POSTs the full `tool_input` (questions+options) to gosleep-core, then **long-polls core for the answer** with hook `timeout` set to a bounded window (recommend 900–1800 s configurable).
2. **Answer arrives in-window** (owner clicked in web UI, or decision-manifest rule auto-matched): hook returns `allow` + `updatedInput` = original `questions` + `answers` map → tool completes as answered; TUI never prompts; agent proceeds. *(Pending the (c) smoke test; production-safe fallback that needs no test: return `deny` + `permissionDecisionReason` carrying the answer — "For `deny`, shown to Claude" (hooks.md:1664) — the model reads the owner's answer as the denial reason and proceeds; semantically lossier but fully documented in interactive mode.)*
3. **Timeout / no answer:** hook exits 0 with no output → question renders in the TUI as normal. Web UI already holds the payload and flips the question to "TUI-local"; late delivery falls back to tmux `send-keys` (free-text path only, never the arrow selector) or waits for the owner. No error state anywhere.
4. **Permission prompts** (the other blocking state): same blocking-wait pattern on `PermissionRequest` (returns `decision.behavior: allow|deny`, documented) with `PermissionDenied{retry:true}` for the auto-mode variant; channels permission relay joins in v1.1 as the phone-side accelerator.
5. **Why hooks and not channels for this:** channel events *"queue into the session… delivered together on the next turn"* (channels-reference) — a channel message can NEVER unblock an agent stuck mid-turn on a question. Hooks are the only mid-turn interception point in interactive mode. (Curiosity noted, untested: `asyncRewake` hooks "wake Claude on exit code 2" from background — a possible late-nudge channel; not for v1.)

---

## 2. Channels — verify-core's correction was itself an over-correction

Primary source: channels.md + channels-reference.md (fetched today).

- **Two-way IS official:** *"Channels can be two-way: Claude reads the event and replies back through the same channel"* — via a standard MCP reply tool. verify-core's "inbound notifications, not bidirectional" was wrong on the letter; integration.md's framing was closer.
- **Permission relay IS official and fully specified:** capability `claude/channel/permission`; Claude Code sends `notifications/claude/channel/permission_request` `{request_id, tool_name, description, input_preview}`; server returns `notifications/claude/channel/permission` `{request_id, behavior: allow|deny}`; local dialog stays open, first answer wins. integration.md row 3f was substantively right. BUT: **relay covers tool-use approvals only** ("Bash, Write, Edit") — it does NOT relay AskUserQuestion dialogs, project-trust, or MCP-consent dialogs.
- **Status:** research preview; flags absent from `--help` but functional; contract may change. **Pro/Max individual accounts skip org gating entirely** (*"Pro and Max users without an organization skip these checks… opt in per session with `--channels`"*) — subscription-viable, settles verify-core's open question.
- **The v1.1 realism check:** during the preview, `--channels` only accepts the Anthropic-curated allowlist. *"A channel published to your own marketplace still needs `--dangerously-load-development-channels`"*, which shows a **full-screen consent dialog at every session start** — real friction for an orchestrator-spawned fleet, and the flag name is honest about the trust model. **Verdict: building gosleep-core as a channel plugin is technically realistic for v1.1 (Bun MCP server, ~200 LOC per the reference), but only behind the dev flag until GA/curation; scope it to the permission-relay half and inbound owner-steer messages, never as the question-answer path.**

---

## 3. Warren — settled: the web client EXISTS; verify-core C3 was wrong

- `gh api repos/jayminwest/warren/contents/src` → `ui/` is right there (verify-core only checked the ROOT listing and root `package.json`, then reported "no client anywhere").
- **`src/ui/package.json` verbatim:** name `@os-eco/warren-ui`, description *"Warren web UI (React + Vite + Tailwind + shadcn-style components)"*. Deps: react **^18.3.1**, vite **^6.0.0**, tailwindcss **^4.0.0**, @tanstack/react-query ^5.62, react-router-dom ^7.0.2, recharts ^3.8.1, framer-motion ^12, lucide-react, @radix-ui primitives + cva/clsx/tailwind-merge (shadcn-STYLE vendored components, not the shadcn CLI).
- **Transport:** code search `ndjson` → 129 hits incl. `src/client/ndjson.ts`; `EventSource` → **0 hits**. Warren's client consumes NDJSON over HTTP, no SSE.
- **Adjudication:** stack.md's Warren table was accurate — including its own caveat that Warren is React 18 while we pin 19. Our SSE pick remains a deliberate, correctly-argued divergence from Warren's NDJSON. Root package.json (`@os-eco/warren-cli` 0.14.0, drizzle/pino/commander) is the CLI/server package; the repo is a single package with `src/ui` as a private sub-package excluded from publish (`"files": ["src", "!src/ui"]`).

## 4. Quick confirmations

| Check | Result |
|---|---|
| Transcript JSONL stability | **integration.md RIGHT, verify-core C2 refutation REFUTED.** sessions.md verbatim: *"The entry format is internal to Claude Code and changes between versions, so scripts that parse these files directly can break on any release."* verify-core searched only hooks.md and missed the quote's actual source. Design stance unchanged (both reports converged anyway): hooks = live signal, transcript tail = context enrichment behind integrity fences. |
| TouchID needs .app bundle | **CONFIRMED** (verify-claims right, stack.md §7 wrong). op-gate README verbatim: *"a signed macOS `.app` bundle (required for biometric entitlements)"*. rev 3: `bin/touchid-gate` = minimal signed .app (ad-hoc codesign + entitlements + Info.plist). |
| Tahoe 26.x `security -w` regression | **CONFIRMED** — hang/exit 36 + HEX-encoding of binary passwords; both cited articles live + corroborated by search. Keep Tahoe-aware fallback + ACL + hard-fail 503. |
| Vite 7-vs-8 pin | **CONFIRMED** — Vite 8 stable 2026-03-12, Rolldown default bundler, official staged path is `rolldown-vite` on 7 first. Pin **Vite 7** for v1 (note: Warren itself ships Vite 6; we still go 7). |

## 5. Report scorecard (for the orchestrator's calibration)

- **integration.md:** strongest of the five on mechanisms; wrong only on defer-in-interactive and on overselling channels' maturity. Its channels substance (two-way + relay) was right.
- **stack.md:** Warren table accurate; TouchID §7 wrong (no-bundle claim); Vite/Keychain/SSE all held.
- **coverage.md:** all four spot-checked gaps literally reproducible (per verify-claims §8); G1–G4 stand.
- **verify-core:** valuable (subscription matrix, `--bg`, hook-event ceiling, 8 notification types) but **3 material errors**: C1 over-correction (channels), C2 false refutation (transcript), C3 false refutation (Warren UI) — plus the defer v1 path and the "~60 s default timeout". Its §D subscription-viability matrix and the "shell-hook ingestion is the permanent interactive path" invariant both SURVIVE this pass.
- **verify-claims:** clean; every adjudicated claim held (TouchID, Tahoe, Vite, Hono issues, Bun #21560 recharacterization, coverage spot-checks).

---

## 6. FINAL VERDICT TABLE → input for architecture rev 3

| Layer / mechanism | Verdict | One line |
|---|---|---|
| Bun 1.2+ daemon (launchd) | **KEEP** | Nightly restart + RSS self-monitor as generic hygiene; drop the #21560 causation wording. |
| Hono 4 + streamSSE | **KEEP** | Broadcaster never resolves early + 15–30 s heartbeat + abort-signal close (Hono #2050 is by-design). |
| Drizzle + drizzle-kit + bun:sqlite, WAL 1-writer | **KEEP** | Divergence (not corruption) is the risk → integrity fences; Warren precedent verified real. |
| SSE server→client, POST client→server | **KEEP** | Deliberate divergence from Warren's NDJSON; EventSource reconnect + Last-Event-ID is the payoff. |
| React 19 + Vite **7** + shadcn/ui + Tailwind 4 + TQ5 + RR7 | **KEEP** (Vite 6→7 CHANGE confirmed) | Vite 8/Rolldown deferred to v1.1; Warren parallel stack verified (React 18/Vite 6 there). |
| TouchID gate | **CHANGE** | Minimal signed .app bundle (ad-hoc codesign + entitlements), invoked as app path — not a bare Mach-O. |
| Keychain bearer | **CHANGE** | Tahoe-aware fallback + `-T` ACL binding + hard-fail 503, never silent-unauth. |
| `PreToolUse{AskUserQuestion}` blocking hook | **KEEP — THE CORE** | allow+`updatedInput{questions, answers}` after smoke test; deny+reason as documented fallback; bounded wait 15–30 min; timeout → benign TUI fallback. |
| `permissionDecision: "defer"` | **DROP for v1** | Print-mode only — official doc + 2.1.224 binary both explicit. Revisit only if a `-p`-spawned lane ever exists. |
| `PermissionRequest` / `PermissionDenied{retry}` hooks | **KEEP** | Documented allow/deny + retry; same blocking-wait pattern for permission prompts. |
| `Notification` matchers | **KEEP + EXTEND** | Add `agent_needs_input`, `idle_prompt`, `permission_prompt`, `agent_completed` (8 documented types). |
| Transcript JSONL tail | **KEEP as enrichment only** | Officially "internal… can break on any release" (sessions.md verbatim) — never the live signal. |
| `claude agents --json` | **KEEP** | Fleet snapshot, poll 3–5 s; correlate with hook session_ids. `--bg` dispatch = supported alt path. |
| tmux `send-keys` | **KEEP as last-resort fallback** | Free-text prompt box only, post-hook-timeout; never the arrow-key selector. |
| Channels plugin (gosleep-as-channel) | **v1.1, scoped** | Real (two-way + permission relay documented) but preview + `--dangerously-load-development-channels` + per-start consent dialog + turn-boundary delivery; relay ≠ questions. |
| Remote Control `/rc` | **KEEP in parallel** | Owner convenience surface; no public attach API — not an integration point. |
| SessionAdapter interface | **KEEP** | Everything above is Claude-Code-shaped; isolate before provider #2. |

### v1 interaction design (≤10 lines)

1. Every supervised session gets `PreToolUse{AskUserQuestion}` + `PermissionRequest` + 4 new `Notification` matchers in settings.json.
2. Question fires → hook POSTs payload to gosleep-core → web UI shows it instantly (SSE `question.new`) → hook long-polls core.
3. Manifest rule matches → core answers immediately with rule provenance; else owner answers from phone/web.
4. Answer in-window → hook returns `allow`+`updatedInput{questions, answers}` (smoke-test gated; else `deny`+reason carrying the answer) → agent proceeds, TUI never prompted.
5. No answer by hook timeout (15–30 min) → exit 0 silent → TUI renders question normally; web UI flags "TUI-local"; late answer via send-keys free-text or morning.
6. Permission prompts: identical blocking-wait on `PermissionRequest` (allow/deny), `PermissionDenied{retry:true}` for auto-mode.
7. Fleet census: `claude agents --json` poll; liveness/state: hook stream → JSONL/SQLite (the permanent interactive path — `--include-hook-events` is `-p`-only).
8. Transcript tail = context enrichment behind integrity fences, never the signal.
9. v1.1: gosleep channel plugin (dev flag) adds phone-side permission relay + owner-steer messages at turn boundaries.
10. New rev-3 tickets: (a) the interactive allow+updatedInput smoke test, (b) answers-injection hook, (c) touchid .app bundle, (d) G1–G4 from coverage.md — all still valid.

## Sources

- code.claude.com/docs/en/{hooks.md, sessions.md, channels.md, channels-reference.md} — fetched raw 2026-08-07; line refs to /tmp/hooks-doc.md (3330 lines).
- Installed CLI 2.1.224 (build 2026-08-06T01:05Z, git 8a2a469) — strings dump of `~/.local/share/claude/versions/2.1.224`.
- `gh api` — jayminwest/warren (root + src + src/ui + src/ui/package.json + code search ndjson/EventSource), sameh0/op-gate README.
- vite.dev/blog/announcing-vite8; Tahoe: dev.to/euda1mon1a (keychain CLI hang), zenn.dev/omori432 (hex encoding), corroborating search 2026-08-07.
