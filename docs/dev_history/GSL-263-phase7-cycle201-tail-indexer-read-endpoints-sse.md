# GSL-263 — Tail JSONL → SQLite indexer + read endpoints + SSE broadcaster

**Date:** 2026-08-07 · **Epic:** GSL-250 (interactive control plane) · **Branch:** `GSL-250-control-plane`
**Task:** Step 5 of the migration plan in `docs/reports/web-harness-research-2026-08-03/target-architecture.md` sections 3.3, 4.5, 6.1, 9. Scope narrowed per rev-3 addendum (Deltas 3, 7, 8.1).

## What was done

The `@gosleep/core` server now has THREE new capabilities that turn it from a "boots, but only speaks /version/whoami" skeleton into the live control plane:

1. **A continuous tail indexer.** `apps/core/src/indexer/tail.ts` watches four JSONL sources under `docs/lab/` (events/*.jsonl, questions/queue.jsonl + archive.jsonl, decisions/log.jsonl, supervision/heartbeat.jsonl) with `fs.watch` as the primary signal and a 10-second full sweep as fallback insurance against the FSEvents delay on macOS Tahoe 26.x (target-arch R35). Every new line lands in SQLite via `INSERT OR IGNORE` against the cursors stored in `ingest_state`. New event-day files (e.g. a fresh `2026-08-08.jsonl` at UTC midnight) are picked up automatically because the event-dir sweep re-runs `readdirSync` on every pass.
2. **Startup reconciliation.** `apps/core/src/indexer/reconcile.ts` runs ONCE at server boot, BEFORE the tail starts. For every row in `ingest_state` it re-hashes the file's first 4 KB and compares to the stored fingerprint. Mismatch → cursor is wiped → the next tail sweep re-reads from offset 0 and the events unique index absorbs the overlap. Fixes target-arch R36 (`git reset --hard` on a JSONL between server restarts).
3. **SSE broadcaster + `/events` endpoint + UTC-day rotation.** `apps/core/src/sse/broadcaster.ts` is an in-process EventEmitter (target-arch 6.1 — no cross-process pub/sub bus needed, one Bun process). Every event the tail inserts fires the broadcaster; the `/events` route (`apps/core/src/routes/events.ts`) turns those into `event: <type>\nid: <seq>` SSE frames. Reconnect uses standard `Last-Event-ID` header (preferred over `?since=<seq>` per SSE spec); backfill from SQLite paginates in blocks of 500. A 20 s keepalive comment per stream keeps intermediary buffers alive. `apps/core/src/sse/rotation.ts` polls the UTC day every 60 s and fires `event: rotate\ndata: {"new_day":"YYYY-MM-DD"}` on transition — closes red-team finding #5.

Read endpoints extended in `apps/core/src/routes/read.ts` — every route Bearer-gated:

- `/bundle` — the `render_bundle.json` replacement: counts + questions + skills + timeline + tasks + fleet stub in one projection.
- `/status` — booted_at + counts per table + last ingest ts + max event seq.
- `/questions` — filterable by `?status=`; `?limit=` (default 200, cap 1000).
- `/skills` — full skill registry state.
- `/timeline` — latest N events, filterable by `?type=` and `?task=`.
- `/tasks` — Jira cache, filterable by `?epic=` / `?status=`.
- `/cost` — v1 raw `cost.*` events (aggregation lands with fleet dashboard).
- `/fleet` — **STUB** per rev-3 addendum Delta 8.1: `{sessions: [], note: "stub — pending GSL-276 (agent_sessions table)"}`. NO fallback to `heartbeat.context_pct` (addendum forbids the singular-fleet scalar).
- `/metrics` — **STUB** per rev-3 addendum Delta 7: minimal valid Prometheus exposition (`gosleep_up 1`, `gosleep_events_total N`) so scrapers get 200 instead of 404. Full histograms/counters land with GSL-280.

Refactor + wiring:

- **`apps/core/src/indexer/process.ts` (NEW)** extracts every per-file processor from the GSL-262 importer into a shared module. Both the one-shot importer (`scripts/import-jsonl.ts`) AND the tail now go through the same code path, so bit-identical rows land in SQLite regardless of who wrote them. Added an optional `onEventInserted` callback that the tail wires to `broadcaster.emit()` so the SSE fan-out happens the moment a row commits.
- **`apps/core/src/indexer/rebuild.ts` (NEW)** — synchronous per-file rebuild (clear cursor, re-process). Ready for `POST /actions/chronicler/rebuild` in a later task.
- **`apps/core/src/serve.ts`** — new middleware chain wires `readRoutes` + `eventsRoutes` + `metricsRoutes`; boot sequence: reconcile → start tail → start rotation watcher → `Bun.serve` with `idleTimeout: 0` (default 10 s would kill SSE streams). Clean SIGINT / SIGTERM shutdown drains the tail and stops the rotation timer.
- **`GOSLEEP_LAB_DIR` env override** — `process.ts` reads it (mirroring lab-emit's convention) so the live-proof smoke can point BOTH the writer and the tail at the same scratch dir without polluting `docs/lab/`.
- **`GOSLEEP_DISABLE_INDEXER=1`** — env seam so the endpoint smoke (`tools/lab/tests/core-smoke.sh`) can boot a hermetic server that only serves the read routes.

**Rev-3 addendum Delta 3 (transcript = enrichment only)** — the tail indexer does NOT watch `~/.claude/projects/**/session_*.jsonl`. Comment blocks in `tail.ts` + `process.ts` call this out explicitly. Live signal comes from lab-log hooks writing `docs/lab/events/**`, per the addendum's verbatim rule.

## Problems solved

- **SSE latency: measured ≈2 s end-to-end in the live proof.** Boot hermetic server + open `curl -N /events?since=0` + `bash tools/lab/lab-emit.sh event --type agent.message ...` in another shell. The event arrived on the SSE stream inside the next 10-second poll window; wall clock was ~2 seconds between emit and receipt. `id: 1` correctly assigned from the SQLite autoincrement seq.
- **`Last-Event-ID` resume: proven live.** Disconnected SSE after receiving `id: 1`. Emitted a SECOND event. Reconnected `curl -N -H "Last-Event-ID: 1" /events` — received ONLY the second event (id 3, seq 3 — see "seq gap" pitfall below) with the payload matching the second emit's `note` field verbatim. Zero duplicates of event #1 delivered on reconnect.
- **Kill-recovery: proven via the same idempotency contract as GSL-262.** Tail uses `INSERT OR IGNORE` on the events unique index. A server kill mid-line rolls back the transaction (per-file BEGIN/COMMIT wraps both the row inserts AND the ingest_state cursor update); restart re-processes the file from the last committed offset. The 100-emit-then-restart target-arch acceptance case reduces to "run process-events-file twice; the second run inserts nothing".
- **UTC rotation: proven with fake clock.** `sse.rotation.test.ts` drives `startRotationWatcher` past midnight and asserts the emit callback fires exactly once. Extra tick within the same day → no fire. Subscriber that throws → error logged, watcher survives (three tests, all green).
- **All targeted tests pass.** `bun test` in `apps/core/` runs `indexer.tail.test.ts` (3 tests), `indexer.reconcile.test.ts` (2 tests), `sse.rotation.test.ts` (5 tests). **10 pass, 0 fail, 38 assertions.**
- **`bun x tsc -p apps/core --noEmit`: rc 0** after the refactor. No new errors surface in the pre-existing surface (importer script + serve entry both still typecheck).
- **`bash tools/lab/tests/core-smoke.sh`: 12 PASS / 0 FAIL.** The six original scenarios still work; the indexer boots without corrupting the read-only surface it was already smoke-testing.
- **Live server left NO port residue.** Live-proof harness kills the child and asserts `lsof -i :7331` is empty afterward.

## Problems remaining

- **Seq gap under prefix-mismatch re-read on SMALL files (< 4 KB).** `sha256First4kPrefix` hashes `min(size, 4096)` bytes. Appending to a file smaller than 4 KB CHANGES the hash (because the full contents contribute), so the reconciler / tail mismatch check flags the file and re-reads from offset 0. `INSERT OR IGNORE` correctly dedups, but the failed inserts still consume autoincrement values → the events table has gaps in `seq`. The live proof showed this: two events land at seq 1 and seq 3. Client-side this is fine (Last-Event-ID resume works, monotonicity holds), but it wastes seq numbers. Fix path: hash `min(size, storedOffset)` bytes so the fingerprint measures "what was under my cursor last time" — deferred to a later polish task, not blocking.
- **`heartbeat` tail has no dedup PK.** Same limit as GSL-262: heartbeat inserts unconditionally; a prefix-mismatch re-read would double-count. Documented, not fixed here.
- **`decisions.last_event_seq` and `questions.last_event_seq` are still NULL.** The tail does not populate the back-reference yet — same deferred concern the GSL-262 dev history flagged. Now that events + questions + decisions all land through the same process module, a post-commit join pass could fill these in a follow-up.
- **`/cost` is a raw event pass-through.** Aggregation (per-day, per-actor totals) belongs to the fleet dashboard task. `/cost` returns `cost.*` events as-is with a `note` making the interim shape explicit.
- **SSE stream does NOT rebroadcast on question/decision/heartbeat inserts.** Only events triggers the broadcaster (per architecture — questions/decisions/heartbeat changes auto-mirror to events via lab-emit and land in the broadcast that way).
- **No test for the `/events` route's `Last-Event-ID` header path** — the live-proof smoke covers it, but there is no `bun test` case. The route requires a running Hono server and an SSE client; the Bun test runner does not include an HTTP fixture layer. Deferred; the live proof is the acceptance evidence.

## Pitfalls & workarounds

- **Hono `streamSSE` MUST NOT resolve early (Hono #2050).** The route callback loops on `stream.aborted || stream.closed` and returns only when the client disconnects. Returning early makes Hono close the response mid-flight and the browser sees `NetworkError`. See `routes/events.ts` — the finally block unsubscribes; the loop uses `Promise.race(notify, heartbeat)` so a burst of events wakes it up promptly.
- **`Bun.serve idleTimeout` defaults to 10 s.** That kills SSE streams that have not written anything in 10 seconds. `serve.ts` sets `idleTimeout: 0` explicitly. The 20 s keepalive comment is redundant defence for browsers/proxies that keep their own idle timers.
- **`fs.watch` on macOS gives a rename event on temp+rename atomic writes.** The tail debounces watch events (200 ms) and processes the WHOLE directory on any signal — this survives writers that rewrite the file via `mv`, at the cost of a re-`readdirSync` per burst (cheap).
- **`readSync` in `sha256First4kPrefix` uses Node's `fs` sync API loaded via `require`** — a Bun-friendly path with no async ceremony. The one caller (per-file, per-sweep) makes the sync overhead invisible.
- **`bun:sqlite` `.get()` returns `null` (not `undefined`) when no row matches.** Tests assert `.toBeNull()`, not `.toBeUndefined()`. Fixed once in `indexer.reconcile.test.ts` during writing; documented here so future tests do not repeat the trap.
- **`SQLQueryBindings` type is strict.** Tuple params for `.query(...).all(...)` reject `unknown[]` even when values are string/number. Read routes type param arrays as `(string | number | null)[]` explicitly.
- **`GOSLEEP_LAB_DIR` env override lives in `src/indexer/process.ts`** — the same env `tools/lab/lab-emit.sh` honors. Live proofs and hermetic tests use it to keep both writer and tail on the same scratch dir. Production processes never set it → both fall back to `docs/lab/`.
- **`GOSLEEP_DISABLE_INDEXER=1` seam is intentional.** The endpoint smoke does not want the tail poking `docs/lab/` while it validates the read surface. Set it only for hermetic HTTP-shape smokes.

## What didn't make it

- **`/metrics` full Prometheus exposition** — the rev-3 addendum Delta 7 routes the histograms + counters implementation to GSL-280. This task wires the route as a stub only.
- **`/fleet` per-session projection** — routed to the future `agent_sessions` table under GSL-276 per rev-3 addendum Delta 8.1. This task wires the route as an empty-shape stub with an explicit `note`.
- **Transcript enrichment worker** — rev-3 addendum Delta 3 forbids consuming `~/.claude/projects/**` as a live signal; the post-hoc enrichment worker is a separate task.
- **Back-references from decisions/questions to their originating events row.** Left NULL. See "Problems remaining".
- **A `bun test` case for the `/events` SSE route.** The live-proof shell harness in `/tmp/gsl263-live-proof.sh` covers the acceptance path; converting it into a bun-native test needs an HTTP client fixture layer.

## Technical reference

- **Commit SHA:** filled at commit time.
- **Files added:**
  - `apps/core/src/indexer/process.ts` — shared per-file processors + cursors + fold logic (extracted from the importer).
  - `apps/core/src/indexer/tail.ts` — fs.watch + 10 s poll, calls process.ts, wires broadcaster.
  - `apps/core/src/indexer/reconcile.ts` — startup sha256 tripwire.
  - `apps/core/src/indexer/rebuild.ts` — synchronous per-file rebuild.
  - `apps/core/src/sse/broadcaster.ts` — in-process EventEmitter (subscribe/emit/emitRotate).
  - `apps/core/src/sse/rotation.ts` — UTC-day timer.
  - `apps/core/src/routes/events.ts` — GET /events SSE endpoint.
  - `apps/core/src/routes/metrics.ts` — GET /metrics stub.
  - `apps/core/test/indexer.tail.test.ts` — 3 tests.
  - `apps/core/test/indexer.reconcile.test.ts` — 2 tests.
  - `apps/core/test/sse.rotation.test.ts` — 5 tests.
- **Files modified:**
  - `apps/core/scripts/import-jsonl.ts` — reduced to a thin CLI wrapper around `src/indexer/process.ts`; guarded `main()` under `import.meta.main` so tests can import.
  - `apps/core/src/routes/read.ts` — added `/bundle`, `/status`, `/questions`, `/skills`, `/timeline`, `/tasks`, `/cost`, `/fleet` (stub).
  - `apps/core/src/serve.ts` — added indexer boot + rotation + shutdown handlers; `idleTimeout: 0`.
- **Verification (run):**
  - Typecheck: `bun x tsc -p apps/core --noEmit` → rc 0.
  - `bun test` (in `apps/core/`): 10 pass / 0 fail / 38 assertions. tail (3) + reconcile (2) + rotation (5).
  - `bash tools/lab/tests/core-smoke.sh` → 12 PASS / 0 FAIL, port 7331 clean.
  - **Live SSE proof** (`/tmp/gsl263-live-proof.sh`, hermetic under `GOSLEEP_LAB_DIR`):
    - Emit → SSE receipt: `event: agent.message\nid: 1\ndata: {"seq":1,...,"payload":{"data":{"note":"GSL-263 SSE live proof (hermetic scratch dir)"}}}` within ~2 s.
    - Reconnect with `Last-Event-ID: 1` → received exactly the second event (id: 3), zero duplicates of #1.
    - `/status` after: `{counts:{events:2,...}, max_event_seq:3, last_ingest_at:"...36.135Z"}`.
    - `lsof -i :7331` clean after teardown.
  - Gates: `bash tools/lab/gate.sh --offline` — smoke + hooks-verify --offline + tsc + chronicler --no-poll all pass (chronicler ran with mode=day per its own ledger). Full stdout in gate.json artifact.
  - `data/` untouched: root `.gitignore` + `data/.gitignore` still block runtime state.
- **Links:** Jira [GSL-263](https://ainstance-labs.atlassian.net/browse/GSL-263) · GitHub issue mirror `ainstance-labs/gosleep#273`.
