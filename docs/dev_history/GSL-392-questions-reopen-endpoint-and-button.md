# GSL-392 — Manual reopen endpoint + "Reopen now" button for deferred questions

**Parent epic.** [GSL-388](https://ainstance-labs.atlassian.net/browse/GSL-388) — "[Core][Web] E2E run-01 findings — heartbeat + prompt-boundary + attribution + reopen + one-click".
**GH mirror.** https://github.com/ainstance-labs/gosleep/issues/385 (parent epic #381).
**Branch.** `GSL-388-e2e01-findings`.
**Commit.** `3315904`.

## What run-01 found

`docs/reports/verifications/harness-web-e2e-2026-08-17/runs/01/index.html` finding #4:
after a question was deferred (with or without a `defer_until` timer), the only paths
back to `status='open'` were (a) wait for the auto-reopen worker to fire at the timer
boundary, or (b) UPDATE SQLite by hand. `POST /actions/questions/answer` refused with
`"question ... is not open (status=deferred)"` and there was no
`/actions/questions/reopen` endpoint. Small workflow gap — but breaks the "I deferred
by mistake, let me undo that" and "I want to answer sooner than the preset" flows.

## Fix

### Core — new endpoint

`POST /actions/questions/reopen { qid, by? }` — mirrors the doDefer / doAnswer
patterns:

- 404 if the qid is unknown.
- 409 if the row is not `status='deferred'` — an accidental double-post cannot
  resurrect an already-answered / resolved question.
- 200 on the happy path with dual-write: `lab-emit reopen` (JSONL side) + direct
  UPDATE `status='open', defer_until=NULL` (immediate DB consistency), then a
  `question.reopened` SSE event with `seq: 0` for cross-tab wake.
- Wired through `serialize` + `withTimeline` so a replayed `Idempotency-Key` returns
  the cached response without re-firing lab-emit.

### Schema + SDK

`ReopenActionInput` / `ReopenActionResult` / `ReopenActionResponse` zod schemas in
`packages/schema/src/index.ts`; new SDK client method `reopenQuestion(input, idem)` in
`packages/sdk/src/index.ts`.

### Web

- `useReopenQuestion()` hook in `apps/web/src/data/queries.ts` (mirrors
  `useDeferQuestion`).
- "Reopen now" button on both deferred variants (with-timer and no-timer) in the
  Questions screen (`apps/web/src/screens/Questions.tsx`); invalidates
  `["core","questions"]` on success and pushes a success toast.
- The existing `question.*` prefix match in SseProvider picks up
  `question.reopened` for free.

## Tests

`apps/core/test/actions.reopen.test.ts` — 5 new tests, 5/5 pass:
- missing qid → 400 `qid required`
- unknown qid → 404 `question not found`
- non-deferred (open) qid → 409 `cannot be reopened`; row NOT mutated
- deferred qid → 200; row flips to `status='open', defer_until=NULL`; SSE
  `question.reopened` fans out for cross-tab invalidation
- replayed Idempotency-Key → `cached=true`; the row (manually flipped back to
  `deferred` between calls) is NOT re-updated on the cached replay

## Files touched

- `apps/core/src/routes/actions.ts` — `doReopen` + `POST /actions/questions/reopen`
  endpoint wiring.
- `apps/core/test/actions.reopen.test.ts` — new (5 tests).
- `packages/schema/src/index.ts` — 3 new zod exports.
- `packages/sdk/src/index.ts` — new client method + type re-exports.
- `apps/web/src/data/queries.ts` — `useReopenQuestion()` hook.
- `apps/web/src/screens/Questions.tsx` — `submitReopen` helper + "Reopen now"
  buttons on deferred cards (both variants).

## Gates

- `bun x tsc -p apps/core --noEmit` + `-p apps/web` — both clean.
- `bun test apps/core` — 431/431 pass (pre-follow-up).
- `bun test apps/web` — 104/104 pass.
- Web build — `dist/` OK, 965 KB main chunk (unchanged vs baseline).
