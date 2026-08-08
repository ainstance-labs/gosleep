# GSL-291 [Repo][Web] /setup Bearer discovery — no devtools needed

**Date:** 2026-08-08 (shift 75 / cycle 215 fix-wave)
**Branch:** GSL-250-control-plane
**Model:** Opus 4.7 (owner global pin, self-reported)
**Depends on:** GSL-260 (Bearer + Keychain), GSL-269 (CSP + security headers),
GSL-275 (internal-secret guard), GSL-285 (SPA served from core).

## Part 1 — the story

Before this ticket the owner had to hand-inject the Bearer into `sessionStorage` via
devtools before the panel worked — impossible from mobile Safari, unfriendly anywhere.
The fix follows the target-architecture rev 2 §3.3 plan: a `GET /setup?tok=<otp>` route
paired with an internal endpoint that mints one-shot OTPs.

Flow:

1. Operator on the host runs `bash apps/core/plist.sh setup-url` (needs
   `GOSLEEP_INTERNAL_SECRET` exported — same value the core sees).
2. `plist.sh` POSTs `/internal/setup/otp` with the internal secret; core generates a
   32-byte hex OTP, stores its SHA-256 in memory with a 5-minute TTL, returns
   `{ok, otp, url, expires_at, ttl_s}`.
3. Owner pastes the URL into any browser (including mobile Safari over loopback tunnel).
4. `GET /setup?tok=<OTP>` validates the OTP (single-use, TTL-bounded), reads the Bearer
   via `resolveAuthSource()`, returns the SPA shell with an added
   `<meta name="gosleep-token" content="<Bearer>">` in `<head>`.
5. `apps/web/src/data/auth.ts` reads the meta at boot, stashes the value in
   `sessionStorage['gosleep.token']`, removes the meta tag from the DOM.

Key security properties:

- Bearer never enters the URL, `Referer` (blocked anyway), or browser history.
- Cache-Control: no-store on every /setup response — the meta-carrying HTML never caches.
- OTP is single-use: a second visit to the same URL returns 400 with a diagnostic page.
- OTP is stored as `sha256(otp)` in memory only — a memory dump does not leak plaintext.
- TTL clamped `[30, 3600]` seconds so a runaway TTL cannot linger for hours.
- The internal-secret guard on `/internal/setup/otp` is the same one that already fronts
  `/internal/questions/post` etc. — no new auth mechanism to review.
- `resolveAuthSource()` failure → 503 with an explicit "Bearer secret unreadable" page.
- Missing web bundle → 500 with a "run `bun run --filter='@gosleep/web' build`" page.

The `/setup` route is mounted BEFORE the SPA fallback in `serve.ts` so its explicit path
wins over the generic index.html rewrite.

## Part 2 — the reference

- **Commit:** GSL-291 — one commit on GSL-250-control-plane.
- **Files:**
  - `apps/core/src/setup/otp-store.ts` — NEW. `OtpStore` (SHA-256 hashed, single-use,
    TTL-bounded, module singleton).
  - `apps/core/src/routes/setup.ts` — NEW. `GET /setup` handler; splices meta into
    `apps/web/dist/index.html`.
  - `apps/core/src/routes/internal.ts` — added `POST /internal/setup/otp` (internal-secret
    gated).
  - `apps/core/src/serve.ts` — mounted `setupRoutes` between the internal routes and the
    SPA static fallback.
  - `apps/web/src/data/auth.ts` — `getBearer()` now reads the `<meta name="gosleep-token">`
    tag as a source (between sessionStorage and `?token=`), and removes the tag from the
    DOM after consumption.
  - `apps/web/src/main.tsx` — added a boot-time `getBearer()` call so the meta consumption
    happens BEFORE the first query fires (even if the SPA hasn't rendered anything yet).
  - `apps/core/plist.sh` — new `setup-url` subcommand: reads `GOSLEEP_INTERNAL_SECRET`,
    curl-POSTs the internal endpoint, echoes the URL. Fails loudly (exit 2) with a
    pre-flight message if the internal secret is unset.
  - `apps/core/test/setup.otp.test.ts` — NEW. 8 unit tests covering create+consume, single-
    use enforcement, unknown OTP, TTL-based expiry, default TTL constant, GC behaviour,
    digest isolation, empty-store consume.
  - `tools/lab/tests/core-smoke.sh` — added scenarios 59-66: no-secret 401, valid 200 +
    OTP body, /setup?tok=<OTP> 200 with meta tag containing the Bearer, single-use 400,
    no-tok 400, unknown-tok 400, no-store cache header, TTL clamp to 30 s floor.
  - `docs/runbooks/gosleep-core.md` — new § 8.5 documents the full flow + failure modes.
- **Verified by running:**
  - `bun test apps/core/test/setup.otp.test.ts` → 8/8.
  - `bun test apps/core` → 183 pass (was 175 pre-291).
  - `bun x tsc -p apps/core --noEmit` + `bun x tsc -p apps/web --noEmit` → clean.
  - `bash tools/lab/tests/core-smoke.sh` → **88 pass, 0 fail** (was 78 pre-change;
    +10 scenarios).
  - Live end-to-end:
    1. Booted a scratch core with `GOSLEEP_INTERNAL_SECRET=scratch-internal` +
       `GOSLEEP_BEARER_TOKEN=scratch-bearer-live`.
    2. `bash apps/core/plist.sh setup-url` printed
       `http://127.0.0.1:7331/setup?tok=02538a8f…`.
    3. `curl -s <URL>` returned the SPA index.html body containing
       `<meta name="gosleep-token" content="scratch-bearer-live">`.
    4. A second `curl` to the same URL returned `400` (single-use).
    5. Every /setup response carried `Cache-Control: no-store` + CSP + XFO.
- **Links:** Jira [GSL-291](https://ainstance-labs.atlassian.net/browse/GSL-291),
  parent epic [GSL-250](https://ainstance-labs.atlassian.net/browse/GSL-250).
