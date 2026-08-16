# GSL-355 — Observed-events writer + /observed read routes + SSE topic

**Epic:** GSL-350 · **Branch:** `GSL-350-observer-mode-phase-a` · **Base:** `origin/main` @ `cc09415`.

`apps/core/src/observed/events.ts` — `appendObservedEvent({project_slug, kind, source,
payload?})` — the ONLY sanctioned path from a collector into `observed_events`. Sentinel
review time: a collector that writes directly to the table is a violation. Refuses
`source='hook'` at the writer level (R14.4) so a bug in a collector cannot pollute the
observed timeline with hook-shaped rows.

`apps/core/src/sse/broadcaster.ts` gains a distinct `observed` wire kind. The gosleep
`event` topic and the observed `observed` topic coexist without collision (R14.7 — panel
UIs subscribe by kind, not by shared channel).

Bearer-gated read routes (`apps/core/src/routes/observed.ts`):
- `GET /observed/tmux` — snapshot of `tmux_panes` (last_seen desc, cap 500).
- `GET /observed/sessions` — machine-wide Claude sessions with `observed_only` boolean.
- `GET /observed/projects` — project projection (colour + hide-list pseudonym).
- `GET /observed/events` — cross-project timeline; `?since`, `?limit`, `?project` filters.
- `GET /observed/collectors` — inventory + `write_attempts_total` (R14.1 proof).

## Tests

`apps/core/test/observed.events.test.ts` — 5 tests: writer round-trip + SSE broadcast,
`hook` source rejection, project-filtered read, collector inventory bump, sentinel
`noteWriteAttempt` disable.

The test's `mock.module("../src/db/client.ts", …)` preserves the REAL `openDatabase`
function reference (imported before the mock installs) so downstream tests
(`indexer.tail.test.ts`, `indexer.reconcile.test.ts`) that run later in the same bun:test
process still see the real function — bun:test's module-level mock is process-wide and
irreversible.
