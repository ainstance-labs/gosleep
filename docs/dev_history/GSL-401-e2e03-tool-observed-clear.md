# GSL-401 [Core][Hook] PostToolUse clear for tool-observed

## What

Resolves E2E run-03 finding m1: after the AskUserQuestion shim intercepts, the panel
answers, and Claude proceeds to `status=idle`, the Fleet card's `current_tool` /
`current_intent` stayed pinned to `"AskUserQuestion"` / `"AskUserQuestion pending owner
answer"` indefinitely — a raw `curl /fleet` showed the same string (this was live
server-side data, not a client cache).

## Why the field never cleared

Two design constraints combined to produce the stuck value:

1. `tools/hooks/tool-observed-feed.sh` was only wired into `PreToolUse`. Nothing
   fires on `PostToolUse` to signal that a shim-intercepted tool has exited.
2. `flushPendingObservations` in `apps/core/src/routes/internal.ts` merges each
   incoming observation via `COALESCE(?, current_intent)` so that a partial
   observation cannot clobber a fresh intent with `NULL`. That guard is correct
   for the common path — but there is no other code path that ever writes `NULL`
   over `current_intent`, so once the shim posts an intent it stays until another
   tool observation overwrites it.

Cosmetic-only: the card still shows the real `status` transition (`busy → idle`),
but the CURRENT TOOL / INTENT strings read as stuck.

## Fix (server + hook + settings)

1. **`apps/core/src/routes/internal.ts`** — extend `POST /internal/agents/tool-observed`
   to accept `{session_id, clear: true}`. When `clear=true`, only `session_id` is
   required (the tool name is not carried by a clear); the handler enqueues a
   clear-observation onto the same debounce map as regular observations. Extended
   `flushPendingObservations` to handle a `clear:true` entry as an `UPDATE
   agent_sessions SET current_tool = NULL, current_intent = NULL, updated_at = ?
   WHERE session_id = ?`. A clear on an unknown `session_id` is a silent no-op
   (never inserts a placeholder row — that would be meaningless).

2. **`tools/hooks/tool-observed-feed.sh`** — new env-flag branch
   `GOSLEEP_TOOL_OBSERVED_CLEAR=1`. When set, the shim reads only the payload's
   `session_id` (via the same first-match awk anchor the AskUserQuestion /
   PermissionRequest shims use — 64 KiB peek window, GSL-386 hardening) and POSTs
   `{session_id, clear:true}`. All existing guards (`WEB_QUESTIONS=1` gate,
   `INTERNAL_SECRET` presence, curl fail-open on non-200) still apply.

3. **`.claude/settings.json`** — add a `PostToolUse` block matching
   `AskUserQuestion` (the tool the run-03 finding pinned down) that invokes
   `tool-observed-feed.sh` with `GOSLEEP_TOOL_OBSERVED_CLEAR=1`. Runs in the
   normal PostToolUse timeout budget; the shim itself is fail-open on every path
   so a slow / down core cannot wedge Claude's post-tool return.

## Tests

`apps/core/test/toolObservedClear.test.ts` — 5 red-first assertions on the fix
surface:

- `clear:true` on a session with a pending AskUserQuestion NULLs `current_tool`
  AND `current_intent` after the debounce flush.
- `clear:true` on an UNKNOWN `session_id` is a no-op — no row inserted, no error.
- `clear:true` still requires `session_id` (400 without it).
- Non-clear POST still requires `session_id` AND `tool` (the pre-GSL-401 contract
  is preserved for the normal write path).
- Non-clear POST still writes `current_tool` + `current_intent` via COALESCE —
  regression guard against accidentally weakening the merge path.

Before the fix, three tests fail (expected — the endpoint 400s without `tool`).
After the fix, all five pass.

## Live spot-check

Scratch core on `127.0.0.1:7369` (NEVER prod 7331). Fired a synthetic
`PreToolUse{AskUserQuestion}` payload → `curl /fleet` shows
`current_tool="AskUserQuestion"` and
`current_intent="AskUserQuestion pending owner answer"`. Fired the same payload
under `GOSLEEP_TOOL_OBSERVED_CLEAR=1` → both fields flip to `null` within the
1 s debounce window. Full evidence:
[`docs/dev_history/assets/GSL-401/live-spot-check.md`](assets/GSL-401/live-spot-check.md).

## Rollback

Delete the new `PostToolUse{AskUserQuestion}` block in `.claude/settings.json`
(the file watcher unloads it live) and the shim behaviour reverts exactly. The
core endpoint's `clear:true` branch is additive and dormant without the hook
wiring; it does not affect any pre-GSL-401 caller.

## References

- Report: `docs/reports/verifications/harness-web-e2e-2026-08-17/runs/03/index.html` — finding #1.
- Jira: GSL-401 under Epic GSL-400.
- GH mirror: ainstance-labs/gosleep#398.
