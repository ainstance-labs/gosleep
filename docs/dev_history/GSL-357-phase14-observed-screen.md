# GSL-357 — Observed screen (/observed) + NAV entry + wire collectors + observer_only badges

**Epic:** GSL-350 · **Branch:** `GSL-350-observer-mode-phase-a` · **Base:** `origin/main` @ `cc09415`.

New route `/observed` in `apps/web/src/router.tsx`, NAV entry in `AppShell` (Eye icon).
Screen at `apps/web/src/screens/Observed.tsx` renders three regions:

- **Left rail:** project list — colour swatch (deterministic FNV-1a hash → HSL), session
  count, last-activity, hidden badge. Selecting a project filters the session grid;
  "All projects" clears the filter.
- **Main:** session-card grid. Cards render project chip, tmux pane ref (correlated by cwd
  prefix against the tmux collector snapshot), model, status, `observer only — no control`
  badge on `observed_only=true` rows, and a "Work topic — inferred" section clearly labelled
  with an `inferred` Badge (owner decision 2026-08-16, depth = facts + work-topic).
- **Right rail:** collector inventory — name, source, cadence, last-tick, events-today,
  `writes N` (red text when > 0 — R14.1 empirical proof). The panel-level `writes N`
  aggregate at the top of the rail turns danger-toned on any non-zero total, so a stray
  write is impossible to miss.

TanStack Query hooks with 5-second refetch (`useObservedTmux`, `useObservedSessions`,
`useObservedProjects`, `useObservedCollectors`). The `observed.events` SSE topic is already
broadcast by the writer; wiring the client to that topic for instant invalidation is a
follow-up.

Also lands the GSL-356 web-side changes: Fleet cards render a muted `observer only` badge on
`observed_only=true` rows (title tooltip explains WHY — Phase 15 will add runtime
Take-control), plus `project_slug` + `tmux_pane_ref` chips in the sub-header.

## Package additions

- `packages/schema/src/index.ts` — `ObservedTmuxResponse` / `ObservedSessionsResponse` /
  `ObservedProjectsResponse` / `ObservedEventsResponse` / `ObservedCollectorsResponse` + row
  types. `FleetSession` extended with `project_slug`, `cwd_project_root`, `observed_only`,
  `tmux_pane_ref`.
- `packages/sdk/src/index.ts` — `observedTmux()` / `observedSessions()` / `observedProjects()`
  / `observedEvents(params?)` / `observedCollectors()` methods on `CoreClient`.
- `apps/web/src/data/queries.ts` — matching hooks + query keys.

## Wire (`apps/core/src/serve.ts`)

Registers `observedRoutes` between `internalRoutes` and `setupRoutes`. Boots
`startTmuxCollector` (2 s default, `GOSLEEP_OBSERVED_TMUX_MS` override) +
`startSessionsCollector` (5 s default, `GOSLEEP_OBSERVED_SESSIONS_MS` override) under a
`GOSLEEP_DISABLE_OBSERVED=1` gate for hermetic tests / smokes. Adds both to the shutdown
chain.
