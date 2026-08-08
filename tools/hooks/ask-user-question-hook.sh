#!/usr/bin/env bash
# =============================================================================
# gosleep — PreToolUse{AskUserQuestion} hook shim (GSL-275).
#
# Wire this into a supervised session's `.claude/settings.json` under
#   hooks.PreToolUse[].matcher = "AskUserQuestion"
#   hooks.PreToolUse[].hooks[].command = "$CLAUDE_PROJECT_DIR/tools/hooks/ask-user-question-hook.sh"
#
# INSTALLATION into a live session's settings is out of scope for THIS task — GSL-267 owns the
# per-session shim wiring. This file is the machinery the wiring points at; GSL-274's smoke
# already proved the primary path (allow + updatedInput) works exactly as documented.
#
# Contract (per code.claude.com/docs/en/hooks.md and the rev-3 addendum Delta 1):
#   1. Claude Code fires PreToolUse before an AskUserQuestion tool call; hands us the full
#      tool_input on stdin as JSON: { session_id, tool_use_id, tool_input: {questions:[...]} }.
#   2. We POST that payload to gosleep-core `POST /internal/questions/post`; core writes the
#      question row via lab-emit (BLOCKER-typed, open status), returns { qid }.
#   3. We long-poll `GET /internal/questions/<qid>/answer-wait?timeout_s=N`; the endpoint holds
#      the socket until the row transitions to `status='answered'` (owner clicks in web UI) or
#      the timeout elapses.
#   4. On answer arrival (200) → we emit hookSpecificOutput { permissionDecision: "allow",
#      updatedInput: {questions:<echoed>, answers:{<q>:<a>}} } to stdout. Claude Code injects
#      the answer, the AskUserQuestion tool completes as answered, the TUI dialog NEVER renders.
#   5. On timeout (204) → exit 0 with no output. Per hooks.md:223, that is "hook has no
#      decision to report; tool call continues normal permission flow" — the TUI renders the
#      dialog as normal, session is neither killed nor errored.
#   6. On core-unreachable (any curl failure — connect refused, DNS failed, server down) →
#      exit 0 with no output. Fail-open FAST: the agent MUST NEVER hang because gosleep-core
#      is down. Silent fallback → TUI renders → session proceeds.
#
# Env inputs:
#   GOSLEEP_CORE_URL           default http://127.0.0.1:7331 — the running core endpoint.
#   GOSLEEP_INTERNAL_SECRET    required to talk to /internal/*; if missing the shim fails
#                              open (no POST attempted). Core rejects a wrong/missing header
#                              with 401 → we treat that the same as "unreachable" → fail-open.
#   GOSLEEP_HOOK_TIMEOUT_S     default 600 (matches hooks.md documented command default).
#                              Sent both as the ?timeout_s= query and as the curl --max-time on
#                              the wait request; curl's ceiling is a few seconds above the
#                              server-side timeout so the server 204 wins on a race.
#   GOSLEEP_HOOK_CONNECT_S     default 2 — hard cap on the CONNECT phase for both POST and
#                              GET. If we cannot connect within this window, fall open.
#   GOSLEEP_HOOK_DEBUG_LOG     optional path; when set, every hook call appends a JSON line
#                              recording qid, elapsed_ms, outcome. For post-mortems, NEVER a
#                              hard dependency.
#
# CRITICAL invariants (learned from GSL-274 + the general hooks discipline):
#   * NEVER exit 2 unless we mean to BLOCK the tool call. A bash syntax error exits 2 → blocks.
#     `set -u -o pipefail` is on but every error path routes to `fail_open` which exits 0.
#   * NEVER trigger a modal dialog. This is a headless hook; we speak only through stdout JSON.
#   * NEVER echo the secret. curl reads it from env; we do not `set -x`; the debug log records
#     no auth values.
#   * The stdout JSON is the WHOLE contract with Claude Code. Any noise (echo, printf, tool
#     info leak) breaks the parser. All non-JSON diagnostics go to stderr.
# =============================================================================

set -u -o pipefail

# =============================================================================
# GSL-267 GUARDED PILOT (owner decision d-2026-08-08-001).
# The whole loop is opt-in — this hook exits 0 INSTANTLY unless the session was
# launched with GOSLEEP_WEB_QUESTIONS=1. Fail-open behaviour is preserved
# because exit 0 with empty stdout tells Claude Code "no decision" → TUI
# renders normally per hooks.md:223. Only sessions started with the flag hit
# the network. Widening to all sessions requires an owner command; do NOT
# remove this guard without that command.
# =============================================================================
if [ "${GOSLEEP_WEB_QUESTIONS:-0}" != "1" ]; then
    exit 0
fi

CORE_URL="${GOSLEEP_CORE_URL:-http://127.0.0.1:7331}"
INTERNAL_SECRET="${GOSLEEP_INTERNAL_SECRET:-}"
HOOK_TIMEOUT_S="${GOSLEEP_HOOK_TIMEOUT_S:-600}"
CONNECT_TIMEOUT_S="${GOSLEEP_HOOK_CONNECT_S:-2}"
DEBUG_LOG="${GOSLEEP_HOOK_DEBUG_LOG:-}"

# Host header the middleware expects — strip scheme, keep host:port.
HOST_HEADER="${CORE_URL#http://}"
HOST_HEADER="${HOST_HEADER#https://}"
HOST_HEADER="${HOST_HEADER%%/*}"
ORIGIN_HEADER="${CORE_URL%/}"

# Wait a couple of seconds longer than the server does so a race at the exact deadline resolves
# to a 204 on the wire, not a client-side curl abort that looks like unreachable.
CURL_WAIT_TIMEOUT_S=$((HOOK_TIMEOUT_S + 5))

STARTED_EPOCH="$(date +%s 2>/dev/null || echo 0)"

log_debug() {
    # log_debug <outcome> <qid_or_dash> <extra-json-fragment>
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
    printf '{"ts":"%s","hook":"ask-user-question","outcome":"%s","qid":"%s","elapsed_ms":%d%s}\n' \
        "$now" "$outcome" "$qid" "$elapsed_ms" \
        "$([ -n "$extra" ] && printf ',%s' "$extra" || true)" \
        >>"$DEBUG_LOG" 2>/dev/null || true
}

fail_open() {
    # fail_open <reason>
    local reason="${1:-unspecified}"
    log_debug "fail_open" "-" "\"reason\":\"$reason\""
    exit 0
}

# python3 is our JSON toolkit — no jq dependency, macOS ships python3 by default.
have_python() {
    command -v python3 >/dev/null 2>&1
}
have_python || fail_open "python3 not on PATH"

command -v curl >/dev/null 2>&1 || fail_open "curl not on PATH"

# ---- 0. read stdin -----------------------------------------------------------
# Store stdin in a temp file so we can hand its PATH to python (heredoc + `python3 -` conflict:
# the heredoc content becomes python's stdin, so a piped stdin would be lost — a file argument
# is the only reliable way to get the raw hook payload into python).
STDIN_FILE="$(mktemp -t gosleep-hook-stdin.XXXXXX 2>/dev/null || echo "/tmp/gosleep-hook-stdin.$$")"
cat > "$STDIN_FILE" 2>/dev/null || true
if [ ! -s "$STDIN_FILE" ]; then
    rm -f "$STDIN_FILE" 2>/dev/null || true
    fail_open "empty stdin (not a valid hook invocation)"
fi

# ---- 1. secret / core reachability guards ------------------------------------
if [ -z "$INTERNAL_SECRET" ]; then
    fail_open "GOSLEEP_INTERNAL_SECRET unset"
fi

# ---- 2. POST /internal/questions/post ----------------------------------------
# The core expects: { session_id, tool_use_id, task, from, tool_input: { questions:[...] } }.
# We forward `tool_input` verbatim (Claude sends it as the whole payload nested under
# "tool_input") plus a "from" tag derived from session_id (agent-side actor).
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

# Derive a compact `from` tag — first 8 chars of session_id, prefixed 'agent:'. Debuggable.
short = session_id.split("-")[0] if session_id else "agent"
from_tag = "agent:" + short if short else "agent"

body = {
    "session_id":  session_id,
    "tool_use_id": tool_use_id,
    "task":        d.get("task", "") or "",
    "from":        from_tag,
    "tool_input":  tool_input,
}
json.dump(body, sys.stdout)
PY
)"
if [ -z "$POST_BODY" ]; then
    fail_open "could not build POST body from stdin"
fi

POST_STDOUT="$(mktemp -t gosleep-hook-post.XXXXXX 2>/dev/null || echo "/tmp/gosleep-hook-post.$$")"
POST_STATUS="$(curl -sS -o "$POST_STDOUT" -w '%{http_code}' \
    --connect-timeout "$CONNECT_TIMEOUT_S" --max-time "$((CONNECT_TIMEOUT_S + 8))" \
    -X POST \
    -H "Host: $HOST_HEADER" \
    -H "Origin: $ORIGIN_HEADER" \
    -H "Content-Type: application/json" \
    -H "X-Internal-Secret: $INTERNAL_SECRET" \
    -d "$POST_BODY" \
    "$CORE_URL/internal/questions/post" 2>/dev/null || echo "000")"

if [ "$POST_STATUS" = "000" ]; then
    rm -f "$POST_STDOUT" 2>/dev/null || true
    fail_open "core unreachable on POST"
fi
if [ "$POST_STATUS" != "200" ]; then
    # 401 (wrong secret), 503 (secret unset server-side), 500 (lab-emit blew up) — all fail-open.
    # Non-2xx responses NEVER become a "block" — the model of this shim is "if anything looks
    # weird, TUI-fallback, don't hang the agent".
    rm -f "$POST_STDOUT" 2>/dev/null || true
    fail_open "POST /internal/questions/post rc=$POST_STATUS"
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
WAIT_STDOUT="$(mktemp -t gosleep-hook-wait.XXXXXX 2>/dev/null || echo "/tmp/gosleep-hook-wait.$$")"
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
    # Server-side timeout, no answer. TUI renders normally.
    rm -f "$WAIT_STDOUT" 2>/dev/null || true
    log_debug "timeout" "$QID" ""
    exit 0
fi
if [ "$WAIT_STATUS" != "200" ]; then
    rm -f "$WAIT_STDOUT" 2>/dev/null || true
    fail_open "wait rc=$WAIT_STATUS"
fi

# ---- 4. build hookSpecificOutput (allow + updatedInput) ---------------------
# We compose the JSON on stdout in one shot: the answer text becomes an entry in the `answers`
# map keyed by the QUESTION TEXT (Claude Code's shape per GSL-274 evidence). The questions
# array is echoed back verbatim from the original tool_input so Claude can proceed.
OUT="$(python3 - "$WAIT_STDOUT" "$STDIN_FILE" <<'PY'
import json, sys
try:
    with open(sys.argv[1]) as f:
        answer = json.load(f)
except Exception as e:
    print("WAIT_NOT_JSON:%s" % e, file=sys.stderr)
    sys.exit(1)

try:
    with open(sys.argv[2]) as f:
        stdin_payload = json.load(f)
except Exception as e:
    print("STDIN_NOT_JSON:%s" % e, file=sys.stderr)
    sys.exit(1)

tool_input = stdin_payload.get("tool_input") or {}
questions  = tool_input.get("questions") or []
answer_txt = answer.get("answer_text") or ""
if not questions or not answer_txt:
    print("EMPTY_QUESTIONS_OR_ANSWER", file=sys.stderr)
    sys.exit(1)

# Answers map: the single answer we have applies to the FIRST question. Multi-question dialogs
# are not shipped in v1 (GSL-274 caveat kept honest). If future traffic sends N questions with
# distinct answers, the shim needs an upgrade — the server would return an answers[] array.
answers = { questions[0].get("question", ""): answer_txt }

out = {
    "hookSpecificOutput": {
        "hookEventName":     "PreToolUse",
        "permissionDecision": "allow",
        "updatedInput": {
            "questions": questions,
            "answers":   answers,
        },
    },
}
json.dump(out, sys.stdout)
PY
)"
rm -f "$WAIT_STDOUT" 2>/dev/null || true
rm -f "$STDIN_FILE" 2>/dev/null || true

if [ -z "$OUT" ]; then
    fail_open "could not build hookSpecificOutput"
fi

printf '%s' "$OUT"
log_debug "allow" "$QID" ""
exit 0
