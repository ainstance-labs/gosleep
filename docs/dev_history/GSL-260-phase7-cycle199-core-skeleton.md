# GSL-260 — Web control plane: apps/core skeleton (Bun + Hono 4, three read endpoints)

**Date:** 2026-08-07 · **Epic:** GSL-250 (interactive control plane) · **Branch:** `GSL-250-control-plane`
**Task:** Step 3 (part 2) of the migration plan in `docs/reports/web-harness-research-2026-08-03/target-architecture.md` section 9; scaffold laid out in sections 3.2, 3.3, and 7.

## What was done

`apps/core/` now houses `@gosleep/core` — a Bun 1.3.10 + Hono 4 process that binds
`127.0.0.1:7331` and answers the three v1 read endpoints from the Jira description:
`GET /healthz` (public, always 200), `GET /version` (Bearer-required, reports
`server_version` + `api_versions` + `db_schema_version`), and `GET /whoami`
(Bearer-required, reports the owner name). Every request goes through a three-layer
security stack: Host header check → Origin/Referer check → per-route Bearer check.
Twelve smoke assertions pass against a live-booted server.

Concretely:

- **`apps/core/package.json`** — `"@gosleep/core"` in the workspace root, deps `hono ^4.7.0`, `@hono/zod-validator ^0.4.0`, `zod ^3.23.0`, `pino ^9.4.0` (pino is imported by no one yet — it belongs to the structured-logging task, but the arch's rev-2 §3.3 lists it as a core dep and the smoke-test-driven build wants no gaps at install time). Dev deps `typescript ^5.6.0`, `@types/bun ^1.2.0`. Scripts: `dev` (watch), `start`, `typecheck` (tsc `--noEmit`).
- **`apps/core/tsconfig.json`** — strict ESNext TypeScript, `moduleResolution: "bundler"`, `types: ["bun"]`, `noUncheckedIndexedAccess: true`. `bun x tsc -p apps/core --noEmit` returns 0 with no warnings.
- **`apps/core/bunfig.toml`** — deliberately minimal (empty policy comment). Per-app tuning goes here so root-level Bun config stays deterministic across workspaces.
- **`apps/core/src/config.ts`** — single source of truth for env, paths, Keychain names. Notable env seams: `GOSLEEP_CORE_PORT`, `GOSLEEP_KEYCHAIN_SERVICE`, `GOSLEEP_KEYCHAIN_ACCOUNT`, `GOSLEEP_KEYCHAIN_TIMEOUT_MS` (default 5000 ms per rev-3 addendum Delta 5), `GOSLEEP_BEARER_TOKEN` (test-only bypass — never set in production), `GOSLEEP_OWNER_NAME`.
- **`apps/core/src/security/keychain.ts`** — spawns `security find-generic-password -s <service> -a <account> -w`; wraps it in a hard 5 s timeout via `setTimeout` + `child.kill("SIGKILL")`. Returns `string | null`; callers translate `null` into 503 (never 200 without auth). Honours `GOSLEEP_BEARER_TOKEN` as a fast-path override.
- **`apps/core/src/security/host.ts`** — 421 Misdirected Request on any Host header that is not the exact `127.0.0.1:7331` string. Layer 1 of the stack.
- **`apps/core/src/security/origin.ts`** — safe-method bypass (GET/HEAD/OPTIONS), otherwise requires Origin or Referer, forbids disagreement between the two, matches against `http://127.0.0.1:7331`. Layer 2 (guard for future POSTs).
- **`apps/core/src/security/bearer.ts`** — reads the Keychain secret, translates `null → 503`, missing/wrong Bearer → `401`. Constant-time comparison via SHA-256 digest → `crypto.timingSafeEqual` (equal-length buffers required). Layer 3.
- **`apps/core/src/routes/read.ts`** — `readRoutes` Hono sub-app owning `/healthz` (public), `/version` (Bearer per-route), `/whoami` (Bearer per-route). Mounted under root in `serve.ts` via `app.route("/", readRoutes)`.
- **`apps/core/src/serve.ts`** — `Bun.serve({ hostname, port, fetch: app.fetch })`. Applies `requireLocalHost` + `requireLocalOrigin` app-wide, then mounts the read routes. One `core.listen` JSON line to stdout on boot so `launchctl print` has something anchored.
- **`apps/core/plist/com.gosleep.core.plist`** — launchd template with `@@BUN_BIN@@` + `@@REPO_ROOT@@` placeholders, `RunAtLoad=true`, `SessionCreate=true`, `KeepAlive.SuccessfulExit=false` (restart on crash only), `ThrottleInterval=10` (soak crash loops), stdout/stderr to `data/logs/core-*.log`.
- **`apps/core/plist.sh`** — three verbs (`install [--secret ENV]`, `uninstall [--purge-secret]`, `status`). Install: prompts for the Bearer (hidden input, confirmed), calls `security add-generic-password -U -A -s gosleep-web -a $USER -w <secret>`, `sed`-renders the plist template into `~/Library/LaunchAgents/`, `launchctl bootout` any stale copy, `launchctl bootstrap gui/$UID`, polls `/healthz` for up to 8 s. Uninstall: `launchctl bootout`, remove plist; Keychain item preserved unless `--purge-secret`. Status: one JSON line with `installed / loaded / healthz / pid`. `-A` (allow-all-callers) is a deliberate stopgap — GSL-264 replaces it with `-T <trusted-app>` per rev-3 addendum Delta 5.
- **`apps/core/install-deps.sh`** — `bun` presence + install if missing (curl `bun.sh/install`), `bun install` at repo root, `security` CLI check, `swiftc` check with a WARN if missing. Explicitly does NOT compile `bin/touchid-gate` — Delta 4 requires a signed `.app` bundle, which is GSL-264 territory.
- **`apps/core/bin/touchid-gate.swift`** — Swift source only. Uses `LAContext.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, …)` + `evaluatePolicy`; documented exit codes 0/1/2/3 for granted / denied / no-sensor / framework-error. A big header explains WHY the compilation is deferred (bare Mach-O binaries do not receive biometric entitlements).
- **`tools/lab/tests/core-smoke.sh`** — codified endpoint smoke. Boots the server with `GOSLEEP_BEARER_TOKEN=smoke-token-DO-NOT-USE`, runs seven HTTP scenarios: `/healthz` no-auth 200, `/version` no-auth 401, `/whoami` no-auth 401, `/version` wrong-Bearer 401, `/version` wrong-Host 421, `/version` valid Bearer 200 (body includes `server_version`), `/whoami` valid 200 (body has owner). Kills the server, asserts `lsof -i :7331` is empty. 12/12 pass.
- **`tools/lab/smoke.sh`** — added a `GSL-260` block before the `RESULT` line: (rule 1) no `.py` under `apps/` or `packages/`; (rule 2) no `.sh` under `apps/` or `packages/` outside the whitelist `apps/core/install-deps.sh | plist.sh | apps/core/scripts/*.sh`; (invariant) `apps/core/src/` exists. Turns architecture §5.3 into gate-enforced policy the moment code lands under apps/.
- **`CLAUDE.md`** — the monorepo section reflects the new state: `apps/core/` structure enumerated, `bun install`/`bun run --filter`/`bun x tsc -p`/`bash tools/lab/tests/core-smoke.sh`/`plist.sh install|uninstall|status` are all documented for future workers. The `bun.lockb` sentence corrected to `bun.lock` (text format under Bun 1.3.x).

## Problems solved

- **The three-endpoint contract holds under an unauth attacker.** Twelve scenarios pass: unauth `/version` and `/whoami` both 401; wrong Bearer 401; wrong Host header 421; correct Bearer 200 with valid JSON. Meets Jira acceptance criterion "4 request variants without correct Bearer → all 401" (R38 in target-architecture §12) — with an extra Host-header variant thrown in.
- **The Keychain lookup does not silently fall to unauth.** On timeout/absence/permission-denied, `readBearerFromKeychain` returns `null` and the Bearer middleware translates that into 503, not 401 and not 200. Exactly the gh-CLI regression from `github.com/cli/cli/issues/13317` we set out to avoid.
- **Bun-workspaces `bun install` at root pulls the core deps into `apps/core/node_modules/`.** `bun install v1.3.10` resolves 61 packages in 855ms; the resulting `bun.lock` (Bun 1.3.x text format) lives at repo root, no per-app lockfile.
- **Typecheck clean under strict TS.** `bun x tsc -p apps/core --noEmit` = rc 0. `noUncheckedIndexedAccess` was catching the `m[1]` case in `bearer.ts` — the null-checked branch is now honest about `undefined` slots.
- **No process leaked from the smoke.** `core-smoke.sh` traps EXIT/INT/TERM, kills the child, then re-checks `lsof -i :7331` and asserts port clean. Verified twice.
- **CSRF/DNS-rebinding shape correct without a running Bun test suite.** `requireLocalHost` and `requireLocalOrigin` compose so a request via `attacker.example` → `127.0.0.1:7331` (DNS rebinding classic) fails at layer 1, and a browser-driven cross-site POST fails at layer 2.

## Problems remaining

- **`bin/touchid-gate` is not compiled — it is source only.** Per rev-3 addendum Delta 4 the working binary must be a signed `.app` bundle (`codesign -s - --entitlements … --deep --force`); bare `swiftc` builds have no biometric entitlements and `canEvaluatePolicy` returns false regardless. GSL-264 owns the `.app` build + entitlements plist + `open -W -a` wiring inside `apps/core/src/spawn/publish.ts`. This split is honest — Jira's GSL-260 acceptance line "manual `bin/touchid-gate` run raises the system prompt" cannot be met from a bare Mach-O, so shipping the source with a deferral note is the least-lying option.
- **The `-A` (allow-any-caller) flag on `security add-generic-password`** — deliberate dev-friendly stopgap. Production hardening ties the Keychain ACL to the built binary path (`-T <trusted-app>`), which requires the compiled binary from GSL-264. The stopgap is annotated in `plist.sh` line 78-ish.
- **No `pino` calls anywhere.** The dep is in `package.json` because the arch calls for it and pulling it in at install time avoids future `bun install` prompts, but the structured-logging feature lands with a later task. Today `console.log` writes one boot line.
- **No unit tests for `keychain.ts` timeout behaviour** — the smoke asserts the middleware chain end-to-end (503 vs 401 vs 200), but there is no isolated test that a delayed `security` call gets killed at 5 s and yields null. The Bun test runner is available; adding this test in a follow-up is straightforward.
- **`core-smoke.sh` is not wired into `gate.sh`.** By design — `gate.sh` is 0-network / 0-process, and starting Bun on port 7331 breaks that contract. The gate keeps its guarantees; the endpoint smoke is a HAND-RUN test that developers execute before committing changes to `apps/core/`. The script is discoverable (`tools/lab/tests/`) and its role is documented in CLAUDE.md.

## Pitfalls & workarounds

- **`bun-types` vs `@types/bun` naming trap.** Bun's official types package renamed itself; `types: ["bun-types"]` in tsconfig fails with `TS2688: Cannot find type definition file for 'bun-types'`. Correct name today is `types: ["bun"]` + dev dep `@types/bun`. Fixed after the first `tsc` run.
- **Hono's `route()` vs manual re-registration.** First cut wrote `app.get("/version", (c) => readRoutes.fetch(c.req.raw))` which technically works but duplicates the routing table and skips per-route middleware in `readRoutes`. Replaced with `app.route("/", readRoutes)` mount — the Bearer middleware attached inside `readRoutes.get("/version", requireBearer, handler)` fires correctly, `bun x tsc` stays clean.
- **`allowImportingTsExtensions: true` matters for Bun-native runs.** Bun runs `.ts` directly and imports must include the `.ts` extension (`import { X } from "./config.ts"`). Without this tsconfig flag, `tsc` yells at every internal import. Standard for Bun-first codebases; not a "code smell" as it would be under a `tsc → dist` pipeline.
- **Constant-time compare needs equal-length buffers.** `crypto.timingSafeEqual` throws on length mismatch — a naive presented-secret vs stored-secret compare would leak length information AND crash on mismatch. SHA-256 both sides first: fixed 32-byte output, no leak, no throw.
- **The rev-3 addendum vs Jira description scope conflict — resolved in Jira's favor with a documented deferral.** Jira description says "TouchID binary compiled … a manual `bin/touchid-gate` run raises the system prompt" (which is Δ4-obsolete). Delta 4 says the binary MUST be a signed `.app` bundle and reassigns the work to GSL-264 explicitly. The addendum itself instructs: "Impact on tasks: GSL-264 (Security) gains this as a scope note." So GSL-260 ships the .swift SOURCE with a header explaining the deferral; GSL-264 will do the .app build. The dev-history is the honest record of that split.
- **The `.artifacts/core-smoke/` scratch directory** — under `.artifacts/` (git-ignored, .gitignore line 9); `core-smoke.sh` cleans it on success and leaves it on failure so the stderr log is grep-able. Same convention as GSL-259's chronicler-race test.
- **NO auth beyond what the task demands.** The brief flagged this — the addendum's Delta 5 adds `-T`-ACL, Tahoe 26.x guard, per-boot audit line, and Delta 4 adds signed .app bundle. These land in GSL-264 per the addendum's own routing. GSL-260 stops at: mkdir-based Keychain wrapper with 5 s timeout returning null (→ 503), constant-time Bearer compare, Host/Origin middleware. No TouchID compilation, no ACL entitlements, no per-boot audit line, no Tahoe 26.x Base64 shim.

## What didn't make it

- **`drizzle.config.ts` + `src/db/` scaffolds.** GSL-261 (DB schema) owns them. `drizzle-orm` is intentionally NOT in `package.json` for GSL-260 — the Jira description says drizzle-orm goes in but the brief said "NO database"; the arch has drizzle-orm listed under core's deps for future use. Kept out of `package.json` to keep the install surface honest: no dep pulled in that this task does not import.
- **`src/spawn/*.ts`.** GSL-263/267 own the spawners. `apps/core/src/spawn/chronicler.ts` is where the web-side sentinel-touch from GSL-259 will land (see GSL-259's dev-history for the pending wiring).
- **`src/indexer/`, `src/sse/`, `src/db/`.** All later tasks per architecture §9.
- **A `README.md` under `apps/core/`.** Owner rule is "no doc files unless asked" and the CLAUDE.md monorepo section already covers the shape.
- **Wiring `bun --filter='@gosleep/core' test` into `gate.sh`.** The Jira description for GSL-258 said that step is "additive" — GSL-260 was expected to switch it on. Reconsidered: no test files exist under `apps/core/test/` yet, so `bun test --filter='@gosleep/core'` would find nothing and either 0-return or fail loudly. Adding a no-op green step to the gate is worse than adding it when there are actual tests to run — deferring to the first task that adds `apps/core/test/*.test.ts`.

## Technical reference

- **Commit:** on branch `GSL-250-control-plane`, message prefixed `GSL-260 …`.
- **Files created:**
  - `apps/core/package.json`
  - `apps/core/tsconfig.json`
  - `apps/core/bunfig.toml`
  - `apps/core/src/config.ts`
  - `apps/core/src/security/keychain.ts`
  - `apps/core/src/security/host.ts`
  - `apps/core/src/security/origin.ts`
  - `apps/core/src/security/bearer.ts`
  - `apps/core/src/routes/read.ts`
  - `apps/core/src/serve.ts`
  - `apps/core/plist/com.gosleep.core.plist`
  - `apps/core/plist.sh` (executable)
  - `apps/core/install-deps.sh` (executable)
  - `apps/core/bin/touchid-gate.swift`
  - `tools/lab/tests/core-smoke.sh` (executable)
  - `docs/dev_history/GSL-260-phase7-cycle199-core-skeleton.md`
- **Files modified:**
  - `tools/lab/smoke.sh` — added `GSL-260` §5.3 grep-guards block before `RESULT`.
  - `CLAUDE.md` — monorepo section expanded (apps/core structure, `bun.lock` vs `.lockb`, endpoint smoke, plist.sh verbs).
  - `bun.lock` — regenerated by `bun install` after `apps/core/package.json` gained deps.
- **Verified by running:**
  - `bun install` at repo root → `42 packages installed [855.00ms]`.
  - `bun x tsc -p apps/core --noEmit` → rc 0.
  - `bash tools/lab/tests/core-smoke.sh` → `pass=12 fail=0` (12 checks: boot, 7 HTTP scenarios × [status + body where applicable], port teardown).
  - `bash tools/lab/smoke.sh` → PASS/FAIL counts include the new GSL-260 block (see gate receipt in `.artifacts/lab/gates/smoke.json`).
  - `bash tools/lab/gate.sh --offline` → `VERDICT: all gates green (offline mode — tracker NOT reconciled, say so in the report)`. Hooks-verify + tsc + chronicler untouched.
  - `lsof -i :7331` → empty after every smoke run.
- **Links:**
  - Jira: [GSL-260](https://ainstance-labs.atlassian.net/browse/GSL-260) — parent epic [GSL-250](https://ainstance-labs.atlassian.net/browse/GSL-250)
  - Architecture: `docs/reports/web-harness-research-2026-08-03/target-architecture.md` sections 3.2, 3.3, 5.3, 7.1–7.5, 9 (step 3), 12 R29–R38.
  - Rev-3 addendum: Delta 4 (TouchID .app bundle deferral), Delta 5 (Keychain hardening deferral) — both explicitly routed to GSL-264 by the addendum's own §"Summary of task impact".
