#!/usr/bin/env bash
# =============================================================================
# gosleep lab — LIVE PROOF: POST /actions/questions/answer end-to-end (GSL-268).
#
# Answers the mission's live-proof requirement — "a real (isolated GOSLEEP_LAB_DIR)
# question record; POST the answer via curl; show the DB row + provenance + the lab-emit
# dual-write + SSE event fan-out."
#
# Everything runs inside a hermetic .artifacts/action-live-proof/ tree:
#   - fresh SQLite DB (migrated up)
#   - fresh docs/lab clone (empty queue + events dirs)
#   - dev-Bearer server on 127.0.0.1:7331
#   - one background curl on GET /events collecting SSE frames
#
# Then it:
#   1. Seeds an open BLOCKER via lab-emit.sh question — proves the queue.jsonl side works.
#   2. Re-imports the queue into SQLite so the questions row exists (mimics the tail).
#   3. POSTs /actions/questions/answer.
#   4. Dumps: server_intents row, questions row (status=answered), events row (question.answered),
#      queue.jsonl patch (answered_by=owner-web, channel=web), SSE frame captured on the wire.
#   5. Second POST with the SAME Idempotency-Key → cached replay, no second event.
#
# Exit 0 = every proof point produced the expected artifact.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PORT="${GOSLEEP_CORE_PORT:-7331}"
TOKEN="live-proof-token"

WORK="$REPO_ROOT/.artifacts/action-live-proof"
rm -rf "$WORK"; mkdir -p "$WORK"

SCRATCH_DB="$WORK/gosleep.db"
SCRATCH_LAB="$WORK/lab"
mkdir -p "$SCRATCH_LAB/questions" "$SCRATCH_LAB/events" "$SCRATCH_LAB/decisions" \
         "$SCRATCH_LAB/supervision"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

if lsof -i ":$PORT" >/dev/null 2>&1; then
  echo "ERROR: port $PORT already in use — refusing to run the live proof." >&2
  exit 1
fi

echo "== 0. migrate scratch DB =="
GOSLEEP_DB_PATH="$SCRATCH_DB" bun run "$REPO_ROOT/apps/core/scripts/migrate.ts" \
  > "$WORK/migrate.log" 2>&1 || { echo "migrate failed"; cat "$WORK/migrate.log"; exit 1; }
ok "migrated scratch DB"

echo "== 1. seed one open BLOCKER via lab-emit.sh question =="
QID="$(GOSLEEP_LAB_DIR="$SCRATCH_LAB" \
  bash "$REPO_ROOT/tools/lab/lab-emit.sh" question \
    --type BLOCKER \
    --question "Live-proof of GSL-268: is the answer path wired?" \
    --from live-proof \
    --task GSL-268 2>>"$WORK/lab-emit.err")"
if [ -z "$QID" ]; then
  bad "lab-emit question returned no qid"
  cat "$WORK/lab-emit.err"; exit 1
fi
ok "seeded question: $QID"

echo "== 2. import the JSONL into SQLite so /questions sees the row =="
GOSLEEP_DB_PATH="$SCRATCH_DB" GOSLEEP_LAB_DIR="$SCRATCH_LAB" \
  bun run "$REPO_ROOT/apps/core/scripts/import-jsonl.ts" \
  > "$WORK/import.log" 2>&1 || { echo "import failed"; cat "$WORK/import.log"; exit 1; }
ROW_COUNT="$(sqlite3 "$SCRATCH_DB" "SELECT count(*) FROM questions WHERE qid='$QID' AND status='open'")"
if [ "$ROW_COUNT" = "1" ]; then
  ok "questions table has $QID with status=open"
else
  bad "expected 1 open question row for $QID, got $ROW_COUNT"; exit 1
fi

echo "== 3. boot the core server (with the SAME scratch DB + lab dir) =="
GOSLEEP_BEARER_TOKEN="$TOKEN" GOSLEEP_OWNER_NAME="live-proof-owner" \
  GOSLEEP_CORE_PORT="$PORT" GOSLEEP_DB_PATH="$SCRATCH_DB" GOSLEEP_LAB_DIR="$SCRATCH_LAB" \
  bun run "$REPO_ROOT/apps/core/src/serve.ts" \
  > "$WORK/serve.stdout" 2> "$WORK/serve.stderr" &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; kill $SSE_PID 2>/dev/null; sleep 1; kill -9 $SERVER_PID 2>/dev/null; kill -9 $SSE_PID 2>/dev/null; wait 2>/dev/null; :' EXIT INT TERM

booted=0
for i in 1 2 3 4 5 6 7 8; do
  if curl -sf "http://127.0.0.1:$PORT/healthz" -H "Host: 127.0.0.1:$PORT" >/dev/null 2>&1; then
    booted=1; ok "server up (${i}s)"; break
  fi
  sleep 1
done
[ "$booted" = "1" ] || { bad "server did not boot"; cat "$WORK/serve.stderr"; exit 1; }

echo "== 4. tail SSE in the background — collect frames for the proof =="
SSE_OUT="$WORK/sse.out"
: > "$SSE_OUT"
curl --no-buffer -sN "http://127.0.0.1:$PORT/events" \
  -H "Host: 127.0.0.1:$PORT" -H "Authorization: Bearer $TOKEN" \
  > "$SSE_OUT" 2>>"$WORK/sse.err" &
SSE_PID=$!
sleep 2  # let the SSE backfill land and the subscription register

echo "== 5. POST /actions/questions/answer =="
IDEM="live-proof-answer-$(date +%s)"
BODY_FILE="$WORK/answer-body.json"
STATUS="$(curl -s -o "$BODY_FILE" -w '%{http_code}' -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $IDEM" \
  -d "{\"qid\":\"$QID\",\"answer\":\"YES — the answer path is wired, and this is the live proof.\",\"by\":\"owner-web\",\"channel\":\"web\"}" \
  "http://127.0.0.1:$PORT/actions/questions/answer")"
if [ "$STATUS" = "200" ]; then
  ok "POST answer → 200"
else
  bad "POST answer → $STATUS (body: $(cat "$BODY_FILE"))"
fi
echo "  answer response body:"
cat "$BODY_FILE" | python3 -m json.tool | sed 's/^/    /'

# Give the tail indexer + broadcaster a moment to fan out to SSE.
sleep 3

echo "== 6. proof points — DB rows =="
echo "  server_intents:"
sqlite3 -header -column "$SCRATCH_DB" \
  "SELECT intent_id, endpoint, status, finished_at IS NOT NULL AS done FROM server_intents WHERE intent_id='$IDEM'" \
  | sed 's/^/    /'
INTENT_STATUS="$(sqlite3 "$SCRATCH_DB" "SELECT status FROM server_intents WHERE intent_id='$IDEM'")"
if [ "$INTENT_STATUS" = "ok" ]; then
  ok "server_intents row: status=ok"
else
  bad "server_intents row missing or wrong status: '$INTENT_STATUS'"
fi

echo "  questions:"
sqlite3 -header -column "$SCRATCH_DB" \
  "SELECT qid, status, answer_text, answered_at FROM questions WHERE qid='$QID'" \
  | sed 's/^/    /'
NEW_STATUS="$(sqlite3 "$SCRATCH_DB" "SELECT status FROM questions WHERE qid='$QID'")"
if [ "$NEW_STATUS" = "answered" ]; then
  ok "questions row: status=answered (direct UPDATE)"
else
  bad "expected questions.status=answered, got '$NEW_STATUS'"
fi

echo "== 7. proof points — JSONL dual-write =="
echo "  queue.jsonl (last line):"
tail -1 "$SCRATCH_LAB/questions/queue.jsonl" | python3 -m json.tool | sed 's/^/    /'
if grep -q "\"answered_by\": \"owner-web\"" "$SCRATCH_LAB/questions/queue.jsonl" \
  && grep -q "\"channel\": \"web\"" "$SCRATCH_LAB/questions/queue.jsonl"; then
  ok "queue.jsonl patch carries provenance (answered_by=owner-web, channel=web)"
else
  bad "queue.jsonl patch missing provenance"
fi

EVENTS_FILE="$(ls -t "$SCRATCH_LAB/events/"*.jsonl 2>/dev/null | head -1)"
if [ -n "$EVENTS_FILE" ]; then
  echo "  events JSONL ($EVENTS_FILE, last line):"
  tail -1 "$EVENTS_FILE" | python3 -m json.tool | sed 's/^/    /'
  if grep -q "\"type\": \"question.answered\"" "$EVENTS_FILE" \
     && grep -q "\"actor\": \"owner-web\"" "$EVENTS_FILE"; then
    ok "events JSONL: question.answered with actor=owner-web"
  else
    bad "events JSONL missing question.answered / owner-web actor"
  fi
else
  bad "no events JSONL written"
fi

echo "== 8. proof point — SSE fan-out =="
if grep -q "^event: question.answered" "$SSE_OUT"; then
  ok "SSE stream received: event: question.answered"
  echo "  matching SSE frame:"
  grep -A 1 "^event: question.answered" "$SSE_OUT" | head -4 | sed 's/^/    /'
else
  bad "SSE stream did not carry question.answered (see $SSE_OUT)"
  echo "  SSE tail:"; tail -30 "$SSE_OUT" | sed 's/^/    /'
fi

echo "== 9. idempotency — replay same Idempotency-Key =="
REPLAY_BODY="$WORK/answer-replay.json"
REPLAY_STATUS="$(curl -s -o "$REPLAY_BODY" -w '%{http_code}' -X POST \
  -H "Host: 127.0.0.1:$PORT" -H "Origin: http://127.0.0.1:$PORT" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $IDEM" \
  -d "{\"qid\":\"$QID\",\"answer\":\"replay — should be cached\",\"by\":\"owner-web\"}" \
  "http://127.0.0.1:$PORT/actions/questions/answer")"
if [ "$REPLAY_STATUS" = "200" ] && grep -q '"cached":true' "$REPLAY_BODY"; then
  ok "replay POST → 200 + cached:true (no re-run)"
else
  bad "replay expected 200+cached, got $REPLAY_STATUS body $(cat "$REPLAY_BODY")"
fi
# Confirm the second POST did NOT append a second events JSONL line for question.answered.
ANSWERED_COUNT="$(grep -c "question.answered" "$EVENTS_FILE" || true)"
if [ "$ANSWERED_COUNT" = "1" ]; then
  ok "events JSONL still has exactly 1 question.answered line (replay was a no-op)"
else
  bad "events JSONL has $ANSWERED_COUNT question.answered lines (expected 1 — replay leaked a spawn)"
fi

echo "== 10. teardown =="
kill $SSE_PID 2>/dev/null || true
kill $SERVER_PID 2>/dev/null || true
for i in 1 2 3; do sleep 1; kill -0 $SERVER_PID 2>/dev/null || break; done
kill -9 $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true
trap - EXIT INT TERM

if lsof -i ":$PORT" >/dev/null 2>&1; then
  bad "port $PORT still in use after teardown"
else
  ok "port $PORT clean after teardown"
fi

echo
echo "== summary =="
echo "  pass=$PASS  fail=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "  action-live-proof: ALL PASS"
  exit 0
fi
echo "  action-live-proof: $FAIL FAIL(s) — artifacts under $WORK"
exit 1
