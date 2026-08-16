# GSL-362 — session_control table + drizzle 0006 migration

**Epic:** GSL-361 · **Branch:** `GSL-361-observer-mode-phase-b` · **Base:** `origin/main` @ `7e44e59`.

Foundation for Phase 15 (observer-mode runtime control). Adds one new table —
`session_control` — the per-session registry the shim consults on every event and the
panel writes to when the owner presses Take/Release control.

Migration `apps/core/drizzle/0006_session_control.sql`:

- `session_control(session_id PK, state TEXT DEFAULT 'observer' NOT NULL,
  source TEXT DEFAULT 'runtime' NOT NULL, activated_at, activated_by, deactivated_at,
  shim_registered INTEGER DEFAULT 0 NOT NULL, last_heartbeat_at, last_heartbeat_pid)`.
- Indexes on `state` and `last_heartbeat_at` — the panel filters `WHERE state = 'controlled'`
  and future stale-shim surfacing keys on `last_heartbeat_at`.
- All additive per R28 (target-arch §12) — no DROP; the migration chain is forward-only.

Schema defaults chosen so a bare `INSERT INTO session_control (session_id) VALUES (?)` yields
a legal observer row (`shim_registered=0`, no activated timestamps). The registry writer in
`apps/core/src/control/registry.ts` never emits a bare INSERT — it always stamps
`shim_registered=1, last_heartbeat_at=<now>, last_heartbeat_pid=<pid>` on first heartbeat,
and stamps `activated_*` on any transition to `controlled`. The permissive default is a
safety net for future migration paths (e.g. a backfill script that seeds the table from
existing agent_sessions rows).

## Tests

`apps/core/test/schema.sessionControl.test.ts` — 4 tests:

- bare INSERT applies the declared defaults (state='observer', source='runtime',
  shim_registered=0, activated_at/deactivated_at NULL).
- PK collision throws on duplicate session_id.
- state / source / activated_* / heartbeat columns round-trip.
- `computeDbSchemaVersion()` reflects the new migration (drift assertion: removing 0006 from
  a scratch copy of `apps/core/drizzle/` changes the hash).

All four pass. Full apps/core suite: 350 pass, 0 fail after the migration lands (the
fleet.projection scratch DB also grew the table so its /fleet LEFT JOIN keeps compiling —
see GSL-363).

## Follow-ups

None. The table is minimum-viable for Phase 15 acceptance criteria (F15-S1..S6). If a future
phase needs to track more per-session metadata (e.g. take-control history beyond
"last transition"), the pattern is additive columns — never DROP.
