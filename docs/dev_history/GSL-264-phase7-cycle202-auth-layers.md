# GSL-264 — Layered authentication: Keychain hardening + TouchID .app bundle + TTY-confirm fallback

**Date:** 2026-08-07 · **Epic:** GSL-250 (interactive control plane) · **Branch:** `GSL-250-control-plane`
**Task:** Auth-layers slice of GSL-264. Scope = target-architecture §7 (Приоритет 1 & 2) + rev-3 addendum Delta 4 (TouchID = signed `.app`) + Delta 5 (Keychain ACL, Tahoe 26.x guard, 5 s timeout → 503, per-boot audit line). Broader GSL-264 items (idempotency-jsonl, withTimeline, /setup token flow, CSP) remain open for a later slice under the same task key.

## What was done

Six pieces landed together, all wired to the same fallback-chain policy that never silently degrades:

1. **`apps/core/src/security/keychain.ts`** — rewritten. It still shells out to `security find-generic-password -w`, but now:
   - Detects macOS Tahoe 26.x via `apps/core/src/security/platform.ts` (`os.release()` first, `sw_vers -productVersion` as a corroborating second signal — this Mac reports Darwin 25.5.0 but productVersion 26.5, so the `startsWith("26.")` branch is what actually catches Tahoe here). On Tahoe the configured `GOSLEEP_KEYCHAIN_TIMEOUT_MS` is floored to 5000 regardless of a lower override, per Delta 5.
   - Decodes Base64-encoded secrets (`b64v1:<b64>` prefix) via the new `apps/core/src/security/tokenEncoding.ts`. Round-trip integrity is strict — corrupted or truncated Base64 returns `null` (which the caller translates to 503, never to unauth). Non-prefixed values pass through verbatim so an operator can hand-set a plain-text token during a rescue.
   - Returns a structured `KeychainReadResult` (`{secret, reason, timeoutMs, exitCode}`) so the auth-source layer can name WHY a read failed in the audit line (`no-account`, `timeout`, `exit-nonzero`, `decode-failed`, `spawn-error`, `empty`, `ok`, `dev-bypass`). The old thin `readBearerFromKeychain()` string-or-null helper stays for the bearer middleware's hot path.

2. **`apps/core/src/security/authSource.ts`** (new) — the ONE place that owns the Delta-5 fallback chain: dev-env → Keychain → `GOSLEEP_TOKEN_PATH` file → nothing. There is no invented default path; the token-file rung ONLY fires if the operator explicitly set the env. If Keychain fails and no file is configured, `source='none'`, `secret=null`, and every protected route returns 503 — this is the gh-CLI silent-unauth regression (`cli/cli/issues/13317`) we do not repeat. The module also owns `writeAuthSourceAudit(db)`: one JSON line to stderr on every boot, PLUS one `events` row `type='security.auth-source-audit'` when uptime < 5 min (or when `GOSLEEP_AUDIT_ALWAYS=1` for tests) — so the web timeline shows the effective auth source at boot and the owner can verify by eye it is really Keychain, not a plaintext file that leaked in during dev.

3. **`apps/core/src/security/bearer.ts`** — refactored to use `resolveAuthSource()` instead of calling Keychain directly. Same 401/503 semantics, but the fallback chain is now uniform across every request.

4. **`apps/core/bin/touchid-gate.app`** — built for real. `apps/core/scripts/build-touchid-gate.sh` compiles `bin/touchid-gate.swift` with `swiftc -O -target arm64-apple-macos13 -framework LocalAuthentication`, wraps it in `Contents/MacOS/touchid-gate` + `Contents/Info.plist` (CFBundleIdentifier=com.gosleep.touchid-gate, LSUIElement=true so no Dock icon, NSFaceIDUsageDescription set for Face ID hosts), then ad-hoc codesigns with `codesign --sign - --identifier com.gosleep.touchid-gate --entitlements ... --options runtime --deep --force`. `codesign --verify --strict` passes; `codesign -dv` confirms `Signature=adhoc`, `Format=app bundle with Mach-O thin (arm64)`. `apps/core/install-deps.sh` now invokes the build unless `--check-only`.

5. **`apps/core/bin/tty-confirm.sh`** — the §7.3 Priority-1 fallback for MacBook Airs / SSH corners with no biometric sensor. Prints the prompt to the OWNER'S `/dev/tty` (never stdin — an agent's stdin is a pipe from Claude Code, would satisfy the prompt on its own), reads y/N with a bash `read -t` timeout, exits: 0=approved, 1=denied, 2=no-controlling-tty (pipe context — caller MUST refuse the write), 3=timeout. The no-tty detection deliberately uses `: < /dev/tty` as an actual open-test — the `[ -c /dev/tty ]` file test returns true even for pipe-context children.

6. **`apps/core/plist.sh`** — reworked. `install` now:
   - Replaces the old dev-friendly `-A` (allow-all-callers) with `-T <bun-binary> -T <plist.sh>` per Delta 5 — only the bun that runs the core AND this installer script can retrieve the secret without a user prompt. Every other caller under the same UID gets the standard Keychain consent dialog (agents in pipe context cannot answer it).
   - Encodes the secret as `b64v1:<base64>` before storing (matching what `tokenEncoding.ts` decodes), so on Tahoe the on-disk shape is ASCII-safe and dodges the `security -w` HEX regression.
   - Runs a round-trip verify: writes, reads back, byte-compares, dies loudly if mismatched. Prevents an ACL misconfiguration from getting past install unnoticed.
   - Detects Tahoe via `sw_vers -productVersion` and prints an operator note when it fires.
   - Adds a new `plist.sh rotate-secret [--secret ENV]` command for periodic rotation without touching launchd.

Tests:

- **`apps/core/test/tokenEncoding.test.ts`** — 11 cases covering round-trip (ASCII, UTF-8 with emoji, long shape), refusal of empty input, and every strict-integrity branch of `decodeSecret` (empty body, invalid alphabet, wrong padding, round-trip mismatch, all-padding decoding to zero bytes, unprefixed rescue-mode plain).
- **`apps/core/test/authSource.test.ts`** — 10 cases covering the full chain: dev-env wins, no-keychain + no-file → source='none', token-file used when Keychain unreachable, token-file may itself be `b64v1:`, empty/missing/corrupt token-files → 'none' (never a silent fallback), Tahoe timeout floor at 5000 on override=26 vs a lower configured value, non-Tahoe respects a lower configured timeout, and the stderr audit line JSON has the expected shape.
- **`tools/lab/tests/keychain-roundtrip.sh`** — live-macOS integration test. Creates a Keychain item under service `gosleep-test-roundtrip-<pid>` (per-run unique, refuses to run if the item exists — defense-in-depth), reads it back through the `security` CLI, then round-trips the decoded value through the actual TS `decodeSecret()` (via a one-shot `bun -e` snippet), also asserts the missing-item and Tahoe-timeout branches of `readKeychainSecret`, then DELETES the item (trap on EXIT/INT/TERM ensures cleanup even on error). NEVER touches `gosleep-web` or any pre-existing item.

**Smoke rule updated:** `tools/lab/smoke.sh` §GSL-260 rule 2 whitelist now includes `apps/core/bin/*.sh` alongside `apps/core/scripts/*.sh` — `tty-confirm.sh` sits next to `touchid-gate.app` in the `bin/` layer per architecture §Delta 4. The rationale + updated comment are inline in smoke.sh; the rule still refuses stray spawner shells anywhere else under `apps/`/`packages/`.

## Problems solved

- **Tahoe 26.x detection when Darwin kernel version disagrees with product version.** This Mac reports `os.release()="25.5.0"` (Darwin 25 = Sequoia's kernel) but `sw_vers -productVersion="26.5"` (macOS 26.5 Tahoe). The single-signal detectors I first sketched (Darwin major only) would have missed it. `getPlatformInfo()` now returns `isTahoe: darwinMajor >= 26 || productVersion?.startsWith("26.")` — OR, not AND. Verified live via `bun -e "console.log(getPlatformInfo())"` on this box; got `{darwinMajor:25, productVersion:"26.5", isTahoe:true}`. The 5-second timeout floor fires correctly.
- **Live Keychain round-trip proves the ACL grant works end-to-end.** The integration test creates the item with `-T <bun> -T <security>`, then reads it back via `security` — no consent prompt appears, so both callers ARE in the ACL. The Base64 shape survives Keychain storage unchanged. `readKeychainSecret()` decodes it via the same TS code the server uses.
- **`tty-confirm.sh` correctly detects "no controlling TTY".** First draft used `[ -c /dev/tty ]` which returns true even in a pipe context because /dev/tty is always a character device; the actual difference is whether the process can OPEN it. Switched to `: < /dev/tty` probe; verified `exit=2` in this shell (no controlling TTY) and `exit=2` on the usage-missing branch. In a real interactive session the read prompt reaches the owner.
- **Fallback chain unit tests needed lazy env reads.** Old `config.ts` frozen module-level constants (`DEV_BEARER_TOKEN = process.env.… ?? ""`) captured env at import time; tests that swap env between cases would see stale values because ESM URL cache-busting doesn't cascade to sub-imports. Refactored the five security-related knobs (`getDevBearerToken`, `getTokenFilePath`, `getKeychainService`, `getKeychainAccount`, `getKeychainTimeoutMs`) into functions that read env at call time. Non-security config (HOST, PORT, HOST_HEADER, SERVER_VERSION, OWNER_NAME) stays as const — those are set once at process launch.

## Problems remaining

- **Owner biometric acceptance is still OWNER-VERIFY.** Automation intentionally does NOT trigger the LAContext prompt (we would need the owner's finger on the sensor). What IS proven: bundle exists, codesign --verify passes, the Mach-O links LocalAuthentication.framework, the entitlements plist is attached to the bundle identity. What remains OWNER-VERIFY: `open -W -a apps/core/bin/touchid-gate.app` produces the biometric prompt, exit code 0 on approved / 1 on cancelled. On a MacBook Air with no biometric sensor the same call is expected to exit 2, which we cannot dry-run here without physically running on such hardware.
- **The rest of GSL-264 is intentionally deferred.** The Jira description covers idempotency-jsonl (persistent map surviving `launchctl reload`), `withTimeline` (spawn wrapper writing intent/outcome to events with actor='web'), the `/setup?tok=<one-time-secret>` bootstrap flow, and CSP headers on served HTML. This slice covered the auth-layer stack only; the remaining items are commit-sized siblings that can land in follow-up commits under GSL-264 or be split into new sibling tasks per the epic split convention.

## Pitfalls & workarounds

- **`security add-generic-password -T <path>` requires the FULL, resolved path** to each binary you want in the ACL. `plist.sh` resolves `bun` via `command -v` (dereferences PATH) and computes its own full path via `cd + basename`. If either path is symlinked and later moved, the ACL grant to that stale path is dead and the reader would fall through to the interactive Keychain prompt (fatal for launchd). Rotation is `plist.sh rotate-secret` — do that after any bun upgrade that moves the binary.
- **`codesign --deep --force` is what makes the ad-hoc signature agree with the bundle identity** we set in Info.plist. Without `--force`, `security` refuses to sign an already-signed bundle; without `--deep`, nested resources inside `Contents/` end up unsigned. The build script always cleans the bundle first (`rm -rf`) so we never build on top of a stale signature.
- **`GOSLEEP_PLATFORM_OVERRIDE` is a TEST seam only.** Setting it to "26" in a real deployment would force the 5-second Tahoe floor on a Sequoia host — harmless (only affects the timeout ceiling upward) but noisy. Removed from any production launchd env.
- **The audit event insert is best-effort — a DB failure at boot cannot kill the audit line.** Wrapped in try/catch; on failure a second stderr line names the failure. The primary record of truth is always the stderr JSON — the DB row is for the UI timeline (nice-to-have).
- **NEVER touch pre-existing Keychain items.** The integration test uses a per-run service name `gosleep-test-roundtrip-<pid>` and refuses to start if that exact name already has an entry (defense-in-depth). It cannot ever affect `gosleep-web`.

## What didn't make it

- **Reading LSMinimumSystemVersion from a config file.** Hardcoded to 13.0 in `Info.plist.tmpl`; a future task can pull this from a shared build-config if we start supporting older macOS.
- **Signing with a real Developer ID.** Ad-hoc is what Delta 4 spec'd; if the owner wants a distribution-signed bundle later, the same script can take `--identity "Developer ID Application: …"` in place of `-s -`.
- **Full integration with `/setup?tok=<one-time-secret>` flow.** That belongs with the web-UI-side of GSL-264 (setup HTML page + sessionStorage handshake). Deferred to a subsequent slice.
- **Automated biometric-prompt verification.** By design — see "Problems remaining" above.

---

## Technical reference

- **Commit SHA:** _(filled in by chronicler on commit)_
- **Files touched (new):**
  - `apps/core/src/security/platform.ts`
  - `apps/core/src/security/tokenEncoding.ts`
  - `apps/core/src/security/authSource.ts`
  - `apps/core/bin/touchid-gate.Info.plist.tmpl`
  - `apps/core/bin/touchid-gate.entitlements.plist`
  - `apps/core/bin/tty-confirm.sh`
  - `apps/core/scripts/build-touchid-gate.sh`
  - `apps/core/test/tokenEncoding.test.ts`
  - `apps/core/test/authSource.test.ts`
  - `tools/lab/tests/keychain-roundtrip.sh`
- **Files touched (modified):**
  - `apps/core/src/security/keychain.ts` — Tahoe floor + Base64 decode + `KeychainReadResult`.
  - `apps/core/src/security/bearer.ts` — uses `resolveAuthSource()`.
  - `apps/core/src/config.ts` — five security getters replace frozen constants.
  - `apps/core/src/serve.ts` — calls `writeAuthSourceAudit(db)` at boot before reconcile.
  - `apps/core/plist.sh` — `-T` ACL, Base64 encoding, round-trip verify, `rotate-secret` command.
  - `apps/core/install-deps.sh` — invokes `scripts/build-touchid-gate.sh` unless `--check-only`.
  - `tools/lab/smoke.sh` — GSL-260 rule 2 whitelist adds `apps/core/bin/*.sh`.
- **Verified by running:**
  - `bun x tsc -p apps/core --noEmit` — clean.
  - `cd apps/core && bun test` — 31/31 pass (11 new tokenEncoding + 10 new authSource + 10 pre-existing indexer/SSE).
  - `bash tools/lab/tests/core-smoke.sh` — 12/12 pass; port 7331 clean after teardown.
  - `bash tools/lab/tests/keychain-roundtrip.sh` — 8/8 pass; Base64 SHA matches, Tahoe floor at 5000ms confirmed live on this Mac (isTahoe=true).
  - `bash tools/lab/gate.sh --offline` — VERDICT green; smoke 551/551, hooks-verify 11/11, tsc + chronicler clean.
  - `bash apps/core/scripts/build-touchid-gate.sh` — bundle built + ad-hoc signed; `codesign --verify --strict` passes; `otool -L` confirms LocalAuthentication.framework linked; entitlements plist attached to identifier `com.gosleep.touchid-gate`.
  - `bash apps/core/bin/tty-confirm.sh` (no args) → exit 2 (usage); with args in pipe context → exit 2 (no controlling TTY). Interactive TTY branch is OWNER-VERIFY.
- **Links:** Jira [GSL-264](https://ainstance-labs.atlassian.net/browse/GSL-264) · GH [ainstance-labs/gosleep#274](https://github.com/ainstance-labs/gosleep/issues/274) · Architecture §7, addendum §Delta 4 + Delta 5.

## OWNER-VERIFY (manual, needs owner's finger or specific hardware)

1. `bash apps/core/scripts/build-touchid-gate.sh --check` should print `bundle verified`.
2. `open -W -a apps/core/bin/touchid-gate.app` → biometric prompt appears → owner approves → exit code 0. Owner cancels → exit code 1.
3. On a MacBook Air with no biometric sensor: same open call should exit 2 (no policy available), and `bash apps/core/bin/tty-confirm.sh "Publish skill using-jira"` in an interactive terminal should render the prompt on `/dev/tty` and honour y/N.
4. `apps/core/plist.sh install` end-to-end on the real Keychain: item created with -T ACL, healthz answers, `plist.sh status` reports `{loaded:1, healthz:1}`, then `plist.sh rotate-secret` replaces the item without disturbing launchd.
5. Boot the core via launchd (uptime < 5 min at process start) — inspect `data/logs/core-stderr.log` for one `core.security.auth-source-audit` JSON line, AND query the events table for a `security.auth-source-audit` row.
