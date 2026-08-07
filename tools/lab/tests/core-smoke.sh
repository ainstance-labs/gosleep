#!/usr/bin/env bash
# =============================================================================
# gosleep lab — @gosleep/core endpoint smoke (GSL-260, GSL-268).
#
# Boots apps/core/src/serve.ts under Bun on 127.0.0.1:7331 with a dev-env Bearer override,
# curls the read endpoints across multiple scenarios, then kills the server and asserts
# the port is clean. Hermetic — GOSLEEP_BEARER_TOKEN skips the Keychain lookup, so the smoke
# never touches the owner's real Keychain item. GSL-268 extends the smoke with 401/origin/idempotency
# checks against POST /actions/* — using a hermetic GOSLEEP_LAB_DIR + GOSLEEP_DB_PATH so nothing
# lands under the real docs/lab or data/gosleep.db.
#
# Scenarios (all must pass):
#   1.  GET  /healthz              (no auth)         → 200 + JSON ok=true
#   2.  GET  /version              (no auth)         → 401
#   3.  GET  /whoami               (no auth)         → 401
#   4.  GET  /version              (wrong Bearer)    → 401
#   5.  GET  /version              (wrong Host)      → 421
#   6.  GET  /version              (valid)           → 200 + JSON
#   7.  GET  /whoami               (valid)           → 200 + JSON
#   8.  POST /actions/tick         (no auth)         → 401
#   9.  POST /actions/tick         (no Origin)       → 403
#   10. POST /actions/tick         (bad Origin)      → 403
#   11. POST /actions/tick         (valid)           → 200 + intent_id
#   12. POST /actions/tick         (replay same key) → 200 + cached:true
#   13. POST /actions/events/ack   (unknown seq)     → 404
#   14. POST /actions/questions/answer (no qid)      → 400
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

# GSL-268: run against a scratch DB + scratch lab dir so /actions/* endpoints do NOT touch
# the real data/gosleep.db or docs/lab tree. The scratch DB gets a fresh migration, so the
# server_intents / events / questions tables exist for the write path.
SCRATCH_DB="$WORK/gosleep.db"
SCRATCH_LAB="$WORK/lab"
mkdir -p "$SCRATCH_LAB/questions" "$SCRATCH_LAB/events" "$SCRATCH_LAB/decisions" \
         "$SCRATCH_LAB/supervision"
# Migrate the scratch DB up (no data seeding — just tables). Fail fast if migrate errors.
GOSLEEP_DB_PATH="$SCRATCH_DB" bun run "$REPO_ROOT/apps/core/scripts/migrate.ts" \
  > "$WORK/migrate.log" 2>&1 || {
  echo "ERROR: migrate failed — see $WORK/migrate.log" >&2
  cat "$WORK/migrate.log" >&2
  exit 1
}

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

# Guard: port must be free before we start.
if lsof -i ":$PORT" >/dev/null 2>&1; then
  echo "ERROR: port $PORT is already in use — refusing to run the smoke." >&2
  exit 1
fi

echo "== booting @gosleep/core (dev Bearer, port $PORT, scratch DB + lab) =="
# GOSLEEP_DISABLE_INDEXER=1 keeps the tail/reconciler out of the smoke — nothing feeds JSONL
# into the scratch lab dir here, and the reconciler would otherwise wake up looking for a
# real ingest_state row. The write path (GSL-268) does not depend on the tail — it INSERTs
# directly + spawns the CLI tools.
GOSLEEP_BEARER_TOKEN="$TOKEN" GOSLEEP_OWNER_NAME="smoke-owner" GOSLEEP_CORE_PORT="$PORT" \
  GOSLEEP_DB_PATH="$SCRATCH_DB" GOSLEEP_LAB_DIR="$SCRATCH_LAB" \
  GOSLEEP_DISABLE_INDEXER=1 \
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

echo "== POST /actions/* scenarios (GSL-268) =="
# 8. Tick without Bearer → 401
check_status "8. POST /actions/tick (no auth)"  "401" -X POST -H "Host: 127.0.0.1:$PORT" \
  -H "Origin: http://127.0.0.1:$PORT" -H "Content-Type: application/json" -d "{}" \
  "http://127.0.0.1:$PORT/actions/tick"

# 9. Tick without Origin → 403 (Origin/Referer middleware)
check_status "9. POST /actions/tick (no Origin)" "403" -X POST -H "Host: 127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d "{}" \
  "http://127.0.0.1:$PORT/actions/tick"

# 10. Tick with wrong Origin → 403
check_status "10. POST /actions/tick (bad Origin)" "403" -X POST -H "Host: 127.0.0.1:$PORT" \
  -H "Origin: http://attacker.example" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" -d "{}" \
  "http://127.0.0.1:$PORT/actions/tick"

# 11. Tick valid → 200 (fire-and-forget; carrier=web is default in the endpoint)
IDEMPOTENCY_KEY="smoke-tick-$(date +%s)"
TICK_BODY_FILE="$WORK/tick-body.json"
TICK_STATUS="$(curl -s -o "$TICK_BODY_FILE" -w '%{http_code}' -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" -d '{"carrier":"web-smoke"}' \
  "http://127.0.0.1:$PORT/actions/tick")"
if [ "$TICK_STATUS" = "200" ]; then
  ok "11. POST /actions/tick (valid) → 200"
else
  bad "11. POST /actions/tick (valid) → $TICK_STATUS (expected 200; body: $(cat "$TICK_BODY_FILE"))"
fi
if grep -q '"intent_id":"'"$IDEMPOTENCY_KEY"'"' "$TICK_BODY_FILE"; then
  ok "11b. tick body echoes intent_id"
else
  bad "11b. tick body missing intent_id (got: $(cat "$TICK_BODY_FILE"))"
fi
# The tick spawn is fire-and-forget; give it a moment to schedule so it does not race the
# teardown SIGTERM before its subshell settles.
sleep 1

# 12. Replay the same Idempotency-Key → 200 + cached:true, and the spawn is NOT re-triggered
REPLAY_BODY_FILE="$WORK/tick-replay.json"
REPLAY_STATUS="$(curl -s -o "$REPLAY_BODY_FILE" -w '%{http_code}' -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" -d '{"carrier":"web-smoke"}' \
  "http://127.0.0.1:$PORT/actions/tick")"
if [ "$REPLAY_STATUS" = "200" ] && grep -q '"cached":true' "$REPLAY_BODY_FILE"; then
  ok "12. replay same Idempotency-Key → cached:true"
else
  bad "12. replay expected 200+cached:true, got $REPLAY_STATUS body $(cat "$REPLAY_BODY_FILE")"
fi

# 13. Ack an unknown seq → 404
check_status "13. POST /actions/events/ack (unknown seq)" "404" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"seq": 999999}' \
  "http://127.0.0.1:$PORT/actions/events/ack"

# 14. Answer with missing qid → 400
check_status "14. POST /actions/questions/answer (no qid)" "400" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"answer":"nope"}' \
  "http://127.0.0.1:$PORT/actions/questions/answer"

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
