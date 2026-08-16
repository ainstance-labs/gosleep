# gosleep-core — operator runbook

**Scope.** The Bun+Hono web control-plane engine that serves the owner's panel at
`http://127.0.0.1:7331`. Built under epic [GSL-250](https://ainstance-labs.atlassian.net/browse/GSL-250)
across `apps/core/` (server) + `apps/web/` (React client, wired in a later task) +
`packages/{schema,sdk}/` (shared TS layers).

**When to read this.** First-time setup on a fresh Mac, Keychain-timeout troubleshooting,
TouchID gate failing, or wanting to know how to start/stop/rotate/uninstall the engine.

For architecture (why this exists, what it replaces), see
`docs/reports/web-harness-research-2026-08-03/target-architecture.md` (rev 2 +
`target-architecture-rev3-addendum.md`).

## 1. Setup on a fresh machine

Run once per Mac:

```bash
# 1. Bun + swiftc (touchid-gate.app builder)
bash apps/core/install-deps.sh

# 2. Root install: workspaces + dependencies
bun install

# 3. Install the launchd agent + set the Keychain Bearer secret
bash apps/core/plist.sh install
#    → interactive prompt for the Bearer secret (32-64 chars recommended)
#    → OR:   GOSLEEP_BEARER_TOKEN=$(openssl rand -base64 48) bash apps/core/plist.sh install --secret ENV
#    → agent bootstraps under gui/$UID, healthz answers on 127.0.0.1:7331

# 4. Verify
bash apps/core/plist.sh status
#    → one JSON line: {"installed":true,"loaded":true,"healthz":"ok","pid":12345}
```

Everything that the panel reads/writes lives under `data/` (SQLite `gosleep.db`, WAL/SHM,
snapshots, logs). `data/` is git-ignored — the runtime DB never enters git.

**Build the web bundle (GSL-285):** the React SPA is served from `apps/web/dist/` by
`apps/core/src/routes/spa.ts` — the owner opens `http://127.0.0.1:7331/` and gets the panel
directly (no separate Vite dev server needed). Build after every clone or web-side change:

```bash
bun run --filter='@gosleep/web' build
```

If the bundle is missing (fresh clone before the build ran), the root returns an explicit
"web bundle is missing — run …" placeholder page instead of a blank 404. Static assets and
`index.html` are PUBLIC (no Bearer), but every `/status`, `/fleet`, `/events`, `/actions/*`
etc. remains Bearer-gated as before — an unauthenticated tab loads the shell and every data
call surfaces the standard "Auth required" banner until the token is set (see § 3, or the
`?token=` handshake below). Override the dist location for a hermetic smoke:
`GOSLEEP_WEB_DIST=/tmp/scratch-dist bun run apps/core/src/serve.ts`.

## 2. Start / stop / status

```bash
bash apps/core/plist.sh status              # health line + pid
launchctl bootout gui/$UID/com.gosleep.core # stop (agent unloads)
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.gosleep.core.plist  # start again
bash apps/core/plist.sh uninstall           # bootout + remove plist
bash apps/core/plist.sh uninstall --purge-secret  # + delete the Keychain item
```

**Owner-only rule:** never bootout on your own initiative during a live shift — the engine
is what the owner reads from the phone. Wait for the owner's explicit command.

## 3. Where the secret lives

- **macOS Keychain**, service = `gosleep-web`, account = `$USER`.
- Wrapped as `b64v1:<base64-of-utf8>` (see `apps/core/src/security/tokenEncoding.ts`).
- ACL is bound to `bun` + `plist.sh` (`security add-generic-password -T …`) — anything else
  under the same UID gets a Keychain consent prompt it cannot answer from a pipe.
- **Rotation:** `bash apps/core/plist.sh rotate-secret` (does NOT touch launchd). Then the
  owner updates any bookmarked panel Bearer inputs.
- **Dev override:** `GOSLEEP_BEARER_TOKEN=…` short-circuits Keychain (see
  `apps/core/src/security/authSource.ts`, chain: dev-env → Keychain → GOSLEEP_TOKEN_PATH →
  none). Never set in production.

## 4. Reading logs

- **launchd stdout/stderr:** the plist template writes to `data/logs/core.out.log` +
  `data/logs/core.err.log` (relative to repo root). Both are line-JSON — one event per line.
  ```bash
  tail -n 50 -f data/logs/core.out.log | jq -c '.event, .[]?'
  ```
- **Boot audit line:** every process launch writes `{"event":"core.listen",...}` on
  startup and one `{"event":"security.auth_source",...}` line describing which auth-source
  rung the process picked (dev-env / keychain / token-path / none).
- **Timeline events** (in the DB, surfaced on the panel): `sqlite3 data/gosleep.db 'select
  ts, actor, event, seq from events order by seq desc limit 20;'`. WAL means the shell tool
  reads without contending with the running server.
- **Metrics:** `curl -s http://127.0.0.1:7331/metrics` returns Prometheus text-exposition
  format — 14 families, auth-source truthful even on headless boots (GSL-280).
- **Chronicler ledger** (which chronicler pass wrote what):
  `.artifacts/lab/chronicler-ledger.jsonl` (one line per pass; `mode` = shell / debounce /
  tick / web).

## 5. Making a snapshot by hand

```bash
# One SQLite snapshot into data/snapshots/YYYY-MM-DD/gosleep.db (compressed by the daily
# launchd cron; on demand:)
bash apps/core/scripts/snapshot.sh
#    → writes data/snapshots/$(date -u +%F)/gosleep.db + status.json
```

The daily cron (installed by `plist.sh install`) runs the same script at 04:00 local time.
Retention is 30 days by default (edit `apps/core/scripts/snapshot.sh` to tune).

## 6. Troubleshooting

### 6.1 Keychain timeout / 503 on every request

Symptom: `curl -sI http://127.0.0.1:7331/version` returns `HTTP/1.1 503 Service Unavailable`
with body `keychain unavailable`, and `data/logs/core.err.log` shows
`security.keychain.timeout` events.

Cause: the Keychain item is present but its ACL requires an interactive consent prompt
`bun` can't answer, OR macOS Tahoe (26.x) is holding the `security` CLI open.

Fix in order:

1. `bash apps/core/plist.sh status` — confirm the engine is actually running.
2. `security find-generic-password -s gosleep-web -a "$USER" -w >/dev/null 2>&1 && echo "reads ok"`
   from a Terminal — proves the Keychain item exists.
3. Rotate: `bash apps/core/plist.sh rotate-secret` — the rotation call rewrites the ACL with
   the `-T bun -T plist.sh` binding.
4. On Tahoe 26.x, if `sw_vers -productVersion` starts with `26.`, verify the plist install
   was done AFTER the OS upgrade — the ACL binding changed shape.

Timeout ceiling: the middleware calls `security` under a 5-second timeout
(`GOSLEEP_KEYCHAIN_TIMEOUT_MS`) — a hang beyond that returns 503 rather than blocking the
whole request pipeline. Do NOT raise this without measuring; a Bearer check that blocks
30 seconds also blocks every subsequent request.

### 6.2 TouchID gate fails / cancelled

Symptom: high-blast write endpoints return `401 touchid required` or `408 touchid cancel`.

Cause: TouchID sensor unavailable (external keyboard, screen-lock triggered, no biometric
enrolled), OR the operator cancelled the prompt.

Fix in order:

1. Confirm the sensor is available: `bioutil -c 2>/dev/null | grep -i touchid`.
2. Re-run whatever action triggered the prompt (retry-safe — endpoints are idempotent via
   `Idempotency-Key`).
3. If the sensor is unavailable, the operator can fall back to TTY confirm (see
   `apps/core/bin/tty-confirm.sh`), or bypass by resolving the action from the CLI —
   never bypass TouchID by relaxing the gate in code.

### 6.3 Engine won't start under launchd

Symptom: `plist.sh status` shows `loaded=false` or `pid=none`. `launchctl print gui/$UID/com.gosleep.core`
prints a failure reason.

Fix in order:

1. Tail `data/logs/core.err.log` — a startup crash prints the reason on the first line.
2. Check for a leftover process on 7331: `lsof -nP -iTCP:7331 -sTCP:LISTEN` — kill it if
   present (`kill <pid>`), then re-bootstrap.
3. Re-run `bun install` at the repo root — a missing dependency will crash on `import`.
4. If bootstrap succeeds but `healthz` still fails, run manually to see the error:
   `bun run --filter='@gosleep/core' dev`.

## 7. Security layers (short recap; details in the target architecture)

Every non-`/healthz` request goes through, in order:

1. **`applySecurityHeaders`** (GSL-269) — stamps CSP, `X-Content-Type-Options: nosniff`,
   `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` on every response including
   rejections.
2. **`requireLocalHost`** — Host header must equal `127.0.0.1:7331`; DNS-rebound → 421.
3. **`requireLocalOrigin`** — safe methods (GET/HEAD/OPTIONS) bypass; POST + friends need
   a matching Origin (or Referer) header pointing at `http://127.0.0.1:7331`.
4. **`requireBearer`** — Bearer token from Keychain, constant-time compare; missing/wrong →
   401, Keychain unreachable → 503.
5. **TouchID gate** — only on high-blast writes (publish skill, etc.); prompt via
   `touchid-gate.app`, TTY fallback via `tty-confirm.sh`.

Rebuilding + rotating the touchid-gate signed `.app`: see the rev-3 addendum Delta 4 note.

## 8. Web question-loop pilot (GSL-267 — guarded, opt-in)

**Status.** As of 2026-08-10 the project's `.claude/settings.json` wires two hook events
into the gosleep-core answer loop:

- `PreToolUse[matcher:"AskUserQuestion"]` → `tools/hooks/ask-user-question-hook.sh`
  (body: GSL-275).
- `PermissionRequest[matcher:".*"]` → `tools/hooks/permission-request-hook.sh` (body:
  GSL-284, real-event wiring by GSL-304). NOTE: `PermissionRequest` is a **dedicated
  top-level event** — a peer of `PreToolUse`, not a matcher value on it. The matcher
  matches `tool_name`, so `.*` intercepts every prompting tool. The earlier
  `PreToolUse[matcher:"PermissionRequest"]` wiring (GSL-284, GSL-297 evidence) never
  fired: no tool is literally named `PermissionRequest`. See
  `docs/reports/verifications/GSL-304/runs/01/` for the real-session allow + deny +
  AskUserQuestion regression proof.

Both shims are **guarded**: the very first executable line is
`[ "${GOSLEEP_WEB_QUESTIONS:-0}" = "1" ] || exit 0`. Every `claude` session started
without that flag hits the matcher and exits 0 in ~400 ms — the TUI dialog renders as
today, nothing lands in the DB, no long-poll starts. The owner's phone/panel see traffic
**only** from sessions started with the flag.

### Opt a session INTO the pilot

```bash
# The core must be up (see § 1-2). GOSLEEP_INTERNAL_SECRET must match what the core
# has in its env — for a launchd-managed core, put it in the plist and reload once;
# for a foreground core, just export it in both shells.
export GOSLEEP_WEB_QUESTIONS=1
export GOSLEEP_INTERNAL_SECRET='…same secret the running core has…'
# Optional: tune the long-poll cap the shim sends to the core (default 600 s;
# the settings.json hook timeout is 3600 s = the day-window ceiling).
# export GOSLEEP_HOOK_TIMEOUT_S=3600
# export GOSLEEP_HOOK_DEBUG_LOG=/tmp/gosleep-hook-debug.jsonl

claude   # any model, any prompt. AskUserQuestion / PermissionRequest now route
         # to the web panel instead of the TUI dialog.
```

Answer a pending question from the web (or by hand — this is what the Answer button
does under the hood):

```bash
BEARER="$(security find-generic-password -s gosleep-web -a "$USER" -w)"
# BEARER is stored as b64v1:<base64> — decode:
BEARER="$(echo -n "${BEARER#b64v1:}" | base64 -d)"
curl -sS -X POST http://127.0.0.1:7331/actions/questions/answer \
    -H "Host: 127.0.0.1:7331" \
    -H "Origin: http://127.0.0.1:7331" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $BEARER" \
    -d '{"qid":"q-…","answer":"…","by":"owner","channel":"web"}'
```

Decide a permission the same way against `POST /actions/permissions/decide` with
`{qid,decision:"allow"|"deny",updated_message?:"…"}`.

### Control paths (verified 2026-08-08 pilot)

- **Session with the flag — AskUserQuestion:** shim POSTs to
  `/internal/questions/post` → row lands in `questions` (kind=`BLOCKER`, qid `q-…`)
  and is visible via `GET /questions` → owner (or curl) POSTs
  `/actions/questions/answer` → shim's long-poll releases within ~ms → shim emits
  `hookSpecificOutput.permissionDecision="allow"` + `updatedInput.answers` → agent
  continues with the injected answer. TUI dialog never rendered.
- **Session with the flag — PermissionRequest (GSL-304):** the real event fires when
  CC would otherwise render the permission modal; shim POSTs to
  `/internal/permissions/post` → row lands (kind=`permission`, qid `p-…`) → owner or
  curl POSTs `/actions/permissions/decide` → shim's long-poll releases → shim emits
  `hookSpecificOutput.decision.behavior="allow"|"deny"` (the CC-documented shape
  for `PermissionRequest`, distinct from `PreToolUse`'s `permissionDecision`) → CC
  applies the decision. NOTE: CC's TUI modal renders briefly WHILE the shim is
  long-polling, then is superseded when the shim returns (agent sees
  "Allowed by PermissionRequest hook" / "Denied by PermissionRequest hook"). The
  optional `updated_message` on a deny lands in the DB `applied` column for audit,
  but CC 2.1.226 does not surface a per-decision `reason` string to the model —
  the deny itself is honored either way. Real-session evidence:
  `docs/reports/verifications/GSL-304/runs/01/assets/v1-perm-*` +
  `v2-perm-*`.
- **Session without the flag:** matcher fires, guard returns `exit 0` in <500 ms,
  TUI dialog renders as today, DB has no row, `/questions` unchanged.

### Widen to all sessions later

Only on an owner command. Widening = flipping the shim guard to opt-out
(`GOSLEEP_WEB_QUESTIONS=0` disables; anything else enables) OR removing the guard
entirely and requiring every session to set the flag off explicitly. The current
opt-in shape is the pilot only.

**Widening-gate note (GSL-302, 2026-08-09 — feature-complete → dogfooding).** The
web control plane is declared feature-complete on the landing of
`docs/reports/verifications/GSL-297/runs/01/index.html` (see PRD "Acceptance
criteria + end-check" for the trigger). Widening interception to ALL sessions is
the explicit next owner-gated step (decision `d-2026-08-09-001`). To widen: in the
parent shell that spawns every `claude` — the user's login shell, or the tmux
session the owner uses for supervised work — export both `GOSLEEP_WEB_QUESTIONS=1`
and `GOSLEEP_INTERNAL_SECRET=<same value the running core sees>` so every child
inherits them. Do NOT edit the project `.claude/settings.json` — it is frozen per
handoff 57 (the hook stanza is already wired; only the shim's env guard needs to
flip). Rollback is symmetric: `unset GOSLEEP_WEB_QUESTIONS` (or set it to `0`) in
the parent shell, then start a fresh `claude` — the guard exits 0 in <500 ms and
the TUI dialog renders as it did before. In-flight sessions keep whatever env they
were spawned with; no forced restart is required. When ready, add a widening-day
entry to `docs/lab/decisions/log.jsonl` so the audit trail records who flipped
which shell when.

**Shim peek robustness (GSL-386).** The compound-OR fast-path extracts
`session_id` from the first 64 KiB of stdin (was 4 KiB — widened for future
payload preamble growth). The extractor is `grep -o -m 1 -E` (portable
first-match on BSD + GNU) piped into a `sed` unwrap; the older greedy
`sed -E` regex is gone. An empty sid on a non-empty stdin now emits a
`peek_miss` JSON breadcrumb via `GOSLEEP_HOOK_DEBUG_LOG`. Assertions:
`tools/lab/tests/shim-control-gate.sh` S6 (sid past byte 4096 within the
64 KiB cap) and S7 (first-match anchor picks the real sid before a raw
literal imposter in `tool_input`).

**Runtime toggle reframing (GSL-361, 2026-08-16 — observer mode phase B).** The
shim guard is no longer an env-flag-only fast-exit; it is a compound-OR gate:
`proceed = (GOSLEEP_WEB_QUESTIONS=1) OR (core /internal/sessions/:sid/control ==
'controlled')`. The runtime side of the OR is fed by two write endpoints —
`POST /actions/sessions/:id/take-control` and `.../release-control` — the panel's
Fleet + Observed cards fire on the owner's click, and the shim consults the state
on every invocation with a 1 s in-process cache. `d-2026-08-08-001` ("widening
interception is an owner-gated act") is REFRAMED, not violated: pressing the
Take-control button IS the owner command; the surface simply moved from a
launch-time env export to a per-session runtime click. The env-flag path stays
wired as the legacy bootstrap + outage fallback — an env-locked session (started
with `GOSLEEP_WEB_QUESTIONS=1`) renders in the panel with a distinct pill and no
Release button (releasing an env-locked session requires restarting it in a shell
without the flag). Core-unreachable falls back to env-flag-only (binding decision:
never fail-open into interception). Sub-second cutover on release is bounded by
the shim cache TTL. Full acceptance spec in `docs/prd/09-phase15-observer-mode-runtime-control.md`.

### Rollback

`git revert` of the commit that added the `PreToolUse` + `PermissionRequest` blocks
in `.claude/settings.json` is enough — the file watcher unloads the matchers live,
sessions in-flight fall back to the TUI on the next question or permission prompt.
Nothing in `data/` needs cleaning up.

## 8.5. /setup Bearer discovery (GSL-291 — browser-native, no devtools)

Getting the Bearer into a browser without hand-editing sessionStorage:

```bash
# On the host, in a shell where GOSLEEP_INTERNAL_SECRET is exported (the SAME value the
# running core sees — see § 8 for the pilot pattern):
bash apps/core/plist.sh setup-url
#    → prints:
#      # Setup URL — paste into your browser. Single-use, expires at 2026-08-08T…Z.
#      http://127.0.0.1:7331/setup?tok=<64-hex-otp>
```

Paste the URL into any browser on the loopback (including mobile Safari when the phone is
tunnelled to the host). The `/setup` route:

1. Consumes the OTP (single-use, 5-minute default TTL, clamped to `[30, 3600]` seconds via
   the optional `GOSLEEP_SETUP_TTL_S` env on `plist.sh setup-url`).
2. Reads the Bearer from the standard chain (dev-env → Keychain → token-file).
3. Returns the SPA shell with `<meta name="gosleep-token" content="<Bearer>">` in `<head>`.
4. The SPA (`apps/web/src/data/auth.ts`) reads the meta at boot, stashes the Bearer in
   `sessionStorage['gosleep.token']`, and removes the meta tag from the DOM.

The Bearer never appears in the URL bar, browser history, or `Referer`. A refresh does NOT
re-run setup (the OTP is used); the owner opens a fresh URL. Second visit to the same URL
returns 400 with an explicit diagnostic page.

If the core has no `GOSLEEP_INTERNAL_SECRET`, `/internal/setup/otp` returns 503 (fail-safe)
and `plist.sh setup-url` prints a pre-flight message pointing at this section.

## 9. Channels v1.1 plugin (GSL-282 — dev-flag gated, opt-in per session)

`packages/gosleep-channel/` is a Bun MCP server that publishes the
`claude/channel/permission` capability so Claude Code can relay `PermissionRequest`
decisions from the owner's phone back into the local session. The plugin also owns
the owner-steer path (channel messages delivered at the session's NEXT turn boundary;
never mid-turn — the fundamental limit of channels).

**Scope reminder** (from rev-3 addendum Delta 2):
- Covers tool-use approvals only (`Bash`, `Write`, `Edit`). NEVER `AskUserQuestion` —
  that dialog stays on the hook path from GSL-275 because it must unblock mid-turn,
  which channels physically cannot do.
- v1 does not touch channels. This plugin lives to v1.1 and stays behind the dev flag
  until Anthropic curates the channel allowlist.

**Double guard — both switches MUST be set, otherwise the plugin is inert:**

1. **Session flag** — Claude Code launched with `--dangerously-load-development-channels`.
   Enforced by Claude Code itself. Every session start shows a **full-screen consent
   dialog** the owner must dismiss by hand. This is honest friction; the flag name is
   deliberate.
2. **Environment guard** — `GOSLEEP_ENABLE_CHANNELS=1` in the plugin process env.
   Enforced by `packages/gosleep-channel/src/bin/gosleep-channel.ts`. Without it the
   bin exits `0` immediately, writes a one-line breadcrumb to stderr, and never
   touches stdout (which would poison the JSON-RPC transport).

Neither switch alone is enough. This second layer is why a `--dangerously-load-development-channels`
sitting in a shell history cannot accidentally expose the channel to an unrelated
worker session.

### Enabling in a supervised interactive session (do NOT wire into settings.json)

```bash
env GOSLEEP_ENABLE_CHANNELS=1 \
    GOSLEEP_INTERNAL_SECRET="$(security find-generic-password -a "$USER" -s gosleep-web -w \
                               | sed 's/^b64v1://' | base64 -d)" \
  claude --dangerously-load-development-channels \
         --channels 'gosleep=@gosleep/channel'
```

The plugin then:
1. Handles `notifications/claude/channel/permission_request` by POSTing to
   `POST /internal/permission-relay` — the row lands in `questions` with
   `kind='permission'`, exactly the same shape the hook path uses (GSL-284).
2. Long-polls `GET /internal/permissions/:qid/decision-wait` for the owner's
   Allow/Deny click (from the web UI or a future phone client).
3. Replies to Claude Code with `notifications/claude/channel/permission {allow|deny}`
   over the same channel; the local TUI dialog auto-closes with the same decision.

Whichever answer arrives first — hook or channel — wins. Both write to the same
`qid` row (`INSERT OR IGNORE` deduplicates).

### Rollback

Skip the flag on subsequent session starts. The plugin becomes inert immediately;
nothing under `data/` needs cleaning; existing rows keep working through the hook
path.

## 10. Skills publishing (`publish.sh` — GSL-254 / GSL-306)

`tools/skills/publish.sh` is the ONLY sanctioned path from a development copy under
`skill/<name>/` to the production copy at `~/.claude/skills/<name>/`. It performs
`rsync --delete` scoped to ONE named skill, keeps a pre-rsync backup under
`docs/skills/backups/`, and folds a `docs/skills/CHANGELOG.jsonl` row into the
`skills` table via `apps/core/scripts/record-publish.ts`.

**The DB must be migrated BEFORE `publish.sh` runs.** The last step of the flow
folds the CHANGELOG row into the `skills` table; a missing table would leave a
half-published state (rsync landed, JSONL row appended, DB fold failed).
`publish.sh` now runs a read-only preflight (`record-publish.ts check`) that aborts
early with `rc=1` and no filesystem mutation if the `skills` table is absent.

The launchd-managed core (section 1) migrates the DB at boot, so the endpoint path
(`POST /actions/skills/publish`, which spawns `publish.sh` with a per-request
`GOSLEEP_WEB_TOKEN` nonce) is always safe. **Standalone or dev use on a fresh
checkout must migrate first:**

```bash
bun run apps/core/scripts/migrate.ts   # creates data/gosleep.db + all tables
bash tools/skills/publish.sh <name>    # then publish; preflight passes
```

Assert the guard with `bash tools/skills/tests/preflight-smoke.sh` — it points
`publish.sh` at an empty scratch DB and confirms the early-fail path leaves the
backups dir + CHANGELOG.jsonl + production skill dir untouched.

**TouchID physical-gesture gate (GSL-288 — WIRED but DEFAULT-OFF as of
2026-08-16).** `publish.sh` contains the invocation of
`apps/core/bin/touchid-gate.app` behind an explicit opt-in flag. **Status
today: OFF.** Per the owner ruling on 2026-08-16, TouchID is deferred until
after the harness+web program; daily publish flows go through the pre-GSL-288
owner-gate (interactive TTY prompt, or `GOSLEEP_WEB_TOKEN` env-nonce from the
web endpoint) and are never blocked by biometrics. The `publish.sh` block
around the gate is a documented inert stub with the flag off — it prints one
breadcrumb line (`touchid gate: OFF (stub; owner-deferred 2026-08-16; opt in
with GOSLEEP_TOUCHID=1)`) and then hands control to the existing TTY-confirm
fallback exactly as before.

**How to enable the gate later** (a deliberate owner step, tied to GSL-266
activation — do NOT flip this without an explicit owner directive):

1. Build the signed `.app` bundle:
   `bash apps/core/scripts/build-touchid-gate.sh` (rev-3 addendum Delta 4).
2. Wire `GOSLEEP_TOUCHID=1` into the launchd plist
   `apps/core/plist/com.gosleep.core.plist` `EnvironmentVariables` dict AND
   into the endpoint spawner `apps/core/src/actions/publish.ts` env
   pass-through — neither sets it today, so the launchd-managed core enters
   the block with the flag off.
3. For a bare `publish.sh` invocation, prefix with `GOSLEEP_TOUCHID=1 bash
   tools/skills/publish.sh <name>` — the gate becomes active for that call.

**Exit-code contract when the gate IS active** (matches
`apps/core/bin/touchid-gate.swift`):

- `0` — owner tapped TouchID / Face ID → publish proceeds; the TTY prompt is
  skipped.
- `1` — owner cancelled or biometric failed → `publish.sh` exits 3 (owner
  refused).
- `2` — sensor unavailable → falls back to the `/dev/tty` `type 'yes'`
  prompt when a TTY is available; refuses hard when spawned from the web
  endpoint (no TTY, no sensor).
- `3` — LocalAuthentication framework error → `publish.sh` exits 3.

**Test-only env overrides** (NEVER set in the launchd plist or any worker
spawn that talks to the real global tree; only active when the opt-in flag
is also set):

- `GOSLEEP_TOUCHID_GATE_BIN` — override the gate binary path. Used by
  `tools/skills/tests/touchid-gate-smoke.sh` with a mock that returns a
  chosen exit code without touching LocalAuthentication.
- `GOSLEEP_TOUCHID_BYPASS=1` — skip the gate under opt-in. **Fail-closed
  against production paths** via realpath normalization (GSL-385):
  refuses (exit 3) unless BOTH `GOSLEEP_SKILLS_PROD_DIR` and
  `GOSLEEP_SKILLS_BACKUPS_DIR` are set AND, after resolution to physical
  paths, both sit outside the real prod tree AND outside the real
  backups tree. The guard is no longer a textual `case`: it uses
  `realpath -q` (with a manual walk-up for paths that do not yet exist),
  compares device+inode identity in addition to lowercase text on
  case-insensitive volumes (APFS/HFS+), and anchors `$HOME`
  independently of the environment (via `dscl` on macOS / `getent` on
  Linux) so a caller cannot rewrite `HOME=/decoy` to slip past. The
  forbidden anchors themselves are realpath-resolved at guard entry, so
  a symlinked anchor cannot mismatch either. All six defeat classes
  from the GSL-288 verifier report (symlink, uppercase-on-CI,
  relative-symlink, HOME rewrite, `../` traversal, backups symlink) now
  refuse.
- `GOSLEEP_TOUCHID_ANCHOR_HOME` / `GOSLEEP_TOUCHID_ANCHOR_REPO` —
  **test-only** anchor overrides for `touchid-gate-smoke.sh`. Steer the
  guard's "real HOME" and "real REPO_ROOT" at a hermetic decoy fixture
  so the six defeat classes can be demonstrated without ever touching
  the real `~/.claude` tree. NEVER set in the launchd plist or the web
  endpoint spawner — production leaves them unset and the guard falls
  back to dscl/getent + the script's own `REPO_ROOT`.

Assert the wiring with `bash tools/skills/tests/touchid-gate-smoke.sh` —
17 invariants: the default-off inert-stub path (E1), the four opt-in
exit-code paths (C1–C4), two bypass-guard sanity branches (D1 refuse
without hermetic overrides, D2 accept with hermetic overrides), the six
defeat classes against a hermetic decoy home (D3 symlink, D4 uppercase
on APFS-CI, D5 relative-path symlink, D6 HOME rewrite, D7 `../`
traversal, D8 backups symlink), and four leak-check cross-assertions
(decoy prod tree + decoy backups tree unchanged; real prod tree + real
backups tree mtime unchanged). All defeat demonstrations run against
the decoy — the real `~/.claude/skills` and `docs/skills/backups` trees
are only stat'd once at start/end as belt-and-braces leak checks. The
gate binary is a mock returning a chosen exit code without touching
LocalAuthentication, so the smoke never triggers a real biometric
dialog.

## 11. Standing rules for agents touching this engine

- **SQLite is the source of truth** — JSONL under `docs/lab/` is a historical archive as of
  target-architecture step 8. Write actions go via `POST /actions/*` (which spawns the
  right lab-emit CLI + updates the DB row); never `git add data/*.db`.
- **The engine is stopped via `launchctl bootout` ONLY on the owner's explicit command.**
  A worker who bounces the engine mid-shift breaks the phone panel the owner is reading.
- **The Preact-SSG site under `docs/lab/site/`** is deprecated as of GSL-270. Owner reads
  live data from the panel, not those `.html` files. `GOSLEEP_KEEP_STATIC_SITE=1` rolls
  back to SSG regeneration.
- **The channels plugin is dev-flag gated (GSL-282).** Never wire
  `--dangerously-load-development-channels` or `GOSLEEP_ENABLE_CHANNELS=1` into a
  worker spawn or into `.claude/settings.json`. It is an owner-supervised interactive
  path only.
