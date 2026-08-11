# GSL-333 — Permission-timeout: expire orphaned rows so the panel stops presenting them as answerable

Parent epic: **GSL-330** ("Run-09 live-agent findings").
Prior related: GSL-284 (permission Allow/Deny), GSL-304 (real PermissionRequest event wiring), GSL-312 (SSE cross-tab fan-out).
Landed on branch `GSL-330-run09-fixes`.

## What was done

New endpoint `POST /internal/permissions/:qid/expire` on the core: given an `open` permission
row, transitions to a NEW terminal state `status='timed-out'`, sets
`applied_by='shim-timeout'`, stamps `answered_at`. Idempotent — a row that already went
terminal (e.g., the owner clicked Allow at the exact moment the shim's wait gave up) is a
200 no-op that leaks nothing. Broadcasts a `question.expired` SSE event so the panel
invalidates its Questions query immediately.

`tools/hooks/permission-request-hook.sh` now POSTs the new endpoint from the `WAIT_STATUS = 204`
timeout branch — a best-effort, fail-open curl with a 5-second cap on the connect+transfer
budget. The shim never delays its TUI-takeover exit on the expire call.

`apps/web/src/screens/Questions.tsx` learns the `timed-out` status: adds a `neutral`-toned
badge and, for permission-kind rows, renders an explanatory note ("answered in terminal —
hook long-poll timed out; the TUI dialog took over. No panel action available."). The
Allow/Deny buttons were already gone at that point (`canDecide` guards on
`status === "open"`) — the note tells the operator WHY they are gone.

The existing `POST /actions/permissions/decide` guard `status !== 'open'` catches the race
where the owner clicked Allow in the panel between the shim's expire POST landing and the
tab's SSE refresh — the decide returns 409 with the explanatory `status=timed-out` in the
error text.

8 new tests total: 7 in `internal.test.ts` (open→timed-out; idempotent already-terminal;
second expire on already-expired; wrong-kind → 409; unknown qid → 404; missing bearer/secret
→ 401; blank qid → 400/404), 1 in `actions.decidePermission.sse.test.ts` (decide on
timed-out row → 409, row unchanged).

Live proof: `.artifacts/live-proof-major3/` — scratch core on 127.0.0.1:7354, six-step
end-to-end sequence (post permission → /questions status=open → expire → /questions
status=timed-out with applied_by=shim-timeout → decide returns 409 → second expire returns
transitioned:false). Core torn down; port 7354 clean.

## Problems solved

- Run 09 finding #7: after the PermissionRequest hook long-poll timed out, the shim exited
  and Claude Code fell back to the TUI dialog, but the DB row stayed `status='open'`. A
  subsequent panel Allow/Deny was ORPHANED — DB flipped to `answered` but the shim was
  DEAD and CC had already moved on. Post-fix the panel is not tempted: buttons are gone,
  the badge is `timed-out`, an explanatory note names the reason. Belt and braces: even
  if a race lands the panel click first, the decide endpoint returns 409.
- Symmetry with the existing terminal states: `timed-out` behaves like `superseded` for the
  panel (neutral, no action) but names its provenance in `applied_by` so a future audit /
  runbook can tell them apart.

## Problems remaining

- The MINOR finding #9 semantic (TUI + panel racing in parallel by design, whoever clicks
  first wins) is intentionally NOT addressed here. The ticket calls it out as out of
  scope; this task only closes the orphan-after-timeout MAJOR.
- The shim's expire POST is fire-and-forget: if the core is unreachable at the exact moment
  the shim times out, the row stays `open` and the panel again presents an actionable card.
  This is a straight-up dependency on core availability — the panel's own status column
  already shows the age of the row, so a very stale `open` permission row is already a
  visible signal that something is wrong.

## Pitfalls & workarounds

- The expire endpoint MUST return 200 for `applied_by='owner'` terminal rows so the shim's
  fail-open flow doesn't try to log the "failure" of a NON-failure. The idempotent branch
  is deliberately quiet.
- The `broadcaster` import in `internal.ts` is already aliased as `agentSessionsBroadcaster`
  — didn't rename it (a rename would touch every emit call in the file).
- The web `timed-out` note appears only for `kind==='permission'` rows to avoid confusing
  a future BLOCKER row that might use the same status name for a different reason.

## What didn't make it

- No `applied_by='shim-timeout'` filter in the /actions/permissions/decide error text —
  the caller (the panel) reads the row via /questions afterwards anyway, so richer error
  detail is only useful in the JSON body, which already carries `status=timed-out`.
- No metric for `permission.expire` events wired into `metrics/registry.ts` — the SSE
  event carries the counting signal for the panel; a proper prometheus counter can be a
  small follow-up if the operator wants dashboards.

---

## Technical reference

- Commit: (added at land)
- Files touched:
  - `apps/core/src/routes/internal.ts` — new `POST /internal/permissions/:qid/expire`.
  - `tools/hooks/permission-request-hook.sh` — best-effort expire POST on wait-204.
  - `apps/web/src/screens/Questions.tsx` — `timed-out` badge tone + non-actionable note.
  - `apps/core/test/internal.test.ts` — 7 new tests.
  - `apps/core/test/actions.decidePermission.sse.test.ts` — 1 new test (decide-on-timed-out → 409).
  - `.artifacts/live-proof-major3/` — end-to-end scratch-core proof + logs (worktree-only, not committed).
- New endpoint / migration: **new endpoint `POST /internal/permissions/:qid/expire`**; **no new schema column** — reuses `status`, `answered_at`, `applied_by`.
- Verified by running:
  - `bash -n tools/hooks/permission-request-hook.sh` — clean.
  - `bun x tsc -p apps/core --noEmit` + `apps/web --noEmit` — clean.
  - `bun test apps/core` — 287/287 (+8 new).
  - Live proof: 6-step scratch-core sequence completed as expected; port 7354 clean.
  - Web build clean.
- Links:
  - Jira: <https://ainstance-labs.atlassian.net/browse/GSL-333>
  - GH issue: <https://github.com/ainstance-labs/gosleep/issues/334>
  - Run 09 finding #7: `docs/reports/verifications/web-e2e-2026-08-10/runs/09/index.html`
