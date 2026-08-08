# GSL-295 [Web] Router unknown-route → honest 404 screen

**Date:** 2026-08-08 (shift 75 / cycle 215 fix-wave)
**Branch:** GSL-250-control-plane
**Model:** Opus 4.7 (owner global pin, self-reported)
**Depends on:** GSL-265 (router baseline).

## Part 1 — the story

`apps/web/src/router.tsx` used to catch every unknown route with `<Navigate to="/overview"
replace />`. That silently masked missing surfaces — an owner typing `/skills` before the
skills-management ticket lands would arrive at Overview and assume the SPA was complete.

New: `NotFoundScreen` (`apps/web/src/screens/NotFound.tsx`) renders inside the shell,
names the requested path (from `useLocation`), lists what to check, and offers styled
links back to the surfaces that DO exist (Overview / Fleet / Timeline / Questions / Tasks
/ Cost). The router wildcard now points at this screen instead of Navigate.

Non-goals per the verifier finding: this ticket does NOT add the Skills route; that lives
with the postponed skills-management epic. The NotFound screen makes the absence visible
without pretending Skills exists.

## Part 2 — the reference

- **Commit:** GSL-295 — one commit on GSL-250-control-plane.
- **Files:**
  - `apps/web/src/screens/NotFound.tsx` — NEW. Reads `useLocation()` for the path, shows
    a card with "requested", "what to check", and a link-strip back to the known routes.
  - `apps/web/src/router.tsx` — wildcard replaced with `<NotFoundScreen />` instead of
    the silent Navigate. Comment cites the design rationale.
  - `apps/web/dist/**` rebuilt.
- **Verified by running:**
  - `bun x tsc -p apps/web --noEmit` → clean.
  - `bun run --filter='@gosleep/web' build` → 2.54 s.
  - `bash tools/lab/tests/core-smoke.sh` → 89 pass, 0 fail (unchanged; SPA fallback
    still serves index.html on unknown paths — react-router then renders NotFound
    inside the shell).
- **Links:** Jira [GSL-295](https://ainstance-labs.atlassian.net/browse/GSL-295),
  parent epic [GSL-250](https://ainstance-labs.atlassian.net/browse/GSL-250).
