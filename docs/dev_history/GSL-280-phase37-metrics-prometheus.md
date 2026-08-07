# GSL-280 — /metrics endpoint (Prometheus text exposition, Warren shape)

Phase 37 (web control plane, epic GSL-250). Branch: `GSL-250-control-plane`.

## What was done

Replaced the GSL-263 `/metrics` stub with a real Prometheus text exposition. One `curl 127.0.0.1:7331/metrics` now shows the daemon's health at a glance: process uptime and memory, event ingest counts, SSE subscriber gauge, indexer lag, DB file size, the answer-loop long-poll wait histogram, open-question counts by kind, the currently active auth source, per-live-agent context %, live-agent count, and a per-endpoint HTTP request counter. Fourteen metric families in total, every one with a valid `# HELP` and `# TYPE` line — the acceptance rule the Jira description names.

The split:

1. **New module `apps/core/src/metrics/registry.ts`** — hand-rolled in-process registry (no prom-client dep, ~10 families, all emits are ours). Counters + histograms live in module-scope Maps; gauges without a natural backing (auth-source label) are set explicitly by the module that computes them. Exposition builder `buildPrometheusText(db, nowMs?, eventsDirOverride?)` is synchronous — reads registry state + a handful of DB queries + `fs.stat` for DB size / newest events file mtime. Format follows the 0.0.4 spec: label-value escaping (backslash / double-quote / newline), cumulative histogram buckets + `+Inf` + `_sum` + `_count`, trailing newline.
2. **New route `apps/core/src/routes/metrics.ts`** — thin HTTP layer around `buildPrometheusText`. Bearer'd via `requireBearer` (same layer as `/status`). `Content-Type: text/plain; version=0.0.4; charset=utf-8` so a strict scraper accepts it. Bumps `gosleep_http_requests_total{endpoint="/metrics",method="GET",status="200"}` on each scrape — cheap self-observability.
3. **Hook into `apps/core/src/security/authSource.ts`** — `writeAuthSourceAudit` now calls `recordAuthSource(result.source)` so `gosleep_security_auth_source{source="<label>"} 1` reflects the active source with the others as 0. Moved the audit call OUT of the `GOSLEEP_DISABLE_INDEXER` gate in `serve.ts` and made it `await`ed at the top level — a headless run (indexer off) still gets a truthful auth-source label, and a fast scrape landing right after boot cannot beat the audit to the registry.
4. **Hook into `apps/core/src/routes/internal.ts`** — the answer-wait long-poll handler observes its own duration on every exit path (initial-terminal / unknown-qid / timeout / actual-answer) via `observeHookWait("answer-wait", seconds)`. `gosleep_hook_wait_seconds` histogram now populates with real wait times.

Metric families v1 (Warren shape per the Jira description):

- `gosleep_core_uptime_seconds` (gauge, ms since PROCESS_START).
- `gosleep_core_process_resident_bytes` / `gosleep_core_process_heap_bytes` (gauges, `process.memoryUsage()`).
- `gosleep_events_ingested_total{src}` (counter) + `gosleep_events_rowcount` (gauge — DB fallback for scrape-gap coverage until an indexer bump hits the counter).
- `gosleep_sse_subscribers` (gauge, `broadcaster.subscriberCount()`).
- `gosleep_indexer_lag_seconds` (gauge, `max(events.ts)` vs newest `events/*.jsonl` mtime; `-1` if unknown so an alert can distinguish "no data" from 0).
- `gosleep_db_size_bytes` (gauge, `statSync(db.path).size`).
- `gosleep_hook_wait_seconds_bucket{le,event}` + `_sum` + `_count` (histogram, buckets chosen for the 0.5 s–1800 s range the answer-loop actually spans).
- `gosleep_questions_open{kind}` (gauge, `SELECT count(*) GROUP BY kind WHERE status='open'`; emits a stable `kind=""` 0 on empty table so `sum() or vector(0)` stays trivial).
- `gosleep_security_auth_source{source}` (gauge, 1 for the active label / 0 for the other three known labels).
- `gosleep_agents_context_pct{session,name}` (gauge, per live `agent_sessions` row with a non-null context_pct, LIMIT 32).
- `gosleep_agents_live` (gauge, `count(*) WHERE ended_at IS NULL`).
- `gosleep_http_requests_total{endpoint,method,status}` (counter, currently bumped only by /metrics; adding more endpoints later is one line each).

## Problems solved

- **Auth source label was silent on headless runs.** First attempt put `void writeAuthSourceAudit(getDb())` inside the `GOSLEEP_DISABLE_INDEXER !== "1"` block for symmetry with the tail-indexer boot. The endpoint smoke (indexer disabled) then saw `gosleep_security_auth_source` with every label at 0 — nothing set the active label. Fix: audit runs INDEPENDENTLY of the indexer boot, `await`ed at top-level so a fast scrape cannot land before `recordAuthSource` fires.
- **Regex test brittleness on prose HELP lines**: my first `/gosleep_core_uptime_seconds (\S+)/` regex matched the word "Seconds" from the HELP line ("Seconds since gosleep-core process start."), not the number after the metric name. Fixed with `^…$/m` anchoring so the match is line-scoped.
- **Label escaping**: the first-pass test intentionally throws a `/weird"path\\` string at `incCounter` — surfaced that backslash-escape must come BEFORE double-quote-escape (otherwise the `\"` I insert gets re-escaped to `\\"`). Order fixed in `escapeLabelValue`.

## Problems remaining

- **`gosleep_events_ingested_total{src}` is empty on fresh boots.** Design choice: only the indexer will bump this counter (a later small edit in `indexer/tail.ts` calls `incCounter("gosleep_events_ingested_total", { src })` on each processed row). The `gosleep_events_rowcount` gauge covers the scrape-gap: an alert on ingest activity can use `rate(...) or gosleep_events_rowcount`. That indexer bump is TWO lines and belongs with the next indexer touch (out of scope for this task's diff).
- **HTTP request counter is per-endpoint only when the endpoint bumps it.** Only /metrics currently does. A `requestCounter` middleware wired on the app-wide chain would populate every endpoint — deferred (not in Jira scope; adding it here would touch every route file).
- **No promtool wire-in.** The Jira description names `prom2json` as an acceptance tool. The smoke check uses grep-based structural asserts (each required family has HELP + TYPE, content-type advertises `version=0.0.4`); a proper `prom2json` gate would be a nice add but requires the binary on the CI host.

## Pitfalls & workarounds

- **Top-level await guarantees ordering.** `await writeAuthSourceAudit(getDb())` blocks module evaluation until the audit finishes — necessary so `recordAuthSource` fires BEFORE `Bun.serve` binds. Bun's ESM runtime supports this. If a future refactor removes the await, the smoke's `27d` scenario will catch the regression.
- **NEVER `throw` from `buildPrometheusText`.** The route catches nothing — a throw becomes a 500 and a scraper alarms silently. All DB access is wrapped in try/catch that swallows errors (a table missing on a fresh DB is legitimate). The consequence is that a metric may go missing from the output, which is Prometheus-idiomatic ("this family currently has no data").
- **Histogram bucket count must be MONOTONICALLY non-decreasing** (Prometheus spec). The registry pre-allocates one counter per bucket and increments the RANGE of buckets `>= observed`, not just the first match. Test `bucket counts are monotonically non-decreasing` pins it down.
- **Auth-source labels are enumerated at BUILD TIME**, not at record time. If a new source appears (say "gsutil-secret-manager" tomorrow), edit `KNOWN_AUTH_SOURCES` in the registry. A scraper never sees a missing label.
- **`_resetRegistryForTests` is a real export, not `__reset`.** Bun's `mock.module` respects underscore-prefix as private in a test-only sense but for the `beforeEach` pattern used in `test/metrics.test.ts`, plain named exports are clearer. Guarded by naming and JSDoc.

## What didn't make it

- **Indexer-side `gosleep_events_ingested_total{src}` bump** — deferred to a two-line follow-up in `apps/core/src/indexer/process.ts` alongside the next indexer edit.
- **App-wide `gosleep_http_requests_total` middleware** — deferred; would need a Hono middleware on every route, out of Jira scope.
- **`prom2json` gate** — grep-based structural asserts in core-smoke are the v1 substitute.
- **A `?json` shortcut on /metrics** — the exposition builder is factored so a JSON variant is trivial, but not needed until a UI consumer asks for it.

---

## Technical reference

**Commit SHA:** (pending — one commit per task per delivery-workflow §1).

**Files touched:**
- `apps/core/src/metrics/registry.ts` — new (~330 lines): counter / histogram / gauge state + `buildPrometheusText`.
- `apps/core/src/routes/metrics.ts` — full rewrite (was a stub with two lines of output).
- `apps/core/src/security/authSource.ts` — +2 lines: `recordAuthSource(result.source)` call inside `writeAuthSourceAudit`.
- `apps/core/src/serve.ts` — auth-source audit moved OUT of the indexer gate, AWAITed at top-level.
- `apps/core/src/routes/internal.ts` — +5 lines: `observeHookWait("answer-wait", …)` at every long-poll exit.
- `apps/core/test/metrics.test.ts` — new: 15 tests covering envelope shape / sanitizer / auth source / questions_open / histogram cumulative+_sum+_count / agent context rows / counter aggregation / label escaping.
- `tools/lab/tests/core-smoke.sh` — 4 new scenarios (26/27/27b/27c/27d).

**How it was verified by running:**
- `bun x tsc -p apps/core --noEmit` — clean.
- `bun test` in apps/core: **77 pass / 0 fail** (was 62; +15 metrics tests).
- `bash tools/lab/tests/core-smoke.sh` — **37/37 pass** (was 32/32; +5: /metrics 401, /metrics 200, content-type version=0.0.4, every required family has # HELP, auth-source line reflects dev-env for the smoke).
- `bash tools/lab/gate.sh --offline` — VERDICT green.
- **Live-proof**: booted `apps/core/src/serve.ts` against a scratch DB (`.artifacts/metrics-liveproof/gosleep.db`) with fleet-poll enabled + indexer disabled. `curl -H "Authorization: Bearer …" http://127.0.0.1:7331/metrics` returned a valid Prometheus 0.0.4 exposition:
  - `gosleep_core_uptime_seconds 7.035`
  - `gosleep_events_rowcount 0`
  - `gosleep_sse_subscribers 0`
  - `gosleep_db_size_bytes 4096`
  - `gosleep_questions_open{kind=""} 0`
  - `gosleep_security_auth_source{source="dev-env"} 1` (others 0)
  - `gosleep_agents_live 2` (fleet-poll observed both live host sessions)
  - `gosleep_http_requests_total{endpoint="/metrics",method="GET",status="200"} 1`
- Port clean post-run.

**Links:**
- Jira: [GSL-280](https://ainstance-labs.atlassian.net/browse/GSL-280).
- Design source: `docs/reports/web-harness-research-2026-08-03/target-architecture-rev3-addendum.md` Delta 7.
