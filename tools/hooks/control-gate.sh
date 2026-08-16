#!/usr/bin/env bash
# =============================================================================
# gosleep — runtime control gate (GSL-361, observer mode phase B).
#
# Sourced by ask-user-question-hook.sh + permission-request-hook.sh. Implements the
# compound-OR gate the PRD calls for (F15-S2, F15-S4, R15.6):
#
#   proceed = (GOSLEEP_WEB_QUESTIONS=1)                                  # env compat, always wins
#            OR (core /internal/sessions/:sid/control says 'controlled') # runtime toggle
#
# Fail-mode: on core-unreachable we FALL BACK to env-flag-only. The binding decision
# (owner d-2026-08-08-001 reframing): never fail-open into interception. If the runtime
# state cannot be read, only sessions that already had the env flag proceed.
#
# In-process cache: 1 s TTL keyed on session_id. Cache lives in a per-invocation tempfile
# under $TMPDIR/gosleep-control-cache-<uid>/<session_id>. Cross-invocation persistence gives
# us the R15.6 property: at most one HTTP round-trip per second per session, regardless of
# how many hook events fire.
#
# Contract for the caller (source this script, then):
#   control_gate_should_proceed "<session_id>" [pid]
#     → sets $GOSLEEP_CONTROL_PROCEED to "1" if the shim should enter the long-poll,
#       "0" if it should exit 0 (fast fallback to TUI). Also sets:
#         $GOSLEEP_CONTROL_STATE — "controlled" | "observer" | "unknown"
#         $GOSLEEP_CONTROL_SOURCE — "env" | "runtime" | "unknown"
#     Never exits, never prints to stdout (would break the hookSpecificOutput contract).
#
# Callers must be inside `set -u -o pipefail` and must already have CORE_URL /
# INTERNAL_SECRET / HOST_HEADER / CONNECT_TIMEOUT_S in scope — this script does NOT read
# env or reach out on its own; it is a pure gate that borrows the caller's HTTP setup.
# =============================================================================

# Guard against accidental double-source.
if [ "${_GOSLEEP_CONTROL_GATE_LOADED:-0}" = "1" ]; then
    return 0 2>/dev/null || true
fi
_GOSLEEP_CONTROL_GATE_LOADED=1

# Cache TTL in seconds. Matches R15.6 ("shim cache TTL = 1s"). Deliberately not overridable
# via env — the panel timing contract depends on this being at most 1 s.
_GOSLEEP_CONTROL_CACHE_TTL_S=1

# Per-user cache root — a fresh sudo user gets their own to avoid perms races.
_gosleep_control_cache_root() {
    local uid
    uid="$(id -u 2>/dev/null || echo 0)"
    local root="${TMPDIR:-/tmp}/gosleep-control-cache-${uid}"
    mkdir -p "$root" 2>/dev/null || true
    printf '%s' "$root"
}

# Read the cache slot for a session_id. Prints:
#   "<state>|<source>|<mtime_epoch>" when a slot exists,
#   nothing when there is no slot.
_gosleep_control_cache_read() {
    local sid="$1"
    local root
    root="$(_gosleep_control_cache_root)"
    local slot="$root/${sid//[^A-Za-z0-9._-]/_}"
    if [ ! -f "$slot" ]; then
        return 0
    fi
    # File format: single line `<state> <source> <written_at_epoch>`.
    tr '\n' ' ' < "$slot" 2>/dev/null | awk '{ printf "%s|%s|%s", $1, $2, $3 }'
}

_gosleep_control_cache_write() {
    local sid="$1" state="$2" source="$3"
    local root
    root="$(_gosleep_control_cache_root)"
    local slot="$root/${sid//[^A-Za-z0-9._-]/_}"
    local now
    now="$(date +%s 2>/dev/null || echo 0)"
    printf '%s %s %s\n' "$state" "$source" "$now" > "$slot" 2>/dev/null || true
}

# GSL-389 debug-log helper. Emits a single-line JSON record to $GOSLEEP_HOOK_DEBUG_LOG when
# the caller sets it. Silent no-op otherwise — the shim path stays quiet by default. The
# format is `{"ts":<epoch>,"event":"shim.heartbeat","sid":...,"outcome":...,"http":...,"mode":...,"err":...}`.
# Errors from the append itself are ignored; the debug log is best-effort observability.
_gosleep_control_debug_log_hb() {
    local sid="$1" outcome="$2" http="$3" mode="$4" err="$5"
    local target="${GOSLEEP_HOOK_DEBUG_LOG:-}"
    if [ -z "$target" ]; then
        return 0
    fi
    local ts
    ts="$(date +%s 2>/dev/null || echo 0)"
    # Escape a small set of characters in $err so the JSON stays parseable if curl-stderr
    # ever contains a stray quote or newline. Anything more elaborate belongs in a real
    # JSON encoder; the shim never emits pathological error strings in practice.
    local err_escaped
    err_escaped="$(printf '%s' "$err" | LC_ALL=C tr -d '\r' | LC_ALL=C tr '\n' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g')"
    printf '{"ts":%s,"event":"shim.heartbeat","sid":"%s","outcome":"%s","http":"%s","mode":"%s","err":"%s"}\n' \
        "$ts" "$sid" "$outcome" "$http" "$mode" "$err_escaped" \
        >> "$target" 2>/dev/null || true
}

# Send the heartbeat once per shim process. Two-phase design (GSL-389, fixes E2E run-01 M1):
#   * FIRST invocation is SYNCHRONOUS. The blocking POST holds the shim for at most
#     $CONNECT_TIMEOUT_S + 1 s (usually a few milliseconds on the loopback). The synchronous
#     path is the one that populates `session_control` before Take-control needs it — the
#     old fire-and-forget form could race the shim's own exit and drop the request without
#     leaving any operator-visible trace.
#   * Every invocation writes an outcome line into $GOSLEEP_HOOK_DEBUG_LOG when set
#     (`{"outcome":"ok"|"fail","http":<code>}`). Silence during onboarding was
#     indistinguishable from success in run-01; a JSON line makes the failure diagnosable.
#
# Backgrounded / opt-out path retained for latency-critical callers via
# GOSLEEP_HEARTBEAT_MODE=async — the current shims all use the default sync path.
#
# GSL-368 context (retained): a backgrounded child was previously used to keep the shim's
# parent from waiting on a shared stdio pipe. The synchronous path here inherits the parent
# stdio too, but curl writes only to /dev/null — the child exits cleanly, so the parent
# sees EOF as soon as the shim itself exits. The scenario GSL-368 fixed (9.4 s
# release-cutover outlier) does not regress because curl's own max-time bounds this
# invocation.
_gosleep_control_fire_heartbeat() {
    local sid="$1" pid="$2"
    # env_opt_in mirrors the outer $GOSLEEP_WEB_QUESTIONS.
    local env_opt
    if [ "${GOSLEEP_WEB_QUESTIONS:-0}" = "1" ]; then
        env_opt="true"
    else
        env_opt="false"
    fi
    local body
    body="$(printf '{"pid":%s,"env_opt_in":%s}' "${pid:-null}" "$env_opt")"

    local mode="${GOSLEEP_HEARTBEAT_MODE:-sync}"
    if [ "$mode" = "async" ]; then
        # Opt-in legacy path — background POST, all errors swallowed. The debug log records
        # "queued" so the owner knows the outcome is not observable from here.
        (
            curl -sS -o /dev/null \
                --connect-timeout "${CONNECT_TIMEOUT_S:-2}" \
                --max-time "$((${CONNECT_TIMEOUT_S:-2} + 3))" \
                -X POST \
                -H "Host: ${HOST_HEADER:-127.0.0.1:7331}" \
                -H "Origin: ${ORIGIN_HEADER:-http://127.0.0.1:7331}" \
                -H "Content-Type: application/json" \
                -H "X-Internal-Secret: ${INTERNAL_SECRET:-}" \
                -d "$body" \
                "${CORE_URL:-http://127.0.0.1:7331}/internal/sessions/${sid}/shim-heartbeat" \
                2>/dev/null || true
        ) </dev/null >/dev/null 2>&1 &
        disown 2>/dev/null || true
        _gosleep_control_debug_log_hb "$sid" "queued" "000" "async" ""
        return 0
    fi

    # Sync path (default). Capture the HTTP code from a single curl invocation; a body-write
    # target is /dev/null so we never blow the shim's own stdout. Stderr is teed into a
    # per-invocation tempfile so the debug log can surface curl's own message on failure.
    local err_file http
    err_file="$(mktemp -t gosleep-control-hb-err.XXXXXX 2>/dev/null || echo "/tmp/gosleep-control-hb-err.$$")"
    http="$(curl -sS -o /dev/null -w '%{http_code}' \
        --connect-timeout "${CONNECT_TIMEOUT_S:-2}" \
        --max-time "$((${CONNECT_TIMEOUT_S:-2} + 1))" \
        -X POST \
        -H "Host: ${HOST_HEADER:-127.0.0.1:7331}" \
        -H "Origin: ${ORIGIN_HEADER:-http://127.0.0.1:7331}" \
        -H "Content-Type: application/json" \
        -H "X-Internal-Secret: ${INTERNAL_SECRET:-}" \
        -d "$body" \
        "${CORE_URL:-http://127.0.0.1:7331}/internal/sessions/${sid}/shim-heartbeat" \
        2>"$err_file" || echo "000")"
    local err_msg=""
    if [ -s "$err_file" ]; then
        err_msg="$(head -c 512 "$err_file" 2>/dev/null || true)"
    fi
    rm -f "$err_file" 2>/dev/null || true
    if [ "$http" = "200" ] || [ "$http" = "204" ]; then
        _gosleep_control_debug_log_hb "$sid" "ok" "$http" "sync" ""
    else
        _gosleep_control_debug_log_hb "$sid" "fail" "$http" "sync" "$err_msg"
    fi
}

# The gate itself. Sets three outer-scope variables:
#   GOSLEEP_CONTROL_PROCEED  — "1" | "0"
#   GOSLEEP_CONTROL_STATE    — "controlled" | "observer" | "unknown"
#   GOSLEEP_CONTROL_SOURCE   — "env" | "runtime" | "unknown"
control_gate_should_proceed() {
    local sid="$1"
    local pid="${2:-}"
    GOSLEEP_CONTROL_PROCEED=0
    GOSLEEP_CONTROL_STATE="unknown"
    GOSLEEP_CONTROL_SOURCE="unknown"

    # Env flag ALWAYS wins (F15-S4 + R15.3 compat). No network needed if the flag is on;
    # we still fire the heartbeat so the panel can render the env-locked pill.
    if [ "${GOSLEEP_WEB_QUESTIONS:-0}" = "1" ]; then
        GOSLEEP_CONTROL_PROCEED=1
        GOSLEEP_CONTROL_STATE="controlled"
        GOSLEEP_CONTROL_SOURCE="env"
        # Fire heartbeat once per process so the panel sees shim_registered + env-locked.
        if [ "${_GOSLEEP_CONTROL_HB_FIRED:-0}" != "1" ] && [ -n "$sid" ]; then
            _gosleep_control_fire_heartbeat "$sid" "$pid"
            _GOSLEEP_CONTROL_HB_FIRED=1
        fi
        return 0
    fi

    # No session id → we cannot consult the registry. Fall back to env-flag-only (which is 0).
    if [ -z "$sid" ]; then
        return 0
    fi

    # Cache lookup first — a hit within TTL avoids the round-trip entirely.
    local cached
    cached="$(_gosleep_control_cache_read "$sid")"
    if [ -n "$cached" ]; then
        local c_state c_source c_ts now age
        c_state="$(printf '%s' "$cached" | awk -F'|' '{print $1}')"
        c_source="$(printf '%s' "$cached" | awk -F'|' '{print $2}')"
        c_ts="$(printf '%s' "$cached" | awk -F'|' '{print $3}')"
        now="$(date +%s 2>/dev/null || echo 0)"
        age=$((now - c_ts))
        if [ "$age" -lt 0 ]; then age=0; fi
        if [ "$age" -le "$_GOSLEEP_CONTROL_CACHE_TTL_S" ]; then
            GOSLEEP_CONTROL_STATE="$c_state"
            GOSLEEP_CONTROL_SOURCE="$c_source"
            if [ "$c_state" = "controlled" ]; then
                GOSLEEP_CONTROL_PROCEED=1
            fi
            # Fire heartbeat on first invocation only.
            if [ "${_GOSLEEP_CONTROL_HB_FIRED:-0}" != "1" ]; then
                _gosleep_control_fire_heartbeat "$sid" "$pid"
                _GOSLEEP_CONTROL_HB_FIRED=1
            fi
            return 0
        fi
    fi

    # Cache miss OR stale — hit the core. Bounded connect + max-time so a hung server does
    # not delay the shim more than the caller's CONNECT_TIMEOUT_S + a small budget.
    local ck_stdout ck_status
    ck_stdout="$(mktemp -t gosleep-control-check.XXXXXX 2>/dev/null || echo "/tmp/gosleep-control-check.$$")"
    ck_status="$(curl -sS -o "$ck_stdout" -w '%{http_code}' \
        --connect-timeout "${CONNECT_TIMEOUT_S:-2}" \
        --max-time "$((${CONNECT_TIMEOUT_S:-2} + 2))" \
        -X GET \
        -H "Host: ${HOST_HEADER:-127.0.0.1:7331}" \
        -H "X-Internal-Secret: ${INTERNAL_SECRET:-}" \
        "${CORE_URL:-http://127.0.0.1:7331}/internal/sessions/${sid}/control" \
        2>/dev/null || echo "000")"

    if [ "$ck_status" != "200" ]; then
        # Core unreachable / 401 / 503. Fall back to env-flag-only (already 0 since we would
        # not have reached here with env=1). Cache a short "unknown" slot so a burst of misses
        # inside the TTL window still coalesces.
        rm -f "$ck_stdout" 2>/dev/null || true
        _gosleep_control_cache_write "$sid" "observer" "unknown"
        GOSLEEP_CONTROL_STATE="unknown"
        GOSLEEP_CONTROL_SOURCE="unknown"
        # Still fire a heartbeat once — it may succeed even if the read did not (e.g. the
        # writer is up but the reader hit a race), and the panel needs the row eventually.
        if [ "${_GOSLEEP_CONTROL_HB_FIRED:-0}" != "1" ]; then
            _gosleep_control_fire_heartbeat "$sid" "$pid"
            _GOSLEEP_CONTROL_HB_FIRED=1
        fi
        return 0
    fi

    # Parse the response. Python3 handles the JSON — same discipline as the rest of the shim.
    local parsed
    parsed="$(python3 - "$ck_stdout" <<'PY' 2>/dev/null || printf 'observer runtime'
import json, sys
try:
    with open(sys.argv[1]) as f:
        d = json.load(f)
    state = d.get("state") or "observer"
    source = d.get("source") or "runtime"
    if state not in ("controlled", "observer"):
        state = "observer"
    if source not in ("env", "runtime", "inherited"):
        source = "runtime"
    print(state, source)
except Exception:
    print("observer", "runtime")
PY
)"
    rm -f "$ck_stdout" 2>/dev/null || true

    local read_state read_source
    read_state="$(printf '%s' "$parsed" | awk '{print $1}')"
    read_source="$(printf '%s' "$parsed" | awk '{print $2}')"
    if [ -z "$read_state" ]; then read_state="observer"; fi
    if [ -z "$read_source" ]; then read_source="runtime"; fi

    _gosleep_control_cache_write "$sid" "$read_state" "$read_source"
    GOSLEEP_CONTROL_STATE="$read_state"
    GOSLEEP_CONTROL_SOURCE="$read_source"
    if [ "$read_state" = "controlled" ]; then
        GOSLEEP_CONTROL_PROCEED=1
    fi

    # Fire heartbeat once per process — same as above.
    if [ "${_GOSLEEP_CONTROL_HB_FIRED:-0}" != "1" ]; then
        _gosleep_control_fire_heartbeat "$sid" "$pid"
        _GOSLEEP_CONTROL_HB_FIRED=1
    fi
}
