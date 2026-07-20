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

echo "== semantic events (GSL-84) =="
EVENTS="$GOSLEEP_LAB_DIR/events"
ev_count() { jq -s --arg t "$1" 'map(select(.type==$t)) | length' "$EVENTS"/*.jsonl 2>/dev/null || echo 0; }

# The whole point of GSL-84: Phase-3 acts land in the timeline with NO change at any call site.
# Everything below was already exercised above — these assertions just check it got MIRRORED.
[[ "$(ev_count question.posed)" -ge 1 ]]     && ok "question -> question.posed (auto-mirrored)"      || bad "question.posed missing"
[[ "$(ev_count question.deduped)" -ge 1 ]]   && ok "dedup    -> question.deduped"                     || bad "question.deduped missing"
[[ "$(ev_count question.answered)" -ge 1 ]]  && ok "answer   -> question.answered"                    || bad "question.answered missing"
[[ "$(ev_count question.auto_resolved)" -ge 1 ]] && ok "resolve -> question.auto_resolved (decided FOR the owner)" || bad "question.auto_resolved missing"
[[ "$(ev_count decision.made)" -ge 1 ]]      && ok "decision -> decision.made"                        || bad "decision.made missing"

ESEQ="$("$LE" event --type cycle.started --actor smoke-w1 --task GSL-84 --data cycle=45 --data branch=x)"
[[ "$ESEQ" =~ ^[0-9]+$ ]] && ok "event prints the allocated seq ($ESEQ)" || bad "event seq ($ESEQ)"
jq -s -e 'map(select(.type=="cycle.started"))[0] | .src=="emit" and .actor=="smoke-w1" and .task=="GSL-84" and .data.cycle=="45"' "$EVENTS"/*.jsonl >/dev/null \
  && ok "event envelope: src=emit + actor + task + data" || bad "event envelope"
"$LE" event --type cycle.startd --actor x >/dev/null 2>&1 && bad "typo'd semantic type accepted" || ok "typo'd semantic type rejected (an event nobody reads is worse than an error)"
"$LE" event --type verify.verdict --actor reviewer --data-json '{"verdict":"PASS","findings":0}' >/dev/null \
  && ok "event --data-json" || bad "event --data-json"
"$LE" help | grep -q 'event ' && ok "help lists the event subcommand" || bad "help"

jq -c . "$EVENTS"/*.jsonl >/dev/null 2>&1 && ok "every event line is valid JSON" || bad "corrupt events jsonl"
jq -s -e 'map(.seq) == [range(1; length+1)]' "$EVENTS"/*.jsonl >/dev/null \
  && ok "seq monotonic 1..N across BOTH writers (one allocator)" || bad "seq not monotonic"

echo "== append-only discipline =="
[[ "$(head -1 "$QUEUE")" == "$LINE1" ]] && ok "first line never rewritten" || bad "first line changed"
[[ -d "$GOSLEEP_LAB_DIR/questions/.queue.lock" || -d "$GOSLEEP_LAB_DIR/decisions/.log.lock" ]] && bad "lock leaked" || ok "locks released"
[[ -d "$EVENTS/.events.lock" ]] && bad "events lock leaked" || ok "events lock released"

echo "== write discipline under concurrency (GSL-85) =="
LL="$SCRIPT_DIR/lab-log.sh"
LW="$SCRIPT_DIR/lab-write.sh"

# GSL-84 acceptance, verbatim from Jira: "переживает конкурентную запись (несколько воркеров пишут
# одновременно — ни одной битой строки)". A fleet writes from 3+ panes at once; interleaved appends
# are the normal case, not the edge case.
CONC="$WORK/conc"; mkdir -p "$CONC"
BEFORE="$(cat "$EVENTS"/*.jsonl 2>/dev/null | wc -l | tr -d ' ')"
for i in $(seq 1 20); do
  ( "$LL" --type cycle.started --actor "w$i" --data "n=$i" --quiet >/dev/null 2>&1 ) &
done
wait
AFTER="$(cat "$EVENTS"/*.jsonl 2>/dev/null | wc -l | tr -d ' ')"
[[ $((AFTER - BEFORE)) -eq 20 ]] && ok "20 concurrent writers -> exactly 20 lines (none lost)" || bad "concurrent append lost lines ($((AFTER-BEFORE))/20)"
jq -c . "$EVENTS"/*.jsonl >/dev/null 2>&1 && ok "20 concurrent writers -> no torn line (all valid JSON)" || bad "torn line under concurrency"
jq -s -e 'map(.seq) | (length == (unique | length))' "$EVENTS"/*.jsonl >/dev/null \
  && ok "seq unique under concurrency (lock holds)" || bad "duplicate seq — the lock does not hold"

# Atomicity of NON-append artifacts: rename(2) replaces the file, it never truncates in place.
# The inode CHANGING is the deterministic signature of that — a `>` redirect would keep it.
printf '{"a":1}' | "$LW" --json "$CONC/status.json" && ok "lab-write writes" || bad "lab-write failed"
INO1="$(stat -f %i "$CONC/status.json")"
printf '{"a":2,"padding":"%s"}' "$(printf 'x%.0s' {1..5000})" | "$LW" --json "$CONC/status.json"
INO2="$(stat -f %i "$CONC/status.json")"
[[ "$INO1" != "$INO2" ]] && ok "atomic: rewrite REPLACES the file (inode $INO1 -> $INO2), never truncates in place" \
                         || bad "atomic: inode unchanged — this is a torn-read waiting to happen"

# And the behavioural half: hammer it while reading. A reader must never catch a prefix.
( for i in $(seq 1 60); do printf '{"i":%d,"pad":"%s"}' "$i" "$(printf 'y%.0s' {1..2000})" | "$LW" "$CONC/status.json"; done ) &
WPID=$!
TORN=0
for i in $(seq 1 60); do jq -e . "$CONC/status.json" >/dev/null 2>&1 || TORN=$((TORN+1)); done
wait $WPID
[[ "$TORN" -eq 0 ]] && ok "60 rewrites under a concurrent reader -> 0 torn reads" || bad "$TORN torn reads"

printf 'not json' | "$LW" --json "$CONC/bad.json" >/dev/null 2>&1 \
  && bad "--json accepted invalid JSON (a corrupt status.json breaks every consumer)" \
  || ok "--json refuses to publish invalid JSON"
[[ -z "$(find "$CONC" -name '.*.tmp' 2>/dev/null)" ]] && ok "no temp files left behind" || bad "temp files leaked"

# The GSL-85 acceptance, verbatim from Jira: "убийство писателя посередине не оставляет torn-write
# (файл либо старый целый, либо новый целый)". The chronicler runs under a hard budget cap — being
# killed mid-write is its NORMAL death, not an exotic one. Stated as a size law, so it cannot flake:
# whatever the axe timing, the file is one of exactly two sizes — never a prefix in between.
K="$CONC/killed.json"
printf '{"generated_at":"OLD"}' | "$LW" --json "$K"
OLDSZ="$(wc -c < "$K" | tr -d ' ')"
python3 -c "import json,sys; sys.stdout.write(json.dumps({'generated_at':'NEW','pad':'z'*40000000}))" > "$CONC/big.json"
NEWSZ="$(wc -c < "$CONC/big.json" | tr -d ' ')"
"$LW" "$K" < "$CONC/big.json" & KPID=$!
sleep 0.05; kill -9 $KPID 2>/dev/null; wait $KPID 2>/dev/null
GOTSZ="$(wc -c < "$K" | tr -d ' ')"
jq -e . "$K" >/dev/null 2>&1 && { [[ "$GOTSZ" == "$OLDSZ" || "$GOTSZ" == "$NEWSZ" ]]; } \
  && ok "kill -9 mid-write -> target is the WHOLE old file or the WHOLE new one ($GOTSZ B), never a prefix" \
  || bad "torn write after kill -9: got $GOTSZ B (old=$OLDSZ new=$NEWSZ)"

# kill -9 leaves no chance to clean up, so the corpse's temp stays. The next pass must sweep it —
# otherwise a killed chronicler litters docs/lab/ forever.
touch -t 202001010000 "$CONC/.killed.json.corpse.tmp"
printf '{"generated_at":"NEXT-PASS"}' | "$LW" --json "$K"
[[ -z "$(find "$CONC" -name '.killed.json.*.tmp' 2>/dev/null)" ]] \
  && ok "the next write sweeps a killed writer's leftover temp" || bad "stale temp survives"

echo "== chronicler: the T3 regenerator (GSL-86) =="
CH="$SCRIPT_DIR/chronicler.sh"
bash -n "$CH" && ok "chronicler.sh: bash -n" || bad "chronicler.sh: bash -n"
python3 -c "import ast; ast.parse(open('$SCRIPT_DIR/chronicler.py').read())" 2>/dev/null \
  && ok "chronicler.py: parses" || bad "chronicler.py: syntax error"

# C1 (F4-S4): the chronicler must hold no key. It rides the subscription or it does not run.
grep -qEi 'api[_-]?key|ANTHROPIC_API|sk-ant|bearer' "$SCRIPT_DIR/chronicler.py" \
  && bad "C1: an API key appears in chronicler.py" || ok "C1/F4-S4: zero API keys in the chronicler"
# C3/F4-S4: when it DOES call the LLM, the call is bounded and toolless — both, or neither counts.
grep -q -- '--max-budget-usd' "$SCRIPT_DIR/chronicler.py" \
  && grep -q -- '--allowedTools' "$SCRIPT_DIR/chronicler.py" \
  && ok "C3/F4-S4: claude -p is bounded (--max-budget-usd) and toolless (--allowedTools empty)" \
  || bad "C3/F4-S4: the narrator call is not bounded/toolless"
# C5: a bounded job, not the fourth live agent. It must not know how to take a pane at all.
#
# The denylist guards a CAPABILITY, not a vocabulary — and GSL-98 is where the difference started to
# matter. The only place the event log writes a worker's NAME is the key `data.raw.teammate_name`, so
# a Fleet screen with cards on it cannot be built without that literal appearing in the chronicler.
# Reading a key out of an append-only JSON log is not the power to take a pane, so that ONE literal is
# exempt — and nothing else is. Every other form of every denied word, `teammate` bare included, still
# fails. What was NOT done is worth recording: the verb for creating a worker keeps no exemption at
# all, because there a rename was free (the card's field is `started_ts`, after the log's own
# `pane.started`), and a capability word must never be weakened when a rename would do.
#
# A safety check whose exemption can quietly widen is a safety check that is already dead, so the
# boundary is itself under test below (C5-narrow) rather than resting on this comment.
c5_takes_a_pane() {                     # 0 = violates, 1 = clean
  sed -E 's/teammate_name//g' "$1" | grep -qEi 'tmux|spawn|Agent tool|teammate'
}
c5_takes_a_pane "$SCRIPT_DIR/chronicler.py" \
  && bad "C5: the chronicler can take a pane" || ok "C5: no tmux/spawn — it cannot hold a pane slot"

# C5-narrow (GSL-98): the exemption above is one literal wide, and this proves it — in CI, on every
# run, not once by hand in the cycle that introduced it. Three fixtures: the key must pass, and the
# two things the key must never be a doorway for must still fail.
C5FX="$WORK/c5"; mkdir -p "$C5FX"
printf 'nm = raw.get("teammate_name")\n'   > "$C5FX/key.py"
printf 'emit("teammate.spawned", pane)\n'  > "$C5FX/verb.py"
printf '# hand the teammate a pane\n'      > "$C5FX/bare.py"
c5_takes_a_pane "$C5FX/key.py" \
  && bad "C5-narrow: the exempt key is rejected — the Fleet cards cannot read a worker's name" \
  || ok "C5-narrow: data.raw.teammate_name (a read-only log key) passes"
c5_takes_a_pane "$C5FX/verb.py" \
  && ok "C5-narrow: the exemption is not a doorway — 'teammate.spawned' still fails" \
  || bad "C5-narrow: BROKEN — the exemption now lets the create-a-worker verb through"
c5_takes_a_pane "$C5FX/bare.py" \
  && ok "C5-narrow: a bare 'teammate' still fails — only the compound key is exempt" \
  || bad "C5-narrow: BROKEN — the exemption widened from a key to the whole word"

# Everything below runs against a THROWAWAY lab (its own --repo), never the live one.
CR="$WORK/chron-repo"; mkdir -p "$CR/docs/lab/events" "$CR/docs/lab/questions" "$CR/docs/lab/decisions"
: > "$CR/docs/lab/questions/queue.jsonl"; : > "$CR/docs/lab/decisions/log.jsonl"
TODAY="$(date -u +%F)"
OLD_DAY="$(python3 -c "import datetime;print((datetime.date.today()-datetime.timedelta(days=45)).isoformat())")"
# One event 20 hours old (so the page must grade itself DEAD), plus one superseded pair.
STALE_TS="$(python3 -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(hours=20)).strftime('%Y-%m-%dT%H:%M:%SZ'))")"
{ printf '{"ts":"%s","run_id":"%s","seq":1,"actor":"w1","type":"vcs.commit","src":"hook:PostToolUse","data":{"sha":"c0ffee1"}}\n' "$STALE_TS" "$TODAY"
  printf '{"ts":"%s","run_id":"%s","seq":2,"actor":"w1","type":"vcs.commit","src":"hook:PostToolUse","data":{"sha":"WRONG"}}\n' "$STALE_TS" "$TODAY"
  printf '{"ts":"%s","run_id":"%s","seq":3,"actor":"w1","type":"vcs.commit","src":"poll-fill","supersedes":2,"data":{"sha":"c0ffee2"}}\n' "$STALE_TS" "$TODAY"
} > "$CR/docs/lab/events/$TODAY.jsonl"
printf '{"ts":"%sT10:00:00Z","run_id":"%s","seq":1,"actor":"old","type":"pane.started","src":"hook:SessionStart","data":{}}\n' "$OLD_DAY" "$OLD_DAY" \
  > "$CR/docs/lab/events/$OLD_DAY.jsonl"

# --dry-run must be exactly that: a plan, not a write.
bash "$CH" --repo "$CR" --no-poll --dry-run --quiet --json >/dev/null 2>&1
[[ ! -f "$CR/docs/lab/status.json" ]] && ok "--dry-run writes nothing" || bad "--dry-run wrote status.json"

RPT="$(bash "$CH" --repo "$CR" --no-poll --quiet --json 2>/dev/null)"
jq -e . "$CR/docs/lab/status.json" >/dev/null 2>&1 \
  && ok "status.json is valid JSON" || bad "status.json does not parse"
[[ -n "$(jq -r '.generated_at // empty' "$CR/docs/lab/status.json")" ]] \
  && ok "status.json carries generated_at" || bad "status.json has no generated_at"

# F4-S3, the whole point: a dead laboratory must LOOK dead. 20h-old events => grade dead, everywhere.
[[ "$(jq -r .staleness.grade "$CR/docs/lab/status.json")" == "dead" ]] \
  && ok "F4-S3: 20h-old events -> status.json grades itself DEAD" || bad "F4-S3: stale data graded fresh"
for P in index timeline library; do
  grep -q 'class="stale dead"' "$CR/docs/lab/site/$P.html" \
    && ok "F4-S3: site/$P.html shows the DEAD banner" || bad "F4-S3: site/$P.html hides its staleness"
  grep -q 'id="stale-verdict"' "$CR/docs/lab/site/$P.html" \
    && ok "F4-S3: site/$P.html's verdict prose is addressable, so it can be re-graded too" \
    || bad "F4-S3: site/$P.html bakes its verdict prose (a DEAD banner over 'Live' text)"
done
# The banner is not the only thing that speaks. The SENTENCE under it was baked at build time and never
# re-graded — so a page opened hours later carried a red DEAD banner with "Live — the laboratory is
# writing itself right now" printed beneath it (REVIEW-gsl81 M1). Asserting the mechanism (an id, a
# <script>) is what let 119/119 stay green while the page contradicted itself, so assert the RENDERED
# verdict instead. It must be read out of the SPAN, never grepped from the file: the JS necessarily
# carries all three verdicts (that is how it re-grades), so "Live" appears in any page's source.
#
# GSL-92 moved the view layer to TypeScript, and with it the verdict map: it used to be a `var V = {…}`
# emitted into a hand-written <script>, and it is now a JSON data island the SSG renders beside the
# client bundle (tools/lab/ui/src/page.tsx). The MECHANISM changed; the assertion did not, and must
# not — the island is still the ONE source both the server-rendered prose and the client re-grade read
# from, which is the property that stops them drifting into two opinions about one grade.
V="$(python3 - "$CR/docs/lab/site/index.html" <<'PY'
import json, re, sys
h = open(sys.argv[1], encoding="utf-8").read()
prose = re.search(r'<span id="stale-verdict">(.*?)</span>', h, re.S)
prose = prose.group(1).strip() if prose else ""
isl   = re.search(r'<script id="verdicts" type="application/json">(.*?)</script>', h, re.S)
vmap  = json.loads(isl.group(1)) if isl else {}
ok1 = prose.startswith("DEAD") and "Live" not in prose
ok2 = 'getElementById("stale-verdict")' in h and set(vmap) == {"fresh", "stale", "dead"}
print(("PROSE_OK" if ok1 else "PROSE_BAD") + " " + ("REGRADE_OK" if ok2 else "REGRADE_BAD"))
PY
)"
[[ "$V" == PROSE_OK* ]] \
  && ok "F4-S3: the DEAD page's verdict PROSE says DEAD — it never reads 'Live' under a red banner (M1)" \
  || bad "F4-S3: the page contradicts itself — DEAD banner, 'Live' prose"
[[ "$V" == *REGRADE_OK ]] \
  && ok "F4-S3: the prose re-grades on open too (JS rewrites #stale-verdict from all three verdicts)" \
  || bad "F4-S3: the JS re-grades the banner but leaves the prose frozen at build time"
grep -q 'generated_at' "$CR/docs/lab/site/index.html" \
  && ok "every page carries generated_at (R4.4)" || bad "page has no generated_at"
# A static file cannot age itself: the baked-in grade judges the DATA at BUILD time. A chronicler that
# dies at 02:00 while all is fresh would leave a page reading "Live" forever — the stale hub that hides
# its staleness, which is the one thing F4-S3 exists to prevent. So the banner re-grades when opened,
# from generated_at + the event age it carries, and can only ever make the verdict WORSE (GSL-89).
for M in 'id="staleness"' 'data-generated-at' 'data-event-age-s' '<script>'; do
  grep -q -- "$M" "$CR/docs/lab/site/index.html" || { bad "F4-S3: page cannot re-grade itself (no $M)"; continue; }
done
grep -q 'id="staleness"' "$CR/docs/lab/site/index.html" && grep -q 'data-event-age-s' "$CR/docs/lab/site/index.html" \
  && grep -q '<script>' "$CR/docs/lab/site/index.html" \
  && ok "F4-S3: the page re-grades its own staleness on open (a frozen 'Live' verdict is the failure)" \
  || bad "F4-S3: the verdict freezes at build time"
# Self-contained: the owner opens it from file://, on a plane, with no CDN in reach.
grep -qE 'https?://(cdn|fonts|unpkg|cdnjs)' "$CR/docs/lab/site/index.html" \
  && bad "site/ pulls an external resource (file:// would break)" \
  || ok "site/ is self-contained (no CDN/font/script fetches)"

# ───────────────────── GSL-92: the TypeScript view layer ─────────────────────
#
# The renderer moved from chronicler.py to tools/lab/ui/ (Preact, server-rendered by esbuild). The
# tests above are the CONTRACT it inherited — every id, every data-* attribute, every verdict — and
# they are asserted against the TS output unchanged. What follows is what the move itself introduced.

# THE POSITIVE CONTROL, and it is not a formality. Above, C8 is asserted by grepping for a sha that
# must be ABSENT ("WRONG"). A renderer that rendered NOTHING AT ALL would sail through that — and
# through the two cross-day fold assertions at the bottom of this file — leaving three green ticks
# over a blank page. So: prove a LIVE sha is on the timeline before trusting that a dead one is not.
grep -q 'c0ffee2' "$CR/docs/lab/site/timeline.html" \
  && ok "the timeline renders a live event's detail (so the absence-greps below mean something)" \
  || bad "the timeline renders no event details at all — every 'superseded event is gone' test above is vacuous"

# The ONE contract between the data layer and the view layer. If this is not valid JSON the pages
# cannot have been built from it, whatever they say. The renderer THROWS on a schema it does not
# know (tools/lab/ui/src/render.tsx) rather than rendering blank cards — so this string is load-
# bearing on both sides, and bumping it is a two-file change, on purpose.
jq -e '.schema == "gosleep.lab.render/7"' "$CR/docs/lab/render_bundle.json" >/dev/null 2>&1 \
  && ok "GSL-92: render_bundle.json is valid and carries its schema" \
  || bad "GSL-92: render_bundle.json missing/invalid/unversioned"
# GSL-99: self_health is MANDATORY in the bundle. An anti-rot alarm a producer can silently stop
# emitting is an alarm that rots — so its absence is a build failure, not an empty card.
jq -e '.self_health.dev_history and .self_health.handoffs and .self_health.generated_at' \
  "$CR/docs/lab/render_bundle.json" >/dev/null 2>&1 \
  && ok "GSL-99: the bundle carries self_health (mandatory in render/7 — a rotting alarm is no alarm)" \
  || bad "GSL-99: render/7 bundle has no self_health block"
[[ "$(jq -r '.ui.ok' "$CR/docs/lab/status.json")" == "true" ]] \
  && ok "GSL-92: status.json records that the view layer built" \
  || bad "GSL-92: status.json does not record the render outcome (ui.ok=$(jq -r '.ui.ok' "$CR/docs/lab/status.json"))"

# node is handed stdin and stdout and NOTHING ELSE. Every byte that lands in the repo goes through
# lab-write.sh (temp + rename), so a renderer killed halfway through page five cannot leave a torn
# dashboard behind. A writeFile in build.mjs would quietly take that guarantee away.
grep -qE '\bwriteFile|\bcreateWriteStream|\bappendFile' "$SCRIPT_DIR/ui/build.mjs" \
  && bad "GSL-92: the renderer writes to the filesystem (it must be a pure stdin->stdout function)" \
  || ok "GSL-92: the renderer touches no file — Python writes every page through lab-write.sh"

# DEGRADE WITHOUT NODE (the whole reason node was allowed in at all). A laboratory whose dashboard
# needs a toolchain that may not be there has bought a new way to die at 03:00 — unless it cannot
# die. Strip node from PATH and the chronicler must: still exit 0, still write status.json and the
# digest, leave the (now stale) pages exactly where they were, and say so ON EVERY PAGE.
NN="$WORK/chron-nonode"; mkdir -p "$NN/docs/lab/events"
printf '{"ts":"%s","run_id":"%s","seq":1,"actor":"w1","type":"vcs.commit","src":"hook:PostToolUse","data":{"sha":"n0denix"}}\n' \
  "$STALE_TS" "$TODAY" > "$NN/docs/lab/events/$TODAY.jsonl"
bash "$CH" --repo "$NN" --no-poll --quiet --json >/dev/null 2>&1          # a good build first
GOOD_AT="$(jq -r '.ui.last_success_at' "$NN/docs/lab/status.json")"
grep -q 'n0denix' "$NN/docs/lab/site/timeline.html" \
  && ok "GSL-92: the good build rendered the event (baseline for the degrade test)" \
  || bad "GSL-92: the baseline build rendered nothing"

NOJSON="$(env PATH="/usr/bin:/bin:/usr/sbin:/sbin" bash "$CH" --repo "$NN" --no-poll --quiet --json 2>/dev/null)"
echo "$NOJSON" | jq -e '.ok == true' >/dev/null 2>&1 \
  && ok "GSL-92: no node -> the chronicler still exits ok (degraded, never fatal)" \
  || bad "GSL-92: a missing node killed the chronicler"
[[ "$(echo "$NOJSON" | jq -r '.ui.reason')" == "no-node" ]] \
  && ok "GSL-92: the reason is named (no-node), not swallowed" \
  || bad "GSL-92: the render failure has no machine-readable reason"
NOK=0
for P in index timeline library; do
  grep -q 'class="ui-degraded"' "$NN/docs/lab/site/$P.html" || NOK=1
  grep -q "last successful build: $GOOD_AT" "$NN/docs/lab/site/$P.html" || NOK=1
done
[[ $NOK -eq 0 ]] \
  && ok "GSL-92: every stale page carries the banner AND names its last successful build" \
  || bad "GSL-92: a page that could not be rebuilt does not say so (a false-fresh page is the failure)"
grep -q 'n0denix' "$NN/docs/lab/site/timeline.html" \
  && ok "GSL-92: the un-rebuilt pages are PRESERVED, not blanked (stale-and-honest beats empty)" \
  || bad "GSL-92: the degrade path destroyed the pages it could not rebuild"
[[ "$(jq -r '.staleness.grade' "$NN/docs/lab/status.json")" != "null" ]] \
  && ok "GSL-92: the DATA layer is unaffected by a missing node (status.json still regenerated)" \
  || bad "GSL-92: no node took the data layer down with it"

# ...and the banner must LEAVE when it stops being true. A warning that outlives its cause is a
# warning the owner learns to scroll past.
bash "$CH" --repo "$NN" --no-poll --quiet --json >/dev/null 2>&1
BOK=0
for P in index timeline library; do grep -q 'class="ui-degraded"' "$NN/docs/lab/site/$P.html" && BOK=1; done
[[ $BOK -eq 0 ]] \
  && ok "GSL-92: node comes back -> the banner is gone (the injection is idempotent both ways)" \
  || bad "GSL-92: the degrade banner outlived the degradation"

# A clone that has NEVER had node has no stale page to stamp. "File not found" teaches the owner
# nothing; a page that names the one command to run teaches him everything.
FRESH="$WORK/chron-nonode-fresh"; mkdir -p "$FRESH/docs/lab/events"
printf '{"ts":"%s","run_id":"%s","seq":1,"actor":"w1","type":"cycle.started","src":"emit","data":{}}\n' \
  "$STALE_TS" "$TODAY" > "$FRESH/docs/lab/events/$TODAY.jsonl"
env PATH="/usr/bin:/bin:/usr/sbin:/sbin" bash "$CH" --repo "$FRESH" --no-poll --quiet --json >/dev/null 2>&1
grep -q 'class="ui-degraded"' "$FRESH/docs/lab/site/index.html" 2>/dev/null \
  && grep -q 'npm install' "$FRESH/docs/lab/site/index.html" \
  && ok "GSL-92: a never-built clone gets an honest placeholder naming the fix, not a 404" \
  || bad "GSL-92: a clone without node leaves the owner with no index.html at all"

# ───────────── GSL-93: the data contract + the seven screens (PRD R5.2) ─────────────

# Seven screens, one nav, no dead links. A nav entry pointing at a page nobody built is a 404 on a
# phone at 03:00 — the dashboard's first lie about itself.
S7=0
for P in index timeline tasks questions fleet cost library; do
  [[ -f "$CR/docs/lab/site/$P.html" ]] || { S7=1; break; }
done
[[ $S7 -eq 0 ]] && ok "GSL-93/R5.2: all seven screens are generated" \
  || bad "GSL-93/R5.2: a screen listed in the nav was never built"
NAVBAD=0
for P in index timeline tasks questions fleet cost library; do
  for L in index timeline tasks questions fleet cost library; do
    grep -q "href=\"$L.html\"" "$CR/docs/lab/site/$P.html" || NAVBAD=1
  done
done
[[ $NAVBAD -eq 0 ]] && ok "GSL-93: every screen links to every other (no dead nav entry)" \
  || bad "GSL-93: the nav points at a page that does not exist"

# The contract carries all seven domains. A screen whose domain is missing renders a blank card, and
# a blank card at 03:00 is indistinguishable from "nothing happened".
for D in events queue tasks fleet cost library decisions; do
  jq -e "has(\"$D\")" "$CR/docs/lab/render_bundle.json" >/dev/null 2>&1 \
    || { bad "GSL-93: the render bundle has no '$D' domain"; NOD=1; }
done
[[ -z "${NOD:-}" ]] && ok "GSL-93: the bundle carries all seven domains (events/queue/tasks/fleet/cost/library/decisions)"

# UNKNOWN IS NOT ZERO. This throwaway lab has no heartbeat, so the live worker count is unreadable.
# It must render as `unknown`, never as 0 — "nobody is working" and "I cannot see who is working" are
# different sentences, and a dashboard that says the first when it means the second is the reason
# Phase 4 spent a whole cycle on this.
[[ "$(jq -r '.fleet.open_workers' "$CR/docs/lab/render_bundle.json")" == "null" \
   && "$(jq -r '.fleet.known' "$CR/docs/lab/render_bundle.json")" == "false" ]] \
  && ok "GSL-93: no heartbeat -> the worker count is null (unknown), not 0" \
  || bad "GSL-93: a missing heartbeat was rendered as a fleet of zero"
grep -q 'class="unknown"' "$CR/docs/lab/site/fleet.html" \
  && ok "GSL-93: the Fleet screen renders the missing count as 'unknown', not as a number" \
  || bad "GSL-93: the Fleet screen invented a number it does not have"
grep -q 'cannot see' "$CR/docs/lab/site/fleet.html" \
  && ok "GSL-93: the Fleet screen names its own blind spots (no pane id, no model in the log)" \
  || bad "GSL-93: the Fleet screen hides what it cannot see"

# The token ceiling does not exist on disk (manifest §5.phase-ceiling delegates it to an epic brief,
# and no brief names a number). The Cost screen must SAY that, not pick a plausible cap — a made-up
# ceiling makes the budget clock finite, and a finite lie is worse than an honest unknown.
[[ "$(jq -r '.cost.ceiling' "$CR/docs/lab/render_bundle.json")" == "null" ]] \
  && ok "GSL-93: no ceiling on disk -> cost.ceiling is null, not a guess" \
  || bad "GSL-93: a token ceiling was invented"
grep -q 'no token ceiling on disk' "$CR/docs/lab/site/cost.html" \
  && ok "GSL-93: the Cost screen says the ceiling is missing, in words" \
  || bad "GSL-93: the Cost screen hides that it has a numerator and no denominator"
GOSLEEP_TOKEN_CEILING=1000000 bash "$CH" --repo "$CR" --no-poll --quiet --json >/dev/null 2>&1
[[ "$(jq -r '.cost.ceiling' "$CR/docs/lab/render_bundle.json")" == "1000000" ]] \
  && ok "GSL-93: a ceiling IS honoured when one is supplied (GOSLEEP_TOKEN_CEILING)" \
  || bad "GSL-93: the ceiling override is ignored"
bash "$CH" --repo "$CR" --no-poll --quiet --json >/dev/null 2>&1     # back to the honest default

# ───────────────── GSL-98: the worker cards, and the model that cannot lie ─────────────────
#
# Its own throwaway repo, because these assertions need a fleet with a KNOWN shape and the lab above
# is shared. Three workers, one of each state, plus a fourth session the log can never name:
#
#   alpha  pane.started + task.completed + a recent event, no pane.ended   -> active
#   beta   same, but last heard from 3h ago and never ended                -> SILENT (not dead)
#   gamma  pane.started + task.completed + pane.ended                      -> ended
#   (s4)   events, but no task.completed -> no name -> no card, counted as unnamed
#
# THE EVENT LOG DELIBERATELY LIES, TWICE, and the two lies are different on purpose — a self-report
# can leak onto the card by two distinct routes and one fixture must catch both:
#
#   alpha  claims claude-haiku-4-5; its transcript says claude-opus-4-8   -> catches a PREFERENCE leak
#          (code that reads the declaration when the truth is sitting right there)
#   gamma  claims claude-sonnet-5; it has NO transcript at all            -> catches a FALLBACK leak
#          (code that shrugs and believes the worker when the truth is missing)
#
# The second is here because the first mutation run PROVED the test slept without it: with gamma
# silent about its model, a fallback-to-self-report regression sailed through green. Cycles 49/50 are
# what this guards — the worker's word is precisely the source this card may not trust — so the
# assertions are two-sided: the transcript's model must be ON the card, gamma must read `unknown`, and
# NEITHER claimed model may appear anywhere on the page.
FL="$WORK/f5-fleet"; mkdir -p "$FL/docs/lab/events" "$FL/docs/lab/questions" "$FL/docs/lab/decisions" \
                              "$FL/docs/handoff" "$FL/transcripts"
: > "$FL/docs/lab/questions/queue.jsonl"; : > "$FL/docs/lab/decisions/log.jsonl"
S1=aaaaaaaa-0000-0000-0000-000000000001; S2=bbbbbbbb-0000-0000-0000-000000000002
S3=cccccccc-0000-0000-0000-000000000003; S4=dddddddd-0000-0000-0000-000000000004
fl_ts() { python3 -c "import datetime,sys;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=int(sys.argv[1]))).strftime('%Y-%m-%dT%H:%M:%SZ'))" "$1"; }
T_NOW=$(fl_ts 2); T_OLD=$(fl_ts 180); T_START=$(fl_ts 240)
{ printf '{"ts":"%s","run_id":"%s","seq":1,"actor":"claude","type":"pane.started","src":"hook:SessionStart","session_id":"%s","data":{}}\n' "$T_START" "$TODAY" "$S1"
  printf '{"ts":"%s","run_id":"%s","seq":2,"actor":"claude","type":"task.completed","src":"hook:TaskCompleted","session_id":"%s","data":{"raw":{"teammate_name":"alpha","task_subject":"Card the fleet","model_self_report":"claude-haiku-4-5"}}}\n' "$T_START" "$TODAY" "$S1"
  printf '{"ts":"%s","run_id":"%s","seq":3,"actor":"claude","type":"agent.turn_ended","src":"hook:Stop","session_id":"%s","data":{}}\n' "$T_NOW" "$TODAY" "$S1"
  printf '{"ts":"%s","run_id":"%s","seq":4,"actor":"claude","type":"pane.started","src":"hook:SessionStart","session_id":"%s","data":{}}\n' "$T_START" "$TODAY" "$S2"
  printf '{"ts":"%s","run_id":"%s","seq":5,"actor":"claude","type":"task.completed","src":"hook:TaskCompleted","session_id":"%s","data":{"raw":{"teammate_name":"beta","task_subject":"Go quiet"}}}\n' "$T_OLD" "$TODAY" "$S2"
  printf '{"ts":"%s","run_id":"%s","seq":6,"actor":"claude","type":"pane.started","src":"hook:SessionStart","session_id":"%s","data":{}}\n' "$T_START" "$TODAY" "$S3"
  printf '{"ts":"%s","run_id":"%s","seq":7,"actor":"claude","type":"task.completed","src":"hook:TaskCompleted","session_id":"%s","data":{"raw":{"teammate_name":"gamma","task_subject":"Finish and leave","model_self_report":"claude-sonnet-5"}}}\n' "$T_OLD" "$TODAY" "$S3"
  printf '{"ts":"%s","run_id":"%s","seq":8,"actor":"claude","type":"pane.ended","src":"hook:SessionEnd","session_id":"%s","data":{"reason":"other"}}\n' "$T_OLD" "$TODAY" "$S3"
  printf '{"ts":"%s","run_id":"%s","seq":9,"actor":"claude","type":"agent.turn_ended","src":"hook:Stop","session_id":"%s","data":{}}\n' "$T_NOW" "$TODAY" "$S4"
} > "$FL/docs/lab/events/$TODAY.jsonl"
# alpha: the truth. beta: TWO models in one session — a mid-session switch, which the card must show
# rather than average away. gamma: no transcript at all -> unknown, and never a default.
printf '{"message":{"model":"claude-opus-4-8"}}\n{"message":{"model":"claude-opus-4-8"}}\n' > "$FL/transcripts/$S1.jsonl"
printf '{"message":{"model":"claude-opus-4-8"}}\n{"message":{"model":"claude-fable-5"}}\n{"message":{"model":"claude-opus-4-8"}}\n' > "$FL/transcripts/$S2.jsonl"
# The ledger. `zeta` names a worker no card can match — one worker under two hand-typed names, which
# is the join failure the Fleet screen has to surface instead of printing a confident zero.
cat > "$FL/docs/handoff/ORCHESTRATION-STATE.md" <<'STATE'
## TELEMETRY

- `cycle=1 worker=alpha model=claude-opus-4-8 tokens_out=1000 tokens_in=500 cache_read=10 | running: cycles=1 total≈1000`
- `cycle=2 worker=beta model=claude-opus-4-8 tokens_out=2000 tokens_in=600 cache_read=20 | running: cycles=2 total≈3000`
- `cycle=3 worker=zeta model=claude-fable-5 tokens_out=4000 tokens_in=700 cache_read=30 | running: cycles=3 total≈7000`
- `cycle=4 worker=zeta model=claude-fable-5 tokens_out=est-unavailable | running: cycles=9 total≈7000`

## NEXT
STATE
FLB="$FL/docs/lab/render_bundle.json"; FLH="$FL/docs/lab/site/fleet.html"
GOSLEEP_TRANSCRIPT_DIR="$FL/transcripts" bash "$CH" --repo "$FL" --no-poll --quiet --json >/dev/null 2>&1

# ⭐ The card exists at all, and the AGE is its headline. Asserted on the MECHANISM — the element that
# carries the age is `.wk-age`, and it must be inside the card, not in a footnote somewhere.
[[ "$(jq -r '.fleet.workers | length' "$FLB")" == "3" ]] \
  && ok "GSL-98: three named sessions -> three worker cards (the fourth is nameless and gets none)" \
  || bad "GSL-98: wrong card count ($(jq -r '.fleet.workers | length' "$FLB") — want 3)"
grep -q 'class="wk-age"' "$FLH" \
  && ok "GSL-98: the card leads with the last-event age (.wk-age is rendered)" \
  || bad "GSL-98: the card does not render the age element — the headline field of the screen is missing"

# ⭐ AND THAT AGE KEEPS AGING (review M3). The whole subject of this screen is how long ago a worker
# was last heard from, and site/README.md promises in writing that the ages on Tasks/Fleet tick. The
# ticker (client.ts: tickAges) selects on `[data-age-ts]` and on NOTHING else, so an age rendered as
# plain build-time text is frozen: a worker drawn `silent 12m` and read three hours later still says
# 12m. That is wrong in the REASSURING direction, on the one screen the owner opens to ask whether
# his fleet is alive — which is the exact failure class this phase exists to refuse.
#
# Asserted on the MECHANISM, not on a rendered string: every worker's own `last_ts` must appear as
# the `data-age-ts` of an `.age` span INSIDE that worker's `.wk-age` block (position-matched, so a
# stray attribute elsewhere on the page cannot satisfy it), and likewise for every roster row. The
# counts travel with the verdict so that "MISSING=0" can never pass by finding nothing to check.
FL_TICK="$(python3 - "$FLH" "$FLB" <<'PY'
import json, re, sys
html = open(sys.argv[1], encoding="utf-8").read()
b = json.load(open(sys.argv[2], encoding="utf-8"))["fleet"]

# The age element inside each card, in render order, paired with the worker it belongs to.
cards = re.findall(r'<div class="wk-age"[^>]*>(.*?)</div>', html, re.S)
rows  = re.findall(r'<td class="mono">\s*(<span class="age".*?</span>)\s*</td>', html, re.S)
def ts_of(frag):
    m = re.search(r'<span class="age"[^>]*\sdata-age-ts="([^"]+)"', frag)
    return m.group(1) if m else None

workers = [w for w in b["workers"] if w.get("last_ts")]
roster  = [r for r in b["roster"]  if r.get("last_ts")]
bad = []
if len(cards) != len(b["workers"]):
    bad.append("card-count=%d/%d" % (len(cards), len(b["workers"])))
for frag, w in zip(cards, b["workers"]):
    if w.get("last_ts") and ts_of(frag) != w["last_ts"]:
        bad.append("worker:%s(%s)" % (w["name"], ts_of(frag)))
have_roster = {ts_of(f) for f in rows}
for r in roster:
    if r["last_ts"] not in have_roster:
        bad.append("roster:%s" % r["actor"])
print("WORKERS=%d ROSTER=%d FROZEN=%d %s" % (len(workers), len(roster), len(bad), ",".join(bad[:4])))
PY
)"
[[ "$FL_TICK" == "WORKERS=3 "* ]] && [[ "$FL_TICK" != *" ROSTER=0 "* ]] && [[ "$FL_TICK" == *" FROZEN=0 "* ]] \
  && ok "GSL-98 ⭐ every age on Fleet carries its own data-age-ts — the ticker can reach it, so 'silent 12m' does not still say 12m three hours later" \
  || bad "GSL-98 ⭐ an age on Fleet is frozen at build time — tickAges cannot select it ($FL_TICK)"

# The other half of that fix, and the trap the phase has already fallen into once: `ageText` ends in
# "old", so the labels that used to sit around these numbers — `silent for` above the card's age, and
# a bare ` ago` after the roster's — would now read "silent for 12m old" and "12m old ago". That is
# the "0s old ago" defect, which shipped under 246 green tests because no assertion read English.
# So the SIGNATURE is what becomes mechanical, on the rendered text, with the tags stripped first.
fl_prose_dup() {  # exit 0 when the page carries a doubled temporal suffix
  python3 -c '
import re, sys, html
h = open(sys.argv[1], encoding="utf-8").read()
t = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", h)).split())
sys.exit(0 if (re.search(r"old\s+(ago|old)\b", t) or re.search(r"\bfor\s+\d[^ ]*( \d[^ ]*)? old\b", t)) else 1)
' "$1"
}
# The positive control, and it is not optional. Both defect shapes are probed across a tag boundary,
# because "12m old</span> ago" carries no literal "old ago" in the raw HTML — the reason the first
# draft of the GSL-99 prose test passed vacuously on a broken build.
printf '<div><small>silent for</small><span class="age">12m old</span></div>\n' > "$WORK/fl-prose-probe1.html"
printf '<td><span class="age">12m old</span> ago</td>\n' > "$WORK/fl-prose-probe2.html"
fl_prose_dup "$WORK/fl-prose-probe1.html" && fl_prose_dup "$WORK/fl-prose-probe2.html" \
  && ok "GSL-98: the Fleet prose check can SEE both doubled suffixes ('silent for 12m old', '12m old ago') — positive control" \
  || bad "GSL-98: the Fleet prose check cannot detect the defect it guards — it would pass vacuously"
fl_prose_dup "$FLH" \
  && bad "GSL-98: a Fleet age reads with two temporal suffixes — the '0s old ago' defect, again" \
  || ok "GSL-98: no doubled temporal suffix on Fleet — the labels are noun phrases and the age says 'old' once"

# ⭐ SILENT IS NOT DEAD. The PRD is literal about this: a worker nobody has heard from is not working,
# but it is not provably gone either, and the screen must say the first without implying the second.
[[ "$(jq -r '.fleet.workers[] | select(.name=="beta") | .state' "$FLB")" == "silent" ]] \
  && ok "GSL-98: 3h of silence + no pane.ended -> state=silent" \
  || bad "GSL-98: a silent worker was not called silent"
[[ "$(jq -r '.fleet.workers[] | select(.name=="alpha") | .state' "$FLB")" == "active" ]] \
  && ok "GSL-98: a worker heard from 2m ago -> state=active (the positive control)" \
  || bad "GSL-98: an active worker was not called active — the silent test above proves nothing"
[[ "$(jq -r '.fleet.workers[] | select(.name=="gamma") | .state' "$FLB")" == "ended" ]] \
  && ok "GSL-98: pane.ended -> state=ended (the one end-of-life the log actually knows)" \
  || bad "GSL-98: a logged pane.ended did not end the card"
jq -e '[.fleet.workers[].state] | index("dead") | not' "$FLB" >/dev/null 2>&1 \
  && jq -r '.fleet.workers[] | select(.name=="beta") | .state_why' "$FLB" | grep -qi "NOT 'dead'" \
  && ok "GSL-98: no card ever says 'dead' — a thinking worker and a killed one are both just silent" \
  || bad "GSL-98: the screen claims to tell a silent worker from a dead one. It cannot."

# ⭐ THE MODEL COMES FROM THE TRANSCRIPT, NOT FROM THE WORKER. The event log carries alpha's own claim
# (claude-haiku-4-5) and the transcript carries the truth (claude-opus-4-8). Both halves are asserted,
# because either alone would pass on a broken build: the truth must be ON the card, and the worker's
# claim must be NOWHERE on the page.
[[ "$(jq -r '.fleet.workers[] | select(.name=="alpha") | .model' "$FLB")" == "claude-opus-4-8" ]] \
  && ok "GSL-98: the model is read from the session transcript (the same source an audit reads)" \
  || bad "GSL-98: the model is not the transcript's ($(jq -r '.fleet.workers[] | select(.name=="alpha") | .model' "$FLB"))"
# The absence-greps are worth something only because both strings ARE in the fixture's log. Assert
# that first: an absence-grep over a fixture that never carried the string is a green tick over nothing.
grep -q 'claude-haiku-4-5' "$FL/docs/lab/events/$TODAY.jsonl" \
  && grep -q 'claude-sonnet-5' "$FL/docs/lab/events/$TODAY.jsonl" \
  && ok "GSL-98: both self-reported models ARE in the fixture log (so the absence-greps below mean something)" \
  || bad "GSL-98: the fixture carries no self-report — the greps below would pass vacuously"
grep -qE 'claude-haiku-4-5|claude-sonnet-5' "$FLH" \
  && bad "GSL-98: a worker's SELF-REPORTED model reached the page — cycles 49/50 all over again" \
  || ok "GSL-98 ⭐ neither self-report is on the page (both workers lied; the card ignored both)"
# No transcript -> unknown. NOT the worker's claim: with a self-report sitting right there in the log,
# `unknown` is the card actively REFUSING to take it, which is the whole discipline being guarded.
[[ "$(jq -r '.fleet.workers[] | select(.name=="gamma") | .model' "$FLB")" == "null" ]] \
  && ok "GSL-98 ⭐ no transcript -> model is unknown, even though the worker offered one" \
  || bad "GSL-98: a model was invented for a session with no transcript"
# Two models in one transcript is a mid-session switch, and collapsing it would hide the exact
# discrepancy this field exists to catch.
[[ "$(jq -r '.fleet.workers[] | select(.name=="beta") | .models | length' "$FLB")" == "2" ]] \
  && ok "GSL-98: a mid-session model switch is kept, not averaged away" \
  || bad "GSL-98: a session that ran on two models reports only one"

# ⭐ PANE IS UNKNOWN BY ABSENCE OF SOURCE, and it says so. Checked against the whole log: not one hook
# payload carries a pane id. A renderer cannot fix that; only a hook change could.
[[ "$(jq -r '[.fleet.workers[] | select(.pane == null)] | length' "$FLB")" == "3" ]] \
  && jq -r '.fleet.workers[0].pane_why' "$FLB" | grep -q 'no pane id' \
  && ok "GSL-98: every card reads pane=unknown and carries the reason (no hook emits one)" \
  || bad "GSL-98: a pane id was invented, or the missing one carries no reason"

# ⭐ A FAILED JOIN IS NOT A ZERO. `zeta` is in the ledger and matches no card; gamma is a card that
# matches no ledger line. Neither may render as "spent nothing".
[[ "$(jq -r '.fleet.workers[] | select(.name=="alpha") | .tokens_out' "$FLB")" == "1000" ]] \
  && ok "GSL-98: tokens join onto the card by worker name (alpha=1000 from the ledger)" \
  || bad "GSL-98: the token join is broken"
[[ "$(jq -r '.fleet.workers[] | select(.name=="gamma") | .tokens_out' "$FLB")" == "null" ]] \
  && jq -r '.fleet.workers[] | select(.name=="gamma") | .tokens_why' "$FLB" | grep -qi 'not evidence of zero spend' \
  && ok "GSL-98: a card with no ledger line reads unknown — a failed join, never a free worker" \
  || bad "GSL-98: an unjoined worker was rendered as having spent zero"
[[ "$(jq -r '.fleet.ledger_only | index("zeta")' "$FLB")" != "null" ]] \
  && grep -q 'match no card above' "$FLH" \
  && ok "GSL-98: ledger names that match no card are printed (one worker, two hand-typed names)" \
  || bad "GSL-98: the ledger's unmatched names are silently dropped"

# ⭐ The nameless session is COUNTED, not hidden: a worker that completed no task is missing from the
# log's vocabulary, not from the fleet, and an empty-looking Fleet screen must be able to say so.
[[ "$(jq -r '.fleet.unnamed_sessions' "$FLB")" == "1" ]] \
  && ok "GSL-98: a session the log cannot name is counted (no card, but not swept under the rug)" \
  || bad "GSL-98: nameless sessions are not counted"

# ⭐ COST, per model. The sums must be printed WITH what is missing from them: cycle 4 has an
# unreadable tokens_out, and a rollup that quietly skipped it would under-report with total
# confidence — "cheaper than reality" being the one direction a cost screen must never err in.
[[ "$(jq -r '.cost.by_model[] | select(.model=="claude-opus-4-8") | .tokens_out' "$FLB")" == "3000" ]] \
  && ok "GSL-98: per-model rollup sums the ledger by model (opus: 1000+2000)" \
  || bad "GSL-98: the per-model rollup does not sum"
[[ "$(jq -r '.cost.by_model[] | select(.model=="claude-fable-5") | .partial' "$FLB")" == "1" ]] \
  && grep -q 'LOW by an unknown amount' "$FL/docs/lab/site/cost.html" \
  && ok "GSL-98: an unreadable token field is COUNTED against its model's sum, and the page says so" \
  || bad "GSL-98: a cycle with an unreadable token field was silently dropped from the rollup"

# ⭐ The quota section is expected to be EMPTY, so it must print its own glob. "The quota never bit us"
# and "the hook that would have told us is dead" are different sentences and only one is safe to sleep
# on — an empty section that cannot say where it looked cannot tell you which one you are in.
# ⭐ TWO NUMBERS, TWO WORDS (review m1). The ledger's running counter says 9 cycles ran; only 4 carry
# a per-cycle bullet to sum. Both figures are true and they were both labelled "ledgered", which made
# them look like one fact and left the 5 cycles between them named nowhere — so a reader who summed
# the table never reached the cumulative total and was never told why. This dashboard's own rule is
# that a filter names what it hides (Timeline: "the other 308 are on disk, not here"), and the most
# expensive screen was the one place it was broken.
FL_COST="$WORK/f5-fleet/docs/lab/site/cost.html"
[[ "$(jq -r '.cost.cumulative_cycles' "$FLB")" == "9" ]] && [[ "$(jq -r '.cost.cycles | length' "$FLB")" == "4" ]] \
  && ok "GSL-98: the trap is armed — the ledger counts 9 cycles and carries per-cycle rows for 4" \
  || bad "GSL-98: the cost fixture has no gap between running total and parsed rows, so the test below proves nothing"
grep -q 'data-cycle-gap="5"' "$FL_COST" \
  && grep -q 'cycles run (ledger running total)' "$FL_COST" \
  && ! grep -q 'cycles ledgered' "$FL_COST" \
  && ok "GSL-98 ⭐ the 5 cycles with no telemetry row are NAMED, and the two counts no longer share one word" \
  || bad "GSL-98 ⭐ Cost still prints two different numbers under one label, with the gap named nowhere"
fl_prose() { python3 -c '
import re, sys, html
h = open(sys.argv[1], encoding="utf-8").read()
print(html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h))))
' "$1"; }
fl_prose "$FL_COST" | grep -q 'every sum below is LOW by an unknown amount' \
  && ok "GSL-98: the page says which DIRECTION the omission runs — the sums are low, not merely 'partial'" \
  || bad "GSL-98: the gap is counted but its direction is not stated, so a reader cannot tell which way to distrust the table"

[[ "$(jq -r '.cost.quota.total' "$FLB")" == "0" ]] \
  && jq -r '.cost.quota.searched' "$FLB" | grep -q 'docs/lab/events/\*.jsonl' \
  && grep -q 'Searched:' "$FL/docs/lab/site/cost.html" \
  && ok "GSL-98: an empty quota section prints the glob it searched, not a shrug" \
  || bad "GSL-98: the quota section is empty and cannot say where it looked"

# ISO-8601 WITH AN OFFSET, driven end to end through the real chronicler.
#
# Jira hands poll-fill `occurred_at` as 2026-07-12T23:26:24.969+0200 — fractional seconds, numeric
# offset — and the strict `...Z`-only parser returned None for every one of them. The damage was
# silent and exact: the Tasks board knew a task's STATUS but not when it learned it, so it reported
# the age as "never" on a board whose statuses were sitting right there. And an offset timestamp
# sorts ABOVE a Z timestamp lexically while being the EARLIER instant, so a naive >= picks the stale
# record and calls it the newest.
#
# The two lines below are the same task, five minutes apart, in the two formats — and the LATER one
# is written in the offset form so a parser that ignores the offset gets the answer backwards.
TZR="$WORK/tz-repo"; mkdir -p "$TZR/docs/lab/events"
{ printf '{"ts":"%sT21:33:25Z","run_id":"x","seq":1,"actor":"poll-fill","type":"tracker.issue.updated","src":"poll-fill","data":{"key":"GSL-777","status":"To Do","summary":"tz probe","occurred_at":"%sT21:30:00Z"}}\n' "$TODAY" "$TODAY"
  printf '{"ts":"%sT21:34:25Z","run_id":"x","seq":2,"actor":"poll-fill","type":"tracker.issue.updated","src":"poll-fill","data":{"key":"GSL-777","status":"Done","summary":"tz probe","occurred_at":"%sT23:35:00.969+0200"}}\n' "$TODAY" "$TODAY"
} > "$TZR/docs/lab/events/$TODAY.jsonl"
bash "$CH" --repo "$TZR" --no-poll --quiet --json >/dev/null 2>&1
TZROW="$(jq -c '.tasks.rows[] | select(.key=="GSL-777")' "$TZR/docs/lab/render_bundle.json" 2>/dev/null)"
[[ "$(echo "$TZROW" | jq -r .status_ts)" == "${TODAY}T21:35:00Z" ]] \
  && ok "GSL-93: an offset timestamp is normalised to UTC Z before anything compares it" \
  || bad "GSL-93: occurred_at with a +0200 offset was not normalised (status_ts=$(echo "$TZROW" | jq -r .status_ts))"
[[ "$(echo "$TZROW" | jq -r .status)" == "Done" ]] \
  && ok "GSL-93: the NEWEST status wins across mixed timestamp formats (the offset one really is later)" \
  || bad "GSL-93: a lexical compare across two timestamp formats picked the wrong status"
[[ "$(echo "$TZROW" | jq -r .status_age_human)" != "never" ]] \
  && ok "GSL-93: the Tasks board knows the AGE of its statuses (a board is only as true as its last poll)" \
  || bad "GSL-93: the board has a status but no idea when it learned it — it reports the age as 'never'"

# ════════════ GSL-94 / F5-S1: the autonomy runway = min() over six exhaustion clocks ════════════
#
# The acceptance criterion of PRD Phase 5: given a state, the runway is computed correctly AND the
# limiting axis is NAMED. Everything below drives a SYNTHETIC state through the real chronicler and
# checks both halves — because a runway that is right for the wrong reason is a runway that will be
# wrong tomorrow for a reason nobody can find.
#
# rw_fixture <dir> <ctx_pct> <workers> [extra-event-jsonl]
#   Builds a repo with two heartbeat pulses (a level is not a rate — a prediction needs two readings),
#   a TELEMETRY ledger, and an event log. Everything else the runway reads is absent on purpose, so
#   each test turns exactly ONE clock on.
rw_fixture() {
  local D="$1" PCT="$2" WK="$3" EXTRA="${4:-}"
  rm -rf "$D"; mkdir -p "$D/docs/lab/events" "$D/docs/lab/questions" "$D/docs/handoff"
  : > "$D/docs/lab/questions/queue.jsonl"
  local T0 T1
  T0="$(python3 -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(hours=2)).strftime('%Y-%m-%dT%H:%M:%SZ'))")"
  T1="$(python3 -c "import datetime;print(datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))")"
  # 2 hours apart, context +10pts, +2 cycles -> 5 %/h and 1 cycle/h. Round numbers on purpose: a
  # test whose arithmetic you cannot do in your head is a test you cannot debug at 03:00.
  { printf '{"ts":"%s","cycle":10,"context_pct":%d,"open_workers":%d,"status":"ok","pane":"%%1","note":""}\n' "$T0" "$((PCT-10))" "$WK"
    printf '{"ts":"%s","cycle":12,"context_pct":%d,"open_workers":%d,"status":"ok","pane":"%%1","note":""}\n' "$T1" "$PCT" "$WK"
  } > "$D/docs/handoff/.orchestrator-heartbeat"
  { printf '## TELEMETRY (cumulative)\n\n'
    printf -- '- `cycle=11 worker=w model=claude-opus-4-8 tokens_out=~1000 tokens_in=~100 | running: cycles=11 total≈900000`\n'
    printf -- '- `cycle=12 worker=w model=claude-opus-4-8 tokens_out=~1000 tokens_in=~100 | running: cycles=12 total≈1000000`\n'
    printf '\n## Log\n\nend\n'
  } > "$D/docs/handoff/ORCHESTRATION-STATE.md"
  { printf '{"ts":"%s","run_id":"x","seq":1,"actor":"w1","type":"cycle.started","src":"emit","data":{}}\n' "$T1"
    [[ -n "$EXTRA" ]] && printf '%s\n' "$EXTRA"
  } > "$D/docs/lab/events/$TODAY.jsonl"
}
rw() { jq -r "$1" "$2/docs/lab/render_bundle.json" 2>/dev/null; }

# ── F5-S1 a. A BLOCKER is limiting. It is the only question type that can stop a night: manifest §3
#    gives it no default, ever, so it has no timer and cannot resolve itself while you sleep.
RWB="$WORK/rw-blocker"; rw_fixture "$RWB" 50 1
GOSLEEP_LAB_DIR="$RWB/docs/lab" "$LE" question --type BLOCKER --from smoke-rw --task GSL-1 \
  --question "runway smoke: the vercel token expired and there is no safe default" >/dev/null 2>&1
bash "$CH" --repo "$RWB" --no-poll --quiet --json >/dev/null 2>&1
[[ "$(rw '.runway.binding' "$RWB")" == "blockers" ]] \
  && jq -e '.runway.hours == 0' "$RWB/docs/lab/render_bundle.json" >/dev/null 2>&1 \
  && ok "F5-S1: an open BLOCKER drives the runway to 0h and NAMES itself as the binding axis" \
  || bad "F5-S1: an open BLOCKER did not bind the runway (binding=$(rw '.runway.binding' "$RWB") hours=$(rw '.runway.hours' "$RWB"))"
rw '.runway.binding_why' "$RWB" | grep -q 'no default' \
  && ok "F5-S1: the trace explains WHY a BLOCKER stops the night (no default, no timer)" \
  || bad "F5-S1: the binding axis is named but not explained"

# ── F5-S1 b. A quota window is limiting. Armed by quota.wait_started carrying a reset ETA; the fleet
#    quiesces until it resets, so this one really does stop the night (temporarily).
RWQ="$WORK/rw-quota"
QETA="$(python3 -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=4)).strftime('%Y-%m-%dT%H:%M:%SZ'))")"
QEV="$(printf '{"ts":"%s","run_id":"x","seq":2,"actor":"orch","type":"quota.wait_started","src":"emit","data":{"until":"%s"}}' \
        "$(python3 -c "import datetime;print(datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))")" "$QETA")"
rw_fixture "$RWQ" 50 1 "$QEV"
GOSLEEP_TOKEN_CEILING=99000000 bash "$CH" --repo "$RWQ" --no-poll --quiet --json >/dev/null 2>&1
[[ "$(rw '.runway.binding' "$RWQ")" == "quota" ]] \
  && ok "F5-S1: an armed quota window binds the runway and is named" \
  || bad "F5-S1: quota did not bind (binding=$(rw '.runway.binding' "$RWQ"))"
QH="$(rw '.runway.hours' "$RWQ")"
python3 -c "import sys;sys.exit(0 if 3.8 <= float('$QH') <= 4.05 else 1)" 2>/dev/null \
  && ok "F5-S1: the quota clock reads ~4h — the ETA, not a guess (got ${QH}h)" \
  || bad "F5-S1: the quota clock is wrong (got ${QH}h, expected ~4h)"
[[ "$(rw '.runway.binding_eta' "$RWQ")" == "$QETA" ]] \
  && ok "F5-S1: the runway carries the reset ETA itself, not just the hours" \
  || bad "F5-S1: the ETA was lost"

# ── F5-S1 c. The token budget is limiting. 1,000,000 spent of 1,100,000; 100k/cycle at 1 cycle/h ->
#    1h. The ledger has cycle NUMBERS and no timestamps, so the burn rate needs the heartbeat to tell
#    time: this test proves the two sources are actually joined.
RWC="$WORK/rw-cost"; rw_fixture "$RWC" 50 1
GOSLEEP_TOKEN_CEILING=1100000 bash "$CH" --repo "$RWC" --no-poll --quiet --json >/dev/null 2>&1
[[ "$(rw '.runway.binding' "$RWC")" == "budget" ]] \
  && ok "F5-S1: the token budget binds when a ceiling exists and the burn rate is measurable" \
  || bad "F5-S1: budget did not bind (binding=$(rw '.runway.binding' "$RWC"))"
BH="$(rw '.runway.hours' "$RWC")"
python3 -c "import sys;sys.exit(0 if 0.9 <= float('$BH') <= 1.1 else 1)" 2>/dev/null \
  && ok "F5-S1: the budget clock reads ~1h (100k left, ~100k/cycle, 1 cycle/h) — got ${BH}h" \
  || bad "F5-S1: the budget clock is wrong (got ${BH}h, expected ~1h)"

# ── F5-S1 d. THE DESIGN ASSERTION. min() over the raw six is a LIE BY ARITHMETIC, because exhaustion
#    does not mean the same thing on every axis. Here the context clock is EXHAUSTED (0h) — but its
#    zero is a forced roll the watchdog performs by itself, and the night survives it. A naive
#    min(0h, 4h) would scream "RUNWAY 0h" and wake the owner for a non-event.
#    The runway must therefore read 4h (the quota — the nearest clock that actually STOPS the night),
#    and must still SHOW the roll as the next thing that happens, so nothing is hidden.
RWD="$WORK/rw-degrade"; rw_fixture "$RWD" 85 1 "$QEV"       # 85% >= the 80% ceiling -> exhausted
GOSLEEP_TOKEN_CEILING=99000000 bash "$CH" --repo "$RWD" --no-poll --quiet --json >/dev/null 2>&1
[[ "$(rw '.runway.clocks[] | select(.axis=="context") | .state' "$RWD")" == "exhausted" ]] \
  && ok "F5-S1: context at/over the ceiling reads as EXHAUSTED" \
  || bad "F5-S1: an over-ceiling context did not register"
[[ "$(rw '.runway.binding' "$RWD")" == "quota" ]] \
  && ok "F5-S1: a DEGRADING clock at 0h does not drive the headline — a forced roll is not a reason to wake you" \
  || bad "F5-S1: min() over the raw six — a context roll was reported as RUNWAY 0h (binding=$(rw '.runway.binding' "$RWD"))"
[[ "$(rw '.runway.next_event.axis' "$RWD")" == "context" ]] \
  && ok "F5-S1: ...and the roll is still SHOWN as the next event — excluded from the headline, never hidden" \
  || bad "F5-S1: the degrading clock vanished from the page entirely"

# ── F5-S1 e. UNKNOWN IS NOT CLEAR, and it is not zero either. No heartbeat at all: the fleet, the
#    context and the burn rate are all unreadable. The runway must refuse to answer — NOT quietly drop
#    the clocks it cannot read and report the minimum of what is left, which would make the answer
#    LONGER the LESS it knows. Knowing less must never read as more runway.
RWU="$WORK/rw-unknown"; rw_fixture "$RWU" 50 1
rm -f "$RWU/docs/handoff/.orchestrator-heartbeat"
bash "$CH" --repo "$RWU" --no-poll --quiet --json >/dev/null 2>&1
[[ "$(rw '.runway.bound' "$RWU")" == "unknown" ]] \
  && ok "F5-S1: no heartbeat + no ceiling -> the runway says 'unknown', not a comfortable number" \
  || bad "F5-S1: the runway answered with a number it could not know (bound=$(rw '.runway.bound' "$RWU"))"
[[ "$(rw '.runway.unknown_axes | index("budget")' "$RWU")" != "null" ]] \
  && ok "F5-S1: the unreadable stopping clocks are NAMED, not silently dropped" \
  || bad "F5-S1: an unreadable clock vanished instead of bounding the answer"
grep -q 'Cannot say' "$RWU/docs/lab/site/index.html" \
  && grep -q 'different sentences' "$RWU/docs/lab/site/index.html" \
  && ok "F5-S1: the page SAYS it cannot see, and says why that is not a green light" \
  || bad "F5-S1: the page rendered an absence of evidence as evidence of absence"

# ── F5-S1 f. An unreadable clock turns an estimate into an UPPER BOUND. The quota says 4h; the budget
#    cannot be read. The true runway is AT MOST 4h — it can only be shorter, never longer, so "≈ 4h"
#    would be a lie in the one direction that costs the owner a night.
RWUP="$WORK/rw-upper"; rw_fixture "$RWUP" 50 1 "$QEV"
bash "$CH" --repo "$RWUP" --no-poll --quiet --json >/dev/null 2>&1      # no ceiling -> budget unknown
[[ "$(rw '.runway.bound' "$RWUP")" == "upper" && "$(rw '.runway.binding' "$RWUP")" == "quota" ]] \
  && ok "F5-S1: a counting clock + an unreadable one = an UPPER bound (≤), never an estimate (≈)" \
  || bad "F5-S1: an unreadable clock did not weaken the claim (bound=$(rw '.runway.bound' "$RWUP"))"
grep -q 'Upper bound only' "$RWUP/docs/lab/site/index.html" \
  && ok "F5-S1: the page renders ≤, and names the clocks that made it a bound" \
  || bad "F5-S1: the page presented an upper bound as an estimate"

# ── F5-S1 g. CLEAR is an answer, and it is NOT the same answer as UNKNOWN. Every stopping clock is
#    readable and none is counting: nothing is going to stop the night. That is evidence OF absence,
#    and it earns a green light — which "I could not read the clock" never does.
#    A ledger that is not GROWING is exactly that kind of evidence: not an unreadable ledger, but a
#    fleet that is not spending. So it lands on the green side of the line.
RWCL="$WORK/rw-clear"; rw_fixture "$RWCL" 50 1
sed -i.bak 's/total≈900000/total≈1000000/' "$RWCL/docs/handoff/ORCHESTRATION-STATE.md"   # flat: no burn
GOSLEEP_TOKEN_CEILING=99000000 bash "$CH" --repo "$RWCL" --no-poll --quiet --json >/dev/null 2>&1
[[ "$(rw '.runway.bound' "$RWCL")" == "clear" ]] \
  && ok "F5-S1: every stopping clock readable, none counting -> 'clear' (evidence of absence, not absence of evidence)" \
  || bad "F5-S1: a fully-readable, unconstrained state was not reported as clear (bound=$(rw '.runway.bound' "$RWCL"))"
[[ "$(rw '.runway.clocks[] | select(.axis=="budget") | .state' "$RWCL")" == "clear" ]] \
  && ok "F5-S1: a ledger that is not growing is 'clear' (not spending), never 'unknown' (cannot read)" \
  || bad "F5-S1: a flat telemetry ledger was mistaken for an unreadable one"

# ── F5-S1 g2. ...and a real ceiling that is simply FAR AWAY gives a number, not a shrug. 98M left at
#    ~100k/cycle at 1 cycle/h is ~980h: silly-looking, correct, and rendered as days.
RWFAR="$WORK/rw-far"; rw_fixture "$RWFAR" 50 1
GOSLEEP_TOKEN_CEILING=99000000 bash "$CH" --repo "$RWFAR" --no-poll --quiet --json >/dev/null 2>&1
[[ "$(rw '.runway.bound' "$RWFAR")" == "exact" && "$(rw '.runway.binding' "$RWFAR")" == "budget" ]] \
  && ok "F5-S1: a distant-but-real ceiling gives an EXACT runway, not a shrug" \
  || bad "F5-S1: a readable, distant budget did not produce an exact answer (bound=$(rw '.runway.bound' "$RWFAR"))"

# ── F5-S1 h. Six clocks, always. Not five when a source is missing.
[[ "$(rw '.runway.clocks | length' "$RWCL")" == "6" && "$(rw '.runway.clocks | length' "$RWU")" == "6" ]] \
  && ok "F5-S1: all six clocks are always reported — a missing source produces 'unknown', not a gap" \
  || bad "F5-S1: a clock disappeared when its source was missing"
[[ "$(rw '.runway.trace | length' "$RWU")" == "6" ]] \
  && ok "F5-S1: the reasoning trace carries one line per axis (evidence, not vibes — R5.1)" \
  || bad "F5-S1: the runway shows a number with no reasoning"

# C8: a correction supersedes, it never rewrites. Fold before you count, or the log lies twice.
# The file holds 3 commit lines, one of which supersedes another -> a correct fold counts 2.
# (Counted by TYPE, not by day: these events are 20h old, so since GSL-89 — where a day is keyed on
# when an event HAPPENED, not on which file it was written into — they are not "today" at all.)
[[ "$(jq -r '.events.by_type["vcs.commit"] // 0' "$CR/docs/lab/status.json")" == "2" ]] \
  && ok "C8: superseded event folded out of the counts (3 lines -> 2 events)" \
  || bad "superseded event still counted (no fold): vcs.commit=$(jq -r '.events.by_type["vcs.commit"] // 0' "$CR/docs/lab/status.json")"
grep -q "WRONG" "$CR/docs/lab/site/timeline.html" \
  && bad "superseded event still rendered in the timeline" \
  || ok "C8: superseded event is not shown on the timeline"

# The 7-section digest, and every section built from disk.
DIG="$CR/docs/lab/digest/$TODAY-morning.md"
SEC="$(grep -c '^## [1-7]\.' "$DIG" 2>/dev/null || echo 0)"
[[ "$SEC" == "7" ]] && ok "morning digest has all 7 canonical sections" || bad "digest has $SEC/7 sections"
grep -q 'DEAD' "$DIG" && ok "digest states its own staleness" || bad "digest hides its staleness"

# Retention (docs/lab/README): events are exhaust — 30 days, then pruned. The memory is elsewhere.
[[ ! -f "$CR/docs/lab/events/$OLD_DAY.jsonl" ]] \
  && ok "retention: a 45-day-old event log is pruned" || bad "retention: stale event log survives"
[[ -f "$CR/docs/lab/events/$TODAY.jsonl" ]] \
  && ok "retention: today's log is untouched" || bad "retention: pruned a live log!"

# F4-S3 from the other side: this throwaway lab has no heartbeat and no STATE file. The chronicler
# must still produce every page and SAY what it could not read — degrading LOUDLY is the feature,
# because "section 5 is empty" and "section 5 could not be read" look identical to a sleeping owner.
echo "$RPT" | jq -e '.ok == true' >/dev/null && ok "missing sources -> still exits ok (degraded, not dead)" \
  || bad "a missing source killed the chronicler"
[[ "$(echo "$RPT" | jq -r '[.degraded[].source] | contains(["heartbeat","state"]) | tostring')" == "true" ]] \
  && ok "the missing sources are reported, not swallowed" || bad "a missing source vanished silently"
grep -q 'Degraded sources' "$CR/docs/lab/site/index.html" \
  && ok "the page names its blind spots" || bad "the page hides its blind spots"

# The default pass must not call an LLM at all: the narrator is opt-in (C3).
echo "$RPT" | jq -e '.narrative == "not requested"' >/dev/null \
  && ok "C3: the default pass is 0-LLM (narrator is --narrate opt-in)" || bad "C3: default pass calls the LLM"

# A NON-EMPTY queue. This is not a formality: lab-emit --json emits JSONL, not an array, and an empty
# queue emits nothing — so a naive parser passes every test until the first real question is asked and
# the chronicler dies on it. It did. The open question must reach status.json, the page, and section 1
# of the digest, or the owner wakes up to a dashboard that swallowed the thing it exists to surface.
GOSLEEP_LAB_DIR="$CR/docs/lab" "$LE" question --type DECISION --from smoke-chron --task GSL-86 \
  --question "chronicler smoke: is the queue folded into the digest?" \
  --default "yes" --default-rationale "smoke" --reversibility high >/dev/null
bash "$CH" --repo "$CR" --no-poll --quiet --json >/dev/null 2>&1
[[ "$(jq -r '.questions.open' "$CR/docs/lab/status.json")" == "1" ]] \
  && ok "a non-empty queue is folded into status.json (JSONL, not an array)" \
  || bad "the open question never reached status.json"
grep -q 'chronicler smoke' "$CR/docs/lab/site/index.html" \
  && ok "the open question is shown in 'Waiting for you'" || bad "the dashboard swallowed the question"
grep -A2 '^## 1\. Waiting for you' "$CR/docs/lab/digest/$TODAY-morning.md" | grep -q 'chronicler smoke' \
  && ok "the open question leads section 1 of the digest" || bad "digest section 1 lost the question"

# An empty day gets no digest — an empty digest teaches the owner to stop opening them.
EMPTY="$WORK/chron-empty"; mkdir -p "$EMPTY/docs/lab/events"
bash "$CH" --repo "$EMPTY" --date 2020-01-01 --no-poll --quiet --json >/dev/null 2>&1
[[ ! -f "$EMPTY/docs/lab/digest/2020-01-01-morning.md" ]] \
  && ok "a day with no activity produces no digest" || bad "empty digest written"

echo "== poll-fill: reconcile-don't-trust (GSL-87) =="
PF="$SCRIPT_DIR/poll-fill.sh"
bash -n "$PF" && ok "poll-fill.sh: bash -n" || bad "poll-fill.sh: bash -n"
python3 -c "import ast; ast.parse(open('$SCRIPT_DIR/poll-fill.py').read())" 2>/dev/null \
  && ok "poll-fill.py: parses" || bad "poll-fill.py: syntax error"
grep -qEi 'api[_-]?key|ANTHROPIC_API|sk-ant|bearer' "$SCRIPT_DIR/poll-fill.py" \
  && bad "C1: an API key appears in poll-fill.py" || ok "C1: zero API keys in poll-fill"
grep -qE 'claude( -p|\b--print)' "$SCRIPT_DIR/poll-fill.py" \
  && bad "poll-fill calls an LLM" || ok "poll-fill is 0-LLM (pure reconcile)"
# It must write through lab-log.sh and nothing else: seq is allocated under a lock, and a hand-appended
# line has none — a fabricated line would be indistinguishable from a real one, only broken.
grep -q 'lab-log.sh' "$SCRIPT_DIR/poll-fill.py" \
  && ok "poll-fill writes only through lab-log.sh (the one writer)" || bad "poll-fill bypasses lab-log"

# The lab is a throwaway dir; the repo it reconciles is the real one (gh refuses to run outside git).
PL="$WORK/pf-lab"; mkdir -p "$PL/docs/lab/events"
printf '{"ts":"2026-06-01T00:00:00Z","run_id":"x","seq":1,"actor":"a","type":"pane.started","src":"hook:SessionStart","data":{}}\n' \
  > "$PL/docs/lab/events/2026-06-01.jsonl"

bash "$PF" --repo "$PL" --git-repo "$REPO_ROOT" --no-git --no-jira --since-days 90 --dry-run --quiet >/dev/null 2>&1
[[ "$(cat "$PL/docs/lab/events/"*.jsonl | wc -l | tr -d ' ')" == "1" ]] \
  && ok "--dry-run writes nothing" || bad "--dry-run wrote events"

# THE acceptance case, verbatim from GSL-87: a PR merged outside the CLI shows up in the timeline.
# PR #92 really was merged from the web — no hook ever saw it. This is not a fixture; it is the fact.
bash "$PF" --repo "$PL" --git-repo "$REPO_ROOT" --no-git --no-jira --since-days 90 --quiet >/dev/null 2>&1
cat "$PL/docs/lab/events/"*.jsonl | jq -se 'map(select(.type=="vcs.pr.merged")) | length > 0' >/dev/null 2>&1 \
  && ok "R4.2 acceptance: a PR merged outside the CLI reaches the timeline" \
  || bad "R4.2: the merged PR never reached the timeline"
# Provenance is never forged: a reconciled fact must not masquerade as something a hook witnessed.
cat "$PL/docs/lab/events/"*.jsonl | jq -se 'map(select(.type=="vcs.pr.merged")) | all(.src == "poll-fill")' >/dev/null 2>&1 \
  && ok "reconciled events are tagged src=poll-fill, never src=hook:*" || bad "poll-fill forged a hook provenance"
cat "$PL/docs/lab/events/"*.jsonl | jq -se 'map(select(.src=="poll-fill")) | all(.data.occurred_at != null)' >/dev/null 2>&1 \
  && ok "each backfilled event carries data.occurred_at (since GSL-89 also its ts; logged_at = when we learned it)" \
  || bad "a backfilled event lost the time it actually happened"

# IDEMPOTENCE — the acceptance criterion of GSL-87, stated verbatim: run it twice, the second pass
# adds zero lines. Keyed on the external identity of the fact, so re-observing it changes nothing.
N1="$(cat "$PL/docs/lab/events/"*.jsonl | wc -l | tr -d ' ')"
bash "$PF" --repo "$PL" --git-repo "$REPO_ROOT" --no-git --no-jira --since-days 90 --quiet >/dev/null 2>&1
N2="$(cat "$PL/docs/lab/events/"*.jsonl | wc -l | tr -d ' ')"
[[ "$N1" == "$N2" ]] && ok "idempotent: a second pass adds 0 lines ($N1 -> $N2)" \
  || bad "second pass duplicated events ($N1 -> $N2)"

# It must not re-log what the hooks already caught. Seed a commit the hook "saw", then reconcile git:
# the sha is already known, so it is not a gap.
HEAD_SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
printf '{"ts":"2026-06-01T00:00:01Z","run_id":"x","seq":2,"actor":"a","type":"vcs.commit","src":"hook:PostToolUse","data":{"sha":"%s"}}\n' \
  "$HEAD_SHA" >> "$PL/docs/lab/events/2026-06-01.jsonl"
OUT="$(bash "$PF" --repo "$PL" --git-repo "$REPO_ROOT" --no-gh --no-jira --prehistory --since-days 1 --json --quiet 2>/dev/null)"
echo "$OUT" | jq -e --arg s "commit:$HEAD_SHA" '[.missing[].key] | contains([$s]) | not' >/dev/null \
  && ok "a commit the hook already logged is not re-logged (dedup across producers)" \
  || bad "poll-fill duplicated a hook-caught commit"

# The floor: lab-log stamps ts=now, so backfilling week-old facts would pile them onto TODAY. A log
# answers only for the period it existed. What is dropped is COUNTED — a silent cap reads as "clean".
echo "$OUT" | jq -e '.prehistory_skipped != null' >/dev/null \
  && ok "pre-history is counted, not silently dropped" || bad "dropped facts vanish without a count"

# Jira has no CLI here and we hold no key (C1): the source must be skipped LOUDLY, never quietly.
J="$(bash "$PF" --repo "$PL" --git-repo "$REPO_ROOT" --no-git --no-gh --json --quiet 2>/dev/null)"
echo "$J" | jq -e '[.skipped[].source] | contains(["jira"])' >/dev/null \
  && ok "a Jira feed that is absent is reported as skipped, not passed off as clean" \
  || bad "the missing Jira feed was swallowed"
echo "$J" | jq -e '.sources_checked | contains(["jira"]) | not' >/dev/null \
  && ok "an unreachable source is never counted as checked" || bad "claimed to check an absent source"

# And a Jira feed that IS supplied (the MCP dump path) reconciles — and does not lie about it: JQL
# proves a STATE, not a transition, so the event type is tracker.issue.updated, never .transitioned.
printf '[{"key":"GSL-999","status":"Done","updated":"2026-06-15T10:00:00Z","summary":"smoke"}]\n' > "$WORK/jira.json"
bash "$PF" --repo "$PL" --git-repo "$REPO_ROOT" --no-git --no-gh --jira-json "$WORK/jira.json" --quiet >/dev/null 2>&1
cat "$PL/docs/lab/events/"*.jsonl | jq -se 'map(select(.data.key=="GSL-999")) | length == 1 and (.[0].type == "tracker.issue.updated")' >/dev/null 2>&1 \
  && ok "a supplied Jira feed lands as tracker.issue.updated (a state, not a claimed transition)" \
  || bad "the Jira feed was lost, or logged as a transition nobody witnessed"

# The pairing (R4.2 end-to-end): the chronicler runs poll-fill as step 0, so a fact no hook ever saw
# is reconciled AND rendered in the same pass — which is what "appears in the timeline after a
# chronicler pass" actually means.
PAIR="$WORK/pair"; mkdir -p "$PAIR/docs/lab/events"
printf '{"ts":"2026-06-01T00:00:00Z","run_id":"x","seq":1,"actor":"a","type":"pane.started","src":"hook:SessionStart","data":{}}\n' \
  > "$PAIR/docs/lab/events/2026-06-01.jsonl"
GOSLEEP_REPO="$REPO_ROOT" bash "$CH" --repo "$PAIR" --quiet --json >/dev/null 2>&1
cat "$PAIR/docs/lab/events/"*.jsonl | jq -se 'map(select(.src=="poll-fill")) | length > 0' >/dev/null 2>&1 \
  && ok "chronicler runs poll-fill as step 0 (a gap is reconciled and rendered in one pass)" \
  || bad "the chronicler did not reconcile before rendering"
jq -e '.events.by_src["poll-fill"] > 0' "$PAIR/docs/lab/status.json" >/dev/null 2>&1 \
  && ok "status.json separates reconciled facts from hook-witnessed ones (by_src)" \
  || bad "status.json cannot tell inference from observation"

echo "== lab-log --ts / --supersedes: a backfill lands where it HAPPENED (GSL-89) =="
bash -n "$LL" && ok "lab-log.sh: bash -n (the writer every hook calls)" || bad "lab-log.sh: bash -n"

TSL="$WORK/tslab"
NOW_DAY="$(date -u +%F)"
DA="$(python3 -c "import datetime;print((datetime.date.today()-datetime.timedelta(days=2)).isoformat())")"
DB="$(python3 -c "import datetime;print((datetime.date.today()-datetime.timedelta(days=1)).isoformat())")"

# Without --ts nothing changes: ts = now, and no logged_at, because nothing was learned after the fact.
GOSLEEP_LAB_DIR="$TSL" bash "$LL" --type cycle.started --actor smoke --data k=v --quiet
jq -se --arg d "$NOW_DAY" 'map(select(.type=="cycle.started"))[0] | (.ts|startswith($d)) and (has("logged_at")|not)' \
  "$TSL/events/$NOW_DAY.jsonl" >/dev/null \
  && ok "no --ts: ts = now, no logged_at (nothing was learned late)" || bad "--ts changed the default envelope"

# --ts back-dates the EVENT, and both halves of the truth survive: when it HAPPENED (ts) and when we
# LEARNED it (logged_at). Collapse them and the log can no longer tell observation from hindsight.
GOSLEEP_LAB_DIR="$TSL" bash "$LL" --type vcs.commit --src poll-fill --actor poll-fill \
  --ts "${DA}T18:20:18Z" --supersedes "${DA}:4" --data sha=4af66d2 --quiet
jq -se --arg t "${DA}T18:20:18Z" --arg d "$NOW_DAY" --arg s "${DA}:4" \
  'map(select(.src=="poll-fill"))[0] | .ts==$t and (.logged_at|startswith($d)) and .supersedes==$s' \
  "$TSL/events/$NOW_DAY.jsonl" >/dev/null \
  && ok "--ts = when it happened, logged_at = when we learned it, --supersedes qualified by day" \
  || bad "--ts / --supersedes did not reach the envelope"

# The line still goes into TODAY's file. The filename is a rotation unit; ts is the semantics. Appending
# into a past day would mutate a file git already holds — and that retention may already have pruned.
[[ ! -f "$TSL/events/$DA.jsonl" ]] \
  && ok "--ts back-dates the event, never the FILE (no past day reopened)" \
  || bad "--ts appended into a past day's file"

# git says +02:00, Jira says +0300 with millis, gh says Z — and python3.9's fromisoformat takes neither
# of the last two. A line left carrying an offset sorts HOURS from where it belongs: the timeline is
# ordered lexically on ts, so normalizing is correctness, not tidiness.
for TSIN in "${DA}T20:20:18+02:00" "${DA}T21:20:18.123+0300"; do
  GOSLEEP_LAB_DIR="$TSL" bash "$LL" --type vcs.commit --src poll-fill --ts "$TSIN" --data sha=aaa1111 --quiet
done
[[ "$(jq -r 'select(.data.sha=="aaa1111") | .ts' "$TSL/events/$NOW_DAY.jsonl" | sort -u)" == "${DA}T18:20:18Z" ]] \
  && ok "offset forms (+02:00, +0300 w/ millis) normalize to one UTC instant" \
  || bad "an offset survived into ts — the line would sort into the wrong hour"

# A malformed backfill is a usage error, never a shrug. lab-log is the ONE writer that can place a line
# at an instant; a line placed at the WRONG instant is worse than a line never written.
GOSLEEP_LAB_DIR="$TSL" bash "$LL" --type x --ts garbage --quiet 2>/dev/null \
  && bad "--ts accepted garbage (a silent fallback to 'now')" || ok "--ts garbage -> loud failure"
GOSLEEP_LAB_DIR="$TSL" bash "$LL" --type x --supersedes nope --quiet 2>/dev/null \
  && bad "--supersedes accepted garbage" || ok "--supersedes garbage -> loud failure"

echo "== lab-log: the hook fires on the COMMAND, not on its SUCCESS (REVIEW-gsl81 C1) =="
# A `git commit` that FAILS (nothing staged, rejected hook, empty message) is routine in a fleet. The
# hook fires anyway, HEAD has not moved, and a naive fallback hands the event the PREVIOUS commit's
# sha: a real, REACHABLE sha bound to a commit that never happened. Nothing downstream can catch that
# — poll-fill's sha-less refusal never sees it, its dedup key collides with the real commit's, and an
# append-only log can only supersede the line, never take it back. So HEAD must earn the sha twice:
# be FRESH, and be ITS OWN. Withholding a sha costs a gap poll-fill fills; guessing one costs the truth.
GR="$WORK/c1-repo"
mkdir -p "$GR" && git init -q "$GR" 2>/dev/null
git -C "$GR" config user.email smoke@example.com
git -C "$GR" config user.name  smoke
git -C "$GR" config commit.gpgsign false
: > "$GR/a.txt"; git -C "$GR" add a.txt
OLDDATE="@$(python3 -c 'import time;print(int(time.time())-3600)') +0000"
GIT_AUTHOR_DATE="$OLDDATE" GIT_COMMITTER_DATE="$OLDDATE" \
  git -C "$GR" commit -q -m "GSL-01 the REAL commit"
OLDSHA="$(git -C "$GR" rev-parse --short HEAD)"

c1_sha() {   # $1=lab dir  $2=command the hook saw  $3=tool_response -> the sha the event carries
  rm -rf "$1"
  python3 -c 'import json,sys; print(json.dumps({"hook_event_name":"PostToolUse","session_id":"c1","cwd":sys.argv[1],"tool_name":"Bash","tool_input":{"command":sys.argv[2]},"tool_response":sys.argv[3]}))' \
    "$GR" "$2" "$3" | GOSLEEP_LAB_DIR="$1" bash "$LL" >/dev/null 2>&1
  jq -r 'select(.type=="vcs.commit") | .data.sha' "$1"/events/*.jsonl 2>/dev/null | head -1
}

# HEAD is an hour old — whatever this command did, it did not make that commit. A matching message is
# not evidence either: that is simply the previous commit still sitting there.
S="$(c1_sha "$WORK/c1-stale" 'git commit -q -m "GSL-01 the REAL commit"' '')"
[[ -z "$S" ]] && ok "C1: failed commit, hour-old HEAD -> sha-less line (no stale sha laundered)" \
  || bad "C1: bound a commit that never happened to the previous commit's sha ($S)"
# And seconds after a REAL commit, freshness alone would wave the phantom through: HEAD must be ITS OWN.
S="$(c1_sha "$WORK/c1-other" 'git commit -q -m "GSL-99 a commit that never happened"' '')"
[[ -z "$S" ]] && ok "C1: failed commit right after a real one -> sha-less (HEAD must be its OWN, not just fresh)" \
  || bad "C1: a fresh but UNRELATED HEAD ($S) was bound to a commit that never happened"

: > "$GR/b.txt"; git -C "$GR" add b.txt; git -C "$GR" commit -q -m "GSL-83 quiet commit"
NEWSHA="$(git -C "$GR" rev-parse --short HEAD)"
# The GSL-83 dogfooding fix must survive the guard: a real quiet commit still gets its sha from git.
S="$(c1_sha "$WORK/c1-quiet" 'git commit -q -m "GSL-83 quiet commit"' '')"
[[ "$S" == "$NEWSHA" ]] && ok "GSL-83 preserved: a REAL quiet commit still recovers its sha ($S)" \
  || bad "quiet-commit fallback regressed: got '$S', want '$NEWSHA'"
S="$(c1_sha "$WORK/c1-am" 'git commit -q -am "GSL-83 quiet commit"' '')"
[[ "$S" == "$NEWSHA" ]] && ok "the message is read from -am too (a cluster is still the subject git got)" \
  || bad "-am form lost the subject: got '$S', want '$NEWSHA'"

# m1 — git's echo is `[<branch> <sha>]`, and a branch name can be all-hex too. Anchor on the bracket,
# not on "the first token that looks like hex", or the BRANCH wins over the commit it printed.
S="$(c1_sha "$WORK/c1-hexbranch" 'git commit -m x' '[deadbee 1a2b3c4] GSL-99 subject')"
[[ "$S" == "1a2b3c4" ]] && ok "m1: [deadbee 1a2b3c4] -> the sha (1a2b3c4), not the hex-looking branch" \
  || bad "m1: a hex-looking branch name won over the real sha (got '$S')"
S="$(c1_sha "$WORK/c1-root" 'git commit -m x' '[main (root-commit) 9fceb02] first')"
[[ "$S" == "9fceb02" ]] && ok "m1: the root-commit echo still parses ([main (root-commit) 9fceb02])" \
  || bad "m1: the root-commit echo broke the parser (got '$S')"

echo "== fold: a cross-day correction retires the right line — and ONLY it (GSL-89) =="
FD="$WORK/fold-repo"; mkdir -p "$FD/docs/lab/events"
# Day A: seq 2 is a commit that will later be proven wrong.
{ printf '{"ts":"%sT10:00:00Z","run_id":"a","seq":1,"actor":"w","type":"pane.started","src":"hook:SessionStart","data":{}}\n' "$DA"
  printf '{"ts":"%sT10:05:00Z","run_id":"a","seq":2,"actor":"w","type":"vcs.commit","src":"hook:PostToolUse","data":{"sha":"RETIREME"}}\n' "$DA"
} > "$FD/docs/lab/events/$DA.jsonl"
# Day B: seq 2 is an INNOCENT BYSTANDER that happens to carry the same seq number as day A's seq 2 —
# seq is unique per FILE, not globally. seq 3 corrects day A across the boundary (qualified form);
# seq 5 corrects day B's own seq 4 with the bare form, which must keep working.
{ printf '{"ts":"%sT10:00:00Z","run_id":"b","seq":1,"actor":"w","type":"agent.idle","src":"hook:TeammateIdle","data":{}}\n' "$DB"
  printf '{"ts":"%sT10:01:00Z","run_id":"b","seq":2,"actor":"w","type":"agent.turn_ended","src":"hook:Stop","data":{}}\n' "$DB"
  printf '{"ts":"%sT10:02:00Z","run_id":"b","seq":3,"actor":"pf","type":"vcs.commit","src":"poll-fill","supersedes":"%s:2","data":{"sha":"c0rrect1"}}\n' "$DB" "$DA"
  printf '{"ts":"%sT10:03:00Z","run_id":"b","seq":4,"actor":"w","type":"vcs.commit","src":"hook:PostToolUse","data":{"sha":"SAMEDAYBAD"}}\n' "$DB"
  printf '{"ts":"%sT10:04:00Z","run_id":"b","seq":5,"actor":"pf","type":"vcs.commit","src":"poll-fill","supersedes":4,"data":{"sha":"c0rrect2"}}\n' "$DB"
} > "$FD/docs/lab/events/$DB.jsonl"
bash "$CH" --repo "$FD" --date "$DB" --no-poll --quiet --json >/dev/null 2>&1
FS="$FD/docs/lab/status.json"
[[ "$(jq -r '.events.by_type["vcs.commit"] // 0' "$FS")" == "2" ]] \
  && ok "both forms fold: 4 commit lines -> 2 events (cross-day AND same-day)" \
  || bad "fold count wrong: vcs.commit=$(jq -r '.events.by_type["vcs.commit"] // 0' "$FS")"
# THE regression guard. Read as a bare seq, a cross-day reference would retire day B's seq 2 — an
# unrelated event — instead of day A's. A correction that silently deletes a bystander is worse than
# the error it corrects, and it would be invisible: the timeline would simply be one event shorter.
[[ "$(jq -r '.events.by_type["agent.turn_ended"] // 0' "$FS")" == "1" ]] \
  && ok "the bystander holding the same seq in another file SURVIVES" \
  || bad "a cross-day correction retired an innocent event that merely shared its seq"
grep -q "RETIREME" "$FD/docs/lab/site/timeline.html" \
  && bad "the cross-day superseded line is still rendered" || ok "cross-day: the retired line is gone"
grep -q "SAMEDAYBAD" "$FD/docs/lab/site/timeline.html" \
  && bad "the same-day (bare seq) fold regressed" || ok "same-day (bare seq) fold still works"

# A day is WHEN IT HAPPENED, not which file it was written into. A commit recovered this morning from
# last night must not be counted as today's work — that is exactly the lie poll-fill's floor exists to
# prevent, and --ts would have reintroduced it if the grouping still keyed on the filename.
TSR="$WORK/ts-repo"; mkdir -p "$TSR/docs/lab"
GOSLEEP_LAB_DIR="$TSR/docs/lab" bash "$LL" --type cycle.started --actor smoke --data k=v --quiet
GOSLEEP_LAB_DIR="$TSR/docs/lab" bash "$LL" --type vcs.commit --src poll-fill --ts "${DA}T18:20:18Z" --data sha=backfil --quiet
bash "$CH" --repo "$TSR" --no-poll --quiet --json >/dev/null 2>&1
[[ "$(jq -r '.events.total' "$TSR/docs/lab/status.json")" == "2" \
   && "$(jq -r '.events.today' "$TSR/docs/lab/status.json")" == "1" ]] \
  && ok "a back-dated line sits in today's FILE but not in today's COUNT (a day is keyed on ts)" \
  || bad "a back-dated backfill was counted as today's work (today=$(jq -r '.events.today' "$TSR/docs/lab/status.json"))"

# End to end: poll-fill stamps the fact's OWN time — the one-line change the previous cycle predicted.
PT="$WORK/pf-ts"; mkdir -p "$PT/docs/lab/events"
printf '{"ts":"%sT00:00:00Z","run_id":"x","seq":1,"actor":"a","type":"pane.started","src":"hook:SessionStart","data":{}}\n' "$DA" \
  > "$PT/docs/lab/events/$DA.jsonl"
printf '[{"key":"GSL-998","status":"Done","updated":"%sT12:34:56Z","summary":"backdated"}]\n' "$DB" > "$WORK/jira-ts.json"
bash "$PF" --repo "$PT" --git-repo "$REPO_ROOT" --no-git --no-gh --jira-json "$WORK/jira-ts.json" --quiet >/dev/null 2>&1
cat "$PT/docs/lab/events/"*.jsonl | jq -se --arg t "${DB}T12:34:56Z" \
  'map(select(.data.key=="GSL-998"))[0] | .ts==$t and (.logged_at != null)' >/dev/null 2>&1 \
  && ok "poll-fill backfills at occurred_at, and still records when it learned it" \
  || bad "poll-fill stamps 'now' — every recovered fact lands on today's timeline"

# ════════════ GSL-95 / F5-S2: the deadline countdown on the Questions screen ════════════
#
# The defect this whole section exists to catch: a page BUILT at 23:00 saying "auto-applies in 2h",
# OPENED at 04:00, still saying "auto-applies in 2h". Every naive check passes on that page — the
# span is there, the attribute is there, the number is even correct for the instant it was made — and
# the page is lying to the owner in the one direction that matters, offering him two hours that were
# spent three hours ago. It is the staleness defect (REVIEW-gsl81 M1) wearing a different unit, and
# the lesson from that cycle is the one applied here: assert the RENDERED PROSE, not the mechanism.
#
# So the fixture puts a deadline 2h30m in the FUTURE, lets the page be built honestly, and then RUNS
# THE PAGE'S OWN CLIENT BUNDLE against a clock five hours later. A countdown frozen at build time
# passes everything above and fails this.
echo "== GSL-95 / F5-S2: the deadline countdown re-grades when the page is opened =="

# Its OWN repo. The chronicler fixture above has a test that counts open questions and reads the
# digest; three more DECISIONs dropped into its queue would silently rewrite that arithmetic, and a
# test that has to be kept in sync with an unrelated fixture is a test that will be "fixed" by
# deleting it. Three DECISIONs, one per state the countdown must tell apart — and no BLOCKER, which
# would bind the runway to 0h and change what the F5-S1 checks are measuring.
#
#   EXPIRED    — 3h gone. Must read PAST DUE at BUILD time: a reader with JS off is owed the truth too.
#   FUTURE     — 2h30m out. Honest at build, a LIE five hours later. This is the one the clock moves
#                past below; a countdown baked at build time passes every other check and fails that.
#   NODEADLINE — no clock at all. "waits for you", never "0h 0m", never overdue: an ABSENT deadline is
#                not an EXPIRED one (GSL-95 acceptance, verbatim).
QD="$WORK/f5s2"; rm -rf "$QD"; mkdir -p "$QD/docs/lab/events" "$QD/docs/lab/questions"
Q_ASKED="$(python3 -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(hours=6)).strftime('%Y-%m-%dT%H:%M:%SZ'))")"
Q_EXPIRED="$(python3 -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(hours=3)).strftime('%Y-%m-%dT%H:%M:%SZ'))")"
Q_FUTURE="$(python3 -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=2,minutes=30)).strftime('%Y-%m-%dT%H:%M:%SZ'))")"
printf '{"ts":"%s","run_id":"x","seq":1,"actor":"w1","type":"cycle.started","src":"emit","data":{}}\n' \
  "$Q_ASKED" > "$QD/docs/lab/events/$TODAY.jsonl"
{ printf '{"id":"q-f5s2-expired","ts":"%s","type":"DECISION","from":"smoke","task":"GSL-95","question":"expired: does the page still promise time that is already spent?","default":"status quo","default_rationale":"reversible","reversibility":"high","auto_apply_at":"%s","status":"open","seen_by":["smoke"]}\n' "$Q_ASKED" "$Q_EXPIRED"
  printf '{"id":"q-f5s2-future","ts":"%s","type":"DECISION","from":"smoke","task":"GSL-95","question":"future: honest at build, a lie five hours later?","default":"status quo","default_rationale":"reversible","reversibility":"high","auto_apply_at":"%s","status":"open","seen_by":["smoke"]}\n' "$Q_ASKED" "$Q_FUTURE"
  printf '{"id":"q-f5s2-nodeadline","ts":"%s","type":"DECISION","from":"smoke","task":"GSL-95","question":"no clock at all: absent is not expired.","default":"status quo","reversibility":"high","auto_apply_at":null,"status":"open","seen_by":["smoke"]}\n' "$Q_ASKED"
} > "$QD/docs/lab/questions/queue.jsonl"
bash "$CH" --repo "$QD" --no-poll --quiet --json >/dev/null 2>&1

QP="$QD/docs/lab/site/questions.html"
GEN="$(jq -r .generated_at "$QD/docs/lab/status.json")"

BT="$(python3 - "$QP" <<'PY'
import re, sys
h = open(sys.argv[1], encoding="utf-8").read()
spans = re.findall(r'<span class="(countdown[^"]*)" data-auto-apply-at="([^"]+)">(.*?)</span>', h)
exp = [(c, t.strip()) for c, _, t in spans if "PAST DUE" in t]
fut = [(c, t.strip()) for c, _, t in spans if t.strip().startswith("auto-applies in")]
print("SPANS=%d" % len(spans))
print("EXP_CLS=%s" % (exp[0][0] if exp else "-"))
print("EXP_TXT=%s" % (exp[0][1] if exp else "-"))
print("FUT_CLS=%s" % (fut[0][0] if fut else "-"))
print("FUT_TXT=%s" % (fut[0][1] if fut else "-"))
print("NODEADLINE=%s" % ("yes" if "No deadline" in h else "no"))
PY
)"

# 1. The expired deadline is expired AT BUILD TIME. A reader with JS off is owed the truth too, and
#    "past due" is the truth: nothing in this repo applies a default on a timer (tools/lab/lab-emit.sh
#    `list --due` is read by a live orchestrator, on its pulse), so an expired DECISION still sitting
#    in the OPEN list means the pulse never came.
grep -q 'EXP_TXT=PAST DUE by 3h' <<<"$BT" \
  && ok "F5-S2: a deadline 3h gone renders PAST DUE at BUILD time (the no-JS reader is not lied to)" \
  || bad "F5-S2: an expired deadline does not say so at build time ($(grep '^EXP_TXT=' <<<"$BT"))"
grep -q 'EXP_CLS=countdown past-due' <<<"$BT" \
  && ok "F5-S2: the expired countdown is visually marked (.past-due), not merely worded" \
  || bad "F5-S2: expired deadline carries no .past-due class ($(grep '^EXP_CLS=' <<<"$BT"))"

# 2. The future deadline counts DOWN, and is not dressed as overdue.
grep -qE 'FUT_TXT=auto-applies in 2h [0-9]+m' <<<"$BT" \
  && ok "F5-S2: a live deadline renders the PRD's own phrasing (auto-applies in Xh Ym)" \
  || bad "F5-S2: the countdown prose is not 'auto-applies in Xh Ym' ($(grep '^FUT_TXT=' <<<"$BT"))"
grep -q 'FUT_CLS=countdown$' <<<"$BT" \
  && ok "F5-S2: a deadline still in the future is NOT marked past-due" \
  || bad "F5-S2: a live deadline is dressed as overdue ($(grep '^FUT_CLS=' <<<"$BT"))"

# 3. Absent is not expired. A DECISION nobody set a clock on must say so — never "0h 0m", never red.
grep -q 'NODEADLINE=yes' <<<"$BT" \
  && ok "F5-S2: a DECISION with no deadline says 'No deadline' — absent is not expired" \
  || bad "F5-S2: a DECISION without a deadline renders no explanation (0h 0m by omission)"
grep -q 'SPANS=2' <<<"$BT" \
  && ok "F5-S2: exactly 2 countdowns for 3 DECISIONs — the clockless one was given no clock" \
  || bad "F5-S2: countdown count wrong ($(grep '^SPANS=' <<<"$BT")) — a deadline was invented or dropped"

# 4. THE test. Run the page's OWN inlined client bundle with a stub DOM and a moved clock. Nothing is
#    mocked but the environment: the code under test is the exact JS the owner's browser will run.
cat > "$WORK/regrade.mjs" <<'JS'
import { readFileSync } from "node:fs";
const [path, gen] = process.argv.slice(2);
const html = readFileSync(path, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);   // the client bundle: the one <script> with no attrs
if (!m) { console.log("NO_CLIENT=1"); process.exit(0); }
const code = m[1];

const spans = [...html.matchAll(/<span class="(countdown[^"]*)" data-auto-apply-at="([^"]+)">(.*?)<\/span>/g)]
  .map(([, cls, iso, txt]) => ({ iso, cls, text: txt.trim() }));

function open(nowMs) {
  const els = spans.map((s) => {
    const el = { dataset: { autoApplyAt: s.iso }, textContent: s.text, past: s.cls.includes("past-due") };
    el.classList = { toggle: (c, on) => { if (c === "past-due") el.past = on; } };
    return el;
  });
  const document = {
    getElementById: (id) => (id === "staleness" ? { dataset: { generatedAt: gen } } : null),
    querySelectorAll: () => els,
  };
  // `Date` is passed in, so the page's clock is ours. Everything else is the real bundle.
  new Function("document", "setInterval", "Date", code)(
    document, () => 0, { now: () => nowMs, parse: (s) => Date.parse(s) },
  );
  return els;
}

const built = Date.parse(gen);
const i = spans.findIndex((s) => s.text.startsWith("auto-applies in"));
if (i < 0) { console.log("NO_FUTURE=1"); process.exit(0); }

const later = open(built + 5 * 3600 * 1000)[i];   // the owner opens it five hours after it was built
const slow  = open(built - 5 * 3600 * 1000)[i];   // ...on a laptop whose clock runs five hours slow
console.log("LATER_TXT=" + later.textContent);
console.log("LATER_PAST=" + later.past);
console.log("SLOW_TXT=" + slow.textContent);
JS
RG="$(node "$WORK/regrade.mjs" "$QP" "$GEN" 2>&1)"

grep -q 'LATER_TXT=PAST DUE' <<<"$RG" && grep -q 'LATER_PAST=true' <<<"$RG" \
  && ok "F5-S2 ⭐ opened 5h after the build, a deadline that has since passed re-grades itself to PAST DUE" \
  || bad "F5-S2 ⭐ the countdown is FROZEN at build time — a page opened at 04:00 still promises the 2h it had at 23:00 ($RG)"

# And the guard in the other direction. The staleness banner may never SOFTEN its verdict; a countdown
# may never LENGTHEN itself. A reader whose laptop clock is slow must not be handed hours the deadline
# does not have — so the clock the countdown reads is max(now, generated_at), and a broken clock can
# only ever leave the build-time verdict standing.
grep -qE 'SLOW_TXT=auto-applies in 2h [0-9]+m' <<<"$RG" \
  && ok "F5-S2: a browser clock 5h SLOW buys the deadline no extra time (never lengthens; max(now, built))" \
  || bad "F5-S2: a slow browser clock lengthened the countdown — the page argued itself out of a deadline ($RG)"

# ───────────────── GSL-96 (F5-S3): the Tasks board, keyed by Jira ─────────────────
# A repo of its very own, with a REAL git history, because that is the thing under test: the epic
# rollup reads membership off the TOPOLOGY (one branch per epic, one commit per task, regular merge).
#
#   main ──●───────────────────●(merge #999: GSL-700-alpha)──●  <- trunk
#           \                 /                               \
#            ●GSL-701 ●GSL-702                                 ●GSL-801  (GSL-800-beta, NOT merged)
#
# GSL-701 was polled and is Done. GSL-702 has a COMMIT AND NO POLL — that is the row the whole board
# turns on, and it must read `unknown`. GSL-702 also has no GitHub issue, while the mirror IS readable
# (injected below): so its GH cell must be an honest dash, not a plausible /issues/702.
FD="$WORK/f5s3"; rm -rf "$FD"; mkdir -p "$FD/docs/lab/events"
git init -q -b main "$FD" 2>/dev/null || { git init -q "$FD"; git -C "$FD" checkout -q -b main 2>/dev/null; }
git -C "$FD" config user.email smoke@gosleep.local; git -C "$FD" config user.name smoke
gc() { git -C "$FD" commit -q --allow-empty -m "$1"; }
gc "chore: seed"
git -C "$FD" checkout -q -b GSL-700-alpha
gc "GSL-701 [Tooling] alpha one"
gc "GSL-702 [Tooling] alpha two"
git -C "$FD" checkout -q main
git -C "$FD" merge -q --no-ff -m "Merge pull request #999 from org/GSL-700-alpha" GSL-700-alpha
git -C "$FD" checkout -q -b GSL-800-beta
gc "GSL-801 [UI] beta one"
git -C "$FD" checkout -q main

# The Jira status of GSL-701, polled TWO HOURS before this build. Nothing has ever polled GSL-702.
F_POLLED="$(python3 -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(hours=2)).strftime('%Y-%m-%dT%H:%M:%SZ'))")"
printf '{"ts":"%s","run_id":"x","seq":1,"actor":"poll-fill","type":"tracker.issue.updated","src":"poll-fill","data":{"key":"GSL-701","status":"Done","summary":"alpha one","occurred_at":"%s"}}\n' \
  "$F_POLLED" "$F_POLLED" > "$FD/docs/lab/events/$TODAY.jsonl"

# The GitHub mirror, handed to the build in a file (GOSLEEP_GH_JSON) exactly as `gh` would return it.
# The laboratory holds no credentials (C1) and smoke must be hermetic — but a test that only ever sees
# the DEGRADED path never sees the column it is guarding, and that column is half of F5-S3.
cat > "$FD/gh.json" <<'JSON'
{"prs": [{"number": 999, "title": "GSL-700 the alpha epic", "state": "MERGED",
          "url": "https://github.com/org/repo/pull/999", "headRefName": "GSL-700-alpha"}],
 "issues": [{"number": 700, "title": "GSL-700: [Repo] the alpha epic", "state": "CLOSED",
             "url": "https://github.com/org/repo/issues/700", "labels": [{"name": "epic"}]},
            {"number": 701, "title": "GSL-701: [Tooling] alpha one", "state": "CLOSED",
             "url": "https://github.com/org/repo/issues/701", "labels": [{"name": "task"}]},
            {"number": 800, "title": "GSL-800: [Repo] the beta epic", "state": "OPEN",
             "url": "https://github.com/org/repo/issues/800", "labels": [{"name": "epic"}]},
            {"number": 801, "title": "GSL-801: [UI] beta one", "state": "OPEN",
             "url": "https://github.com/org/repo/issues/801", "labels": [{"name": "task"}]}]}
JSON
GOSLEEP_GH_JSON="$FD/gh.json" bash "$CH" --repo "$FD" --no-poll --quiet --json >/dev/null 2>&1
FB="$FD/docs/lab/render_bundle.json"; FP="$FD/docs/lab/site/tasks.html"

# 1. The merged epic folds up the commits its MERGE COMMIT actually carried — not a PR-body checklist,
#    which is prose we write by hand and which reports the epic we MEANT to ship.
[[ "$(jq -r '.tasks.epics[] | select(.key=="GSL-700") | .membership' "$FB" 2>/dev/null)" == "merge-commit" \
   && "$(jq -r '[.tasks.epics[] | select(.key=="GSL-700") | .tasks[]] | sort | join(",")' "$FB" 2>/dev/null)" == "GSL-701,GSL-702" ]] \
  && ok "F5-S3: a merged epic rolls up the tasks its merge commit carried (mc^1..mc^2)" \
  || bad "F5-S3: merged-epic membership wrong ($(jq -c '.tasks.epics[]|select(.key=="GSL-700")|{membership,tasks}' "$FB" 2>/dev/null))"

# 2. ...and the epic still in flight rolls up its branch. This is the one the owner is standing in.
[[ "$(jq -r '.tasks.epics[] | select(.key=="GSL-800") | .membership' "$FB" 2>/dev/null)" == "branch" \
   && "$(jq -r '[.tasks.epics[] | select(.key=="GSL-800") | .tasks[]] | join(",")' "$FB" 2>/dev/null)" == "GSL-801" ]] \
  && ok "F5-S3: an epic in flight rolls up the branch the trunk does not carry yet" \
  || bad "F5-S3: in-flight epic membership wrong ($(jq -c '.tasks.epics[]|select(.key=="GSL-800")|{membership,tasks}' "$FB" 2>/dev/null))"

# 3. The epic shows its PR AND its state (the invariant is one PR per epic).
[[ "$(jq -r '.tasks.epics[] | select(.key=="GSL-700") | .pr.number' "$FB" 2>/dev/null)" == "999" \
   && "$(jq -r '.tasks.epics[] | select(.key=="GSL-700") | .pr.state' "$FB" 2>/dev/null)" == "MERGED" ]] \
  && ok "F5-S3: the epic shows its PR and the PR's state" \
  || bad "F5-S3: the epic's PR is missing or stateless"

# 4. AN EPIC WITH NO PR SAYS SO. It does not borrow its own GitHub ISSUE number: issues and PRs share
#    one numbering space, so the wrong link would not 404 — it would RESOLVE, on a real page that is
#    not the thing the owner clicked. (GSL-90 is in exactly this state today: branch pushed, no PR.)
PRLESS="$(python3 - "$FP" <<'PY'
import re, sys
h = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r'<details class="epic" data-epic="GSL-800".*?</details>', h, re.S)
blk = m.group(0) if m else ""
print("BLOCK=%s|SAYS_NONE=%s|PR_LINK=%s" % ("yes" if blk else "no",
                                            "yes" if 'data-pr="none"' in blk else "no",
                                            "yes" if "/pull/" in blk else "no"))
PY
)"
grep -q 'SAYS_NONE=yes' <<<"$PRLESS" && grep -q 'PR_LINK=no' <<<"$PRLESS" \
  && ok "F5-S3: an epic with no PR says 'no PR' — it does not dress its issue number as one" \
  || bad "F5-S3: the PR-less epic either stays silent or invented a pull-request link ($PRLESS)"

# 5. ⭐ THE ONE THAT MATTERS. GSL-702 has a commit and no poll. A board that reads a commit as "Done"
#    passes every other check on this page and lies in the single column the owner uses to decide
#    whether he can go to sleep. 92 of 101 real rows are `unknown` for exactly this reason.
ST702="$(python3 - "$FP" <<'PY'
import re, sys
h = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r'<tr id="task-GSL-702">(.*?)</tr>', h, re.S)
if not m: print("NO_ROW"); raise SystemExit
cells = re.findall(r"<td[^>]*>(.*?)</td>", m.group(1), re.S)
status = re.sub(r"<[^>]+>", "", cells[2]) if len(cells) > 2 else "?"
print("STATUS=%s|HAS_COMMIT=%s" % (status.strip(), "yes" if "/commit/" in m.group(1) or len(cells) > 4 and cells[4].strip() else "no"))
PY
)"
grep -q 'STATUS=unknown' <<<"$ST702" && ! grep -qi 'STATUS=.*done' <<<"$ST702" \
  && ok "F5-S3 ⭐ a task with a commit and no poll stays 'unknown' — a commit is not a Jira status" \
  || bad "F5-S3 ⭐ the board INFERRED a status from a commit — the tasty-lunch default ($ST702)"

# 6. The mirror was read, so the GH column is filled — for the keys that ARE in it. GSL-702 has no
#    issue, and its cell is a dash: the column does not extrapolate /issues/702 from its neighbours.
[[ "$(jq -r '.tasks.gh_issue_links' "$FB" 2>/dev/null)" == "true" ]] \
  && grep -q 'href="https://github.com/org/repo/issues/701"' "$FP" \
  && ! grep -q 'issues/702' "$FP" \
  && ok "F5-S3: GH issue links come from the mirror; a key absent from it gets a dash, not a guess" \
  || bad "F5-S3: the GH column is missing, or it invented an issue number for GSL-702"

# 7. NO LINK LEADS NOWHERE (F5-S3, verbatim). Every in-page anchor the rollup emits must land on a row
#    that exists. This is a MECHANISM check: it fails if the anchor scheme and the row ids ever drift.
ANCH="$(python3 - "$FP" <<'PY'
import re, sys
h = open(sys.argv[1], encoding="utf-8").read()
anchors = set(re.findall(r'href="#task-(GSL-\d+)"', h))
ids = set(re.findall(r'id="task-(GSL-\d+)"', h))
print("ANCHORS=%d|DANGLING=%s" % (len(anchors), ",".join(sorted(anchors - ids)) or "none"))
PY
)"
grep -q 'DANGLING=none' <<<"$ANCH" && ! grep -q 'ANCHORS=0' <<<"$ANCH" \
  && ok "F5-S3: every epic->task anchor lands on a row that exists (no link leads nowhere)" \
  || bad "F5-S3: the rollup links to a task row that is not on the page ($ANCH)"

# 8. ⭐⭐ THE AGE KEEPS AGING. The status column is fed by hand (C1), so the age printed beside it is
#    the ONLY thing standing between the owner and a status he thinks is current. Baked at build time,
#    it understates its own staleness by exactly the hours the owner spent asleep — the reassuring
#    direction, again. So the page's OWN client bundle is executed here with a stub DOM and a moved
#    clock: nothing is mocked but the environment.
F_GEN="$(jq -r .generated_at "$FD/docs/lab/status.json")"
cat > "$WORK/ages.mjs" <<'JS'
import { readFileSync } from "node:fs";
const [path, gen] = process.argv.slice(2);
const html = readFileSync(path, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);          // the inlined client bundle
if (!m) { console.log("NO_CLIENT=1"); process.exit(0); }

const ages = [...html.matchAll(/<span class="age" data-age-ts="([^"]+)"[^>]*>(.*?)<\/span>/g)]
  .map(([, iso, txt]) => ({ iso, text: txt.trim() }));

function open(nowMs) {
  const els = ages.map((a) => ({ dataset: { ageTs: a.iso }, textContent: a.text }));
  const document = {
    getElementById: (id) => (id === "staleness" ? { dataset: { generatedAt: gen } } : null),
    querySelectorAll: (sel) => (sel.includes("age-ts") ? els : []),
  };
  new Function("document", "setInterval", "Date", m[1])(
    document, () => 0, { now: () => nowMs, parse: (s) => Date.parse(s) },
  );
  return els;
}
const built = Date.parse(gen);
console.log("BUILT_TXT=" + (ages[0]?.text ?? "-"));
console.log("LATER_TXT=" + (open(built + 5 * 3600 * 1000)[0]?.textContent ?? "-"));
console.log("SLOW_TXT="  + (open(built - 5 * 3600 * 1000)[0]?.textContent ?? "-"));
JS
AG="$(node "$WORK/ages.mjs" "$FP" "$F_GEN" 2>&1)"

grep -qE 'BUILT_TXT=2h [0-9]+m old' <<<"$AG" \
  && ok "F5-S3: at build time the status age is honest for generated_at (the no-JS reader is not lied to)" \
  || bad "F5-S3: the build-time status age is wrong ($(grep '^BUILT_TXT=' <<<"$AG"))"

grep -qE 'LATER_TXT=7h [0-9]+m old' <<<"$AG" \
  && ok "F5-S3 ⭐ opened 5h after the build, a 2h-old status re-grades to 7h old — the age keeps aging" \
  || bad "F5-S3 ⭐ the status age is FROZEN at build time — a page read at 04:00 still calls a stale poll fresh ($AG)"

grep -qE 'SLOW_TXT=2h [0-9]+m old' <<<"$AG" \
  && ok "F5-S3: a browser clock 5h SLOW cannot make the tracker look fresher than the build knew" \
  || bad "F5-S3: a slow browser clock SHRANK the age — the page argued itself back to freshness ($AG)"

# ────────── GSL-97 (R5.2/R5.3): Timeline + Library + the client filter over an inlined island ──────────
# Its own repo, with a hand-built event log: the whole point is to hold a row of EVERY severity at once,
# including the two the real log does not happen to contain tonight — an incident, and a type neither
# emitter has ever taught this build about.
#
#   alpha vcs.commit  hook:PostToolUse  -> info
#   beta  context.pre_compact hook:PreCompact -> warn
#   alpha api.failure hook:StopFailure  -> INCIDENT   (the row the owner is scanning for at 03:00)
#   beta  vcs.commit  poll-fill         -> info       (same type as row 1, different provenance)
#   alpha wat.mystery emit              -> UNKNOWN    (a type the severity table does not know)
FT="$WORK/f5-timeline"; rm -rf "$FT"; mkdir -p "$FT/docs/lab/events"
git init -q -b main "$FT" 2>/dev/null || { git init -q "$FT"; git -C "$FT" checkout -q -b main 2>/dev/null; }
git -C "$FT" config user.email smoke@gosleep.local; git -C "$FT" config user.name smoke
git -C "$FT" commit -q --allow-empty -m "chore: seed"

TL="$FT/docs/lab/events/$TODAY.jsonl"
: > "$TL"
tev() { printf '{"ts":"%sT0%d:00:00Z","run_id":"x","seq":%d,"actor":"%s","type":"%s","src":"%s","data":%s}\n' \
        "$TODAY" "$2" "$2" "$3" "$4" "$5" "${6:-\{\}}" >> "$TL"; }
tev _ 1 alpha vcs.commit         "hook:PostToolUse" '{"sha":"aaa1111"}'
tev _ 2 beta  context.pre_compact "hook:PreCompact"  '{"trigger":"auto"}'
tev _ 3 alpha api.failure         "hook:StopFailure" '{"error_type":"rate_limit"}'
tev _ 4 beta  vcs.commit          "poll-fill"        '{"sha":"bbb2222"}'
tev _ 5 alpha wat.mystery         "emit"             '{"key":"GSL-999"}'

# The Library's shelves. Note the two shapes an incident comes in: a markdown post-mortem, and a
# whole report DIRECTORY whose artifact is the index.html inside it (a directory is not a link).
mkdir -p "$FT/docs/handoff" "$FT/docs/dev_history" "$FT/docs/reviews" "$FT/docs/prd" \
         "$FT/docs/research/2026-01-01-topic" "$FT/docs/reports/plain" \
         "$FT/docs/reports/bugs" "$FT/docs/reports/token-incident-2026-01-03" "$FT/docs/lab/digest"
printf '# Handoff one\n'        > "$FT/docs/handoff/01-fixture.md"
printf '# GSL-1 dev history\n'  > "$FT/docs/dev_history/GSL-1-phase1-x.md"
printf '# Review of gsl1\n'     > "$FT/docs/reviews/REVIEW-gsl1.md"
printf '# Research thing\n'     > "$FT/docs/research/2026-01-01-topic/01-thing.md"
printf '# The fixture incident\n' > "$FT/docs/reports/bugs/2026-01-02-fixture-incident.md"
printf '<title>Plain report</title>\n' > "$FT/docs/reports/plain/index.html"
printf '<title>Token overage</title>\n' > "$FT/docs/reports/token-incident-2026-01-03/index.html"
printf '# PRD\n'                > "$FT/docs/prd/PRD-x.md"
printf '# Morning\n'            > "$FT/docs/lab/digest/2026-01-01-morning.md"

bash "$CH" --repo "$FT" --no-poll --quiet --json >/dev/null 2>&1
TB="$FT/docs/lab/render_bundle.json"; TP="$FT/docs/lab/site/timeline.html"; LP="$FT/docs/lab/site/library.html"

# 1. THE ISLAND IS THE WIRING. The filter matches on records, not on rendered cells, so the island must
#    exist, parse, and describe EXACTLY the rows the page rendered. If those two counts ever drift, the
#    client silently filters a table it is not looking at — hence a mechanism check, not a string check.
ISL="$(python3 - "$TP" <<'PY'
import json, re, sys
h = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r'<script id="timeline-index" type="application/json">(.*?)</script>', h, re.S)
if not m: print("NO_ISLAND"); raise SystemExit
idx = json.loads(m.group(1))
dom = len(re.findall(r'<tr[^>]*data-row="\d+"', h))
print("ROWS=%d|DOM=%d|FACETS=%s|TOTAL=%d" % (
    len(idx["rows"]), dom, ",".join(f["key"] for f in idx["facets"]), idx["total"]))
PY
)"
grep -q 'ROWS=5|DOM=5' <<<"$ISL" && grep -q 'FACETS=actor,type,severity,src' <<<"$ISL" \
  && ok "GSL-97: the inlined island describes exactly the rows the page rendered (actor/type/severity/src)" \
  || bad "GSL-97: the island and the rendered table disagree, or a facet is missing ($ISL)"

# 2. ⭐ AN INCIDENT IS MARKED IN THE MARKUP, NOT BY A SCRIPT. The owner reads this page from GitHub's
#    blob view on a phone, where no script of ours ever runs. An incident marker that needs JS is a
#    marker that is absent in the one place the page is read at 02:00.
#    Both this check and the next one read the MARKUP, never the island: what is being claimed is what
#    the reader SEES with nothing running. The island's own grades are guarded separately, by the filter
#    tests below — so a break in one cannot hide behind the other.
SEV="$(python3 - "$TP" <<'PY'
import re, sys
h = open(sys.argv[1], encoding="utf-8").read()
# The class must be on the ROW, in the HTML on disk -- before anything executes.
rows = dict(re.findall(r'<tr[^>]*data-row="(\d+)"[^>]*class="sev-([a-z]+)"', h))
print("ROW_API=%s|ROW_MYST=%s|INCIDENT_ROWS=%d" % (
    rows.get("2"), rows.get("0"), sum(1 for v in rows.values() if v == "incident")))
PY
)"
grep -q 'ROW_API=incident' <<<"$SEV" && grep -q 'INCIDENT_ROWS=1' <<<"$SEV" \
  && ok "GSL-97 ⭐ the api.failure row is marked an incident in the HTML itself — no script required" \
  || bad "GSL-97 ⭐ the incident marker is missing from the build-time markup ($SEV)"

# 3. ⭐ AN UNKNOWN TYPE IS `unknown`, NEVER `info`. This is the tasty-lunch default wearing a colour:
#    grade an event you do not recognise as info and the day someone emits `breaker.tripped` the feed
#    files the fleet going down as a green row, in the column the owner scans for red.
grep -q 'ROW_MYST=unknown' <<<"$SEV" && ! grep -q 'ROW_MYST=info' <<<"$SEV" \
  && ok "GSL-97 ⭐ a type the severity table does not know grades as 'unknown' — not as 'info'" \
  || bad "GSL-97 ⭐ an unclassified event type was coloured as routine ($SEV)"

# 4. ⭐ THE TABLE MAY LAG THE EMITTERS; IT MAY NOT LIE ABOUT THE GAP. Every type lab-log.sh and
#    lab-emit.sh can write must be classified in severity.ts. This is the check that keeps rule 3 from
#    becoming a slow leak: without it, `unknown` degrades from a safety property into a growing pile.
DRIFT="$(python3 - "$REPO_ROOT" <<'PY'
import os, re, sys
root = sys.argv[1]
EXT = {"jsonl","json","md","sh","py","lock","err","txt","html","log","tmp","mjs","tsx","ts"}
def types(path, block=None):
    s = open(os.path.join(root, path), encoding="utf-8").read()
    if block:
        m = re.search(block, s, re.S); s = m.group(1) if m else ""
    return {c for c in re.findall(r'"([a-z][a-z_]*(?:\.[a-z_]+)+)"', s)
            if c.rsplit(".", 1)[-1] not in EXT}
emitted = types("tools/lab/lab-log.sh") | types("tools/lab/lab-emit.sh", r"SEMANTIC_TYPES\s*=\s*\((.*?)\n\)")
graded  = types("tools/lab/ui/src/severity.ts")
print("EMITTED=%d|UNGRADED=%s" % (len(emitted), ",".join(sorted(emitted - graded)) or "none"))
PY
)"
grep -q 'UNGRADED=none' <<<"$DRIFT" && ! grep -q 'EMITTED=0' <<<"$DRIFT" \
  && ok "GSL-97 ⭐ every event type the emitters can write is graded in severity.ts (no silent lag)" \
  || bad "GSL-97 ⭐ severity.ts has fallen behind the emitters — those types would grade 'unknown' ($DRIFT)"

# 5. PROVENANCE SURVIVED THE PORT. hook / emit / poll-fill are three different KINDS of true, and the
#    colour is the only thing on the row that says which. A line reconciled after the fact and a line a
#    hook watched happen must never look the same.
#     Scoped to the FEED ROWS, not the page: the aggregate card at the bottom carries the same tags, and
#     a check that counts those would stay green with the feed's own colour column ripped out.
PROV="$(python3 - "$TP" <<'PY'
import re, sys
from collections import Counter
h = open(sys.argv[1], encoding="utf-8").read()
feed = re.search(r'<table id="timeline-rows">(.*?)</table>', h, re.S)
c = Counter(re.findall(r'<span class="tag (hook|emit|poll)">', feed.group(1) if feed else ""))
print("HOOK=%d|EMIT=%d|POLL=%d" % (c["hook"], c["emit"], c["poll"]))
PY
)"
grep -q 'HOOK=3|EMIT=1|POLL=1' <<<"$PROV" \
  && ok "GSL-97: the src provenance colour survives the port to TS (hook / emit / poll-fill all render)" \
  || bad "GSL-97: a provenance class is missing from the feed — the three kinds of true look alike ($PROV)"

# 6. THE PAGE WORKS WITH JS OFF. Every row is in the HTML on disk, and the filter bar ships `hidden`:
#    a reader with no JS gets the whole list and NOT a <select> he can move that changes nothing.
NOJS="$(python3 - "$TP" <<'PY'
import re, sys
h = open(sys.argv[1], encoding="utf-8").read()
bar = re.search(r'<div class="filters"[^>]*>', h)
print("ROWS=%d|BAR_HIDDEN=%s|COUNT=%s" % (
    len(re.findall(r'<tr[^>]*data-row="\d+"', h)),
    "yes" if bar and " hidden" in bar.group(0) else "no",
    "yes" if 'id="timeline-count"' in h else "no"))
PY
)"
grep -q 'ROWS=5|BAR_HIDDEN=yes|COUNT=yes' <<<"$NOJS" \
  && ok "GSL-97: with JS off the full feed is already on the page, and the dead filter bar is hidden" \
  || bad "GSL-97: the no-JS page is not the whole list, or it offers a control that cannot work ($NOJS)"

# 7-10. ⭐ THE FILTER ITSELF. The page's OWN client bundle is executed against a stub DOM: nothing is
#       mocked but the environment. It is asked to narrow, to hide everything, to reset — and, in the
#       last run, to survive an island that disagrees with the table it is filtering.
cat > "$WORK/filters.mjs" <<'JS'
import { readFileSync } from "node:fs";
// foFacet/foWant drive the fail-open run on a DIFFERENT axis from the narrowing run on purpose: share
// one axis and a single break reddens both checks, which makes them look independent while testing the
// same line. The fail-open row must be one the filter would otherwise have HIDDEN — otherwise it stays
// on screen for the boring reason and the check proves nothing.
const [path, barId, facet, want, other, otherWant, foFacet, foWant] = process.argv.slice(2);
const html = readFileSync(path, "utf8");

const CLIENT = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];        // the inlined bundle
const barHtml = html.match(new RegExp(`<div class="filters" id="${barId}"[\\s\\S]*?</div>`))?.[0];
if (!CLIENT || !barHtml) { console.log("NO_CLIENT_OR_BAR=1"); process.exit(0); }

const attr = (k) => barHtml.match(new RegExp(`data-filter-${k}="([^"]+)"`))?.[1] ?? "";
const ISLAND = attr("island"), SCOPE = attr("scope"), COUNT = attr("count");
// The wiring is only real if the ids the bar points at are ids that EXIST on the page.
const wired = [ISLAND, SCOPE, COUNT].every((id) => html.includes(`id="${id}"`));
const islandText = html.match(new RegExp(`<script id="${ISLAND}"[^>]*>([\\s\\S]*?)</script>`))?.[1] ?? "null";
const facets = [...barHtml.matchAll(/data-facet="([^"]+)"/g)].map((m) => m[1]);
const hasSearch = /data-search=/.test(barHtml);
const rowIds = [...html.matchAll(/<tr[^>]*data-row="(\d+)"/g)].map((m) => m[1]);

const el = (o) => ({ _l: {}, addEventListener(e, f) { (this._l[e] ||= []).push(f); },
                     fire(e) { (this._l[e] || []).forEach((f) => f()); }, ...o });

function run(dropLast) {
  const idx = JSON.parse(islandText);
  if (dropLast) idx.rows.pop();                       // the island now disagrees with the DOM
  const rows = rowIds.map((i) => el({ dataset: { row: i }, hidden: false }));
  const sels = facets.map((k) => el({ dataset: { facet: k }, value: "" }));
  const search = hasSearch ? el({ dataset: {}, value: "" }) : null;
  const reset = el({ dataset: {} });
  const count = el({ textContent: "", className: "" });
  const bar = el({
    dataset: { filterIsland: ISLAND, filterScope: SCOPE, filterCount: COUNT }, hidden: true,
    querySelectorAll: (s) => (s.includes("data-facet") ? sels : []),
    querySelector: (s) => (s.includes("data-search") ? search : s.includes("data-filter-reset") ? reset : null),
  });
  const scope = { querySelectorAll: (s) => (s.includes("data-row") ? rows : []) };
  const byId = { [ISLAND]: { textContent: JSON.stringify(idx) }, [SCOPE]: scope, [COUNT]: count };
  const document = {
    getElementById: (id) => byId[id] ?? null,
    querySelectorAll: (s) => (s.includes("data-filter-island") ? [bar] : []),
  };
  new Function("document", "setInterval", "Date", CLIENT)(document, () => 0, Date);
  const pick = (k, v) => { const s = sels.find((x) => x.dataset.facet === k); s.value = v; s.fire("change"); };
  const shown = () => rows.filter((r) => !r.hidden).map((r) => r.dataset.row).join(",");
  return { bar, count, reset, pick, shown };
}

const a = run(false);
console.log("WIRED=" + (wired ? "yes" : "no"));
console.log("BAR_SHOWN_AFTER_JS=" + (a.bar.hidden ? "no" : "yes"));
console.log("COUNT_INIT=" + a.count.textContent);
a.pick(facet, want);
console.log("COUNT_ONE=" + a.count.textContent);
console.log("SHOWN_ONE=" + a.shown());
a.pick(other, otherWant);                              // a second facet that no surviving row satisfies
console.log("COUNT_NONE=" + a.count.textContent);
console.log("CLASS_NONE=" + a.count.className);
a.reset.fire("click");
console.log("COUNT_RESET=" + a.count.textContent);

const b = run(true);                                   // island short one record -> that row is UNKNOWN to it
b.pick(foFacet || facet, foWant || want);
console.log("SHOWN_FAILOPEN=" + b.shown());
JS
# Narrowing run: severity=incident (1 row). Then + actor=beta, which no incident row satisfies -> 0 rows.
# Fail-open run: actor=beta. The record the island is missing describes row 4, which is alpha — so the
# filter WOULD hide it, and it staying is the fail-open rule and nothing else.
TF="$(node "$WORK/filters.mjs" "$TP" timeline-filter severity incident actor beta actor beta 2>&1)"

grep -q 'WIRED=yes' <<<"$TF" && grep -q 'BAR_SHOWN_AFTER_JS=yes' <<<"$TF" \
  && grep -q 'COUNT_INIT=all 5 shown' <<<"$TF" \
  && ok "GSL-97: the filter bar wires to ids that exist and is revealed only once it can actually filter" \
  || bad "GSL-97: the filter never came alive — its island, table or count element is not where it points ($TF)"

# ⭐ Narrowing works, from file://, with no network — and the page SAYS how many it is hiding.
grep -q 'SHOWN_ONE=2' <<<"$TF" && grep -q 'COUNT_ONE=1 of 5 shown — 4 hidden by the filter' <<<"$TF" \
  && ok "GSL-97 ⭐ severity=incident narrows to the one incident row, and the page says '4 hidden'" \
  || bad "GSL-97 ⭐ the filter did not narrow to the incident, or it hid rows without saying so ($TF)"

# ⭐⭐ THE ONE THAT MATTERS. A filter that hides everything leaves an empty table, and an empty table is
#     the exact silhouette of a quiet night. If the page does not say, in words, that the emptiness is
#     the READER'S filter, this feature has re-introduced the class of lie Phase 4 spent itself removing.
grep -q 'COUNT_NONE=0 of 5 shown — the filter is hiding every row' <<<"$TF" \
  && grep -q 'CLASS_NONE=.*none' <<<"$TF" \
  && ok "GSL-97 ⭐⭐ a filter that hides EVERY row says so loudly — an empty table is never left to speak for itself" \
  || bad "GSL-97 ⭐⭐ the filter emptied the table SILENTLY — a forgotten filter now reads as a quiet night ($TF)"

grep -q 'COUNT_RESET=all 5 shown' <<<"$TF" \
  && ok "GSL-97: clear puts every row back and the count says so" \
  || bad "GSL-97: clear did not restore the full list ($TF)"

# ⭐ FAIL-OPEN. If the island and the table ever disagree, an unclassified row STAYS. Hiding a row we
#   could not classify is an invisible subtraction from the feed the owner reads to learn what broke.
#   Rows 1 and 3 are beta's. Row 4 is alpha's — the filter would hide it, and the island has no record
#   for it, so the ONLY reason it can still be on screen is the fail-open rule.
grep -q 'SHOWN_FAILOPEN=1,3,4' <<<"$TF" \
  && ok "GSL-97 ⭐ a row the island does not describe survives the filter — hiding it would subtract in silence" \
  || bad "GSL-97 ⭐ a row missing from the island was hidden — the filter subtracts rows it cannot classify ($TF)"

# 11. THE LIBRARY INDEXES WHAT THE PRD NAMED. reviews / research / RCA were simply not indexed before
#     this task: the shelves existed on disk and no page pointed at them.
LIB="$(jq -r '[.library.sections[] | "\(.key)=\(.count)"] | join("|")' "$TB" 2>/dev/null)"
grep -q 'reviews=1' <<<"$LIB" && grep -q 'research=1' <<<"$LIB" && grep -q 'rca=2' <<<"$LIB" \
  && ok "GSL-97: the cross-index covers reviews, research and the incident post-mortems (PRD R5.2)" \
  || bad "GSL-97: a shelf the PRD names is not indexed ($LIB)"

# 12. A DIRECTORY IS NOT A LINK, AND NOTHING IS SHELVED TWICE. The token-overage post-mortem is a report
#     DIRECTORY: its artifact is the index.html inside. It belongs on the RCA shelf, and it must not also
#     appear under Reports — one artifact, two entries, and the reader asks which of them is the real one.
DUP="$(python3 - "$TB" <<'PY'
import json, sys
lib = json.load(open(sys.argv[1], encoding="utf-8"))["library"]
hrefs = [i["href"] for s in lib["sections"] for i in s["items"]]
rca = [i["href"] for s in lib["sections"] if s["key"] == "rca" for i in s["items"]]
rep = [i["href"] for s in lib["sections"] if s["key"] == "reports" for i in s["items"]]
dupes = {h for h in hrefs if hrefs.count(h) > 1}
print("DUPES=%s|RCA_HAS_INDEX=%s|REPORTS_CLAIMED_IT=%s|TOTAL=%d" % (
    ",".join(sorted(dupes)) or "none",
    "yes" if any(h.endswith("token-incident-2026-01-03/index.html") for h in rca) else "no",
    "yes" if any("token-incident" in h for h in rep) else "no",
    lib["total"]))
PY
)"
grep -q 'DUPES=none' <<<"$DUP" && grep -q 'RCA_HAS_INDEX=yes' <<<"$DUP" && grep -q 'REPORTS_CLAIMED_IT=no' <<<"$DUP" \
  && ok "GSL-97: an incident REPORT resolves to its index.html and is shelved once, under RCA" \
  || bad "GSL-97: the incident directory was linked as a folder, or shelved twice ($DUP)"

# 13. EVERY LINK IN THE LIBRARY OPENS. The Library is the memory that survives the 30-day retention; a
#     dead link in it is an artifact that has been forgotten while still being listed.
LINKS="$(python3 - "$LP" "$FT/docs/lab/site" <<'PY'
import os, re, sys
h = open(sys.argv[1], encoding="utf-8").read()
site = sys.argv[2]
rows = re.search(r'<table id="library-rows">(.*?)</table>', h, re.S)
hrefs = re.findall(r'<a href="([^"]+)"', rows.group(1)) if rows else []
dead = [x for x in hrefs if not os.path.isfile(os.path.join(site, x))]
print("LINKS=%d|DEAD=%s" % (len(hrefs), ",".join(dead) or "none"))
PY
)"
grep -q 'DEAD=none' <<<"$LINKS" && ! grep -q 'LINKS=0' <<<"$LINKS" \
  && ok "GSL-97: every artifact the cross-index links to is a file that exists (no forgotten shelves)" \
  || bad "GSL-97: the Library links to something that is not there ($LINKS)"

# 14. AN EMPTY SHELF MUST PROVE IT LOOKED. Each section prints the glob it ran, on the page. "There are
#     no incidents" and "I was pointed at the wrong directory" are opposite facts that render identically
#     unless the glob comes along — and the owner can paste it into a shell and check the page's homework.
grep -q 'docs/reviews/REVIEW-\*.md' "$LP" && grep -q 'docs/reports/\*\*/\*incident\*' "$LP" \
  && ok "GSL-97: every shelf prints the glob it was built from — an empty shelf proves it looked" \
  || bad "GSL-97: a Library section does not say where it looked, so an empty one proves nothing"

# 15. ⭐ THE LIBRARY FILTER. Same engine, same rail: narrowing to one shelf must still say what it hides.
#     SHOWN is asserted alongside the sentence, and that is not belt-and-braces: an earlier draft of this
#     check tested only the sentence, and it stayed GREEN under a mutation that stopped the filter hiding
#     anything at all — the count was right about rows that were all still on screen. A rail that can be
#     satisfied by arithmetic alone is not guarding the thing it was written to guard.
LF="$(node "$WORK/filters.mjs" "$LP" library-filter kind Reviews kind PRD 2>&1)"
grep -q 'WIRED=yes' <<<"$LF" && grep -q 'SHOWN_ONE=2' <<<"$LF" \
  && grep -q 'COUNT_ONE=1 of 9 shown — 8 hidden by the filter' <<<"$LF" \
  && ok "GSL-97 ⭐ the Library filter narrows to one shelf and names the 8 artifacts it is hiding" \
  || bad "GSL-97 ⭐ the Library filter does not narrow, or hides artifacts without saying so ($LF)"

# ════════════ GSL-99 / R5.3: the anti-rot alarm — the laboratory measuring its OWN rot ════════════
#
# The risk is the tasty-lunch lesson from the PRD: a hand-kept hub that has gone stale is WORSE than
# no hub, because it still looks authoritative. Three meters, and ONE rule over all three:
#
#     A METER WITH NO SOURCE IS `unknown`, NEVER GREEN. Green is a claim; a claim needs evidence.
#
# The fixture is a REAL git repository, because two of the three meters read git and a fixture that
# faked it would be testing a mock. It carries, on purpose, every trap the meters exist to survive:
#
#   · GSL-502 has a dev_history file IN THE WORKING TREE AND IN NO COMMIT. It must still count as
#     MISSING — the reader this history is written for arrives after a compaction, with a clone.
#   · ORCHESTRATION-STATE.md is committed to docs/handoff/ LATER than every real handoff and every
#     cycle boundary. Count it and the meter reads green exactly when the fleet has stopped writing
#     handoffs — green in the reassuring direction, which is the only one that matters. (The
#     `handoff.written` hook has precisely this blind spot, and the fixture's log carries such an
#     event to prove the meter does not read it.)
#   · five cycle boundaries, one handoff, committed inside the SECOND cycle → the three that closed
#     after it are undocumented, which is the PRD's own alarm threshold.
SH="$WORK/f5-selfhealth"
mkdir -p "$SH/docs/lab/events" "$SH/docs/lab/questions" "$SH/docs/lab/decisions" \
         "$SH/docs/dev_history" "$SH/docs/handoff"
: > "$SH/docs/lab/questions/queue.jsonl"; : > "$SH/docs/lab/decisions/log.jsonl"

sh_ts()  { python3 -c "import datetime,sys;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=int(sys.argv[1]))).strftime('%Y-%m-%dT%H:%M:%SZ'))" "$1"; }
sh_gts() { python3 -c "import datetime,sys;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=int(sys.argv[1]))).strftime('%Y-%m-%dT%H:%M:%S+0000'))" "$1"; }
sh_git() { git -C "$SH" "$@"; }
sh_commit() {  # <minutes-ago> <subject>
  GIT_AUTHOR_DATE="$(sh_gts "$1")" GIT_COMMITTER_DATE="$(sh_gts "$1")" \
    git -C "$SH" commit -q --no-gpg-sign -m "$2"
}
sh_git init -q; sh_git symbolic-ref HEAD refs/heads/main
sh_git config user.email smoke@example.com; sh_git config user.name smoke
printf 'fixture\n' > "$SH/README.md"; sh_git add README.md; sh_commit 400 "init"
sh_git checkout -q -b GSL-500-selfhealth

# GSL-501: a task with its history committed. The positive control — without a covered task, "missing"
# proves nothing (a meter that called EVERY task missing would pass a test that only checks 502/503).
printf '# GSL-501\n' > "$SH/docs/dev_history/GSL-501-phase-covered.md"
sh_git add docs/dev_history/GSL-501-phase-covered.md; sh_commit 350 "GSL-501 the documented task"
# The one real handoff, committed inside the cycle that ends at the 240m boundary.
printf '# Handoff 01\n' > "$SH/docs/handoff/01-handoff-alpha.md"
sh_git add docs/handoff/01-handoff-alpha.md; sh_commit 300 "docs: handoff 01"
# Two tasks with no history at all. These are the names the meter must print.
printf 'x\n' > "$SH/f502"; sh_git add f502; sh_commit 250 "GSL-502 the undocumented task"
printf 'x\n' > "$SH/f503"; sh_git add f503; sh_commit 200 "GSL-503 the other undocumented task"
# ⚠ THE TRAP. The live state file, committed AFTER everything — newer than the last handoff and newer
# than the last boundary. It is not a handoff, and a meter that thinks it is will read green.
printf '## TELEMETRY\n' > "$SH/docs/handoff/ORCHESTRATION-STATE.md"
sh_git add docs/handoff/ORCHESTRATION-STATE.md; sh_commit 10 "docs: state"
# ⚠ THE OTHER TRAP: written into the working tree, committed nowhere. To this meter they DO NOT EXIST.
printf '# GSL-502 (uncommitted)\n' > "$SH/docs/dev_history/GSL-502-phase-uncommitted.md"
printf '# Handoff 09 (uncommitted)\n' > "$SH/docs/handoff/09-handoff-uncommitted.md"

{ printf '{"ts":"%s","run_id":"%s","seq":1,"actor":"claude","type":"pane.ended","src":"hook:SessionEnd","session_id":"s1","data":{}}\n' "$(sh_ts 360)" "$TODAY"
  printf '{"ts":"%s","run_id":"%s","seq":2,"actor":"claude","type":"pane.ended","src":"hook:SessionEnd","session_id":"s2","data":{}}\n' "$(sh_ts 240)" "$TODAY"
  printf '{"ts":"%s","run_id":"%s","seq":3,"actor":"claude","type":"pane.ended","src":"hook:SessionEnd","session_id":"s3","data":{}}\n' "$(sh_ts 180)" "$TODAY"
  printf '{"ts":"%s","run_id":"%s","seq":4,"actor":"claude","type":"pane.ended","src":"hook:SessionEnd","session_id":"s4","data":{}}\n' "$(sh_ts 120)" "$TODAY"
  printf '{"ts":"%s","run_id":"%s","seq":5,"actor":"claude","type":"pane.ended","src":"hook:SessionEnd","session_id":"s5","data":{}}\n' "$(sh_ts 60)"  "$TODAY"
  printf '{"ts":"%s","run_id":"%s","seq":6,"actor":"claude","type":"handoff.written","src":"hook:PostToolUse","session_id":"s5","data":{"path":"docs/handoff/ORCHESTRATION-STATE.md"}}\n' "$(sh_ts 10)" "$TODAY"
} > "$SH/docs/lab/events/$TODAY.jsonl"

SHB="$SH/docs/lab/render_bundle.json"; SHI="$SH/docs/lab/site/index.html"
bash "$CH" --repo "$SH" --no-poll --quiet --json >/dev/null 2>&1

# ⭐ 1. COVERAGE IS BY NAME. "84% covered" is not actionable at 03:00; "GSL-502 has no history" is. The
#      assertion is on the NAMES, not on a count — a meter that knew two were missing but could not say
#      which would satisfy any arithmetic test and would still be useless at the hour it is read.
# (sorted: the epic's tasks arrive newest-commit-first from git, and this test is about WHICH keys are
#  named, not about the order git happened to walk them in)
SH_MISS="$(jq -r '.self_health.dev_history.epics[] | select(.key=="GSL-500") | .missing | sort | join(",")' "$SHB")"
[[ "$SH_MISS" == "GSL-502,GSL-503" ]] \
  && ok "GSL-99 ⭐ the missing dev_history is named (GSL-502, GSL-503), not summed" \
  || bad "GSL-99 ⭐ coverage does not name the tasks it is missing (got '$SH_MISS')"
[[ "$(jq -r '.self_health.dev_history.epics[] | select(.key=="GSL-500") | .covered | join(",")' "$SHB")" == "GSL-501" ]] \
  && ok "GSL-99: the documented task IS counted as covered (the positive control — otherwise 'missing' is vacuous)" \
  || bad "GSL-99: a task WITH a committed dev_history was not counted as covered"
grep -q 'data-missing-task="GSL-502"' "$SHI" && grep -q 'data-missing-task="GSL-503"' "$SHI" \
  && ok "GSL-99: every missing key reaches the PAGE by name, not just the bundle" \
  || bad "GSL-99: the page does not print the names of the undocumented tasks"

# ⭐ 2. FACT, NOT INTENT. GSL-502's history is sitting on disk. It is in no commit, so for the reader who
#      arrives tomorrow with a clone it does not exist — and this meter serves nobody else. The absence
#      assertion is armed by a positive control first: the file really IS there, so "still missing" is a
#      refusal, not an accident.
[[ -f "$SH/docs/dev_history/GSL-502-phase-uncommitted.md" ]] \
  && ok "GSL-99: the fixture really does carry an uncommitted GSL-502 history (so the test below means something)" \
  || bad "GSL-99: the uncommitted-history fixture is missing — the assertion below would pass vacuously"
jq -e '.self_health.dev_history.epics[] | select(.key=="GSL-500") | .missing | index("GSL-502")' "$SHB" >/dev/null 2>&1 \
  && jq -e '.self_health.dev_history.uncommitted | index("GSL-502-phase-uncommitted.md")' "$SHB" >/dev/null 2>&1 \
  && ok "GSL-99 ⭐ an UNCOMMITTED dev_history does not count as coverage — and is listed as lost, not as done" \
  || bad "GSL-99 ⭐ the working tree was counted as coverage: a file in no commit was read as documentation"

# ⭐ 3. ZERO-OF-ZERO IS NOT GREEN. An epic whose task list git cannot read (fast-forwarded, no merge
#      commit) reports `unknown`. 100% of nothing is the cheapest false green on this page.
#      (Fixture 2, below, carries such an epic AND no events at all.)
SHU="$WORK/f5-sh-unknown"
mkdir -p "$SHU/docs/lab/events" "$SHU/docs/lab/questions" "$SHU/docs/lab/decisions" "$SHU/docs/handoff"
: > "$SHU/docs/lab/questions/queue.jsonl"; : > "$SHU/docs/lab/decisions/log.jsonl"
git -C "$SHU" init -q; git -C "$SHU" symbolic-ref HEAD refs/heads/main
git -C "$SHU" config user.email smoke@example.com; git -C "$SHU" config user.name smoke
printf 'fixture\n' > "$SHU/README.md"
git -C "$SHU" add README.md; git -C "$SHU" commit -q --no-gpg-sign -m "init"
git -C "$SHU" checkout -q -b GSL-600-fastforward
printf 'x\n' > "$SHU/f601"; git -C "$SHU" add f601; git -C "$SHU" commit -q --no-gpg-sign -m "GSL-601 a task nobody can attribute"
git -C "$SHU" checkout -q main; git -C "$SHU" merge -q --ff-only GSL-600-fastforward
# A handoff EXISTS here. That is the positive control for the boundary meter: a handoff proves that ONE
# cycle was written up; it never proves that no OTHER cycle closed unwritten. With no boundary in the
# log, the honest verdict is `unknown` — and it must stay `unknown` even with a handoff sitting there.
printf '# Handoff 01\n' > "$SHU/docs/handoff/01-handoff-only.md"
git -C "$SHU" add docs/handoff/01-handoff-only.md; git -C "$SHU" commit -q --no-gpg-sign -m "docs: handoff 01"
SHUB="$SHU/docs/lab/render_bundle.json"; SHUI="$SHU/docs/lab/site/index.html"
bash "$CH" --repo "$SHU" --no-poll --quiet --json >/dev/null 2>&1

[[ "$(jq -r '.self_health.dev_history.epics[] | select(.key=="GSL-600") | .state' "$SHUB")" == "unknown" ]] \
  && [[ "$(jq -r '.self_health.dev_history.state' "$SHUB")" == "unknown" ]] \
  && grep -q 'data-dh="unknown"' "$SHUI" \
  && ok "GSL-99 ⭐ an epic git cannot attribute reads unknown, not 100% — zero-of-zero is not a clean bill of health" \
  || bad "GSL-99 ⭐ an unattributable epic was scored as covered (state=$(jq -r '.self_health.dev_history.state' "$SHUB"))"

# ⭐ 4. NO BOUNDARY → `unknown`, NEVER `ok`. Even with a handoff committed right there.
[[ "$(jq -r '.self_health.handoffs.state' "$SHUB")" == "unknown" ]] \
  && [[ "$(jq -r '.self_health.handoffs.undocumented_cycles' "$SHUB")" == "null" ]] \
  && [[ "$(jq -r '.self_health.handoffs.last.name' "$SHUB")" == "01-handoff-only.md" ]] \
  && ok "GSL-99 ⭐ no cycle boundary in the log -> handoff debt is unknown, even though a handoff exists" \
  || bad "GSL-99 ⭐ the handoff meter claimed to know the debt with no boundary to measure against"
grep -q 'id="sh-handoff" data-state="unknown"' "$SHUI" \
  && ok "GSL-99: the unknown handoff meter says so ON THE PAGE (dashed + muted, never a green tick)" \
  || bad "GSL-99: an unknown handoff meter does not render as unknown"

# ⭐ 5. NO EVENT → THE DATA AGE IS `unknown`, NOT `0s`. A page with no events must not read as freshly
#      built data: "nothing has happened" and "nothing was logged" are the two sentences Phase 4 exists
#      to keep apart.
SH_AGE_CELL="$(python3 - "$SHUI" <<'PY'
import re, sys
h = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r'id="sh-data-age"[^>]*>(.*?)</b>', h, re.S)
print("CELL=%s" % ("unknown" if m and "unknown" in m.group(1) else (m.group(1)[:40] if m else "absent")))
PY
)"
[[ "$(jq -r '.self_health.data_age_s' "$SHUB")" == "null" ]] && grep -q 'CELL=unknown' <<<"$SH_AGE_CELL" \
  && ok "GSL-99 ⭐ with no events at all, the data age is unknown — never a fresh-looking 0s" \
  || bad "GSL-99 ⭐ an empty log rendered as a fresh data age ($SH_AGE_CELL)"

# ⭐ 6. TWO AGES, NOT ONE — and they come from two different sources. The build's own age is carried as
#      an INSTANT (data-age-ts = generated_at) so the client re-computes it against the reader's clock;
#      the data's age is a NUMBER frozen at build time. A page that printed one age twice would satisfy
#      any test that only looked for "an age", so both surfaces are pinned to their own source.
SH_GEN="$(jq -r '.self_health.generated_at' "$SHB")"
SH_DATA="$(jq -r '.self_health.data_age_s' "$SHB")"
grep -q "id=\"sh-build-age\" data-age-ts=\"$SH_GEN\"" "$SHI" \
  && grep -q "id=\"sh-data-age\" data-data-age-s=\"$SH_DATA\"" "$SHI" \
  && [[ "$SH_DATA" != "null" && "$SH_DATA" -gt 0 ]] \
  && ok "GSL-99 ⭐ the page carries BOTH ages — the build's (live, re-aged on open) and the data's (frozen at build)" \
  || bad "GSL-99 ⭐ the page does not carry two independently-sourced ages (gen=$SH_GEN data=$SH_DATA)"

# ⭐ 7. THE HANDOFF DEBT IS A RUN OF CYCLES, AND THE STATE FILE IS NOT A HANDOFF.
#      Positive control first: ORCHESTRATION-STATE.md really is committed LATER than the real handoff,
#      so a meter that counted it WOULD have picked it as the newest — the trap is armed.
SH_STATE_TS="$(sh_git log --diff-filter=A -1 --format=%cI -- docs/handoff/ORCHESTRATION-STATE.md)"
SH_HO_TS="$(sh_git log --diff-filter=A -1 --format=%cI -- docs/handoff/01-handoff-alpha.md)"
[[ -n "$SH_STATE_TS" && "$SH_STATE_TS" > "$SH_HO_TS" ]] \
  && grep -q 'ORCHESTRATION-STATE.md' "$SH/docs/lab/events/$TODAY.jsonl" \
  && ok "GSL-99: the trap is armed — the state file is committed after the handoff AND a handoff.written event names it" \
  || bad "GSL-99: the state-file trap is not armed, so the exclusion below proves nothing"
[[ "$(jq -r '.self_health.handoffs.last.name' "$SHB")" == "01-handoff-alpha.md" ]] \
  && ok "GSL-99 ⭐ ORCHESTRATION-STATE.md is not a handoff — the live state file cannot fake freshness" \
  || bad "GSL-99 ⭐ the state file was counted as a handoff (last=$(jq -r '.self_health.handoffs.last.name' "$SHB"))"
[[ "$(jq -r '.self_health.handoffs.undocumented_cycles' "$SHB")" == "3" ]] \
  && [[ "$(jq -r '.self_health.handoffs.alarm' "$SHB")" == "true" ]] \
  && grep -q 'data-undocumented-cycles="3"' "$SHI" && grep -q 'data-alarm="1"' "$SHI" \
  && ok "GSL-99 ⭐ three cycles closed with no handoff -> the PRD's alarm fires, and the page shows the count" \
  || bad "GSL-99 ⭐ the cycle-debt run is miscounted (got $(jq -r '.self_health.handoffs.undocumented_cycles' "$SHB"), want 3)"
jq -e '.self_health.handoffs.uncommitted | index("09-handoff-uncommitted.md")' "$SHB" >/dev/null 2>&1 \
  && ok "GSL-99: a handoff written and never committed is listed as LOST — not silently counted as written" \
  || bad "GSL-99: an uncommitted handoff was dropped without a word"

# ⭐ 8. PRINT YOUR GLOB. "Nothing is missing" and "I looked in the wrong place" render identically
#      unless the meter says where it looked — and the owner can paste both of these into a shell.
grep -q 'git ls-files' "$SHI" && grep -q 'docs/dev_history/GSL-\*.md' "$SHI" \
  && grep -q 'pane.ended' "$SHI" && grep -q 'excluding ORCHESTRATION-STATE.md' "$SHI" \
  && ok "GSL-99 ⭐ both meters print the exact source they read (index glob, boundary event, exclusion)" \
  || bad "GSL-99 ⭐ a self-health meter cannot say where it looked"

# 9. THE PROSE ITSELF. Every assertion above is on a MECHANISM — an id, an attribute, a value — and that
#    is right: a test that greps rendered prose breaks the day someone rewords a sentence. But a
#    flawless mechanism can still render a broken SENTENCE, and this build shipped one: `ageText()`
#    already ends in "old", the caller appended " ago", and the page read "this page was built 0s old
#    ago" under 246 green tests. No assertion could have seen it, because none of them read English.
#
#    So the defect's SIGNATURE is what becomes mechanical: an age is formatted in exactly one place,
#    and no page may carry its suffix twice. The check has to read the page the way a human does —
#    "0s old</span> ago" carries no literal "old ago" at all, and the first version of this very test
#    passed vacuously on the broken build because it grepped the raw HTML. It strips tags first.
sh_prose() { python3 -c '
import re, sys, html
h = open(sys.argv[1], encoding="utf-8").read()
print(html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h))))
' "$1"; }
# The positive control, and it is not optional: it proves the DETECTOR fires. A "no doubled suffix"
# test that cannot recognise a doubled suffix is the same green tick over nothing it was written to
# prevent — which is exactly what the first draft of this test was.
printf '<div><span class="age">0s old</span> ago</div>\n' > "$WORK/prose-probe.html"
sh_prose "$WORK/prose-probe.html" | grep -q 'old ago' \
  && ok "GSL-99: the prose check can actually SEE a doubled suffix across a tag boundary (positive control)" \
  || bad "GSL-99: the prose check cannot detect the very defect it guards — it would pass vacuously"
sh_prose "$SHI" | grep -q 'old ago' \
  && bad "GSL-99: the page prints a doubled age suffix ('… old ago') — ageText() already says 'old'" \
  || ok "GSL-99: no page doubles the age suffix (the one prose defect 246 mechanism-tests could not see)"

# ──────────── the two orders the fixture above cannot produce (review M1 / M2) ────────────
#
# Everything asserted above is real, and all of it ran green over two defects that put a WRONG NUMBER
# on the page. The reason is the fixture, not the assertions: it encodes a handoff committed INSIDE
# its cycle, and exactly one boundary per cycle. Neither is a thing this repository does.
#
#   · a handoff is COMMITTED, and a commit happens after the pane has closed — that is what a commit
#     is. On this branch three handoffs were carried in by ledger commits hours later still.
#   · a cycle holds up to three panes and emits `pane.ended` for each. Two of them nine seconds apart
#     is one cycle, and the fixture's boundaries are a tidy 60 minutes apart, one per "cycle".
#
# So the tests were not hollow — they held a real mechanism, on the one scenario that hid the bug.
# These two fixtures encode the orders production ACTUALLY produces. Both fail on 9fb5766.
shx_commit() {  # <repo> <minutes-ago> <subject>
  GIT_AUTHOR_DATE="$(sh_gts "$2")" GIT_COMMITTER_DATE="$(sh_gts "$2")" \
    git -C "$1" commit -q --no-gpg-sign -m "$3"
}
shx_init() {  # <repo> — a real git repo, because these meters read git
  mkdir -p "$1/docs/lab/events" "$1/docs/lab/questions" "$1/docs/lab/decisions" "$1/docs/handoff"
  : > "$1/docs/lab/questions/queue.jsonl"; : > "$1/docs/lab/decisions/log.jsonl"
  git -C "$1" init -q; git -C "$1" symbolic-ref HEAD refs/heads/main
  git -C "$1" config user.email smoke@example.com; git -C "$1" config user.name smoke
  printf 'fixture\n' > "$1/README.md"; git -C "$1" add README.md; shx_commit "$1" 400 "init"
}
sh_pane() {  # <seconds-ago> <seq> <session> — one cycle boundary event
  printf '{"ts":"%s","run_id":"%s","seq":%s,"actor":"claude","type":"pane.ended","src":"hook:SessionEnd","session_id":"%s","data":{}}\n' \
    "$(python3 -c "import datetime,sys;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(seconds=int(sys.argv[1]))).strftime('%Y-%m-%dT%H:%M:%SZ'))" "$1")" \
    "$TODAY" "$2" "$3"
}

# ⭐ 10. A HANDOFF COMMITTED AFTER THE LAST BOUNDARY DOCUMENTS THE CYCLE THAT IS STILL RUNNING (M1).
#       The cycle that began at the newest boundary has not ended — nothing closed it — so its
#       interval runs to NOW. Closed at the top instead, it swallowed every late-committed handoff:
#       a night written up in full rang the alarm, which is the one direction that destroys trust in
#       an alarm. The bug's own shape is the fixture: the ONLY handoff here is committed last.
SHL="$WORK/f5-sh-late"; shx_init "$SHL"
{ sh_pane 14400 1 s1; sh_pane 10800 2 s2; sh_pane 7200 3 s3; sh_pane 3600 4 s4
} > "$SHL/docs/lab/events/$TODAY.jsonl"
printf '# Handoff 01\n' > "$SHL/docs/handoff/01-handoff-late.md"
git -C "$SHL" add docs/handoff/01-handoff-late.md; shx_commit "$SHL" 20 "docs: handoff 01, committed after the pane closed"
SHLB="$SHL/docs/lab/render_bundle.json"
bash "$CH" --repo "$SHL" --no-poll --quiet --json >/dev/null 2>&1
# The trap is armed FIRST: the handoff really is committed later than the last boundary. Without this
# the assertion below could pass on a fixture that simply never exercised the case.
SHL_HO="$(git -C "$SHL" log --diff-filter=A -1 --format=%cI -- docs/handoff/01-handoff-late.md)"
SHL_BND="$(jq -r '.self_health.handoffs.boundary.ts' "$SHLB")"
[[ -n "$SHL_HO" && "$(python3 -c "
import sys,datetime
p=lambda s: datetime.datetime.fromisoformat(s.replace('Z','+00:00'))
print('yes' if p(sys.argv[1])>p(sys.argv[2]) else 'no')" "$SHL_HO" "$SHL_BND")" == "yes" ]] \
  && ok "GSL-99: the trap is armed — the only handoff is committed AFTER the last cycle boundary (the order production always produces)" \
  || bad "GSL-99: the late-commit trap is not armed, so the assertion below proves nothing (handoff=$SHL_HO boundary=$SHL_BND)"
[[ "$(jq -r '.self_health.handoffs.undocumented_cycles' "$SHLB")" == "0" ]] \
  && [[ "$(jq -r '.self_health.handoffs.state' "$SHLB")" == "ok" ]] \
  && [[ "$(jq -r '.self_health.handoffs.alarm' "$SHLB")" == "false" ]] \
  && ok "GSL-99 ⭐ a handoff committed after the last boundary documents the running cycle — no phantom debt, no false alarm" \
  || bad "GSL-99 ⭐ a late-committed handoff documented NOTHING (undoc=$(jq -r '.self_health.handoffs.undocumented_cycles' "$SHLB"), want 0) — the interval is still closed at the top"

# ⭐ 11. THREE PANES OF ONE CYCLE ARE ONE BOUNDARY, NOT THREE (M2). The word on the page is
#       `N cycle(s) closed with no handoff`, and a cycle in this repository is the orchestrator's
#       (the Fleet screen prints `59 cycle`; the ledger numbers them). `pane.ended` fires per PANE and
#       a cycle holds up to three — so a routine three-worker cycle minted two extra "cycles" whose
#       intervals are seconds wide, which no handoff can land inside. Guaranteed debt, by arithmetic.
SHD="$WORK/f5-sh-debounce"; shx_init "$SHD"
{ sh_pane 10800 1 s1                                   # an earlier cycle, hours away
  sh_pane 3600 2 s2; sh_pane 3595 3 s3; sh_pane 3591 4 s4   # ONE cycle: three panes, 9s apart
} > "$SHD/docs/lab/events/$TODAY.jsonl"
printf '# Handoff 01\n' > "$SHD/docs/handoff/01-handoff-debounce.md"
git -C "$SHD" add docs/handoff/01-handoff-debounce.md; shx_commit "$SHD" 100 "docs: handoff 01"
SHDB="$SHD/docs/lab/render_bundle.json"; SHDI="$SHD/docs/lab/site/index.html"
bash "$CH" --repo "$SHD" --no-poll --quiet --json >/dev/null 2>&1
# Armed: the log really does carry four `pane.ended`, three of them within seconds of each other.
[[ "$(grep -c '"type":"pane.ended"' "$SHD/docs/lab/events/$TODAY.jsonl")" == "4" ]] \
  && ok "GSL-99: the trap is armed — four pane closes in the log, three of them seconds apart in one teardown" \
  || bad "GSL-99: the debounce fixture does not carry the clustered pane closes it is testing"
[[ "$(jq -r '.self_health.handoffs.boundaries' "$SHDB")" == "2" ]] \
  && ok "GSL-99 ⭐ four pane closes -> TWO cycle boundaries: the meter counts cycles, which is the word it prints" \
  || bad "GSL-99 ⭐ the meter counted panes and called them cycles (boundaries=$(jq -r '.self_health.handoffs.boundaries' "$SHDB"), want 2)"
[[ "$(jq -r '.self_health.handoffs.undocumented_cycles' "$SHDB")" == "0" ]] \
  && ok "GSL-99 ⭐ the seconds-wide phantom cycles are gone, so the handoff that documented the cycle counts" \
  || bad "GSL-99 ⭐ phantom debt from clustered panes survives (undoc=$(jq -r '.self_health.handoffs.undocumented_cycles' "$SHDB"), want 0)"
# The collapse is AUDITABLE, not asserted: both numbers and the window reach the page, so a reader who
# distrusts the debounce can do the division himself. Under-counting cycles under-states debt — the
# reassuring direction — and this page does not get to make that trade silently.
grep -q '4 pane close(s) debounced into 2 cycle boundary(ies) at 600s' "$SHDI" \
  && sh_prose "$SHDI" | grep -q 'UNDER-states this debt' \
  && ok "GSL-99 ⭐ the page prints the raw pane count, the cycle count and the window — and names which way the error runs" \
  || bad "GSL-99 ⭐ the debounce is invisible on the page: a reader cannot tell panes from cycles"

# ════════════ GSL-100 / F5-S4: the page must hold together in a phone-width column ════════════
# F5-S4 is the criterion the whole phase exists to satisfy — "readable from a phone" — and until
# GSL-100 nobody had ever opened the page at phone width. Measured 2026-07-20 at 390px, two defects
# were sitting in plain sight:
#
#   1. The nav laid all seven links on ONE unbreakable 469px line inside a 358px column, so Cost and
#      Library sat off-screen — two of seven screens unreachable. The cause is not a missing
#      breakpoint: the renderer emits <a>Overview</a><a>Timeline</a> with NO whitespace between the
#      elements, and inline boxes with no intervening white space have no soft-wrap opportunity at
#      all. margin-right drew the gaps but never a break. Only a wrapping flex container fixes it.
#   2. The orchestrator's .mono card CLIPPED its own JSON mid-token ('"context_pct":26,"o'), losing
#      the rest of the note with nothing on screen to admit anything was missing. Silent truncation
#      is the exact failure this laboratory exists to refuse.
#
# Asserted on the GENERATED page, never on the source: the page is what the reader is handed.
sh_nav_wraps()  { grep -qE 'nav\{[^}]*flex-wrap:wrap' "$1"; }
sh_mono_wraps() { grep -qE 'overflow-wrap:anywhere' "$1"; }

# Positive controls FIRST, and they are not optional. A layout guard that cannot recognise the
# BROKEN layout is the same green tick over nothing the doubled-suffix test was until impl-ui-6 ran
# it against the parent commit. So both detectors are shown the pre-fix stylesheet and must reject.
printf '<style>nav{margin:.4rem 0 .2rem;line-height:2}\nnav a{margin-right:.9rem}\ncode,.mono{font-family:monospace;font-size:.85em}</style>\n' > "$WORK/layout-prefix.html"
sh_nav_wraps "$WORK/layout-prefix.html" \
  && bad "GSL-100: the nav-wrap detector ACCEPTS the pre-fix stylesheet — it cannot see the defect it guards" \
  || ok "GSL-100: the nav-wrap detector rejects the pre-fix stylesheet (positive control)"
sh_mono_wraps "$WORK/layout-prefix.html" \
  && bad "GSL-100: the mono-wrap detector ACCEPTS the pre-fix stylesheet — it would pass vacuously" \
  || ok "GSL-100: the mono-wrap detector rejects the pre-fix stylesheet (positive control)"

sh_nav_wraps "$SHI" \
  && ok "GSL-100 ⭐ the nav wraps — seven links cannot strand Cost and Library off a phone screen" \
  || bad "GSL-100 ⭐ nav cannot wrap: at 390px the last links leave the viewport, unreachable"
sh_mono_wraps "$SHI" \
  && ok "GSL-100 ⭐ long unbreakable tokens wrap — a mono card cannot clip the note it is quoting" \
  || bad "GSL-100 ⭐ .mono lacks overflow-wrap: raw JSON clips mid-token and the reader loses text"

echo "== GSL-104 / F6-S1: Remote Control preflight — the phone path never reports better than it is =="
RCP="$REPO_ROOT/tools/rc/rc-preflight.sh"

# The surface names are assembled from fragments on purpose: this harness greps the tree for
# hard-coded Remote Control flags, and a literal here would make the harness its own violation.
RCF='--remote'"-control"
RCK_ACT='inputNeededNotif'"Enabled"
RCK_DEC='agentPushNotif'"Enabled"

if [[ ! -x "$RCP" ]]; then
  bad "GSL-104: tools/rc/rc-preflight.sh missing or not executable — nothing can ask about the phone path"
else
  ok "GSL-104: rc-preflight.sh present and executable"
  bash -n "$RCP" && ok "GSL-104: bash -n (syntax)" || bad "GSL-104: bash -n (syntax)"

  # ---- positive controls FIRST -------------------------------------------------
  # Every assertion below is either "X is absent" or "the verdict is not ready". Both pass
  # vacuously against a script that says nothing at all, so each detector is first shown input
  # it MUST reject.
  grep -q -- "$RCF" "$RCP" \
    && ok "GSL-104: the SURFACE block really names the flag (positive control — the absence greps below are not vacuous)" \
    || bad "GSL-104: SURFACE block does not name the flag — every isolation check below would pass over nothing"
  grep -q "$RCK_ACT" "$RCP" \
    && ok "GSL-104: the SURFACE block really names the actions-required key (positive control)" \
    || bad "GSL-104: SURFACE block does not name the actions-required key — the toggle checks guard nothing"

  # The hard-coding detector, shown a file that DOES hard-code the surface.
  rc_hardcode_hits() { grep -rlE -- "$RCF|$RCK_ACT|$RCK_DEC" "$1" 2>/dev/null; }
  mkdir -p "$WORK/rc-violator"
  printf 'claude %s orchestrator   # a caller that pinned the flag itself\n' "$RCF" > "$WORK/rc-violator/brief.sh"
  [[ -n "$(rc_hardcode_hits "$WORK/rc-violator")" ]] \
    && ok "GSL-104: the hard-coding detector flags a file that pins the flag (positive control)" \
    || bad "GSL-104: the hard-coding detector CANNOT see a pinned flag — the swappability check is theatre"

  # ---- ⭐ absent means OFF ------------------------------------------------------
  # The whole overnight value of Remote Control rides on "push when actions required". Its key
  # defaults to false, so an ABSENT key is OFF. A preflight that read absence as "probably on"
  # would tell the owner the phone is covered on exactly the night it is not.
  printf '{"%s": true}\n' "$RCK_DEC" > "$WORK/rc-settings-absent.json"
  RC_JSON="$(RC_SETTINGS_FILE="$WORK/rc-settings-absent.json" bash "$RCP" --json 2>/dev/null)"
  echo "$RC_JSON" | python3 -c 'import json,sys; r=json.load(sys.stdin); assert r["push_when_actions_required"]=="absent"; assert r["status"]!="ready", r["status"]' \
    && ok "GSL-104 ⭐ an absent actions-required key reads as OFF and never yields a ready verdict" \
    || bad "GSL-104 ⭐ an absent toggle was rounded up: the owner would be told the phone is covered while permission prompts stay silent"

  # false is not a different story from absent — both are OFF.
  printf '{"%s": true, "%s": false}\n' "$RCK_DEC" "$RCK_ACT" > "$WORK/rc-settings-false.json"
  RC_JSON_F="$(RC_SETTINGS_FILE="$WORK/rc-settings-false.json" bash "$RCP" --json 2>/dev/null)"
  echo "$RC_JSON_F" | python3 -c 'import json,sys; r=json.load(sys.stdin); assert r["push_when_actions_required"]=="false"; assert r["status"]!="ready", r["status"]' \
    && ok "GSL-104 ⭐ an explicitly false toggle also blocks a ready verdict" \
    || bad "GSL-104 ⭐ a false toggle passed as ready — the verdict does not track the setting"

  # ---- ⭐ the verdict can still be green: not a stuck 'degraded' ----------------
  if command -v claude >/dev/null 2>&1; then
    printf '{"%s": true, "%s": true}\n' "$RCK_DEC" "$RCK_ACT" > "$WORK/rc-settings-both.json"
    RC_JSON_OK="$(RC_SETTINGS_FILE="$WORK/rc-settings-both.json" bash "$RCP" --json 2>/dev/null)"
    echo "$RC_JSON_OK" | python3 -c 'import json,sys; r=json.load(sys.stdin); assert r["status"]=="ready", r["status"]' \
      && ok "GSL-104 ⭐ both toggles on yields ready — the check discriminates, it is not pinned to degraded" \
      || bad "GSL-104 ⭐ both toggles on still not ready: the verdict ignores its inputs (a constant is not a test)"
  else
    note_skip=1
    ok "GSL-104: claude CLI absent — ready-path check skipped (surface legs cannot be judged here)"
  fi

  # ---- ⭐ swappability: no executable path outside tools/rc pins the surface ----
  RC_OFFENDERS=""
  for d in "$REPO_ROOT/tools" "$REPO_ROOT/.claude"; do
    [[ -d "$d" ]] || continue
    while IFS= read -r f; do
      [[ -z "$f" ]] && continue
      case "$f" in "$REPO_ROOT/tools/rc/"*) continue ;; esac
      RC_OFFENDERS="$RC_OFFENDERS $f"
    done <<< "$(rc_hardcode_hits "$d")"
  done
  [[ -z "${RC_OFFENDERS// /}" ]] \
    && ok "GSL-104 ⭐ the research-preview surface is named in tools/rc only — when Anthropic renames a flag, one block changes" \
    || bad "GSL-104 ⭐ Remote Control surface pinned outside tools/rc (${RC_OFFENDERS# }) — a rename now breaks callers silently"

  # ---- ⭐ preflight never pairs, and never spends a token ----------------------
  # These two assert what the script EXECUTES, so they must not fire on the word `claude`
  # sitting in a comment or inside a message the script prints. The first draft did exactly
  # that and reported the file's own explanatory comment as a C1 breach. So strip comments
  # (quote-aware) and drop lines whose command is a printer, then judge what is left.
  rc_exec_lines() {
    python3 - "$1" <<'PY'
import re,sys
PRINTERS=("good","warn","dead","note","echo","printf","say")
for raw in open(sys.argv[1]):
    line, q, out = raw.rstrip("\n"), None, []
    for ch in line:                      # drop an unquoted trailing comment
        if q:
            if ch == q: q = None
        elif ch in "\"'": q = ch
        elif ch == "#": break
        out.append(ch)
    line = "".join(out)
    if line.lstrip().split(" ")[0].rstrip("(") in PRINTERS: continue
    if line.strip(): print(line)
PY
  }
  RC_EXEC="$(rc_exec_lines "$RCP")"

  # Positive control: the stripper must not swallow the executable lines themselves.
  grep -qE 'claude[[:space:]]+--version' <<<"$RC_EXEC" \
    && ok "GSL-104: the comment-stripper preserves real invocations (positive control — the two checks below still have input)" \
    || bad "GSL-104: the comment-stripper ate the real claude invocations — the C1 and no-pairing checks would pass over an empty file"

  grep -qE 'claude( -p|\b--print)' <<<"$RC_EXEC" \
    && bad "GSL-104 ⭐ preflight calls a headless model (C1 violation) — a verifier must not cost tokens" \
    || ok "GSL-104 ⭐ 0-LLM (C1): preflight shells out to no model"

  # Pairing is a QR scan with a human. Any claude invocation here must be an inspection
  # (--version / --help / command -v), never a session start — a preflight that launched RC
  # would hijack the terminal it was asked to report on.
  RC_LAUNCHES="$(grep -nE '(^|[^-[:alnum:]])claude[[:space:]]' <<<"$RC_EXEC" \
    | grep -v -- '--help' | grep -v -- '--version' | grep -v 'command -v claude' || true)"
  [[ -z "$RC_LAUNCHES" ]] \
    && ok "GSL-104 ⭐ preflight only inspects (--version/--help): it reports on the phone path, never starts a session" \
    || bad "GSL-104 ⭐ preflight invokes claude outside --version/--help ($RC_LAUNCHES) — a report step that could seize the terminal"
fi

echo
echo "== GSL-108 / F5-S4c: the phone page — the one surface GitHub agrees to render =="
# Phase 5 measured that GitHub serves .html as text/plain + nosniff and refused to render it, and
# closed F5-S4c as REFUTED. What it did not measure is that GitHub renders .md server-side — on a
# private repo, and for a directory's README.md at a URL with no date in it. That asymmetry is the
# whole mechanism of this page, so these checks guard the properties that depend on it, not the prose.
MB="$WORK/mobile-repo"
mkdir -p "$MB/docs/lab/events" "$MB/docs/lab/questions" "$MB/docs/lab/decisions"
: > "$MB/docs/lab/questions/queue.jsonl"
MB_TODAY="$(date -u +%F)"
MB_TS="$(python3 -c "import datetime;print(datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))")"
printf '{"ts":"%s","run_id":"%s","seq":1,"actor":"w1","type":"vcs.commit","src":"hook:PostToolUse","data":{"sha":"beef001"}}\n' \
  "$MB_TS" "$MB_TODAY" > "$MB/docs/lab/events/$MB_TODAY.jsonl"
# Two decisions, written OLDEST-FIRST (the order the log actually has), with distinguishable text.
{ printf '{"id":"d-1900-01-01-001","ts":"1900-01-01T00:00:00Z","re":"q-1900-01-01-001","task":"GSL-OLD","type":"DECISION","question":"?","decision":"ELDEST-DECISION-TEXT","made_by":"orchestrator","rule":"r"}\n'
  printf '{"id":"d-2099-12-31-009","ts":"2099-12-31T23:59:59Z","re":"q-2099-12-31-009","task":"GSL-NEW","type":"DECISION","question":"?","decision":"NEWEST-DECISION-TEXT","made_by":"orchestrator","rule":"r"}\n'
} > "$MB/docs/lab/decisions/log.jsonl"

bash "$CH" --repo "$MB" --no-poll --quiet --json >/dev/null 2>&1
MBP="$MB/docs/lab/mobile/README.md"

# ---- positive control: everything below reads a real, complete page ---------------
MB_SECTIONS="$(grep -c '^## ' "$MBP" 2>/dev/null || echo 0)"
[[ -s "$MBP" && "$MB_SECTIONS" -ge 7 ]] \
  && ok "GSL-108: the phone page exists and carries its $MB_SECTIONS sections (positive control — the checks below have input)" \
  || bad "GSL-108: no phone page (or under 7 sections) — every check below would pass over an empty file"

# ---- ⭐ the filename IS the mechanism ---------------------------------------------
# GitHub renders a directory's README.md when the DIRECTORY is opened. Any other name (phone.md,
# index.md) demands the reader find a file by name on a phone at 07:00, and a dated name cannot be
# bookmarked at all. This check fails if the artifact is renamed or moved out of its own directory.
[[ -f "$MB/docs/lab/mobile/README.md" ]] \
  && ok "GSL-108 ⭐ the page is docs/lab/mobile/README.md — opening the directory renders it, and the URL carries no date" \
  || bad "GSL-108 ⭐ the phone page is not at docs/lab/mobile/README.md — a renamed file is not auto-rendered by a directory open"

# ---- ⭐ derived from the same pass, not hand-authored ------------------------------
MB_GEN="$(jq -r '.generated_at' "$MB/docs/lab/status.json" 2>/dev/null)"
[[ -n "$MB_GEN" ]] && grep -qF "$MB_GEN" "$MBP" \
  && ok "GSL-108 ⭐ the page carries THIS pass's generated_at — it is regenerated, not a document someone maintains" \
  || bad "GSL-108 ⭐ the page's timestamp is not this pass's — it is drifting from the bundle it claims to project"

# ---- ⭐ it links only where a phone can follow -------------------------------------
# A .html link opens escaped source on a phone: a dead end dressed as a destination. Markdown links
# and directory links are the only ones that resolve to something readable.
MB_HTML_LINKS="$(grep -oE '\]\([^)]*\.html?[^)]*\)' "$MBP" || true)"
[[ -z "$MB_HTML_LINKS" ]] \
  && ok "GSL-108 ⭐ no .html link on the phone page — every link resolves to something GitHub will render" \
  || bad "GSL-108 ⭐ the phone page links to .html ($MB_HTML_LINKS) — on a phone that opens escaped source"

# ---- ⭐ 'latest' means latest ------------------------------------------------------
# decisions.recent arrives OLDEST-first. Slicing its head under the word "latest" printed the oldest
# records under a caption that contradicted them. The fixture spans 1900..2099 so any unsorted head
# slice puts the wrong one first.
MB_FIRST_DEC="$(grep -oE '(ELDEST|NEWEST)-DECISION-TEXT' "$MBP" | head -1)"
[[ "$MB_FIRST_DEC" == "NEWEST-DECISION-TEXT" ]] \
  && ok "GSL-108 ⭐ 'Latest decisions' lists the newest first — the caption and the list agree" \
  || bad "GSL-108 ⭐ 'Latest decisions' leads with '$MB_FIRST_DEC' — the caption contradicts its own list"

# ---- ⭐ a decision reads as a decision ---------------------------------------------
# The first cut printed `d-2026-07-13-001 — q-2026-07-12-001`: an id whose description is another id.
# On a phone that is worse than omitting the section, because it costs a tap to learn nothing.
grep -qF "NEWEST-DECISION-TEXT" "$MBP" \
  && ok "GSL-108 ⭐ decisions print what was decided, not an id pointing at another id" \
  || bad "GSL-108 ⭐ the decision text is missing — the section shows identifiers a reader cannot resolve on a phone"

# ---- ⭐ it outlives the failure that takes the dashboard down ----------------------
# The seven screens need node; this page does not, because Python builds it from a bundle Python
# already wrote. If it were written inside the render-succeeded branch, the one surface reachable
# from bed would vanish on exactly the night the HTML broke.
MBN="$WORK/mobile-nonode"
mkdir -p "$MBN/docs/lab"
cp -R "$MB/docs/lab/events" "$MB/docs/lab/questions" "$MB/docs/lab/decisions" "$MBN/docs/lab/" 2>/dev/null
MBN_JSON="$(env PATH="/usr/bin:/bin:/usr/sbin:/sbin" bash "$CH" --repo "$MBN" --no-poll --quiet --json 2>/dev/null)"
[[ "$(echo "$MBN_JSON" | jq -r '.ui.reason' 2>/dev/null)" == "no-node" ]] \
  && ok "GSL-108: the no-node fixture really did lose the renderer (control for the check below)" \
  || bad "GSL-108: the no-node fixture still had node — the survival check below proves nothing"
MBN_GEN="$(jq -r '.generated_at' "$MBN/docs/lab/status.json" 2>/dev/null)"
[[ -s "$MBN/docs/lab/mobile/README.md" ]] && grep -qF "$MBN_GEN" "$MBN/docs/lab/mobile/README.md" \
  && ok "GSL-108 ⭐ with node gone the HTML degrades but the phone page is still written, and current" \
  || bad "GSL-108 ⭐ no node took the phone page down with the dashboard — the one surface reachable from bed"
grep -q 'did \*\*not\*\* regenerate' "$MBN/docs/lab/mobile/README.md" 2>/dev/null \
  && ok "GSL-108 ⭐ and it SAYS the seven screens are stale — the reader is told which of the two they hold" \
  || bad "GSL-108 ⭐ the phone page is silent about the stale HTML beside it — a fresh page implying a fresh dashboard"

echo
echo "RESULT: PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -eq 0 ]]; then rm -rf "$WORK"; exit 0; else echo "(artifacts kept at $WORK)"; exit 1; fi
