# GSL-282 [Repo][Web] Channels v1.1 — gosleep-as-channel plugin skeleton (dev-flag gated)

**Date:** 2026-08-08 (shift 75 / cycle 212 impl-web-15, day)
**Branch:** GSL-250-control-plane
**Model:** Claude Opus 4.7 (owner global pin, no per-spawn override)
**Depends on:** GSL-275 (answer-delivery loop — the hook path this plugin runs
alongside, not against); GSL-284 (`kind='permission'` rows + `POST
/actions/permissions/decide` — the storage + owner-decide path the channel
plugin borrows verbatim).

## Part 1 — the story

Rev-3 addendum Delta 2 (`docs/reports/web-harness-research-2026-08-03/target-architecture-rev3-addendum.md`)
rescoped Anthropic Channels from v1 (as `integration.md` had implied) to v1.1
with three sharp qualifiers:

1. Every self-published channel needs `--dangerously-load-development-channels`,
   and every session start with that flag shows the owner a full-screen consent
   dialog. Real friction for the orchestrator-spawned fleet.
2. Permission relay covers **tool-use approvals only** (`Bash`, `Write`, `Edit`).
   It does not relay `AskUserQuestion`, project-trust, or MCP-consent dialogs
   — those stay on the GSL-275 hook path.
3. Channel messages deliver at **turn boundaries** only. Never mid-turn. That
   is the fundamental limit of the transport per
   `code.claude.com/docs/en/channels-reference.md`.

This ticket builds the skeleton so the future v1.1 activation is a config
change, not a green-field build. Concretely:

### The package (`packages/gosleep-channel/`)

~200 LOC per the channels-reference sample budget, split six ways for
testability:

- **`src/config.ts`** — `channelsEnabled()` reads `GOSLEEP_ENABLE_CHANNELS`
  and returns true only on `"1"` / `"true"` (case-insensitive, whitespace-
  tolerant). This is the env half of the double guard. URL builders hard-pin
  the base to `http://127.0.0.1:7331` — a channel that can be pointed at an
  arbitrary host defeats the point of the local-trust model.
- **`src/types.ts`** — zod schemas for every wire shape the plugin sees or
  emits: `permissionRequestSchema`, `permissionDecisionSchema`,
  `steerMessageSchema`, `relayAckSchema`, `decisionWaitSchema`. Untrusted
  payloads never propagate past the boundary parser.
- **`src/relay.ts`** — HTTP client for `POST /internal/permission-relay` and
  `GET /internal/permissions/:qid/decision-wait`. Fail-open by construction:
  network error → `{failedOpen: true}`, `503` → `{failedOpen: true}`, no
  secret → `{failedOpen: true}`. Never throws across the MCP boundary.
- **`src/steer.ts`** — HTTP client for `POST /internal/steer/:sid/drain`.
  Same fail-open discipline. Returns an empty message list today (the queue
  endpoint on core side is a reserved skeleton — see below).
- **`src/server.ts`** — MCP JSON-RPC dispatcher. Implements `initialize`
  (publishes `claude/channel/permission`) and three notification handlers:
  `notifications/claude/channel/permission_request` (relay + wait + notify),
  `notifications/claude/channel/steer_drain` (drain + notify per-message),
  and every other method returns `-32601` for a request and drops for a
  notification. Newline-delimited JSON on stdio per MCP spec; malformed
  frames log to stderr and skip rather than crash.
- **`src/bin/gosleep-channel.ts`** — the bin entry Claude Code launches.
  Short-circuits on `channelsEnabled() === false` with a single stderr
  breadcrumb; MCP handlers never register. This is the env-side of the
  double guard.

### The double-guard, spelled out

Two independent switches BOTH have to be on for anything to happen:

1. **Session flag** — Claude Code launched with
   `--dangerously-load-development-channels`. Enforced by Claude Code itself
   (we cannot see this from the plugin). Every session start shows a full-
   screen consent dialog the owner must dismiss by hand.
2. **Env guard** — `GOSLEEP_ENABLE_CHANNELS=1` in the plugin process's env.
   Enforced by `src/bin/gosleep-channel.ts` before the MCP loop starts.
   Without it, `bun packages/gosleep-channel/src/bin/gosleep-channel.ts`
   exits 0 with a one-line stderr breadcrumb and writes nothing to stdout.

Neither alone is enough. Both are required. This is documented in
`README.md` § "Enabling the plugin (opt-in, per session)" and covered by
`test/inert.test.ts`.

### Core-side wiring (three new `/internal/*` endpoints)

Added to `apps/core/src/routes/internal.ts` behind `requireInternalSecret`
+ the app-wide local-host/local-origin guards:

- **`POST /internal/permission-relay`** — accepts the channel wire shape
  (`{request_id, tool_name, description, input_preview, session_id?}`),
  reduces to the same `PermissionInput` `POST /internal/permissions/post`
  uses, and INSERTs `kind='permission'` into `questions` with the canonical
  `[{label:'Allow'},{label:'Deny'}]` options. Fires the same fire-and-forget
  `lab-log --type permission.posed --actor channel:<sid>` (the `channel:`
  prefix is the provenance tell), and returns the qid + `origin: "channel"`.
  From this point on the row is indistinguishable from a hook-relayed
  permission — the web card, `POST /actions/permissions/decide`, and the
  owner UX all work uniformly.

- **`GET /internal/permissions/:qid/decision-wait?timeout_s=N`** — long-poll:
  same subscribe/notify machinery as the AskUserQuestion answer-wait, but
  reads `answer_text` back as `"allow" | "deny"` and returns
  `{qid, behavior, answered_at, answered_by?}`. `doDecidePermission`
  (GSL-284) already fires `questionNotifier.notify(...)`, so no core-side
  wire change was needed — this endpoint just subscribes to the existing
  wake mechanism. Guards: `404` on unknown qid, `409` on `kind !== 'permission'`,
  `204` on timeout or abort (the local dialog wins).

- **`POST /internal/steer/:sid/drain`** — reserved skeleton. Returns
  `{ok: true, messages: [], reserved: true}` today. Future work (separate
  ticket, not GSL-282) will back this with a persistent queue populated by
  the web UI. Keeping the endpoint live from day zero means the plugin can
  call the drain unconditionally and get an empty response until the queue
  exists — no client-side feature flag needed.

### Non-goals reaffirmed (explicit)

- **`AskUserQuestion` never rides channels.** The hook path from GSL-275 is
  the only correct route for that dialog because it unblocks mid-turn.
  Channels physically cannot do this.
- **Mid-turn interception of any kind through channels.** Ever.
- **Publication to the Anthropic-curated channel allowlist.** v1.1 stays
  behind `--dangerously-load-development-channels` until GA/curation.

### What is NOT proved live

The ticket's first two acceptance items require live sessions with the
dangerous flag on:

- Owner approves a `Bash` permission from the phone via the channel → local
  dialog auto-closes with the same decision.
- Owner types a message in the web UI while a session is mid-turn → message
  delivers on the NEXT turn (never mid-turn).

Per the delivery brief's rule ("NO live session experiments requiring the
dangerous flag unless the ticket explicitly demands a proof — if it does,
isolate per the GSL-274 pattern"), those proofs are deferred to a future
assembly-cycle ticket that supervises a real session with the flag on. The
core-side wiring is fully tested in isolation (25 tests in
`apps/core/test/internal.test.ts`, 28 tests in `packages/gosleep-channel/test/`)
so when that supervised session runs, only the channel-loading half is new
territory. The third acceptance item (inert without both switches) IS
proved live — see `packages/gosleep-channel/test/inert.test.ts`.

### Rollback

Trivially reversible: remove the two new endpoint blocks in
`apps/core/src/routes/internal.ts`, delete `packages/gosleep-channel/`,
`bun install`. Nothing else in the repo depends on either. The
`data/`-touching parts of core are unchanged.

## Part 2 — technical reference

### Files added

- `packages/gosleep-channel/package.json`, `tsconfig.json`, `README.md`
- `packages/gosleep-channel/src/{index,config,types,relay,steer,server}.ts`
- `packages/gosleep-channel/src/bin/gosleep-channel.ts`
- `packages/gosleep-channel/test/{config,inert,relay,server}.test.ts`
- `docs/dev_history/GSL-282-phase7-channels-v1.1-skeleton.md` (this file)

### Files changed

- `apps/core/src/routes/internal.ts` — added three endpoints under a shared
  GSL-282 header block, and one helper `toDecisionPayload()`.
- `apps/core/test/internal.test.ts` — added 10 tests across three describe
  blocks covering the new endpoints (`permission-relay`, `decision-wait`,
  `steer drain`).

### Contracts

- `POST /internal/permission-relay` — body `{request_id, tool_name,
  description?, input_preview?, session_id?}` → `200 {ok, qid, tool,
  opened_at, origin: "channel"}`. `400` on missing `request_id` or
  `tool_name`. `401` on wrong / missing internal secret. `503` when core
  has no secret configured.
- `GET /internal/permissions/:qid/decision-wait?timeout_s=N` — long-poll
  bounded at 600 s default / 1800 s cap (parseTimeoutSeconds). Response
  `200 {ok, qid, behavior: "allow"|"deny", answered_at, answered_by?}`,
  `204` on timeout / abort, `404` on unknown qid, `409` on `kind !==
  'permission'`, `401` / `503` on auth.
- `POST /internal/steer/:sid/drain` — body `{}` → `200 {ok: true,
  messages: [], reserved: true}`. Reserved for a future queue writer.

### Gates

- `bun x tsc -p apps/core --noEmit` clean.
- `bun x tsc -p packages/gosleep-channel --noEmit` clean.
- `bun test ./apps/core/test/` — **140 pass, 0 fail** (was 130 pre-task —
  new tests: 10 covering the three channel endpoints).
- `cd packages/gosleep-channel && bun test` — **28 pass, 0 fail** across
  4 files (config, relay, server, inert).
- `bash tools/lab/tests/core-smoke.sh` — **66 pass, 0 fail** (same
  baseline; the new endpoints do not add scenarios to core-smoke —
  channel-plane smoke lives in the package tests where it belongs).
- `bash tools/lab/gate.sh --offline` — green (see receipt in
  `.artifacts/lab/gates/gate.json`).

### Enabling in a supervised session (documentation only, not run this shift)

```bash
env GOSLEEP_ENABLE_CHANNELS=1 \
    GOSLEEP_INTERNAL_SECRET="$(security find-generic-password -a "$USER" -s gosleep-web -w \
                              | sed 's/^b64v1://' | base64 -d)" \
  claude --dangerously-load-development-channels \
         --channels 'gosleep=@gosleep/channel'
```

Owner sees the full-screen consent dialog on every start. Do NOT wire into
`.claude/settings.json` — that would surprise every session with a consent
dialog. The plugin is a per-invocation opt-in.

### Provenance in the timeline

Channel-relayed permission requests fire `lab-log --type permission.posed
--actor channel:<sid> --data-json '{"origin":"channel", ...}'` — grep
`origin="channel"` in `docs/lab/events/*.jsonl` (or the events table) to
find channel-relayed decisions vs hook-relayed ones. This provenance is
what tells a future auditor which path served which decision.
