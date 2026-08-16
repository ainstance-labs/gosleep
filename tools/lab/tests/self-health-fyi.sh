#!/usr/bin/env bash
# =============================================================================
# gosleep lab — self-health-fyi: prove GSL-233 debts → FYI queue rows.
#
# Directly exercises the two contracts (leaner than spinning chronicler.py):
#   1. `lab-emit question --dedup-any` folds a repeated qhash even across
#      already-closed statuses. That is the primitive chronicler leans on.
#   2. `lab-emit question --type FYI --dedup-any --task GSL-XX --question ...`
#      writes at most ONE FYI per (task, question) tuple; a re-emit appends a
#      seen_by patch, not a second row.
#
# Usage:  tools/lab/tests/self-health-fyi.sh   exit 0 = all cases pass
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
EMIT="$REPO_ROOT/tools/lab/lab-emit.sh"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/gsl233.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
export GOSLEEP_LAB_DIR="$WORK/lab"
mkdir -p "$GOSLEEP_LAB_DIR/questions" "$GOSLEEP_LAB_DIR/decisions" "$GOSLEEP_LAB_DIR/events"
QUEUE="$GOSLEEP_LAB_DIR/questions/queue.jsonl"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  PASS  %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$*"; }

# ── 1. FYI without --dedup-any: an already-closed FYI does NOT block a fresh one ──
Q1=$(bash "$EMIT" question --type FYI --from smoke --task GSL-30 \
       --question "no dev_history file committed for GSL-30")
Q2=$(bash "$EMIT" question --type FYI --from smoke --task GSL-30 \
       --question "no dev_history file committed for GSL-30")
if [ "$Q1" != "$Q2" ] && printf '%s' "$Q2" | grep -vq DUPLICATE; then
  ok "baseline: two FYIs with same qhash produce two distinct ids (open-only dedup)"
else
  bad "baseline dedup unexpectedly folded FYIs (Q1=$Q1 Q2=$Q2)"
fi

# ── 2. --dedup-any: same qhash under a CLOSED (noted) record => DUPLICATE ──
Q3=$(bash "$EMIT" question --type FYI --from smoke --task GSL-31 \
       --question "no dev_history file committed for GSL-31")
Q4=$(bash "$EMIT" question --type FYI --from smoke --task GSL-31 \
       --question "no dev_history file committed for GSL-31" --dedup-any)
if printf '%s' "$Q4" | grep -q "DUPLICATE $Q3"; then
  ok "--dedup-any folds across closed statuses: Q4 => DUPLICATE $Q3"
else
  bad "--dedup-any did not fold (Q3=$Q3 Q4=$Q4)"
fi

# ── 3. patch count matches: ONE base record + ONE seen_by patch under --dedup-any ──
# Q3 is base (1 line), Q4 folded into a patch (1 line). Total = 2 lines with task=GSL-31
count=$(python3 -c "
import json
lines=[json.loads(l) for l in open('$QUEUE') if l.strip()]
print(sum(1 for r in lines if r.get('task')=='GSL-31' or r.get('re')=='$Q3'))
")
if [ "$count" = "2" ]; then
  ok "queue holds exactly one base + one seen_by patch for GSL-31 (count=$count)"
else
  bad "expected 2 lines for GSL-31, got $count"
fi

# ── 4. seen_by patch carries the caller identity ──
if python3 -c "
import json
lines=[json.loads(l) for l in open('$QUEUE') if l.strip()]
p=[r for r in lines if r.get('re')=='$Q3' and r.get('seen_by')]
assert len(p)==1 and p[0]['seen_by']=='smoke', 'unexpected seen_by patches: %r' % p
"; then
  ok "seen_by patch names the caller ('smoke')"
else
  bad "seen_by patch missing or wrong caller"
fi

# ── 5. Debt for a DIFFERENT task creates a distinct row (dedup is per-qhash) ──
Q5=$(bash "$EMIT" question --type FYI --from smoke --task GSL-32 \
       --question "no dev_history file committed for GSL-32" --dedup-any)
[ "$Q5" != "$Q3" ] && printf '%s' "$Q5" | grep -vq DUPLICATE \
  && ok "different task -> distinct FYI id ($Q5)" \
  || bad "different task was folded (Q3=$Q3 Q5=$Q5)"

# ── 6. --dedup-any without prior record still creates a fresh row ──
Q6=$(bash "$EMIT" question --type FYI --from smoke --task GSL-33 \
       --question "handoff debt: 3 cycle(s) closed without a committed handoff (alarm at 3)" \
       --dedup-any)
[ -n "$Q6" ] && printf '%s' "$Q6" | grep -vq DUPLICATE \
  && ok "--dedup-any on a fresh qhash creates a new row ($Q6)" \
  || bad "--dedup-any refused a fresh row"

printf '\nresult: %d pass, %d fail\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
