---
name: remote-control
description: Use when the owner needs to reach a running Claude Code session from a phone — steering an orchestrator from bed, approving a permission prompt while away, or deciding whether a night's work can be supervised remotely at all. Triggers - "pair my phone", "control this from my phone", "/rc", "remote control", "can I approve this from my phone", "push notifications to my phone", planning overnight autonomy. Covers the three pairing surfaces, both push toggles, and the limits that decide whether the phone path is trustworthy tonight.
---

# Remote Control

## Overview

Remote Control mirrors **one local Claude Code session** to `claude.ai/code` and the Claude mobile
app. The conversation syncs both ways, and permission prompts can be approved from the phone. It is
outbound-HTTPS only — no inbound ports, no third party in the auth path.

It is a **research preview**. Flags, the slash command and the settings keys have all moved before
and will move again. So the **executable** name for every one of them lives in a single place —
the `SURFACE` block of `tools/rc/rc-preflight.sh` — and every script, hook and brief asks that
script instead of keeping a copy. Prose like this table below still spells the flags out; that is
description, not a second source of truth. Never hard-code a Remote Control flag into orchestrator
logic, a hook, or settings. When the surface moves, one block changes.

Run the preflight before promising the owner anything:

```bash
tools/rc/rc-preflight.sh          # human verdict; exit 0 ready / 1 degraded / 2 unavailable
tools/rc/rc-preflight.sh --json   # same verdict as one JSON object
```

## The three surfaces are not interchangeable

This is the distinction that decides everything, and it is the one most likely to be gotten wrong:

| Surface | Reaches | Use it when |
|---|---|---|
| `/rc [name]` (in-session slash, alias of `/remote-control`) | the session you are **already in** | The orchestrator is live and must stay live. **The only path that does not cost a restart.** |
| `claude --remote-control [name]` | a **new** session, paired from its first turn | Starting a session you already know you will want on the phone. |
| `claude remote-control` (hidden from `--help`, alias `rc`) | a **server** accepting many sessions (`--capacity`, default 32; `--spawn same-dir\|worktree\|session`) | You want several remotely-spawned sessions, not one mirror. |

**A running session cannot be paired by a flag.** Flags apply at process start. An orchestrator that
has been accumulating fleet state for hours must be paired with `/rc` — restarting it to add a flag
trades the entire live context for a phone link, which is almost never the right trade. If someone
proposes `--remote-control` for an already-running session, that is the error to catch.

`/rc` is a **toggle**: run it again to disconnect. It takes an optional name shown in `claude.ai/code`.

## Both push toggles, and why the second one is the one that matters

Two independent switches, both **default OFF** — an absent key means off, not on:

| Owner-visible label | Settings key | Sends |
|---|---|---|
| "Push when Claude decides" | `agentPushNotifEnabled` | proactive notifications the model chooses to send |
| "Push when actions required" | `inputNeededNotifEnabled` | **a permission prompt or question is waiting** |

For unattended overnight work the second one carries the value: it is the switch that turns a
blocked prompt into a buzz on the phone. With it off, a session can sit blocked until morning and
the phone stays silent.

Flip them in `/config` (Connections), or by hand in `~/.claude/settings.json`. Two cautions:

- The "actions required" row is **additionally gated server-side**. When that gate is off for the
  account the row is not rendered in `/config` at all, and the settings file is the only way in.
  A missing row is not a missing feature — check the file before concluding anything.
- The toggles sync with the account. Local values are pushed to the server; server values are
  pulled back **only when the local key is absent**. So a value set on the phone can appear locally,
  but a local value is never silently overwritten.

**Turning these on has a cost — say it out loud before flipping.** Every permission prompt from
every running session becomes a push. Enable them for a fleet only when the owner wants to be woken.

## Limits — state these before the owner relies on it

Honest limits are the deliverable here; a phone path the owner trusts more than it deserves is worse
than none:

- **The local process must stay alive.** Remote Control mirrors a session; it does not host one.
  Close the terminal and the phone goes dead.
- **~10 minutes offline kills the session.** A laptop that sleeps, a network that drops on the way
  home — the session is gone, not suspended.
- **It mirrors ONE session.** The owner steers whatever session was paired. Anything happening in
  other panes is invisible to it.
- **Fleet-level events are out of scope.** Remote Control is per-session by construction, so it
  cannot report a worker that died in a pane the owner never paired. That is what the hook→push path
  exists for; the two are complements, not alternatives.
- **Subscription-only by design** — no API-key path. This matches the project's standing policy
  rather than fighting it.
- **Presence suppression:** with `CLAUDE_CLIENT_PRESENCE_FILE` set, push is suppressed while that
  marker file exists — the owner is judged present. If pushes are mysteriously absent, check this
  before blaming the toggles.

## Degrading honestly

When preflight says `degraded` or `unavailable`, say which leg failed and what it costs tonight —
never round up to "the phone works". A surface that moved (`degraded` on a flag check) means the
research preview shifted under us: re-verify against `claude --help` and
`claude remote-control --help` by hand, fix the SURFACE block in `rc-preflight.sh`, and record what
changed. Do not paper over it in a caller.

Pairing itself is a QR scan between a terminal and a human's phone. There is no headless path — a
script cannot pair on the owner's behalf, and one that claims to has not been read carefully.
The runbook for the human half is `docs/runbooks/remote-control.md`.
