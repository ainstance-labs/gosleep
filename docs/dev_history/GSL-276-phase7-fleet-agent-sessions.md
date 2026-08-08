# GSL-276 — Per-agent fleet: agent_sessions table + PreToolUse tool-observed shim + /fleet projection + Fleet screen

Phase 37 (web control plane, epic GSL-250). Branch: `GSL-250-control-plane`.

## What was done

Gave the owner a per-session Fleet view — one card per live Claude Code agent, keyed on the harness's stable `session_id`, updated within a tick of any status/tool/context change. Owner requirement R4 ("how many agents are running, what each is doing, what its context %") now has a real data model instead of the scalar heartbeat that used to be all we had. Six ingredients:

1. **Schema**: a new `agent_sessions` table added to `apps/core/src/db/schema.ts` (session_id PK; name/kind/pid/model/cwd/cycle/context_pct/current_tool/current_intent/status/started_at/updated_at/ended_at). Migration + snapshot + journal generated via `drizzle-kit generate` and renamed to a legible tag: `apps/core/drizzle/0001_agent_sessions.sql` + `meta/0001_snapshot.json`.
2. **CLI adapter**: a new workspace package `@gosleep/runner-adapter` (`packages/runner-adapter/`) that owns the ONE place we shell to `claude`. `listClaudeAgents()` spawns `claude agents --json`, parses the shape verified against the running host, and returns a `ClaudeAgent[]`. Never throws — a timeout / non-zero exit / parse error returns `{ ok: false, agents: [] }` with a `reason`.
3. **Fleet-poll worker** (`apps/core/src/workers/fleet-poll.ts`): every 4 s (range 3-5 s per Jira scope), calls the adapter, diffs against the DB, and applies the reconcile in one transaction:
   - new session_id → INSERT (with the CLI's fields; hook-owned columns stay NULL).
   - seen session_id → UPDATE status + updated_at + name/kind/pid/cwd (NEVER context_pct / current_tool — those come from the shim).
   - missing session_id → status='ended' + ended_at stamped.
   - a `listClaudeAgents` failure → log ONE line, SKIP the reconcile (a CLI hiccup must not fire spurious ended_at across the whole fleet).
   Emits an `agent_sessions.updated` frame over the existing SSE broadcaster on any non-empty change set, so the browser's SseProvider invalidates the /fleet query without new plumbing.
4. **Hook shim endpoint**: `POST /internal/agents/tool-observed` added to `apps/core/src/routes/internal.ts`. Bearer'd by the existing internal-secret middleware. Body `{session_id, tool, ts, context_pct?, intent?}`. Writes are coalesced at 1 s per session (Jira "1 s debounce") through a module-scoped Map + one interval flush timer — bounds SQLite writes to ~1/sec/session regardless of tool activity. Placeholder INSERT on unknown session_id so the shim never loses data even if the poller has not yet observed the session.
5. **/fleet projection**: replaced the GSL-263 stub in `apps/core/src/routes/read.ts` with a real query over `agent_sessions` (live-first sort, then updated_at DESC, LIMIT 200). Response envelope adds a `totals` block (agents_total / agents_live / agents_busy / heartbeat_context_pct) so the Fleet screen header can render an at-a-glance summary. The stub in `/bundle` was replaced with the same rows.
6. **Fleet screen** (`apps/web/src/screens/Fleet.tsx`): one card per session with name / status pill / kind chip / short session-id / pid / model / cycle, a coloured context bar (red ≥80 %, amber ≥60 %, accent otherwise), current tool, optional intent, cwd tail, and a "updated Xs ago / ended Xs ago" line. Ended sessions fade to muted at the bottom. Routed at `/fleet`, wired into the sidebar (`Users` icon) in `AppShell.tsx`. SseProvider now invalidates `queryKeys.fleet()` on any `agent_sessions.*` or `agent.*` event type.

Wired the worker into `apps/core/src/serve.ts` with its own env gate (`GOSLEEP_DISABLE_FLEET_POLL=1`) so a test/CI path can turn it off independently of `GOSLEEP_DISABLE_INDEXER`. Clean shutdown drains the fleet-poll interval and the tool-observed flush timer before killing the server.

## Problems solved

- **Server config gate ordering caught in live-proof**: my first pass put `startFleetPoll(...)` inside the `if (process.env.GOSLEEP_DISABLE_INDEXER !== "1")` block for symmetry with the tail indexer. The live-proof revealed the coupling — a headless run (indexer disabled to keep it hermetic) had NO fleet-poll either, and /fleet returned an empty projection despite two live sessions on the host. Fixed by moving fleet-poll into its own gate (`GOSLEEP_DISABLE_FLEET_POLL=1`). Result: /fleet returned real live sessions within 5 s of boot.
- **Type shape drift for the SSE broadcaster**: `broadcaster.emit()` takes `EventRow` which requires `ingested_from: string | null`. My first synthetic events (fleet-poll change fanout, tool-observed flush fanout) missed that field and TS caught it. Also over-corrected with `supersedes_seq` which is NOT part of `EventRow` (the DB has it, the wire projection omits it). Both fixed with a `ingested_from: null` addendum.
- **`Bun.spawn`'s stdout typing**: `proc.stdout` is typed as `ReadableStream<Uint8Array> | number | undefined` in Bun 1.3.x (number when `stdout: "inherit"`), even after `stdout: "pipe"` on the SpawnOptions. `new Response(proc.stdout).text()` errored on the union — cast to `ReadableStream<Uint8Array>` in the adapter to narrow.
- **Cycle number missing from the CLI**: `claude agents --json` reports name + status + pid but no cycle number. Solved by parsing the trailing digits of the harness name convention (`gosleep-93` → 93) as a hint for the Fleet screen sort order. Non-conforming names get `cycle: null` — never a throw.

## Problems remaining

- **`model` column stays NULL**: the CLI does not expose the model per session. A later task can read `.claude/settings.local.json` on the session's `cwd` to populate this — deferred (not in the Jira scope for GSL-276).
- **The PreToolUse shim itself is not wired yet** — GSL-267 (the settings.json hook install) is deliberately parked for the owner (decision `q-2026-08-07-002`). The endpoint accepts the shape; the hook that calls it lands in a later commit. Once GSL-267 flips on, `current_tool` and `context_pct` start moving without further code changes on this side.
- **/fleet has no filter knob**: the Fleet screen shows the top-200 sessions live-first + ended tail. A `?include=live` query knob and matching screen filter are easy to add if the row count ever grows past the SPA's happy limit.

## Pitfalls & workarounds

- **Never clobber hook-owned fields from the poller.** The fleet-poll's UPDATE statement uses `COALESCE(?, cycle)` for cycle and does NOT touch context_pct / current_tool / current_intent / model. The polling cadence (4 s) is faster than the shim's flush cadence (1 s), but the poller's roster does not carry those fields anyway — writing NULL from the poller would clobber a fresh number the shim just wrote. Documented in the `UPDATE` comment block in `reconcileRoster`.
- **Ended detection must be idempotent.** An already-ended row seen absent in the next poll would double-stamp ended_at without the "status = 'ended' AND ended_at IS NOT NULL → skip" guard. Test `END: idempotent — an already-ended row does not re-ended on subsequent polls` pins it down.
- **Resurrection is UUID-unlikely but must not throw.** A session_id reappearing after ended_at was set falls into the UPDATE branch and clears ended_at back to NULL. Test `RESURRECTION` covers it.
- **Debounce Map is MODULE-scoped, not per-request.** A per-request Map defeats the whole coalescing point. Living in the request-handler module is safe because the process is single-instance (target-arch section 6.1). The flush timer is lazy — never spins up if the endpoint is never hit.
- **CLI failure MUST NOT be interpreted as "all sessions ended."** The lister returning `ok: false` skips the reconcile entirely — otherwise a CLI hiccup would ended the whole fleet across every dashboard. Test `skips DB writes when lister reports ok=false` pins it.

## What didn't make it

- **model discovery from settings.local.json** — deferred (see "Problems remaining"; not in the Jira scope).
- **A dedicated Fleet SSE channel** (`event: agent_sessions.updated` as a top-level SSE event type instead of a fan-out on the events stream). Piggybacking on the existing events broadcaster keeps the SSE surface stable and gives the web client one place to invalidate `queryKeys.fleet()` — enough for R4.
- **The PreToolUse hook script itself** — GSL-267 owns that install; the endpoint is ready.

---

## Technical reference

**Commit SHA:** (pending — one commit per task per delivery-workflow §1).

**Files touched:**
- `apps/core/src/db/schema.ts` — +54 lines: `agent_sessions` sqliteTable definition + design comment.
- `apps/core/drizzle/0001_agent_sessions.sql` — new: CREATE TABLE + 2 indexes.
- `apps/core/drizzle/meta/_journal.json` — +1 entry.
- `apps/core/drizzle/meta/0001_snapshot.json` — new.
- `apps/core/package.json` — depend on `@gosleep/runner-adapter`.
- `apps/core/src/workers/fleet-poll.ts` — new: worker + reconcileRoster (test-exported).
- `apps/core/src/routes/internal.ts` — +180 lines: `POST /internal/agents/tool-observed` + module-scoped debounce + `stopToolObservedFlush` export.
- `apps/core/src/routes/read.ts` — /fleet + /bundle.fleet swapped from stub to real projection.
- `apps/core/src/serve.ts` — boot fleet-poll under its own env gate; drain on shutdown.
- `packages/runner-adapter/{package.json,tsconfig.json,src/{claude-code,index}.ts}` — new package.
- `packages/schema/src/index.ts` — `FleetSession` widened (session_id / kind / status / started_at required); `FleetTotals` added.
- `apps/web/src/screens/Fleet.tsx` — new screen.
- `apps/web/src/router.tsx` — add `/fleet` route.
- `apps/web/src/components/AppShell.tsx` — add Fleet nav item (`Users` icon).
- `apps/web/src/data/SseProvider.tsx` — invalidate `queryKeys.fleet()` on `agent_sessions.*` / `agent.*` events.
- `tools/lab/tests/core-smoke.sh` — 5 new scenarios (21-25), extended to 32 scenarios total.
- `apps/core/test/fleet.poll.test.ts` — new: 9 tests covering reconcile insert/update/end/resurrection/idempotence/empty-DB/cycle-parser + worker skip-on-CLI-fail + emit-on-change.
- `apps/core/test/fleet.projection.test.ts` — new: 3 tests covering /fleet empty envelope, sort + totals, Bearer required.

**How it was verified by running:**
- `bun x tsc -p apps/core --noEmit` — clean.
- `bun x tsc -p apps/web --noEmit` — clean.
- `bun x tsc -p packages/{schema,sdk,runner-adapter} --noEmit` — clean.
- `bun test` in apps/core — 62 pass / 0 fail (was 50; +12 new tests: 9 fleet-poll, 3 fleet-projection).
- `bash tools/lab/tests/core-smoke.sh` — 32/32 pass (was 27/27; +5 new: /fleet auth, /fleet body shape, /internal/agents/tool-observed auth/400/200).
- **Live-proof**: booted `apps/core/src/serve.ts` against a scratch DB (`.artifacts/fleet-liveproof/gosleep.db`) with `GOSLEEP_DISABLE_INDEXER=1` and fleet-poll enabled. Within 5 s of boot, /fleet returned **2 real live sessions**: `gosleep-93` (this session, pid 27169, cwd `/Users/…/gosleep`, status=busy) and `tasty-lunch-a7` (pid 99932, cwd `/Users/…/tasty-lunch`, status=busy). Fleet-poll logged `inserted=2 totalLive=2` on start, then `updated=2` on the 4-s tick.
- `bash tools/lab/gate.sh --offline` — green (see commit trailer).

**Links:**
- Jira: [GSL-276](https://ainstance-labs.atlassian.net/browse/GSL-276).
- Design source: `docs/reports/web-harness-research-2026-08-03/target-architecture-rev3-addendum.md` Delta 8.1; `docs/reports/web-stack-audit-2026-08-06/coverage.md` §2 R4, §7 G3.
