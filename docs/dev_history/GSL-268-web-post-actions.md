# GSL-268 — POST /actions/{answer,resolve,tick,ack} + four UI buttons

**Date:** 2026-08-07 · **Epic:** GSL-250 (interactive control plane) · **Branch:** `GSL-250-control-plane`
**Shift:** 75 · **Cycle:** 204 · **Worker:** `impl-web-7`
**Depends on:** GSL-274 PASS (`allow`+`updatedInput` as primary answer path), GSL-264 (Bearer + Origin middleware), GSL-263 (SSE broadcaster).

## What was done

The control plane grew its first four real write buttons and the endpoint layer they sit on.
The panel is no longer read-only: the owner can now, from the web:

- **Answer** an open question in the Questions screen (opens a text dialog).
- **Mark resolved** an open or answered question (opens a text dialog for the applied outcome).
- **Run tick** on the Overview screen (a "fire the safety tick right now" button).
- **Ack** any event on the Timeline screen (expand → Ack seq N).

Each button POSTs a JSON body to a `/actions/…` endpoint on gosleep-core. The endpoint validates
the body, serialises behind a per-endpoint mutex, wraps the mutation in `withTimeline` (which writes
a `server_intents` row on entry and a status='ok'/'fail' row on exit), spawns the corresponding
shell tool from `tools/lab/` (dual-write into `queue.jsonl` + `events/*.jsonl`), and for the
`questions.*` actions also updates the questions table directly for immediate consistency. The
`Idempotency-Key` request header is echoed back to the client and is used as the primary key of
the ledger row — a second POST with the same key does NOT re-run the tool, it replays the original
response body from the ledger.

The Answer contract is the one GSL-274 validated: the answer is recorded in SQLite with
`actor='owner-web'` (and stamped that way on the events JSONL and the SSE frame) BEFORE it reaches
the agent. When GSL-275 lands the `PreToolUse{AskUserQuestion}` shim + the long-poll
`/internal/questions/wait` endpoint, that endpoint reads THIS row and returns `allow` +
`updatedInput` to the hook — provenance stays in the DB, not in the transcript.

## Problems solved

- **Persistent idempotency, not the in-memory placeholder the red team called out.** `withTimeline`
  stores the intent row in SQLite; a process restart replays cleanly, and the client's
  `Idempotency-Key` header survives across the crash-restart boundary. Cross-endpoint key reuse
  is refused (not silently applied) — the ledger records the original endpoint and any second
  request against a different endpoint gets a 409 with an explanatory error.
- **Concurrency=1 per endpoint.** `serialize(endpoint, fn)` is a per-endpoint promise chain so
  two concurrent POSTs to `/actions/questions/answer` run one after the other rather than racing
  the questions table's `status='open' → 'answered'` UPDATE. A shared mkdir lock in `lab-emit.sh`
  is not enough — the direct DB write happens outside that lock; the mutex closes the gap. Tests
  cover both "same endpoint serializes" and "different endpoints interleave".
- **Guard `status='open'` at the endpoint layer** (target-arch section 6.2, red-team finding 11).
  The route reads the row, refuses non-open with 409, then does the mutation. The UPDATE itself
  is also guarded with `WHERE qid = ? AND status = 'open'` so a race the mutex missed still fails
  safely (rows_affected==0 → throw a race error, ledger records the fail).
- **Fire-and-forget tick.** `tools/lab/tick.sh --force` takes multiple seconds and would time
  out the HTTP response if awaited. `spawnDetached` kicks it off with a 120 s timeout ceiling
  and returns immediately with the intent_id; the tick's own ledger event lifts onto SSE later.
- **Dev-vs-prod null semantics.** `bun:sqlite`'s `.get()` returns `null` on no-match, not
  `undefined`. First smoke run failed on `evt === undefined` for the "unknown seq" case (500
  instead of 404). Fixed by widening the guard to `null || undefined` — bun:sqlite may change
  this in a future release; we accept both.

## Problems remaining

- **The direct UPDATE on `questions` is fast, but the tail's re-fold of `queue.jsonl` will run
  again once the tail catches up.** Both paths are idempotent by design (queue's `fold()` is
  order-independent; the UPSERT converges to the same row shape), and the schema.ts author
  documented that behavior explicitly. Still worth naming: if the tail is ever changed to
  overwrite rather than fold, the direct-UPDATE path must be revisited.
- **`answered_by` and `channel` are stored in the events JSONL but NOT in a `questions` column.**
  The Delta 8.2 provenance columns (`applied_by`, `applied_rule_ref`) are GSL-277 scope; the answer
  path meanwhile carries provenance in the events row and in the queue.jsonl patch, but a
  read-only client that only queries `/questions` sees the answer text without the actor. This
  matches the addendum's split — provenance lives in events until GSL-277 broadens the schema.
- **Concurrency across processes is not addressed here.** launchd runs exactly one core
  instance, so the in-process mutex is enough. If a future task adds a sidecar core, the mutex
  becomes a `PRAGMA locking_mode=EXCLUSIVE` on the questions row plus the mkdir lock in
  `lab-emit.sh`. Filed under "when it becomes a problem".

## Pitfalls & workarounds

- **Bun spawn env leakage.** `Bun.spawn` inherits the parent env by default — but the smoke
  fixture (`GOSLEEP_LAB_DIR=$WORK/lab`) must NOT leak into the launchd-installed production
  process. `spawn.ts` deliberately does NOT `...process.env`; only PATH, HOME, GOSLEEP_LAB_DIR,
  GOSLEEP_RUN_ID, and the caller-supplied env pass through. Do not "simplify" this to spread
  `process.env` — a stray env var (GOSLEEP_BEARER_TOKEN, GOSLEEP_DB_PATH) leaking into a
  lab-emit spawn would silently make the tool write to the wrong DB or authenticate against a
  test bearer.
- **Hono `Context` type.** The first cut of `parseJsonBody` used
  `Parameters<Parameters<typeof actionsRoutes.post>[1]>[0]` to infer the context type — that
  resolved to `never` inside a strict-TS build because Hono's overload list defeats the
  inference. Replaced with the direct `Context` import from `hono`. If you see
  `TS2493: Tuple type '[path: string]'` again, this is why.
- **`hono/streaming` never-resolve-early trap.** Not this task's code — but I confirmed the
  SSE fan-out worked for `question.answered` by watching a bg curl against `/events`. If the
  broadcaster ever "returns silently", check whether an early `return` sneaked into the
  streamSSE callback (Hono #2050); the tail indexer, the broadcaster, and the events route
  each carry a comment about it.
- **Radix Dialog `data-[state=open]:animate-in`.** Tailwind v4 does NOT ship `animate-in` /
  `animate-out` by default; the classes render as literal strings and the dialog just appears.
  That's cosmetic — good enough for a v1 button — but a follow-up UI polish task should add
  `tailwindcss-animate` to the plugins.
- **`textarea` `autoFocus` on a Radix-Dialog panel** occasionally races the portal mount; the
  first render keeps focus on the "Answer" trigger button and the user has to Tab into the
  textarea. If this bites in practice, wrap the textarea in `useEffect(() => { ref.focus() })`
  fired after `open === true`.

## What didn't make it

- **A `POST /actions/questions/defer`.** Rev-3 addendum Delta 8.3 moved this to sibling
  `GSL-278` (adds a `deferred` status enum + `defer_until` column). Not built here — the four
  endpoints in scope are answer / resolve / tick / ack.
- **`POST /actions/questions/apply-manifest`.** Same — moved to `GSL-277` with the provenance
  columns. Not built here.
- **The hook shim body + long-poll endpoint** (`POST /internal/questions/post` + `GET
  /internal/questions/<qid>/wait` + `tools/hooks/ask-user-question-hook.sh`). That is `GSL-275`;
  this task explicitly does NOT install anything into `.claude/settings.json`, and the mission
  reiterated that the shim installation is `GSL-267` scope.
- **A `POST /actions/skills/publish`** (the "first write button" of the original plan). Blocked
  on `tools/skills/publish.sh` from the postponed `GSL-174` epic — that file does not exist in
  the tree today. Documented in the completion report to the team lead; `GSL-266` stays To Do.

## Part 2 — technical reference

### Commit
- Will land as one commit on branch `GSL-250-control-plane` right after this file.

### Key files touched
- `apps/core/src/actions/spawn.ts` (new) — `spawnAwait` / `spawnDetached`; env whitelist.
- `apps/core/src/actions/mutex.ts` (new) — per-endpoint promise-chain mutex.
- `apps/core/src/actions/withTimeline.ts` (new) — server_intents ledger + idempotency contract.
- `apps/core/src/routes/actions.ts` (new) — the four POST endpoints and their doAnswer /
  doResolve / doAck / doTick helpers.
- `apps/core/src/serve.ts` — wires `actionsRoutes` onto the Hono app.
- `apps/core/test/actions.test.ts` (new) — 11 unit tests over `resolveIntentId`, `withTimeline`,
  and the mutex.
- `packages/schema/src/index.ts` — `AnswerActionInput/Response`, `ResolveActionInput/Response`,
  `AckActionInput/Response`, `TickActionInput/Response`.
- `packages/sdk/src/index.ts` — `answerQuestion` / `resolveQuestion` / `ackEvent` / `runTick`
  plus a shared `postAction` helper (accepts an Idempotency-Key per call).
- `apps/web/src/components/ui/Dialog.tsx` (new) — Radix Dialog wrapper for the four buttons.
- `apps/web/src/data/queries.ts` — `useAnswerQuestion` / `useResolveQuestion` / `useAckEvent` /
  `useRunTick` mutation hooks (mint fresh Idempotency-Key per call via `crypto.randomUUID`).
- `apps/web/src/screens/Questions.tsx` — Answer + Mark resolved buttons + dialogs.
- `apps/web/src/screens/Overview.tsx` — Run tick button + confirm dialog.
- `apps/web/src/screens/Timeline.tsx` — Ack seq N button on the expanded row + dialog.
- `tools/lab/tests/core-smoke.sh` — extended: scratch DB + scratch lab dir, seven new scenarios
  (401 without Bearer, 403 for missing/bad Origin, 200 for a valid tick + intent_id echo,
  cached-replay 200+cached:true, 404 for unknown seq, 400 for missing qid).
- `tools/lab/tests/action-live-proof.sh` (new) — the mission's live-proof; described below.

### Verified by running
- **`bun test apps/core`** → 42 pass, 0 fail (11 new; existing 31 preserved).
- **`bun x tsc -p apps/core --noEmit`** clean.
- **`bun x tsc -p apps/web --noEmit`** clean.
- **`bun x tsc -p packages/schema --noEmit`** clean.
- **`bun x tsc -p packages/sdk --noEmit`** clean.
- **`bash tools/lab/tests/core-smoke.sh`** → 20/20 pass, port clean after teardown.
- **`bash tools/lab/tests/action-live-proof.sh`** → 13/13 pass. End-to-end proof:
  1. Seeded `q-2026-08-07-001` via `lab-emit question` (BLOCKER, task GSL-268).
  2. Imported into the scratch SQLite via `import-jsonl.ts` (row visible with status=open).
  3. Booted `apps/core/src/serve.ts` on 127.0.0.1:7331 against the scratch DB + lab dir.
  4. `POST /actions/questions/answer` with `Idempotency-Key: live-proof-answer-<epoch>` →
     `HTTP 200 { ok:true, intent_id, cached:false, result:{...answered_by:'owner-web', channel:'web', labEmit.rc:0} }`.
  5. `server_intents` row for the intent_id: `status=ok`.
  6. `questions` row: `status=answered, answer_text='YES — …', answered_at=…`.
  7. `queue.jsonl` last line: `{"re":"q-…","status":"answered","answer":"…","answered_by":"owner-web","channel":"web"}`.
  8. `events/2026-08-07.jsonl` last line: `{"type":"question.answered","actor":"owner-web","task":"GSL-268",…}`.
  9. Background `curl -N /events` captured `event: question.answered` with the same payload
     on the SSE wire (id=seq).
  10. Replay POST with the same `Idempotency-Key` → `HTTP 200 { cached:true }`;
      `events/*.jsonl` still has exactly one `question.answered` line (replay did NOT spawn a
      second lab-emit).
- **`bash tools/lab/gate.sh --offline`** → `VERDICT: all gates green`. (smoke 551/0, hooks-verify
  11/0, tsc clean, chronicler clean.)
- **`bash tools/lab/smoke.sh`** → PASS=551 FAIL=0 (independent run; no regression from the
  action tree).

### Links
- Jira: [GSL-268](https://ainstance-labs.atlassian.net/browse/GSL-268), parent [GSL-250](https://ainstance-labs.atlassian.net/browse/GSL-250).
- Dev history for the answer-loop smoke this task's contract depends on: [GSL-274](GSL-274-web-answer-loop-smoke.md).
- Rev-3 addendum Delta 1 (answer loop contract): `docs/reports/web-harness-research-2026-08-03/target-architecture-rev3-addendum.md`.
- Original target-architecture section 6.2 (v1 action list) and 7 (auth priorities per action
  class): `docs/reports/web-harness-research-2026-08-03/target-architecture.md`.
