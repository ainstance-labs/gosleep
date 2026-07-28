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
# GSL-221: the ceiling tests assert all three configured states (default / env / unlimited); a value
# inherited from the caller's shell would silently flip every unset-env case. Hermetic by construction.
unset GOSLEEP_TOKEN_CEILING
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

# ⭐ GSL-109: EACH GRADE MUST RESOLVE TO ITS OWN COLOUR. The banner carries class="stale <grade>", so
# the rule for the "stale" grade was written `.stale.stale` — which is not "stale AND graded stale",
# it is `.stale` written twice. It matched EVERY banner at the same specificity as `.stale.fresh` and,
# coming later in source order, won: a FRESH build painted its banner in the WARNING colour, on all
# seven screens, for the whole of Phase 5. The grade in the markup was correct the entire time; the
# stylesheet could not express the distinction it was asked for, which is why no assertion on the
# markup could ever have caught this. So this one runs the CASCADE — it resolves `color` for a real
# element of each grade against the emitted stylesheet, exactly as a browser would, and demands three
# different answers. A selector that matches more grades than its own re-reds it.
SG="$(python3 - "$CR/docs/lab/site/index.html" <<'PY'
import re, sys
css = re.search(r"<style>(.*?)</style>", open(sys.argv[1], encoding="utf-8").read(), re.S)
css = css.group(1) if css else ""
TOK = re.compile(r'\.([A-Za-z0-9_-]+)|\[([a-z-]+)="([^"]+)"\]')
def resolve(grade):
    # A real element: <div class="stale <grade>" data-grade="<grade>">
    classes, attrs = {"stale", grade}, {"data-grade": grade}
    best = None
    for order, m in enumerate(re.finditer(r"([^{}]+)\{([^{}]*)\}", css)):
        sel, decls = m.group(1).strip(), m.group(2)
        col = re.search(r"(?:^|;)\s*color\s*:\s*([^;]+)", decls)
        if not col or not sel.startswith(".stale"):
            continue
        # Only compound selectors targeting the element itself: no combinator, no pseudo-element.
        if re.search(r"[ >+~,:]", sel):
            continue
        toks = TOK.findall(sel)
        if not toks or not all(
            (c in classes) if c else (attrs.get(a) == v) for c, a, v in toks
        ):
            continue
        spec = len(toks)
        if best is None or (spec, order) >= (best[0], best[1]):
            best = (spec, order, col.group(1).strip())
    return best[2] if best else "NONE"
print(" ".join(f"{g}={resolve(g)}" for g in ("fresh", "stale", "dead")))
PY
)"
[[ "$SG" == "fresh=var(--ok) stale=var(--warn) dead=var(--dead)" ]] \
  && ok "⭐ GSL-109: each staleness grade resolves to its OWN colour (a fresh page is not painted amber)" \
  || bad "⭐ GSL-109: a grade rule bleeds across grades — got [$SG]"

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

# GSL-221 (owner directive d-2026-07-28-007; supersedes the GSL-93 "no ceiling on disk" premise):
# the ceiling now exists in one of three FIRST-CLASS states. Unset -> the 16,000,000/night default,
# so the budget clock has a denominator out of the box; an integer overrides it; the explicit word
# `unlimited` disables it by choice. The old null-because-nobody-chose state is gone: the default chooses.
[[ "$(jq -r '.cost.ceiling' "$CR/docs/lab/render_bundle.json")" == "16000000" \
   && "$(jq -r '.cost.ceiling_mode' "$CR/docs/lab/render_bundle.json")" == "default" ]] \
  && ok "GSL-221: unset env -> the 16,000,000/night default (mode=default), never a null nobody chose" \
  || bad "GSL-221: the default ceiling did not apply (ceiling=$(jq -r '.cost.ceiling' "$CR/docs/lab/render_bundle.json") mode=$(jq -r '.cost.ceiling_mode' "$CR/docs/lab/render_bundle.json"))"
grep -q 'tokens per night' "$CR/docs/lab/site/cost.html" \
  && ok "GSL-221: the Cost screen names the per-night unit, in words" \
  || bad "GSL-221: the Cost screen does not say what the ceiling is per"
GOSLEEP_TOKEN_CEILING=1000000 bash "$CH" --repo "$CR" --no-poll --quiet --json >/dev/null 2>&1
[[ "$(jq -r '.cost.ceiling' "$CR/docs/lab/render_bundle.json")" == "1000000" \
   && "$(jq -r '.cost.ceiling_mode' "$CR/docs/lab/render_bundle.json")" == "env" ]] \
  && ok "GSL-93/221: a ceiling IS honoured when one is supplied (GOSLEEP_TOKEN_CEILING, mode=env)" \
  || bad "GSL-93/221: the ceiling override is ignored"
bash "$CH" --repo "$CR" --no-poll --quiet --json >/dev/null 2>&1     # back to the default mode

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

# ════════ GSL-192: the cost headline is the MAX of the ledger, and the table is SORTED ════════
# (audit findings 47 + 64). The TELEMETRY ledger is hand-appended prose in FILE order: on live data
# the last line trailed the true running-total maximum by 1,672,000 tokens (10.5%), so the KPI tile
# was refuted by the table printed directly under it — and the cycle column carried 17 order
# inversions, so a reader could not spot a missing cycle by eye. The fixture is the defect in
# miniature: three rows out of order with the maximum in the MIDDLE, so last-line-wins and
# unsorted-passthrough each fail a different assert below.
CO="$WORK/cost-order"; mkdir -p "$CO/docs/lab/events" "$CO/docs/handoff"
: > "$CO/docs/lab/events/$TODAY.jsonl"
cat > "$CO/docs/handoff/ORCHESTRATION-STATE.md" <<'STATE'
## TELEMETRY

- `cycle=7 worker=w model=claude-opus-4-8 tokens_out=1000 tokens_in=100 cache_read=10 | running: cycles=7 total≈7000`
- `cycle=9 worker=w model=claude-opus-4-8 tokens_out=1000 tokens_in=100 cache_read=10 | running: cycles=9 total≈9000`
- `cycle=8 worker=w model=claude-opus-4-8 tokens_out=1000 tokens_in=100 cache_read=10 | running: cycles=8 total≈8000`

## NEXT
STATE
bash "$CH" --repo "$CO" --no-poll --quiet --json >/dev/null 2>&1
COB="$CO/docs/lab/render_bundle.json"
[[ "$(jq -r '.cost.cumulative_total' "$COB")" == "9000" && "$(jq -r '.cost.cumulative_cycles' "$COB")" == "9" ]] \
  && ok "GSL-192: the tile is max(running_total), never the file's last line (9000, not 8000)" \
  || bad "GSL-192: cumulative tile reads $(jq -r '.cost.cumulative_total' "$COB")/$(jq -r '.cost.cumulative_cycles' "$COB") — last-line-wins is back (want 9000/9)"
jq -e '.cost.cycles | map(.cycle) == [7,8,9]' "$COB" >/dev/null \
  && ok "GSL-192: the bundle's rows are sorted by cycle (7,8,9 out of a 7,9,8 ledger)" \
  || bad "GSL-192: the bundle keeps the ledger's file order ($(jq -c '.cost.cycles | map(.cycle)' "$COB" 2>/dev/null))"
CO_ORDER="$(python3 - "$CO/docs/lab/site/cost.html" <<'PY'
import re, sys
h = open(sys.argv[1], encoding="utf-8").read()
seg = re.search(r"Per cycle(.*?)Per model", h, re.S)
print(",".join(re.findall(r'<tr><td class="mono">(\d+)</td>', seg.group(1) if seg else "")))
PY
)"
[[ "$CO_ORDER" == "9,8,7" ]] \
  && ok "GSL-192: the RENDERED per-cycle table is newest-first by cycle (9,8,7) — sorted, not reverse(file order)" \
  || bad "GSL-192: the rendered per-cycle table is out of cycle order (got: ${CO_ORDER:-nothing})"
# The invariant the audit stated verbatim: the headline can never be refuted by its own table.
jq -e '.cost.cumulative_total >= ([.cost.cycles[].running_total | select(. != null)] | max)' "$COB" >/dev/null \
  && ok "GSL-192: tile >= max running_total of its own table — the headline cannot be refuted by the rows under it" \
  || bad "GSL-192: the cumulative tile is BELOW its own table's maximum"

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

# ── F5-S1 c. The token budget is limiting. 1,000,000 spent TONIGHT of 1,100,000; 100k/cycle at
#    1 cycle/h -> 1h. The ledger has cycle NUMBERS and no timestamps, so the burn rate needs the
#    heartbeat to tell time: this test proves the two sources are actually joined.
#    GSL-221 made the ceiling per-NIGHT, so tonight's spend is anchored: a seeded previous bundle
#    puts the day's anchor at 0, making the full ledger total tonight's.
RWC="$WORK/rw-cost"; rw_fixture "$RWC" 50 1
printf '{"cost":{"night_anchor":{"date":"%s","base_total":0}}}\n' "$TODAY" > "$RWC/docs/lab/render_bundle.json"
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
  && ok "F5-S1: no heartbeat (so no burn rate) -> the runway says 'unknown', not a comfortable number" \
  || bad "F5-S1: the runway answered with a number it could not know (bound=$(rw '.runway.bound' "$RWU"))"
[[ "$(rw '.runway.unknown_axes | index("budget")' "$RWU")" != "null" ]] \
  && ok "F5-S1: the unreadable stopping clocks are NAMED, not silently dropped" \
  || bad "F5-S1: an unreadable clock vanished instead of bounding the answer"
grep -q 'Cannot say' "$RWU/docs/lab/site/index.html" \
  && grep -q 'different sentences' "$RWU/docs/lab/site/index.html" \
  && ok "F5-S1: the page SAYS it cannot see, and says why that is not a green light" \
  || bad "F5-S1: the page rendered an absence of evidence as evidence of absence"
# ⭐ GSL-109: and it does not BORROW a grade's colour to say so. "unknown" used to render in the same
# amber as "under four hours left", which put a reading and the absence of one in one bucket — the
# exact conflation the prose two lines above spends a paragraph refusing. The tone is presentation
# only (no number, threshold or formula lives here), but presentation is the whole channel this
# distinction travels on: the owner reads the colour before he reads the sentence.
grep -q 'class="runway unk"' "$RWU/docs/lab/site/index.html" \
  && ! grep -q 'class="runway warn"' "$RWU/docs/lab/site/index.html" \
  && ok "⭐ GSL-109: an unreadable runway gets its OWN tone, not the warning grade's" \
  || bad "⭐ GSL-109: 'I cannot see' was painted as 'it is getting late'"

# ── F5-S1 f. An unreadable clock turns an estimate into an UPPER BOUND. The quota says 4h; the budget
#    cannot be read. The true runway is AT MOST 4h — it can only be shorter, never longer, so "≈ 4h"
#    would be a lie in the one direction that costs the owner a night.
#    GSL-221: a ceiling now always exists unless the owner disables it, so an unreadable BUDGET takes
#    an unreadable LEDGER — blank the telemetry bullets and the clock has a denominator, no numerator.
RWUP="$WORK/rw-upper"; rw_fixture "$RWUP" 50 1 "$QEV"
sed -i.bak 's/^- .*$//' "$RWUP/docs/handoff/ORCHESTRATION-STATE.md"
bash "$CH" --repo "$RWUP" --no-poll --quiet --json >/dev/null 2>&1      # unreadable ledger -> budget unknown
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

# ── F5-S1 g2. ...and a real ceiling that is simply FAR AWAY gives a number, not a shrug. ~99M of
#    tonight's ceiling left at ~100k/cycle at 1 cycle/h is ~990h: silly-looking, correct, rendered as days.
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

# ═══════════ GSL-221: the token ceiling — default / override / unlimited (d-2026-07-28-007) ═══════════
#
# The owner's directive, verbatim in spirit: a limit MAY exist, but it MUST be configurable; the
# default (16M/night) is only a default; and "no limits anywhere, run at maximum" is a FIRST-CLASS
# state of the system — RUNWAY and every reader of the ceiling must honestly say "unlimited", never
# an error, a zero, or a standing warning. Each case below drives the real chronicler.
echo "== GSL-221: token ceiling — default / override / unlimited (d-2026-07-28-007) =="

# (a) Per-NIGHT semantics: the first build of a day anchors night spend at the ledger's total, and
#     the anchor SURVIVES later passes of the same day. Compared against ALL history, the 16M default
#     would have screamed BUDGET_EXCEEDED forever on day one (the live ledger already stood above it).
RCD="$WORK/rw-ceiling-night"; rw_fixture "$RCD" 50 1
bash "$CH" --repo "$RCD" --no-poll --quiet --json >/dev/null 2>&1
[[ "$(rw '.cost.night_spend' "$RCD")" == "0" && "$(rw '.cost.night_anchor.base_total' "$RCD")" == "1000000" ]] \
  && ok "GSL-221: first build of the day anchors night spend at the ledger total (spend 0, base 1,000,000)" \
  || bad "GSL-221: night anchoring is wrong (spend=$(rw '.cost.night_spend' "$RCD") base=$(rw '.cost.night_anchor.base_total' "$RCD"))"
sed -i.bak 's/total≈1000000/total≈1250000/' "$RCD/docs/handoff/ORCHESTRATION-STATE.md"
bash "$CH" --repo "$RCD" --no-poll --quiet --json >/dev/null 2>&1
[[ "$(rw '.cost.night_spend' "$RCD")" == "250000" ]] \
  && ok "GSL-221: the second pass keeps the day's anchor — night spend 250,000, not re-zeroed" \
  || bad "GSL-221: the anchor re-zeroed mid-day (spend=$(rw '.cost.night_spend' "$RCD"))"

# (b) UNLIMITED IS FIRST-CLASS. The budget clock reads CLEAR — "the owner chose no limit" is
#     knowledge, exactly like "0 blockers" — and a night with no other stopper reads RUNWAY clear.
RCU="$WORK/rw-ceiling-unlimited"; rw_fixture "$RCU" 50 1
GOSLEEP_TOKEN_CEILING=unlimited bash "$CH" --repo "$RCU" --no-poll --quiet --json >/dev/null 2>&1
[[ "$(rw '.cost.ceiling_mode' "$RCU")" == "unlimited" && "$(rw '.cost.ceiling' "$RCU")" == "null" ]] \
  && ok "GSL-221 ⭐ GOSLEEP_TOKEN_CEILING=unlimited -> mode=unlimited, ceiling null by CHOICE, not by absence" \
  || bad "GSL-221 ⭐ unlimited mode did not register (mode=$(rw '.cost.ceiling_mode' "$RCU"))"
[[ "$(rw '.runway.clocks[] | select(.axis=="budget") | .state' "$RCU")" == "clear" ]] \
  && ok "GSL-221 ⭐ the budget clock reads CLEAR in unlimited mode — never unknown, never an alarm" \
  || bad "GSL-221 ⭐ unlimited rendered as $(rw '.runway.clocks[] | select(.axis=="budget") | .state' "$RCU") on the budget clock"
[[ "$(rw '.runway.bound' "$RCU")" == "clear" ]] \
  && ok "GSL-221 ⭐ an unlimited night with no blocker reads RUNWAY clear — the mode is first-class end to end" \
  || bad "GSL-221 ⭐ unlimited poisoned the runway (bound=$(rw '.runway.bound' "$RCU"))"
grep -q 'Unlimited mode' "$RCU/docs/lab/site/cost.html" \
  && ok "GSL-221: the Cost screen renders unlimited as a plain fact ('Unlimited mode.')" \
  || bad "GSL-221: the Cost screen hides or alarms on unlimited"
grep -q 'budget: \*\*unlimited\*\*' "$RCU/docs/lab/digest/$TODAY-morning.md" \
  && ok "GSL-221: the morning digest says 'unlimited' in the money section, as a choice" \
  || bad "GSL-221: the digest does not carry the unlimited state"

# (c) Synthetic excess: tonight 1,000,000 against a 500,000 ceiling -> BUDGET_EXCEEDED. The rule
#     that could never fire (audit finding 58) now can, and the runway names it.
RCX="$WORK/rw-ceiling-exceeded"; rw_fixture "$RCX" 50 1
printf '{"cost":{"night_anchor":{"date":"%s","base_total":0}}}\n' "$TODAY" > "$RCX/docs/lab/render_bundle.json"
GOSLEEP_TOKEN_CEILING=500000 bash "$CH" --repo "$RCX" --no-poll --quiet --json >/dev/null 2>&1
[[ "$(rw '.runway.binding' "$RCX")" == "budget" ]] \
  && jq -e '.runway.hours == 0' "$RCX/docs/lab/render_bundle.json" >/dev/null 2>&1 \
  && ok "GSL-221 ⭐ a synthetic excess drives the budget clock to 0h and binds the runway (finding 58 armed)" \
  || bad "GSL-221 ⭐ the exceeded ceiling did not bind (binding=$(rw '.runway.binding' "$RCX") hours=$(rw '.runway.hours' "$RCX"))"
rw '.runway.clocks[] | select(.axis=="budget") | .why' "$RCX" | grep -q 'BUDGET_EXCEEDED' \
  && ok "GSL-221: the exhausted clock names BUDGET_EXCEEDED (manifest section 3.budget), not a vague warning" \
  || bad "GSL-221: the exhausted budget clock does not name the manifest rule"
jq -e '.cost.used_pct == 200' "$RCX/docs/lab/render_bundle.json" >/dev/null 2>&1 \
  && ok "GSL-221: used_pct is of TONIGHT's ceiling (200%), not of all history" \
  || bad "GSL-221: used_pct is wrong (got $(rw '.cost.used_pct' "$RCX")%, expected 200%)"

# (d) A typo falls back to the DEFAULT, loudly — never to unlimited. Removing the limit takes the
#     explicit word; a misconfiguration must not remove it silently.
RCM="$WORK/rw-ceiling-typo"; rw_fixture "$RCM" 50 1
GOSLEEP_TOKEN_CEILING=lots bash "$CH" --repo "$RCM" --no-poll --quiet --json >/dev/null 2>&1
[[ "$(rw '.cost.ceiling_mode' "$RCM")" == "default" && "$(rw '.cost.ceiling' "$RCM")" == "16000000" ]] \
  && ok "GSL-221: a misconfigured value falls back to the default ceiling — never to unlimited" \
  || bad "GSL-221: GOSLEEP_TOKEN_CEILING=lots produced mode=$(rw '.cost.ceiling_mode' "$RCM") ceiling=$(rw '.cost.ceiling' "$RCM")"
jq -e '.degraded[] | select(.source=="cost")' "$RCM/docs/lab/render_bundle.json" >/dev/null 2>&1 \
  && ok "GSL-221: the fallback is LOUD — the misconfiguration lands in degraded[], on the record" \
  || bad "GSL-221: the misconfiguration was swallowed silently"

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

# GSL-191 (audit finding 54): THE ARCHIVE MUST EQUAL THE CLOSED SET. The retention filter used to
# name the closed statuses itself, with an underscore (auto_resolved), while lab-emit — the one
# writer — spells them with hyphens (auto-resolved, answered-by-default; STATUSES in lab-emit.sh).
# The archive silently kept 2 of 21 closed questions, and nothing counted the loss. Closed is now
# defined negatively ("status != open"), and this check pins it: one question per closing PATH
# (CLARIFY -> answered-by-default, resolve -> auto-resolved, answer -> answered), then archived
# must equal closed, counted through the same tool the chronicler itself reads.
Q_ARC_RES="$(GOSLEEP_LAB_DIR="$CR/docs/lab" "$LE" question --type DECISION --from smoke-chron --task GSL-191 \
  --question "archive smoke: does an auto-resolved DECISION reach the archive?" \
  --default "yes" --default-rationale "smoke" --reversibility high)"
Q_ARC_ANS="$(GOSLEEP_LAB_DIR="$CR/docs/lab" "$LE" question --type DECISION --from smoke-chron --task GSL-191 \
  --question "archive smoke: does an answered DECISION reach the archive?" \
  --default "yes" --default-rationale "smoke" --reversibility high)"
GOSLEEP_LAB_DIR="$CR/docs/lab" "$LE" question --type CLARIFY --from smoke-chron --task GSL-191 \
  --question "archive smoke: does an answered-by-default CLARIFY reach the archive?" \
  --default "proceed" --default-rationale "smoke" --reversibility high >/dev/null
GOSLEEP_LAB_DIR="$CR/docs/lab" "$LE" resolve --re "$Q_ARC_RES" --applied "smoke default" >/dev/null
GOSLEEP_LAB_DIR="$CR/docs/lab" "$LE" answer  --re "$Q_ARC_ANS" --answer "yes" --by smoke >/dev/null
bash "$CH" --repo "$CR" --no-poll --quiet --json >/dev/null 2>&1
ARC_CLOSED="$(GOSLEEP_LAB_DIR="$CR/docs/lab" "$LE" list --status all --json 2>/dev/null \
  | jq -s '[.[] | select(.status != "open")] | length')"
ARC_KEPT="$(wc -l < "$CR/docs/lab/questions/archive.jsonl" 2>/dev/null | tr -d ' ')"
[[ -n "$ARC_CLOSED" && "$ARC_CLOSED" != "0" && "$ARC_KEPT" == "$ARC_CLOSED" ]] \
  && ok "GSL-191: archived == closed ($ARC_KEPT of $ARC_CLOSED) — the archive keeps every closed question" \
  || bad "GSL-191: archive.jsonl holds ${ARC_KEPT:-0} of ${ARC_CLOSED:-?} closed questions — the closed-status filter drifted from lab-emit again"
jq -s -e 'map(.status) | (index("auto-resolved") != null) and (index("answered-by-default") != null) and (index("answered") != null)' \
  "$CR/docs/lab/questions/archive.jsonl" >/dev/null 2>&1 \
  && ok "GSL-191: all three closing paths (answered / auto-resolved / answered-by-default) are IN the archive" \
  || bad "GSL-191: a closing path is missing from the archive — a reader is transcribing the writer's vocabulary again"

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
# GSL-208 added `signal` (the meaningful/routine view mode) at the FRONT of the facet list — first
# because it is the control the owner reaches for at 07:00. The expected list is spelled out in full
# rather than loosened to a substring: the point of this assertion is that the island offers exactly
# the facets the page was built with, and a wildcard here would let a facet go missing unnoticed.
grep -q 'ROWS=5|DOM=5' <<<"$ISL" && grep -q 'FACETS=signal,actor,type,severity,src' <<<"$ISL" \
  && ok "GSL-97: the inlined island describes exactly the rows the page rendered (signal/actor/type/severity/src)" \
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
# GSL-205 put a SECOND kind of anchor in these rows: the Jira key inside a document title, which
# resolves at the tracker and has no file behind it by construction. This assertion is about the
# ARTIFACT links — the memory that survives retention still opens — so identifier links are excluded
# by the mark they all carry, and are asserted separately under GSL-205. Excluding them by "looks
# absolute" would have been the loose version: an artifact href is always repo-relative, so the
# tighter test is the one that names what it is skipping.
# (NO APOSTROPHES IN THIS BLOCK: bash 3.2 counts quotes inside a quoted heredoc that sits in $( ),
#  and one stray one turns this assignment into a parse error — the chronicler.sh header lesson.)
tags = re.findall(r'<a\s([^>]*?)>', rows.group(1), re.S) if rows else []
hrefs = [m.group(1) for t in tags if "data-idlink" not in t
         for m in [re.search(r'href="([^"]+)"', t)] if m]
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
#     (GSL-193 deepened Reviews and Reports to `**` and added the Skills shelf — the greps assert the
#     DEEP globs, so a silent retreat to one-level masks fails here, not in the owner's morning.)
grep -q 'docs/reviews/\*\*/\*.md' "$LP" && grep -q 'docs/reports/\*\*/\*incident\*' "$LP" \
  && grep -q 'docs/reports/\*\*/index.html' "$LP" && grep -q 'skill/\*\*/\*.md' "$LP" \
  && ok "GSL-97: every shelf prints the glob it was built from — an empty shelf proves it looked" \
  || bad "GSL-97: a Library section does not say where it looked, so an empty one proves nothing"

# 14b. GSL-193 (audit findings 18 + 94): THE SHELVES REACH ALL THE WAY DOWN. Reports used to glob
#      `*/index.html` — one level — while the main acceptance artifact of four straight shifts lives
#      at docs/reports/verifications/<KEY>/runs/NN/index.html; Reviews globbed `REVIEW-*.md` and hid
#      every file of the owner's own commissioned system audit in docs/reviews/<audit-dir>/. And the
#      cross-index of everything the project produces had no shelf for the product itself — skill/.
#      A dedicated fixture, because the depth is the thing under test: one artifact per shelf, each
#      nested where the one-level glob was blind.
LD="$WORK/lib-depth"
mkdir -p "$LD/docs/lab/events" "$LD/docs/reports/verifications/GSL-1/runs/01" \
         "$LD/docs/reviews/system-audit-2026-01-01" "$LD/skill/demo-skill"
: > "$LD/docs/lab/events/$TODAY.jsonl"
printf '<title>Verification run 01</title>\n' > "$LD/docs/reports/verifications/GSL-1/runs/01/index.html"
printf '# Audit synthesis\n' > "$LD/docs/reviews/system-audit-2026-01-01/SYNTHESIS.md"
printf '# Demo skill\n' > "$LD/skill/demo-skill/SKILL.md"
bash "$CH" --repo "$LD" --no-poll --quiet --json >/dev/null 2>&1
LDB="$LD/docs/lab/render_bundle.json"
jq -e '.library.sections[] | select(.key=="reports") | .items | map(.href) | any(endswith("verifications/GSL-1/runs/01/index.html"))' "$LDB" >/dev/null \
  && ok "GSL-193: a verification run nested three levels down IS on the Reports shelf" \
  || bad "GSL-193: the Reports shelf still stops one level down — the nested run is invisible"
jq -e '.library.sections[] | select(.key=="reviews") | .items | map(.href) | any(endswith("system-audit-2026-01-01/SYNTHESIS.md"))' "$LDB" >/dev/null \
  && ok "GSL-193: an audit file inside a docs/reviews subdirectory IS on the Reviews shelf" \
  || bad "GSL-193: the Reviews shelf still sees only REVIEW-*.md — the system audit is invisible"
jq -e '.library.sections[] | select(.key=="skills") | (.dir_exists == true) and (.items | map(.href) | any(endswith("demo-skill/SKILL.md")))' "$LDB" >/dev/null \
  && ok "GSL-193: the Skills shelf exists and lists the project's own skill/" \
  || bad "GSL-193: skill/ has no shelf — the cross-index skips the core product"
jq -e '[.library.sections[] | .count == (.items | length)] | all' "$LDB" >/dev/null \
  && ok "GSL-193: every shelf's printed count equals what its printed glob found" \
  || bad "GSL-193: a shelf's count and its glob disagree — the page's homework does not check out"

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

# ════════ GSL-133 / T1: the two MAJOR findings the redesign's foundation closes ════════
# Both defects were invisible to every assertion above, and invisible in the same WAY: the markup
# said the right thing and the page did not show it. Neither is catchable by reading the markup —
# one needs the stylesheet that markup resolves against, the other a character count on the cell
# the reader is actually handed.
#
#   GSL-124 — .ok/.warn/.dead have sat in the markup since Phase 5 with NO rule behind them, so a
#     Self-health WARNING printed in rgb(23,23,26): exactly the body colour. Only composite
#     selectors (.sh-m.ok, .runway.warn, .tag.sev.incident) were ever declared, which is why this
#     reads as styled on inspection and is not. A page that cannot raise its voice about its own
#     rot is the failure this laboratory exists to refuse.
#   GSL-121 — eventDetail() ended in a 90-character slice that cut 37 of the 90 detail values on
#     the live bundle mid-word: no ellipsis, no tooltip, and the remainder ABSENT FROM THE DOM, so
#     it could not be recovered even by searching the page. Silent truncation, the same defect
#     class as the clipped mono card above, one function call away from the reader.
#
# Positive controls first and they are not optional: a guard that cannot recognise the broken state
# is a green tick over nothing.
sh_bare_ink() { grep -qE "span\.$2\{[^}]*color:var\(--$2\)" "$1"; }

printf '<style>.sh-m.ok{border-left-color:var(--ok)}\n.runway.warn{color:var(--warn)}\n.tag.sev.incident{color:var(--dead)}</style>\n' > "$WORK/inks-prefix.html"
INKCTL=0
for C in ok warn dead; do sh_bare_ink "$WORK/inks-prefix.html" "$C" && INKCTL=1; done
[[ $INKCTL -eq 0 ]] \
  && ok "GSL-124: the bare-ink detector rejects a composite-only stylesheet (positive control)" \
  || bad "GSL-124: the bare-ink detector ACCEPTS the pre-fix stylesheet — it cannot see the defect it guards"
INKMISS=""
for C in ok warn dead; do sh_bare_ink "$SHI" "$C" || INKMISS="$INKMISS $C"; done
[[ -z "$INKMISS" ]] \
  && ok "GSL-124 ⭐ bare .ok/.warn/.dead carry their own ink — a Self-health warning cannot print in body colour" \
  || bad "GSL-124 ⭐ bare status classes still have no rule ($INKMISS ): the warning is drawn as ordinary prose"

# The fixture carries ONE event whose detail is longer than the cap the view used to apply, so the
# tail past character 90 exists on the page only if nothing truncated it. Asserted on the GENERATED
# page, never on the source: the page is what the reader is handed.
DTL="$WORK/f6-detail"; shx_init "$DTL"
DTLV="git log --oneline --decorate -- docs/lab/site/index.html docs/lab/site/timeline.html docs/lab/ui/src/theme.ts docs/lab/ui/src/components.tsx"
printf '{"ts":"%s","run_id":"%s","seq":1,"actor":"claude","type":"vcs.commit","src":"emit","session_id":"s1","data":{"cmd":"%s"}}\n' \
  "$(python3 -c "import datetime;print(datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))")" \
  "$TODAY" "$DTLV" > "$DTL/docs/lab/events/$TODAY.jsonl"
bash "$CH" --repo "$DTL" --no-poll --quiet --json >/dev/null 2>&1
[[ ${#DTLV} -gt 90 ]] \
  && ok "GSL-121: the trap is armed — the fixture detail is ${#DTLV} chars, past the 90 the view used to cut at" \
  || bad "GSL-121: the fixture detail is only ${#DTLV} chars, so the truncation assertion below proves nothing"
grep -qF "$DTLV" "$DTL/docs/lab/site/timeline.html" \
  && ok "GSL-121 ⭐ a ${#DTLV}-character detail reaches the page whole — the silent 90-char cut is gone" \
  || bad "GSL-121 ⭐ the detail cell is still truncated: everything past character 90 is absent from the DOM"

# ════════ GSL-134 / T2: the three MAJOR findings this pass closes ════════
# Same family as everything above: the markup or the data was right and the page still misled the
# reader. None is catchable by reading a class name — one needs the client bundle run against a moved
# clock, one needs the page rendered from a bundle that carries a live count, one needs the banner
# inspected for the escape hatch a no-JS reader depends on.

# ── GSL-126 ⭐: the banner age must keep ticking INSIDE the fresh window, not only when the grade
#    drops. The old regrade() returned early whenever the grade did not get worse, and the early
#    return took the AGE with it: a page opened 29 minutes after the build still read "last event 7s
#    ago" while the self-health card two blocks down showed the true 29m. The grade DID update on a
#    threshold crossing, so the mechanism looked alive; it was wired to the threshold, not the clock.
#    Run the page's OWN inlined bundle with a stub DOM and a moved clock — nothing is mocked but the
#    environment, and the staleness dataset is ours so the fresh window is controlled rather than
#    whatever tonight's data happens to be.
cat > "$WORK/gsl126.mjs" <<'JS'
import { readFileSync } from "node:fs";
const html = readFileSync(process.argv[2], "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);   // the one <script> with no attrs: the client bundle
if (!m) { console.log("NO_CLIENT=1"); process.exit(0); }
const code = m[1];
const GEN = "2026-07-20T00:00:00Z";
const built = Date.parse(GEN);
function open(nowMs) {
  const staleness = { className: "stale fresh",
    dataset: { grade: "fresh", generatedAt: GEN, eventAgeS: "7", freshS: "1800", deadS: "10800" } };
  const head = { textContent: "SEED" };
  const verdict = { textContent: "SEEDV" };
  const verdicts = { textContent: JSON.stringify({ fresh: "FRESHV", stale: "STALEV", dead: "DEADV" }) };
  const byId = { staleness, "stale-head": head, "stale-verdict": verdict, verdicts };
  const document = { getElementById: (id) => byId[id] ?? null, querySelectorAll: () => [] };
  new Function("document", "setInterval", "Date", code)(
    document, () => 0, { now: () => nowMs, parse: (s) => Date.parse(s) });
  return { head, staleness };
}
const t0  = open(built);
const t20 = open(built + 20 * 60 * 1000);            // still inside fresh (< 30m)
const t4h = open(built + 4 * 3600 * 1000);           // past dead (> 3h)
console.log("T0_HEAD="   + t0.head.textContent);
console.log("T20_HEAD="  + t20.head.textContent);
console.log("T20_GRADE=" + t20.staleness.dataset.grade);
console.log("T4H_GRADE=" + t4h.staleness.dataset.grade);
JS
G126="$(node "$WORK/gsl126.mjs" "$SHI" 2>&1)"
grep -qE 'T0_HEAD=.*last event 7s ago' <<<"$G126" \
  && ok "GSL-126: at the build instant the banner age is honest (7s) — the no-JS reader is not lied to (positive control)" \
  || bad "GSL-126: the build-instant banner age is wrong ($(grep '^T0_HEAD=' <<<"$G126"))"
grep -qE 'T20_HEAD=.*last event 20m ago' <<<"$G126" && grep -q 'T20_GRADE=fresh' <<<"$G126" \
  && ok "GSL-126 ⭐ opened 20m after the build and still fresh, the banner reads 20m — the age ticks inside the window, not only on a grade drop" \
  || bad "GSL-126 ⭐ the banner age is FROZEN inside the fresh window (still 7s at +20m): $(grep '^T20_' <<<"$G126")"
grep -q 'T4H_GRADE=dead' <<<"$G126" \
  && ok "GSL-126: 4h on, the verdict still re-grades to DEAD — the never-soften guard is intact (positive control)" \
  || bad "GSL-126: the re-grade to dead broke ($(grep '^T4H_GRADE=' <<<"$G126"))"

# ── GSL-129 ⭐: the "live workers" KPI and the (mostly ended) worker cards are different populations
#    from different sources — open panes now vs every worker the log could name over the window. Set
#    side by side with no bridge they read as one contradictory set ("2 live" over eight ended cards).
#    The bridge sentence tells them apart and appears IFF a live count exists to bridge, ABOVE the
#    first card. Rendered from the REAL bundle with the count forced on, then off: the page is what the
#    reader is handed, so it is asserted on the rendered page, never on the source.
BR="$WORK/gsl129"; mkdir -p "$BR"
G129P='the log could name over the window'   # a phrase from the bridge itself, absent from every comment
jq '.fleet.open_workers = 2'    "$REPO_ROOT/docs/lab/render_bundle.json" | node "$REPO_ROOT/tools/lab/ui/build.mjs" > "$BR/live.json" 2>/dev/null
jq '.fleet.open_workers = null' "$REPO_ROOT/docs/lab/render_bundle.json" | node "$REPO_ROOT/tools/lab/ui/build.mjs" > "$BR/null.json" 2>/dev/null
G129="$(python3 - "$BR/live.json" "$BR/null.json" "$G129P" <<'PY'
import json, sys
live = json.load(open(sys.argv[1]))["pages"]["fleet.html"]
none = json.load(open(sys.argv[2]))["pages"]["fleet.html"]
p = sys.argv[3]
i, c = live.find(p), live.find('class="wk ')
print("LIVE_PRESENT=%d" % (1 if i >= 0 else 0))
print("LIVE_BEFORE_CARD=%d" % (1 if (i >= 0 and c >= 0 and i < c) else 0))
print("NULL_PRESENT=%d" % (1 if none.find(p) >= 0 else 0))
PY
)"
grep -q 'NULL_PRESENT=0' <<<"$G129" \
  && ok "GSL-129: with the live count unknown the bridge is absent — it appears only when two numbers exist to reconcile (positive control)" \
  || bad "GSL-129: the bridge prints even with no live count — it is unconditional, so it proves nothing ($G129)"
grep -q 'LIVE_PRESENT=1' <<<"$G129" && grep -q 'LIVE_BEFORE_CARD=1' <<<"$G129" \
  && ok "GSL-129 ⭐ '2 live workers' over ended cards no longer reads as one set — a bridge above the first card names the two as different questions" \
  || bad "GSL-129 ⭐ the KPI and the cards stand adjacent with no reconciliation ($G129)"

# ── GSL-115 ⭐: with JS off nothing re-grades, so a fresh-graded page keeps asserting "Live — the
#    laboratory is writing itself right now" forever, on a file that may be days old. The finding
#    measured ZERO <noscript> anywhere. The honest degradation is a <noscript> INSIDE the banner that
#    tells a scriptless reader the age is frozen at build time. Asserted structurally, so an empty
#    <noscript></noscript> cannot satisfy it.
sh_banner_noscript() {  # exit 0 iff the staleness banner carries a non-empty <noscript>
  python3 -c '
import re, sys
h = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r"id=\"staleness\".*?</div>", h, re.S)
sys.exit(0 if (m and re.search(r"<noscript>\s*\S", m.group(0))) else 1)
' "$1"
}
printf '<div class="stale fresh" id="staleness"><span id="stale-head">FRESH</span><small>x</small></div>\n' > "$WORK/gsl115-prefix.html"
sh_banner_noscript "$WORK/gsl115-prefix.html" \
  && bad "GSL-115: the noscript detector ACCEPTS a banner with none — it cannot see the defect it guards" \
  || ok "GSL-115: the noscript detector rejects the pre-fix banner (positive control)"
sh_banner_noscript "$SHI" \
  && ok "GSL-115 ⭐ the staleness banner carries a <noscript> — a no-JS reader is told the age is frozen, not left under a permanent 'right now'" \
  || bad "GSL-115 ⭐ the banner has no <noscript>: with JS off the build-time 'Live … right now' stands unbounded"

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

# ---- ⭐ GSL-113: the grade does not outlive the build that issued it ----------------
# This page printed `🟢 FRESH · last event 1m ago` and went on printing it forever. Markdown runs no
# JavaScript, so unlike the seven screens it cannot re-grade itself on open (client.ts:
# regradeStaleness) — and `ago` counts backwards from a NOW that a file frozen in git cannot know. A
# chronicler dead since 16:04 therefore left a green dot at 03:00 on the one surface reachable from
# bed. The checks below guard the two properties that replace the re-grade it cannot perform.
grep -qE '^[^ ]+ \*\*(FRESH|STALE|DEAD) at build\*\*' "$MBP" \
  && ok "GSL-113 ⭐ the grade is stamped 'at build' — the page says when its verdict was true, not that it is true now" \
  || bad "GSL-113 ⭐ the phone page prints a bare grade — a build-time verdict passed off as the reader's present"

grep -qE 'last event \*\*[^*]+\*\* ago' "$MBP" \
  && bad "GSL-113 ⭐ the page still says 'last event X ago' — 'ago' counts from a NOW this file cannot know" \
  || ok "GSL-113 ⭐ no 'X ago' on the phone page — the event age carries an absolute anchor instead"

grep -qi 'frozen at build time' "$MBP" \
  && ok "GSL-113: the page carries the caveat its HTML sibling carries four of — it warns it cannot re-grade itself" \
  || bad "GSL-113: 67 lines and not one caveat about build time — the reader is never told the verdict is frozen"

# It cannot run the client's sum, but it CAN solve that same sum for the instant each threshold tips
# and print it as an ABSOLUTE moment — the only currency on this page that does not decay in git. The
# expected value is computed here independently, so a typo in the formula fails as loudly as a missing
# line: this is the check that a reader's clock-comparison is actually correct, not merely present.
MB_DEAD_EXP="$(jq -r '((.generated_at|fromdateiso8601) + .staleness.thresholds_s.dead - .staleness.max_event_age_s) | strftime("%Y-%m-%dT%H:%M:%SZ")' "$MB/docs/lab/status.json" 2>/dev/null)"
[[ -n "$MB_DEAD_EXP" ]] && grep -qF "DEAD if you are reading this after \`$MB_DEAD_EXP\`" "$MBP" \
  && ok "GSL-113 ⭐ it prints the absolute moment it turns DEAD ($MB_DEAD_EXP) — the reader compares it against the clock in his hand" \
  || bad "GSL-113 ⭐ no correct DEAD-after moment on the phone page (expected $MB_DEAD_EXP) — the reader is asked for arithmetic he has no numbers for"

# ---- ⭐ and those moments may only ever grade the page WORSE -------------------------
# `never soften a verdict` is a guard the HTML enforces in code (client.ts) and this page must enforce
# in what it prints: a page already STALE at build must not advertise the moment it would become
# stale — that is a threshold it has crossed, and printing it invites the reader to re-earn `fresh`
# backwards. A clock only moves one way; the printed list must respect that.
MBS="$WORK/mobile-stale"
mkdir -p "$MBS/docs/lab/events" "$MBS/docs/lab/questions" "$MBS/docs/lab/decisions"
: > "$MBS/docs/lab/questions/queue.jsonl"
MBS_TS="$(python3 -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=60)).strftime('%Y-%m-%dT%H:%M:%SZ'))")"
printf '{"ts":"%s","run_id":"%s","seq":1,"actor":"w1","type":"vcs.commit","src":"hook:PostToolUse","data":{"sha":"beef002"}}\n' \
  "$MBS_TS" "$MB_TODAY" > "$MBS/docs/lab/events/$MB_TODAY.jsonl"
bash "$CH" --repo "$MBS" --no-poll --quiet --json >/dev/null 2>&1
MBSP="$MBS/docs/lab/mobile/README.md"
[[ "$(jq -r '.staleness.grade' "$MBS/docs/lab/status.json" 2>/dev/null)" == "stale" ]] \
  && ok "GSL-113: the stale fixture really did grade stale (control — the guard check below has a subject)" \
  || bad "GSL-113: the stale fixture did not grade stale — the softening check below proves nothing"
if grep -q 'STALE if you are reading this after' "$MBSP" 2>/dev/null; then
  bad "GSL-113 ⭐ an already-STALE page still advertises when it will become STALE — a verdict offered backwards"
else
  grep -q 'DEAD if you are reading this after' "$MBSP" 2>/dev/null \
    && ok "GSL-113 ⭐ an already-STALE page prints only its DEAD moment — the grade may fall further, never recover" \
    || bad "GSL-113 ⭐ an already-STALE page names no moment at all — it can no longer tell the reader when to stop trusting it"
fi

echo
echo "== GSL-137 / F5-S4c: the phone projection speaks the redesign's language, within Markdown =="
# T5 of the GSL-111 relayout. This page is Markdown GitHub renders server-side, so the redesign's CSS
# never reaches it; what transfers is the LANGUAGE. Four properties below, each built from a fixture so
# a green run reads real generator output, not this file's prose: a runway deadline stated as an
# absolute instant (never a countdown a frozen file cannot keep), an icon only where there is an alarm,
# a trimmed list that says how much it hid, and the one magnitude a table can align, aligned.
MB5="$WORK/mobile-gsl137"
mkdir -p "$MB5/docs/lab/events" "$MB5/docs/lab/questions" "$MB5/docs/lab/decisions"
MB5_TS="$(python3 -c "import datetime;print(datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))")"
# A commit (so the pass is fresh) plus two task-status transitions: known states the Tasks table lists.
{
  printf '{"ts":"%s","run_id":"r","seq":1,"actor":"w1","type":"vcs.commit","src":"hook:PostToolUse","data":{"sha":"beef137"}}\n' "$MB5_TS"
  printf '{"ts":"%s","run_id":"r","seq":2,"actor":"w1","type":"tracker.issue.status","src":"poll-fill","data":{"key":"GSL-901","status":"In Progress","occurred_at":"%s"}}\n' "$MB5_TS" "$MB5_TS"
  printf '{"ts":"%s","run_id":"r","seq":3,"actor":"w1","type":"tracker.issue.status","src":"poll-fill","data":{"key":"GSL-902","status":"Done","occurred_at":"%s"}}\n' "$MB5_TS" "$MB5_TS"
} > "$MB5/docs/lab/events/$MB_TODAY.jsonl"
# One open BLOCKER — it makes the blockers clock the next runway event AND puts an alarm in section 1.
# One open DECISION — a waiting item that is NOT an alarm, so it must carry no icon.
{
  printf '{"id":"q-mb5-blk","ts":"%s","type":"BLOCKER","status":"open","from":"w1","task":"GSL-901","question":"MB5-BLOCKER-QUESTION","channel":"chat"}\n' "$MB5_TS"
  printf '{"id":"q-mb5-dec","ts":"%s","type":"DECISION","status":"open","from":"w1","task":"GSL-902","question":"MB5-DECISION-QUESTION","channel":"chat","default":"the default"}\n' "$MB5_TS"
} > "$MB5/docs/lab/questions/queue.jsonl"
# Six decisions in the log; the page shows four, so the honest-truncation marker must name the other two.
: > "$MB5/docs/lab/decisions/log.jsonl"
for mb5i in 1 2 3 4 5 6; do
  printf '{"id":"d-2026-07-20-90%s","ts":"2026-07-20T1%s:00:00Z","re":"q","task":"GSL-90%s","type":"DECISION","question":"?","decision":"MB5-DECISION-%s","made_by":"orchestrator","rule":"r"}\n' "$mb5i" "$mb5i" "$mb5i" "$mb5i" >> "$MB5/docs/lab/decisions/log.jsonl"
done
bash "$CH" --repo "$MB5" --no-poll --quiet --json >/dev/null 2>&1
MB5P="$MB5/docs/lab/mobile/README.md"

# ---- positive control: the fixture really exercised every branch the checks below read --------------
MB5_TASKROWS="$(jq -r '.tasks.by_status | to_entries | map(select(.key!="unknown")) | length' "$MB5/docs/lab/render_bundle.json" 2>/dev/null)"
{ [[ -s "$MB5P" ]] && [[ "$(jq -r '.runway.next_event.label' "$MB5/docs/lab/render_bundle.json" 2>/dev/null)" == "open blockers" ]] \
  && [[ "${MB5_TASKROWS:-0}" -ge 2 ]] && grep -q 'MB5-DECISION-QUESTION' "$MB5P"; } \
  && ok "GSL-137: the fixture built a page with a next runway event, known task states, a non-alarm question and six decisions (positive control — the checks below have input)" \
  || bad "GSL-137: the GSL-137 fixture did not exercise a branch the checks below read — they would pass vacuously"

# ---- the next runway event is an ABSOLUTE instant, not a countdown a frozen file cannot keep --------
# 'Next runway event: X in 1m' counted minutes from a NOW Markdown cannot see: baked at 23:00 it still
# read 'in 1m' at 03:00, five hours after it passed. The moment itself — generated_at + the offset —
# does not decay in git. Computed here from the bundle so a typo in the formula fails as loudly as an
# absence. Both checks read only the runway line, since generated_at also appears in the header above.
MB5_RUNLINE="$(grep 'Next runway event:' "$MB5P" 2>/dev/null)"
MB5_EVENT_AT="$(jq -r '((.generated_at|fromdateiso8601) + ((.runway.next_event.hours)*3600)) | strftime("%Y-%m-%dT%H:%M:%SZ")' "$MB5/docs/lab/render_bundle.json" 2>/dev/null)"
[[ -n "$MB5_EVENT_AT" ]] && grep -qF "\`$MB5_EVENT_AT\`" <<<"$MB5_RUNLINE" \
  && ok "GSL-137 ⭐ the next runway event prints the absolute moment it is due ($MB5_EVENT_AT) — the reader compares it to the clock in his hand" \
  || bad "GSL-137 ⭐ no correct absolute moment on the runway line (expected $MB5_EVENT_AT) — the timing was not placed on a clock the reader shares"
grep -qE 'in \*\*[0-9]' <<<"$MB5_RUNLINE" \
  && bad "GSL-137 ⭐ the runway line still counts 'in **N**' — a countdown a Markdown file cannot keep as the night wears on" \
  || ok "GSL-137 ⭐ no relative 'in **N**' on the runway line — the deadline is an instant, not an offset from a NOW this file cannot read"

# ---- an icon only where there is an alarm (redesign section 7.2, projected to Markdown) -------------
# The colour channel of the seven screens is emoji here. A BLOCKER stops the night and earns 🛑; a
# DECISION is metadata about a question, and a glyph beside every one of them is the decorative noise
# the redesign spends itself to remove. Both must hold at once: the alarm marked, the non-alarm bare.
grep -qE '^- 🛑 \*\*BLOCKER\*\*' "$MB5P" \
  && ok "GSL-137: the BLOCKER carries its alarm 🛑 (positive control — the discipline is not 'strip every icon')" \
  || bad "GSL-137: the BLOCKER lost its 🛑 — the one waiting item that stops the night is no longer marked"
grep -qE '❓ \*\*(DECISION|CLARIFY|FYI)\*\*' "$MB5P" \
  && bad "GSL-137 ⭐ a non-alarm question still carries a decorative ❓ — status signal spent on metadata, the anti-pattern the redesign names" \
  || ok "GSL-137 ⭐ the DECISION waits without an icon — the emoji channel is reserved for the verdict that has one"

# ---- a trimmed list says how much it hid (redesign section 6.4: no silent truncation) --------------
# '…and N more' is the idiom GSL-131 held up as the honest cut. The log has six decisions and the page
# shows four; the two it drops are named, the same way the commit list names its overflow.
grep -qF '…and 2 more' "$MB5P" \
  && ok "GSL-137 ⭐ the decisions list names the two it did not show — the trim is declared, not silent" \
  || bad "GSL-137 ⭐ four of six decisions shown and the other two vanish unremarked — a silent truncation on the honesty page"

# ---- the count a table can align is right-aligned (redesign section 6.4) ----------------------------
# The task counts are the one magnitude this projection compares, and Markdown aligns a column with a
# '--:' rule. The old page joined them into a '· **N** State' sentence with nothing to align.
awk '/^## 4\. Tasks/{f=1;next} /^## 5\./{f=0} f' "$MB5P" | grep -qF -- '--:' \
  && ok "GSL-137 ⭐ the Tasks section is a table with a right-aligned count column — the number the reader scans is aligned to compare" \
  || bad "GSL-137 ⭐ the Tasks counts are not in a right-aligned table — the one magnitude on the page is left unaligned"

echo
echo "== GSL-107 / F6-S4: break-glass — the chain reports its WEAKEST link, not its best =="
# Break-glass is five links: tailscale CLI -> tailnet -> an SSH transport -> mosh-server -> tmux.
# The failure mode this guards is specific and seductive: Tailscale goes green, mosh is installed,
# and the path LOOKS ready — but mosh bootstraps mosh-server over SSH, so with no SSH terminator
# the tailnet leads nowhere. A preflight that graded the links it could see and stayed quiet about
# that one would hand the owner a false green on the one night the path is load-bearing.
BGP="$REPO_ROOT/tools/breakglass/bg-preflight.sh"
BGR="$REPO_ROOT/docs/runbooks/break-glass.md"

if [[ ! -x "$BGP" ]]; then
  bad "GSL-107: tools/breakglass/bg-preflight.sh missing or not executable — nothing can ask whether the last line is reachable"
else
  ok "GSL-107: bg-preflight.sh present and executable"
  bash -n "$BGP" && ok "GSL-107: bash -n (syntax)" || bad "GSL-107: bash -n (syntax)"

  # A hermetic tailnet: the verdicts below must not depend on whether the owner has installed
  # Tailscale since this was written. FAKE_RUNSSH drives the one pref the transport check reads.
  BGFAKE="$WORK/bg-fakebin"; mkdir -p "$BGFAKE"
  cat > "$BGFAKE/tailscale" <<'BGEOF'
#!/usr/bin/env bash
if [[ "$1" == "status" ]]; then
  echo '{"BackendState":"Running","Self":{"TailscaleIPs":["100.101.102.103"]}}'
elif [[ "$1" == "debug" && "$2" == "prefs" ]]; then
  [[ "${FAKE_RUNSSH:-}" == "none" ]] || echo "{\"RunSSH\":${FAKE_RUNSSH:-true}}"
fi
BGEOF
  printf '#!/usr/bin/env bash\necho "mosh-server (fake)"\n' > "$BGFAKE/mosh-server"
  # tmux is faked too: a machine with no live sessions has nothing to attach to, and that is a
  # real degraded state — but it must not be the reason the ready control below fails.
  printf '#!/usr/bin/env bash\n[[ "$1" == "list-sessions" ]] && echo fleet\nexit 0\n' > "$BGFAKE/tmux"
  chmod +x "$BGFAKE"/*
  bg_run() {  # $1 = RunSSH value (true|false|none), $2 = sshd state (on|off); echoes the JSON
    env PATH="$BGFAKE:$PATH" FAKE_RUNSSH="$1" BG_SSHD_STATE="$2" bash "$BGP" --json 2>/dev/null
  }
  bg_status() { python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])' <<<"$1" 2>/dev/null; }

  # ---- positive control FIRST --------------------------------------------------
  # Every ⭐ below asserts "the verdict is NOT ready". All of them pass vacuously against a script
  # pinned to degraded, so the discriminating case is proven before any of them is believed.
  BG_READY="$(bg_run true off)"
  [[ "$(bg_status "$BG_READY")" == "ready" ]] \
    && ok "GSL-107: a complete chain does yield ready (positive control — the not-ready checks below discriminate)" \
    || bad "GSL-107: a complete chain never reports ready — the verdict is pinned, and every check below proves nothing"

  # ---- ⭐ a green tailnet is not a transport -----------------------------------
  BG_NOSSH="$(bg_run false off)"
  [[ "$(bg_status "$BG_NOSSH")" != "ready" ]] \
    && ok "GSL-107 ⭐ tailnet up + mosh installed + NO ssh transport never reads ready — mosh would have nothing to bootstrap over" \
    || bad "GSL-107 ⭐ a transportless chain reported ready: the owner is told break-glass works on the night the tailnet leads nowhere"

  # ---- ⭐ unknown is not off, and it is certainly not on -----------------------
  # Tailscale is absent from this machine, so the RunSSH probe is written from the documented
  # surface and unproven. An unreadable probe must therefore report unknown — and unknown must
  # never be rounded up into a green verdict (the GSL-109 lesson, applied to a chain instead of a colour).
  BG_UNK="$(bg_run none off)"
  python3 -c 'import json,sys
r=json.load(sys.stdin)
assert r["tailscale_ssh"]=="unknown", r["tailscale_ssh"]
assert r["status"]!="ready", r["status"]' <<<"$BG_UNK" \
    && ok "GSL-107 ⭐ an unreadable ssh-transport probe reads unknown and never yields ready — it is not rounded up" \
    || bad "GSL-107 ⭐ an unknown transport was treated as present: a probe that cannot see is reporting good news"

  # ---- ⭐ the exposure of the fallback path is stated, not swallowed -----------
  # Remote Login DOES complete the chain, so a preflight optimising for green would happily call
  # it ready. It also opens :22 on every interface the Mac has. F6-S4 says "without opening
  # inbound ports"; a path that satisfies the router and not the machine must say so out loud.
  BG_RL="$(env PATH="$BGFAKE:$PATH" FAKE_RUNSSH=false BG_SSHD_STATE=on bash "$BGP" 2>/dev/null)"
  grep -qi "every interface" <<<"$BG_RL" \
    && ok "GSL-107 ⭐ Remote Login as the only transport is reported WITH its exposure (:22 on every interface)" \
    || bad "GSL-107 ⭐ the fallback path's exposure is silent — the owner opens :22 to cafe Wi-Fi believing 'no inbound ports' still holds"

  # ---- ⭐ preflight reports; it does not act ------------------------------------
  # Installing a VPN, enabling sshd or killing a pane are owner decisions made awake. A verifier
  # that took any of them would be an incident, not a report.
  bg_exec_lines() {  # strip comments and printer lines, same discipline as the GSL-104 block
    python3 - "$1" <<'PY'
import sys
PRINTERS=("good","warn","dead","note","echo","printf")
for raw in open(sys.argv[1]):
    line, q, out = raw.rstrip("\n"), None, []
    for ch in line:
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
  BG_EXEC="$(bg_exec_lines "$BGP")"
  grep -qE 'tailscale.*status|TS_STATUS_CMD' <<<"$BG_EXEC" \
    && ok "GSL-107: the comment-stripper preserves the real tailscale invocations (positive control — the mutation greps below have input)" \
    || bad "GSL-107: the comment-stripper ate the tailscale invocations — the no-mutation checks would pass over an empty file"
  bg_mutation_hits() { grep -nE '(tailscale[[:space:]]+(up|login|logout)|brew[[:space:]]+install|systemsetup|kill-pane|launchctl[[:space:]]+(load|bootstrap))' <<<"$1" || true; }
  # Positive control for the detector itself: shown a script that really does bring up the VPN,
  # it must fire. Without this, a typo in the pattern would read as "preflight is clean forever".
  [[ -n "$(bg_mutation_hits 'tailscale up --ssh')" ]] \
    && ok "GSL-107: the mutation detector fires on a real \`tailscale up\` (positive control — the check below is not vacuous)" \
    || bad "GSL-107: the mutation detector CANNOT see a VPN being brought up — the no-mutation check below guards nothing"
  BG_MUTATIONS="$(bg_mutation_hits "$BG_EXEC")"
  [[ -z "$BG_MUTATIONS" ]] \
    && ok "GSL-107 ⭐ preflight only inspects: it never brings up a VPN, opens sshd, or touches a pane" \
    || bad "GSL-107 ⭐ preflight mutates the machine ($BG_MUTATIONS) — a report step that changes what it reports on"
  grep -qE 'claude( -p|\b--print)' <<<"$BG_EXEC" \
    && bad "GSL-107 ⭐ preflight calls a headless model (C1 violation) — a verifier must not cost tokens" \
    || ok "GSL-107 ⭐ 0-LLM (C1): preflight shells out to no model"
fi

# ---- the runbook's load-bearing warnings -------------------------------------------
# These guard PROPERTIES a future edit could quietly drop, not phrasing. Each one exists because
# losing it costs the owner something specific at 4am.
if [[ ! -s "$BGR" ]]; then
  bad "GSL-107: docs/runbooks/break-glass.md missing — the preflight points at a runbook that is not there"
else
  BG_SECTIONS="$(grep -c '^## ' "$BGR")"
  [[ "$BG_SECTIONS" -ge 8 ]] \
    && ok "GSL-107: the runbook is complete ($BG_SECTIONS sections — positive control for the content checks below)" \
    || bad "GSL-107: the runbook has only $BG_SECTIONS sections — the checks below would pass over a stub"

  # ⭐ The kill-pane invariant. A runbook that teaches pane-killing from a phone and omits this
  # is the 2026-07-07 incident with better ergonomics.
  grep -qE 'kill-pane -a' "$BGR" && grep -qiE 'НИКОГДА|⛔' "$BGR" \
    && ok "GSL-107 ⭐ the runbook names \`kill-pane -a\` and forbids it outright" \
    || bad "GSL-107 ⭐ the runbook teaches killing panes from a phone without forbidding \`kill-pane -a\` — the 2026-07-07 fleet kill, re-armed"

  # ⭐ ...and the REASON, which is what makes the rule survive a rewrite: positional pane addresses
  # renumber when a neighbour dies, so an id read minutes ago on a phone can name a different pane.
  grep -qE '%[0-9]+' "$BGR" && grep -qiE 'перенумеров|сменил позиционный' "$BGR" \
    && ok "GSL-107 ⭐ the runbook explains WHY only %id is safe — positional addresses renumber under a phone-lag delay" \
    || bad "GSL-107 ⭐ the %id rule is stated without its mechanism — a future edit will 'simplify' it back to positional targets"

  # ⭐ The phone-attach flags. Without ignore-size a bedtime attach resizes the desktop panes for
  # everyone (window-size is 'latest' on this machine), and the owner meets a mangled fleet at dawn.
  # The property is per-COMMAND, not per-document: prose may say "tmux attach" freely, but every
  # concrete `tmux attach -t …` the owner could copy at 4am must carry the flag. A weaker grep for
  # the bare word passed while a mutant stripped the flag from all three commands and left the
  # explanatory table intact — which is exactly the edit a future rewrite would make.
  BG_ATTACH_CMDS="$(grep -c 'tmux attach -t' "$BGR")"
  BG_ATTACH_BARE="$(grep 'tmux attach -t' "$BGR" | grep -vc 'ignore-size')"
  [[ "$BG_ATTACH_CMDS" -ge 2 ]] \
    && ok "GSL-107: the runbook really does spell out attach commands ($BG_ATTACH_CMDS — positive control for the check below)" \
    || bad "GSL-107: no concrete attach command in the runbook — the ignore-size check below has nothing to guard"
  [[ "$BG_ATTACH_BARE" -eq 0 ]] \
    && ok "GSL-107 ⭐ every copyable attach command carries -f ignore-size — a 4am attach cannot reshape the desktop fleet" \
    || bad "GSL-107 ⭐ $BG_ATTACH_BARE attach command(s) omit ignore-size — a phone-sized client resizes every pane the fleet has"

  # ⭐ The honesty gate. Tailscale is not installed here, so F6-S4 is NOT closed. This check exists
  # because the cheapest possible edit — flipping one table cell to ✅ — would silently convert an
  # unproven plan into a claimed capability, and nothing else in the repo would notice.
  grep -qE 'НЕ ЗАКРЫТО' "$BGR" \
    && ok "GSL-107 ⭐ the runbook still states F6-S4 is NOT closed — a written path is not a proven one" \
    || bad "GSL-107 ⭐ F6-S4 is no longer marked open: the runbook claims a capability nobody has exercised from a phone"
fi

echo "== GSL-110 / phase acceptance: a verdict table is only worth the runs behind it =="
# The Phase 6 acceptance closed ZERO of four success criteria. That is an uncomfortable document,
# and uncomfortable documents get smoothed — not by a rewrite, but by the cheapest edit there is:
# one table cell flipped from ❌ to ✅ while someone assembles the PR. Nothing else in this repo
# would notice. These checks are the thing that notices. Each guards a distinct way the acceptance
# could start claiming more than was proven.
ACC="$REPO_ROOT/docs/dev_history/GSL-110-phase6-cycle69-acceptance.md"
if [[ ! -f "$ACC" ]]; then
  bad "GSL-110: the Phase 6 acceptance file is missing — the phase has no recorded verdicts"
else
  # Positive control: the criterion rows must actually exist, or every check below passes vacuously
  # over a document that simply never mentioned F6-S at all.
  ACC_ROWS="$(grep -c '^| \*\*F6-S' "$ACC")"
  [[ "$ACC_ROWS" -ge 8 ]] \
    && ok "GSL-110: the acceptance really does carry per-criterion rows ($ACC_ROWS — positive control for the checks below)" \
    || bad "GSL-110: only $ACC_ROWS F6-S rows in the acceptance — the verdict checks below would guard nothing"

  # ⭐ F6-S2 / F6-S3 were never built: no answer-path, no ntfy hook. The verdict word must survive
  # on EVERY row that states them, not merely appear somewhere in the file.
  for crit in S2 S3; do
    n_bad="$(grep "^| \*\*F6-$crit\*\*" "$ACC" | grep -vc 'НЕ ДОСТАВЛЕН')"
    [[ "$n_bad" -eq 0 ]] \
      && ok "GSL-110 ⭐ F6-$crit is still recorded as НЕ ДОСТАВЛЕН — an unwritten feature cannot be an accepted one" \
      || bad "GSL-110 ⭐ $n_bad row(s) for F6-$crit no longer say НЕ ДОСТАВЛЕН: the acceptance claims a capability with no code behind it"
  done

  # ⭐ F6-S4 is UNPROVEN, not refuted and not met — Tailscale is an owner install. Marking it ✅
  # would assert a phone attach nobody has ever performed.
  n_bad="$(grep '^| \*\*F6-S4\*\*' "$ACC" | grep -vc 'НЕ ПРОВЕРЕН')"
  [[ "$n_bad" -eq 0 ]] \
    && ok "GSL-110 ⭐ F6-S4 is still marked НЕ ПРОВЕРЕН — a written runbook is not an exercised path" \
    || bad "GSL-110 ⭐ F6-S4 is no longer marked unproven: the acceptance claims an attach nobody has run from a phone"

  # ⭐ The headline count. Prose can be softened one clause at a time; a number cannot be softened
  # without being wrong. If any criterion ever genuinely closes, this line changes deliberately.
  grep -qE '0 из 4 (закрыто|закрыт)' "$ACC" \
    && ok "GSL-110 ⭐ the acceptance still states the score plainly: 0 of 4 criteria closed" \
    || bad "GSL-110 ⭐ the '0 из 4' score line is gone — the phase result can now be read as complete"

  # ⭐ ⏳ vs ❌ is the whole honesty of this table: 'blocked on the owner' and 'never implemented'
  # are different failures with different owners and different costs. Collapsing them into one
  # symbol would flatter S2/S3 and slander S4 in the same stroke.
  grep -qE 'разные вещи' "$ACC" && grep -q 'не реализован' "$ACC" \
    && ok "GSL-110 ⭐ the acceptance still distinguishes 'not verified' from 'not implemented' in words" \
    || bad "GSL-110 ⭐ the ⏳/❌ distinction is gone — unbuilt features and unrun tests now read identically"

  # ⭐ Three of four verdicts rest on ABSENCE (no ntfy, no curl, no answered_by). Absence is the
  # weakest evidence there is — a typo in a pattern produces the same empty output. The positive
  # controls are what make those zeroes mean something; without them the table is unfalsifiable.
  grep -q 'Позитивные контроли' "$ACC" && grep -q 'True' "$ACC" && grep -q 'False' "$ACC" \
    && ok "GSL-110 ⭐ the positive controls are recorded — the empty greps are proven to be able to find things" \
    || bad "GSL-110 ⭐ the positive-control table is gone: the acceptance's zeroes could now be a broken detector"

  # ⭐ The non-obvious structural finding: GSL-105 carries F6-S3 outright AND the load-bearing half
  # of F6-S1, because a fleet-level BLOCKER has no per-session push to ride on. Lose this and the
  # remaining work reads as four equal tasks instead of one binding constraint.
  grep -qE 'связывающ' "$ACC" && grep -qE 'два критерия' "$ACC" \
    && ok "GSL-110 ⭐ GSL-105 is still named as the binding constraint holding two of four criteria" \
    || bad "GSL-110 ⭐ the S1↔R6.2 dependency is gone — GSL-105 now looks like one task among several"

  # ⭐ Every landed task of the phase must own a dev_history file. This is the check that found the
  # GSL-103 hole in the first place: five cycles each wrote their own file and none counted the set.
  ACC_HIST="$(ls -1 "$REPO_ROOT/docs/dev_history/" | grep -c '^GSL-1[0-9][0-9]-phase6-')"
  [[ "$ACC_HIST" -ge 6 ]] \
    && ok "GSL-110 ⭐ every landed Phase 6 task owns a dev_history file ($ACC_HIST) — the GSL-103 hole stays closed" \
    || bad "GSL-110 ⭐ only $ACC_HIST Phase 6 dev_history files: a landed task has lost its history again (GSL-103 class)"
fi

# ════════ GSL-135 / T3: the two MAJOR findings the Tasks/Timeline/Questions reface closes ════════
# Both are invisible to every mechanism test above, and invisible in the same way T1's and T2's were:
# the data is right and the view files it wrong. One is a wrapper two tables never got; the other is
# a fourth bucket the questions taxonomy never had. Each ships with a control that must stay green.

# ── GSL-114: the two summary tables at the foot of the feed must scroll like every other table.
# They shipped bare in a card that let their content spill past its edge — the only two of the
# thirteen tables without the scroll wrapper the rest have — so at 390px the count column ran off the
# card with nothing to scroll it and the numbers were unreachable on a phone, while the names beside
# them looked complete. The fix is structural: the same wrapper the feed table already has, and the
# count moved to the right-aligned tabular column section 6.4 specifies. Asserting the WRAPPER (smoke
# cannot measure a pixel) is the contract-level proof; the live 390px scrollWidth is measured with
# the browser in the task's screenshot pass.
T3T="$WORK/t3-timeline"; rm -rf "$T3T"; mkdir -p "$T3T/docs/lab/events" "$T3T/docs/lab/questions"
T3TS="$(python3 -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%SZ'))")"
{ printf '{"ts":"%s","run_id":"x","seq":1,"actor":"w1","type":"vcs.commit","src":"hook:PostToolUse","data":{"sha":"aa11bb2"}}\n' "$T3TS"
  printf '{"ts":"%s","run_id":"x","seq":2,"actor":"w1","type":"agent.turn_ended","src":"emit","data":{}}\n' "$T3TS"
} > "$T3T/docs/lab/events/$TODAY.jsonl"
: > "$T3T/docs/lab/questions/queue.jsonl"
bash "$CH" --repo "$T3T" --no-poll --quiet --json >/dev/null 2>&1
G114="$(python3 - "$T3T/docs/lab/site/timeline.html" <<'PY'
import re, sys
h = open(sys.argv[1], encoding="utf-8").read()
def wrapper_of(header):
    m = re.search(r'<div class="([a-z]+)"><table><tr><th>' + header + r'</th>', h)
    return m.group(1) if m else "MISSING"
def numcol(header):
    return "yes" if re.search(r'<th>' + header + r'</th><th class="num">n</th>', h) else "no"
feed = "yes" if '<div class="wrap"><table id="timeline-rows">' in h else "no"
print("TYPE_WRAP=%s|PROV_WRAP=%s|TYPE_NUM=%s|PROV_NUM=%s|FEED_WRAP=%s" % (
    wrapper_of("type"), wrapper_of("provenance"), numcol("type"), numcol("provenance"), feed))
PY
)"
grep -q 'TYPE_WRAP=wrap|PROV_WRAP=wrap' <<<"$G114" \
  && ok "GSL-114 ⭐ both summary tables sit in a scroll wrapper, not a card that clips their count at 390px" \
  || bad "GSL-114 ⭐ a summary table is still bare in a card — its count column is unreachable on a phone ($G114)"
grep -q 'TYPE_NUM=yes|PROV_NUM=yes' <<<"$G114" \
  && ok "GSL-114: the count column is right-aligned and tabular (section 6.4), not the left mono it had" \
  || bad "GSL-114: the count column did not take the numeric column ($G114)"
grep -q 'FEED_WRAP=yes' <<<"$G114" \
  && ok "GSL-114 control: the feed table's wrapper is detected — a green control proving the probe can see one" \
  || bad "GSL-114 control: the feed-table wrapper probe failed, so the check above proves nothing ($G114)"

# ── GSL-128: a question the OWNER answered is not "decided without you". The three-bucket taxonomy
# filed every closed question under "Decided without you" regardless of answered_by, so an owner's own
# answer (answered_by=owner, the exact patch F6-S2 writes) sat under a heading that contradicted the
# `by` column one cell over. The fix splits closed by authorship into a fourth section. Fixture: one
# question the owner answered, one the night auto-resolved — the section each lands in is the test.
T3Q="$WORK/t3-questions"; rm -rf "$T3Q"; mkdir -p "$T3Q/docs/lab/events" "$T3Q/docs/lab/questions"
printf '{"ts":"%s","run_id":"x","seq":1,"actor":"w1","type":"cycle.started","src":"emit","data":{}}\n' "$T3TS" > "$T3Q/docs/lab/events/$TODAY.jsonl"
{ printf '{"id":"q-t3-owner","ts":"%s","type":"DECISION","from":"smoke","task":"GSL-128","question":"the owner decided this one himself","default":"status quo","reversibility":"high","status":"answered","answered_by":"owner","channel":"chat","answer":"option B"}\n' "$T3TS"
  printf '{"id":"q-t3-night","ts":"%s","type":"DECISION","from":"smoke","task":"GSL-128","question":"the night decided this one","default":"status quo","reversibility":"high","status":"auto-resolved"}\n' "$T3TS"
} > "$T3Q/docs/lab/questions/queue.jsonl"
bash "$CH" --repo "$T3Q" --no-poll --quiet --json >/dev/null 2>&1
G128="$(python3 - "$T3Q/docs/lab/site/questions.html" <<'PY'
import re, sys
h = open(sys.argv[1], encoding="utf-8").read()
def section_of(qid):
    i = h.find(qid)
    if i < 0: return "ABSENT"
    heads = [m.group(1).strip() for m in re.finditer(r'<h2>([^<(]+)', h) if m.start() < i]
    return heads[-1] if heads else "NONE"
print("OWNER=%s|NIGHT=%s|HAS_BYYOU=%s" % (
    section_of("q-t3-owner"), section_of("q-t3-night"), "yes" if "Decided by you" in h else "no"))
PY
)"
grep -q 'OWNER=Decided by you' <<<"$G128" \
  && ok "GSL-128 ⭐ a question the owner answered lands in 'Decided by you' — the authorship the by column already prints" \
  || bad "GSL-128 ⭐ an owner-answered question is filed away from its author, still under decided-without-you ($G128)"
grep -q 'NIGHT=Decided without you' <<<"$G128" \
  && ok "GSL-128 control: a night-auto-resolved question stays in 'Decided without you' — the bucket that is now honest" \
  || bad "GSL-128 control: the without-you bucket lost the question that truly belongs to it ($G128)"

echo
echo "== GSL-136 / T4: honest truncation in the DATA layer — Library files & titles, Cost cycles, PR de-dup =="
# One throwaway repo drives every T4 finding. Each fixture is built one PAST the old cap (40 files,
# view slice(0,40)) so a surviving cutoff shows up as a WRONG COUNT, not a value that happens to fit.
T4="$WORK/t4-lib-cost"; rm -rf "$T4"
mkdir -p "$T4/docs/lab/events" "$T4/docs/lab/questions" "$T4/docs/lab/decisions" \
         "$T4/docs/handoff" "$T4/docs/dev_history"
git init -q -b main "$T4" 2>/dev/null || { git init -q "$T4"; git -C "$T4" checkout -q -b main 2>/dev/null; }
git -C "$T4" config user.email smoke@gosleep.local; git -C "$T4" config user.name smoke
: > "$T4/docs/lab/questions/queue.jsonl"; : > "$T4/docs/lab/decisions/log.jsonl"

# 43 dev_history files: 41 ordinary + one 130-ish-char heading + one with NO heading. Past the cap.
for i in $(seq 1 41); do printf '# GSL-%d dev history entry\n' "$i" > "$T4/docs/dev_history/GSL-$i-phase1-entry.md"; done
T4_LONG="GSL-900 a deliberately overlong dev history heading written to run comfortably past one hundred and ten characters so any cut lands mid word"
printf '# %s\n' "$T4_LONG" > "$T4/docs/dev_history/GSL-900-phase1-long.md"
printf 'no leading hash on this line, so the document has no first heading to read a title from.\n' > "$T4/docs/dev_history/GSL-901-phase1-untitled.md"
# 3 handoff files: a sub-cap shelf — the positive control that count reads reality, not a constant.
printf '# Handoff A\n' > "$T4/docs/handoff/01-a.md"; printf '# Handoff B\n' > "$T4/docs/handoff/02-b.md"; printf '# Handoff C\n' > "$T4/docs/handoff/03-c.md"
git -C "$T4" add -A >/dev/null 2>&1; git -C "$T4" commit -q -m "seed t4" >/dev/null 2>&1

# 45 telemetry cycles — five past the old view slice of 40. (backticks are literal inside '...')
{ printf '## TELEMETRY\n\n'
  for i in $(seq 1 45); do printf -- '- `cycle=%d worker=w model=claude-opus-4-8 tokens_out=%d tokens_in=100 cache_read=10 | running: cycles=%d total≈%d`\n' "$i" "$((i*1000))" "$i" "$((i*1000))"; done
  printf '\n## NEXT\n'
} > "$T4/docs/handoff/ORCHESTRATION-STATE.md"

# A day file so events exist; a two-pulse heartbeat so the runway's context clock (and its gauge) render.
# The mix is 3 hook: + 1 emit + 1 poll-fill = a 60% mechanical share, so the Timeline caption has a
# share to print that is NOT a round "half" (GSL-122) — and the tracker event, learned 8 days ago,
# turns the Tasks staleness banner on so its "Last polled … ago" sentence renders (GSL-132).
T4_POLL8D="$(python3 -c 'import datetime;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=8)).strftime("%Y-%m-%dT%H:%M:%SZ"))')"
{ printf '{"ts":"%sT01:00:00Z","run_id":"x","seq":1,"actor":"w","type":"cycle.started","src":"emit","data":{}}\n' "$TODAY"
  printf '{"ts":"%sT01:00:05Z","run_id":"x","seq":2,"actor":"w","type":"agent.turn_ended","src":"hook:Stop","data":{}}\n' "$TODAY"
  printf '{"ts":"%sT01:00:10Z","run_id":"x","seq":3,"actor":"w","type":"vcs.commit","src":"hook:PostToolUse","data":{}}\n' "$TODAY"
  printf '{"ts":"%sT01:00:15Z","run_id":"x","seq":4,"actor":"w","type":"agent.idle","src":"hook:TeammateIdle","data":{}}\n' "$TODAY"
  printf '{"ts":"%sT01:00:20Z","run_id":"x","seq":5,"actor":"poll-fill","type":"tracker.issue.updated","src":"poll-fill","data":{"key":"GSL-600","status":"To Do","summary":"stale tracker probe","occurred_at":"%s"}}\n' "$TODAY" "$T4_POLL8D"
} > "$T4/docs/lab/events/$TODAY.jsonl"
T4_H0="$(python3 -c 'import datetime;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ"))')"
T4_H1="$(python3 -c 'import datetime;print(datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))')"
{ printf '{"ts":"%s","cycle":10,"context_pct":50,"open_workers":1,"status":"ok","pane":"%%1","note":""}\n' "$T4_H0"
  printf '{"ts":"%s","cycle":12,"context_pct":60,"open_workers":1,"status":"ok","pane":"%%1","note":""}\n' "$T4_H1"
} > "$T4/docs/handoff/.orchestrator-heartbeat"

# A PR keyed in BOTH title and branch — the shape that used to double the row's pr column.
printf '{"prs":[{"number":555,"title":"GSL-500 the epic","state":"OPEN","url":"https://github.com/org/repo/pull/555","headRefName":"GSL-500-slug"}],"issues":[]}\n' > "$T4/gh.json"

GOSLEEP_GH_JSON="$T4/gh.json" bash "$CH" --repo "$T4" --no-poll --quiet --json >/dev/null 2>&1
T4B="$T4/docs/lab/render_bundle.json"; T4L="$T4/docs/lab/site/library.html"; T4C="$T4/docs/lab/site/cost.html"; T4I="$T4/docs/lab/site/index.html"

# GSL-127: the files column is a COUNT. A count of 40 for a 43-file shelf is a cutoff wearing a
# measurement's clothes, and it also means 3 artifacts never reached the searchable cross-index.
T4_DHC="$(jq -r '.library.sections[] | select(.key=="dev_history") | .count' "$T4B" 2>/dev/null)"
[[ "$T4_DHC" == "43" ]] \
  && ok "GSL-127 ⭐ the dev_history files count is what was FOUND (43), not the old 40-item cutoff" \
  || bad "GSL-127 ⭐ the files column still reports a cap, not the count (got $T4_DHC, want 43)"
T4_DHROWS="$(grep -oE 'href="[^"]*dev_history/GSL-[^"]*"' "$T4L" | wc -l | tr -d ' ')"
[[ "$T4_DHROWS" == "43" ]] \
  && ok "GSL-127 ⭐ all 43 dev_history artifacts reach the searchable cross-index — none silently dropped past 40" \
  || bad "GSL-127 ⭐ the cross-index is missing dev_history rows past the cap (got $T4_DHROWS, want 43)"
T4_HFC="$(jq -r '.library.sections[] | select(.key=="handoffs") | .count' "$T4B" 2>/dev/null)"
T4_HFREAL="$(ls "$T4/docs/handoff/"*.md 2>/dev/null | wc -l | tr -d ' ')"
[[ -n "$T4_HFC" && "$T4_HFC" == "$T4_HFREAL" && "$T4_HFC" -lt 40 ]] \
  && ok "GSL-127 control: a sub-cap shelf (handoffs, $T4_HFC files) reports exactly what is on disk — the metric reads reality, not a constant" \
  || bad "GSL-127 control: the handoffs count ($T4_HFC) does not match the $T4_HFREAL files on disk"

# GSL-131: the full heading survives into the bundle. The old cut happened in the data, so the tail
# was gone from render_bundle.json and the page — unreachable by selection or search.
T4_LTLEN="$(python3 - "$T4B" <<'PY'
import json,sys
b=json.load(open(sys.argv[1]))
ts=[it["title"] for s in b["library"]["sections"] for it in s["items"] if it["name"]=="GSL-900-phase1-long.md"]
print(len(ts[0]) if ts else -1)
PY
)"
[[ "$T4_LTLEN" -gt 110 ]] \
  && ok "GSL-131 ⭐ a $T4_LTLEN-char heading is stored whole in the bundle — no 110-char mid-word cut in the data" \
  || bad "GSL-131 ⭐ the heading was truncated at the data layer (len $T4_LTLEN, cut at the old 110)"
# GSL-9 (not GSL-1) on purpose: the control target must survive the OLD 40-item cap so it is green
# against 125f29c too. Descending glob sort keeps GSL-901, GSL-900, GSL-9, ... — GSL-1 sorts LAST and
# the old cap dropped it, which would red this control on the very bug the ⭐ above already covers.
T4_STLEN="$(python3 - "$T4B" <<'PY'
import json,sys
b=json.load(open(sys.argv[1]))
ts=[it["title"] for s in b["library"]["sections"] for it in s["items"] if it["name"]=="GSL-9-phase1-entry.md"]
print(len(ts[0]) if ts else -1)
PY
)"
[[ "$T4_STLEN" -gt 0 && "$T4_STLEN" -lt 110 ]] \
  && ok "GSL-131 control: a short heading is stored whole and unchanged ($T4_STLEN chars) — removing the cut lengthened nothing" \
  || bad "GSL-131 control: the short heading is wrong (len $T4_STLEN)"

# GSL-123: a document with no first heading has no title, and that absence renders as unknown-with-a-
# reason, not as a blank cell that reads like a render fault.
T4_EMPTY="$(python3 - "$T4B" <<'PY'
import json,sys
b=json.load(open(sys.argv[1]))
ts=[it["title"] for s in b["library"]["sections"] for it in s["items"] if it["name"]=="GSL-901-phase1-untitled.md"]
print("EMPTY" if (ts and ts[0]=="") else "NOT")
PY
)"
T4_EMPTYCOUNT="$(python3 - "$T4B" <<'PY'
import json,sys
b=json.load(open(sys.argv[1]))
print(sum(1 for s in b["library"]["sections"] for it in s["items"] if it["title"]==""))
PY
)"
T4_UNK="$(python3 - "$T4L" <<'PY'
import re,sys
h=open(sys.argv[1]).read()
m=re.search(r'<table id="library-rows">(.*?)</table>', h, re.S)
print((m.group(1).count('class="unknown"')) if m else -1)
PY
)"
[[ "$T4_EMPTY" == "EMPTY" && "$T4_UNK" == "$T4_EMPTYCOUNT" && "$T4_UNK" -ge 1 ]] \
  && ok "GSL-123 ⭐ every titleless document (all $T4_UNK, and only those) renders an unknown marker, not a blank cell" \
  || bad "GSL-123 ⭐ a titleless row is blank or the marker leaked (untitled-in-data=$T4_EMPTYCOUNT, markers=$T4_UNK)"
grep -q 'dev history entry' "$T4L" \
  && ok "GSL-123 control: filled titles still render their heading text — the marker did not replace real titles" \
  || bad "GSL-123 control: a filled title vanished from the page"

# GSL-123 (the BUILT artifact, not the fixture): the reworded fallback lived in the source while the
# committed library.html stayed as built two commits earlier — the fix existed everywhere except the
# one file a reader opens, and run 01 found exactly that. So the committed page itself is held to the
# rule: a cross-index row carries a real title or the unknown marker, never a blank cell. Any page
# built by any post-fix chronicler satisfies this; only a stale pre-fix build can fail it.
LIVE_LIB="$REPO_ROOT/docs/lab/site/library.html"
python3 - "$LIVE_LIB" <<'PY'
import re,sys
h=open(sys.argv[1]).read()
rows=re.findall(r'<tr data-row="\d+">(.*?)</tr>', h, re.S)
blank=0
for b in rows:
    tds=re.findall(r'<td[^>]*>(.*?)</td>', b, re.S)
    if len(tds)>=3 and not re.sub(r'<[^>]+>','',tds[2]).strip(): blank+=1
sys.exit(1 if (blank or len(rows) < 50) else 0)
PY
[[ $? -eq 0 ]] \
  && ok "GSL-123 ⭐ (built artifact) every cross-index row in docs/lab/site/library.html carries a title or the unknown marker — no blank cell shipped" \
  || bad "GSL-123 ⭐ (built artifact) the committed library.html ships a blank title cell (or the table went missing) — the built page lags its own source"

# GSL-120: the heading counts cycles-with-a-row; the table must show that many. The old slice(0,40)
# left the heading at 45 and the table at 40, hiding five cycles with nothing on the page naming them.
T4_CYC="$(jq -r '.cost.cycles | length' "$T4B" 2>/dev/null)"
T4_HEAD="$(grep -oE 'Per cycle[^<]*[0-9]+ with a telemetry row' "$T4C" | grep -oE '[0-9]+' | head -1)"
T4_CROWS="$(python3 - "$T4C" <<'PY'
import re,sys
h=open(sys.argv[1]).read()
m=re.search(r'Per cycle.*?(<table>.*?</table>)', h, re.S)
print((len(re.findall(r'<tr', m.group(1)))-1) if m else -1)
PY
)"
[[ "$T4_CROWS" == "$T4_CYC" && "$T4_CYC" == "45" ]] \
  && ok "GSL-120 ⭐ every cycle with a telemetry row is on the page (45 rows == 45 in data) — the slice is gone" \
  || bad "GSL-120 ⭐ the per-cycle table hides rows (rows=$T4_CROWS, data=$T4_CYC)"
[[ -n "$T4_HEAD" && "$T4_HEAD" == "$T4_CYC" ]] \
  && ok "GSL-120 control: the heading counts the same cycles the data holds ($T4_HEAD == $T4_CYC) — heading and table now agree" \
  || bad "GSL-120 control: the heading number ($T4_HEAD) does not match the data ($T4_CYC)"

# GSL-130 (root): the same PR reached the row twice because its key sat in both title and branch and
# KEY_RE.findall returned it twice. dict.fromkeys keeps each distinct key once.
T4_PRN="$(jq -r '[.tasks.rows[] | select(.key=="GSL-500") | .prs[]] | length' "$T4B" 2>/dev/null)"
[[ "$T4_PRN" == "1" ]] \
  && ok "GSL-130 ⭐ (root) a PR keyed in title AND branch lands on the row once, not twice — no #NN#NN in the data" \
  || bad "GSL-130 ⭐ (root) the row's pr column still carries the same PR twice (got $T4_PRN)"
T4_PRNUM="$(jq -r '[.tasks.rows[] | select(.key=="GSL-500") | .prs[].number] | join(",")' "$T4B" 2>/dev/null)"
grep -q '555' <<<"$T4_PRNUM" \
  && ok "GSL-130 control: the PR still reaches its row (#555 present) — de-dup removed the copy, not the link" \
  || bad "GSL-130 control: the PR fell off the row entirely (got '$T4_PRNUM')"

# GSL-132 (Cost): the ceiling and quota notes each printed a lead sentence the data string then
# repeated. The data now carries only the reason the lead does not.
grep -q 'no token ceiling exists on disk' "$T4C" \
  && bad "GSL-132 ⭐ (Cost) the ceiling note still repeats its lead sentence" \
  || ok "GSL-132 ⭐ (Cost) the ceiling note states its reason once — the echoed lead is gone"
# (GSL-221 retired the "no token ceiling on disk" lead along with the state it described; the
# control now checks the NEW lead states its fact once — the per-night ceiling card.)
grep -q 'tokens per night' "$T4C" \
  && ok "GSL-132 control: the ceiling card states its per-night fact once (GSL-221 lead)" \
  || bad "GSL-132 control: the ceiling lead itself went missing"
grep -q 'not one quota event has EVER been logged here' "$T4C" \
  && bad "GSL-132 ⭐ (Cost) the quota note still repeats its lead sentence" \
  || ok "GSL-132 ⭐ (Cost) the quota note no longer echoes its lead"
grep -q 'No quota event has ever been logged' "$T4C" \
  && ok "GSL-132 control: the on-screen quota lead is untouched" \
  || bad "GSL-132 control: the quota lead itself went missing"

# GSL-118: two percentages side by side as 'N% of M%' read as a product; the gauge now spells the
# relation. The ⭐ DEMANDS the reworded gauge rather than merely banning the old one, because run 01
# could not confirm the fix on live data (context=unknown renders no gauge at all) — this fixture
# drives a real two-pulse heartbeat, so here the wording is required, not just permitted.
if grep -qE '[0-9]+% of [0-9]+%' "$T4I"; then
  bad "GSL-118 ⭐ the context gauge still reads 'N% of M%' — the product misreading is back"
elif grep -q '60% (rolls at 80%)' "$T4I"; then
  ok "GSL-118 ⭐ the gauge spells the relation — '60% (rolls at 80%)': a level and its ceiling, not a product"
else
  bad "GSL-118 ⭐ the gauge neither misreads as 'N% of M%' nor spells '60% (rolls at 80%)' — it went missing"
fi
grep -q '60%' "$T4I" \
  && ok "GSL-118 control: the context gauge is present with its 60% level — so the ⭐ tests a real gauge, not an absent one" \
  || bad "GSL-118 control: the context gauge did not render (no 60%) — the ⭐ above proves nothing"

# GSL-122: the provenance caption called the hook-sourced share "that half of the log" when the real
# figure was 92.8% — a word with a numeric value, wrong by nearly 2x, printed under the very table
# that lets the reader check it. The caption now prints the share COMPUTED from the same bundle field
# the Overview KPI reads (mechanical_share; 3 of these 5 fixture events are hook: -> 60%).
T4T="$T4/docs/lab/site/timeline.html"
if grep -q 'that half of the log' "$T4T"; then
  bad "GSL-122 ⭐ the provenance caption still calls the hook share 'that half of the log'"
elif grep -q 'that 60% of the log' "$T4T"; then
  ok "GSL-122 ⭐ the caption prints the computed hook share (60% here), not the word 'half'"
else
  bad "GSL-122 ⭐ the caption neither says 'half' nor prints the computed 60% share — the sentence went missing or the share is wrong"
fi
grep -q "cost 0 tokens and needed no model" "$T4T" \
  && ok "GSL-122 control: the rest of the caption survived — only the share wording changed" \
  || bad "GSL-122 control: the caption's tail sentence vanished from the page"

# GSL-132 (Tasks): the staleness banner read "Last polled 7d 20h old (…)" — the age formatter's
# default suffix dropped into a slot that follows a verb, where English wants "ago" (the mobile
# projection already wrote "ago" for the same fact). The fixture's tracker poll is 8 days old, so
# the banner is ON and the sentence is on the page to be read.
T4TASKS="$T4/docs/lab/site/tasks.html"
T4_POLLSENT="$(python3 - "$T4TASKS" <<'PY'
import re,sys
h=open(sys.argv[1]).read()
m=re.search(r'Last polled.{0,300}?\)\.', h, re.S)
print(re.sub(r'\s+'," ",re.sub(r'<[^>]+>','',m.group(0))) if m else "NO-SENTENCE")
PY
)"
case "$T4_POLLSENT" in
  *" old ("*) bad "GSL-132 ⭐ (Tasks) the staleness banner still says 'Last polled … old' ($T4_POLLSENT)";;
  *" ago ("*) ok  "GSL-132 ⭐ (Tasks) the banner says 'Last polled … ago' — the verb slot got its adverb";;
  *)          bad "GSL-132 ⭐ (Tasks) the 'Last polled' sentence did not render (got: $T4_POLLSENT)";;
esac
grep -q '8d 0h' <<<"$T4_POLLSENT" \
  && ok "GSL-132 control: the banner carries the fixture's real 8-day age — a live Age element, not pasted prose" \
  || bad "GSL-132 control: the 8d age went missing from the banner ($T4_POLLSENT)"
grep -q 'data-age-suffix="ago"' "$T4TASKS" \
  && ok "GSL-132 control: the grammar rides the element (data-age-suffix) — the ticker cannot repaint 'ago' back into 'old'" \
  || bad "GSL-132 control: no data-age-suffix on the page — the first client repaint will undo the wording"

# GSL-132 (Overview, the two-ages block): "its freshest event was 7s old" beside a generated_at that
# says 10s. The ages were measured against NOW (process start) while the stamp was minted at
# assembly, seconds later — so the one block that teaches the reader to ADD two ages printed numbers
# that do not sum. The fake gh below sleeps between the two clock readings the old code used, forcing
# the drift; the fixed chronicler reads the clock once, so the identity holds no matter how slow the
# collectors are.
FRD="$WORK/fresh-drift"; rm -rf "$FRD"; mkdir -p "$FRD/docs/lab/events" "$FRD/docs/lab/questions"
: > "$FRD/docs/lab/questions/queue.jsonl"
FRD_TS="$(python3 -c 'import datetime;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(seconds=40)).strftime("%Y-%m-%dT%H:%M:%SZ"))')"
printf '{"ts":"%s","run_id":"x","seq":1,"actor":"w","type":"cycle.started","src":"emit","data":{}}\n' "$FRD_TS" > "$FRD/docs/lab/events/$TODAY.jsonl"
FRD_BIN="$WORK/fakebin"; mkdir -p "$FRD_BIN"
printf '#!/usr/bin/env bash\nsleep 2\nexit 1\n' > "$FRD_BIN/gh"; chmod +x "$FRD_BIN/gh"
PATH="$FRD_BIN:$PATH" bash "$CH" --repo "$FRD" --no-poll --quiet >/dev/null 2>&1
python3 - "$FRD/docs/lab/status.json" <<'PY'
import json,sys,datetime
s=json.load(open(sys.argv[1])); st=s["staleness"]
p=lambda t: datetime.datetime.strptime(t,"%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc).timestamp()
sys.exit(0 if st["max_event_age_s"] == int(p(s["generated_at"]) - p(st["latest_event_ts"])) else 1)
PY
[[ $? -eq 0 ]] \
  && ok "GSL-132 ⭐ (two ages) max_event_age_s == generated_at − latest_event_ts even with slow collectors — one clock reading for the stamp and the age" \
  || bad "GSL-132 ⭐ (two ages) the printed age and the stamp disagree about the same instant — the reader's sum will not check out"
python3 - "$FRD/docs/lab/status.json" <<'PY'
import json,sys
st=json.load(open(sys.argv[1]))["staleness"]
sys.exit(0 if (st["grade"]=="fresh" and isinstance(st["max_event_age_s"],int) and st["max_event_age_s"]>=40) else 1)
PY
[[ $? -eq 0 ]] \
  && ok "GSL-132 control: the drift fixture still grades (fresh, age ≥ 40s) — the ⭐ compared two real numbers" \
  || bad "GSL-132 control: the drift fixture produced no usable age — the ⭐ above proves nothing"

# ────────── GSL-146 (fix wave 2): the absence marker is a VALUE, never a caption ──────────
# The Unknown span sits where a value sits — inside `.kpi b`, beside a `.wk-f` label — and the
# generic label selectors (`.kpi span`, `.wk-f span`, specificity 0,1,1) also matched span.unknown,
# out-specifying `.unknown` (0,1,0). The cascade then painted the one value the spec singles out
# (section 8.3: "значение unknown красится --unk") as an 11px muted uppercase caption, on every
# unknown KPI tile and worker field of Fleet and Cost, in both themes. The label rules must EXCLUDE
# the marker. These greps read the stylesheet of a BUILT page — the same bytes the browser reads.
FW2H="$CR/docs/lab/site/fleet.html"
grep -q '\.kpi span:not(\.unknown)' "$FW2H" \
  && ok "GSL-146: the KPI label selector excludes span.unknown — the value is not a caption" \
  || bad "GSL-146: .kpi span swallows span.unknown — an unknown KPI renders as two captions"
# GSL-207 retired the worker CARD and with it the `.wk-f` field grid, so the selector this half
# guarded no longer exists. The guard is not deleted — it is made conditional, because the defect is
# a property of ANY generic descendant-span label rule, and the day someone reintroduces one on this
# screen it must still be caught. Silently dropping the assertion would trade a real check for a
# green count, which is the failure mode this file exists to refuse.
if grep -q '\.wk-f span' "$FW2H"; then
  grep -q '\.wk-f span:not(\.unknown)' "$FW2H" \
    && ok "GSL-146: the worker-field label selector excludes span.unknown" \
    || bad "GSL-146: .wk-f span swallows span.unknown — the absence marker loses --unk"
else
  grep -q '\.wk-f' "$FW2H" \
    && bad "GSL-146: a .wk-f rule is back on Fleet without the :not(.unknown) label guard" \
    || ok "GSL-146: the worker-field grid retired with the card (GSL-207) — no generic label selector is left on Fleet to swallow span.unknown"
fi
grep -q 'class="unknown"' "$FW2H" \
  && ok "GSL-146 control: the fixture Fleet page really renders span.unknown (the greps above bite)" \
  || bad "GSL-146 control: no span.unknown on the fixture Fleet page — the checks above are vacuous"

# ────────── GSL-147 (fix wave 2): the status column carries the judgement channel ──────────
# Spec section 7.2 lists three Jira statuses among the COLOURED values: Done -> ok, To Do -> warn,
# In Progress -> info. The board rendered every status as a bare neutral chip, so the one column the
# owner reads to decide whether he can sleep was indistinguishable from metadata like MERGED. The
# tone rides a scoped "tag st <tone>" class; a status the spec table does not list stays neutral.
STW2="$WORK/fw2-status-tones"; mkdir -p "$STW2/docs/lab/events"
{ printf '{"ts":"%sT20:00:01Z","run_id":"x","seq":1,"actor":"poll-fill","type":"tracker.issue.updated","src":"poll-fill","data":{"key":"GSL-901","status":"Done","summary":"tone probe done","occurred_at":"%sT20:00:00Z"}}\n' "$TODAY" "$TODAY"
  printf '{"ts":"%sT20:00:02Z","run_id":"x","seq":2,"actor":"poll-fill","type":"tracker.issue.updated","src":"poll-fill","data":{"key":"GSL-902","status":"To Do","summary":"tone probe todo","occurred_at":"%sT20:00:00Z"}}\n' "$TODAY" "$TODAY"
  printf '{"ts":"%sT20:00:03Z","run_id":"x","seq":3,"actor":"poll-fill","type":"tracker.issue.updated","src":"poll-fill","data":{"key":"GSL-903","status":"In Progress","summary":"tone probe wip","occurred_at":"%sT20:00:00Z"}}\n' "$TODAY" "$TODAY"
  printf '{"ts":"%sT20:00:04Z","run_id":"x","seq":4,"actor":"poll-fill","type":"tracker.issue.updated","src":"poll-fill","data":{"key":"GSL-904","status":"In Review","summary":"tone probe neutral","occurred_at":"%sT20:00:00Z"}}\n' "$TODAY" "$TODAY"
} > "$STW2/docs/lab/events/$TODAY.jsonl"
bash "$CH" --repo "$STW2" --no-poll --quiet --json >/dev/null 2>&1
STP2="$STW2/docs/lab/site/tasks.html"
grep -q 'class="tag st ok">Done<' "$STP2" \
  && ok "GSL-147: Done wears --ok (spec 7.2: задачи)" \
  || bad "GSL-147: Done renders neutral — the judgement channel is silent"
grep -q 'class="tag st warn">To Do<' "$STP2" \
  && ok "GSL-147: To Do wears --warn" \
  || bad "GSL-147: To Do renders neutral"
grep -q 'class="tag st info">In Progress<' "$STP2" \
  && ok "GSL-147: In Progress wears --info (the lone informational badge 7.2 allows)" \
  || bad "GSL-147: In Progress renders neutral"
grep -q 'class="tag">In Review<' "$STP2" \
  && ok "GSL-147 control: a status 7.2 does not list (In Review) stays neutral — colour is earned" \
  || bad "GSL-147 control: an unlisted status was coloured, or the neutral chip form changed"
grep -q '\.tag\.info{' "$STP2" \
  && bad "GSL-147 guard: a bare .tag.info rule exists — it would repaint the timeline's sev=info column" \
  || ok "GSL-147 guard: no bare .tag.info rule — sev=info on the timeline stays neutral (7.2 caveat)"

# ────────── GSL-148 (fix wave 2): a title is quoted, not re-encoded ──────────
# doc_title() lifted the raw <title> text of an HTML report without decoding entities, so the
# bundle carried "&amp;"; the view then escaped it AGAIN and the Library printed the five
# characters "&amp;" to the reader — the dashboard misquoting the data it indexes. The bundle must
# carry the character itself; the built page then escapes it exactly once.
AMPW="$WORK/fw2-amp"; mkdir -p "$AMPW/docs/lab/events" "$AMPW/docs/reports/amp-probe"
printf '{"ts":"%sT20:10:00Z","run_id":"x","seq":1,"actor":"w1","type":"vcs.commit","src":"hook:PostToolUse","data":{"sha":"abc1234"}}\n' "$TODAY" \
  > "$AMPW/docs/lab/events/$TODAY.jsonl"
printf '<title>Amp &amp; sand — fixture</title>\n' > "$AMPW/docs/reports/amp-probe/index.html"
bash "$CH" --repo "$AMPW" --no-poll --quiet --json >/dev/null 2>&1
jq -e '.library.sections[] | select(.key=="reports") | .items[] | select(.title=="Amp & sand — fixture")' \
   "$AMPW/docs/lab/render_bundle.json" >/dev/null 2>&1 \
  && ok "GSL-148: doc_title decodes entities — the bundle carries the ampersand, not its encoding" \
  || bad "GSL-148: the bundle still carries '&amp;' — doc_title does not html.unescape"
grep -q 'Amp &amp; sand — fixture' "$AMPW/docs/lab/site/library.html" \
  && ok "GSL-148: the built Library cell escapes the decoded title exactly once" \
  || bad "GSL-148: the once-escaped title form is missing from the built Library page"
grep -q '&amp;amp;' "$AMPW/docs/lab/site/library.html" \
  && bad "GSL-148: double escape — the Library prints literal '&amp;' to the reader" \
  || ok "GSL-148: no double escape anywhere on the built Library page"

# ────────── GSL-149 (fix wave 2): the severity facet is worst-first, as its own comment promises ──────────
# The facet was built with generic facetValues() — appearance order — so the shipped page offered
# info, warn, incident and the owner scanning for trouble found `incident` at the BOTTOM. The FT
# fixture holds every severity at once, with the benign ones appearing first in the feed: exactly
# the ordering trap. The options must follow SEVERITIES (incident, warn, info, unknown), still
# intersected with what is actually present.
SEVOPTS="$(python3 - "$FT/docs/lab/site/timeline.html" <<'PY'
import re, sys
h = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r'<select data-facet="severity">(.*?)</select>', h, re.S)
print(",".join(re.findall(r'<option value="([^"]+)"', m.group(1))) if m else "NO_SELECT")
PY
)"
[[ "$SEVOPTS" == "incident,warn,info,unknown" ]] \
  && ok "GSL-149: severity options are worst-first (incident,warn,info,unknown) despite a benign-first feed" \
  || bad "GSL-149: severity options follow appearance order, not SEVERITIES ($SEVOPTS)"

# ────────── GSL-151 (fix wave 2): one role = one name ──────────
# The Cost "missing from these sums" cell borrowed .wk-models — a class defined for and named after
# the Fleet worker card's multi-model warning line. The amber was right; the vocabulary was wrong:
# the next editor of .wk-models could not know a second screen depended on it. The cell now wears
# its own role class (.partial-note); the worker-card class stays where its name points.
grep -q 'wk-models' "$REPO_ROOT/tools/lab/ui/src/screens/cost.tsx" \
  && bad "GSL-151: cost.tsx still borrows the worker-card class .wk-models" \
  || ok "GSL-151: cost.tsx no longer references .wk-models — the borrowed name went home"
grep -q 'class="partial-note"' "$FL/docs/lab/site/cost.html" \
  && ok "GSL-151: the partial-sums cell wears its own role class on the built Cost page" \
  || bad "GSL-151: no .partial-note cell on the fixture Cost page (its ledger has partial=1)"
grep -q 'class="wk-models"' "$FL/docs/lab/site/cost.html" \
  && bad "GSL-151: the built Cost page still MARKS UP a cell with the worker-card class" \
  || ok "GSL-151: no Cost markup wears the worker-card class (the shared stylesheet may define it)"
grep -q '\.partial-note{' "$FL/docs/lab/site/cost.html" \
  && ok "GSL-151 control: the stylesheet defines .partial-note — the cell is actually painted" \
  || bad "GSL-151 control: .partial-note has no rule — a role class nobody paints"

# ────────── GSL-152 (fix wave 2): a comment may not describe the banned pattern as current ──────────
# The RunwayStrip tone comment still said unk is "magenta and dashed". The dashed half stopped being
# true when the redesign removed every dashed border (spec section 11); a shipped comment describing
# the banned edge as behaviour is drift that points the next editor at reintroducing it.
grep -q 'magenta and dashed' "$REPO_ROOT/tools/lab/ui/src/runway.tsx" \
  && bad "GSL-152: runway.tsx still describes unk as 'magenta and dashed' — the dashes are gone" \
  || ok "GSL-152: no runway.tsx comment sells the banned dashed edge as current behaviour"
grep -Eq 'border[^;}]*dashed' "$CR/docs/lab/site/index.html" \
  && bad "GSL-152 guard: a dashed border RULE exists in the built stylesheet" \
  || ok "GSL-152 guard: the built stylesheet declares no dashed border (comments may mention the word)"

# ────────── fix wave 3: a dead-graded lab of its OWN for the meter checks ──────────
# $CR is dead-graded when first built, but the queue check above (lab-emit at :1045) appends a
# question NOW and rebuilds it — by the time this tail runs, $CR grades fresh again, and a grep
# that "checks dead" against it would be checking a fresh page. Measured, not guessed: the first
# version of the GSL-157 grep below did exactly that and failed against sh-m ok. The wave-3 meter
# checks get their own 20h-stale build and prove the grade from status.json, not from the calendar.
FW3="$WORK/fw3-dead"; rm -rf "$FW3"; mkdir -p "$FW3/docs/lab/events" "$FW3/docs/lab/questions" "$FW3/docs/lab/decisions"
: > "$FW3/docs/lab/questions/queue.jsonl"; : > "$FW3/docs/lab/decisions/log.jsonl"
FW3_TS="$(python3 -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(hours=20)).strftime('%Y-%m-%dT%H:%M:%SZ'))")"
printf '{"ts":"%s","run_id":"x","seq":1,"actor":"w1","type":"vcs.commit","src":"hook:PostToolUse","data":{"sha":"c0ffee1"}}\n' "$FW3_TS" \
  > "$FW3/docs/lab/events/$TODAY.jsonl"
bash "$CH" --repo "$FW3" --no-poll --quiet >/dev/null 2>&1

# ────────── GSL-156 (fix wave 3): the absence marker's ink belongs to the SPAN, never a container ──────────
# The class `unknown` sits on whole containers too (class="card sh-m unknown", class="clock unknown"),
# and the bare .unknown rule painted every child without a colour rule of its own — the Freshness
# heading, a READ value like "8h 17m", the card's prose — in status magenta, with cursor:help over
# the whole card. That is rule 2 of spec section 1 broken by the absence marker itself. The colour
# and cursor must be scoped to span, exactly as the underline already was; a container takes its
# state on the left edge (.sh-m.unknown), never in the ink of its prose. Greps read the stylesheet
# of a BUILT page — the same bytes the browser reads.
CRI="$FW3/docs/lab/site/index.html"
grep -q 'span\.unknown{color:var(--unk)' "$CRI" \
  && ok "GSL-156: the absence marker's colour+cursor rule is scoped to span.unknown" \
  || bad "GSL-156: no span-scoped .unknown colour rule in the built stylesheet — the marker lost its ink or the scope"
grep -q '^\.unknown{' "$CRI" \
  && bad "GSL-156: a bare .unknown rule survives — containers still hand magenta ink and cursor:help to their prose" \
  || ok "GSL-156: no bare .unknown rule — a container class cannot repaint its children"
grep -q 'class="card sh-m unknown"' "$CRI" \
  && ok "GSL-156 control: the fixture really renders a container wearing the class (the guard above bites)" \
  || bad "GSL-156 control: no container carries class unknown on the fixture Overview — the guard is vacuous"

# ────────── GSL-157 (fix wave 3): dead is a READ verdict, never the unknown state ──────────
# The Freshness ternary had no branch for dead, so grade=dead fell into "unknown" — and the meter
# answered a red DEAD banner two blocks up with the cannot-read magenta, though the reading exists
# (the age is a number, the verdict is computed). "Nothing is fresh" and "I cannot read the clock"
# are different sentences (spec section 4.3, the GSL-109 invariant); confusing them here softens
# the verdict on the screen that answers "can I go to sleep". The fw3-dead fixture is 20h stale, so
# its build IS dead-graded and the meter must wear .sh-m.dead — red edge and fill, same as the banner.
grep -q 'class="card sh-m dead" id="sh-freshness"' "$CRI" \
  && ok "GSL-157: at grade=dead the Freshness meter wears .sh-m.dead — it agrees with the banner" \
  || bad "GSL-157: the dead-graded Freshness meter does not wear .sh-m.dead"
grep -q 'class="card sh-m unknown" id="sh-freshness"' "$CRI" \
  && bad "GSL-157: Freshness still encodes grade=dead as unknown — cannot-read magenta for a verdict it HAS read" \
  || ok "GSL-157: Freshness no longer answers a read verdict with the cannot-read state"
# The witness is status.json, NOT a grep for class="stale dead": that string also sits in the
# page's verdicts JSON island, so the HTML grep is vacuously green on a fresh page.
[[ "$(jq -r .staleness.grade "$FW3/docs/lab/status.json" 2>/dev/null)" == "dead" ]] \
  && ok "GSL-157 control: the fixture build really grades itself dead (status.json is the witness)" \
  || bad "GSL-157 control: the fixture is not dead-graded — the meter greps above prove nothing"

# ────────── GSL-158 (fix wave 3): one absence, one paint — the Tasks dash is muted like its siblings ──────────
# Spec 6.5 paints the absence placeholder --muted so a hole does not read as a datum, and Cost and
# Library both ship the muted glyph for it. The Tasks gh-column dash — the same phenomenon, a key
# the READABLE mirror does not contain — wore class="dim": one absence, two colours on neighbouring
# screens. $FP is the F5-S3 board whose GSL-702 row renders exactly that dash (check 6 above is the
# proof the cell exists at all).
grep -q 'class="muted" title="no GitHub issue mirrors this key"' "$FP" \
  && ok "GSL-158: the Tasks absence dash is painted muted (spec 6.5), same as Cost and Library" \
  || bad "GSL-158: the Tasks gh-column dash is not the muted absence glyph"
grep -q 'class="dim" title="no GitHub issue mirrors this key"' "$FP" \
  && bad "GSL-158: the dash still wears dim — one absence, two paints across screens" \
  || ok "GSL-158: no dim-painted absence dash remains on the board"
grep -q '\.muted{color:var(--muted)}' "$FP" \
  && ok "GSL-158 control: the built board's stylesheet defines .muted — the glyph is actually painted" \
  || bad "GSL-158 control: .muted has no rule on the built board — a role class nobody paints"

# ────────── GSL-159 (fix wave 3): the clear-state runway badge wears the ok triple whole ──────────
# At bound=clear the badge says "nothing is going to stop the night" — a judgement, so it takes the
# one badge shape spec 7.1 allows: background, ink and border of ONE role. Without its own rule the
# generic span.ok repainted only the ink and the badge shipped half-dressed — green words on a
# neutral shell with a neutral border. The state is LATENT on committed data (bound=unknown), which
# is exactly why the rule is asserted in the built stylesheet: the first clear build must not be
# the first test of it.
grep -q '\.runway-bind\.ok{background:var(--ok-soft);color:var(--ok);border-color:var(--ok-border)}' "$CRI" \
  && ok "GSL-159: .runway-bind.ok carries the full ok triple (spec 7.1) in the built stylesheet" \
  || bad "GSL-159: no ok-triple rule for the clear-state runway badge — it will ship half-painted"
grep -q '"runway-bind ok"' "$REPO_ROOT/tools/lab/ui/src/runway.tsx" \
  && ok "GSL-159 control: runway.tsx really emits class runway-bind ok on the clear branch (the rule has a customer)" \
  || bad "GSL-159 control: no clear-branch badge markup in runway.tsx — the rule above paints nothing"

# ────────── GSL-160 (fix wave 3): one role = one name — no class is worn for its looks ──────────
# Three role borrowings, same defect class GSL-151 already ruled on. Fleet's static caption and
# Cost's cycle-gap note wore .filter-count — the LIVE filter counter whose className client.ts
# rewrites wholesale, a contract neither screen participates in (neither has a filter). The
# questions "high impact" flag wore .tag.BLOCKER — the type badge's name — so the next editor of
# either rule would silently repaint a meaning they never heard of. Each role now owns its name:
# .scope-note for the static what-is-not-on-screen caption, .tag.high-impact for the flag; the
# borrowed rules keep their own customers.
grep -q 'class="filter-count' "$REPO_ROOT/tools/lab/ui/src/screens/fleet.tsx" \
  && bad "GSL-160: fleet.tsx still borrows the live filter counter's class for a static caption" \
  || ok "GSL-160: fleet.tsx no longer marks up with .filter-count — the borrowed name went home"
grep -q 'class="filter-count' "$REPO_ROOT/tools/lab/ui/src/screens/cost.tsx" \
  && bad "GSL-160: cost.tsx still borrows .filter-count for the cycle-gap note" \
  || ok "GSL-160: cost.tsx no longer marks up with .filter-count"
grep -q 'class="scope-note" data-cycle-gap' "$REPO_ROOT/tools/lab/ui/src/screens/cost.tsx" \
  && ok "GSL-160: the Cost gap-note keeps its data-cycle-gap contract on the new role class" \
  || bad "GSL-160: the gap-note lost either its role class or its data-cycle-gap attribute"
grep -q 'class="tag BLOCKER"' "$REPO_ROOT/tools/lab/ui/src/screens/questions.tsx" \
  && bad "GSL-160: the high-impact flag still wears the BLOCKER type badge's name" \
  || ok "GSL-160: questions.tsx no longer dresses the flag in the type badge's class (comments may name it in refusals — the grep holds the MARKUP form, the GSL-152 lesson)"
grep -q 'class="tag high-impact"' "$REPO_ROOT/tools/lab/ui/src/screens/questions.tsx" \
  && ok "GSL-160: the high-impact flag wears its own role class" \
  || bad "GSL-160: no .tag.high-impact markup in questions.tsx — the flag went missing"
grep -q 'class="scope-note"' "$FL/docs/lab/site/fleet.html" \
  && ok "GSL-160: the built Fleet page marks its caption with the new role class" \
  || bad "GSL-160: no .scope-note caption on the fixture Fleet page (its workers exist, the caption must render)"
grep -q '\.scope-note{color:var(--muted)' "$CRI" \
  && ok "GSL-160 control: the stylesheet defines .scope-note — the caption is actually painted" \
  || bad "GSL-160 control: .scope-note has no rule — a role class nobody paints"
grep -q '\.tag\.high-impact{background:var(--dead-soft)' "$CRI" \
  && ok "GSL-160 control: the stylesheet defines .tag.high-impact with dead's triple by value" \
  || bad "GSL-160 control: .tag.high-impact has no rule — the flag lost its colour in the rename"
grep -q '\.filter-count{' "$CRI" \
  && ok "GSL-160 control: the live filter counter keeps its own rule — the rename took nothing from it" \
  || bad "GSL-160 control: the .filter-count rule vanished — the rename broke the live counter"

echo "== GSL-205: one identifier -> link, on every screen =="
# The defect was not "a screen forgot a link" — it was that ONE screen (Tasks, 796 links) knew how to
# resolve an identifier and the other six printed the same identifiers as dead text (Questions: 7).
# So this fixture asserts the RULE, not a screen: a key in a queue item and a key in a timeline detail
# must both come out as anchors, from the same base, and a sha must resolve to a commit.
#
# It also asserts the REFUSAL, on a twin fixture whose only difference is a remote that is not
# GitHub: with no GitHub base on disk the pages must print the identifier as text rather than invent
# an org. A link that resolves on somebody else's repository is worse than no link, which is the
# whole reason the base is produced in Python and travels in the bundle instead of being spelled in
# seven screens.
#
# Both fixtures are REAL git repositories with ONE empty commit. That is not ceremony: load_git()
# reads the remote only after `rev-parse HEAD` succeeds, so a repo with no commit degrades whole and
# the remote is never read — and a fixture that is no repository at all is worse still, because git
# walks UP out of .artifacts/ and answers with THIS repository's remote (which is exactly what the
# $CR fixture unknowingly does).
lk_repo() {  # <dir> <remote-url>
  mkdir -p "$1/docs/lab/events" "$1/docs/lab/questions" "$1/docs/lab/decisions"
  : > "$1/docs/lab/questions/queue.jsonl"; : > "$1/docs/lab/decisions/log.jsonl"
  git -C "$1" init -q >/dev/null 2>&1
  git -C "$1" remote add origin "$2" >/dev/null 2>&1
  git -C "$1" -c user.name=smoke -c user.email=smoke@local commit -q --allow-empty -m "GSL-205 fixture" >/dev/null 2>&1
  LK_TS="$(python3 -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=5)).strftime('%Y-%m-%dT%H:%M:%SZ'))")"
  { printf '{"ts":"%s","run_id":"%s","seq":1,"actor":"w1","type":"tracker.issue.updated","src":"emit","data":{"key":"GSL-205"}}\n' "$LK_TS" "$TODAY"
    printf '{"ts":"%s","run_id":"%s","seq":2,"actor":"w1","type":"vcs.commit","src":"hook:PostToolUse","data":{"sha":"dec0de5"}}\n' "$LK_TS" "$TODAY"
    # GSL-208: one path INSIDE this fixture repo (must come out repo-relative) and one outside it but
    # under $HOME (must come out as ~/…). Two rewrites, because only the first would leave every
    # sibling worktree printing the account name in full.
    printf '{"ts":"%s","run_id":"%s","seq":3,"actor":"w1","type":"dev_history.written","src":"hook:PostToolUse","data":{"path":"%s/docs/lab/README.md"}}\n' "$LK_TS" "$TODAY" "$1"
    printf '{"ts":"%s","run_id":"%s","seq":4,"actor":"w1","type":"dev_history.written","src":"hook:PostToolUse","data":{"path":"%s/elsewhere/notes.md"}}\n' "$LK_TS" "$TODAY" "$HOME"
    # …and one ROUTINE row, so the "view" facet has both of its modes to offer.
    printf '{"ts":"%s","run_id":"%s","seq":5,"actor":"w1","type":"agent.turn_ended","src":"hook:Stop","data":{}}\n' "$LK_TS" "$TODAY"
  } > "$1/docs/lab/events/$TODAY.jsonl"
  GOSLEEP_LAB_DIR="$1/docs/lab" "$LE" question --type DECISION --from smoke-links --task GSL-205 \
    --question "does the timeline linkify GSL-205 too?" --default "yes" --reversibility high >/dev/null 2>&1
  bash "$CH" --repo "$1" --no-poll --quiet --json >/dev/null 2>&1
}
LK="$WORK/gsl205-links";   lk_repo "$LK"  https://github.com/ainstance-labs/gosleep.git
LK0="$WORK/gsl205-nogh";   lk_repo "$LK0" git@gitlab.example.com:someone/else.git

LKB="$LK/docs/lab/render_bundle.json"
[[ -n "$(jq -r '.links.jira_base // empty' "$LKB")" ]] \
  && ok "GSL-205: the bundle carries a jira_base — the view never spells the tracker's host itself" \
  || bad "GSL-205: no links.jira_base in the bundle (every key on six screens goes back to dead text)"
[[ "$(jq -r '.links.gh_base' "$LKB")" == "https://github.com/ainstance-labs/gosleep" ]] \
  && ok "GSL-205: gh_base is read off the git remote, normalised (no .git suffix)" \
  || bad "GSL-205: gh_base wrong -> $(jq -r '.links.gh_base' "$LKB")"
LK_TL="$(grep -c 'data-idlink' "$LK/docs/lab/site/timeline.html" || true)"
LK_QS="$(grep -c 'data-idlink' "$LK/docs/lab/site/questions.html" || true)"
[[ "$LK_TL" -gt 0 ]] \
  && ok "GSL-205: Timeline prints $LK_TL linked identifier(s) — it printed 114 unlinked ones before" \
  || bad "GSL-205: Timeline has no data-idlink anchor (its detail column went back to dead text)"
[[ "$LK_QS" -gt 0 ]] \
  && ok "GSL-205: Questions prints $LK_QS linked identifier(s) — it had 7 links against Tasks' 796" \
  || bad "GSL-205: Questions has no data-idlink anchor (every queue item carries a key)"
grep -q 'href="https://ainstance-labs.atlassian.net/browse/GSL-205"' "$LK/docs/lab/site/questions.html" \
  && ok "GSL-205: the queue item's key resolves at the tracker, not at a plausible-looking guess" \
  || bad "GSL-205: the queue item's key is not an anchor to its Jira issue"
grep -q 'href="https://github.com/ainstance-labs/gosleep/commit/dec0de5"' "$LK/docs/lab/site/timeline.html" \
  && ok "GSL-205: a detail whose FIELD is sha becomes a commit link (never a bare 7-hex lookalike)" \
  || bad "GSL-205: the sha detail on Timeline is not linked to its commit"
# The refusal, on the twin whose remote is not GitHub: unknown base -> plain text, never a guess.
[[ "$(jq -r '.links.gh_base' "$LK0/docs/lab/render_bundle.json")" == "null" ]] \
  && ok "GSL-205 control: a non-GitHub remote -> gh_base is null, not a guessed org" \
  || bad "GSL-205 control: gh_base invented off a remote that is not github.com"
[[ -n "$(jq -r '.links.gh_base_why // empty' "$LK0/docs/lab/render_bundle.json")" ]] \
  && ok "GSL-205 control: the absent base says WHY, the way every other absence on these screens does" \
  || bad "GSL-205 control: gh_base is null with no reason attached"
grep -q 'data-idlink="dec0de5"' "$LK0/docs/lab/site/timeline.html" \
  && bad "GSL-205 control: a sha was linked with no GitHub base on disk — the link resolves nowhere" \
  || ok "GSL-205 control: with no GitHub base the sha stays text (a wrong link is worse than none)"
grep -q 'href="https://ainstance-labs.atlassian.net/browse/GSL-205"' "$LK0/docs/lab/site/questions.html" \
  && ok "GSL-205 control: the Jira half is independent — a missing GitHub base does not silence it" \
  || bad "GSL-205 control: the Jira link vanished because the GitHub base was absent"

echo "== GSL-208: normalised paths, a view mode, and honest columns =="
# The leak is not this repository — it is the ACCOUNT NAME and the machine layout, in a file that is
# committed and read on a phone. Asserted on the built page, not on the projection, because the page
# is what the owner opens.
grep -q '/Users/' "$LK/docs/lab/site/timeline.html" \
  && bad "GSL-208: timeline.html still prints an absolute home path ($(grep -o '/Users/[^"<]*' "$LK/docs/lab/site/timeline.html" | head -1))" \
  || ok "GSL-208: not one absolute /Users/ path survives into timeline.html"
grep -q '>docs/lab/README.md<' "$LK/docs/lab/site/timeline.html" \
  && ok "GSL-208: a path inside the repo is said as a repo-relative location, whole and uncut" \
  || bad "GSL-208: the in-repo path was not rewritten to a repo-relative one"
grep -q '>~/elsewhere/notes.md<' "$LK/docs/lab/site/timeline.html" \
  && ok "GSL-208: a path outside the repo keeps its shape and loses only the account name" \
  || bad "GSL-208: a path under HOME but outside the repo was not shortened to ~/"
# The mode is a FACET, which is what makes it safe: the count sentence names every row it removes.
grep -q 'data-facet="signal"' "$LK/docs/lab/site/timeline.html" \
  && ok "GSL-208: Timeline offers the meaningful/routine view mode" \
  || bad "GSL-208: no view-mode control on Timeline"
python3 - "$LK/docs/lab/render_bundle.json" "$LK/docs/lab/site/timeline.html" <<'PY'
import json, re, sys
h = open(sys.argv[2], encoding="utf-8").read()
isl = re.search(r'<script id="timeline-index" type="application/json">(.*?)</script>', h, re.S)
idx = json.loads(isl.group(1)) if isl else {"rows": [], "facets": []}
modes = {r.get("signal") for r in idx["rows"]}
facet = [f for f in idx["facets"] if f["key"] == "signal"]
# Every row must be classified, both modes must be present in this fixture, and an unclassified type
# must fall on the side that STAYS VISIBLE — the severityOf lesson, one axis over.
sys.exit(0 if modes == {"meaningful", "routine"} and facet and facet[0]["values"][0] == "meaningful" else 1)
PY
[[ $? -eq 0 ]] \
  && ok "GSL-208: every feed row carries a view mode, and meaningful is offered first" \
  || bad "GSL-208: the view-mode index is incomplete or ordered by appearance"
# The empty column. 161 of 161 cells were blank — a poll that never ran, reading as a broken renderer.
grep -q 'data-summary-column="dropped"' "$LK/docs/lab/site/tasks.html" \
  && ok "GSL-208: with no summary anywhere the column is replaced by the reason it is missing" \
  || bad "GSL-208: the always-empty summary column is still drawn with no explanation"
grep -q '<th>summary</th>' "$LK/docs/lab/site/tasks.html" \
  && bad "GSL-208: the summary column header survives on a board where no row has one" \
  || ok "GSL-208: the summary header is gone with its column, not left hanging over nothing"
grep -q 'class="key-col"' "$LK/docs/lab/site/tasks.html" \
  && ok "GSL-208: the key column asks for its own width, so a key never wraps mid-token at 1280px" \
  || bad "GSL-208: the key column lost its min-width class"
grep -q 'td\.key-col,th\.key-col{min-width:9ch' "$LK/docs/lab/site/tasks.html" \
  && ok "GSL-208 control: the stylesheet actually defines .key-col — the class has a customer" \
  || bad "GSL-208 control: .key-col is marked up but never painted"

echo "== GSL-207: the hygiene fold, and the fleet as a table =="
# Measured before this: the KPI tiles began at 2010px and "Waiting for you" at 2114px, behind ~1200px
# of self-health meters. The DETAIL folds; the VERDICT does not — three chips carry all three meter
# states in the summary line whether the fold is open or shut. Nothing is hidden except evidence.
grep -q '<details class="sh-fold"' "$LK/docs/lab/site/index.html" \
  && ok "GSL-207: the self-health detail is folded, not deleted and not left 1200px tall" \
  || bad "GSL-207: no fold on the self-health panel"
SH_CHIPS="$(grep -o 'class="sh-chip[^"]*"' "$LK/docs/lab/site/index.html" | wc -l | tr -d ' ')"
[[ "$SH_CHIPS" -eq 3 ]] \
  && ok "GSL-207: all three meter verdicts stay on screen as chips — the fold costs no information" \
  || bad "GSL-207: expected 3 verdict chips in the fold summary, found $SH_CHIPS"
# The fold is CLOSED on a fresh page (this fixture) and OPEN on a dead one ($FW3, the GSL-157
# fixture, whose whole purpose is to grade itself dead). That is the entire policy: it opens when the
# meters are about the correctness of what is on screen, and on nothing else.
grep -q '<details class="sh-fold" open' "$LK/docs/lab/site/index.html" \
  && bad "GSL-207: the fold is open on a FRESH page — it would be open on most days, which is no fold" \
  || ok "GSL-207: on a fresh page the fold stays shut and the KPI tiles come up the screen"
grep -q '<details class="sh-fold" open' "$CRI" \
  && ok "GSL-207 ⭐ on a DEAD page the fold opens itself — the evidence is in the way, before the numbers" \
  || bad "GSL-207 ⭐ a dead page folded its own rot report away. That is the defect this panel exists to prevent."
grep -q '\.sh-fold>summary{cursor:pointer' "$CRI" \
  && ok "GSL-207 control: the stylesheet paints the fold summary — the class has a customer" \
  || bad "GSL-207 control: .sh-fold has no rule"
# Fleet: nine cards of eight fields each, for eight workers eleven days old, is a table.
grep -q '<table id="fleet-rows">' "$FLH" \
  && ok "GSL-207: Fleet renders its workers as one table, not as a card per worker" \
  || bad "GSL-207: Fleet is still a stack of cards"
FL_ROWS="$(grep -o '<tr class="wk [a-z]*"' "$FLH" | wc -l | tr -d ' ')"
[[ "$FL_ROWS" -eq 3 ]] \
  && ok "GSL-207: three named workers -> three table rows, each still carrying its state class" \
  || bad "GSL-207: expected 3 worker rows on the fixture Fleet, found $FL_ROWS"
grep -q '\.wk\.silent \.wk-age{color:var(--warn)}' "$FLH" \
  && ok "GSL-207: silent is still AMBER on the row — the table did not earn the right to say dead" \
  || bad "GSL-207: the silent worker lost its amber when the card became a row"

echo "== GSL-206: the supervisor tile and the gates strip =="
# The mandate opens on "the orchestrator has nobody to orchestrate it from above". The mechanism
# exists; until now the web could not say whether it was RUNNING, and the gates were a sentence typed
# by hand into a text file. Both now travel in the bundle, under the rule the rest of this dashboard
# lives by: a value with no source is `unknown` WITH ITS REASON, never a comfortable zero.
[[ "$(jq -r '.supervision.armed' "$LKB")" == "false" ]] \
  && ok "GSL-206: with no launchd agent installed the supervisor reads NOT ARMED — a fact, not a shrug" \
  || bad "GSL-206: supervision.armed is $(jq -r '.supervision.armed' "$LKB") on a machine with no agent"
[[ -n "$(jq -r '.supervision.last_tick_why // empty' "$LKB")" ]] \
  && ok "GSL-206: a supervisor that never woke says so, with the file it looked for" \
  || bad "GSL-206: last_tick is absent with no reason attached"
[[ -n "$(jq -r '.supervision.loaded_why // empty' "$LKB")" ]] \
  && ok "GSL-206: the half that was NOT measured (launchctl) is stated out loud, not implied by silence" \
  || bad "GSL-206: the tile claims 'armed' without saying that loaded-ness was never checked"
[[ "$(jq -r '.gates.runs | length' "$LKB")" == "3" ]] \
  && ok "GSL-206: all three declared gates get a tile — a gate that stopped writing cannot vanish" \
  || bad "GSL-206: the gates strip is built from whatever files exist, so a broken gate disappears"
[[ "$(jq -r '[.gates.runs[] | select(.state=="unknown") | select(.cmd != null and .cmd != "")] | length' "$LKB")" == "3" ]] \
  && ok "GSL-206: with no receipts every gate reads unknown AND names the command that fills it" \
  || bad "GSL-206: an unknown gate is not actionable (no cmd) or was graded without a receipt"
grep -q 'id="supervisor" data-armed="false"' "$LK/docs/lab/site/index.html" \
  && ok "GSL-206: Overview renders the supervisor tile with its state on the element" \
  || bad "GSL-206: no supervisor tile on Overview"
GT_UNK="$(grep -o 'data-state="unknown"' "$LK/docs/lab/site/index.html" | wc -l | tr -d ' ')"
[[ "$GT_UNK" -ge 3 ]] \
  && ok "GSL-206: three gate tiles render unknown rather than a plausible green" \
  || bad "GSL-206: expected 3 unknown gate tiles on the fixture Overview, found $GT_UNK"

# ⭐ The receipts are read, and a FAILING one keeps saying so. Without this the pass/fail branches
# would never execute and the strip would be asserted only in the state it happens to start in.
mkdir -p "$LK/.artifacts/lab/gates"
printf '{"gate":"smoke","ts":"%s","pass":404,"fail":0,"runner":"tools/lab/smoke.sh"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$LK/.artifacts/lab/gates/smoke.json"
printf '{"gate":"hooks-verify","ts":"%s","pass":12,"fail":2,"runner":"tools/lab/hooks-verify.sh"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$LK/.artifacts/lab/gates/hooks-verify.json"
bash "$CH" --repo "$LK" --no-poll --quiet --json >/dev/null 2>&1
[[ "$(jq -r '.gates.runs[] | select(.name=="smoke") | .state' "$LKB")" == "pass" ]] \
  && ok "GSL-206 ⭐ a green receipt reads pass, with the run's own timestamp" \
  || bad "GSL-206 ⭐ a green smoke receipt did not read pass ($(jq -r '.gates.runs[] | select(.name=="smoke") | .state' "$LKB"))"
[[ "$(jq -r '.gates.runs[] | select(.name=="hooks-verify") | .state' "$LKB")" == "fail" ]] \
  && ok "GSL-206 ⭐ a receipt recording a failure keeps saying fail until a passing run replaces it" \
  || bad "GSL-206 ⭐ a failing receipt was not reported as a failure"
[[ "$(jq -r '.gates.runs[] | select(.name=="tsc") | .state' "$LKB")" == "unknown" ]] \
  && ok "GSL-206 ⭐ the gate with no receipt stays unknown while its neighbours are graded" \
  || bad "GSL-206 ⭐ tsc was graded without a receipt"
grep -q 'data-gate="smoke" data-state="pass"' "$LK/docs/lab/site/index.html" \
  && ok "GSL-206: the built page paints the passing gate on the element, not only in the bundle" \
  || bad "GSL-206: the gate state did not reach the rendered tile"
grep -q '\.kpi\.gate\.unknown{border-left-color:var(--unk)}' "$LK/docs/lab/site/index.html" \
  && ok "GSL-206 control: unknown keeps its own hue off the green-amber-red axis — the rule exists" \
  || bad "GSL-206 control: .kpi.gate.unknown has no rule, so 'never ran' would paint like 'failed'"
# The runners really write these receipts — otherwise the strip above is a reader with no writer.
grep -q 'gates/smoke.json' "$REPO_ROOT/tools/lab/smoke.sh" \
  && grep -q 'gates/hooks-verify.json' "$REPO_ROOT/tools/lab/hooks-verify.sh" \
  && ok "GSL-206 control: both gate runners write their own receipt (the reader has a writer)" \
  || bad "GSL-206 control: a gate runner writes no receipt — its tile can only ever read unknown"

echo "== GSL-209: a theme switch, one search, and a reason you can reach without a mouse =="
# Two controls the dashboard shipped without at all, and one explanation that could only be read with
# a pointer. Both controls ship `hidden` and are revealed by the client — the FilterBar doctrine: a
# control the reader can operate that changes nothing is worse than no control.
S209=0
for P in index timeline tasks questions fleet cost library; do
  grep -q 'id="page-controls"' "$LK/docs/lab/site/$P.html" || S209=1
  grep -q 'id="page-search"' "$LK/docs/lab/site/$P.html" || S209=1
  grep -q 'id="theme-toggle"' "$LK/docs/lab/site/$P.html" || S209=1
done
[[ "$S209" -eq 0 ]] \
  && ok "GSL-209: all seven screens carry the search box and the theme switch" \
  || bad "GSL-209: a screen is missing one of the two page controls"
grep -q '<div class="chrome-controls" id="page-controls" hidden>' "$LK/docs/lab/site/index.html" \
  && ok "GSL-209: the controls ship hidden — with JS off the reader never sees a dead control" \
  || bad "GSL-209: the control band is visible before anything has wired it"
# The theme has to actually survive a reload, which means it has to be written down somewhere.
grep -q 'gosleep-theme' "$LK/docs/lab/site/index.html" \
  && ok "GSL-209: the chosen theme is persisted, so it survives the reload" \
  || bad "GSL-209: nothing persists the theme — every open would revert to the OS setting"
grep -q 'data-theme' "$LK/docs/lab/site/index.html" \
  && ok "GSL-209 control: the stylesheet honours an explicit data-theme in BOTH directions" \
  || bad "GSL-209 control: no data-theme rules — the toggle would move an attribute nothing reads"
# The reason behind `unknown` — reachable from a keyboard and present as TEXT, not only in title=.
grep -q 'class="unknown" tabindex="0"' "$LK/docs/lab/site/tasks.html" \
  && ok "GSL-209: an unknown value is focusable, so its reason is reachable by Tab and by tap" \
  || bad "GSL-209: the unknown marker is still pointer-only"
grep -q '<span class="unk-why">no tracker.issue.updated event has ever carried a status' "$LK/docs/lab/site/tasks.html" \
  && ok "GSL-209 ⭐ the reason is IN THE DOM as text — page search finds it, a screen reader reads it" \
  || bad "GSL-209 ⭐ the reason still lives only in a title attribute"
grep -q 'span\.unknown:focus \.unk-why' "$LK/docs/lab/site/tasks.html" \
  && ok "GSL-209 control: the stylesheet reveals the reason on FOCUS, not only on hover" \
  || bad "GSL-209 control: .unk-why is revealed on hover alone — a pointer feature again"
# One visibility rule. Two mechanisms now hide rows, and the filter's count sentence must stay true
# about the DOM rather than about its own verdict — the rail is the whole safety story of filter.ts.
grep -q 'fHidden' "$LK/docs/lab/site/timeline.html" && grep -q 'sHidden' "$LK/docs/lab/site/timeline.html" \
  && ok "GSL-209: the island filter and the page search AND their two verdicts through one function" \
  || bad "GSL-209: search and filter each set hidden directly — one will silently undo the other"

echo
echo "RESULT: PASS=$PASS FAIL=$FAIL"

# GSL-206: leave a receipt. Until now a green gate left NOTHING on disk (this script deletes its own
# work dir when it passes), so the only record that the gates ran was a sentence typed by hand into
# ORCHESTRATION-STATE.md — which is exactly the "take it on faith" the owner said he was done with.
# One line of JSON, in a gitignored directory, is what lets the dashboard print WHEN this last ran
# and what it said. A FAILING run writes one too: a receipt that only ever records success is a
# green light wired to nothing.
mkdir -p "$REPO_ROOT/.artifacts/lab/gates" 2>/dev/null
printf '{"gate":"smoke","ts":"%s","pass":%d,"fail":%d,"runner":"tools/lab/smoke.sh"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PASS" "$FAIL" \
  > "$REPO_ROOT/.artifacts/lab/gates/smoke.json" 2>/dev/null || true

if [[ "$FAIL" -eq 0 ]]; then rm -rf "$WORK"; exit 0; else echo "(artifacts kept at $WORK)"; exit 1; fi
