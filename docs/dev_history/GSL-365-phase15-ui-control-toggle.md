# GSL-365 — Web control-toggle + Fleet/Observed wiring + SSE invalidation

**Epic:** GSL-361 · **Branch:** `GSL-361-observer-mode-phase-b` · **Base:** `origin/main` @ `7e44e59`.

Panel-side surface for Phase 15. One new component, two screen wire-ups, four hooks, one
SSE branch.

## Component — `apps/web/src/components/ControlToggle.tsx`

Three-state pill + affordance:

- **env-locked** — `warn` tone badge with the padlock-semantic tooltip. No button. Owner
  must restart the session in a shell without `GOSLEEP_WEB_QUESTIONS=1` (R15.3).
- **controlled** (source=runtime) — `accent` tone badge + **Release control** button.
- **observer**, `shim_registered=true` — `neutral` badge + enabled **Take control** button.
- **observer**, `shim_registered=false` — `neutral` badge + DISABLED **Take control**
  button with a tooltip explaining why (R15.7: shim must have checked in first).

Every button click fires a mutation with a stable Idempotency-Key (via
`stableIdempotencyKey`); the server replays the cached outcome on a double-click so the
"changed:false" no-op path is a first-class citizen.

## Hooks — `apps/web/src/data/queries.ts`

- `useSessionControl(sessionId)` — Bearer read of `/sessions/:id/control`.
- `useControlledSessions()` — `/sessions?state=controlled`, 15s refetch.
- `useTakeControl()` — POSTs `/actions/sessions/:id/take-control`, invalidates
  fleet + session-control + controlled-sessions + timeline on success.
- `useReleaseControl()` — POSTs `/actions/sessions/:id/release-control`, same
  invalidations.

New query-key branches: `queryKeys.sessionControl(sessionId)` and
`queryKeys.controlledSessions()`.

## Screen integration

- **Fleet.tsx** — `<ControlToggle>` at the bottom of every non-ended card. Reads
  `s.control_state / s.control_source / s.shim_registered / s.env_locked` from the enriched
  /fleet payload (GSL-363 LEFT JOIN).
- **Observed.tsx** — `<ControlToggle>` at the bottom of every non-ended card. Reads the
  same shape from `/observed/sessions` (GSL-363 also enriched this endpoint).

The pre-Phase-B "observer only — no control" static badge on Observed cards is kept
alongside the toggle: it flags `observed_only=true` (no gosleep hook wired in the project),
which is orthogonal to the runtime-control state. A session can be `observer + observed_only`
(shim not there yet, cannot take control until the shim wires up) or `observer +
shim_registered` (shim is there, panel can flip). The toggle handles both correctly via the
disabled-button tooltip path.

## SSE — `apps/web/src/data/SseProvider.tsx`

New branch:

```
} else if (type.startsWith("sessions.control.")) {
  invalidator.schedule("fleet");
  invalidator.schedule("sessions");
  invalidator.schedule("observed");
}
```

Coalesced within the existing 250ms window. F15-S3's sub-second cutover flows from this:
release-control fires the SSE event, the invalidator collapses concurrent hits into a
single refetch, and the pill flips within one round-trip of the coalesce window.

## Gates

- `bun x tsc -p apps/web --noEmit` — clean.
- `bun x tsc -p packages/schema --noEmit` — clean.
- `bun x tsc -p packages/sdk --noEmit` — clean.
- `bun run --filter='@gosleep/web' build` — clean; dist bundle 948 kB / 276 kB gzipped
  (same as pre-change ± the small ControlToggle addition).

## Follow-ups

None. The three-state surface covers every documented shape (F15-S1..S6). Future v1.1
polish: a confirmation dialog on Take/Release could re-add friction, but the owner brief
called explicitly for "presses a button" — no confirm, no counter-intuitive prompt.
