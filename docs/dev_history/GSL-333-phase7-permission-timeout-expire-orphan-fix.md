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

8 tests total (initial): 7 in `internal.test.ts` (open→timed-out; idempotent already-terminal;
second expire on already-expired; wrong-kind → 409; unknown qid → 404; missing bearer/secret
→ 401; blank qid → 400/404), 1 in `actions.decidePermission.sse.test.ts` (decide on
timed-out row → 409, row unchanged).

Live proof (major3): `.artifacts/live-proof-major3/` — scratch core on 127.0.0.1:7354, six-step
end-to-end sequence (post permission → /questions status=open → expire → /questions
status=timed-out with applied_by=shim-timeout → decide returns 409 → second expire returns
transitioned:false). Core torn down; port 7354 clean.

## FOLLOWUP (2026-08-11, run-10 C3 blocker)

The initial land was **incomplete**. Verification run-10 caught it: the shim's expire curl
was missing `-H "Origin: $ORIGIN_HEADER"`, so the `requireLocalOrigin` CSRF middleware
bounced every real-path expire attempt with 403 — the row stayed `open`, the panel kept
Allow/Deny live, and the run-09 orphan-answer bug persisted on the actual dev-agent path.

Fix (commit `77bdb3d`): add `-H "Origin: $ORIGIN_HEADER"` to the expire curl in
`tools/hooks/permission-request-hook.sh`, mirroring the header shape the sibling
`/internal/permissions/post` curl already uses ten lines above. One-line surgical change +
5-line comment naming the trap for the next reader.

Also plugged the test-bench gap that let this ship: the original GSL-333 tests mounted
`internalRoutes` directly and bypassed the app-wide `requireLocalOrigin` layer. Added
5 new tests in `apps/core/test/internal.test.ts`:

- **CSRF gating on expire** (3): no Origin → 403 row untouched (the run-10 C3 bug);
  Origin: SELF → 200 transitioned; cross-site Origin → 403 row untouched.
- **Shim-source regression** (2): expire curl block contains `Origin: $ORIGIN_HEADER`
  and `X-Internal-Secret` and `Host`; every authenticated POST in the shim carries Origin.

Total after followup: **13 new tests** across the two files.

### Followup live proof (`.artifacts/live-c3/`)

Scratch core on **127.0.0.1:7356** (DB, snapshots, and logs under
`.artifacts/live-c3/`; never touched port 7331 or `data/gosleep.db`). Env: dev-mode Bearer =
GOSLEEP_INTERNAL_SECRET. Sandbox at `$HOME/e2e-workspaces/todo-fix4` (clone of
`ainstance-labs/gosleep-e2e-todo`) with `.claude/settings.json` wiring
`PermissionRequest` to the WORKTREE's `permission-request-hook.sh` (so the FIXED shim was
exercised, not the shared-tree's old one).

Real `claude --model sonnet` session in tmux pane `%309` (visible, non-bypass, Sonnet 5 with
xhigh effort, verified by the banner "Sonnet 5 │ todo-fix4"). Session id:
`19a98d95-ed15-4c59-90a5-53b29c40d9c2`. Prompt: run a bash command that Claude Code would
gate — `curl -sS https://example.com/robots.txt | head -c 40`. Owner never answered.

Result on the DB row **`p-20260811-130703-d91502ae`** (captured verbatim, the actual command
the LIVE Sonnet asked about):

| Checkpoint | Result | Evidence |
|---|---|---|
| Shim's `PermissionRequest` hook fired at prompt time | YES | `hook-debug.log` line for this qid, elapsed_ms=30000 |
| Long-poll returned 204 after `GOSLEEP_HOOK_TIMEOUT_S=30` | YES | `hook-debug.log` `outcome:"timeout"` |
| Shim's expire POST returned **2xx** (would have been 403 pre-fix) | **200** | `hook-debug.log` `expire_status:"200"` |
| Row transitioned to `status='timed-out'`, `applied_by='shim-timeout'` | YES | `sqlite3 gosleep.db` selects |
| `answer_text` stayed NULL (no orphan owner-answer landed after shim died) | YES | `answer_text: null` in `/questions` read |
| Subsequent `POST /actions/permissions/decide` on the row → **409** | **409** | body: `permission question p-20260811-130703-d91502ae is not open (status=timed-out)` |
| `GET /questions` (what the panel screen renders) shows the row as `timed-out` | YES | `applied_by:"shim-timeout"`, no `answer_text`; badge is `neutral`, Allow/Deny gone per `canDecide` guard |

Artifacts under `.artifacts/live-c3/`: `secret.txt`, `hook-debug.log`, `core.out`,
`core.err`, `gosleep.db`, `panel-setup.png` (setup shell — panel served on :7356 as
expected).

## Problems solved

- Run 09 finding #7: after the PermissionRequest hook long-poll timed out, the shim exited
  and Claude Code fell back to the TUI dialog, but the DB row stayed `status='open'`. A
  subsequent panel Allow/Deny was ORPHANED — DB flipped to `answered` but the shim was
  DEAD and CC had already moved on. Post-fix the panel is not tempted: buttons are gone,
  the badge is `timed-out`, an explanatory note names the reason. Belt and braces: even
  if a race lands the panel click first, the decide endpoint returns 409.
- **Run 10 C3 (followup):** the fix above was intended to close the bug but shipped
  without the Origin header on the expire curl, so on the real path the expire was
  rejected 403 and the row stayed `open`. Post-followup: expire returns 200 on the real
  path, verified with a real Sonnet 5 session (not in-process, not synthesized).
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
- **Trap the followup exposed:** the GSL-333 unit tests mount `internalRoutes` directly
  and bypass the app-wide `requireLocalOrigin` layer. Any future shim endpoint on
  `/internal/*` MUST have at least one test that exercises the CSRF middleware chain, or
  a regression exactly like this one can ship green. The `originGuardedApp` block in
  `internal.test.ts` is the pattern to copy.

## What didn't make it

- No `applied_by='shim-timeout'` filter in the /actions/permissions/decide error text —
  the caller (the panel) reads the row via /questions afterwards anyway, so richer error
  detail is only useful in the JSON body, which already carries `status=timed-out`.
- No metric for `permission.expire` events wired into `metrics/registry.ts` — the SSE
  event carries the counting signal for the panel; a proper prometheus counter can be a
  small follow-up if the operator wants dashboards.

---

## Technical reference

- Commit (initial): `179bb42`.
- Commit (followup): `77bdb3d` — expire curl was missing Origin header.
- Files touched (initial):
  - `apps/core/src/routes/internal.ts` — new `POST /internal/permissions/:qid/expire`.
  - `tools/hooks/permission-request-hook.sh` — best-effort expire POST on wait-204.
  - `apps/web/src/screens/Questions.tsx` — `timed-out` badge tone + non-actionable note.
  - `apps/core/test/internal.test.ts` — 7 new tests.
  - `apps/core/test/actions.decidePermission.sse.test.ts` — 1 new test (decide-on-timed-out → 409).
  - `.artifacts/live-proof-major3/` — end-to-end scratch-core proof + logs (worktree-only, not committed).
- Files touched (followup):
  - `tools/hooks/permission-request-hook.sh` — added `-H "Origin: $ORIGIN_HEADER"` to the expire curl.
  - `apps/core/test/internal.test.ts` — 5 new tests (3 CSRF-gated expire + 2 shim-source regression).
  - `.artifacts/live-c3/` — followup live proof (worktree-only, not committed).
- New endpoint / migration: **new endpoint `POST /internal/permissions/:qid/expire`**; **no new schema column** — reuses `status`, `answered_at`, `applied_by`.
- Verified by running (followup):
  - `bash -n tools/hooks/permission-request-hook.sh` — clean.
  - `apps/core/node_modules/.bin/tsc -p apps/core --noEmit` — clean.
  - `apps/web/node_modules/.bin/tsc -p apps/web --noEmit` — clean.
  - `bun test apps/core` — **292/292** (was 287; +5 followup tests).
  - `bash tools/lab/tests/core-smoke.sh` — 102/102.
  - `bun run --filter='@gosleep/web' build` — clean.
  - Live proof (real Sonnet 5 session id `19a98d95-ed15-4c59-90a5-53b29c40d9c2`): expire 200, row `timed-out+shim-timeout`, decide 409, panel non-actionable.
- Links:
  - Jira: <https://ainstance-labs.atlassian.net/browse/GSL-333>
  - GH issue: <https://github.com/ainstance-labs/gosleep/issues/334>
  - Run 09 finding #7: `docs/reports/verifications/web-e2e-2026-08-10/runs/09/index.html`
  - Run 10 C3 blocker: caught by orchestrator during PR #335 review; this followup closes it.
