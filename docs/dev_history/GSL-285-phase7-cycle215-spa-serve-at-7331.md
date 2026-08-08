# GSL-285 [Repo][Web] SPA served from 127.0.0.1:7331 (PRD end-check made real)

**Date:** 2026-08-08 (shift 75 / cycle 215 fix-wave, autonomous)
**Branch:** GSL-250-control-plane
**Model:** Opus 4.7 (owner global pin, self-reported)
**Depends on:** GSL-260 (Bun+Hono serve), GSL-263 (v1 read routes), GSL-265 (SPA build),
GSL-269 (CSP + host/origin), GSL-270 (Preact-SSG deprecated).

## Part 1 — the story

The verifier audit for GSL-250 flagged this as CRITICAL: the PRD end-check phrases the
acceptance as "the owner opens `http://127.0.0.1:7331` in Safari and sees live Overview",
but the shipped `apps/core/src/serve.ts` mounted only API/SSE routes — the root and every
SPA-owned path returned `404 Not Found` from Hono. The React client existed but lived
only on the Vite dev server (`127.0.0.1:5273`), which nothing runs under launchd.

Fix: a new `apps/core/src/routes/spa.ts` mounted LAST in the route chain. It uses
`serveStatic` from `hono/bun` to answer static asset requests out of `apps/web/dist/`,
and its `onNotFound` handler swaps in the SPA fallback (`index.html`) on any GET/HEAD
that doesn't match a file — so `/overview`, `/fleet`, `/questions`, `/setup`, and any
future client-side route land on the shell and react-router owns them. Non-GET to an
unknown path (`POST /nope`) still 404s honestly — an SPA rewrite for POST would mask a
real client bug. API routes mount before the SPA, so `/healthz`, `/status`, `/fleet`,
`/version`, `/actions/*`, `/internal/*`, and `/events` win their own paths as before.

Auth policy: static assets and `index.html` are PUBLIC (no Bearer). The token itself is
never in the bundle — the SPA acquires it at runtime through the existing
sessionStorage / `?token=` handshake (the setup lane lands with GSL-291). This matches
every SPA host on the planet: the shell is free, every data call still 401s without a
Bearer, and the SPA already surfaces that as an "Auth required" banner (GSL-265
`main.tsx` header comment). The bind stays loopback + Host-header pinned, so no remote
reader can even reach the shell.

Bundle discovery is env-driven: `GOSLEEP_WEB_DIST` wins if set (hermetic tests use
this); otherwise the resolver probes three cwd-relative candidates matching launchd,
workspace-filter, and direct-src boot shapes. If nothing exists, the route serves a
"web bundle is missing — run `bun run --filter='@gosleep/web' build`" placeholder
instead of a blank 404 — an operator who forgot to build reads what to do rather than
staring at a broken panel.

## Part 2 — the reference

- **Commit:** GSL-285 — added on top of 5b54c5d (branch head at start of cycle 215).
- **Files:**
  - `apps/core/src/routes/spa.ts` — NEW. `resolveWebDistRoot()` + `spaRoutes` mount.
  - `apps/core/src/serve.ts` — added `spaRoutes` import + `app.route("/", spaRoutes)`
    after every existing mount.
  - `apps/core/test/spa.test.ts` — NEW. 6 unit tests over `resolveWebDistRoot` (env
    override happy path, missing path returns null, non-directory rejected, cwd default,
    empty-tree null, symlinked dist).
  - `tools/lab/tests/core-smoke.sh` — added scenarios 51-58 (SPA root + fallback +
    static asset + API precedence + Bearer-gate preserved + CSP still stamped + wrong
    Host still 421 + POST-unknown honest 404). Seeds a scratch dist under
    `.artifacts/core-smoke/web-dist/` and boots the server with `GOSLEEP_WEB_DIST=…`.
  - `docs/runbooks/gosleep-core.md` — § 1 "Setup on a fresh machine" now names the
    build step + placeholder behaviour + auth stance.
- **Verified by running:**
  - `bash tools/lab/gate.sh --offline` → all gates green (pre-change baseline, same
    as post-change since the routes touched are outside gate scope).
  - `bun x tsc -p apps/core --noEmit` → clean.
  - `bun x tsc -p apps/web --noEmit` → clean.
  - `bun test apps/core/test/spa.test.ts` → 6 pass, 0 fail.
  - `bash tools/lab/tests/core-smoke.sh` → 78 pass, 0 fail (was 70 pre-change).
  - Manual live probe against a scratch DB + real `apps/web/dist/`:
    - `GET /` → 200, `content-type: text/html`, body = the real index.html.
    - `GET /overview` → 200, same (SPA fallback).
    - `GET /assets/index-CfZvFwRp.js` → 200, JS asset served verbatim (858 KB).
    - `GET /healthz` → 200 JSON (API wins over SPA).
    - `GET /version` (no Bearer) → 401 (Bearer gate preserved).
    - `POST /nope` → 404 (no SPA rewrite for non-GET).
    - CSP + XFO + X-Content-Type-Options stamped on every SPA response.
    - Port clean after teardown.
- **Links:** Jira [GSL-285](https://ainstance-labs.atlassian.net/browse/GSL-285),
  parent epic [GSL-250](https://ainstance-labs.atlassian.net/browse/GSL-250).
