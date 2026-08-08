# GSL-269 — Polish, documentation, smoke guards, security tests

**Epic:** GSL-250 (Interactive management web interface / control plane)
**Branch:** `GSL-250-control-plane`
**Cycle:** 210 (shift 75, night)
**Worker:** impl-web-13 (Opus 4.7)

## What was done

Step 10 of `docs/reports/web-harness-research-2026-08-03/target-architecture.md` — the epic-closing
polish task. Closed forgotten works 5, 8, 9, 10 from the red team by adding hardening
headers, security tests, smoke guards, an operator runbook, and updating CLAUDE.md +
ORCHESTRATION-STATE with the new standing rules.

Concrete changes:

- **`apps/core/src/security/csp.ts` (NEW).** CSP middleware. Stamps `Content-Security-Policy:
  default-src 'self'; …` plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and
  `Referrer-Policy: no-referrer` on every response. Runs BEFORE `requireLocalHost` /
  `requireLocalOrigin` so rejections (421 / 403 / 401 / 503) also carry the headers — a
  wrong-Host request cannot slip past the security-header layer.
- **`apps/core/src/serve.ts`** — wired `applySecurityHeaders` as the first middleware. Order
  documented in the header block: `applySecurityHeaders → requireLocalHost →
  requireLocalOrigin → requireBearer (per-route)`.
- **`apps/core/test/security.host.test.ts` (NEW).** 6 tests for the DNS-rebinding /
  Host-spoof guard: exact host passes, attacker.example → 421, bare `127.0.0.1` (no port)
  → 421, wrong port → 421, `localhost:7331` (name form) → 421.
- **`apps/core/test/security.origin.test.ts` (NEW).** 8 tests for the CSRF guard: GET
  bypass, matching Origin/Referer pass, mismatched → 403, cross-site → 403, missing → 403,
  https-scheme spoof → 403, unparseable Referer + valid Origin passes on Origin.
- **`apps/core/test/security.csp.test.ts` (NEW).** 7 tests: header leads with
  `default-src 'self'` (smoke-grep guarantee), stamped on 200 + 500 + JSON responses,
  `frame-ancestors 'none'` + `object-src 'none'` + no unsafe-inline/unsafe-eval for scripts.
- **`tools/lab/smoke.sh` — 6 new GSL-269 guards** at the tail:
  1. NO `fs.writeFile` / `writeFileSync` / `appendFile` under `apps/core/src/routes/actions.ts`,
     `apps/core/src/actions/`, `apps/core/src/security/` — write paths go only via the
     `spawn/lab-emit` CLI + Drizzle rows.
  2. Every `actionsRoutes.post` line has a matching `withTimeline<>` call in the same file
     — 8 / 8 today. A POST without a ledger wrapper is a write with no audit row.
  3. No high-entropy `b64v1:<payload>` Bearer secret in the tracked tree (test-fixtures with
     the `b64v1:` prefix + short payloads are permitted; anything ≥24 base64 chars fails).
  4. No plain-text `GOSLEEP_BEARER_TOKEN=…` assignment in tracked non-doc files.
  5. `apps/core/src/security/csp.ts` exists and defines `content-security-policy`.
  6. `apps/core/src/serve.ts` wires `applySecurityHeaders` as the first middleware.
- **`tools/lab/hooks-verify.sh`** — new section 3 `web control plane co-tenancy (GSL-250)`
  documenting that spawns from the running gosleep-core server (`bash lab-emit.sh`,
  `chronicler.sh` on debounce, etc.) are NORMAL under launchd — any future process-hygiene
  sweep must whitelist the loopback-bound parent.
- **`docs/runbooks/gosleep-core.md` (NEW).** Full operator runbook: fresh-machine setup,
  start/stop/status, where the Bearer secret lives, how to read logs, how to snapshot by
  hand, troubleshooting (Keychain 503, TouchID cancel, engine won't start under launchd),
  security-layer recap, and the two standing rules for agents.
- **`CLAUDE.md`** — expanded the Launchd bullet with Keychain wrap details + `rotate-secret`
  + runbook pointer; added new bullets for reading logs, snapshotting by hand, and the
  GSL-270 Preact-SSG deprecation.
- **`docs/handoff/ORCHESTRATION-STATE.md`** — 2 new standing rules under "Standing rules /
  decisions": GSL-269 (SQLite = source of truth; JSONL = historical archive; engine
  stopped only on owner's command) and GSL-270 (SSG deprecation).

## Problems solved

- **CSP header must survive rejections.** Original placement (after the host + origin
  guards) would have shipped 421 / 403 responses without CSP, defeating the point (an
  attacker Host doesn't need CSP if the response is small — but the header is the operator's
  primary signal that the server is running the right stack). Fixed by running the
  middleware FIRST (before `requireLocalHost`) and stamping headers AFTER `await next()`
  so `c.res.headers.set(...)` beats any `c.text(...)` reset inside the handlers.
- **Trailing-whitespace Host test was hitting the Fetch spec.** The WHATWG Fetch stack
  normalises OWS out of header values (RFC 7230 §3.2.4) before the middleware sees them,
  so a `"127.0.0.1:7331 "` input reaches the middleware as `"127.0.0.1:7331"` and passes.
  Removed the test; left a comment explaining the layer that handles that case.
- **`b64v1:` git-log check was too aggressive.** `git log -S 'b64v1:'` matched the
  documented prefix marker (tokenEncoding.ts, tests, plist.sh docs) — every one of those
  is legitimate. Rewrote to grep the current tree for `b64v1:<24+ base64 chars>` — real
  token shape only.

## Problems remaining

None specific to GSL-269. Two adjacent hardening items that are OUT of scope here and
already have their own tickets:

- `hooks-verify.sh` still lacks a positive test that spawns FROM the server are logged
  correctly — that belongs to a future GSL-270-equivalent hook-verify extension, not
  this closer.
- CSP `script-src 'self'` will need a nonce or `'strict-dynamic'` swap once the web
  client at `apps/web/` starts inlining Vite-emitted script tags. Punted to GSL-265
  when the client actually lands.

## Pitfalls & workarounds

- **CSP + Hono response mutation.** Hono's `c.text(...)` / `c.json(...)` do NOT preserve
  headers set BEFORE the call — they build a fresh Response from the passed body + status.
  The middleware pattern is: `await next(); c.res.headers.set(...)` — never set headers
  before `next()`.
- **Middleware order is load-bearing.** The comment block in `serve.ts` names it explicitly:
  `applySecurityHeaders → requireLocalHost → requireLocalOrigin → requireBearer`. Reordering
  breaks the "rejections carry CSP" property that the tests + live-check both assert.
- **`b64v1:` is a documented prefix, not a secret shape by itself.** Any smoke check
  looking for "no committed secrets" must filter on payload SHAPE (base64 length) not just
  the marker. Left the payload-length filter (`{24,}`) in the comment.
- **The runbook says "engine is stopped via `launchctl bootout` ONLY on the owner's
  explicit command".** Codified as a standing rule in ORCHESTRATION-STATE (GSL-269 entry).
  A worker who bounces the engine mid-shift breaks the phone panel the owner is reading.

## What didn't make it

- **`tools/lab/smoke.sh` CSP curl assertion.** Would require booting the server inside
  smoke.sh (adds start/stop complexity, races with core-smoke). The CSP contract is fully
  covered by (a) `apps/core/test/security.csp.test.ts` at the middleware layer, (b) the
  new static smoke guards for `csp.ts` + `serve.ts` wiring, and (c) the live curl
  verification captured in this dev-history file (below). A curl assertion in smoke.sh
  would only re-check what the bun test already proves.
- **DROP-migration WARN check (already covered).** The smoke section "GSL-261: no
  unannotated destructive Drizzle migrations" already implements the exact regex from the
  GSL-269 description (`DROP (TABLE|COLUMN)` without `-- WARN` within 5 lines). No
  duplicate needed.
- **Deleting `.claude/settings.json` mentions.** The task description names hooks-verify
  changes only; `.claude/settings.json` is owner-managed (guard rule).

## Technical

- **Commit:** (this task)
- **Files touched:**
  - `apps/core/src/security/csp.ts` (NEW, 70 lines — middleware + exported header value)
  - `apps/core/src/serve.ts` (import + wire + updated header block)
  - `apps/core/test/security.host.test.ts` (NEW, 6 tests)
  - `apps/core/test/security.origin.test.ts` (NEW, 8 tests)
  - `apps/core/test/security.csp.test.ts` (NEW, 7 tests)
  - `tools/lab/smoke.sh` (6 new GSL-269 guards)
  - `tools/lab/hooks-verify.sh` (web-control-plane co-tenancy note)
  - `docs/runbooks/gosleep-core.md` (NEW operator runbook)
  - `CLAUDE.md` (Launchd + logs + snapshot + GSL-270 SSG deprecation bullets)
  - `docs/handoff/ORCHESTRATION-STATE.md` (2 new standing rules)
- **Gates:**
  - `bash tools/lab/gate.sh --offline` → all green (hooks-verify 11/0 with new co-tenancy
    section, tsc clean, chronicler `--no-poll` green).
  - `bash tools/lab/smoke.sh` → **PASS=562 FAIL=0** (incl. 6 new GSL-269 guards + the 5
    GSL-270 probes from the previous cycle; the 3 pre-existing FAIL/flakes flagged in the
    shift-75 cycle-210 brief did not reproduce this run).
  - `bun x tsc -p apps/core --noEmit` → clean.
  - `bash tools/lab/tests/core-smoke.sh` → **pass=66 fail=0**.
  - `bun test` (in `apps/core/`) → **129 pass / 0 fail / 433 expect() calls**, incl. the
    21 new security tests (host 6, origin 8, csp 7).
- **Live-proof (CSP + hardening headers on 200 AND 421):**
  ```text
  GET /healthz → HTTP/1.1 200 OK
    Content-Security-Policy: default-src 'self'; base-uri 'self'; …; frame-ancestors 'none'; …
    X-Content-Type-Options: nosniff
    X-Frame-Options: DENY
    Referrer-Policy: no-referrer

  GET /version (auth'd) → HTTP/1.1 200 OK  + same 4 headers
  GET /healthz  Host: attacker.example → HTTP/1.1 421 Misdirected Request  + same 4 headers
  ```
- **Sources:**
  - Jira: `GSL-269` [Web][Docs] Polish, documentation, smoke guards, security tests
  - Target architecture: `docs/reports/web-harness-research-2026-08-03/target-architecture.md`
    section 9, step 10; red-team items 5, 8, 9, 10.
