# GSL-381 — POST /actions/sessions/:id/submit-task + GET /sessions/:id/submissions

**Epic:** GSL-378 · **Branch:** `GSL-378-observer-task-submission` · **Base:** `origin/main` @ `a52b302`.

Wires the executor from GSL-380 behind the panel-facing endpoint under the three-layer
envelope (Bearer + Origin + Idempotency-Key), plus the history-drawer reader.

## Endpoints

### `POST /actions/sessions/:session_id/submit-task`

Two-phase submission with a MANDATORY dry-run preview (R16.3 / F16-S4). Both phases hit
the SAME endpoint under the SAME Idempotency-Key. Phase is selected by the request
body's `dry_run` flag:

- **`dry_run=true`** — compute preview (no side effects on tmux, no history row).
  Persists a `phase='preview'` marker in `server_intents.params` alongside the preview
  payload + `body_sha256` so a subsequent confirm can prove prior preview.
- **`dry_run=false`** — REQUIRE a prior preview marker under this Idempotency-Key whose
  `body_sha256` matches. Missing / mismatched → 428 (Precondition Required),
  `reason: "preview-required"`. Match → run the executor, write ONE `task_submissions`
  row, broadcast a synthetic `sessions.submissions.updated` SSE frame, then persist
  `phase='confirmed'` + result envelope. A replayed confirm returns the cached row (no
  re-run of the executor, same `submission_id`).

Serialised per-session via `serialize("session.submit." + session_id)` — R5 concurrent
submissions from two owners queue FIFO, and a preview + confirm from the same key
cannot interleave with a confirm for a different key on the same session (the mutex
scope is per-session).

Request body shape (both phases):

```json
{
  "body": "<UTF-8, ≤ 16 KB>",
  "framing": "none | prompt-boundary | slash-command",
  "dry_run": true | false,
  "by": "owner-web",
  "channel": "web"
}
```

Response envelope on happy path:

```json
{
  "ok": true,
  "intent_id": "<Idempotency-Key or minted UUID>",
  "cached": false,
  "finished_at": "2026-08-16T…Z",
  "result": { … PreviewOutcome or SubmitTaskResultEnvelope … }
}
```

HTTP statuses:

- `200` — preview success, confirm success (including cached replay), or a reachable
  guard rejection at confirm that still wrote a row (e.g. `outcome: "pane_gone"`).
- `400` — bad request body (missing `body`, `dry_run` not boolean, bogus framing enum,
  body validation failed).
- `409` — `reason: "session-not-controlled"` (R16.1) or `reason: "shim-not-registered"`
  (R16.2). Fired at BOTH preview and confirm — F16-S6 "release-mid-submit" is caught by
  the confirm-side re-run of the same guards.
- `428` — `reason: "preview-required"` (F16-S4). Fired on confirm when no prior preview
  under this key OR body_sha256 mismatch.

The endpoint layer NEVER inspects request body for the pane target — R16.4 pane
resolution lives inside the executor (`resolvePaneRef` reads `tmux_panes` live).

### `GET /sessions/:session_id/submissions`

Reader for the panel's history drawer. Returns rows newest-first, capped at 100
(`?limit=<n>` clamps to [1, 100]; default 50). Body itself never leaves the timeline
event payload — this route returns hash + byte-length only:

```json
{
  "submissions": [
    {
      "id": "<uuid>",
      "ts": "2026-08-16T…Z",
      "session_id": "sess-1",
      "pane_ref_at_dispatch": "gsl378-target:@1.%42",
      "body_sha256": "…64hex…",
      "body_len": 32,
      "framing": "prompt-boundary",
      "outcome": "delivered",
      "error": null
    }
  ],
  "count": 1
}
```

## SSE fan-out

`sessions.submissions.updated` — synthetic frame (not going through the tail indexer)
carrying `{session_id, submission_id, outcome, body_len, body_sha256, framing,
pane_ref_at_dispatch, by, channel}`. The panel invalidates its history-drawer query on
this event. Kept synthetic because `task_submissions` rows aren't `events` rows.
GSL-382 will add the separate `task.submitted` / `task.submit.failed` timeline events
that DO go through the events table.

## Tests

`apps/core/test/actions.submitTask.test.ts` — 15 endpoint tests split into three
groups:

- **Preview (7):** happy path (200 + preview payload with sha/length/target/framing/
  warnings); observer 409; shim-unregistered 409; body-invalid 400; missing dry_run 400;
  bogus framing 400; re-preview with same key returns cached:true.
- **Confirm (6):** no prior preview → 428 preview-required; body_sha256 mismatch after
  preview → 428; release-mid-submit (state flipped to observer between preview and
  confirm) → 409 session-not-controlled (F16-S6); pane_gone at confirm (delete
  `tmux_panes` row between preview and confirm) → 200 outcome=pane_gone + row inserted
  + zero tmux spawns (F16-S5); happy path → 200 outcome=delivered + row inserted + two
  argv-array tmux spawns (F16-S1); cached confirm replay returns same submission_id +
  no new row + no extra spawn.
- **GET reader (2):** newest-first ordering + no `body` field on any row (only
  `body_sha256`+`body_len`); empty history returns `{submissions:[], count:0}`.

**Test-isolation footnote.** Bun's `mock.module` resolves by module URL and the last
mock across test files can leak. This file's `mock.module('../src/db/client.ts', …)`
forwards the REAL `openDatabase` from the pre-mock import, only overriding `getDb` +
`defaultDbPath`. Otherwise `indexer.reconcile.test.ts` — which calls
`openDatabase(dbPath)` on a scratch filesystem path — receives the endpoint test's
singleton `:memory:` handle and its second test's `CREATE TABLE decisions` throws
"table already exists" (the classic mock-leak footprint).

Also NOT mocked: `authSource.ts` (whose real implementation reads
`process.env.GOSLEEP_BEARER_TOKEN` first — set to `"test-bearer"` at file top). If we
mocked authSource here, the fleet.projection + actions.decidePermission.sse tests would
also see our static "test-token" and their `test-bearer` requests would 401.

Full apps/core suite: 399 pass / 0 fail (384 baseline + 15 new).

## Core-smoke

`tools/lab/tests/core-smoke.sh` grew four scenarios under `GSL-381` block (72–75):

- 72. POST submit-task dry_run=true against a never-registered session_id → 409.
- 73. POST submit-task dry_run=false with no prior preview → 428.
- 74. POST submit-task without a boolean `dry_run` → 400.
- 75. GET /sessions/:id/submissions on an empty session → 200 + `submissions:[]`.

Ran on port 7354 (per mission — never prod 7331): `pass=106 fail=0`.

## Follow-ups

- GSL-382 will fan out `task.submitted` / `task.submit.failed` timeline events with
  `body_sha256` + `body_len` + `pane_ref` + `framing` on the payload, and hook the
  Timeline screen renderer to show a distinct submission badge.
- GSL-383 will wire the panel's Submit-task button + dialog + history drawer against
  the endpoints in this task.
