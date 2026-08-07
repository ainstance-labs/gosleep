# GSL-279 — Jira reconciler worker + POST /actions/tasks/sync (phase 7)

**Branch:** `GSL-250-control-plane` · **Commit:** see git log · **Shift:** 75 (cycle 208, impl-web-11)

Delivered the Jira reconciler worker that keeps the local `tasks` table fresh, plus the
on-demand `POST /actions/tasks/sync` endpoint. Owner requirement **R6** (Tasks view reflects
Jira). Rev-3 addendum **Delta 9**. Coverage gap **G5** from the 2026-08-06 audit.

## What changed

* **`apps/core/src/workers/jira-sync.ts`** — the new worker. Two-source design behind a
  common `SyncSource` interface:
  * `jiraRestSource` — hits `ainstance-labs.atlassian.net/rest/api/3/search/jql` with
    a Basic auth header. Token read from Keychain (`gosleep-jira-api`) via a Jira-only
    reader (deliberately separate from the Bearer wrapper — the Bearer wrapper's
    `GOSLEEP_BEARER_TOKEN` dev-bypass would otherwise leak the wrong token into Jira
    calls and silently return "empty issues" in tests).
  * `ghSource` — `gh issue list --repo ainstance-labs/gosleep --state all --json …`.
    Always available on an operator's box; status collapses to `Done`/`To Do`.
* **`runSyncCycle(db, opts)`** — tries sources in order, first `ok:true` wins. On non-empty
  change set, calls `reconcileTasks(...)` which UPSERTs and returns
  `{inserted, updated, ended, totalSeen, source, changedKeys, ts}`.
* **SSE fan-out** — on non-empty change set, emit `type='tasks.updated'` with the change
  summary; the web `SseProvider` already invalidates `queryKeys.tasks()` on the
  `tasks.` prefix, so no client-side wiring changes were needed.
* **`startJiraSync(db, opts)`** — periodic controller (5-min cadence, env
  `GOSLEEP_JIRA_SYNC_INTERVAL_S`). Fires one cycle at boot. `stop()` drains any in-flight
  poll. Wired into `serve.ts` under `GOSLEEP_DISABLE_JIRA_SYNC` (respects the hermetic
  smoke path).
* **`POST /actions/tasks/sync {epic?}`** — new endpoint in `routes/actions.ts`, wrapped in
  the standard `serialize` → `withTimeline` layers (per-endpoint mutex + persistent
  Idempotency-Key). Returns the same summary shape as `runSyncCycle`.
* **`Tasks.tsx`** — "Sync now" button in the header calling `useSyncTasks()`; empty-state
  no longer says "waiting for GSL-279"; header subtitle now says the worker exists.
* **Schema + SDK** — `SyncTasksActionInput` / `SyncTasksActionResponse` added, SDK method
  `coreClient.syncTasks(input, key)` wired through.
* **`core-smoke`** — three new scenarios (`38.` auth, `39.` bad epic → 400, `40.` valid
  → 200, `41.` `tasks` table populated after the tick). Smoke now runs against the real
  gh CLI as the live-proof source; `GOSLEEP_SKIP_SYNC_LIVE=1` skips 40+41 in a network-off
  environment.
* **Unit tests** — `apps/core/test/jira.sync.test.ts` covers INSERT / UPDATE / no-op tick
  (still bumps `last_synced_at`) / label set-equality / source fallback / SSE-fires-once.

## Live proof

* `core-smoke`: **55/0**. Scenario 41 shows **243 GSL-\* rows** in the scratch DB after one
  `POST /actions/tasks/sync` tick — a real end-to-end reconcile against `gh issue list`.
* Unit tests: **9/9** in `jira.sync.test.ts`; **102/102** across `apps/core/test/`.
* `gate.sh --offline`: green (tsc clean, chronicler in offline mode, hooks-verify 11/11).
* Repo `smoke.sh`: **551/0**.

## Notes

* Deletions are NOT reconciled today — a ticket that disappears from Jira/GH leaves its
  row behind. Rare in this project and safer than a silent wipe on a source hiccup.
* Granular Jira status (`In Progress` / `In Review`) only lights up when the Jira REST
  source succeeds; the gh fallback collapses to `Done`/`To Do`. Provisioning the Keychain
  token (`security add-generic-password -s gosleep-jira-api -a $USER -w '<email:token>'`)
  is a one-line operator step — the endpoint layer is ready.
* No Jira write-back — this is a read-only reconciler. Jira transitions still go through
  the Atlassian MCP inside an agent's session.
