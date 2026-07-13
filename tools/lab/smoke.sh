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
grep -qEi 'tmux|spawn|Agent tool|teammate' "$SCRIPT_DIR/chronicler.py" \
  && bad "C5: the chronicler can take a pane" || ok "C5: no tmux/spawn — it cannot hold a pane slot"

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
V="$(python3 - "$CR/docs/lab/site/index.html" <<'PY'
import json, re, sys
h = open(sys.argv[1], encoding="utf-8").read()
prose = re.search(r'<span id="stale-verdict">(.*?)</span>', h, re.S)
prose = prose.group(1).strip() if prose else ""
vmap  = re.search(r'var V = (\{.*?\});', h, re.S)
vmap  = json.loads(vmap.group(1)) if vmap else {}
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

echo
echo "RESULT: PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -eq 0 ]]; then rm -rf "$WORK"; exit 0; else echo "(artifacts kept at $WORK)"; exit 1; fi
