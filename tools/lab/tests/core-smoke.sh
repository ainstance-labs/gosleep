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
#   15. GET  /internal/questions/nope/answer-wait (no secret hdr) → 401  (GSL-275)
#   16. GET  /internal/questions/nope/answer-wait (wrong secret)  → 401
#   17. GET  /internal/questions/nope/answer-wait (valid secret)  → 404  (unknown qid)
#   18. POST /internal/questions/post (no secret)                 → 401
#   19. POST /internal/questions/post (valid secret)              → 200 + qid
#   20. GET  /internal/questions/<qid>/answer-wait?timeout_s=1    → 204  (timeout, no answer)
#   21-25. /fleet + /internal/agents/tool-observed                (GSL-276)
#   26-27. /metrics                                                (GSL-280)
#   28-37. /manifest + apply-manifest + defer scenarios            (GSL-277/278)
#   38-41. /actions/tasks/sync scenarios                            (GSL-279)
#   42-50. /internal/permissions/post + /actions/permissions/decide (GSL-284)
#   51-58. SPA static + fallback + API-precedence + CSP             (GSL-285)
#   59-66. /setup Bearer-discovery flow                             (GSL-291)
#   67-71. POST /actions/snapshot                                    (GSL-298)
#
# Not wired into gate.sh — the gate must stay 0-network/0-process; this test intentionally
# starts a process. Run it BY HAND before committing changes to apps/core/. Exit 0 = pass.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PORT="${GOSLEEP_CORE_PORT:-7331}"
TOKEN="smoke-token-DO-NOT-USE"
INTERNAL_SECRET="smoke-internal-secret-DO-NOT-USE"    # GSL-275: /internal/* env-secret

WORK="$REPO_ROOT/.artifacts/core-smoke"
rm -rf "$WORK"; mkdir -p "$WORK"

# GSL-268: run against a scratch DB + scratch lab dir so /actions/* endpoints do NOT touch
# the real data/gosleep.db or docs/lab tree. The scratch DB gets a fresh migration, so the
# server_intents / events / questions tables exist for the write path.
SCRATCH_DB="$WORK/gosleep.db"
SCRATCH_LAB="$WORK/lab"
mkdir -p "$SCRATCH_LAB/questions" "$SCRATCH_LAB/events" "$SCRATCH_LAB/decisions" \
         "$SCRATCH_LAB/supervision"

# GSL-277: seed a minimal decisions/manifest.md into the scratch lab dir so the
# apply-manifest endpoint has real rules to resolve against — matches the shape of the real
# owner-sovereign file.
cat > "$SCRATCH_LAB/decisions/manifest.md" <<'MANIFEST'
# Decision manifest — smoke fixture

## 1. Always autonomous

- §1.reversible-delivery — in-repo delivery: code, docs, branches, gates.

## 2. Decide-by-default

- §2.merge-strategy — regular merge, never squash.
MANIFEST
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
# GSL-285: seed a scratch web dist so the SPA-serving tests (51-58 below) hit files that
# exist regardless of whether apps/web was ever built. The real dist is not touched.
SCRATCH_DIST="$WORK/web-dist"
mkdir -p "$SCRATCH_DIST/assets"
cat > "$SCRATCH_DIST/index.html" <<'HTML'
<!doctype html><html><head><title>gosleep scratch spa</title></head>
<body><div id="root">scratch-spa-index</div><script type="module" src="/assets/app.js"></script></body></html>
HTML
printf 'console.log("scratch spa asset");\n' > "$SCRATCH_DIST/assets/app.js"
printf 'body { color: #123456 }\n' > "$SCRATCH_DIST/assets/app.css"

GOSLEEP_BEARER_TOKEN="$TOKEN" GOSLEEP_OWNER_NAME="smoke-owner" GOSLEEP_CORE_PORT="$PORT" \
  GOSLEEP_DB_PATH="$SCRATCH_DB" GOSLEEP_LAB_DIR="$SCRATCH_LAB" \
  GOSLEEP_INTERNAL_SECRET="$INTERNAL_SECRET" \
  GOSLEEP_WEB_DIST="$SCRATCH_DIST" \
  GOSLEEP_DISABLE_INDEXER=1 GOSLEEP_DISABLE_FLEET_POLL=1 GOSLEEP_DISABLE_JIRA_SYNC=1 \
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
# GSL-294 — db_schema_version is a 16-hex prefix of a sha256 over drizzle files, never the
# legacy "unset" placeholder.
check_body   "6c. /version.db_schema_version is 16-hex hash (GSL-294)"  '"db_schema_version":"[0-9a-f]{16}"' "http://127.0.0.1:$PORT/version" -H "Host: 127.0.0.1:$PORT" -H "Authorization: Bearer $TOKEN"

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

echo "== /internal/* scenarios (GSL-275) =="
# 15. GET answer-wait with no X-Internal-Secret → 401 (auth REQUIRED, never silent-unauth)
check_status "15. GET /internal answer-wait (no secret)" "401" \
  -H "Host: 127.0.0.1:$PORT" \
  "http://127.0.0.1:$PORT/internal/questions/q-nope/answer-wait?timeout_s=1"

# 16. GET with wrong secret → 401
check_status "16. GET /internal answer-wait (wrong secret)" "401" \
  -H "Host: 127.0.0.1:$PORT" \
  -H "X-Internal-Secret: definitely-not-the-secret" \
  "http://127.0.0.1:$PORT/internal/questions/q-nope/answer-wait?timeout_s=1"

# 17. GET with valid secret against unknown qid → 404
check_status "17. GET /internal answer-wait (unknown qid)" "404" \
  -H "Host: 127.0.0.1:$PORT" \
  -H "X-Internal-Secret: $INTERNAL_SECRET" \
  "http://127.0.0.1:$PORT/internal/questions/q-nope/answer-wait?timeout_s=1"

# 18. POST /internal/questions/post without secret → 401
check_status "18. POST /internal/questions/post (no secret)" "401" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" \
  -d '{"tool_input":{"questions":[{"question":"?"}]}}' \
  "http://127.0.0.1:$PORT/internal/questions/post"

# 19. POST /internal/questions/post with valid secret → 200 + qid (writes to SCRATCH_LAB)
POST_BODY_FILE="$WORK/internal-post.json"
POST_STATUS="$(curl -s -o "$POST_BODY_FILE" -w '%{http_code}' -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "X-Internal-Secret: $INTERNAL_SECRET" \
  -d '{
    "session_id": "smoke-session-1",
    "tool_use_id": "smoke-tool-use-1",
    "tool_input": {
      "questions": [
        { "question": "Smoke check question?",
          "header": "Smoke", "multiSelect": false,
          "options": [{"label":"Yes","description":"go"},{"label":"No","description":"stop"}] }
      ]
    }
  }' \
  "http://127.0.0.1:$PORT/internal/questions/post")"
if [ "$POST_STATUS" = "200" ] && grep -q '"qid":"q-' "$POST_BODY_FILE"; then
  ok "19. POST /internal/questions/post (valid) → 200 + qid"
else
  bad "19. POST /internal/questions/post (valid) → $POST_STATUS body=$(cat "$POST_BODY_FILE")"
fi
SMOKE_QID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("qid",""))' "$POST_BODY_FILE" 2>/dev/null || echo "")"

# 20. GET answer-wait against the fresh qid with timeout_s=1 → 204 (no answer arrives)
if [ -n "$SMOKE_QID" ]; then
  WAIT_STATUS="$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Host: 127.0.0.1:$PORT" \
    -H "X-Internal-Secret: $INTERNAL_SECRET" \
    "http://127.0.0.1:$PORT/internal/questions/$SMOKE_QID/answer-wait?timeout_s=1")"
  if [ "$WAIT_STATUS" = "204" ]; then
    ok "20. GET /internal answer-wait (timeout) → 204"
  else
    bad "20. GET /internal answer-wait (timeout) → $WAIT_STATUS (expected 204)"
  fi
else
  bad "20. skipped — POST did not return a qid"
fi

echo "== /fleet + /internal/agents/tool-observed scenarios (GSL-276) =="
# 21. /fleet requires Bearer
check_status "21. GET /fleet (no auth)"   "401" "http://127.0.0.1:$PORT/fleet" -H "Host: 127.0.0.1:$PORT"
# 22. /fleet with valid Bearer → 200 + JSON envelope (sessions[] may be empty here — the scratch
#     smoke disables the indexer and does not run the fleet-poll worker; the endpoint contract
#     itself is what we're validating).
FLEET_BODY_FILE="$WORK/fleet-body.json"
FLEET_STATUS="$(curl -s -o "$FLEET_BODY_FILE" -w '%{http_code}' \
  -H "Host: 127.0.0.1:$PORT" -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:$PORT/fleet")"
if [ "$FLEET_STATUS" = "200" ]; then
  ok "22. GET /fleet (valid) → 200"
else
  bad "22. GET /fleet (valid) → $FLEET_STATUS body=$(cat "$FLEET_BODY_FILE")"
fi
if grep -q '"sessions":' "$FLEET_BODY_FILE" && grep -q '"totals":' "$FLEET_BODY_FILE"; then
  ok "22b. /fleet body has sessions + totals keys"
else
  bad "22b. /fleet body missing keys: $(cat "$FLEET_BODY_FILE")"
fi

# 23. POST /internal/agents/tool-observed with no secret → 401
check_status "23. POST /internal/agents/tool-observed (no secret)" "401" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"smoke-sid","tool":"Bash","ts":"2026-08-07T00:00:00Z"}' \
  "http://127.0.0.1:$PORT/internal/agents/tool-observed"

# 24. POST /internal/agents/tool-observed with valid secret + malformed body → 400
check_status "24. POST /internal/agents/tool-observed (missing session_id)" "400" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "X-Internal-Secret: $INTERNAL_SECRET" -H "Content-Type: application/json" \
  -d '{"tool":"Bash"}' \
  "http://127.0.0.1:$PORT/internal/agents/tool-observed"

# 25. POST /internal/agents/tool-observed with valid secret + valid body → 200
#     The write is queued (1 s debounce); we only prove the endpoint accepts the shape.
OBS_SID="smoke-sid-obs-$(date +%s)"
OBS_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "X-Internal-Secret: $INTERNAL_SECRET" -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$OBS_SID\",\"tool\":\"Read\",\"ts\":\"2026-08-07T00:00:00Z\",\"context_pct\":42}" \
  "http://127.0.0.1:$PORT/internal/agents/tool-observed")"
if [ "$OBS_STATUS" = "200" ]; then
  ok "25. POST /internal/agents/tool-observed (valid) → 200"
else
  bad "25. POST /internal/agents/tool-observed (valid) → $OBS_STATUS"
fi

# 25b. GSL-301 regression: wait past the 1 s debounce and assert the row PERSISTED via a
#      direct DB query. The prior implementation silently dropped the INSERT for a fresh
#      session_id (Bun's `db.query().get()` returns `null`, not `undefined`, so the branch
#      selector took the UPDATE path and UPDATE'd 0 rows). This scenario catches that class
#      of regression without needing the /fleet projection layer.
sleep 2
OBS_DB_ROW="$(sqlite3 "$SCRATCH_DB" "SELECT current_tool || '|' || context_pct FROM agent_sessions WHERE session_id='$OBS_SID'" 2>/dev/null || echo "")"
if [ "$OBS_DB_ROW" = "Read|42" ]; then
  ok "25b. tool-observed row persisted (current_tool=Read, context_pct=42) — GSL-301 regression"
else
  bad "25b. tool-observed row missing (got '$OBS_DB_ROW') — GSL-301 regression: flush dropped the INSERT"
fi

echo "== /metrics scenarios (GSL-280) =="
# 26. /metrics without Bearer → 401 (same layer as /status).
check_status "26. GET /metrics (no auth)" "401" "http://127.0.0.1:$PORT/metrics" -H "Host: 127.0.0.1:$PORT"
# 27. /metrics with valid Bearer → 200 + Prometheus text exposition.
METRICS_BODY_FILE="$WORK/metrics-body.txt"
METRICS_STATUS="$(curl -s -o "$METRICS_BODY_FILE" -w '%{http_code}' \
  -H "Host: 127.0.0.1:$PORT" -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:$PORT/metrics")"
if [ "$METRICS_STATUS" = "200" ]; then
  ok "27. GET /metrics (valid) → 200"
else
  bad "27. GET /metrics (valid) → $METRICS_STATUS"
fi
# 27b. Content-Type must include the Prometheus exposition version parameter.
METRICS_CT="$(curl -sI -H "Host: 127.0.0.1:$PORT" -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:$PORT/metrics" | grep -i '^content-type:' | tr -d '\r')"
if printf '%s' "$METRICS_CT" | grep -Eqi 'version=0\.0\.4'; then
  ok "27b. /metrics content-type advertises Prometheus version=0.0.4"
else
  bad "27b. /metrics content-type missing 'version=0.0.4': $METRICS_CT"
fi
# 27c. Every emitted metric line must be preceded by # HELP + # TYPE headers earlier in the
# document. A cheap surrogate: assert the required families each have a HELP line.
required_families=(
  gosleep_core_uptime_seconds
  gosleep_events_ingested_total
  gosleep_sse_subscribers
  gosleep_hook_wait_seconds
  gosleep_questions_open
  gosleep_security_auth_source
  gosleep_agents_context_pct
)
missing=""
for fam in "${required_families[@]}"; do
  if ! grep -q "^# HELP $fam " "$METRICS_BODY_FILE"; then
    missing="$missing $fam"
  fi
done
if [ -z "$missing" ]; then
  ok "27c. /metrics has # HELP for every required family"
else
  bad "27c. /metrics missing # HELP for:$missing"
fi
# 27d. Auth source line reflects the dev-env source in this smoke.
if grep -q '^gosleep_security_auth_source{source="dev-env"} 1$' "$METRICS_BODY_FILE"; then
  ok "27d. /metrics auth source line = dev-env (matches smoke Bearer bypass)"
else
  bad "27d. /metrics missing/wrong auth source line"
fi

echo "== /actions/questions/apply-manifest + /actions/questions/defer + /manifest (GSL-277 + GSL-278) =="

# 28. GET /manifest without Bearer → 401
check_status "28. GET /manifest (no auth)" "401" "http://127.0.0.1:$PORT/manifest" -H "Host: 127.0.0.1:$PORT"

# 29. GET /manifest with valid Bearer → 200 + at least the seeded rules
MANIFEST_BODY_FILE="$WORK/manifest-body.json"
MANIFEST_STATUS="$(curl -s -o "$MANIFEST_BODY_FILE" -w '%{http_code}' \
  -H "Host: 127.0.0.1:$PORT" -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:$PORT/manifest")"
if [ "$MANIFEST_STATUS" = "200" ]; then
  ok "29. GET /manifest (valid) → 200"
else
  bad "29. GET /manifest (valid) → $MANIFEST_STATUS (body: $(cat "$MANIFEST_BODY_FILE"))"
fi
if grep -q '"manifest §2.merge-strategy"' "$MANIFEST_BODY_FILE"; then
  ok "29b. /manifest contains the seeded §2.merge-strategy rule"
else
  bad "29b. /manifest missing §2.merge-strategy (body: $(cat "$MANIFEST_BODY_FILE"))"
fi

# 30. POST /actions/questions/apply-manifest without Bearer → 401
check_status "30. POST apply-manifest (no auth)" "401" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" \
  -d '{"qid":"q-nope","rule_ref":"manifest §1.reversible-delivery"}' \
  "http://127.0.0.1:$PORT/actions/questions/apply-manifest"

# 31. POST apply-manifest missing rule_ref → 400
check_status "31. POST apply-manifest (no rule_ref)" "400" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"qid":"q-nope"}' \
  "http://127.0.0.1:$PORT/actions/questions/apply-manifest"

# 32. POST apply-manifest against an unknown qid → 404
check_status "32. POST apply-manifest (unknown qid)" "404" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"qid":"q-does-not-exist","rule_ref":"manifest §1.reversible-delivery"}' \
  "http://127.0.0.1:$PORT/actions/questions/apply-manifest"

# 33. POST /actions/questions/defer without Bearer → 401
check_status "33. POST defer (no auth)" "401" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -d '{"qid":"q-nope"}' \
  "http://127.0.0.1:$PORT/actions/questions/defer"

# 34. POST defer missing qid → 400
check_status "34. POST defer (no qid)" "400" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{}' \
  "http://127.0.0.1:$PORT/actions/questions/defer"

# 35. POST defer with malformed defer_until → 400
check_status "35. POST defer (bad defer_until)" "400" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"qid":"q-any","defer_until":"tomorrow"}' \
  "http://127.0.0.1:$PORT/actions/questions/defer"

# 36. Full flow: post a fresh question, apply a manifest rule, verify DB provenance columns.
# Uses the internal shim (already smoke-authenticated with $INTERNAL_SECRET).
POST_FLOW_BODY="$WORK/apply-flow-post.json"
curl -s -o "$POST_FLOW_BODY" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "X-Internal-Secret: $INTERNAL_SECRET" \
  -d '{
    "session_id": "smoke-apply-1",
    "tool_use_id": "smoke-apply-tu-1",
    "tool_input": {
      "questions": [
        { "question": "Regular merge or squash?",
          "header": "MergeStrategy", "multiSelect": false,
          "options": [{"label":"Regular","description":"keeps history"},{"label":"Squash","description":"one commit"}] }
      ]
    }
  }' \
  "http://127.0.0.1:$PORT/internal/questions/post" >/dev/null
FLOW_QID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("qid",""))' "$POST_FLOW_BODY" 2>/dev/null || echo "")"
if [ -n "$FLOW_QID" ]; then
  APPLY_BODY="$WORK/apply-manifest.json"
  APPLY_STATUS="$(curl -s -o "$APPLY_BODY" -w '%{http_code}' -X POST \
    -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
    -H "Idempotency-Key: smoke-apply-$FLOW_QID" \
    -d '{"qid":"'"$FLOW_QID"'","rule_ref":"manifest §2.merge-strategy"}' \
    "http://127.0.0.1:$PORT/actions/questions/apply-manifest")"
  if [ "$APPLY_STATUS" = "200" ] && grep -q '"applied_by":"manifest"' "$APPLY_BODY"; then
    ok "36. apply-manifest end-to-end: valid rule applied, applied_by=manifest"
  else
    bad "36. apply-manifest end-to-end failed: status=$APPLY_STATUS body=$(cat "$APPLY_BODY")"
  fi
  # Idempotency: replay with the SAME Idempotency-Key → cached:true, no re-run.
  REPLAY_BODY="$WORK/apply-manifest-replay.json"
  curl -s -o "$REPLAY_BODY" -X POST \
    -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
    -H "Idempotency-Key: smoke-apply-$FLOW_QID" \
    -d '{"qid":"'"$FLOW_QID"'","rule_ref":"manifest §2.merge-strategy"}' \
    "http://127.0.0.1:$PORT/actions/questions/apply-manifest" >/dev/null
  if grep -q '"cached":true' "$REPLAY_BODY"; then
    ok "36b. apply-manifest is idempotent on replay (cached:true)"
  else
    bad "36b. apply-manifest replay expected cached:true (body: $(cat "$REPLAY_BODY"))"
  fi
  # DB-level provenance check: the questions row now carries applied_by='manifest' + the rule ref.
  DB_PROV="$(sqlite3 "$SCRATCH_DB" "SELECT applied_by || '|' || COALESCE(applied_rule_ref,'') FROM questions WHERE qid='$FLOW_QID'" 2>/dev/null || echo "")"
  if [ "$DB_PROV" = "manifest|manifest §2.merge-strategy" ]; then
    ok "36c. DB provenance columns set: manifest / §2.merge-strategy"
  else
    bad "36c. DB provenance mismatch: got '$DB_PROV'"
  fi
else
  bad "36. flow skipped — internal POST returned no qid"
fi

# 37. Full flow: post a fresh question, defer it with a near-future ISO, verify DB fields.
POST_DEFER_BODY="$WORK/defer-flow-post.json"
curl -s -o "$POST_DEFER_BODY" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "X-Internal-Secret: $INTERNAL_SECRET" \
  -d '{
    "session_id": "smoke-defer-1",
    "tool_use_id": "smoke-defer-tu-1",
    "tool_input": {
      "questions": [
        { "question": "Defer me?",
          "header": "DeferSmoke", "multiSelect": false,
          "options": [{"label":"Yes","description":"y"},{"label":"No","description":"n"}] }
      ]
    }
  }' \
  "http://127.0.0.1:$PORT/internal/questions/post" >/dev/null
DEFER_QID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("qid",""))' "$POST_DEFER_BODY" 2>/dev/null || echo "")"
if [ -n "$DEFER_QID" ]; then
  DEFER_UNTIL="$(python3 -c 'from datetime import datetime, timezone, timedelta; print((datetime.now(timezone.utc)+timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"))')"
  DEFER_BODY="$WORK/defer-flow-post-action.json"
  DEFER_STATUS="$(curl -s -o "$DEFER_BODY" -w '%{http_code}' -X POST \
    -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
    -H "Idempotency-Key: smoke-defer-$DEFER_QID" \
    -d '{"qid":"'"$DEFER_QID"'","defer_until":"'"$DEFER_UNTIL"'"}' \
    "http://127.0.0.1:$PORT/actions/questions/defer")"
  if [ "$DEFER_STATUS" = "200" ] && grep -q '"status":"deferred"' "$DEFER_BODY"; then
    ok "37. defer end-to-end: valid, status=deferred, defer_until echoed"
  else
    bad "37. defer end-to-end failed: status=$DEFER_STATUS body=$(cat "$DEFER_BODY")"
  fi
  # DB check
  DB_DEFER="$(sqlite3 "$SCRATCH_DB" "SELECT status || '|' || COALESCE(defer_until,'') FROM questions WHERE qid='$DEFER_QID'" 2>/dev/null || echo "")"
  if [ "$DB_DEFER" = "deferred|$DEFER_UNTIL" ]; then
    ok "37b. DB row after defer: status=deferred, defer_until=$DEFER_UNTIL"
  else
    bad "37b. DB defer mismatch: got '$DB_DEFER' (expected 'deferred|$DEFER_UNTIL')"
  fi
else
  bad "37. defer flow skipped — internal POST returned no qid"
fi

echo "== /actions/tasks/sync scenarios (GSL-279) =="
# 38. POST /actions/tasks/sync without Bearer → 401
check_status "38. POST /actions/tasks/sync (no auth)" "401" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -d '{}' \
  "http://127.0.0.1:$PORT/actions/tasks/sync"

# 39. POST /actions/tasks/sync with malformed epic → 400
check_status "39. POST /actions/tasks/sync (bad epic)" "400" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"epic":"not-a-key"}' \
  "http://127.0.0.1:$PORT/actions/tasks/sync"

# 40. POST /actions/tasks/sync (valid, no epic) → 200 + result envelope.
# The smoke runs against the real gh CLI (authenticated on the operator's box); a network
# outage in CI would fail this scenario. That is acceptable — the smoke intentionally exercises
# the real integration since the whole point of GSL-279 is to reach a real Jira/GH source.
# On systems without gh reachable, run with GOSLEEP_SKIP_SYNC_LIVE=1 to skip 40+41.
if [ "${GOSLEEP_SKIP_SYNC_LIVE:-0}" != "1" ]; then
  SYNC_BODY="$WORK/sync-body.json"
  SYNC_STATUS="$(curl -s -o "$SYNC_BODY" -w '%{http_code}' -X POST \
    -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
    -H "Idempotency-Key: smoke-sync-$(date +%s)" \
    -d '{}' \
    "http://127.0.0.1:$PORT/actions/tasks/sync" 2>&1)"
  if [ "$SYNC_STATUS" = "200" ] && grep -q '"source":' "$SYNC_BODY"; then
    ok "40. POST /actions/tasks/sync (valid) → 200 + result envelope"
  else
    bad "40. POST /actions/tasks/sync (valid) → $SYNC_STATUS body=$(cat "$SYNC_BODY")"
  fi

  # 41. After the sync tick, the scratch DB's tasks table has rows for real GSL-* issues.
  # The COUNT depends on the live Jira/GH state; assert only "> 0" which is stable.
  DB_TASKS_COUNT="$(sqlite3 "$SCRATCH_DB" "SELECT COUNT(*) FROM tasks WHERE key LIKE 'GSL-%'" 2>/dev/null || echo "0")"
  if [ "$DB_TASKS_COUNT" -gt 0 ]; then
    ok "41. tasks table now carries $DB_TASKS_COUNT GSL-* rows after sync"
  else
    bad "41. tasks table empty after sync — either gh/jira is unreachable or the parser missed"
  fi
else
  ok "40. skipped (GOSLEEP_SKIP_SYNC_LIVE=1)"
  ok "41. skipped (GOSLEEP_SKIP_SYNC_LIVE=1)"
fi

echo "== /internal/permissions/post + /actions/permissions/decide (GSL-284) =="

# 42. POST /internal/permissions/post without secret → 401
check_status "42. POST /internal/permissions/post (no secret)" "401" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"s","tool_input":{"tool":"Bash"}}' \
  "http://127.0.0.1:$PORT/internal/permissions/post"

# 43. POST /internal/permissions/post missing tool → 400
check_status "43. POST /internal/permissions/post (no tool)" "400" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "X-Internal-Secret: $INTERNAL_SECRET" \
  -d '{"session_id":"s"}' \
  "http://127.0.0.1:$PORT/internal/permissions/post"

# 44. POST /internal/permissions/post valid → 200 + p-* qid + kind='permission' row lands.
PERM_POST_BODY="$WORK/perm-post.json"
PERM_POST_STATUS="$(curl -s -o "$PERM_POST_BODY" -w '%{http_code}' -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "X-Internal-Secret: $INTERNAL_SECRET" \
  -d '{
    "session_id": "smoke-perm-sid-1",
    "tool_use_id": "smoke-perm-tu-1",
    "tool_input": {
      "tool": "Bash",
      "params": {"command": "ls /tmp"},
      "message": "list tmp for smoke"
    }
  }' \
  "http://127.0.0.1:$PORT/internal/permissions/post")"
if [ "$PERM_POST_STATUS" = "200" ] && grep -q '"qid":"p-' "$PERM_POST_BODY"; then
  ok "44. POST /internal/permissions/post (valid) → 200 + p-* qid"
else
  bad "44. POST /internal/permissions/post → $PERM_POST_STATUS body=$(cat "$PERM_POST_BODY")"
fi
PERM_QID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("qid",""))' "$PERM_POST_BODY" 2>/dev/null || echo "")"

# 44b. DB confirms kind='permission' and canonical Allow/Deny options.
if [ -n "$PERM_QID" ]; then
  DB_ROW="$(sqlite3 "$SCRATCH_DB" "SELECT kind || '|' || status || '|' || options FROM questions WHERE qid='$PERM_QID'" 2>/dev/null || echo "")"
  case "$DB_ROW" in
    permission\|open\|*Allow*Deny*)
      ok "44b. DB row has kind=permission + open + Allow/Deny options" ;;
    *)
      bad "44b. DB row unexpected: '$DB_ROW'" ;;
  esac
else
  bad "44b. skipped — POST returned no qid"
fi

# 45. POST /actions/permissions/decide without Bearer → 401
check_status "45. POST /actions/permissions/decide (no auth)" "401" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" \
  -d '{"qid":"p-nope","decision":"allow"}' \
  "http://127.0.0.1:$PORT/actions/permissions/decide"

# 46. POST /actions/permissions/decide bad decision → 400
check_status "46. POST /actions/permissions/decide (bad decision)" "400" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"qid":"p-any","decision":"maybe"}' \
  "http://127.0.0.1:$PORT/actions/permissions/decide"

# 47. POST /actions/permissions/decide against unknown qid → 404
check_status "47. POST /actions/permissions/decide (unknown qid)" "404" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"qid":"p-does-not-exist","decision":"allow"}' \
  "http://127.0.0.1:$PORT/actions/permissions/decide"

# 48. Full flow: decide allow on the fresh qid, verify DB state.
if [ -n "$PERM_QID" ]; then
  DECIDE_BODY="$WORK/perm-decide-allow.json"
  DECIDE_STATUS="$(curl -s -o "$DECIDE_BODY" -w '%{http_code}' -X POST \
    -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
    -H "Idempotency-Key: smoke-decide-$PERM_QID" \
    -d '{"qid":"'"$PERM_QID"'","decision":"allow"}' \
    "http://127.0.0.1:$PORT/actions/permissions/decide")"
  if [ "$DECIDE_STATUS" = "200" ] && grep -q '"decision":"allow"' "$DECIDE_BODY"; then
    ok "48. decide allow → 200 + result.decision=allow"
  else
    bad "48. decide allow → $DECIDE_STATUS body=$(cat "$DECIDE_BODY")"
  fi
  DB_DEC="$(sqlite3 "$SCRATCH_DB" "SELECT answer_text || '|' || COALESCE(applied_by,'NULL') FROM questions WHERE qid='$PERM_QID'" 2>/dev/null || echo "")"
  if [ "$DB_DEC" = "allow|owner" ]; then
    ok "48b. DB row: answer_text=allow, applied_by=owner"
  else
    bad "48b. DB row unexpected: '$DB_DEC'"
  fi
  # 49. Second decide on the same qid (now status=answered) → 409.
  check_status "49. POST decide on already-answered permission → 409" "409" -X POST \
    -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
    -H "Idempotency-Key: smoke-decide-second-$PERM_QID" \
    -d '{"qid":"'"$PERM_QID"'","decision":"deny"}' \
    "http://127.0.0.1:$PORT/actions/permissions/decide"
else
  bad "48. skipped — no PERM_QID"
  bad "48b. skipped — no PERM_QID"
  bad "49. skipped — no PERM_QID"
fi

# 50. Wrong-kind guard: try deciding on a BLOCKER qid → 409.
BLOCKER_POST_BODY="$WORK/blocker-post-for-perm-guard.json"
curl -s -o "$BLOCKER_POST_BODY" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "X-Internal-Secret: $INTERNAL_SECRET" \
  -d '{"session_id":"smoke-guard","tool_use_id":"tu-guard","tool_input":{"questions":[{"question":"blocker for guard?","options":[{"label":"Y"}]}]}}' \
  "http://127.0.0.1:$PORT/internal/questions/post" >/dev/null
BLOCKER_QID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("qid",""))' "$BLOCKER_POST_BODY" 2>/dev/null || echo "")"
if [ -n "$BLOCKER_QID" ]; then
  check_status "50. POST decide against a BLOCKER qid → 409" "409" -X POST \
    -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
    -H "Idempotency-Key: smoke-decide-wrong-kind" \
    -d '{"qid":"'"$BLOCKER_QID"'","decision":"allow"}' \
    "http://127.0.0.1:$PORT/actions/permissions/decide"
else
  bad "50. skipped — could not seed BLOCKER row"
fi

echo "== GSL-285: SPA static serve + fallback + API precedence =="
# 51. GET / — SPA fallback → 200 text/html with the scratch index.html body.
check_status "51. GET / (SPA root)" "200" -H "Host: 127.0.0.1:$PORT" "http://127.0.0.1:$PORT/"
check_body   "51b. / body has scratch marker" "scratch-spa-index" -H "Host: 127.0.0.1:$PORT" "http://127.0.0.1:$PORT/"

# 52. GET /overview — deep client-side route falls back to index.html (react-router owns it).
check_status "52. GET /overview (SPA fallback)" "200" -H "Host: 127.0.0.1:$PORT" "http://127.0.0.1:$PORT/overview"
check_body   "52b. /overview body has scratch marker" "scratch-spa-index" -H "Host: 127.0.0.1:$PORT" "http://127.0.0.1:$PORT/overview"

# 53. GET /assets/app.js — real static asset served verbatim.
check_status "53. GET /assets/app.js (asset)" "200" -H "Host: 127.0.0.1:$PORT" "http://127.0.0.1:$PORT/assets/app.js"
check_body   "53b. asset body" 'scratch spa asset' -H "Host: 127.0.0.1:$PORT" "http://127.0.0.1:$PORT/assets/app.js"

# 54. API precedence: /healthz still wins over the SPA wildcard.
check_status "54. GET /healthz (API precedence over SPA)" "200" -H "Host: 127.0.0.1:$PORT" "http://127.0.0.1:$PORT/healthz"
check_body   "54b. /healthz still returns JSON" '"ok":true' -H "Host: 127.0.0.1:$PORT" "http://127.0.0.1:$PORT/healthz"

# 55. API precedence: /version stays Bearer-gated even with SPA mounted.
check_status "55. GET /version (still Bearer-gated)" "401" -H "Host: 127.0.0.1:$PORT" "http://127.0.0.1:$PORT/version"

# 56. CSP still stamped on the SPA fallback response.
CSP_LINE=$(curl -sI -H "Host: 127.0.0.1:$PORT" "http://127.0.0.1:$PORT/overview" | tr -d '\r' | grep -i '^content-security-policy:')
if [ -n "$CSP_LINE" ] && echo "$CSP_LINE" | grep -q "default-src 'self'"; then
  ok "56. CSP stamped on SPA HTML"
else
  bad "56. CSP MISSING on SPA HTML: $CSP_LINE"
fi

# 57. Wrong Host still 421 on SPA path (DNS-rebinding guard active).
check_status "57. GET / (wrong Host)" "421" -H "Host: attacker.example" "http://127.0.0.1:$PORT/"

# 58. POST to an unknown path is an honest 404 (no SPA rewrite for non-GET).
check_status "58. POST /nope (honest 404, no SPA rewrite)" "404" -X POST -H "Host: 127.0.0.1:$PORT" \
  -H "Origin: http://127.0.0.1:$PORT" -H "Content-Type: application/json" -d "{}" \
  "http://127.0.0.1:$PORT/nope"

echo "== GSL-291: /setup Bearer-discovery flow =="
# 59. POST /internal/setup/otp without secret → 401.
check_status "59. POST /internal/setup/otp (no secret)" "401" -X POST -H "Host: 127.0.0.1:$PORT" \
  -H "Origin: http://127.0.0.1:$PORT" -H "Content-Type: application/json" -d "{}" \
  "http://127.0.0.1:$PORT/internal/setup/otp"

# 60. POST /internal/setup/otp with secret → 200 + {otp, url, expires_at}.
OTP_BODY="$WORK/setup-otp.json"
# check_status forces -o /dev/null, so drive curl directly for a body capture.
curl -s -o "$OTP_BODY" -w '%{http_code}' -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "X-Internal-Secret: $INTERNAL_SECRET" \
  -d '{"ttl_s":60}' "http://127.0.0.1:$PORT/internal/setup/otp" \
  | grep -q "^200$" && ok "60. POST /internal/setup/otp (valid) → 200" \
  || bad "60. POST /internal/setup/otp (valid) — expected 200"
SETUP_OTP="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("otp",""))' "$OTP_BODY" 2>/dev/null || echo "")"
if [ -n "$SETUP_OTP" ]; then
  ok "60b. OTP present in response body"
else
  bad "60b. OTP missing from /internal/setup/otp response"
fi

# 61. GET /setup?tok=<OTP> → 200 HTML, body carries the meta-tag with the Bearer.
if [ -n "$SETUP_OTP" ]; then
  SETUP_BODY="$WORK/setup-page.html"
  SETUP_HTTP="$(curl -s -o "$SETUP_BODY" -w '%{http_code}' -H "Host: 127.0.0.1:$PORT" \
    "http://127.0.0.1:$PORT/setup?tok=$SETUP_OTP")"
  if [ "$SETUP_HTTP" = "200" ]; then
    ok "61. GET /setup?tok=<OTP> (valid) → 200"
  else
    bad "61. GET /setup?tok=<OTP> (valid) — expected 200, got $SETUP_HTTP"
  fi
  if grep -q "meta name=\"gosleep-token\" content=\"$TOKEN\"" "$SETUP_BODY"; then
    ok "61b. /setup body carries gosleep-token meta tag with the Bearer"
  else
    bad "61b. /setup body missing meta tag with Bearer (first 400 bytes: $(head -c 400 "$SETUP_BODY"))"
  fi
  # 62. Second GET with the same tok → 400 (single-use).
  check_status "62. GET /setup?tok=<used OTP> → 400" "400" -H "Host: 127.0.0.1:$PORT" \
    "http://127.0.0.1:$PORT/setup?tok=$SETUP_OTP"
else
  bad "61. skipped — no OTP"
  bad "61b. skipped — no OTP"
  bad "62. skipped — no OTP"
fi

# 63. GET /setup with no tok → 400.
check_status "63. GET /setup (no tok)" "400" -H "Host: 127.0.0.1:$PORT" \
  "http://127.0.0.1:$PORT/setup"

# 64. GET /setup with a bogus tok → 400 (unknown OTP).
check_status "64. GET /setup (unknown tok)" "400" -H "Host: 127.0.0.1:$PORT" \
  "http://127.0.0.1:$PORT/setup?tok=obviously-not-issued"

# 65. Cache-Control: no-store MUST be stamped on /setup responses (the body carries a secret).
CACHE_LINE=$(curl -sI -H "Host: 127.0.0.1:$PORT" "http://127.0.0.1:$PORT/setup?tok=zzz" | tr -d '\r' | grep -i '^cache-control:')
if echo "$CACHE_LINE" | grep -q 'no-store'; then
  ok "65. /setup response is no-store"
else
  bad "65. /setup missing cache-control: no-store (line: $CACHE_LINE)"
fi

# 66. TTL clamp: passing ttl_s: 5 (below floor 30) should still succeed but clamp — response
# echoes the ttl_s the store used, which must be >= 30.
CLAMP_BODY="$WORK/setup-clamp.json"
curl -s -o "$CLAMP_BODY" -X POST -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "X-Internal-Secret: $INTERNAL_SECRET" \
  -d '{"ttl_s":5}' "http://127.0.0.1:$PORT/internal/setup/otp" >/dev/null
CLAMPED_TTL="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("ttl_s",""))' "$CLAMP_BODY" 2>/dev/null || echo "")"
if [ "$CLAMPED_TTL" = "30" ]; then
  ok "66. ttl_s clamped to 30 s floor (was 5)"
else
  bad "66. expected clamped ttl_s=30, got '$CLAMPED_TTL'"
fi

echo "== GSL-298: POST /actions/snapshot =="
# 67. without Bearer → 401
check_status "67. POST /actions/snapshot (no auth)" "401" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -d '{}' \
  "http://127.0.0.1:$PORT/actions/snapshot"

# 68. Label with illegal characters → 400 (guards the filename that snapshot.sh embeds).
check_status "68. POST /actions/snapshot (bad label)" "400" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"label":"bad label with spaces"}' \
  "http://127.0.0.1:$PORT/actions/snapshot"

# 69. Valid → 200, result carries kind + path, and the file exists on disk.
SNAP_BODY="$WORK/snap-body.json"
SNAP_KEY="smoke-snap-$(date +%s)"
SNAP_STATUS="$(curl -s -o "$SNAP_BODY" -w '%{http_code}' -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $SNAP_KEY" \
  -d '{"label":"smoke"}' \
  "http://127.0.0.1:$PORT/actions/snapshot")"
if [ "$SNAP_STATUS" = "200" ] && grep -q '"kind":"manual"' "$SNAP_BODY"; then
  ok "69. POST /actions/snapshot (valid) → 200 + result.kind=manual"
else
  bad "69. POST /actions/snapshot (valid) → $SNAP_STATUS body=$(cat "$SNAP_BODY")"
fi

# 69b. The reported path exists on disk and lives under the scratch DB's snapshots dir.
SNAP_PATH="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(((d.get("result") or {}).get("path")) or "")' "$SNAP_BODY" 2>/dev/null || echo "")"
if [ -n "$SNAP_PATH" ] && [ -f "$SNAP_PATH" ]; then
  case "$SNAP_PATH" in
    "$WORK"/*|"$SCRATCH_LAB"/*|"$(dirname "$SCRATCH_DB")"/*)
      ok "69b. snapshot path exists under scratch tree: $SNAP_PATH" ;;
    *)
      # Not fatal, but flag: the snapshot landed OUTSIDE the scratch tree — the env
      # pass-through would be broken and the real DB might have been touched.
      bad "69b. snapshot path exists but is NOT under scratch tree: $SNAP_PATH"
      ;;
  esac
else
  bad "69b. snapshot path missing or file not found: '$SNAP_PATH'"
fi

# 70. Replay same Idempotency-Key → 200 + cached:true, same intent_id.
REPLAY_BODY="$WORK/snap-replay.json"
curl -s -o "$REPLAY_BODY" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $SNAP_KEY" \
  -d '{"label":"smoke"}' \
  "http://127.0.0.1:$PORT/actions/snapshot" >/dev/null
if grep -q '"cached":true' "$REPLAY_BODY"; then
  ok "70. snapshot idempotent on replay (cached:true)"
else
  bad "70. snapshot replay expected cached:true (body: $(cat "$REPLAY_BODY"))"
fi

# 71. No label → 200 + result.kind=daily (matches the launchd cron shape).
DAILY_BODY="$WORK/snap-daily.json"
DAILY_STATUS="$(curl -s -o "$DAILY_BODY" -w '%{http_code}' -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: smoke-snap-daily-$(date +%s)" \
  -d '{}' \
  "http://127.0.0.1:$PORT/actions/snapshot")"
if [ "$DAILY_STATUS" = "200" ] && grep -q '"kind":"daily"' "$DAILY_BODY"; then
  ok "71. POST /actions/snapshot (no label) → 200 + result.kind=daily"
else
  bad "71. POST /actions/snapshot (no label) → $DAILY_STATUS body=$(cat "$DAILY_BODY")"
fi

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
