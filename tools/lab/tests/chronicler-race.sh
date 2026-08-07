#!/usr/bin/env bash
# =============================================================================
# gosleep lab — chronicler race test (GSL-259).
#
# WHAT THIS PROVES. The top-level mkdir-lock in tools/lab/chronicler.sh (GSL-259) actually
# serializes concurrent invocations. The redteam-verdict.md critical #2 ("the synchronous
# chronicler.sh after an action race is NOT closed against a parallel debounce chronicler") was
# open because two chronicler runs launched within ms of each other would clobber each other's
# writes to render_bundle.json. This test spawns TWO chronicler.sh processes in parallel and
# asserts:
#
#   1. Both processes exit 0 (the second WAITS for the first, then runs — the Jira contract).
#   2. The chronicler-ledger.jsonl records TWO lines with result="ran" (not one, not
#      "skipped-lock-held" — because the default 15 s wait window is long enough for the first
#      pass to finish under smoke conditions).
#   3. At least one of the two ledger lines has waited_s > 0 — proof the lock actually held.
#   4. The lock directory is CLEANED UP after both runs (trap released it).
#
# It also runs a second phase with a short GOSLEEP_CHRONICLER_LOCK_WAIT_S=1 to force the
# skip-path: the second caller gives up and stamps "skipped-lock-held" without ever running the
# python.
#
# HERMETIC. Uses GOSLEEP_CHRONICLER_LOCK_WAIT_S/STALE_S env overrides + a scratch repo so the test
# never touches the live .artifacts/lab/ ledger. But it still runs the REAL chronicler.sh script
# against the REAL repo (via --repo=...): the mkdir-lock lives at $REPO_ROOT/.artifacts/lab/... so
# a scratch REPO_ROOT gives a scratch lock and ledger.
#
# Usage:
#   tools/lab/tests/chronicler-race.sh          # exit 0 = pass, 1 = fail
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CHR="$REPO_ROOT/tools/lab/chronicler.sh"

WORK="$REPO_ROOT/.artifacts/chronicler-race-test"
rm -rf "$WORK"; mkdir -p "$WORK/.artifacts/lab"
# The chronicler needs a docs/lab dir to READ; symlink to the real one so a --dry-run pass has
# input, but keep our own writable .artifacts for the lock + ledger.
mkdir -p "$WORK/docs"
ln -s "$REPO_ROOT/docs/lab" "$WORK/docs/lab"

LEDGER="$WORK/.artifacts/lab/chronicler-ledger.jsonl"
LOCK="$WORK/.artifacts/lab/chronicler.lock"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "== phase 1: two parallel chronicler.sh, wait window 30s (both should run) =="
: > "$LEDGER" 2>/dev/null || true
rm -rf "$LOCK" 2>/dev/null || true

# Race: two --dry-run passes back-to-back. --dry-run keeps the pass short (<= a few seconds) so
# both easily fit in the 30 s wait window. Both run against the scratch --repo so the lock lands
# in $WORK/.artifacts/lab/ (isolated).
GOSLEEP_CHRONICLER_LOCK_WAIT_S=30 GOSLEEP_CHRONICLER_LOCK_STALE_S=120 \
  bash "$CHR" --repo "$WORK" --mode race-a --dry-run --quiet >/dev/null 2>&1 &
PID_A=$!
GOSLEEP_CHRONICLER_LOCK_WAIT_S=30 GOSLEEP_CHRONICLER_LOCK_STALE_S=120 \
  bash "$CHR" --repo "$WORK" --mode race-b --dry-run --quiet >/dev/null 2>&1 &
PID_B=$!

wait "$PID_A"; RC_A=$?
wait "$PID_B"; RC_B=$?

[ "$RC_A" -eq 0 ] && ok "process A exit 0" || bad "process A exit rc=$RC_A"
[ "$RC_B" -eq 0 ] && ok "process B exit 0" || bad "process B exit rc=$RC_B"

# Ledger: expect two "ran" lines, one for each mode.
RAN_A="$(grep -c '"mode":"race-a".*"result":"ran"' "$LEDGER" 2>/dev/null || echo 0)"
RAN_B="$(grep -c '"mode":"race-b".*"result":"ran"' "$LEDGER" 2>/dev/null || echo 0)"
[ "$RAN_A" = "1" ] && ok "ledger has race-a ran line" || bad "ledger race-a lines=$RAN_A (want 1)"
[ "$RAN_B" = "1" ] && ok "ledger has race-b ran line" || bad "ledger race-b lines=$RAN_B (want 1)"

# Waited: at least one of the two ran with waited_s > 0 (the loser of the race waited).
WAITED_ANY="$(python3 - "$LEDGER" <<'PY'
import json, sys
try:
    with open(sys.argv[1]) as f:
        lines = [json.loads(x) for x in f if x.strip()]
except Exception:
    print(0); sys.exit(0)
ok = any((r.get("mode","").startswith("race-") and r.get("result") == "ran" and int(r.get("waited_s") or 0) > 0) for r in lines)
print(1 if ok else 0)
PY
)"
[ "$WAITED_ANY" = "1" ] && ok "at least one race-{a,b} run waited_s > 0 (lock held)" \
                        || bad "no race-{a,b} run recorded waited_s > 0 — lock did not hold"

# Lock: cleaned up after both runs.
[ ! -d "$LOCK" ] && ok "lock directory cleaned up after both runs" \
                 || bad "lock directory $LOCK still exists"

echo "== phase 2: wait window = 1s, first pass sleeps 3s (second gives up) =="
: > "$LEDGER" 2>/dev/null || true
rm -rf "$LOCK" 2>/dev/null || true

# Grab the lock manually to simulate a slow pass, keep it 3s, then release.
mkdir -p "$LOCK"
(sleep 3; rmdir "$LOCK" 2>/dev/null || true) &
HOLDER=$!

# One chronicler with a 1s wait window — it must give up and stamp "skipped-lock-held".
GOSLEEP_CHRONICLER_LOCK_WAIT_S=1 GOSLEEP_CHRONICLER_LOCK_STALE_S=120 \
  bash "$CHR" --repo "$WORK" --mode race-skip --dry-run --quiet >/dev/null 2>&1
RC_SKIP=$?
wait "$HOLDER" 2>/dev/null || true

[ "$RC_SKIP" -eq 0 ] && ok "skip-path exit 0" || bad "skip-path rc=$RC_SKIP (want 0)"
SKIP_CT="$(grep -c '"mode":"race-skip".*"result":"skipped-lock-held"' "$LEDGER" 2>/dev/null || echo 0)"
[ "$SKIP_CT" = "1" ] && ok "ledger stamped skipped-lock-held" \
                     || bad "ledger race-skip skipped-lock-held lines=$SKIP_CT (want 1)"

echo
echo "== summary =="
echo "  pass=$PASS  fail=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  rm -rf "$WORK"
  echo "  chronicler-race: ALL PASS"
  exit 0
fi
echo "  chronicler-race: $FAIL FAIL(s) — see $WORK for artifacts"
exit 1
