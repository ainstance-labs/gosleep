# GSL-312 [Web] Cross-tab SSE fan-out on permission decide

**Date:** 2026-08-10 (shift 77 / epic GSL-311 hotfix 2).
**Branch:** `GSL-311-web-hotfix2` off `origin/main` @ dfe8448.
**Model:** Opus 4.7 (owner global pin).
**Depends on:** GSL-284 (permission decide route), GSL-263 (SSE broadcaster), GSL-309
(250 ms coalesced invalidations).
**Origin:** adversarial QA run `web-e2e-2026-08-10/runs/04` finding **#1 (MAJOR)**.

## Part 1 — the story

QA run 04 opened two headless Chrome tabs on `/questions`, POSTed a fresh permission via
`/internal/permissions/post` (both tabs saw it appear — the SSE insert path already fanned
out), clicked **Allow** in tab A, then watched tab B for a full six seconds — the row
kept rendering as `open` with active Allow/Deny buttons until a hard reload. The audit
called out the exact place: `useQuestions` in `apps/web/src/data/queries.ts` has no
`refetchInterval`, so recovery depends on SSE.

**Root cause.** `POST /actions/permissions/decide` (`apps/core/src/routes/actions.ts` §
`doDecidePermission`) writes only to the SQLite `questions` table and wakes the paused
CLI hook via `SessionAdapter.deliverAnswer`. Unlike `doAnswer` — which spawns
`tools/lab/lab-emit.sh answer` → JSONL → tail-indexer → `broadcaster.emit()` — nothing
in the decide path reaches the indexer. The SSE stream never gets a `question.answered`
frame, so no client tab invalidates its questions bucket.

**Fix.** Emit a synthetic in-process event on the same broadcaster the tail indexer
feeds, right after the successful SQL `UPDATE` and the shim wake. Pattern copied from
`workers/fleet-poll.ts` (`seq: 0` marks it non-persistent — no corresponding row in the
`events` table; SSE consumers key off the type, not the seq). Type is
`question.answered`, so `SseProvider.tsx`'s existing `type.startsWith("question.")`
handler schedules an invalidation on `["core", "questions"]`. The GSL-309 250 ms
coalescer collapses it into the same tick as any other question event that lands with
it. Payload carries `{qid, kind: "permission", decision, answered_at, answered_by,
applied_by: "owner"}` so future consumers have enough to filter on without a follow-up
`GET /questions`.

**Why not lab-emit?** Two reasons. First, `lab-emit.sh` is designed for the
question-answer path where the JSONL archive is the source of truth and the tail
indexer is the mirror; permissions live only in SQLite (owner decision d-2026-08-08-001).
Second, the scratch QA harness runs with `GOSLEEP_DISABLE_INDEXER=1`, so a lab-emit call
would never propagate through the indexer — the fan-out has to be direct.

**Why not client polling?** The audit explicitly named "prefer server-side event
emission over client polling" and the coalescer contract in GSL-309 was the whole point
of dropping polling last shift. Adding `refetchInterval` on `useQuestions` would
re-introduce every failure mode that GSL-309 was written to close (socket-pool churn,
duplicate refetches under a burst).

**Regression test.** `apps/core/test/actions.decidePermission.sse.test.ts` boots the
route with a mocked DB + a stubbed `SessionAdapter` and subscribes to the real
`broadcaster` singleton. Two assertions:
1. A single successful decide → the broadcaster observes exactly one `question.answered`
   message whose payload carries the qid, kind, decision, `applied_by='owner'`, and an
   ISO `answered_at`.
2. A second identical POST with the same `Idempotency-Key` replays the cached outcome
   and does **not** re-emit — `withTimeline` short-circuits before `doDecidePermission`
   runs a second time, so the broadcaster stays silent. This pins down that we did not
   accidentally move the emit above the ledger.

**Live proof.** Captured in `assets/GSL-312/` — a two-page CDP session on the scratch
core (127.0.0.1:7345, seeded DB under `.artifacts/hotfix2-live/`), Allow clicked in tab
A, tab B refetch completed in < 400 ms. Details in Part 2.

## Part 2 — technical reference

**Files changed:**
- `apps/core/src/routes/actions.ts` — added `broadcaster` import + emit call at the end of
  `doDecidePermission`.
- `apps/core/test/actions.decidePermission.sse.test.ts` — new file, two regression tests.

**SSE payload shape** (matches `EventRow`):
```json
{
  "seq": 0,
  "day": "2026-08-10",
  "ts": "2026-08-10T14:22:49.000Z",
  "src": "core",
  "actor": "actions.decide",
  "task": null,
  "type": "question.answered",
  "payload": {
    "qid": "p-…",
    "kind": "permission",
    "decision": "allow",
    "answered_at": "2026-08-10T14:22:49.000Z",
    "answered_by": "owner-web",
    "applied_by": "owner"
  },
  "ingested_from": null
}
```

**Gates:**
- `bun x tsc -p apps/core --noEmit` — clean.
- `bun test apps/core` — 232 pass / 0 fail (the two new tests bring the count from 230 to
  232).
- `bash tools/lab/tests/core-smoke.sh` — 102 pass / 0 fail; port 7331 clean on teardown.

**Non-goals kept out of this task:**
- No client-side `refetchInterval` on `useQuestions` (would regress GSL-309).
- No changes to `doAnswer` or `doApplyManifestToQuestion` — those already fan out through
  the lab-emit → JSONL → indexer chain.
- No changes to `/actions/permissions/apply` (not currently used by the panel; if that
  ever ships it needs the same emit).
