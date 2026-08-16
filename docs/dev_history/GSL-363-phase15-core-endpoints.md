# GSL-363 — Control registry + internal + read + write endpoints

**Epic:** GSL-361 · **Branch:** `GSL-361-observer-mode-phase-b` · **Base:** `origin/main` @ `7e44e59`.

Core-side plumbing for Phase 15. Six endpoints, one new module, two enriched projections,
one SSE topic.

## Registry module — `apps/core/src/control/registry.ts`

Thin DB layer over `session_control`. Everything is idempotent by (session_id, target-state):
`takeControl` on an already-controlled row returns `changed:false` rather than throwing;
same for `releaseControl` on an already-observer row.

- `readControl(db, sessionId): ControlRow | null` — primary-key lookup.
- `readEffectiveState(db, sessionId): { state, source, shim_registered }` — the shim's
  fast-path shape. A missing row collapses to `state='observer', source=null,
  shim_registered=false`.
- `recordHeartbeat(db, { session_id, pid, env_opt_in })` — creates the row on first fire
  (state defaults observer/runtime; env_opt_in escalates to controlled/env with
  activated_by='shim-env'), refreshes shim_registered + last_heartbeat_* on subsequent fires.
  Never overwrites a runtime-controlled row's source (owner's panel-take wins over env flag).
- `takeControl(db, { session_id, by })` — observer → controlled/runtime. Refuses 404 on
  missing row, 409 on shim_registered=false (R15.7).
- `releaseControl(db, { session_id, by })` — controlled/runtime → observer. Refuses 404 on
  missing row, 409 on env-locked (R15.3).
- `listControlled(db)` — every row currently in state='controlled', activated-desc.

13 unit tests in `apps/core/test/control.registry.test.ts` — every branch above +
`readEffectiveState`'s unknown-session_id default.

## Internal endpoints — `apps/core/src/routes/internal.ts`

- `GET  /internal/sessions/:session_id/control` — shim fast-path lookup (~5ms). Returns
  `{state, source, shim_registered}` from the effective-state helper.
- `POST /internal/sessions/:session_id/shim-heartbeat` — first-fire heartbeat +
  idempotent re-fires. Body `{pid?: number, env_opt_in?: boolean}`. On env_opt_in=true
  escalates to controlled/env immediately and fans out a synthetic
  `sessions.control.env-locked` SSE event; on normal fires fans out `sessions.control.heartbeat`.
  Both are `requireInternalSecret`-gated (shared with every other /internal/* route).

## Public read endpoints — `apps/core/src/routes/read.ts`

- `GET /sessions/:session_id/control` — Bearer-gated singular read. Returns the full row
  (state, source, activated_*, deactivated_at, shim_registered, last_heartbeat_at,
  env_locked, exists). `exists=false` on a missing row still yields a synthesised
  observer envelope so the panel can render `observer + Take disabled` without a null-guard.
- `GET /sessions?state=controlled` — Bearer-gated plural filter. Only supported filter
  today is `state=controlled` (400 on any other value).
- **`GET /fleet` enrichment** — LEFT JOIN `session_control` adds `control_state`,
  `control_source`, `control_activated_at`, `control_activated_by`, `shim_registered`,
  `env_locked` to every session row. Defaults on the wire: state='observer',
  source=null, shim_registered=false for a session whose shim never checked in.

## Write endpoints — `apps/core/src/routes/actions.ts`

- `POST /actions/sessions/:session_id/take-control`
- `POST /actions/sessions/:session_id/release-control`

Both under the standard three-layer envelope:

1. `requireBearer` (owner-gated).
2. `serialize("actions.sessions.<verb>.<session_id>", …)` per-session mutex.
3. `withTimeline` — server_intents ledger + persistent Idempotency-Key replay.

Body `{by?: string, channel?: string}` (defaults `owner-web` + `web`). Each transition
fires a `control.taken` / `control.released` event via `tools/lab/lab-log.sh` (goes through
the tail indexer → SSE fan-out) AND a synthetic `sessions.control.taken` /
`sessions.control.released` broadcaster event for immediate cache invalidation. Error
mapping: registry throws with `httpStatus` set (404 / 409); the route surfaces those
status codes back to the caller.

`/observed/sessions` also grew the same LEFT JOIN so the Observed screen renders the same
pill + toggle without a per-card round-trip.

## SDK + schema

`packages/schema` gains: `ControlState`, `ControlSource`, `SessionControlRow`,
`ControlledSessionRow`, `ControlledSessionsResponse`, `ControlTransitionInput`,
`ControlTransitionResult`, `ControlTransitionResponse`. `FleetSession` and
`ObservedSessionRow` grow the control_* fields.

`packages/sdk` gains: `sessionControl`, `controlledSessions`, `takeControl`, `releaseControl`
methods on `CoreClient`. Every mutation takes an Idempotency-Key so a double-click round-trips
as a cached replay.

## Tests

- `apps/core/test/control.registry.test.ts` — 13 registry unit tests.
- `apps/core/test/actions.sessionsControl.test.ts` — 7 HTTP tests:
  - take-control observer+registered → 200 controlled/runtime;
  - unknown session → 404;
  - shim_registered=0 → 409 (R15.7);
  - same Idempotency-Key replays cached;
  - release env-locked → 409 (R15.3);
  - release runtime-controlled → 200 observer;
  - release already-observer → 200 changed:false.
- `apps/core/test/fleet.projection.test.ts` — scratch DB grew a `session_control` CREATE
  TABLE so /fleet's LEFT JOIN compiles under the mock.

Full apps/core suite after this task lands: **350 pass, 0 fail** (5 fleet projection tests
included).

## SSE fan-out

- `sessions.control.taken` / `sessions.control.released` — fired by the write endpoints on
  every transition (including no-op changed:false paths so a second panel tab still
  refetches).
- `sessions.control.env-locked` / `sessions.control.heartbeat` — fired by the shim
  heartbeat endpoint so the panel enables the "Take control" button within a coalesce
  window of the shim's first invocation.

Web-side invalidation added in GSL-365 (SseProvider `sessions.control.*` branch).

## Follow-ups

None hard. Future v1.1 candidates:

- Stale-shim surfacing on the panel (Risk 4 in the PRD) — `last_heartbeat_at` and the
  `ix_session_control_last_heartbeat` index are already in place for this.
- Cross-machine control (Remote Control surface) — explicit PRD non-goal for v1; the
  registry API is host-local by construction.
