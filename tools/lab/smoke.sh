#!/usr/bin/env bash
# =============================================================================
# gosleep lab — smoke harness for lab-emit.sh (GSL-75 gate; GSL-77 extends).
#
# Exercises the queue contract end-to-end against a throwaway lab dir:
# emit (id gen, per-type status, auto deadline), dedup->seen_by patch,
# answer/resolve patches, list filters/--due/--count, validation failures,
# the typology guard (irreversible => BLOCKER; BLOCKER takes no default),
# the deadline clamp (no default applies before 10:00 local),
# append-only discipline (first line never rewritten).
#
# All artifacts under <repo>/.artifacts/lab-smoke/ (gitignored); removed on pass.
# Usage: smoke.sh            exit 0 = all checks pass
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LE="$SCRIPT_DIR/lab-emit.sh"
WORK="$REPO_ROOT/.artifacts/lab-smoke"
export GOSLEEP_LAB_DIR="$WORK/lab"
QUEUE="$GOSLEEP_LAB_DIR/questions/queue.jsonl"

rm -rf "$WORK"; mkdir -p "$WORK"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "== static gates =="
bash -n "$LE" && ok "bash -n (syntax)" || bad "bash -n (syntax)"
grep -qE 'claude( -p|\b--print)' "$LE" && bad "0-LLM (C1)" || ok "0-LLM (C1): no headless claude calls"

echo "== emit: DECISION (id, status, auto deadline) =="
ID1="$("$LE" question --type DECISION --from smoke-w1 --task GSL-99 \
  --question "rebase or merge main into the epic branch?" \
  --default "merge main in" --default-rationale "no-force-push standing rule" \
  --reversibility high --link jira=GSL-99 --option "rebase|linear|rewrites" \
  --option "merge main in|no rewrite|bubble")"
[[ "$ID1" =~ ^q-[0-9]{4}-[0-9]{2}-[0-9]{2}-001$ ]] && ok "id format ($ID1)" || bad "id format ($ID1)"
LINE1="$(head -1 "$QUEUE")"
echo "$LINE1" | python3 -c 'import json,sys; r=json.load(sys.stdin); assert r["status"]=="open" and r["type"]=="DECISION" and r["auto_apply_at"] and r["qhash"] and r["links"]["jira"]=="GSL-99" and len(r["options"])==2' \
  && ok "record fields + auto_apply_at default" || bad "record fields + auto_apply_at default"

echo "== dedup: same (task, question) -> seen_by patch =="
DUP="$("$LE" question --type DECISION --from smoke-w2 --task GSL-99 \
  --question "Rebase or merge   main into the epic branch?" --default "merge main in" \
  --reversibility high)"
[[ "$DUP" == "DUPLICATE $ID1" ]] && ok "dedup returns DUPLICATE $ID1" || bad "dedup ($DUP)"
[[ "$(wc -l < "$QUEUE" | tr -d ' ')" == "2" ]] && ok "patch appended, no 2nd question" || bad "line count $(wc -l < "$QUEUE")"
"$LE" list --json | python3 -c 'import json,sys; m=json.loads(sys.stdin.readline()); assert m["seen_by"]==["smoke-w1","smoke-w2"]' \
  && ok "seen_by folded to 2 actors" || bad "seen_by fold"

echo "== per-type statuses =="
ID2="$("$LE" question --type BLOCKER --from smoke --task GSL-98 --question "vercel token expired, no safe default")"
"$LE" question --type CLARIFY --from smoke --task GSL-97 --question "README heading case?" \
  --default "sentence case" --reversibility high >/dev/null
ID4="$("$LE" question --type FYI --from smoke --question "budget 80% crossed")"
[[ "$("$LE" list --count)" == "open=2 (1B/1D/0C/0F) lines=5" ]] && ok "list --count (CLARIFY/FYI not open; lines= census)" || bad "list --count -> $("$LE" list --count)"
"$LE" list --status answered-by-default | grep -q GSL-97 && ok "CLARIFY -> answered-by-default" || bad "CLARIFY status"
"$LE" list --status noted | grep -q "$ID4" && ok "FYI -> noted" || bad "FYI status"

echo "== validation =="
"$LE" question --type DECISION --question "no default given" >/dev/null 2>&1 && bad "DECISION w/o default accepted" || ok "DECISION w/o default rejected"
"$LE" question --type BOGUS --question "x" >/dev/null 2>&1 && bad "bad type accepted" || ok "bad type rejected"
"$LE" answer --re q-0000-00-00-999 --answer x >/dev/null 2>&1 && bad "answer to missing id accepted" || ok "answer to missing id rejected"

echo "== typology guard: irreversible => BLOCKER (never decided by default) =="
"$LE" question --type DECISION --task GSL-1 --question "force-push the epic branch?" \
  --default "force-push it" --reversibility low >/dev/null 2>&1 \
  && bad "DECISION reversibility=low accepted" || ok "DECISION reversibility=low rejected (=> BLOCKER)"
"$LE" question --type CLARIFY --task GSL-1 --question "drop the release tag?" \
  --default "drop it" --reversibility LOW >/dev/null 2>&1 \
  && bad "CLARIFY reversibility=LOW accepted (case bypass)" || ok "CLARIFY reversibility=LOW rejected (case-insensitive)"
"$LE" question --type DECISION --task GSL-1 --question "no reversibility given?" --default "yes" >/dev/null 2>&1 \
  && bad "DECISION w/o --reversibility accepted" || ok "DECISION w/o --reversibility rejected"
"$LE" question --type DECISION --task GSL-1 --question "bogus reversibility?" --default "yes" \
  --reversibility maybe >/dev/null 2>&1 && bad "bogus reversibility accepted" || ok "bogus reversibility rejected"
"$LE" question --type BLOCKER --task GSL-1 --question "rotate the leaked token?" --default "rotate it" >/dev/null 2>&1 \
  && bad "BLOCKER w/ --default accepted" || ok "BLOCKER w/ --default rejected (no default, ever)"
[[ "$(wc -l < "$QUEUE" | tr -d ' ')" == "5" ]] && ok "rejected questions wrote nothing" || bad "queue grew on rejection ($(wc -l < "$QUEUE"))"

echo "== answer patches (a human act is an answer, never an auto-resolve) =="
"$LE" answer --re "$ID1" --answer "merge main in" --by owner --channel telegram >/dev/null \
  && ok "answer appended" || bad "answer failed"
"$LE" answer --re "$ID2" --answer "rotated token via runbook" --by owner --channel terminal >/dev/null \
  && ok "BLOCKER remediated by owner -> answered" || bad "answer (BLOCKER) failed"
[[ "$("$LE" list --count)" == "open=0 (0B/0D/0C/0F) lines=7" ]] && ok "open drained after patches" || bad "open count after patches"
"$LE" list --status answered --json | python3 -c 'import json,sys; m=json.loads(sys.stdin.readline()); assert m["answered_by"]=="owner" and m["channel"]=="telegram"' \
  && ok "answer provenance folded" || bad "answer provenance"

echo "== --due (expired DECISION deadline) =="
ID5="$("$LE" question --type DECISION --from smoke --task GSL-96 --question "expired one?" \
  --default "yes" --reversibility med --auto-apply-at 2020-01-01T00:00:00Z)"
"$LE" list --due | grep -q "$ID5" && ok "--due surfaces expired DECISION" || bad "--due"
"$LE" question --type DECISION --from smoke --task GSL-95 --question "future one?" \
  --default "yes" --reversibility high --auto-apply-at 2999-01-01T00:00:00Z >/dev/null
"$LE" list --due | grep -q GSL-95 && bad "--due leaks future deadline" || ok "--due excludes future deadline"
"$LE" resolve --re "$ID5" --applied "yes" >/dev/null && ok "resolve (deadline hit -> default applied)" || bad "resolve failed"
"$LE" list --due | grep -q "$ID5" && bad "--due still lists an auto-resolved record" || ok "auto-resolved record leaves --due"

echo "== deadline clamp: no default ever applies before 10:00 local (M4) =="
# Freeze "now" into the 22:00–24:00 slice by picking a TZ where the current UTC hour reads 23:xx local.
read -r TZFAKE OFFH <<<"$(python3 - <<'PY'
from datetime import datetime, timezone
off = (23 - datetime.now(timezone.utc).hour) % 24      # local = utc + off  ->  local hour 23
sign = off if off <= 14 else off - 24                  # Etc/GMT-N == UTC+N
print("Etc/GMT%+d" % -sign, sign)
PY
)"
TZ="$TZFAKE" "$LE" question --type DECISION --from smoke --task GSL-94 \
  --question "late-evening fork?" --default "yes" --reversibility high >/dev/null
"$LE" list --task GSL-94 --json | OFFH="$OFFH" python3 -c '
import json, os, sys
from datetime import datetime, timezone, timedelta
r = json.loads(sys.stdin.readline())
loc = datetime.strptime(r["auto_apply_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc) \
      + timedelta(hours=int(os.environ["OFFH"]))
assert (loc.hour, loc.minute) == (10, 0), "%s -> local %s" % (r["auto_apply_at"], loc)' \
  && ok "23:xx DECISION deadline clamped to 10:00 local (not 01:xx, mid-night)" || bad "deadline clamp"

echo "== decision log (GSL-77) =="
DLOG="$GOSLEEP_LAB_DIR/decisions/log.jsonl"
DID1="$("$LE" decision --re "$ID5" --decision "yes" --rule "manifest §2.deadlines")"
[[ "$DID1" =~ ^d-[0-9]{4}-[0-9]{2}-[0-9]{2}-001$ ]] && ok "decision id ($DID1)" || bad "decision id ($DID1)"
tail -1 "$DLOG" | python3 -c 'import json,sys; r=json.load(sys.stdin); assert r["re"] and r["question"]=="expired one?" and r["task"]=="GSL-96" and r["type"]=="DECISION" and r["qshape"] and r["rule"].startswith("manifest §")' \
  && ok "decision pulls queue context via --re" || bad "decision context via --re"
"$LE" decision --decision "no rule given" --question "x?" >/dev/null 2>&1 \
  && bad "orchestrator decision w/o --rule accepted" || ok "orchestrator decision w/o --rule rejected"
"$LE" decision --decision "owner said so" --question "ship it?" --by owner >/dev/null \
  && ok "owner decision w/o rule accepted" || bad "owner decision w/o rule"

echo "== learning loop: candidates (GSL-77) =="
for t in GSL-90 GSL-91 GSL-92; do
  "$LE" decision --decision "regular merge" --task "$t" \
    --question "merge strategy for PR #4$t after main moved?" --rule "manifest §2.merge-strategy" >/dev/null
done
"$LE" candidates | grep -q 'CANDIDATE ×3: "regular merge"' && ok "3× same shape+answer -> candidate" || bad "candidates ×3"
"$LE" candidates --min 4 | grep -q 'regular merge' && bad "--min 4 leaks ×3 group" || ok "--min respected"
"$LE" candidates --json | python3 -c 'import json,sys; rows=[json.loads(l) for l in sys.stdin]; g=[r for r in rows if r["decision"]=="regular merge"][0]; assert g["count"]==3 and len(g["tasks"])==3' \
  && ok "candidates --json (shape folds across tasks/#refs)" || bad "candidates --json"

echo "== append-only discipline =="
[[ "$(head -1 "$QUEUE")" == "$LINE1" ]] && ok "first line never rewritten" || bad "first line changed"
[[ -d "$GOSLEEP_LAB_DIR/questions/.queue.lock" || -d "$GOSLEEP_LAB_DIR/decisions/.log.lock" ]] && bad "lock leaked" || ok "locks released"

echo
echo "RESULT: PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -eq 0 ]]; then rm -rf "$WORK"; exit 0; else echo "(artifacts kept at $WORK)"; exit 1; fi
