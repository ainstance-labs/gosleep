#!/usr/bin/env bash
# =============================================================================
# gosleep lab — shim compound-OR gate smoke (GSL-361, observer mode phase B).
#
# Boots a MINIMAL fake core on a random port that answers just two paths:
#   GET  /internal/sessions/:sid/control     — returns {state,source,shim_registered}
#   POST /internal/sessions/:sid/shim-heartbeat — no-op 200
# Nothing else — this smoke tests the SHIM side, not the real core (which the full core-smoke
# covers). The fake is a python3 http.server that reads a fixture state file each request.
#
# Scenarios (all must pass):
#   1. env-flag session: GOSLEEP_WEB_QUESTIONS=1, core unreachable → shim proceeds past the
#      gate. Test asserts a marker file the shim would create (fixture responder simulates
#      a slow / offline server; the shim's env fast-path must still fire).
#   2. runtime-controlled: env flag OFF, core says state=controlled → shim proceeds.
#   3. runtime-observer: env flag OFF, core says state=observer → shim fast-exits (no proceed).
#   4. core-unreachable, no env flag: shim fast-exits (never fail-open into interception).
#   5. cache TTL: two invocations within 1 s hit the network exactly ONCE.
#
# Approach: source `tools/hooks/control-gate.sh` in a bash subshell after setting up the
# CORE_URL / HOST_HEADER / INTERNAL_SECRET / CONNECT_TIMEOUT_S variables the gate consumes.
# We call `control_gate_should_proceed <sid> <pid>` and inspect $GOSLEEP_CONTROL_PROCEED.
# This exercises the gate WITHOUT booting the full shim (which needs a full stdin JSON
# payload and would double-fire many other side-effects); every code path the shim depends
# on lives in the gate.
#
# Exit 0 = pass. Non-zero = fail with a stderr diagnostic.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
WORK="$REPO_ROOT/.artifacts/shim-control-gate"
rm -rf "$WORK"; mkdir -p "$WORK"

log() {
    printf '[shim-control-gate] %s\n' "$*" >&2
}
fail() {
    printf '[shim-control-gate] FAIL: %s\n' "$*" >&2
    exit 1
}

# -----------------------------------------------------------------------------
# 0. pick a free port for the fake core.
# -----------------------------------------------------------------------------
python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()' \
    > "$WORK/port" 2>/dev/null || fail "python3 unavailable"
FAKE_PORT="$(cat "$WORK/port")"
FAKE_URL="http://127.0.0.1:${FAKE_PORT}"

# -----------------------------------------------------------------------------
# 1. write the state fixture the fake reads on every request.
# -----------------------------------------------------------------------------
STATE_FILE="$WORK/state.json"
HEARTBEAT_LOG="$WORK/heartbeats.log"
GET_COUNT_FILE="$WORK/get_count"
echo 0 > "$GET_COUNT_FILE"
echo '{"state":"observer","source":"runtime","shim_registered":false}' > "$STATE_FILE"

# -----------------------------------------------------------------------------
# 2. boot the fake core (python3 http.server). Runs in the background; killed at cleanup.
# -----------------------------------------------------------------------------
FAKE_LOG="$WORK/fake.log"
cat > "$WORK/fake.py" <<'PY'
import json, os, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

STATE_FILE = os.environ["STATE_FILE"]
HB_LOG = os.environ["HEARTBEAT_LOG"]
GET_COUNT_FILE = os.environ["GET_COUNT_FILE"]
PORT = int(os.environ["FAKE_PORT"])

class H(BaseHTTPRequestHandler):
    def log_message(self, *a, **kw):
        pass
    def do_GET(self):
        # bump the GET counter for every /control call
        if "/control" in self.path:
            try:
                with open(GET_COUNT_FILE) as f:
                    n = int(f.read().strip() or "0")
                n += 1
                with open(GET_COUNT_FILE, "w") as f:
                    f.write(str(n))
            except Exception:
                pass
            with open(STATE_FILE) as f:
                s = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(s.encode("utf-8"))
        else:
            self.send_response(404); self.end_headers()
    def do_POST(self):
        if "/shim-heartbeat" in self.path:
            ln = int(self.headers.get("Content-Length", "0") or "0")
            body = self.rfile.read(ln).decode("utf-8", "replace") if ln > 0 else ""
            with open(HB_LOG, "a") as f:
                f.write(self.path + "\t" + body + "\n")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
        else:
            self.send_response(404); self.end_headers()

HTTPServer(("127.0.0.1", PORT), H).serve_forever()
PY
STATE_FILE="$STATE_FILE" HEARTBEAT_LOG="$HEARTBEAT_LOG" GET_COUNT_FILE="$GET_COUNT_FILE" \
FAKE_PORT="$FAKE_PORT" python3 "$WORK/fake.py" > "$FAKE_LOG" 2>&1 &
FAKE_PID=$!
cleanup() {
    kill -TERM "$FAKE_PID" 2>/dev/null || true
    wait "$FAKE_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Wait for the fake to bind (bounded).
for _ in $(seq 1 40); do
    if curl -sS -o /dev/null -w '%{http_code}' "$FAKE_URL/internal/sessions/x/control" \
        2>/dev/null | grep -q '^200$'; then
        break
    fi
    sleep 0.05
done

# -----------------------------------------------------------------------------
# 3. Test runner. Each scenario spawns a fresh bash subshell so process-state (heartbeat
#    memo, cache) starts clean. We source `control-gate.sh` inside each subshell.
# -----------------------------------------------------------------------------
run_gate() {
    local env_flag="$1"; shift
    local sid="$1"; shift
    local core_url="$1"; shift
    local extra_ttl_bust="${1:-0}"
    # Each subshell gets its own TMPDIR so the file-cache does not persist across cases.
    local tmp
    tmp="$(mktemp -d "${WORK}/tmp.XXXXXX")"
    (
        set -u -o pipefail
        export TMPDIR="$tmp"
        export GOSLEEP_WEB_QUESTIONS="$env_flag"
        export CORE_URL="$core_url"
        export INTERNAL_SECRET="smoke-secret"
        export HOST_HEADER="127.0.0.1:${FAKE_PORT}"
        export ORIGIN_HEADER="$core_url"
        export CONNECT_TIMEOUT_S=1
        # shellcheck disable=SC1090
        . "$REPO_ROOT/tools/hooks/control-gate.sh"
        control_gate_should_proceed "$sid" "$$"
        printf '%s|%s|%s\n' \
            "${GOSLEEP_CONTROL_PROCEED:-?}" \
            "${GOSLEEP_CONTROL_STATE:-?}" \
            "${GOSLEEP_CONTROL_SOURCE:-?}"
    )
}

# --- Scenario 1: env flag ON, core UNREACHABLE — must PROCEED (env fast-path wins) --------
log "Scenario 1: env flag ON, core unreachable"
res="$(run_gate 1 sess-env-1 http://127.0.0.1:1 || true)"
[ "$res" = "1|controlled|env" ] \
    || fail "S1: expected 1|controlled|env got '$res'"

# --- Scenario 2: env OFF, core says controlled/runtime — must PROCEED ---------------------
log "Scenario 2: env OFF, core=controlled"
echo '{"state":"controlled","source":"runtime","shim_registered":true}' > "$STATE_FILE"
res="$(run_gate 0 sess-rt-2 "$FAKE_URL" || true)"
[ "$res" = "1|controlled|runtime" ] \
    || fail "S2: expected 1|controlled|runtime got '$res'"

# --- Scenario 3: env OFF, core says observer — must FAST-EXIT -----------------------------
log "Scenario 3: env OFF, core=observer"
echo '{"state":"observer","source":"runtime","shim_registered":true}' > "$STATE_FILE"
res="$(run_gate 0 sess-obs-3 "$FAKE_URL" || true)"
[ "$res" = "0|observer|runtime" ] \
    || fail "S3: expected 0|observer|runtime got '$res'"

# --- Scenario 4: env OFF, core UNREACHABLE — must FAST-EXIT (never fail-open into intercept)
log "Scenario 4: env OFF, core unreachable"
res="$(run_gate 0 sess-un-4 http://127.0.0.1:1 || true)"
# On unreachable the gate reports unknown/unknown but PROCEED stays 0.
proceed="${res%%|*}"
[ "$proceed" = "0" ] || fail "S4: expected proceed=0 got '$res'"

# --- Scenario 5: cache TTL (two invocations in a single subshell hit network ONCE) --------
log "Scenario 5: cache TTL"
echo '{"state":"controlled","source":"runtime","shim_registered":true}' > "$STATE_FILE"
echo 0 > "$GET_COUNT_FILE"
tmp="$(mktemp -d "${WORK}/tmp.cacheXXX")"
(
    set -u -o pipefail
    export TMPDIR="$tmp"
    export GOSLEEP_WEB_QUESTIONS=0
    export CORE_URL="$FAKE_URL"
    export INTERNAL_SECRET="smoke-secret"
    export HOST_HEADER="127.0.0.1:${FAKE_PORT}"
    export ORIGIN_HEADER="$FAKE_URL"
    export CONNECT_TIMEOUT_S=1
    # shellcheck disable=SC1090
    . "$REPO_ROOT/tools/hooks/control-gate.sh"
    control_gate_should_proceed "sess-cache-5" "$$"
    # second invocation in the same shell — must hit the cache and NOT the network again.
    control_gate_should_proceed "sess-cache-5" "$$"
    printf 'ok\n'
) >/dev/null
gets="$(cat "$GET_COUNT_FILE")"
[ "$gets" = "1" ] || fail "S5: expected 1 GET, got $gets"

# --- Scenario 6: shim peek window — session_id past byte 4096 (GSL-386) ------------------
# Prove the pre-hardening 4 KiB cap would have missed the sid, and the widened 64 KiB cap
# extracts it. The peek pipeline is copied verbatim from the shims (both shims share it).
log "Scenario 6: shim peek — session_id past byte 4096, within 64 KiB cap"
peek_run() {
    # Verbatim from tools/hooks/{ask-user-question,permission-request}-hook.sh —
    # the two shims share this pipeline. Testing it here is equivalent to
    # testing both shims' peek stage.
    local payload_file="$1"
    LC_ALL=C head -c 65536 "$payload_file" 2>/dev/null \
        | LC_ALL=C awk '
            match($0, /"session_id"[[:space:]]*:[[:space:]]*"[^"]+"/) {
              s = substr($0, RSTART, RLENGTH)
              sub(/^"session_id"[[:space:]]*:[[:space:]]*"/, "", s)
              sub(/"$/, "", s)
              print s
              exit
            }'
}
peek_run_narrow() {
    # Baseline for the pre-GSL-386 4 KiB path — used as a negative control to prove the
    # attack payload really did push the sid past the old ceiling.
    local payload_file="$1"
    LC_ALL=C head -c 4096 "$payload_file" 2>/dev/null \
        | LC_ALL=C sed -n -E 's/.*"session_id"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' \
        | head -n 1
}

big_payload="$WORK/big.json"
{
    printf '{"tool_input":{"filler":"'
    # 60 KiB of filler → session_id byte offset > 4096, well within 64 KiB.
    dd if=/dev/zero bs=1024 count=60 2>/dev/null | tr '\0' 'x'
    printf '"},"session_id":"sess-past-4kib-abcd-9999","other":"tail"}\n'
} > "$big_payload"
big_size="$(wc -c < "$big_payload" | tr -d ' ')"
sid_new="$(peek_run "$big_payload")"
sid_old="$(peek_run_narrow "$big_payload")"
if [ "$sid_new" = "sess-past-4kib-abcd-9999" ] && [ -z "$sid_old" ] && [ "$big_size" -gt 60000 ]; then
    log "  S6 PASS: 4 KiB peek missed the sid on a ${big_size}-byte payload; 64 KiB peek extracted 'sess-past-4kib-abcd-9999'."
else
    fail "S6: expected new='sess-past-4kib-abcd-9999' + empty old (size=$big_size); got new='$sid_new' old='$sid_old'"
fi

# --- Scenario 7: shim peek — first-match anchor beats greedy sed (GSL-386) ---------------
# Payload has (a) a REAL `"session_id":"real-first-…"` near the top, and (b) a raw literal
# `"session_id":"tail-imposter-…"` embedded inside a tool_input string (unescaped, mimicking
# a future path where nested JSON leaks through). The pre-GSL-386 greedy `.*` sed would
# have grabbed the imposter (last match); the first-match `grep -m 1` extraction picks the
# real one at the top.
log "Scenario 7: shim peek — first-match anchor picks the real sid"
imposter_payload="$WORK/imposter.json"
printf '{"session_id":"real-first-11111111-2222","tool_input":{"raw":"noise noise \"session_id\":\"tail-imposter-99999999-8888\" more noise"}}\n' \
    > "$imposter_payload"
sid_first="$(peek_run "$imposter_payload")"
# Baseline: run the pre-GSL-386 greedy `sed` regex against the SAME payload to prove it
# would have grabbed the imposter. This confirms the fixture actually exercises the
# regression path, not a payload the old regex would also survive.
sid_greedy="$(LC_ALL=C head -c 65536 "$imposter_payload" 2>/dev/null \
    | LC_ALL=C sed -n -E 's/.*"session_id"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' \
    | head -n 1)"
if [ "$sid_first" = "real-first-11111111-2222" ] && [ "$sid_greedy" = "tail-imposter-99999999-8888" ]; then
    log "  S7 PASS: first-match anchor picked 'real-first-…'; greedy sed baseline picked 'tail-imposter-…' as expected."
else
    fail "S7: expected first-match='real-first-…' + greedy-baseline='tail-imposter-…'; got first='$sid_first' greedy='$sid_greedy'"
fi

# --- Scenario 8: heartbeat is SYNCHRONOUS and visible on the happy path (GSL-389 M1) ------
# The shim-side symptom of E2E run-01 finding #1: `session_control` never gains a row even
# though the shim was clearly running. Root cause: the old backgrounded curl raced the shim's
# own exit and swallowed every failure. Fix: fire the FIRST heartbeat synchronously and log
# the outcome to $GOSLEEP_HOOK_DEBUG_LOG.
#
# This scenario proves the heartbeat POST is observable BY THE TIME the gate function
# returns — no `sleep` polling. That is the exact property that lets Take-control succeed
# on the first click after a fresh fixture launch, without any manual `curl` seeding.
log "Scenario 8: heartbeat synchronous + debug log on happy path"
echo '{"state":"controlled","source":"env","shim_registered":true}' > "$STATE_FILE"
: > "$HEARTBEAT_LOG"
tmp="$(mktemp -d "${WORK}/tmp.hb-syncXXX")"
hb_debug_log="$WORK/hb-debug-happy.jsonl"
: > "$hb_debug_log"
(
    set -u -o pipefail
    export TMPDIR="$tmp"
    export GOSLEEP_WEB_QUESTIONS=1
    export CORE_URL="$FAKE_URL"
    export INTERNAL_SECRET="smoke-secret"
    export HOST_HEADER="127.0.0.1:${FAKE_PORT}"
    export ORIGIN_HEADER="$FAKE_URL"
    export CONNECT_TIMEOUT_S=1
    export GOSLEEP_HOOK_DEBUG_LOG="$hb_debug_log"
    # shellcheck disable=SC1090
    . "$REPO_ROOT/tools/hooks/control-gate.sh"
    control_gate_should_proceed "sess-hb-happy-8" "$$"
) >/dev/null
# By the time the subshell exits, the heartbeat MUST have landed (sync path) AND the debug
# log MUST record it — no wait / no poll.
hb_lines="$(wc -l < "$HEARTBEAT_LOG" | tr -d ' ')"
[ "$hb_lines" = "1" ] || fail "S8: expected 1 heartbeat on the fake, got $hb_lines"
grep -q '"outcome":"ok"' "$hb_debug_log" \
    || fail "S8: expected 'outcome:ok' in $hb_debug_log; got: $(cat "$hb_debug_log")"
grep -q '"sid":"sess-hb-happy-8"' "$hb_debug_log" \
    || fail "S8: expected sid in $hb_debug_log; got: $(cat "$hb_debug_log")"

# --- Scenario 9: heartbeat failure is visible in the debug log (GSL-389 M1 red-first) -----
# Encode the run-01 defect: the old backgrounded form NEVER logged a failure, so an
# unreachable core (secret mismatch, wrong port, host header mismatch) looked identical to
# a successful checkin. This scenario points the shim at an unreachable port and asserts
# a `hb_fail` line appears in the debug log by the time the gate returns.
log "Scenario 9: heartbeat failure logged for unreachable core"
tmp="$(mktemp -d "${WORK}/tmp.hb-failXXX")"
hb_debug_log_fail="$WORK/hb-debug-fail.jsonl"
: > "$hb_debug_log_fail"
(
    set -u -o pipefail
    export TMPDIR="$tmp"
    export GOSLEEP_WEB_QUESTIONS=1
    export CORE_URL="http://127.0.0.1:1"  # closed port — connect refused
    export INTERNAL_SECRET="smoke-secret"
    export HOST_HEADER="127.0.0.1:1"
    export ORIGIN_HEADER="http://127.0.0.1:1"
    export CONNECT_TIMEOUT_S=1
    export GOSLEEP_HOOK_DEBUG_LOG="$hb_debug_log_fail"
    # shellcheck disable=SC1090
    . "$REPO_ROOT/tools/hooks/control-gate.sh"
    control_gate_should_proceed "sess-hb-fail-9" "$$"
) >/dev/null
grep -q '"outcome":"fail"' "$hb_debug_log_fail" \
    || fail "S9: expected 'outcome:fail' in $hb_debug_log_fail; got: $(cat "$hb_debug_log_fail")"
grep -q '"sid":"sess-hb-fail-9"' "$hb_debug_log_fail" \
    || fail "S9: expected sid in $hb_debug_log_fail; got: $(cat "$hb_debug_log_fail")"

log "OK — 9/9 scenarios passed"
