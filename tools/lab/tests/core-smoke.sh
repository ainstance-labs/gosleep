#!/usr/bin/env bash
# =============================================================================
# gosleep lab — @gosleep/core endpoint smoke (GSL-260).
#
# Boots apps/core/src/serve.ts under Bun on 127.0.0.1:7331 with a dev-env Bearer override,
# curls the three v1 read endpoints across seven scenarios, then kills the server and asserts
# the port is clean. Hermetic — GOSLEEP_BEARER_TOKEN skips the Keychain lookup, so the smoke
# never touches the owner's real Keychain item.
#
# Scenarios (all must pass):
#   1. GET /healthz    (no auth)                     → 200 + JSON ok=true
#   2. GET /version    (no auth)                     → 401
#   3. GET /whoami     (no auth)                     → 401
#   4. GET /version    (wrong Bearer)                → 401
#   5. GET /version    (wrong Host header)           → 421
#   6. GET /version    (valid Bearer)                → 200 + JSON server_version present
#   7. GET /whoami     (valid Bearer)                → 200 + JSON owner="smoke-owner"
#
# Not wired into gate.sh — the gate must stay 0-network/0-process; this test intentionally
# starts a process. Run it BY HAND before committing changes to apps/core/. Exit 0 = pass.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PORT="${GOSLEEP_CORE_PORT:-7331}"
TOKEN="smoke-token-DO-NOT-USE"

WORK="$REPO_ROOT/.artifacts/core-smoke"
rm -rf "$WORK"; mkdir -p "$WORK"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

# Guard: port must be free before we start.
if lsof -i ":$PORT" >/dev/null 2>&1; then
  echo "ERROR: port $PORT is already in use — refusing to run the smoke." >&2
  exit 1
fi

echo "== booting @gosleep/core (dev Bearer, port $PORT) =="
GOSLEEP_BEARER_TOKEN="$TOKEN" GOSLEEP_OWNER_NAME="smoke-owner" GOSLEEP_CORE_PORT="$PORT" \
  bun run "$REPO_ROOT/apps/core/src/serve.ts" \
  > "$WORK/stdout.log" 2> "$WORK/stderr.log" &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; sleep 1; kill -9 $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null; :' EXIT INT TERM

# Wait up to 5s for /healthz to answer.
booted=0
for i in 1 2 3 4 5; do
  if curl -sf "http://127.0.0.1:$PORT/healthz" -H "Host: 127.0.0.1:$PORT" >/dev/null 2>&1; then
    booted=1
    ok "server booted (${i}s)"
    break
  fi
  sleep 1
done
if [ "$booted" -ne 1 ]; then
  bad "server did not boot within 5s — see $WORK/stderr.log"
  cat "$WORK/stderr.log" >&2
  exit 1
fi

check_status() {  # check_status <label> <expected_status> <curl_args...>
  local label="$1" expected="$2"; shift 2
  local actual
  actual="$(curl -s -o /dev/null -w '%{http_code}' "$@" 2>/dev/null || echo "000")"
  if [ "$actual" = "$expected" ]; then
    ok "$label → $actual"
  else
    bad "$label → $actual (expected $expected)"
  fi
}

check_body() {  # check_body <label> <regex> <curl_args...>
  local label="$1" regex="$2"; shift 2
  local body
  body="$(curl -s "$@" 2>/dev/null || echo "")"
  if printf '%s' "$body" | grep -Eq "$regex"; then
    ok "$label body matches /$regex/"
  else
    bad "$label body does NOT match /$regex/: $body"
  fi
}

echo "== HTTP scenarios =="
check_status "1. GET /healthz (no auth)"     "200" "http://127.0.0.1:$PORT/healthz" -H "Host: 127.0.0.1:$PORT"
check_body   "1b. /healthz body ok=true"     '"ok":true.*"service":"gosleep-core"' "http://127.0.0.1:$PORT/healthz" -H "Host: 127.0.0.1:$PORT"

check_status "2. GET /version (no auth)"     "401" "http://127.0.0.1:$PORT/version" -H "Host: 127.0.0.1:$PORT"
check_status "3. GET /whoami (no auth)"      "401" "http://127.0.0.1:$PORT/whoami"  -H "Host: 127.0.0.1:$PORT"
check_status "4. GET /version (bad Bearer)"  "401" "http://127.0.0.1:$PORT/version" -H "Host: 127.0.0.1:$PORT" -H "Authorization: Bearer wrong-token"
check_status "5. GET /version (wrong Host)"  "421" "http://127.0.0.1:$PORT/version" -H "Host: attacker.example" -H "Authorization: Bearer $TOKEN"

check_status "6. GET /version (valid)"       "200" "http://127.0.0.1:$PORT/version" -H "Host: 127.0.0.1:$PORT" -H "Authorization: Bearer $TOKEN"
check_body   "6b. /version body has fields"  '"server_version":"[0-9]+' "http://127.0.0.1:$PORT/version" -H "Host: 127.0.0.1:$PORT" -H "Authorization: Bearer $TOKEN"

check_status "7. GET /whoami (valid)"        "200" "http://127.0.0.1:$PORT/whoami" -H "Host: 127.0.0.1:$PORT" -H "Authorization: Bearer $TOKEN"
check_body   "7b. /whoami body owner"        '"owner":"smoke-owner"' "http://127.0.0.1:$PORT/whoami" -H "Host: 127.0.0.1:$PORT" -H "Authorization: Bearer $TOKEN"

echo "== teardown =="
kill $SERVER_PID 2>/dev/null || true
for i in 1 2 3; do
  sleep 1
  kill -0 $SERVER_PID 2>/dev/null || break
done
kill -9 $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true
trap - EXIT INT TERM

if lsof -i ":$PORT" >/dev/null 2>&1; then
  bad "port $PORT is STILL in use after teardown"
else
  ok "port $PORT clean after teardown"
fi

echo
echo "== summary =="
echo "  pass=$PASS  fail=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  rm -rf "$WORK"
  echo "  core-smoke: ALL PASS"
  exit 0
fi
echo "  core-smoke: $FAIL FAIL(s) — see $WORK for logs"
exit 1
