# GSL-301 [Web][Docs] Fleet live-values proof: current_tool + context_pct populated in real session

**Date:** 2026-08-09 (shift 76 / epic GSL-297).
**Branch:** `GSL-297-web-feature-complete`.
**Model:** Opus 4.7 (owner global pin, self-reported).
**Depends on:** GSL-276 (agent_sessions table + `/internal/agents/tool-observed`
endpoint + `/fleet` projection + Fleet.tsx cards).

## Part 1 — the story

R7.4 (Fleet view) shipped with the schema + endpoint + UI (GSL-276) but run-02 finding
6 recorded `current_tool` / `context_pct` / `current_intent` staying `null` because "the
shim has not yet fired in the audit environment." This task was scoped as a
verification-only pass: piggyback on the GSL-299 pilot session, watch the Fleet card
populate. The Jira description said "no production code changes unless a real bug
surfaces; if one does, fix commit references this task's key."

**A real bug surfaced.**

**What I saw.** Under the isolated scratch tree (same one GSL-299 used, on port 7332):

1. Direct `POST /internal/agents/tool-observed` with a fresh `session_id` returned 200
   with `pending: 1, debounce_ms: 1000`.
2. Repeated POSTs to the same fresh sid reported `pending: 1` each time — consistent
   with the flush timer having drained the previous entry.
3. After 5 seconds the DB `agent_sessions` table was STILL empty.
4. `/fleet` returned `{sessions: [], count: 0}`.

**Instrumentation isolated the bug.** I added temporary probe `console.error` lines
inside `flushPendingObservations` and re-ran:

- `flush_probe pending=1` at t≈1s (map had one entry).
- `branch_probe existing=true` for a session_id that had NEVER been inserted (the DB
  was empty).
- `flush_probe pending=0` at t≈2s (map drained).
- No `insert_probe` — the code took the UPDATE branch, which UPDATE'd 0 rows for a
  non-existent WHERE match. Silent no-op.

**Root cause.** Bun's `Database.query(...).get(...)` returns `null` when no row matches,
NOT `undefined`. The branch selector was written as `if (existing !== undefined) UPDATE
else INSERT`. A `null` result satisfies `!== undefined`, so every fresh session_id took
the UPDATE branch — which matched zero rows and did nothing. First-time observations
never landed in the DB.

**Fix.** Two-line change: `existing !== undefined` → `existing !== null && existing !==
undefined`. Also removed the surrounding `db.raw.transaction(() => …)` wrapper. The
transaction wrapper was cheaper than per-row atomicity (each observation is
independent) and, more importantly, added a Bun-runtime-specific failure mode we would
have chased separately — the `/actions/*` endpoints already use the same non-transaction
`db.raw.query().run()` pattern via `withTimeline`, so the flush now matches the
established convention. Full rationale in the code header comment. Added a per-row
try/catch so a single bad observation cannot drop the rest of the batch (defensive —
before the fix the whole flush was silent; after the fix a genuine SQL error would at
least log to stderr and continue).

**Verified.** With the fix, the same POST-then-wait sequence lands the row and
`/fleet` returns it. Rapid-fire five POSTs for the same session inside 200 ms coalesce
into a single UPDATE at the next flush tick — the 1 s debounce the addendum §8.1
called for. Final DB row: `current_tool=Write, context_pct=50, current_intent=<intent
from first POST>` (the intent COALESCE preserves the earlier value across later
tool-only observations, exactly as the schema comment promises).

**Smoke regression assertion added.** `tools/lab/tests/core-smoke.sh` scenario 25b:
POST tool-observed with a fresh sid, wait 2 s past the debounce window, `SELECT
current_tool || '|' || context_pct FROM agent_sessions WHERE session_id = <sid>` — must
return `Read|42`. This catches the exact class of regression this task uncovered
without needing the /fleet projection layer.

**Remaining gap (not fixed here — flagged for the epic dossier).** Even with the flush
fixed, `tools/hooks/` today does NOT wire the tool-observed hook. Neither the
AskUserQuestion nor the PermissionRequest shim POSTs to `/internal/agents/tool-observed`
before/around its work; no Session-level PreToolUse-only shim exists. That means R7.4's
"current_tool populates from a running real session" is contingent on a NEW shim being
wired. In-scope for this task was proving the DB/endpoint/UI path works end-to-end from
a live POST; that IS proven. The last mile — a hook that POSTs on every tool call — is
its own thin task (S) that GSL-302 will name in the widening-gate note as a
post-feature-complete follow-up, and I file it as a separate ticket now (see
"Follow-ups" below).

## Part 2 — the reference

- **Commit:** `GSL-301 …` — one commit on `GSL-297-web-feature-complete`. Fix +
  smoke assertion + evidence + dev history.
- **Files:**
  - `apps/core/src/routes/internal.ts` — `flushPendingObservations` fixed: `existing !==
    null && existing !== undefined` branch selector, transaction wrapper removed,
    per-row try/catch that logs `core.tool_observed.flush_error` and continues.
    Header comment cites this dev history + the isolated-repro method.
  - `tools/lab/tests/core-smoke.sh` — new scenario 25b asserting the tool-observed
    row PERSISTS to DB after the 1 s debounce (fresh sid → INSERT branch — the exact
    path the bug broke).
  - `docs/reports/verifications/GSL-297/runs/01/assets/v6-agent-sessions-db.txt` —
    post-fix DB row snapshot: current_tool=Write, context_pct=50, current_intent set.
  - `docs/reports/verifications/GSL-297/runs/01/assets/v6-fleet-projection.json` —
    `/fleet` returning the populated row.
  - `docs/dev_history/GSL-301-phase7-fleet-live-values-proof.md` (this file).
  - `docs/dev_history/README.md` (index entry).
- **Verified by running:**
  - `bun x tsc -p apps/core --noEmit` → clean.
  - `bun test` (apps/core) → **191 pass, 0 fail** (unit tests unchanged — the bug
    lived below the unit-test layer for tool-observed; smoke 25b is the new
    regression fence).
  - `bash tools/lab/tests/core-smoke.sh` → **96 pass, 0 fail** (was 95; +1 for 25b).
- **Verdict:** R7.4 sub-fields (`current_tool`, `context_pct`, `current_intent`) can
  populate live in the DB and surface on `/fleet` — proven end-to-end against a
  real POST + a live server. The last-mile gap (a shim that CALLS the endpoint on
  every tool use) is out of scope here and named in GSL-302's dossier.
- **Follow-up ticket:** GSL-303 (or the next open GSL number) — "Wire a
  PreToolUse Session hook to POST /internal/agents/tool-observed on every tool use
  under the guarded pilot flag." Small (S). Owner-gated widening applies (per
  d-2026-08-09-001).
- **Links:** Jira [GSL-301](https://ainstance-labs.atlassian.net/browse/GSL-301),
  parent epic [GSL-297](https://ainstance-labs.atlassian.net/browse/GSL-297).
