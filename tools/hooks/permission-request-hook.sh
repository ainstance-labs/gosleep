#!/usr/bin/env bash
# =============================================================================
# gosleep — PermissionRequest hook shim (GSL-284, real-event wiring by GSL-304).
#
# Sibling of `ask-user-question-hook.sh` (GSL-275). Wire this into a supervised session's
# `.claude/settings.json` under the DEDICATED top-level `PermissionRequest` event
# (GSL-304 real-session diagnosis — see docs/reports/verifications/GSL-304/runs/01/):
#   hooks.PermissionRequest[].matcher = ".*"           (matches on tool_name)
#   hooks.PermissionRequest[].hooks[].command = "$CLAUDE_PROJECT_DIR/tools/hooks/permission-request-hook.sh"
#
# History: GSL-284 originally wired this shim under `PreToolUse[matcher:"PermissionRequest"]`.
# That never fired: `PreToolUse.matcher` matches on `tool_name` (Bash, Edit, …) — no tool is
# literally named `PermissionRequest`. GSL-297 runs/01 assets/v9-perm-real-attempt-note.md
# documented the empty debug log; GSL-304 (this rewrite) moves the wiring to the dedicated
# top-level `PermissionRequest` event that fires exactly when a tool call needs a permission
# decision — and adapts the output shape below.
#
# The stdin payload Claude Code hands us for a real PermissionRequest event looks like:
#   { session_id: "<uuid>",
#     transcript_path: "…",
#     cwd: "…",
#     permission_mode: "default"|"acceptEdits"|…,
#     hook_event_name: "PermissionRequest",
#     tool_use_id: "<toolu_…>",
#     tool_name: "Bash"|"Edit"|…,
#     tool_input: { command: "…" }|{ file_path: "…", … } }
#
# We POST that to `POST /internal/permissions/post` on gosleep-core, receive `{qid}`, then
# LONG-POLL `GET /internal/questions/:qid/answer-wait?timeout_s=N` — the SAME long-poll
# endpoint the AskUserQuestion shim uses. Symmetry is deliberate: one wait mechanism, one
# in-process notifier, one Bearer secret.
#
# The wait's 200 body carries `{answer_text: "allow"|"deny", ..., applied: "<reason?>"}`
# — this shim reads answer_text as the decision and, when the row's `applied` column is
# non-empty on a deny, forwards it as the `decision.reason` context field.
#
# Emits (on 200) — the PermissionRequest event's documented shape:
#   allow → { hookSpecificOutput: { hookEventName: "PermissionRequest",
#                                    decision: { behavior: "allow" } } }
#   deny  → { hookSpecificOutput: { hookEventName: "PermissionRequest",
#                                    decision: { behavior: "deny",
#                                                reason:   "<updated_message>" } } }
#
# Every non-happy branch (missing secret, connect refused, 401/503/500, python parse
# error, empty stdin, wait timeout) routes to `fail_open` which exits 0 with no stdout
# — same discipline as the AskUserQuestion shim: never exit 2 (would DENY), never modal,
# never emit noise to stdout.
#
# Env inputs mirror ask-user-question-hook.sh:
#   GOSLEEP_CORE_URL           default http://127.0.0.1:7331
#   GOSLEEP_INTERNAL_SECRET    required to talk to /internal/*; missing → fail-open
#   GOSLEEP_HOOK_TIMEOUT_S     default 600 (hooks.md documented command default)
#   GOSLEEP_HOOK_CONNECT_S     default 2 (hard cap on connect phase)
#   GOSLEEP_HOOK_DEBUG_LOG     optional; each call appends one JSON line for post-mortems
#   GOSLEEP_PERM_REQ_DUMP      GSL-304 diagnostic: when set to a path prefix, appends the
#                              raw stdin payload as `<prefix>.<epoch-ns>` (mirrors the
#                              GSL-303 GOSLEEP_TOOL_OBSERVED_DUMP pattern). Used once to
#                              capture v1-perm-req-* evidence; fail-open on write failure.
#
# CRITICAL invariants:
#   * NEVER exit 2 unless we mean to DENY the permission. Every error routes to fail_open.
#   * NEVER emit stdout noise — the stdout JSON is the whole contract with Claude Code.
#   * NEVER echo the secret. curl reads it from env; we do not `set -x`; debug log
#     records no auth values.
# =============================================================================

set -u -o pipefail

# =============================================================================
# GSL-361 COMPOUND-OR GATE (observer mode phase B, reframes GSL-267).
#
# See ask-user-question-hook.sh for the full rationale. TL;DR: the launch-time env-flag gate
# is now a compound-OR with the runtime toggle exposed by the panel; env-flag still wins
# instantly, runtime-toggle takes effect within a 1 s cache TTL, core-unreachable falls back
# to env-flag-only (never fail-open into interception, per the binding decision).
# =============================================================================

CORE_URL="${GOSLEEP_CORE_URL:-http://127.0.0.1:7331}"
INTERNAL_SECRET="${GOSLEEP_INTERNAL_SECRET:-}"
HOOK_TIMEOUT_S="${GOSLEEP_HOOK_TIMEOUT_S:-600}"
CONNECT_TIMEOUT_S="${GOSLEEP_HOOK_CONNECT_S:-2}"
DEBUG_LOG="${GOSLEEP_HOOK_DEBUG_LOG:-}"

HOST_HEADER="${CORE_URL#http://}"
HOST_HEADER="${HOST_HEADER#https://}"
HOST_HEADER="${HOST_HEADER%%/*}"
ORIGIN_HEADER="${CORE_URL%/}"

# Compound-OR gate: peek at stdin for the session_id, consult the core / env flag, and
# fast-exit unless the session is opted-in.
_GOSLEEP_STDIN_PEEK="$(mktemp -t gosleep-perm-hook-peek.XXXXXX 2>/dev/null || echo "/tmp/gosleep-perm-hook-peek.$$")"
trap 'rm -f "$_GOSLEEP_STDIN_PEEK" 2>/dev/null || true' EXIT
cat > "$_GOSLEEP_STDIN_PEEK" 2>/dev/null || true
exec < "$_GOSLEEP_STDIN_PEEK"

_GOSLEEP_PEEK_SESSION_ID=""
if command -v python3 >/dev/null 2>&1 && [ -s "$_GOSLEEP_STDIN_PEEK" ]; then
    _GOSLEEP_PEEK_SESSION_ID="$(python3 - "$_GOSLEEP_STDIN_PEEK" <<'PY' 2>/dev/null || printf ''
import json, sys
try:
    with open(sys.argv[1]) as f:
        d = json.load(f)
    print(d.get("session_id", "") or "", end="")
except Exception:
    pass
PY
)"
fi

# shellcheck disable=SC1091
. "$(dirname "$0")/control-gate.sh"

control_gate_should_proceed "$_GOSLEEP_PEEK_SESSION_ID" "$$"
if [ "${GOSLEEP_CONTROL_PROCEED:-0}" != "1" ]; then
    exit 0
fi

CURL_WAIT_TIMEOUT_S=$((HOOK_TIMEOUT_S + 5))

STARTED_EPOCH="$(date +%s 2>/dev/null || echo 0)"

log_debug() {
    [ -z "$DEBUG_LOG" ] && return 0
    local outcome="$1" qid="$2" extra="$3"
    local now
    now="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)"
    local elapsed_ms=0
    if [ "$STARTED_EPOCH" != "0" ]; then
        local now_epoch
        now_epoch="$(date +%s 2>/dev/null || echo "$STARTED_EPOCH")"
        elapsed_ms=$(( (now_epoch - STARTED_EPOCH) * 1000 ))
    fi
    printf '{"ts":"%s","hook":"permission-request","outcome":"%s","qid":"%s","elapsed_ms":%d%s}\n' \
        "$now" "$outcome" "$qid" "$elapsed_ms" \
        "$([ -n "$extra" ] && printf ',%s' "$extra" || true)" \
        >>"$DEBUG_LOG" 2>/dev/null || true
}

fail_open() {
    local reason="${1:-unspecified}"
    log_debug "fail_open" "-" "\"reason\":\"$reason\""
    exit 0
}

have_python() {
    command -v python3 >/dev/null 2>&1
}
have_python || fail_open "python3 not on PATH"
command -v curl >/dev/null 2>&1 || fail_open "curl not on PATH"

# ---- 0. read stdin -----------------------------------------------------------
STDIN_FILE="$(mktemp -t gosleep-perm-hook-stdin.XXXXXX 2>/dev/null || echo "/tmp/gosleep-perm-hook-stdin.$$")"
cat > "$STDIN_FILE" 2>/dev/null || true
if [ ! -s "$STDIN_FILE" ]; then
    rm -f "$STDIN_FILE" 2>/dev/null || true
    fail_open "empty stdin (not a valid hook invocation)"
fi

# ---- 0a. GSL-304 diagnostic: dump the raw stdin when GOSLEEP_PERM_REQ_DUMP set
# Path-prefix pattern mirrors GSL-303's GOSLEEP_TOOL_OBSERVED_DUMP: we append a nanosecond
# timestamp so successive prompts land in distinct files. Never fatal — write failures are
# swallowed so the shim keeps running.
if [ -n "${GOSLEEP_PERM_REQ_DUMP:-}" ]; then
    cp "$STDIN_FILE" "${GOSLEEP_PERM_REQ_DUMP}.$(date +%s%N)" 2>/dev/null || true
fi

# ---- 0b. GSL-303: fire the Fleet tool-observed feeder in background ----------
# Same rationale as ask-user-question-hook.sh: lab-log-hook.sh's fan-out does not cover
# PreToolUse{PermissionRequest}, so Fleet would never see a permission ask without this call.
# Background + fail-open by construction.
GOSLEEP_TOOL_OBSERVED_TOOL="PermissionRequest" \
GOSLEEP_TOOL_OBSERVED_INTENT="PermissionRequest pending owner decision" \
    "$(dirname "$0")/tool-observed-feed.sh" < "$STDIN_FILE" >/dev/null 2>&1 &
disown 2>/dev/null || true

# ---- 1. secret / core reachability guards ------------------------------------
if [ -z "$INTERNAL_SECRET" ]; then
    fail_open "GOSLEEP_INTERNAL_SECRET unset"
fi

# ---- 2. POST /internal/permissions/post --------------------------------------
# Core expects: { session_id, tool_use_id, tool_name?, tool_input: { tool, params, message? } }.
# We forward `tool_input` verbatim (Claude sends it as the whole payload nested under
# "tool_input") plus session_id / tool_use_id / a fallback tool_name if the caller wants
# to force it (rare — the core prefers tool_input.tool).
POST_BODY="$(python3 - "$STDIN_FILE" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    raw = f.read()
try:
    d = json.loads(raw)
except Exception as e:
    print("STDIN_NOT_JSON:%s" % e, file=sys.stderr)
    sys.exit(1)

session_id  = d.get("session_id", "") or ""
tool_use_id = d.get("tool_use_id", "") or ""
tool_input  = d.get("tool_input", {}) or {}

body = {
    "session_id":  session_id,
    "tool_use_id": tool_use_id,
    "tool_name":   d.get("tool_name", "") or "",
    "tool_input":  tool_input,
}
json.dump(body, sys.stdout)
PY
)"
if [ -z "$POST_BODY" ]; then
    fail_open "could not build POST body from stdin"
fi

POST_STDOUT="$(mktemp -t gosleep-perm-hook-post.XXXXXX 2>/dev/null || echo "/tmp/gosleep-perm-hook-post.$$")"
POST_STATUS="$(curl -sS -o "$POST_STDOUT" -w '%{http_code}' \
    --connect-timeout "$CONNECT_TIMEOUT_S" --max-time "$((CONNECT_TIMEOUT_S + 8))" \
    -X POST \
    -H "Host: $HOST_HEADER" \
    -H "Origin: $ORIGIN_HEADER" \
    -H "Content-Type: application/json" \
    -H "X-Internal-Secret: $INTERNAL_SECRET" \
    -d "$POST_BODY" \
    "$CORE_URL/internal/permissions/post" 2>/dev/null || echo "000")"

if [ "$POST_STATUS" = "000" ]; then
    rm -f "$POST_STDOUT" 2>/dev/null || true
    fail_open "core unreachable on POST"
fi
if [ "$POST_STATUS" != "200" ]; then
    rm -f "$POST_STDOUT" 2>/dev/null || true
    fail_open "POST /internal/permissions/post rc=$POST_STATUS"
fi

QID="$(python3 - "$POST_STDOUT" <<'PY'
import json, sys
try:
    with open(sys.argv[1]) as f:
        d = json.load(f)
    q = d.get("qid", "")
    print(q or "", end="")
except Exception:
    print("", end="")
PY
)"
rm -f "$POST_STDOUT" 2>/dev/null || true
if [ -z "$QID" ]; then
    fail_open "POST returned empty qid"
fi

# ---- 3. GET /internal/questions/:qid/answer-wait -----------------------------
# The wait endpoint is SHARED between AskUserQuestion and PermissionRequest — the qid is
# unique across both kinds and the returned row shape is the same.
WAIT_STDOUT="$(mktemp -t gosleep-perm-hook-wait.XXXXXX 2>/dev/null || echo "/tmp/gosleep-perm-hook-wait.$$")"
WAIT_STATUS="$(curl -sS -o "$WAIT_STDOUT" -w '%{http_code}' \
    --connect-timeout "$CONNECT_TIMEOUT_S" --max-time "$CURL_WAIT_TIMEOUT_S" \
    -X GET \
    -H "Host: $HOST_HEADER" \
    -H "X-Internal-Secret: $INTERNAL_SECRET" \
    "$CORE_URL/internal/questions/$QID/answer-wait?timeout_s=$HOOK_TIMEOUT_S" \
    2>/dev/null || echo "000")"

if [ "$WAIT_STATUS" = "000" ]; then
    rm -f "$WAIT_STDOUT" 2>/dev/null || true
    fail_open "core unreachable on wait"
fi
if [ "$WAIT_STATUS" = "204" ]; then
    rm -f "$WAIT_STDOUT" 2>/dev/null || true
    # GSL-333 (run 09 finding #7): the hook long-poll timed out. Claude Code will now render
    # its own TUI permission dialog (the fallback path per hooks.md:223). If we leave the DB
    # row `status='open'`, the panel keeps its Allow / Deny buttons live and a subsequent
    # owner click lands as `answered` while the shim is DEAD and CC has moved on — the
    # answer is orphaned. Best-effort POST to /internal/permissions/:qid/expire so the row
    # transitions to `status='timed-out'` and the panel disables the buttons. Fail-open by
    # construction: any failure (network, 4xx, 5xx) is silently swallowed — the shim is
    # ALREADY in its "TUI takes over" branch and must not delay the return.
    # GSL-333 followup: the expire endpoint sits behind requireLocalOrigin CSRF
    # middleware (all /internal/* mutating routes do). Missing the Origin header
    # here bounces the request 403 and the row stays open — which was the whole
    # bug we were trying to fix. Mirror the header shape used by the /post curl
    # above; any other divergence is a bug (see run-10 C3 for the full trace).
    EXPIRE_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' \
        --connect-timeout "$CONNECT_TIMEOUT_S" --max-time "$((CONNECT_TIMEOUT_S + 3))" \
        -X POST \
        -H "Host: $HOST_HEADER" \
        -H "Origin: $ORIGIN_HEADER" \
        -H "X-Internal-Secret: $INTERNAL_SECRET" \
        "$CORE_URL/internal/permissions/$QID/expire" 2>/dev/null || echo "000")"
    log_debug "timeout" "$QID" "\"expire_status\":\"$EXPIRE_STATUS\""
    exit 0
fi
if [ "$WAIT_STATUS" != "200" ]; then
    rm -f "$WAIT_STDOUT" 2>/dev/null || true
    fail_open "wait rc=$WAIT_STATUS"
fi

# ---- 4. build hookSpecificOutput (allow/deny + optional reason) --------------
# answer_text is the decision ('allow' | 'deny'). The optional deny reason is carried in
# the wait response's `applied` field when the doDecidePermission handler stored one
# (added to the /internal/questions/:qid/answer-wait payload as `applied` at the core
# side). The python composer reads it and only sets decision.reason when it's a non-empty
# string. Shape per the PermissionRequest event contract (GSL-304):
#   { hookSpecificOutput: { hookEventName: "PermissionRequest",
#                           decision: { behavior: "allow"|"deny", reason?: "…" } } }
OUT="$(python3 - "$WAIT_STDOUT" <<'PY'
import json, sys
try:
    with open(sys.argv[1]) as f:
        answer = json.load(f)
except Exception as e:
    print("WAIT_NOT_JSON:%s" % e, file=sys.stderr)
    sys.exit(1)

decision = (answer.get("answer_text") or "").strip().lower()
if decision not in ("allow", "deny"):
    print("UNKNOWN_DECISION:%s" % decision, file=sys.stderr)
    sys.exit(1)

dec = { "behavior": decision }
reason = answer.get("applied")
if decision == "deny" and isinstance(reason, str) and len(reason) > 0:
    dec["reason"] = reason

json.dump({
    "hookSpecificOutput": {
        "hookEventName": "PermissionRequest",
        "decision":       dec,
    },
}, sys.stdout)
PY
)"

rm -f "$WAIT_STDOUT" 2>/dev/null || true
rm -f "$STDIN_FILE" 2>/dev/null || true

if [ -z "$OUT" ]; then
    fail_open "could not build hookSpecificOutput"
fi

printf '%s' "$OUT"
log_debug "decided" "$QID" ""
exit 0
