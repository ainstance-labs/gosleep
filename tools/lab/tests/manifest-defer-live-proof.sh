#!/usr/bin/env bash
# =============================================================================
# gosleep lab — GSL-277 (apply-manifest) + GSL-278 (defer) LIVE PROOF.
#
# Proves the two new action endpoints end-to-end against the REAL owner-sovereign
# `docs/lab/decisions/manifest.md` — the manifest is read from the real repo path (read-only,
# never edited), but the JSONL side and the SQLite DB live in an isolated scratch dir so the
# real docs/lab tree is never touched.
#
# Flow:
#   1. Boot @gosleep/core against SCRATCH_DB + SCRATCH_LAB (with manifest read-only from repo).
#   2. Post a fresh question via /internal/questions/post (the same shim the PreToolUse hook uses).
#   3. POST /actions/questions/apply-manifest with a REAL rule id from the real manifest.
#   4. Read /questions and verify applied_by='manifest' + applied_rule_ref=<real rule>.
#   5. Verify docs/lab/decisions/log.jsonl in the scratch dir carries the decision record.
#   6. Post another fresh question.
#   7. POST /actions/questions/defer with defer_until = now + 3s.
#   8. Verify /questions returns status='deferred' + defer_until.
#   9. Force the defer-reopen worker to poll (via the exported reconcileDeferred()).
#   10. Verify /questions returns status='open' + defer_until=null.
#
# Env: GOSLEEP_LAB_DIR + GOSLEEP_DB_PATH → scratch. GOSLEEP_MANIFEST_LAB_DIR → real repo, so
# the parser reads the real manifest. Actually the parser reads GOSLEEP_LAB_DIR only, so we
# have to copy the real manifest into the scratch lab dir (a filesystem copy of a read-only
# source — no owner file is written).
#
# Exit 0 on all-pass. Exit 1 on any assertion failure.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PORT="${GOSLEEP_CORE_PORT:-7332}"
TOKEN="live-proof-token"
INTERNAL_SECRET="live-proof-internal-secret"

WORK="$REPO_ROOT/.artifacts/manifest-defer-live"
rm -rf "$WORK"; mkdir -p "$WORK"

SCRATCH_DB="$WORK/gosleep.db"
SCRATCH_LAB="$WORK/lab"
mkdir -p "$SCRATCH_LAB/questions" "$SCRATCH_LAB/events" "$SCRATCH_LAB/decisions" \
         "$SCRATCH_LAB/supervision"

# Copy the REAL manifest (read-only source) into the scratch lab dir. We do NOT modify the
# real file — the copy is a one-way filesystem read.
cp "$REPO_ROOT/docs/lab/decisions/manifest.md" "$SCRATCH_LAB/decisions/manifest.md"

# Migrate the scratch DB up.
GOSLEEP_DB_PATH="$SCRATCH_DB" bun run "$REPO_ROOT/apps/core/scripts/migrate.ts" \
  > "$WORK/migrate.log" 2>&1 || {
  echo "ERROR: migrate failed — see $WORK/migrate.log" >&2
  cat "$WORK/migrate.log" >&2
  exit 1
}

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

if lsof -i ":$PORT" >/dev/null 2>&1; then
  echo "ERROR: port $PORT is already in use" >&2
  exit 1
fi

echo "== booting @gosleep/core (live proof; port $PORT; scratch DB + lab) =="
GOSLEEP_BEARER_TOKEN="$TOKEN" GOSLEEP_OWNER_NAME="live-proof" GOSLEEP_CORE_PORT="$PORT" \
  GOSLEEP_DB_PATH="$SCRATCH_DB" GOSLEEP_LAB_DIR="$SCRATCH_LAB" \
  GOSLEEP_INTERNAL_SECRET="$INTERNAL_SECRET" \
  GOSLEEP_DISABLE_INDEXER=1 GOSLEEP_DISABLE_FLEET_POLL=1 \
  GOSLEEP_DISABLE_DEFER_REOPEN=1 \
  bun run "$REPO_ROOT/apps/core/src/serve.ts" \
  > "$WORK/stdout.log" 2> "$WORK/stderr.log" &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; sleep 1; kill -9 $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null; :' EXIT INT TERM

for i in 1 2 3 4 5; do
  if curl -sf "http://127.0.0.1:$PORT/healthz" -H "Host: 127.0.0.1:$PORT" >/dev/null 2>&1; then
    ok "server booted (${i}s)"
    break
  fi
  sleep 1
done

# --- GSL-277 apply-manifest end-to-end ---------------------------------------
echo "== GSL-277: apply-manifest against REAL manifest rule =="

# 1. Pick a rule id that exists in the real manifest.
REAL_RULE_ID="manifest §2.merge-strategy"
if ! grep -q "§2.merge-strategy" "$SCRATCH_LAB/decisions/manifest.md"; then
  bad "real manifest missing §2.merge-strategy — skipping"
  REAL_RULE_ID=""
fi

# 2. Post a fresh question via the internal shim.
POST_BODY="$WORK/apply-post.json"
curl -s -o "$POST_BODY" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "X-Internal-Secret: $INTERNAL_SECRET" \
  -d '{
    "session_id": "live-proof-apply",
    "tool_use_id": "live-proof-apply-tu",
    "tool_input": {
      "questions": [
        { "question": "Regular merge or squash?",
          "header": "MergeStrategy", "multiSelect": false,
          "options": [{"label":"Regular","description":"keeps history"},{"label":"Squash","description":"one commit"}] }
      ]
    }
  }' \
  "http://127.0.0.1:$PORT/internal/questions/post" >/dev/null
FLOW_QID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("qid",""))' "$POST_BODY" 2>/dev/null || echo "")"
if [ -n "$FLOW_QID" ]; then
  ok "internal shim posted fresh question qid=$FLOW_QID"
else
  bad "internal shim did not return a qid: $(cat "$POST_BODY")"
fi

# 3. POST /actions/questions/apply-manifest with the REAL rule id.
if [ -n "$FLOW_QID" ] && [ -n "$REAL_RULE_ID" ]; then
  APPLY_BODY="$WORK/apply.json"
  APPLY_STATUS="$(curl -s -o "$APPLY_BODY" -w '%{http_code}' -X POST \
    -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
    -H "Idempotency-Key: live-proof-apply-$FLOW_QID" \
    -d '{"qid":"'"$FLOW_QID"'","rule_ref":"'"$REAL_RULE_ID"'"}' \
    "http://127.0.0.1:$PORT/actions/questions/apply-manifest")"
  if [ "$APPLY_STATUS" = "200" ] && grep -q '"applied_by":"manifest"' "$APPLY_BODY"; then
    ok "apply-manifest 200 + applied_by=manifest (real rule=$REAL_RULE_ID)"
  else
    bad "apply-manifest failed: status=$APPLY_STATUS body=$(cat "$APPLY_BODY")"
  fi
fi

# 4. Verify DB provenance.
if [ -n "$FLOW_QID" ]; then
  DB_ROW="$(sqlite3 "$SCRATCH_DB" "SELECT status || '|' || applied_by || '|' || applied_rule_ref FROM questions WHERE qid='$FLOW_QID'" 2>/dev/null || echo "")"
  if [ "$DB_ROW" = "answered|manifest|$REAL_RULE_ID" ]; then
    ok "DB row: status=answered, applied_by=manifest, applied_rule_ref=$REAL_RULE_ID"
  else
    bad "DB row mismatch: got '$DB_ROW' (expected 'answered|manifest|$REAL_RULE_ID')"
  fi
fi

# 5. Verify /questions projection carries provenance.
if [ -n "$FLOW_QID" ]; then
  Q_JSON="$WORK/questions.json"
  curl -sf -H "Host: 127.0.0.1:$PORT" -H "Authorization: Bearer $TOKEN" \
    "http://127.0.0.1:$PORT/questions" > "$Q_JSON"
  # Search for our qid + verify the provenance fields.
  if python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
for q in d['questions']:
    if q['qid'] == '$FLOW_QID':
        assert q['applied_by'] == 'manifest', 'expected applied_by=manifest, got %r' % q['applied_by']
        assert q['applied_rule_ref'] == '$REAL_RULE_ID', 'expected applied_rule_ref=$REAL_RULE_ID, got %r' % q['applied_rule_ref']
        assert q['status'] == 'answered', 'expected status=answered, got %r' % q['status']
        sys.exit(0)
raise SystemExit('qid not found in /questions')
" "$Q_JSON"; then
    ok "/questions projection carries applied_by + applied_rule_ref for the qid"
  else
    bad "/questions projection missing/wrong provenance for $FLOW_QID"
  fi
fi

# 6. Verify decisions/log.jsonl in the scratch lab carries the decision record with rule cite.
# The Python JSON writer inserts a space after `:` — grep with a permissive whitespace pattern.
if [ -f "$SCRATCH_LAB/decisions/log.jsonl" ]; then
  if grep -Eq "\"rule\":[[:space:]]*\"$REAL_RULE_ID\"" "$SCRATCH_LAB/decisions/log.jsonl"; then
    ok "decisions/log.jsonl carries the manifest-cited decision (rule=$REAL_RULE_ID)"
  else
    bad "decisions/log.jsonl missing the rule citation: $(cat "$SCRATCH_LAB/decisions/log.jsonl")"
  fi
else
  bad "decisions/log.jsonl was not created by lab-emit decision"
fi

# --- GSL-278 defer end-to-end + auto-reopen -----------------------------------
echo "== GSL-278: defer + auto-reopen against a fresh question =="

POST_DEFER_BODY="$WORK/defer-post.json"
curl -s -o "$POST_DEFER_BODY" -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "X-Internal-Secret: $INTERNAL_SECRET" \
  -d '{
    "session_id": "live-proof-defer",
    "tool_use_id": "live-proof-defer-tu",
    "tool_input": {
      "questions": [
        { "question": "Defer me?",
          "header": "DeferLive", "multiSelect": false,
          "options": [{"label":"Yes","description":"y"},{"label":"No","description":"n"}] }
      ]
    }
  }' \
  "http://127.0.0.1:$PORT/internal/questions/post" >/dev/null
DEFER_QID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("qid",""))' "$POST_DEFER_BODY" 2>/dev/null || echo "")"
if [ -n "$DEFER_QID" ]; then
  ok "internal shim posted fresh question qid=$DEFER_QID"
else
  bad "internal shim did not return a qid: $(cat "$POST_DEFER_BODY")"
fi

# POST defer with defer_until = now + 3s (near future, so we can watch the reopen fire).
DEFER_UNTIL="$(python3 -c 'from datetime import datetime, timezone, timedelta; print((datetime.now(timezone.utc)+timedelta(seconds=3)).strftime("%Y-%m-%dT%H:%M:%SZ"))')"
if [ -n "$DEFER_QID" ]; then
  DEFER_BODY="$WORK/defer.json"
  DEFER_STATUS="$(curl -s -o "$DEFER_BODY" -w '%{http_code}' -X POST \
    -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
    -H "Idempotency-Key: live-proof-defer-$DEFER_QID" \
    -d '{"qid":"'"$DEFER_QID"'","defer_until":"'"$DEFER_UNTIL"'"}' \
    "http://127.0.0.1:$PORT/actions/questions/defer")"
  if [ "$DEFER_STATUS" = "200" ] && grep -q '"status":"deferred"' "$DEFER_BODY"; then
    ok "defer 200 + status=deferred (defer_until=$DEFER_UNTIL)"
  else
    bad "defer failed: status=$DEFER_STATUS body=$(cat "$DEFER_BODY")"
  fi

  # DB check right after defer.
  DB_DEFER="$(sqlite3 "$SCRATCH_DB" "SELECT status || '|' || COALESCE(defer_until,'') FROM questions WHERE qid='$DEFER_QID'" 2>/dev/null || echo "")"
  if [ "$DB_DEFER" = "deferred|$DEFER_UNTIL" ]; then
    ok "DB right after defer: status=deferred, defer_until=$DEFER_UNTIL"
  else
    bad "DB defer mismatch: got '$DB_DEFER'"
  fi

  # queue.jsonl side: the lab-emit defer patch should have landed.
  if grep -Eq '"status":[[:space:]]*"deferred"' "$SCRATCH_LAB/questions/queue.jsonl"; then
    ok "queue.jsonl carries the defer patch"
  else
    bad "queue.jsonl missing defer patch: $(cat "$SCRATCH_LAB/questions/queue.jsonl")"
  fi

  # Wait until defer_until passes, then force the reopen worker to poll once.
  # The server booted with GOSLEEP_DISABLE_DEFER_REOPEN=1 so we control the poll — this makes
  # the proof deterministic (the automatic 10s tick is a race against the smoke's 30s budget).
  echo "  waiting 4s for defer_until to pass ($DEFER_UNTIL)..."
  sleep 4

  # Force the worker manually via a tiny bun script. This is what the interval timer would do.
  REOPEN_LOG="$WORK/reopen.log"
  GOSLEEP_LAB_DIR="$SCRATCH_LAB" bun run "$REPO_ROOT/apps/core/scripts/force-defer-reopen.ts" "$SCRATCH_DB" > "$REOPEN_LOG" 2>&1 || {
    echo "  force-reopen: $(cat "$REOPEN_LOG")"
  }

  # DB check after reopen.
  DB_REOPEN="$(sqlite3 "$SCRATCH_DB" "SELECT status || '|' || COALESCE(defer_until,'NULL') FROM questions WHERE qid='$DEFER_QID'" 2>/dev/null || echo "")"
  if [ "$DB_REOPEN" = "open|NULL" ]; then
    ok "DB after auto-reopen: status=open, defer_until=NULL"
  else
    bad "DB reopen mismatch: got '$DB_REOPEN'"
  fi

  # queue.jsonl carries a reopen patch too — the reopen worker appended it.
  if grep -q '"reopened_by"' "$SCRATCH_LAB/questions/queue.jsonl"; then
    ok "queue.jsonl carries the reopen patch"
  else
    bad "queue.jsonl missing reopen patch: $(cat "$SCRATCH_LAB/questions/queue.jsonl")"
  fi
fi

echo "== teardown =="
kill $SERVER_PID 2>/dev/null || true
for i in 1 2 3; do sleep 1; kill -0 $SERVER_PID 2>/dev/null || break; done
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
  echo "  live-proof: ALL PASS"
  exit 0
fi
echo "  live-proof: $FAIL FAIL(s) — see $WORK for logs"
exit 1
