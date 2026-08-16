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
# GSL-361 COMPOUND-OR GATE (observer mode phase B, reframes GSL-267).
#
# Historically (GSL-267) this hook fast-exited unless GOSLEEP_WEB_QUESTIONS=1 was set on the
# launching shell. That gate was a coarse, launch-time compat toggle. GSL-361 moves the
# decision surface into the panel: the owner presses "Take control" and from that moment
# the session's questions route to the panel. The env flag stays wired forever as a
# bootstrap + outage-fallback (R15.3) — it still wins immediately.
#
# The gate is a compound-OR:
#   proceed  =  (GOSLEEP_WEB_QUESTIONS=1)                       # env compat, wins fast
#            OR (core /internal/sessions/:sid/control == controlled)   # runtime toggle
#
# Fail-mode on core-unreachable: env-flag-only (binding decision). Never fail-open into
# interception. `control-gate.sh` implements the 1 s in-process cache + heartbeat fan-out.
# =============================================================================

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

# Compound-OR gate: read the session_id from stdin (peek), consult the core / env flag, only
# proceed into the long-poll if the caller is opted-in. Stdin is captured into a tempfile so
# the peek does not consume the payload — the rest of the hook re-uses the file.
_GOSLEEP_STDIN_PEEK="$(mktemp -t gosleep-hook-peek.XXXXXX 2>/dev/null || echo "/tmp/gosleep-hook-peek.$$")"
trap 'rm -f "$_GOSLEEP_STDIN_PEEK" 2>/dev/null || true' EXIT
cat > "$_GOSLEEP_STDIN_PEEK" 2>/dev/null || true
# Restore stdin from the peek file for the downstream flow.
exec < "$_GOSLEEP_STDIN_PEEK"

# GSL-367: shrink the fast-exit cost.
#
# Two changes, both preserving the compound-OR gate semantics exactly:
#
#   1. Env fast-path bypass: when GOSLEEP_WEB_QUESTIONS=1 the gate always returns PROCEED=1
#      without consulting session_id (see control-gate.sh — env flag wins BEFORE the sid
#      lookup). So there is nothing to peek for in that branch. Skip the peek entirely.
#
#   2. Pure-shell peek: previously we spawned python3 to extract "session_id" from the JSON
#      payload. That spawn was the dominant cost on the ~127 ms cold fast-exit; the peek
#      only needs to find one narrow field ("session_id":"<value>") in a size-bounded file.
#      A bash+sed regex handles the string form Claude Code always emits (session_id is a
#      UUID string, never a number/null/object). On any weird shape the regex misses and we
#      fall through with an empty session_id — the gate then correctly reports UNKNOWN and
#      the shim fast-exits, which is the SAME behaviour the old python3 path had on parse
#      error (see the pre-GSL-367 `except Exception: pass` branch).
#
# Non-goal: parse arbitrary JSON. The peek is a narrow probe, not a JSON validator; the
# body construction downstream still uses python3 where correctness matters.
_GOSLEEP_PEEK_SESSION_ID=""
# GSL-389 (E2E run-01 M1) — peek the sid ALWAYS, not only when the env flag is off.
# The pre-fix guard skipped the peek on GOSLEEP_WEB_QUESTIONS=1 (GSL-367 fast-path
# optimisation), which shaved a few ms off the fast-exit but left the gate's
# heartbeat fan-out with sid=""  — control_gate_should_proceed then returned proceed
# without ever firing `_gosleep_control_fire_heartbeat` (which requires a non-empty
# sid). Net effect: an opted-in session posted questions correctly but session_control
# never gained a row and panel Take-control refused with "shim has never checked in".
# The peek costs a couple of ms and is essential for the heartbeat — run it always.
if [ -s "$_GOSLEEP_STDIN_PEEK" ]; then
    # Field shape Claude Code always emits: "session_id":"<uuid>" (JSON-strings only ever contain
    # escaped double-quotes, but a Claude session_id is a hex-and-dash UUID so no escape ever
    # lands inside). `LC_ALL=C` makes the regex byte-oriented (fastest path in bash sed).
    # We accept whitespace between the field name, colon, and value to survive pretty-printed
    # payloads.
    #
    # GSL-386 hardening (was: 4 KiB cap + greedy sed).
    #
    #   (a) Window ceiling widened 4 KiB → 64 KiB. Claude Code today emits `session_id`
    #       near the top of the JSON payload (near `transcript_path`, `cwd`,
    #       `permission_mode`) and 4 KiB is enough — but any future preamble growth or
    #       key reorder would silently miss the sid, gate returns UNKNOWN, and an
    #       opted-in session falls back to the TUI dialog with no debug signal. 64 KiB
    #       covers any realistic payload preamble at a single-read cost.
    #
    #   (b) First-match anchor. BSD/GNU sed `-E` (ERE) has no non-greedy quantifier,
    #       so the pre-GSL-386 `s/.*"session_id":.../` regex captured the LAST
    #       occurrence in the peek window, not the first. Today this is safe because
    #       nested `"session_id"` inside `tool_input` strings are JSON-escaped to
    #       `\"session_id\"` (backslash-quote — the regex's leading `"` refuses to
    #       match `\"`). Future paths where an unescaped literal `"session_id":"..."`
    #       appears inside `tool_input` (raw text, nested unescaped JSON) would
    #       resolve to a stranger's sid, the gate returns 404-then-observer, the
    #       shim fast-exits, and the intent is corrupted silently. Fix: use `awk`
    #       with `match()` + `exit` — one process, first-match semantics on both
    #       BSD and GNU awk, and (bench: 20 iters × 2 fixtures, macOS bash 3.2) the
    #       total peek cost stays within ±10 % of the pre-GSL-386 pipeline instead
    #       of the ~4× cost of a `grep | sed | head` chain.
    _GOSLEEP_PEEK_SESSION_ID="$(LC_ALL=C head -c 65536 "$_GOSLEEP_STDIN_PEEK" 2>/dev/null \
        | LC_ALL=C awk '
            match($0, /"session_id"[[:space:]]*:[[:space:]]*"[^"]+"/) {
              s = substr($0, RSTART, RLENGTH)
              sub(/^"session_id"[[:space:]]*:[[:space:]]*"/, "", s)
              sub(/"$/, "", s)
              print s
              exit
            }')"

    # Debug breadcrumb — makes an empty-sid-on-non-empty-stdin outcome observable
    # via GOSLEEP_HOOK_DEBUG_LOG (the pre-existing channel from log_debug below).
    # log_debug is defined later in the script, so emit a plain JSON line here
    # directly. Silent on unset env — zero cost on the fast-path.
    if [ -z "$_GOSLEEP_PEEK_SESSION_ID" ] && [ -n "${GOSLEEP_HOOK_DEBUG_LOG:-}" ]; then
        printf '{"ts":"%s","hook":"ask-user-question","outcome":"peek_miss","stdin_bytes":%d,"peek_cap":65536}\n' \
            "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)" \
            "$(wc -c < "$_GOSLEEP_STDIN_PEEK" 2>/dev/null | tr -d ' ' || echo 0)" \
            >>"$GOSLEEP_HOOK_DEBUG_LOG" 2>/dev/null || true
    fi
fi

# Source the shared gate. It exposes control_gate_should_proceed() which sets
# GOSLEEP_CONTROL_PROCEED / GOSLEEP_CONTROL_STATE / GOSLEEP_CONTROL_SOURCE.
# shellcheck disable=SC1091
. "$(dirname "$0")/control-gate.sh"

control_gate_should_proceed "$_GOSLEEP_PEEK_SESSION_ID" "$$"
if [ "${GOSLEEP_CONTROL_PROCEED:-0}" != "1" ]; then
    # Fast-exit path — mirrors the historic GSL-267 behaviour exactly. TUI renders normally
    # (hooks.md:223: exit 0 + empty stdout = "no decision to report").
    rm -f "$_GOSLEEP_STDIN_PEEK" 2>/dev/null || true
    exit 0
fi

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

# ---- 0b. GSL-303: fire the Fleet tool-observed feeder in background ----------
# `.claude/settings.json` only wires lab-log-hook.sh on PostToolUse{Bash|Write|Edit|MultiEdit|
# mcp__atlassian__.*} — AskUserQuestion is not in that fan-out. Without this call, Fleet would
# never see the moment an AskUserQuestion opens. The feeder is guarded on GOSLEEP_WEB_QUESTIONS=1
# (which we're already inside) and fail-open by construction. Runs in the background with `&` so
# a slow feeder POST cannot delay the shim's own POST + long-poll below.
GOSLEEP_TOOL_OBSERVED_TOOL="AskUserQuestion" \
GOSLEEP_TOOL_OBSERVED_INTENT="AskUserQuestion pending owner answer" \
    "$(dirname "$0")/tool-observed-feed.sh" < "$STDIN_FILE" >/dev/null 2>&1 &
disown 2>/dev/null || true

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
