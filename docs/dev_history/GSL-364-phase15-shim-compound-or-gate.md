# GSL-364 — Shim compound-OR gate + heartbeat (both hooks)

**Epic:** GSL-361 · **Branch:** `GSL-361-observer-mode-phase-b` · **Base:** `origin/main` @ `7e44e59`.

Client side of Phase 15. Both `PreToolUse{AskUserQuestion}` and top-level `PermissionRequest`
shims swap their launch-time env-flag fast-exit for a compound-OR gate consulting the core's
runtime toggle.

## Shared helper — `tools/hooks/control-gate.sh`

Sourced by both hooks. Implements:

1. Peek at stdin's `session_id` (payload is captured to a peek file; the hook restores stdin
   for the downstream flow via `exec <`).
2. `GOSLEEP_WEB_QUESTIONS=1` always wins fast (env-flag compat, F15-S4, R15.3). Fires
   heartbeat once per shim process.
3. Cache lookup: `$TMPDIR/gosleep-control-cache-<uid>/<sid>` file with `state source ts`.
   Hits within 1 s TTL skip the network entirely — R15.6 ("shim gate adds at most one 5 ms
   127.0.0.1 request in the miss path").
4. Cache miss: `GET /internal/sessions/:sid/control` with bounded connect + max-time. On
   200, parse `{state, source}` via a small inline `python3` reader (no jq dep). On any
   non-200 (401, 503, connect refused), fall back to env-flag-only — the binding decision
   forbids fail-open into interception.
5. Heartbeat: on the FIRST invocation of a given shim process, fires
   `POST /internal/sessions/:sid/shim-heartbeat` in the background with
   `{pid, env_opt_in}`. Subsequent invocations skip the heartbeat (still refresh the
   server-side `last_heartbeat_at` on the next cache miss).

Exports `control_gate_should_proceed()` which sets three outer-scope variables
(`GOSLEEP_CONTROL_PROCEED`, `GOSLEEP_CONTROL_STATE`, `GOSLEEP_CONTROL_SOURCE`). Never
exits, never prints to stdout (would break the hookSpecificOutput contract).

## Hook rewrites

`tools/hooks/ask-user-question-hook.sh` + `tools/hooks/permission-request-hook.sh`:

- Removed the historic GSL-267 fast-exit `if [ "${GOSLEEP_WEB_QUESTIONS:-0}" != "1" ]; then
  exit 0; fi` block.
- New preamble captures stdin into a peek file (with `trap EXIT` cleanup), extracts
  `session_id` via `python3`, sources `control-gate.sh`, calls the gate helper, and only
  proceeds into the existing long-poll flow when the gate says so.
- Env-flag semantics are unchanged: a session launched with `GOSLEEP_WEB_QUESTIONS=1` still
  proceeds instantly (no network on the fast path) and registers as env-locked on the panel.
- Non-opted sessions consult the registry; when core says `state='controlled'`, the shim
  enters the same long-poll path that the env flag used to gate. Same downstream code, same
  hookSpecificOutput shape, same fail-open discipline throughout.

## Bash sanity

`bash -n` clean on all three touched scripts:

- `tools/hooks/control-gate.sh`
- `tools/hooks/ask-user-question-hook.sh`
- `tools/hooks/permission-request-hook.sh`

## Smoke — `tools/lab/tests/shim-control-gate.sh`

Boots a minimal fake core (python3 http.server) that answers `GET .../control` from a
fixture state file and no-ops `POST .../shim-heartbeat` (logs to a file). Runs the shared
gate through 5 scenarios in bash subshells with private `$TMPDIR`:

1. **env-flag ON, core unreachable** → PROCEED=1, state=controlled, source=env (env
   fast-path wins without a network hit).
2. **env OFF, core=controlled/runtime** → PROCEED=1.
3. **env OFF, core=observer** → PROCEED=0 (fast-exit; TUI renders).
4. **env OFF, core UNREACHABLE** → PROCEED=0 (binding: never fail-open into interception).
5. **cache TTL** → two invocations in the same shell within 1 s hit the network exactly
   ONCE.

All 5 pass. Not wired into `gate.sh` (starts a process); run by hand around changes to
`tools/hooks/control-gate.sh`.

## Follow-ups

None. The gate is minimum-viable for Phase 15 acceptance. Future hardening: expose the
cache TTL as an env knob (Risk 1 in the PRD suggested `session.control.shim_cache_ttl_ms`).
Not shipped in this task — R15.6 requires TTL ≤ 1 s and the deployment target has no reason
to vary that today.
