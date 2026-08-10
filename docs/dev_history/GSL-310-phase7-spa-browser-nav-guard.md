# GSL-310 [Core] SPA browser-navigation guard — hard-reload of /fleet /questions /tasks /cost /timeline no longer 401s

**Date:** 2026-08-10 (shift 77 / epic GSL-307 hotfix).
**Branch:** `GSL-307-web-hotfix`.
**Model:** Opus 4.7 (owner global pin, self-reported).
**Depends on:** GSL-285 (SPA static serve + fallback), GSL-260 (Bun+Hono core).
**Origin:** functional-QA run `web-e2e-2026-08-10/runs/01` finding #4 (MAJOR).

## Part 1 — the story

The read-route table in `apps/core/src/routes/read.ts` defines Bearer-gated GET handlers
for /fleet, /timeline, /questions, /tasks, /cost — five names that ALSO happen to be
client-side routes in the React SPA. Because Hono checks mounts in order and this app
registered `readRoutes` BEFORE `spaRoutes`, a browser hard-reload of `/questions` walked
straight into the JSON handler, failed the Bearer check, and returned 401 with body
"unauthorized" — the SPA never booted. Only `/overview` used to escape because no API
happens to share that name. Every other client route was a broken bookmark.

**Fix.** New middleware `apps/core/src/routes/spaNavigation.ts` mounted BEFORE
`readRoutes`. A request is treated as a browser navigation and short-circuited to the
SPA shell (index.html) when:

- method is GET or HEAD, AND
- path is one of the collision paths (`/fleet`, `/timeline`, `/questions`, `/tasks`,
  `/cost`, `/overview`, `/skills`) or a nested child (e.g. `/questions/GSL-123`), AND
- `Accept` header prefers `text/html` over `application/json`.

Browsers send `Accept: text/html, application/xhtml+xml, image/*, ...; q=0.9`. The SDK's
fetch calls set `Accept: application/json`. Negotiation cleanly separates the two
classes of caller — no cookie / user-agent guessing. `serveSpaFallback` from `spa.ts`
was exported so the guard reuses the exact same body the fallback would return, keeping
one code path for "SPA shell" content.

**Why this shape, not `/api/*` prefixing.** The alternative — moving every API endpoint
under `/api/*` — would have been a wider change with churn across the SDK, all read
tests, all curl-based smoke scenarios, and any external caller. The guard is a
one-file, backward-compatible slice that solves the exact problem (browser hard-reload)
without touching the JSON contract.

**Regression proof.** Two layers:

1. `apps/core/test/spaNavigation.test.ts` — unit tests (bun:test, 17 cases) for
   `acceptPrefersHtml`, `isClientRoutePath`, `isBrowserSpaNavigation`. Covers
   browser-shaped headers, SDK JSON, no header, wildcard, case-insensitive match,
   collision paths, nested paths, prefix-lookalikes (`/fleeting` NOT a client route),
   POST vs GET, HEAD, API-only paths.
2. `tools/lab/tests/core-smoke.sh` scenarios 58a-58e — live HTTP against a booted
   scratch core:
   - 58a browser GET /questions Accept:text/html → 200 index.html.
   - 58b SDK GET /questions Accept:application/json (no Bearer) → 401 (unchanged).
   - 58c SDK GET /questions Accept:application/json + Bearer → 200 JSON (unchanged).
   - 58d /fleet Accept:text/html → 200 SPA.
   - 58e /questions/GSL-1 nested path → 200 SPA.

Total smoke count goes from 96 → 102 (+6 = 5 new scenarios + 1 body-marker check).

## Part 2 — technical reference

- **Fix commit:** this task's SHA (see git log).
- **Files:**
  - `apps/core/src/routes/spaNavigation.ts` (new) — guard middleware + accept-negotiation
    helper + collision-path table.
  - `apps/core/src/routes/spa.ts` — export `serveSpaFallback` so the guard can call it.
  - `apps/core/src/serve.ts` — mount `spaNavigationRoutes` BEFORE `readRoutes` after the
    three security middlewares (host / origin / security headers).
  - `apps/core/test/spaNavigation.test.ts` (new) — 17-case unit tests.
  - `tools/lab/tests/core-smoke.sh` — 6 new checks under "GSL-310: SPA browser-navigation
    guard on API-colliding paths".
- **Gates:**
  - `bun x tsc -p apps/core --noEmit` clean.
  - `bun x tsc -p apps/web --noEmit` clean.
  - `bun test` in `apps/core` — 245 pass (228 baseline + 4 GSL-308 + 17 GSL-310), 0 fail.
  - `bash tools/lab/tests/core-smoke.sh` — 102 pass (96 baseline + 6 new).
  - `bun run --filter='@gosleep/web' build` clean.
- **Rollback surface:** delete `apps/core/src/routes/spaNavigation.ts`, remove its
  import + mount line from `serve.ts`, unexport `serveSpaFallback` from `spa.ts`, drop
  smoke scenarios 58a-58e. The pre-fix "hard-reload of non-overview client routes
  401s" behavior returns.
- **Non-goals:** an `/api/*` namespace migration (bigger surface; separate ticket if we
  ever want it) and cookie/user-agent guessing (deliberately avoided).

## Comments

- No skill lessons this shift specific to this task; the delivery-workflow skill already
  encodes "one commit per task" which is what happened here.
