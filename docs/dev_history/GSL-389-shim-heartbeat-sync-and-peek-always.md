# GSL-389 — Shim heartbeat: synchronous first POST + always peek session_id + debug log

**Parent epic.** [GSL-388](https://ainstance-labs.atlassian.net/browse/GSL-388) — "[Core][Web] E2E run-01 findings — heartbeat + prompt-boundary + attribution + reopen + one-click".
**GH mirror.** https://github.com/ainstance-labs/gosleep/issues/382 (parent epic #381).
**Branch.** `GSL-388-e2e01-findings`.
**Commits.** `720f70c` (sync heartbeat + debug log) + `4b72bcc` (peek session_id always).

## What ran-01 found

`docs/reports/verifications/harness-web-e2e-2026-08-17/runs/01/index.html` finding #1: a
fresh Claude Code fixture launched with `GOSLEEP_WEB_QUESTIONS=1` and the matching
`GOSLEEP_INTERNAL_SECRET` correctly processed AskUserQuestion round-trips, but
`session_control` never gained a row — the panel's Take-control refused with
`"session_id … not found in session_control — shim has never checked in"` until the row
was seeded by hand with a manual `curl` to `/internal/sessions/<sid>/shim-heartbeat`.

Two independent gaps were in play; only the live-leg surfaced the second.

## Gap #1 — silent-fail background heartbeat

`_gosleep_control_fire_heartbeat` in `tools/hooks/control-gate.sh` fired the heartbeat
as a detached background subshell (GSL-368 detachment pattern) and swallowed every
error. If any component (`INTERNAL_SECRET`, `CORE_URL`, `HOST_HEADER`) failed to reach
the sub-shell env, or the race between shim exit and curl connect went badly, the POST
was lost and no operator-visible log line ever fired.

**Fix (commit `720f70c`).** Rewrote the heartbeat function to fire the FIRST heartbeat
SYNCHRONOUSLY (`--connect-timeout $CONNECT_TIMEOUT_S`, `--max-time $CONNECT_TIMEOUT_S+1`
— a few ms on the loopback) and write a single-line JSON record for every attempt to
`$GOSLEEP_HOOK_DEBUG_LOG` when set:

```
{"ts":<epoch>,"event":"shim.heartbeat","sid":"…","outcome":"ok"|"fail","http":<code>,"mode":"sync","err":"…"}
```

The GSL-368 detachment concern (parent process waiting on the shim's stdio pipe) is
preserved because curl writes only to `/dev/null` and the sync call has its own
`--max-time` ceiling. Legacy backgrounded path retained behind
`GOSLEEP_HEARTBEAT_MODE=async` for future latency-critical callers (currently unused).

**Red-first tests.** `tools/lab/tests/shim-control-gate.sh` gained scenarios 8 (happy
path — sync heartbeat lands + `outcome:ok` recorded by the time the gate returns) and
9 (unreachable core — a `hb_fail` JSON line appears in the debug log by the time the
gate returns, the exact property that was missing in run-01). 9/9 scenarios pass.

## Gap #2 — peek session_id skipped on the env-fast-path

The M1 live-leg discovered a second silent path the unit tests couldn't catch. GSL-367's
fast-path optimisation had *skipped the session_id peek entirely* when
`GOSLEEP_WEB_QUESTIONS=1`, on the reasoning that "the gate wins on env alone; no need for
sid before returning PROCEED". That was true for the gate's PROCEED decision — but the
gate's heartbeat fan-out required a non-empty sid. Skipping the peek meant
`control_gate_should_proceed` was called with `sid=""`, and `_gosleep_control_fire_heartbeat`
was never invoked. The sync-heartbeat fix from Gap #1 was correct but never executed.

**Fix (commit `4b72bcc`).** Peek the sid ALWAYS in both shims
(`ask-user-question-hook.sh`, `permission-request-hook.sh`). The peek uses the same
pure-shell `awk match()+exit` pipeline (no python3 spawn), so the fast-exit path stays
sub-100 ms end-to-end.

## Live-leg proof

Under `docs/dev_history/assets/GSL-388/` (both writes happen in the same shim invocation):

- `live-leg-hook-debug.jsonl` — `{"…","event":"shim.heartbeat","sid":"…","outcome":"ok","http":"200","mode":"sync"}` on first call, no polling.
- `live-leg-session-control.txt` — `fixe2e01-manual-live-test|controlled|env|1|86817|…` (state, source, shim_registered, last_heartbeat_pid, last_heartbeat_at) — row exists without any manual `curl` seeding.

Fixture Claude session id: `99986404-9e7b-4a6a-a0fa-1427edeff309` (real Claude Code
2.1.233, Sonnet, tmux session `fixe2e01-fixture`, pane_pid=87836).

## Files touched

- `tools/hooks/control-gate.sh` — sync heartbeat + `_gosleep_control_debug_log_hb` helper + `GOSLEEP_HEARTBEAT_MODE=async` opt-out.
- `tools/hooks/ask-user-question-hook.sh` — peek sid unconditionally (removed the `GOSLEEP_WEB_QUESTIONS != 1` guard on the peek block).
- `tools/hooks/permission-request-hook.sh` — same edit, mirrored.
- `tools/lab/tests/shim-control-gate.sh` — new scenarios 8 + 9.

## Gates

- `bash -n tools/hooks/control-gate.sh` — clean.
- `bash -n tools/hooks/ask-user-question-hook.sh` — clean.
- `bash -n tools/hooks/permission-request-hook.sh` — clean.
- `bash tools/lab/tests/shim-control-gate.sh` — 9/9 pass.
- Live-leg — session_control populated on the first hook fire.
