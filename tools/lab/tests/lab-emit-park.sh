#!/usr/bin/env bash
# =============================================================================
# gosleep lab — lab-emit-park: prove GSL-230 mandatory wake date at park.
#
# `park` refuses without `--wake-at`, refuses a bad ISO shape, refuses a closed
# record. A valid park writes {status:"deferred", defer_until, parked:true}
# so every existing reader (chronicler digest, apps/core indexer, defer-reopen
# worker) interoperates without change.
#
# Usage:  tools/lab/tests/lab-emit-park.sh   exit 0 = all cases pass
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
EMIT="$REPO_ROOT/tools/lab/lab-emit.sh"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/gsl230.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
export GOSLEEP_LAB_DIR="$WORK/lab"
mkdir -p "$GOSLEEP_LAB_DIR/questions" "$GOSLEEP_LAB_DIR/decisions" "$GOSLEEP_LAB_DIR/events"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  PASS  %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$*"; }

# ── seed an open BLOCKER + an answered DECISION ─────────────────────────────
QB=$(bash "$EMIT" question --type BLOCKER --from smoke --task GSL-1 \
        --question "some blocker to park?")
QD=$(bash "$EMIT" question --type DECISION --from smoke --task GSL-1 \
        --question "some decision?" --default "yes" --reversibility high)

# ── refuses without --wake-at ────────────────────────────────────────────────
err=$(bash "$EMIT" park --re "$QB" 2>&1 >/dev/null); rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$err" | grep -q "REQUIRES --wake-at"; then
  ok "park without --wake-at is refused with the 'REQUIRES --wake-at' error"
else
  bad "park without --wake-at was accepted or produced wrong error (rc=$rc, err=$err)"
fi

# ── refuses malformed ISO ───────────────────────────────────────────────────
err=$(bash "$EMIT" park --re "$QB" --wake-at "tomorrow" 2>&1 >/dev/null); rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$err" | grep -q "ISO-8601"; then
  ok "park with bad ISO shape is refused"
else
  bad "park with bad ISO was accepted (rc=$rc, err=$err)"
fi

# ── refuses past --wake-at (verifier m7) ───────────────────────────────────
# GSL-243 verifier run 01, finding 7: `park` accepted a past wake date, which
# defeats the entire point (the auto-reopen worker would flip the record back
# to open on its next tick). Reject any wake-at that is not strictly in the
# future. Uses a fresh question ID so the following happy-path test still
# operates on an unparked record.
QM7=$(bash "$EMIT" question --type BLOCKER --from smoke --task GSL-1 \
        --question "wake-at m7 past-date check?")
err=$(bash "$EMIT" park --re "$QM7" --wake-at "2020-01-01T00:00:00Z" 2>&1 >/dev/null); rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$err" | grep -qE "future|past"; then
  ok "park with past --wake-at is refused (verifier m7)"
else
  bad "park with past --wake-at was accepted (rc=$rc, err=$err)"
fi

# ── happy path: park with valid wake-at, correct record shape ───────────────
if bash "$EMIT" park --re "$QB" --wake-at "2027-01-01T10:00:00Z" --by owner \
     | grep -q "parked $QB wake_at=2027-01-01T10:00:00Z"; then
  ok "park with valid ISO wake-at prints 'parked <id> wake_at=<iso>'"
else
  bad "park happy path did not print expected line"
fi
tail -1 "$GOSLEEP_LAB_DIR/questions/queue.jsonl" \
  | python3 -c 'import json,sys; r=json.load(sys.stdin); assert r["status"]=="deferred" and r["defer_until"]=="2027-01-01T10:00:00Z" and r.get("parked") is True, r' \
  && ok "record fields: status=deferred, defer_until, parked=true" \
  || bad "record fields wrong"

# ── refuses parking a CLOSED record ─────────────────────────────────────────
bash "$EMIT" answer --re "$QD" --answer "ok" --by owner >/dev/null
err=$(bash "$EMIT" park --re "$QD" --wake-at "2027-01-01T10:00:00Z" 2>&1 >/dev/null); rc=$?
# QD is now answered — allowed to park (analogous to defer, which permits open|answered).
# Now close it via resolve --early on a fresh DECISION and try to park the closed one.
QD2=$(bash "$EMIT" question --type DECISION --from smoke --task GSL-1 \
        --question "another decision?" --default "yes" --reversibility high \
        --auto-apply-at 2099-01-01T00:00:00Z)
bash "$EMIT" resolve --re "$QD2" --applied "yes" --early >/dev/null
err=$(bash "$EMIT" park --re "$QD2" --wake-at "2027-01-01T10:00:00Z" 2>&1 >/dev/null); rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$err" | grep -q "cannot be parked"; then
  ok "park on a closed record is refused"
else
  bad "park on closed record was accepted (rc=$rc, err=$err)"
fi

# ── auto-reopen worker compatibility: same shape as defer + wake date ───────
# The park record must be indistinguishable from `defer --defer-until <wake>` from any
# reader's point of view. That is what makes chronicler/apps/core/defer-reopen work
# without change. Extra: our patch carries `parked:true` so the digest can label it.
QC=$(bash "$EMIT" question --type BLOCKER --from smoke --task GSL-1 \
        --question "compat check park vs defer?")
bash "$EMIT" defer --re "$QC" --defer-until "2027-01-01T10:00:00Z" --by owner >/dev/null
QP=$(bash "$EMIT" question --type BLOCKER --from smoke --task GSL-2 \
        --question "compat check park vs defer 2?")
bash "$EMIT" park --re "$QP" --wake-at "2027-01-01T10:00:00Z" --by owner >/dev/null
python3 - <<PY
import json
recs = [json.loads(l) for l in open("$GOSLEEP_LAB_DIR/questions/queue.jsonl") if l.strip()]
defer_patch = [r for r in recs if r.get("re")=="$QC" and r.get("status")=="deferred"][-1]
park_patch  = [r for r in recs if r.get("re")=="$QP" and r.get("status")=="deferred"][-1]
assert defer_patch["defer_until"] == park_patch["defer_until"], "wake divergence"
assert park_patch.get("parked") is True and "parked" not in defer_patch, "parked flag missing"
PY
[ "$?" -eq 0 ] && ok "park shape matches defer + parked=true marker" \
              || bad "park shape does not match defer"

printf '\nresult: %d pass, %d fail\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
