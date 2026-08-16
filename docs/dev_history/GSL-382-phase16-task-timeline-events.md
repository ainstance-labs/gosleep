# GSL-382 — Timeline event kinds `task.submitted` / `task.submit.failed`

**Epic:** GSL-378 · **Branch:** `GSL-378-observer-task-submission` · **Base:** `origin/main` @ `a52b302`.

Adds durable, timeline-visible events for every task-submission confirm phase — so the
Timeline screen shows a row for each submission, next to the existing `control.taken` /
`control.released` rows from Phase 15. The row is the primary long-term audit trail for
R16.6; the panel's per-session history drawer (GSL-381 `task_submissions` table) stays
the fast per-session lookup surface.

## Emission

`apps/core/src/routes/actions.ts` grew a `fireSubmissionTimelineEvent(kind, args)`
helper alongside the existing `fireSubmissionSse`. The confirm phase of
`POST /actions/sessions/:id/submit-task` calls it AFTER the executor returns and the
`task_submissions` row is inserted:

- Kind is chosen by outcome: `task.submitted` on `outcome='delivered'`;
  `task.submit.failed` on every reachable-refusal outcome (`pane_gone`,
  `released_mid_submit`, `not_at_prompt`, `send_failed`).
- Emission is two-legged, mirroring `fireControlTimelineEvent`:
  1. `spawnAwait bash tools/lab/lab-log.sh --type <kind> --actor <by> --src emit
     --data-json <payload>` — appends a JSONL row to `docs/lab/events/<day>.jsonl`. The
     tail indexer folds that JSONL row into the `events` table so the Timeline screen's
     paginated fetch sees it.
  2. `broadcaster.emit({type: kind, payload})` — pushes a synthetic SSE frame so the
     panel invalidates its `["core", "timeline"]` + `["core", "submissions"]` +
     `["core", "fleet"]` query caches within the coalesce window (250 ms). This is
     needed because the tail-indexer path is best-effort and can lag by a sweep.
- Fail-open: a failed `lab-log.sh` spawn warn-logs but does NOT roll back the DB row or
  the SSE frame. Same shape as `fireControlTimelineEvent`.

Payload shape (per PRD § "Timeline audit + provenance"):

```json
{
  "session_id": "sess-1",
  "submission_id": "<uuid>",
  "outcome": "delivered | pane_gone | released_mid_submit | not_at_prompt | send_failed",
  "body_len": 32,
  "body_sha256": "…64hex…",
  "framing": "prompt-boundary",
  "pane_ref_at_dispatch": "gsl378-target:@1.%42",
  "by": "owner-web",
  "channel": "web",
  "error": null,
  "body": "<the actual body — R16.6, retained per the timeline's retention policy>"
}
```

Note the payload carries the full `body` (subject to the timeline retention policy);
the `task_submissions` row deliberately does NOT (R16.6 keeps the row cheap).

## Renderer + SSE routing (apps/web)

- `apps/web/src/screens/Timeline.tsx` — added a `toneForEventType(type)` helper and
  passes the tone to the `<Badge>`. `task.submitted` → `accent`, `task.submit.failed` →
  `warn`, `sessions.submissions.updated` → `info`, `control.taken` → `ok`,
  `control.released` → `info`. Everything else stays `neutral`.
- `apps/web/src/data/SseProvider.tsx` — added an EXPLICIT branch for
  `task.submitted | task.submit.failed` BEFORE the generic `task.*` clause (which
  invalidates the Jira tasks query). Submission events invalidate `submissions` +
  `fleet` (the fleet card may have flipped as the reason for a failed submission);
  they DO NOT invalidate `tasks`.
- `apps/web/src/data/SseProvider.tsx` also learned `sessions.submissions.updated` →
  `submissions` invalidation (the synthetic frame GSL-381 fires from the confirm path).
- `apps/web/src/data/queries.ts` — new `queryKeys.submissions(sessionId, limit?)` key
  under `["core", "submissions", <sessionId>, <limit>]` so the SseProvider's
  `invalidator.schedule("submissions")` matches TanStack Query's root-key prefix
  invalidation.

## Tests

`apps/core/test/actions.submitTask.test.ts` grew a "Timeline event kinds (GSL-382)"
describe block with 2 tests:

- delivered outcome fires `lab-log.sh --type task.submitted --data-json <payload>` and
  the payload carries `{session_id, outcome:"delivered", body, body_len, body_sha256,
  framing, error:null}`.
- pane_gone outcome fires `lab-log.sh --type task.submit.failed --data-json <payload>`
  and the payload carries the non-null `error` string.

Adjacent regression fixes to the GSL-381 tests: the happy-path + pane_gone assertions
filter `spawnCalls` by `c[0] === "tmux"` before counting send-keys invocations, since
the timeline emit is a third `bash lab-log.sh` spawn (or a first one on
short-circuited paths). Cached-replay assertion tightened to "no spawns of ANY kind".

Full apps/core suite: 401 pass / 0 fail (399 baseline + 2 new). apps/web suite:
81 pass / 0 fail (unchanged — no new web tests required for the Timeline tone/routing
tweak).

## Follow-ups

- GSL-383 will render the SubmissionHistory drawer inside the Fleet/Observed card and
  wire the Submit-task dialog to `sdk.submitTask` — driven by the same `submissions`
  invalidator key added here.
