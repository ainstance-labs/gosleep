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

## 8. Standing rules for agents touching this engine

- **SQLite is the source of truth** — JSONL under `docs/lab/` is a historical archive as of
  target-architecture step 8. Write actions go via `POST /actions/*` (which spawns the
  right lab-emit CLI + updates the DB row); never `git add data/*.db`.
- **The engine is stopped via `launchctl bootout` ONLY on the owner's explicit command.**
  A worker who bounces the engine mid-shift breaks the phone panel the owner is reading.
- **The Preact-SSG site under `docs/lab/site/`** is deprecated as of GSL-270. Owner reads
  live data from the panel, not those `.html` files. `GOSLEEP_KEEP_STATIC_SITE=1` rolls
  back to SSG regeneration.
