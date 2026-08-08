# @gosleep/channel

Bun MCP server that publishes the [`claude/channel/permission`](https://code.claude.com/docs/en/channels-reference.md) capability so Claude Code can relay `PermissionRequest` decisions from the owner's phone back into the local session — **v1.1 scope, dev-flag gated**.

> **Scoped down deliberately.** v1 lives entirely on hooks (see `docs/reports/web-harness-research-2026-08-03/target-architecture-rev3-addendum.md` Delta 1 → GSL-275, GSL-284). This package is the phone-side accelerator for the SAME class of dialogs (tool-use approvals: `Bash`, `Write`, `Edit`) plus owner-typed steer messages that deliver at turn boundaries. It **never** covers `AskUserQuestion`, project-trust, or MCP-consent dialogs — the hook path from GSL-275 is authoritative for those and this plugin never touches them.

## Two things this plugin does

1. **Permission relay** — on `notifications/claude/channel/permission_request {request_id, tool_name, description, input_preview}`, POST to `gosleep-core` at `http://127.0.0.1:7331/internal/permission-relay`. When the owner clicks Allow/Deny on the web UI (or the phone lock-screen once the mobile app ships), the plugin sends `notifications/claude/channel/permission {request_id, behavior: "allow"|"deny"}` back through the same channel and the local TUI dialog closes with the same decision.
2. **Owner-steer at turn boundaries** — an owner-typed message from the web UI is queued in `gosleep-core` and delivered to this session on its **next turn**. Never mid-turn. This is the fundamental limit of channels (`code.claude.com/docs/en/channels-reference.md`: *"channel events queue into the session … delivered together on the next turn"*).

## What this plugin does NOT do

- **Not the answer path for `AskUserQuestion`.** That dialog is served by the hook path in GSL-275 which unblocks mid-turn. Channels physically cannot do this (they only fire at turn boundaries).
- **Not the mid-turn interception path for anything.** Ever.
- **Not published to Anthropic's curated channel allowlist.** v1.1 stays behind `--dangerously-load-development-channels` until GA/curation. See "Preview reality" below.

## Enabling the plugin (opt-in, per session)

Two switches BOTH have to be flipped for the plugin to load anything:

1. **Session flag:** launch Claude Code with `--dangerously-load-development-channels`. This is the fundamental gate — without it Claude Code refuses to load any self-published channel (it accepts only Anthropic-curated ones during the research preview). Every session start with this flag shows the owner a **full-screen consent dialog** that must be dismissed by hand.
2. **Environment guard:** the session process (or its parent shell) must have `GOSLEEP_ENABLE_CHANNELS=1` in its environment. Without it, `packages/gosleep-channel/src/bin/gosleep-channel.ts` exits `0` immediately and no MCP handlers register. This is the layer that keeps a stray `--dangerously-load-development-channels` in a shell history from accidentally exposing your channel to an unrelated session.

Neither guard alone is enough. Both are required. See the "Session-start example" section below.

### The consent dialog is deliberate friction

`--dangerously-load-development-channels` triggers a **full-screen consent dialog at every session start** — the flag name is honest about the trust model. This is why the plugin is scoped to v1.1 and not v1: an orchestrator-spawned fleet of dozens of nightly workers each showing a consent dialog is not a workable UX. The plan is to wait until Anthropic curates the channel allowlist and gosleep-core is a candidate for inclusion, then drop both guards.

## Session-start example

Only for interactive sessions the owner personally supervises through consent:

```bash
env GOSLEEP_ENABLE_CHANNELS=1 \
    GOSLEEP_INTERNAL_SECRET="$(security find-generic-password -a "$USER" -s gosleep-web -w | sed 's/^b64v1://' | base64 -d)" \
  claude --dangerously-load-development-channels \
         --channels 'gosleep=@gosleep/channel'
```

For everything else (orchestrator-spawned workers, cron jobs, non-interactive) — omit both switches. This is the default. Nothing about this package fires.

## Architecture

```
   ┌──────────────────┐   permission_request     ┌──────────────────────────┐
   │  Claude Code     │ ────────────────────────►│ @gosleep/channel         │
   │  (interactive)   │                          │ (MCP server, stdio)      │
   │                  │◄──────────────────────── │                          │
   └──────────────────┘   notifications/claude/  └───────────┬──────────────┘
        ▲                 channel/permission                 │
        │                 {allow|deny}                       │ POST /internal/permission-relay
        │                                                    │ + long-poll for the decision
        │                                                    ▼
        │                                     ┌──────────────────────────────────┐
        │                                     │ gosleep-core (127.0.0.1:7331)    │
        │                                     │  • routes/internal.ts            │
        │                                     │    – POST /internal/permission-  │
        │                                     │      relay                       │
        │                                     │    – GET  /internal/permissions/ │
        │                                     │      :qid/decision-wait          │
        │  (also: hook path from GSL-284      │  • existing UI at /questions     │
        │   still handles the SAME dialog     │    renders 'permission' kind     │
        │   locally — this is the ADDED       │    rows unchanged                │
        │   phone-side path, not a replace-   └────────────────┬─────────────────┘
        │   ment)                                              │
        │                                                      ▼
        └─────────────── local TUI dialog closes ──── owner decides on
                       when either the hook or the      web UI / phone
                       channel returns first
```

The web/phone side is untouched from GSL-284 — the same `kind='permission'` row schema and the same "Allow / Deny" card. This plugin is a parallel input into the same store, not a new store.

## Compatibility with the hook path (GSL-284)

Both the PreToolUse hook (from GSL-284) and this channel plugin fire on the SAME `PermissionRequest`. Which one wins?

- Whichever returns a decision **first**. Both write to the same `questions` row (same `qid`; `INSERT OR IGNORE` deduplicates). The hook path is instantaneous (owner clicks Allow/Deny → hook returns decision synchronously via `PermissionDecision`). The channel path is round-trip (Claude Code → this plugin → core → phone → back).
- If the hook path fails-open (503 from core, owner AFK), the channel path still races the built-in TUI dialog — first answer wins.
- Neither path can bypass the local Claude Code trust check. The consent dialog on `--dangerously-load-development-channels` guarantees the owner physically approved the channel loading.

## Preview reality

- Channels are **research preview** — flags are absent from `--help` but functional. Contract may change without notice.
- The `--dangerously-load-development-channels` flag is the only way to load a self-published channel during the preview; the alternative is publication to the Anthropic-curated allowlist, which gosleep is not on.
- Pro/Max individual accounts skip org gating entirely — this is the owner's account tier, so the plugin is subscription-viable.

Full audit and adjudication: `docs/reports/web-stack-audit-2026-08-06/fable-final-verdict.md` §2 and `docs/reports/web-harness-research-2026-08-03/target-architecture-rev3-addendum.md` Delta 2.

## Sources

- `code.claude.com/docs/en/channels.md`
- `code.claude.com/docs/en/channels-reference.md`
- `docs/reports/web-harness-research-2026-08-03/target-architecture-rev3-addendum.md` Delta 2 (this ticket)
- `docs/reports/web-stack-audit-2026-08-06/fable-final-verdict.md` §2 (verdict on channels' v1.1 status)

## Status

**Skeleton only** as of GSL-282. The MCP JSON-RPC handlers are stubbed to compile clean, the HTTP relay is wired, the config guard is fully live, and the inert-without-flag path is covered by tests. Live end-to-end proof through `--dangerously-load-development-channels` is NOT part of this ticket per the delivery brief (2026-08-08). That proof lives in a future assembly-cycle ticket that isolates a supervised session per the GSL-274 pattern.
