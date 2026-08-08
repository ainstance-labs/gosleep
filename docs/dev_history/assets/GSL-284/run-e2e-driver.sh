#!/usr/bin/env bash
# =============================================================================
# GSL-284 e2e shim-direct proof.
#
# Boots gosleep-core in an isolated env (own GOSLEEP_LAB_DIR, own GOSLEEP_DB_PATH,
# own Bearer, own /internal secret), then spawns the PermissionRequest hook shim
# three times to prove:
#   1. allow  — decide allow → shim emits { permissionDecision: "allow" }.
#   2. deny   — decide deny with a reason → shim emits { permissionDecision: "deny",
#                                                        permissionDecisionReason: "..." }.
#   3. fail-open — core down → shim exits 0 with NO stdout (agent falls back to TUI).
#
# Does NOT touch the live docs/lab, live data/gosleep.db, or live .claude/settings.
# =============================================================================
set -u -o pipefail

REPO_ROOT="/Users/romanlidovskyi/Documents/dev/harness/gosleep"
E2E_ROOT="/tmp/gsl284-e2e"
LAB_DIR="$E2E_ROOT/lab"
DB_PATH="$E2E_ROOT/gosleep.db"
PORT="7401"
BEARER="gsl284-bearer"
INTERNAL_SECRET="gsl284-internal-secret"
CORE_URL="http://127.0.0.1:$PORT"
SHIM="$REPO_ROOT/tools/hooks/permission-request-hook.sh"
DEBUG_LOG="$E2E_ROOT/hook-debug.jsonl"
CORE_LOG="$E2E_ROOT/core.log"

echo "== setup =="
rm -rf "$E2E_ROOT"
mkdir -p "$LAB_DIR/events" "$LAB_DIR/questions" "$LAB_DIR/decisions" "$LAB_DIR/supervision"
: > "$LAB_DIR/questions/queue.jsonl"
: > "$LAB_DIR/questions/archive.jsonl"
: > "$LAB_DIR/decisions/log.jsonl"
: > "$LAB_DIR/supervision/heartbeat.jsonl"
: > "$DEBUG_LOG"

# Fresh scratch DB with the migration.
cd "$REPO_ROOT"
GOSLEEP_DB_PATH="$DB_PATH" bun run apps/core/scripts/migrate.ts >/dev/null 2>&1

echo "== boot core on $PORT =="
GOSLEEP_DB_PATH="$DB_PATH" \
GOSLEEP_LAB_DIR="$LAB_DIR" \
GOSLEEP_BEARER_TOKEN="$BEARER" \
GOSLEEP_INTERNAL_SECRET="$INTERNAL_SECRET" \
GOSLEEP_DISABLE_INDEXER=1 \
GOSLEEP_DISABLE_FLEET_POLL=1 \
GOSLEEP_DISABLE_DEFER_REOPEN=1 \
GOSLEEP_DISABLE_JIRA_SYNC=1 \
GOSLEEP_CORE_PORT="$PORT" \
bun run apps/core/src/serve.ts >"$CORE_LOG" 2>&1 &
CORE_PID=$!
trap 'kill $CORE_PID 2>/dev/null; sleep 0.2; kill -9 $CORE_PID 2>/dev/null; exit' EXIT INT TERM

# wait for core to bind
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -s -o /dev/null -H "Host: 127.0.0.1:$PORT" "$CORE_URL/healthz"; then
    echo "  core ready on $PORT (pid $CORE_PID)"
    break
  fi
  sleep 0.3
done

# -----------------------------------------------------------------------------
# Path 1: allow
# -----------------------------------------------------------------------------
echo "== path 1: allow =="
STDIN_PAYLOAD='{"session_id":"e2e-allow-sid","tool_use_id":"e2e-tu-allow","tool_name":"PermissionRequest","tool_input":{"tool":"Bash","params":{"command":"ls /tmp"},"message":"e2e allow"}}'
ALLOW_OUT="$E2E_ROOT/allow.stdout"

(
  GOSLEEP_CORE_URL="$CORE_URL" \
  GOSLEEP_INTERNAL_SECRET="$INTERNAL_SECRET" \
  GOSLEEP_HOOK_TIMEOUT_S=10 \
  GOSLEEP_HOOK_DEBUG_LOG="$DEBUG_LOG" \
  bash "$SHIM" <<< "$STDIN_PAYLOAD" >"$ALLOW_OUT"
) &
SHIM_PID=$!

sleep 0.5
QID=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  QID="$(sqlite3 "$DB_PATH" "SELECT qid FROM questions WHERE kind='permission' AND status='open' ORDER BY opened_at DESC LIMIT 1" 2>/dev/null || echo "")"
  [ -n "$QID" ] && break
  sleep 0.3
done
if [ -z "$QID" ]; then
  echo "  FAIL: allow — no permission row appeared after POST"
  wait $SHIM_PID
  exit 1
fi
echo "  qid: $QID"

DECIDE_ALLOW="$E2E_ROOT/decide-allow.json"
DEC_STATUS="$(curl -s -o "$DECIDE_ALLOW" -w '%{http_code}' -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: $CORE_URL" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BEARER" \
  -H "Idempotency-Key: e2e-allow-$QID" \
  -d "{\"qid\":\"$QID\",\"decision\":\"allow\"}" \
  "$CORE_URL/actions/permissions/decide")"
echo "  decide → $DEC_STATUS $(cat $DECIDE_ALLOW)"

wait $SHIM_PID
ALLOW_JSON="$(cat "$ALLOW_OUT")"
echo "  shim stdout: $ALLOW_JSON"
if printf '%s' "$ALLOW_JSON" | grep -Eq '"permissionDecision":\s*"allow"'; then
  echo "  PASS allow"
else
  echo "  FAIL allow — shim did not emit permissionDecision=allow"
  exit 1
fi

# -----------------------------------------------------------------------------
# Path 2: deny + reason
# -----------------------------------------------------------------------------
echo "== path 2: deny + reason =="
STDIN_PAYLOAD='{"session_id":"e2e-deny-sid","tool_use_id":"e2e-tu-deny","tool_name":"PermissionRequest","tool_input":{"tool":"Bash","params":{"command":"rm -rf /"},"message":"e2e deny"}}'
DENY_OUT="$E2E_ROOT/deny.stdout"
(
  GOSLEEP_CORE_URL="$CORE_URL" \
  GOSLEEP_INTERNAL_SECRET="$INTERNAL_SECRET" \
  GOSLEEP_HOOK_TIMEOUT_S=10 \
  GOSLEEP_HOOK_DEBUG_LOG="$DEBUG_LOG" \
  bash "$SHIM" <<< "$STDIN_PAYLOAD" >"$DENY_OUT"
) &
SHIM_PID=$!

sleep 0.5
QID=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  QID="$(sqlite3 "$DB_PATH" "SELECT qid FROM questions WHERE kind='permission' AND status='open' ORDER BY opened_at DESC LIMIT 1" 2>/dev/null || echo "")"
  [ -n "$QID" ] && break
  sleep 0.3
done
if [ -z "$QID" ]; then
  echo "  FAIL: deny — no permission row appeared after POST"
  wait $SHIM_PID
  exit 1
fi
echo "  qid: $QID"

DECIDE_DENY="$E2E_ROOT/decide-deny.json"
DEC_STATUS="$(curl -s -o "$DECIDE_DENY" -w '%{http_code}' -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: $CORE_URL" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BEARER" \
  -H "Idempotency-Key: e2e-deny-$QID" \
  -d "{\"qid\":\"$QID\",\"decision\":\"deny\",\"updated_message\":\"E2E — destructive rm rejected\"}" \
  "$CORE_URL/actions/permissions/decide")"
echo "  decide → $DEC_STATUS $(cat $DECIDE_DENY)"

wait $SHIM_PID
DENY_JSON="$(cat "$DENY_OUT")"
echo "  shim stdout: $DENY_JSON"
if printf '%s' "$DENY_JSON" | grep -Eq '"permissionDecision":\s*"deny"' && \
   printf '%s' "$DENY_JSON" | grep -Eq '"permissionDecisionReason":\s*"E2E'; then
  echo "  PASS deny + reason"
else
  echo "  FAIL deny — expected permissionDecision=deny + reason; got: $DENY_JSON"
  exit 1
fi

# -----------------------------------------------------------------------------
# Path 3: fail-open when core is down
# -----------------------------------------------------------------------------
echo "== path 3: fail-open (core down) =="
kill $CORE_PID 2>/dev/null || true
sleep 0.4
if lsof -i ":$PORT" >/dev/null 2>&1; then
  echo "  FAIL: core did not stop, port $PORT still in use"
  exit 1
fi
STDIN_PAYLOAD='{"session_id":"e2e-fo-sid","tool_use_id":"e2e-tu-fo","tool_name":"PermissionRequest","tool_input":{"tool":"Bash","params":{"command":"pwd"},"message":"e2e fail-open"}}'
FO_OUT="$E2E_ROOT/failopen.stdout"
GOSLEEP_CORE_URL="$CORE_URL" \
GOSLEEP_INTERNAL_SECRET="$INTERNAL_SECRET" \
GOSLEEP_HOOK_TIMEOUT_S=10 \
GOSLEEP_HOOK_CONNECT_S=1 \
GOSLEEP_HOOK_DEBUG_LOG="$DEBUG_LOG" \
bash "$SHIM" <<< "$STDIN_PAYLOAD" >"$FO_OUT"
FO_EXIT=$?
FO_BYTES="$(wc -c < "$FO_OUT" | tr -d ' ')"
echo "  shim exit=$FO_EXIT stdout bytes=$FO_BYTES"
if [ "$FO_EXIT" = "0" ] && [ "$FO_BYTES" = "0" ]; then
  echo "  PASS fail-open: exit=0 + empty stdout"
else
  echo "  FAIL fail-open: shim did not fall open cleanly"
  exit 1
fi

echo "== summary =="
echo "  ALL 3 PATHS PASS"
echo "  debug log: $DEBUG_LOG"
tail -6 "$DEBUG_LOG"
exit 0
