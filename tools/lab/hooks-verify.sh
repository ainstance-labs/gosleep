#!/usr/bin/env bash
# =============================================================================
# gosleep lab — hooks-verify: prove the T1 event layer FIRES, against a real Claude Code process.
# (GSL-83 gate; PRD Phase 4 risk: "hooks may not fire as documented on THIS machine — verify at
#  build time, degrade with a log, never silently.")
#
# Static validation is not verification. `jq .` proves the config parses; it does NOT prove Claude
# Code loads the hook, spawns the script, and that an event lands. Those are different claims, and
# the gap between them is exactly where a placebo event log lives. So this harness starts a REAL
# `claude -p` session, makes it perform a REAL git commit, and then asserts the events showed up on
# their own — no model cooperation, no synthetic stdin.
#
# Writes a verdict table to .artifacts/lab/hooks-verify.log (gitignored). Events go to a throwaway
# lab dir, so a verification run never pollutes the real timeline.
#
# Usage:  tools/lab/hooks-verify.sh          exit 0 = every REAL-RUN hook fired
#         tools/lab/hooks-verify.sh --offline   skip the claude -p leg (synthetic payloads only)
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

WORK="$REPO_ROOT/.artifacts/lab/verify"
LOG="$REPO_ROOT/.artifacts/lab/hooks-verify.log"
PROBE_REPO="$WORK/probe-repo"
export GOSLEEP_LAB_DIR="$WORK/lab"
export GOSLEEP_LAB_TRACE=1
EVENTS="$GOSLEEP_LAB_DIR/events"
TRACE="$GOSLEEP_LAB_DIR/scratch/hook-trace.jsonl"
OFFLINE="${1:-}"

rm -rf "$WORK"; mkdir -p "$WORK" "$(dirname "$LOG")"
: > "$LOG"
PASS=0; FAIL=0
say()  { echo "$*" | tee -a "$LOG"; }
ok()   { PASS=$((PASS+1)); say "  PASS      $*"; }
bad()  { FAIL=$((FAIL+1)); say "  FAIL      $*"; }
note() { say "  $*"; }

say "hooks-verify — $(date -u +%Y-%m-%dT%H:%M:%SZ) — claude $(claude --version 2>/dev/null | head -1)"
say ""

# ── 0. config sanity ─────────────────────────────────────────────────────────
say "== config =="
jq -e . .claude/settings.json >/dev/null 2>&1 && ok "settings.json parses" || bad "settings.json parses"
jq -e '.hooks.Stop[0].hooks[0].command | test("stop-require-final-text")' .claude/settings.json >/dev/null 2>&1 \
  && ok "owner Stop-guard still first in Stop[] (GSL-82 not broken)" \
  || bad "owner Stop-guard MISSING or displaced — the turn-ends-with-text rule is unenforced"
bash -n tools/lab/lab-log.sh    && ok "lab-log.sh syntax"   || bad "lab-log.sh syntax"
bash -n tools/hooks/lab-log-hook.sh && ok "shim syntax"     || bad "shim syntax"
grep -qE 'claude( -p|\b--print)' tools/lab/lab-log.sh && bad "lab-log.sh must make 0 LLM calls (C1)" \
  || ok "lab-log.sh makes 0 LLM calls (C1)"
say ""

# ── 0b. the debounce trigger (GSL-198) ──────────────────────────────────────
# The returned element from the original design: PostToolUse, debounced, on writes to docs/lab/.
# Synthetic payloads go through the REAL shim (the exact file settings.json names) into a sandbox
# state dir — proving shim -> engine -> waiter -> run -> ledger without touching the live lab.
# What this cannot prove (Claude Code actually dispatching PostToolUse) the real-run leg below
# already proves for the sibling hook on the same matchers.
say "== debounce trigger (GSL-198) =="
bash -n tools/lab/chronicler-debounce.sh && ok "chronicler-debounce.sh syntax" || bad "chronicler-debounce.sh syntax"
bash -n tools/hooks/chronicler-debounce-hook.sh && ok "debounce shim syntax" || bad "debounce shim syntax"
[ "$(jq '[.hooks.PostToolUse[].hooks[].command] | map(select(test("chronicler-debounce"))) | length' .claude/settings.json 2>/dev/null)" = "2" ] \
  && ok "settings.json arms the debounce shim on both write-capable PostToolUse matchers" \
  || bad "debounce shim not wired on Bash + Write|Edit|MultiEdit — the trigger fell out AGAIN"
DBW="$WORK/debounce"
mkdir -p "$DBW"
printf '{"hook_event_name":"PostToolUse","tool_name":"Write","tool_input":{"file_path":"docs/lab/questions/queue.jsonl","content":"x"}}' \
  | GOSLEEP_DEBOUNCE_DIR="$DBW/state" GOSLEEP_DEBOUNCE_QUIET=1 GOSLEEP_DEBOUNCE_CMD="touch $DBW/ran" \
    GOSLEEP_TICK_LEDGER="$DBW/ledger.jsonl" bash tools/hooks/chronicler-debounce-hook.sh
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do [ -f "$DBW/ran" ] && break; sleep 1; done
[ -f "$DBW/ran" ] && grep -q '"mode":"debounce"' "$DBW/ledger.jsonl" 2>/dev/null \
  && ok "a docs/lab write through the shim -> one debounced run + one ledger line" \
  || bad "docs/lab write did NOT produce a debounced run (stamp=$([ -f "$DBW/state/last-write" ] && echo yes || echo no))"
printf '{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"git status"},"tool_response":"M docs/lab/events/x.jsonl"}' \
  | GOSLEEP_DEBOUNCE_DIR="$DBW/neg" GOSLEEP_DEBOUNCE_QUIET=1 GOSLEEP_DEBOUNCE_CMD="touch $DBW/neg-ran" \
    bash tools/hooks/chronicler-debounce-hook.sh
[ ! -f "$DBW/neg/last-write" ] \
  && ok "tool_response mentioning docs/lab/ does NOT arm it — reads of the world are not writes to the lab" \
  || bad "phantom trigger: a mere MENTION of docs/lab/ in output armed the debounce"
say ""

# ── 1. routing: the adversarial cases that actually bit ─────────────────────
# Every NONE case below was, at some point on 2026-07-12, a REAL phantom event in the log — a commit
# or a PR the timeline claimed happened and that never did. They are the regression suite: a lying
# event log is worse than no event log, so "did not invent an event" is as much a gate as "logged one".
say "== routing (adversarial) =="
python3 - "$REPO_ROOT" <<'PY' | tee -a "$LOG"
import json, os, subprocess, sys, tempfile
root = sys.argv[1]
LL = os.path.join(root, "tools/lab/lab-log.sh")
CASES = [
    ("plain commit",        "git commit -m 'x'",                                    "vcs.commit"),
    ("commit behind cd",    "cd /repo && git commit -m 'GSL-83 hooks'",             "vcs.commit"),
    ("git -C form",         "git -C /tmp/r commit --allow-empty -m 'probe'",        "vcs.commit"),  # real run
    ("env-prefixed push",   "GIT_TRACE=1 git push",                                 "vcs.push"),
    ("gh pr create",        "gh pr create --title 'GSL-81'",                        "vcs.pr.opened"),
    ("multi-line script",   "set -e\ncd /repo\ngit push origin HEAD",               "vcs.push"),
    ("MENTION not command", 'echo "remember to git commit later"',                  None),          # phantom
    ("heredoc payload",     "python3 - <<'PY'\np={'c':'cd /r && git commit -m x'}\nPY",  None),     # phantom
    ("untracked git verb",  "git status --short",                                   None),
    ("innocent bash",       "ls -la",                                               None),
]
ok = fail = 0
for name, cmd, want in CASES:
    d = tempfile.mkdtemp()
    env = dict(os.environ, GOSLEEP_LAB_DIR=d)
    payload = {"hook_event_name": "PostToolUse", "session_id": "routing", "tool_name": "Bash",
               "tool_input": {"command": cmd},
               "tool_response": "[main 1a2b3c4] x" if want == "vcs.commit" else "ok"}
    subprocess.run(["bash", LL], input=json.dumps(payload).encode(), env=env, check=False)
    got = None
    ev = os.path.join(d, "events")
    if os.path.isdir(ev):
        for fn in os.listdir(ev):
            if fn.endswith(".jsonl"):
                with open(os.path.join(ev, fn), encoding="utf-8") as f:
                    for line in f:
                        got = json.loads(line)["type"]
    if got == want:
        ok += 1
        print("  PASS      %-20s -> %s" % (name, want or "(no event — correctly not invented)"))
    else:
        fail += 1
        print("  FAIL      %-20s -> got %r, want %r" % (name, got, want))
print("ROUTING %d/%d" % (ok, ok + fail))
PY
grep -q "ROUTING 10/10" "$LOG" && ok "routing: 10/10 (6 real verbs logged, 4 phantoms refused)" \
                              || bad "routing regressions — see cases above"
say ""

# ── 2. the REAL run: a live Claude Code process, a real commit ───────────────
say "== real run (claude -p) =="
if [ "$OFFLINE" = "--offline" ]; then
  note "SKIPPED (--offline): the claude -p leg is the only thing that proves hooks actually FIRE."
else
  git init -q "$PROBE_REPO" 2>/dev/null
  git -C "$PROBE_REPO" config user.email "hooks-verify@gosleep.local"
  git -C "$PROBE_REPO" config user.name  "hooks-verify"
  # A throwaway repo: the probe makes a REAL commit that touches nothing of ours.
  timeout 180 claude -p \
    "Run exactly this one Bash command and then reply with the single word done: git -C $PROBE_REPO commit --allow-empty -m 'GSL-83 hook probe'" \
    --allowedTools "Bash" >"$WORK/claude-p.out" 2>"$WORK/claude-p.err"
  rc=$?
  note "claude -p exit=$rc  stdout: $(head -c 120 "$WORK/claude-p.out" | tr '\n' ' ')"
  [ $rc -ne 0 ] && note "stderr: $(head -c 200 "$WORK/claude-p.err" | tr '\n' ' ')"

  fired() { [ -d "$EVENTS" ] && jq -s --arg t "$1" 'map(select(.type==$t)) | length' "$EVENTS"/*.jsonl 2>/dev/null | grep -qv '^0$'; }

  # SessionStart / Stop / SessionEnd / PostToolUse are the four that carry the phase:
  # a worker appearing, a turn ending, a commit landing, a worker leaving.
  fired pane.started    && ok "SessionStart -> pane.started"        || bad "SessionStart did NOT fire"
  fired agent.turn_ended && ok "Stop -> agent.turn_ended"           || bad "Stop did NOT fire"
  fired vcs.commit      && ok "PostToolUse(Bash) -> vcs.commit  [F4-S1: a commit logged with 0 model cooperation]" \
                        || bad "PostToolUse(Bash) did NOT produce vcs.commit"
  fired pane.ended      && ok "SessionEnd -> pane.ended"            || bad "SessionEnd did NOT fire"

  if [ -f "$EVENTS/$(date -u +%Y-%m-%d).jsonl" ]; then
    jq -c . "$EVENTS"/*.jsonl >/dev/null 2>&1 && ok "every event line is valid JSON" || bad "corrupt JSONL"
    sha="$(jq -r 'select(.type=="vcs.commit") | .data.sha' "$EVENTS"/*.jsonl 2>/dev/null | head -1)"
    real="$(git -C "$PROBE_REPO" rev-parse --short HEAD 2>/dev/null)"
    [ -n "$sha" ] && [ -n "$real" ] && [ "${real#"$sha"}" != "$real" -o "${sha#"$real"}" != "$sha" ] \
      && ok "logged sha ($sha) == the commit git actually made ($real)" \
      || bad "sha mismatch: logged='$sha' actual='$real'"

    # A QUIET commit prints nothing, so there is no `[branch sha]` echo to parse. Without a fallback
    # the event carries sha="" — a commit line in the timeline pointing nowhere. (Dogfooding caught
    # this: the commit that introduced lab-log.sh was made with -q and logged itself sha-less.)
    #
    # RUN the commit for real before mirroring it to the hook. This test used to feed the payload
    # WITHOUT running anything — and demand a sha back. That is the C1 phantom stated as a test: a
    # command that committed nothing, answered with the sha of whatever was sitting at HEAD. Since
    # the writer now checks HEAD is fresh AND its own, the honest test is the only one that passes.
    QLAB="$WORK/quietlab"
    git -C "$PROBE_REPO" commit -q --allow-empty -m quiet
    qreal="$(git -C "$PROBE_REPO" rev-parse --short HEAD 2>/dev/null)"
    printf '{"hook_event_name":"PostToolUse","session_id":"q","cwd":"%s","tool_name":"Bash","tool_input":{"command":"git commit -q --allow-empty -m quiet"},"tool_response":""}' \
      "$PROBE_REPO" | GOSLEEP_LAB_DIR="$QLAB" bash tools/lab/lab-log.sh
    qsha="$(jq -r 'select(.type=="vcs.commit") | .data.sha' "$QLAB"/events/*.jsonl 2>/dev/null | head -1)"
    [ -n "$qsha" ] && [ "$qsha" = "$qreal" ] \
      && ok "quiet commit (git -q echoes nothing) -> sha recovered from git itself ($qsha)" \
      || bad "quiet-commit sha fallback: got '$qsha', want '$qreal'"

    # The other half of the same coin (REVIEW-gsl81 C1): a commit that FAILED must not be handed the
    # sha still sitting at HEAD. Same payload shape, a message no commit here ever carried.
    FLAB="$WORK/failedlab"
    printf '{"hook_event_name":"PostToolUse","session_id":"f","cwd":"%s","tool_name":"Bash","tool_input":{"command":"git commit -q -m \\"GSL-99 a commit that never happened\\""},"tool_response":"nothing to commit, working tree clean"}' \
      "$PROBE_REPO" | GOSLEEP_LAB_DIR="$FLAB" bash tools/lab/lab-log.sh
    fsha="$(jq -r 'select(.type=="vcs.commit") | .data.sha' "$FLAB"/events/*.jsonl 2>/dev/null | head -1)"
    [ -z "$fsha" ] \
      && ok "a FAILED commit logs no sha — HEAD ($qreal) is not laundered into a phantom" \
      || bad "phantom: a commit that never happened was logged with sha '$fsha'"
    note ""
    note "  events captured:"
    jq -r '"    seq=\(.seq) \(.type)  actor=\(.actor)  src=\(.src)"' "$EVENTS"/*.jsonl 2>/dev/null | tee -a "$LOG" >/dev/null
    jq -r '"    seq=\(.seq) \(.type)  actor=\(.actor)  src=\(.src)"' "$EVENTS"/*.jsonl 2>/dev/null
  else
    bad "no events file at all — the hook layer is DEAD, not merely degraded"
  fi
  [ -f "$TRACE" ] && note "  hook firings traced: $(wc -l < "$TRACE" | tr -d ' ')"
fi
say ""

# ── 2. wired, and now proven end-to-end by synthetic hook payloads ──────────
#
# GSL-232: the hook LAYER's contract is "if Claude Code sends this stdin, we log that event".
# The realistic wire-tap (a live rate-limit or a real teammate-idle) cannot be forced on demand,
# so we prove the LAYER by feeding the exact stdin envelope the Claude Code docs pin for each
# hook and asserting the event line lands in events/*.jsonl with the expected type + data. It
# does NOT prove that Claude Code will emit that stdin (only a real fire can); it proves that
# when it does, the layer will not drop it. Combined with section 1's real-run leg (which forces
# PostToolUse + Stop) that is the coverage the audit finding (59) asks for — real for the hooks
# a harness CAN force, synthetic-plus-mapping for the ones it cannot.
say "== 2. synthetic hook-layer proof — StopFailure + TeammateIdle (GSL-232) =="

WLAB="$WORK/wired-lab"; mkdir -p "$WLAB/events"

# StopFailure — the quota-window detector. The stdin shape is pinned by the CC docs: `error_type`
# is the discriminator (rate_limit | overloaded | server_error | billing_error). The mapping under
# test is lab-log.sh's "StopFailure -> api.failure" arm.
printf '%s' '{"hook_event_name":"StopFailure","session_id":"synth-sf","cwd":"'"$PROBE_REPO"'","error_type":"rate_limit","error":"rate-limit reached"}' \
  | GOSLEEP_LAB_DIR="$WLAB" bash tools/lab/lab-log.sh
if jq -s -e '[.[] | select(.type=="api.failure" and .src=="hook:StopFailure" and .data.error_type=="rate_limit")] | length >= 1' \
     "$WLAB"/events/*.jsonl >/dev/null 2>&1; then
  ok "StopFailure(error_type=rate_limit) -> api.failure event lands with the type intact"
else
  bad "StopFailure synthetic payload did not produce an api.failure event"
fi

# The same hook, other side of the same coin: an overloaded response is the second common error_type
# and must land under the same api.failure roof (so downstream consumers count them together).
printf '%s' '{"hook_event_name":"StopFailure","session_id":"synth-sf2","cwd":"'"$PROBE_REPO"'","error_type":"overloaded","error":"upstream overloaded"}' \
  | GOSLEEP_LAB_DIR="$WLAB" bash tools/lab/lab-log.sh
[ "$(jq -s -e '[.[] | select(.type=="api.failure")] | length' "$WLAB"/events/*.jsonl 2>/dev/null || echo 0)" -ge "2" ] \
  && ok "second StopFailure(error_type=overloaded) also lands (api.failure count >= 2)" \
  || bad "StopFailure overloaded synth did not land"

# TeammateIdle — a teammate agent went idle in the ORCHESTRATOR's session. The mapping under
# test is lab-log.sh's "TeammateIdle -> agent.idle" arm; it carries the agent_type as data.
printf '%s' '{"hook_event_name":"TeammateIdle","session_id":"synth-ti","cwd":"'"$PROBE_REPO"'","agent_type":"impl-wave4"}' \
  | GOSLEEP_LAB_DIR="$WLAB" bash tools/lab/lab-log.sh
if jq -s -e '[.[] | select(.type=="agent.idle" and .src=="hook:TeammateIdle" and .data.agent_type=="impl-wave4")] | length >= 1' \
     "$WLAB"/events/*.jsonl >/dev/null 2>&1; then
  ok "TeammateIdle(agent_type=impl-wave4) -> agent.idle event lands with the agent_type intact"
else
  bad "TeammateIdle synthetic payload did not produce an agent.idle event"
fi

note "  events file for section 2:"
note "    $WLAB/events/*.jsonl"
jq -c '{ts,type,src,data}' "$WLAB"/events/*.jsonl 2>/dev/null | while read -r ln; do
  note "    $ln"
done
say ""

# ── 2b. still un-forced by any harness (kept honest) ────────────────────────
say "== 2b. wired, not exercised end-to-end (mapping unit-tested; real fire unproven here) =="
note "PreCompact    — needs a real context compaction"
note "PostCompact   — needs a real context compaction"
note "Notification  — needs a permission prompt / idle prompt"
note "SubagentStart/Stop, TaskCreated/TaskCompleted — fire in an interactive session; see dev_history"
say ""

# ── 3. web control plane co-tenancy note (GSL-269, GSL-250 epic) ────────────
# When gosleep-core (Bun+Hono on 127.0.0.1:7331, from epic GSL-250) is running under launchd,
# the POST /actions/* endpoints legitimately spawn short-lived processes: `bash lab-emit.sh`
# for JSONL events, `bash chronicler.sh` on debounce, `python3 tools/lab/tests/*.sh` in
# smoke leg. Those spawns appear in `ps` / `pgrep` / any process-hygiene sweep this harness
# might grow, and they are NORMAL — the same tools the fleet uses, called by the web writer
# instead of by a live agent's Bash tool. A hygiene check that flags them adds noise, never
# safety; if one is ever added, whitelist parents by bind (127.0.0.1:7331) or by cmd basename
# (bun, python3, node) — not by counting spawn events, because a busy owner-day can be dozens.
say "== web control plane co-tenancy (GSL-250) =="
note "gosleep-core (127.0.0.1:7331) legitimately spawns bash/python3 for lab-emit + chronicler"
note "on every /actions/* POST. Those spawns are NORMAL when the server is running under launchd."
note "Any process-hygiene sweep must whitelist the loopback-bound parent — do NOT count spawn"
note "events (a busy owner-day is dozens) and do NOT alarm on \`bash lab-emit.sh\` under \`bun\`."
say ""

say "== verdict: $PASS pass, $FAIL fail =="
[ "$FAIL" -eq 0 ] || say "DEGRADED — a failing hook above is a hook that will silently log NOTHING."
say "log: $LOG"

# GSL-206: the machine-readable half of that log line. The dashboard cannot parse prose, and the
# owner should not have to take "hooks-verify 14/14" from a hand-written STATE file on faith.
# A failing run writes a receipt too — see the note in smoke.sh on why that matters.
mkdir -p "$REPO_ROOT/.artifacts/lab/gates" 2>/dev/null
printf '{"gate":"hooks-verify","ts":"%s","pass":%d,"fail":%d,"runner":"tools/lab/hooks-verify.sh"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PASS" "$FAIL" \
  > "$REPO_ROOT/.artifacts/lab/gates/hooks-verify.json" 2>/dev/null || true

exit "$([ "$FAIL" -eq 0 ] && echo 0 || echo 1)"
