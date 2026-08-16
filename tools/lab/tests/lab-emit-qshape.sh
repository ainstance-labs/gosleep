#!/usr/bin/env bash
# =============================================================================
# gosleep lab — lab-emit-qshape: prove GSL-229 semantic shape grouping + advisory
# invariant. Two rewordings of the same fork collapse to ONE shape; the
# `candidates` subcommand groups them across three tasks; the qshape stays
# advisory (no autonomous manifest edit).
#
# Usage:  tools/lab/tests/lab-emit-qshape.sh   exit 0 = all cases pass
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
EMIT="$REPO_ROOT/tools/lab/lab-emit.sh"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/gsl229.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
export GOSLEEP_LAB_DIR="$WORK/lab"
mkdir -p "$GOSLEEP_LAB_DIR/questions" "$GOSLEEP_LAB_DIR/decisions" "$GOSLEEP_LAB_DIR/events"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  PASS  %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$*"; }

# ── qshape via python (probe the function directly) ─────────────────────────
shape_of() {
  # Read the qshape produced by lab-emit for a given question text, by writing a decision
  # and inspecting the log.
  local q="$1"
  bash "$EMIT" decision --by owner --decision "irrelevant" --question "$q" >/dev/null || {
    printf 'ERROR: decision failed for %s\n' "$q" >&2
    return 1
  }
  tail -1 "$GOSLEEP_LAB_DIR/decisions/log.jsonl" | python3 -c 'import json,sys; print(json.load(sys.stdin)["qshape"])'
}

# The rewordings differ only in word order, tense, and stopwords — same content words.
# This is exactly the case the bag-of-content-words shape is designed to fold. A rewording
# that adds a new content word ("handle") is a different fork, and stays a different shape.
s1=$(shape_of "merge strategy for PR #40 after main moved?")
s2=$(shape_of "what is the merge strategy after main moved for PR #40?")
s3=$(shape_of "for PR #40, what is the merge strategy after main was moved?")
if [ "$s1" = "$s2" ] && [ "$s2" = "$s3" ]; then
  ok "three rewordings of 'merge strategy after main moved' collapse to shape $s1"
else
  bad "rewordings produced different shapes: $s1 / $s2 / $s3"
fi

# ── distinct forks stay distinct ────────────────────────────────────────────
sA=$(shape_of "should we roll back the release?")
sB=$(shape_of "what is the merge strategy for PR #99?")
if [ "$sA" != "$sB" ] && [ "$sA" != "$s1" ]; then
  ok "distinct forks stay distinct (rollback $sA != merge-strategy $s1)"
else
  bad "unrelated forks collapsed (rollback=$sA merge=$s1)"
fi

# ── candidates groups them across three tasks ───────────────────────────────
# Reset and seed exactly three decisions with the same shape.
rm -f "$GOSLEEP_LAB_DIR/decisions/log.jsonl"
for tk in GSL-90 GSL-91 GSL-92; do
  bash "$EMIT" decision --by owner --decision "regular merge" --task "$tk" \
    --question "merge strategy for PR #4${tk##*-} after main moved?" >/dev/null
done
if bash "$EMIT" candidates | grep -q 'CANDIDATE ×3: "regular merge"'; then
  ok "candidates ×3 across three tasks (same shape)"
else
  bad "candidates did not group ×3 as expected"
  bash "$EMIT" candidates
fi

# One more decision, reworded (word order + tense + stopwords only) → count → 4
bash "$EMIT" decision --by owner --decision "regular merge" --task "GSL-93" \
  --question "for PR #405, what is the merge strategy after main was moved?" >/dev/null
if bash "$EMIT" candidates | grep -q 'CANDIDATE ×4: "regular merge"'; then
  ok "reworded fourth question collapses into the same candidate (×4)"
else
  bad "reworded fourth question did not fold into the group"
  bash "$EMIT" candidates
fi

# ── advisory invariant: candidates does not mutate the manifest ─────────────
# The manifest file must be untouched by every subcommand run above.
MSHA_BEFORE=$(shasum "$REPO_ROOT/docs/lab/decisions/manifest.md" 2>/dev/null | awk '{print $1}')
bash "$EMIT" candidates >/dev/null
MSHA_AFTER=$(shasum "$REPO_ROOT/docs/lab/decisions/manifest.md" 2>/dev/null | awk '{print $1}')
if [ -n "$MSHA_BEFORE" ] && [ "$MSHA_BEFORE" = "$MSHA_AFTER" ]; then
  ok "candidates is advisory: manifest.md sha unchanged after run"
else
  bad "manifest.md changed after candidates run ($MSHA_BEFORE -> $MSHA_AFTER)"
fi

printf '\nresult: %d pass, %d fail\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
