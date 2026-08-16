# GSL-351 — Observer-mode schema: tmux_panes + observed_events + agent_sessions extensions

**Epic:** GSL-350 · **Branch:** `GSL-350-observer-mode-phase-a` · **Base:** `origin/main` @ `cc09415`.

Foundation for Phase 14. Adds two new tables (`tmux_panes`, `observed_events`) and three
additive columns on `agent_sessions` (`project_slug`, `cwd_project_root`, `observed_only`).
All additive per R28 (target-arch §12) — no DROP, migrations chain forward-only.

Migration `apps/core/drizzle/0005_observer_mode_phase_a.sql`:
- `tmux_panes(pane_id PK, session_id, session_name, window_id, pane_pid, pane_current_path,
  pane_current_command, pane_title, first_seen, last_seen, misses)`; indexes on `last_seen`
  + `pane_pid` (the second supports the /fleet LEFT JOIN in GSL-356).
- `observed_events(seq PK auto, ts, project_slug, kind, source, payload_json)`; indexes on
  `ts`, `(project_slug, ts)`, `(kind, ts)`. `source` is enforced as an enum in the TS writer
  (GSL-355), not SQL.
- `agent_sessions` gets `project_slug TEXT`, `cwd_project_root TEXT`, `observed_only INTEGER
  DEFAULT 0 NOT NULL`. Legacy inserts keep `observed_only=0` (Fleet behaviour unchanged,
  R14.3).

## Tests

`apps/core/test/schema.observer.test.ts` — 4 tests:
- `tmux_panes` PK collision throws on duplicate `pane_id`.
- `observed_events.seq` autoincrements monotonically.
- `agent_sessions.observed_only` defaults to `0` on legacy INSERT that omits the column.
- `computeDbSchemaVersion` reflects the new migration file (drift-from-truncated-chain
  assertion — asserts the schema-version hash sees the new 0005 file).

Uses `new Database()` + `drizzle()` directly (NOT `openDatabase` from `db/client.ts`) so
process-wide `mock.module` replacements installed by earlier test files do not contaminate
the migration path.
