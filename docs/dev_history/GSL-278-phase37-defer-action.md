# GSL-278 — Defer action on questions: enum extension + POST /actions/questions/defer + UI button

Phase 37 (web control plane, epic GSL-250). Branch: `GSL-250-control-plane`.

## What was done

Gave the owner a fourth response type on the Questions screen — a "not now, ask me later" that flips a question to `status='deferred'` with an optional auto-reopen timestamp, and gave the core a small worker that reopens the row automatically when the timer fires. Rev-3 addendum Delta 8.3. Owner requirement R2 now has all four states real (`answer` / `resolve` / `apply-manifest` / `defer`). Seven ingredients:

1. **Schema piggybacks on GSL-277's shared migration** (`apps/core/drizzle/0002_manifest_defer.sql`) — the `defer_until TEXT` column landed with the provenance columns per Jira "shared migration" scope. No new migration file.
2. **`lab-emit defer` + `lab-emit reopen` verbs** (`tools/lab/lab-emit.sh`):
   - `defer --re <qid> [--defer-until ISO-UTC] [--by owner|auto]` appends `{re, ts, status:"deferred", defer_until, deferred_by}` to `docs/lab/questions/queue.jsonl` (append-only C8), then emits a `question.deferred` semantic event.
   - `reopen --re <qid> [--by auto|owner]` appends `{re, ts, status:"open", defer_until:"", reopened_by}` and emits `question.reopened`. Empty `defer_until` is the signal the fold layer uses to CLEAR the field on the next sweep.
   - Guards: `defer` refuses a non-`open|answered` record ("closed is terminal, superseded moved on"); `reopen` refuses a non-`deferred` record. Both append-only, both under the shared queue mkdir lock.
   - `question.deferred` + `question.reopened` added to the `SEMANTIC_TYPES` tuple so the event validator accepts them; `tools/lab/ui/src/severity.ts` graded WARN and INFO respectively.
3. **`POST /actions/questions/defer`** (`apps/core/src/routes/actions.ts`):
   - Body: `{qid, defer_until?, by?}`. `defer_until` is optional; missing or `null` means "no timer" (owner reopens by hand). A malformed string ("tomorrow", "future") is rejected at the route layer with 400 before ever touching the ledger.
   - Guard: existence + status must be `open|answered` (409 otherwise).
   - Dual-write step 1: `bash lab-emit.sh defer --re <qid> --by <by>` (with `--defer-until` when provided).
   - Dual-write step 2: direct `UPDATE questions SET status='deferred', defer_until=? WHERE qid=? AND status IN ('open','answered')`.
   - **NO `questionNotifier.notify()` here** — per Jira scope, deferring MUST NOT deliver anything back to the asking agent's PreToolUse long-poll. The hook keeps waiting for a real answer; the deferred question is invisible to the agent's answer channel until the owner actually answers.
4. **Auto-reopen worker** (`apps/core/src/workers/defer-reopen.ts`, new):
   - Interval 10 s by default; injectable `intervalMs` + `now()` clock + `disableLabEmit` seams for tests.
   - `reconcileDeferred(db, opts)` selects rows where `status='deferred' AND defer_until IS NOT NULL AND defer_until <= <now>`, spawns `lab-emit reopen --re <qid> --by auto` (fail-open: shell hiccup logs a WARN and does not abort), then UPDATEs `status='open', defer_until=NULL` under a matching guard clause.
   - Emits a synthetic `question.reopened` SSE event via the events broadcaster so the web client refreshes without waiting for the tail sweep.
   - Wired into `apps/core/src/serve.ts` behind `GOSLEEP_DISABLE_DEFER_REOPEN=1` so hermetic tests can opt out without disabling the tail or fleet-poll workers.
5. **Web UI** (`apps/web/src/screens/Questions.tsx`):
   - New "Defer" button on `open|answered` rows. Opens a dialog with a duration picker (30 min / 2 h / tomorrow 10:00 / next Monday 10:00 / no timer / custom ISO) that computes the corresponding `defer_until` ISO-UTC string client-side.
   - Deferred rows render a "reopens in Xh Ym" countdown (live 1 s ticker) when `defer_until` is set, or "deferred, no timer — reopen by hand" when null.
   - Added a "Deferred" filter tab; the `deferred` status tone was already provisioned in `TONE`.
6. **Schema + SDK**: `DeferActionInput/Result/Response` types added to `packages/schema` alongside the GSL-277 types; SDK method `client.deferQuestion(input, idempotencyKey)`; React hook `useDeferQuestion` in `apps/web/src/data/queries.ts`.
7. **Tests + smoke + live proof**:
   - `apps/core/test/actions.applyManifest.defer.test.ts` — 16 unit tests: `isValidIsoLike` guard rejects garbage; `reconcileDeferred` reopens due rows, skips future rows, skips no-timer rows, is idempotent on a second pass, and processes a mixed batch in one shot.
   - `tools/lab/tests/core-smoke.sh` gains scenarios 33-37: auth guards, malformed defer_until, defer end-to-end, DB row check.
   - `tools/lab/tests/manifest-defer-live-proof.sh` (new) — full end-to-end proof under isolated `GOSLEEP_LAB_DIR` + `GOSLEEP_DB_PATH` (copies the REAL owner-sovereign manifest into the scratch dir READ-ONLY). Posts a fresh question via the internal shim, defers it with `defer_until = now + 3s`, waits, forces a `reconcileDeferred()` call via `apps/core/scripts/force-defer-reopen.ts`, then asserts DB flip to `open`/`defer_until=NULL` + queue.jsonl reopen patch presence. 13/13 assertions pass.

## Problems solved

- **Grep-based JSONL assertions were fooled by Python's default `json.dumps` spacing.** First live-proof pass reported "queue.jsonl missing defer patch" because the file contained `"status": "deferred"` (with a space after `:`) while my regex `"status":"deferred"` demanded no space. Fixed by moving to `grep -Eq` with `[[:space:]]*` between the field colon and its value.
- **Defer must not wake the agent's PreToolUse hook.** First draft called `questionNotifier.notify(...)` symmetrically with `doAnswer` — that would leak `status='deferred'` to the agent as if it were an answer and the hook would release with a garbage `updatedInput`. Removed the notify; documented the invariant in the endpoint body ("the agent's long-poll keeps waiting until the owner actually answers"). This is one of the acceptance criteria (Jira: "Semantics important: defer must NOT deliver anything back to the asking agent").
- **`defer_until` erasure on the fold layer.** The tail indexer's fold accumulates the LATEST value seen for each field per qid. A reopen patch that carried `"defer_until": ""` would keep the stale value if fold used `typeof r.defer_until === "string" ? r.defer_until : s.defer_until` (the field IS a string in the patch — an empty one). Fixed with an explicit-clear branch: `if ("defer_until" in r)` overrides the field, and an empty string sets it to `null`.
- **Worker-vs-race guard on UPDATE.** The reopen worker's SELECT is followed by an UPDATE; a concurrent `POST /actions/questions/answer` between the two would flip the row to `answered` and the reopen would then re-open an already-answered row. Guarded the UPDATE with `WHERE status='deferred' AND defer_until IS NOT NULL` so the changes count is 0 in that race and the worker moves on silently.

## Problems remaining

- **The default 10 s tick is coarse.** Jira acceptance says "reopens in 30 s" — a 10 s worker just fits inside that window, but users noticing a 5-9 s lag on their countdown will complain. A finer grain (2-3 s) is easy to add if the noise becomes real; the shape is DB-cheap (single indexed SELECT + at-most-K UPDATEs per tick).
- **No countdown-driven optimistic UI.** The web timer counts down from `defer_until` locally, but the row does not flip to `open` until the SSE `question.reopened` frame lands. On slow SSE that leaves a ~2-5 s stale "reopens in 0s" state. Cosmetic.
- **Snooze suggestions / calendar integration** — explicit non-goal per Jira ("v1.1").

## Pitfalls & workarounds

- **The append-only C8 rule applies to defer + reopen too.** Both are patch records, never edits. The lab-emit implementation follows the same `_patch`-shaped pattern as `answer` and `resolve`; a corrupted defer is corrected by appending another patch, not by editing the earlier line.
- **`GOSLEEP_DISABLE_DEFER_REOPEN=1`** is a first-class env gate independent of `GOSLEEP_DISABLE_INDEXER` and `GOSLEEP_DISABLE_FLEET_POLL`, following the pattern GSL-276 established. The live-proof script uses it and forces the worker manually via `apps/core/scripts/force-defer-reopen.ts` so the proof is deterministic (no race against a 10 s tick under a 30 s smoke budget).
- **`isValidIsoLike` refuses empty strings** to keep the "no timer" branch honest at the endpoint layer (empty string on the wire is treated as "user meant no timer, but sent it wrong" and rejected with 400; explicit `null` or omitted field is the correct way to say "no timer"). The CLI accepts empty because the internal `--defer-until ""` is how the endpoint tells `lab-emit` "no timer" without dropping the flag entirely.
- **Countdown live-render uses a 1 s ticker.** Cheap. The alternative — refetching /questions every second — would hammer the server for a purely-cosmetic update.

## What didn't make it

- **A finer worker cadence** — deferred until the 10 s window is measurably too coarse.
- **Optimistic countdown-driven UI flip** — deferred until SSE latency is measurably too high.
- **Snooze suggestions + calendar integration** — Jira non-goal, filed as v1.1.

## Technical reference

- **Commit:** GSL-278.
- **Files added:**
  - `apps/core/src/workers/defer-reopen.ts`
  - `apps/core/scripts/force-defer-reopen.ts`
  - `apps/core/test/actions.applyManifest.defer.test.ts`
  - `tools/lab/tests/manifest-defer-live-proof.sh`
  - `docs/dev_history/GSL-278-phase37-defer-action.md`
- **Files changed:**
  - `apps/core/src/routes/actions.ts` (POST /actions/questions/defer + doDefer + isValidIsoLike)
  - `apps/core/src/serve.ts` (defer-reopen worker wiring + shutdown drain)
  - `packages/schema/src/index.ts` (DeferAction types)
  - `packages/sdk/src/index.ts` (`deferQuestion`)
  - `apps/web/src/data/queries.ts` (`useDeferQuestion`)
  - `apps/web/src/screens/Questions.tsx` (Defer button, dialog, countdown, deferred filter)
  - `tools/lab/lab-emit.sh` (cmd_defer + cmd_reopen + SEMANTIC_TYPES additions)
  - `tools/lab/ui/src/severity.ts` (question.deferred → WARN, question.reopened → INFO)
  - `tools/lab/tests/core-smoke.sh` (defer scenarios 33-37)
- **Verified by running:**
  - `bun test apps/core/test` — 93 pass across 12 files (16 new tests in the defer/apply-manifest suite).
  - `bash tools/lab/tests/core-smoke.sh` — 51 scenarios pass (including defer end-to-end + DB row check + defer + reopen live-proof).
  - `bash tools/lab/gate.sh --offline` — green.
  - LIVE PROOF (`tools/lab/tests/manifest-defer-live-proof.sh`): defer flow → DB row `status=deferred, defer_until=<near-future>` + queue.jsonl carries the defer patch. Waited 4 s past defer_until, forced `reconcileDeferred()` via `force-defer-reopen.ts`, verified DB row now `status=open, defer_until=NULL` + queue.jsonl carries the `reopened_by=auto` patch. 13/13 assertions pass (5 apply-manifest + 8 defer/reopen).
- **Sources referenced:** `docs/reports/web-harness-research-2026-08-03/target-architecture-rev3-addendum.md` §Delta 8.3; `docs/reports/web-stack-audit-2026-08-06/coverage.md` §2 R2, §7 G4.
