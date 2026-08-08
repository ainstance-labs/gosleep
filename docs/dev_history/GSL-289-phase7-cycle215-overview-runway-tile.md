# GSL-289 [Repo][Web] Overview runway / binding-constraint tile

**Date:** 2026-08-08 (shift 75 / cycle 215 fix-wave)
**Branch:** GSL-250-control-plane
**Model:** Opus 4.7 (owner global pin, self-reported)
**Depends on:** GSL-263 (/status), GSL-276 (agent_sessions).

## Part 1 — the story

The verifier audit for GSL-250 flagged Overview as ship-blocked because the very first KPI
promised by PRD Phase 7 F7-S1 — "runway = min()" — was missing. The four tiles rendered
were `Events / Questions / Tasks / Skills` counts; a real owner opening the panel could not
answer "can I sleep" because the composite runway isn't there.

Definition, per PRD-gosleep-evolution.md §R5.1: RUNWAY is a composite hours-until-exhaustion
header, min() over independent clocks, with the binding constraint highlighted:

```
RUNWAY ≈ 4h (binding: quota resets 03:00) | ctx 42% | budget 45% | slots 2/3 | blockers 0
```

The full six-clock set is R5.1's target end-state. This ticket ships the honest, live-data
subset available in the shipped DB today (v1). Three clocks:

- **context**: per-live-agent linear extrapolation. For an agent at pct P after age_h hours,
  hours_left ≈ age_h * (100 - P) / P. Smallest hours_left across all live agents wins the
  binding label. Null when no live agent has both a non-null context_pct AND age > 5 min
  (below that, the extrapolation is noise).
- **blockers**: any open BLOCKER or permission question hard-caps runway at 0h. The owner
  cannot sleep while an agent is waiting on them.
- **slots**: informational today — the manifest slot cap isn't yet a live constraint in the
  DB; readout still surfaces `slots N/cap` so the tile shows the fleet size.

The aggregator picks the SMALLEST non-null hours_left as the binding constraint; when every
clock is null, both `hours_left` and `binding` are null and the tile renders `—` with the
per-clock readout underneath (fully honest — no fabricated numbers).

Overview's grid stays 4-column: the runway tile spans two cells so its readout line has room
for all three clock read-outs; the four remaining tiles are Events / Questions / Tasks /
Skills as before.

## Part 2 — the reference

- **Commit:** GSL-289 — one commit on GSL-250-control-plane.
- **Files:**
  - `apps/core/src/runway.ts` — NEW. `computeRunway()` + helpers (`sessionAgeHours`,
    `contextHoursLeft`). Never throws — a DB read failure yields the empty-data shape.
  - `apps/core/src/routes/read.ts` — `/status` handler now folds `runway` into the response.
  - `packages/schema/src/index.ts` — added `RunwayClock` + `RunwayResult` zod schemas;
    `StatusResponse.runway` is optional (SDK compat with any pre-289 caller).
  - `apps/web/src/screens/Overview.tsx` — added `RunwayTile` (spans 2 cells in the grid).
    Reads `d.runway` directly off `StatusResponse`.
  - `apps/core/test/runway.test.ts` — NEW. 16 unit tests covering: age helper, extrapolation
    noise floors, empty fleet, single-agent binding, multi-agent min-wins, blockers > 0
    beats healthy context, blockers with no live agents, noise-floor null, null context_pct
    surfaces "ctx —", slot cap configurable, computed_at echoes injected now.
- **Verified by running:**
  - `bun test apps/core/test/runway.test.ts` → 16/16.
  - `bun x tsc -p apps/core --noEmit` → clean.
  - `bun x tsc -p apps/web --noEmit` → clean.
  - `bun x tsc -p packages/schema --noEmit` → clean.
  - `bash tools/lab/tests/core-smoke.sh` → 78 pass (unchanged — /status still parses).
  - Live probe: seeded one `agent_sessions` row (`gosleep-99`, context 40%, started 2h ago)
    and one open BLOCKER question; `GET /status` returned:
    ```
    runway.hours_left = 0
    runway.binding = "blockers"
    runway.clocks.context = { hours_left: 6, readout: "ctx 40% (gosleep-99)" }
    runway.clocks.blockers = { hours_left: 0, readout: "blockers 1" }
    runway.clocks.slots = { hours_left: null, readout: "slots 1/3" }
    ```
    — every field matches the calculator's contract. `apps/web/dist` rebuilt after the tile
    change so the SPA served at `/` includes the new component.
- **Links:** Jira [GSL-289](https://ainstance-labs.atlassian.net/browse/GSL-289),
  parent epic [GSL-250](https://ainstance-labs.atlassian.net/browse/GSL-250).
