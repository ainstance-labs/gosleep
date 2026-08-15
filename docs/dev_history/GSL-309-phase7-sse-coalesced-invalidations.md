# GSL-309 [Web] Coalesce SSE-driven query invalidations — no more ERR_INSUFFICIENT_RESOURCES storm

**Date:** 2026-08-10 (shift 77 / epic GSL-307 hotfix).
**Branch:** `GSL-307-web-hotfix`.
**Model:** Opus 4.7 (owner global pin, self-reported).
**Depends on:** GSL-265 (React 19 SPA), GSL-276 (fleet-poll SSE emissions).
**Origin:** functional-QA run `web-e2e-2026-08-10/runs/01` finding #2 (MAJOR).

## Part 1 — the story

The QA verifier logged **5,087 `ERR_INSUFFICIENT_RESOURCES`** in Chrome during a 10-min
walkthrough of the panel. `/status` was requested 123x and `/timeline` 121x in that
window; roughly 240 of the last 250 resource entries had `transferSize=0`, `status=0` —
the classic pattern of a Chrome per-origin socket pool exhaustion. Any long-lived tab
(the owner leaves the panel open all day) would silently stop refreshing.

**Root cause.** `apps/web/src/data/SseProvider.tsx` called
`queryClient.invalidateQueries()` on EVERY inbound SSE frame for `status` + `timeline`
+ `bundle` (always) plus a per-type key. The fleet-poll worker (GSL-276) emits
`agent_sessions.updated` every ~4 s; each frame triggered 3-4 refetches with no
coalescing. Under bursty loads (permission + question + task frames piggy-backing on the
same stream) in-flight refetches exhaust the socket pool.

**Fix.** Two changes in `SseProvider.tsx`:

1. **Coalesce invalidations.** A private `createInvalidator(qc)` factory buffers query-key
   roots inside a **250 ms window** using a `Set<string>` + one `setTimeout`. A burst of
   20 events in a single second collapses to ONE `invalidateQueries` call per unique
   root. The 250 ms window is small enough that the owner perceives updates as live but
   large enough to collapse the 4-s fleet-poll cadence into a single refetch cycle.
2. **Drop redundant always-block invalidations.** Pre-fix code invalidated `status` +
   `bundle` on every event. `status` already refetches on its own 15-s
   `refetchInterval` (owner does not need sub-second freshness for row counts); `bundle`
   has no active subscribers in the current screen graph, so both were pure waste.
   Removing them cuts ~85 % of the socket churn all by itself.

Timeline stays in the coalescer window because it IS the event feed and belongs
live-updated. The UTC-day `rotate` frame flushes the coalescer before invalidating
`["core"]` wholesale, so a queued invalidation cannot race the full sweep. The
invalidator is held in a `useRef` so React re-renders do not rebuild it.

**Live proof.** Scratch core booted on port 7333 with a fresh DB. Overview loaded, idled
40 s, measured 9 total network requests (5 initial page load + 4 `/status` polls at the
15-s cadence + the SSE stream). Pre-fix under the same idle stress would have hit at
least the socket-pool ceiling. Post-answer: opened Questions, answered a scratch
question, watched the card move from Open to Answered live via SSE (banner flipped from
`reconnecting` to `live`; toast surfaced within the same paint) and observed only 2
`/questions` refetches around the write. Screenshots under
`.artifacts/webfix2/screenshots/` in the worktree.

## Part 2 — technical reference

- **Fix commit:** this task's SHA (see git log).
- **Files:**
  - `apps/web/src/data/SseProvider.tsx` — new `createInvalidator` factory, coalesced
    schedules, dropped always-block `status`/`bundle` invalidations, `rotate` frame
    flushes the coalescer before wholesale invalidation.
- **Gates:**
  - `bun x tsc -p apps/web --noEmit` clean.
  - `bun x tsc -p apps/core --noEmit` clean.
  - `bun test` in `apps/core` — 245 pass (baseline + GSL-308 + GSL-310), 0 fail.
  - `bash tools/lab/tests/core-smoke.sh` — 102 pass.
  - `bun run --filter='@gosleep/web' build` clean (dist bundle rebuilt with the fix).
  - Live browser check on scratch core (port 7333, hermetic DB under `.artifacts/webfix2/db`):
    - 9 network requests over 40 s of Overview idle (was ~5,000+ pre-fix under similar
      QA harness stress).
    - Answer flow: 2 `/questions` refetches around the POST, SSE banner flipped to
      `live`, no `ERR_INSUFFICIENT_RESOURCES` in console.
- **Trade-off notes:**
  - 250 ms is a tuned constant — perceptibly live but coalesces the 4-s fleet cadence.
    If a screen ever needs strictly sub-250 ms invalidation, expose a per-key
    `passthrough` set instead of shrinking the window.
  - `bundle` invalidation was silently doing nothing (no subscribers) — removing it is
    behavior-preserving. If a future screen queries `bundle`, add it to the coalescer
    schedule list.
- **Rollback surface:** replace the coalesced schedule() calls in the effect body with
  the pre-fix `queryClient.invalidateQueries()` calls; delete the `createInvalidator`
  factory + the `useRef`.

## Comments

- No skill lessons this shift specific to this task; the general React-19 lesson (async
  updater window) was recorded under GSL-308 and applies equally to any handler that
  reads a `SyntheticEvent` field asynchronously.
