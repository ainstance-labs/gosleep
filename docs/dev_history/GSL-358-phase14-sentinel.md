# GSL-358 — Write-attempt sentinel + collector inventory + test-isolation helper

**Epic:** GSL-350 · **Branch:** `GSL-350-observer-mode-phase-a` · **Base:** `origin/main` @ `cc09415`.

`apps/core/src/observed/sentinel.ts` — R14.1 turned into a structural invariant, not
discipline. Every observer-mode collector runs through `runCollectorTick(name, fn)` — the
sentinel tallies wall-clock, records last-error, and exposes an inventory row per collector
(`name, source, cadence_ms, last_tick_at, last_tick_ms, last_error, events_today,
write_attempts, disabled`).

A `noteWriteAttempt(name, kind, detail)` hook a defensive wrapper (or a test) can call trips
the invariant: increments the counter, logs `WRITE_ATTEMPT_DENIED` JSON to stderr, and
disables the collector until process restart. `/observed/collectors` (GSL-355) surfaces the
counter red when > 0.

The v1 sentinel is intentionally lightweight (no seatbelt/bpf sandbox — explicitly out of
scope per the PRD). Three defences:
1. Observed-events writer (`events.ts`) is the ONLY sanctioned INSERT path into
   `observed_events`.
2. Collectors are code-reviewed for their declared side-effect set (each names its READS /
   WRITES / SPAWNS in a header comment).
3. Callable `noteWriteAttempt` records + disables on violation; the panel surfaces the
   counter red.

## Test-isolation helper

`__resetDbClientForTests()` in `apps/core/src/db/client.ts` — test-only, resets the cached
DB singleton so a per-file scratch DB can be used cleanly. Consumed by the observer-mode
test suite; other tests keep the singleton behaviour.

`apps/core/test/schema.observer.test.ts` refactored to construct its Database + drizzle
handle directly instead of going through `openDatabase`, so it survives cross-file
`mock.module` contamination that other tests install on `db/client.ts` (bun:test module
mocks are process-wide and irreversible).

## Tests

Covered in `apps/core/test/observed.events.test.ts` — `noteWriteAttempt` trips the invariant
(write_attempts=1, disabled=true, last_error contains the kind slug).
