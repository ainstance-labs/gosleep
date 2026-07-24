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

# ── 2. hooks a harness cannot force ─────────────────────────────────────────
# Honesty beats coverage theatre: these are wired and their payload mapping is unit-tested, but
# nothing here can MAKE them happen. Say so, rather than let a green check imply more than it proves.
say "== wired, not exercised by this harness (mapping unit-tested; real fire unproven here) =="
note "StopFailure   — needs a real rate_limit/overloaded from the API (cannot be forced on demand)"
note "PreCompact    — needs a real context compaction"
note "PostCompact   — needs a real context compaction"
note "TeammateIdle  — needs an Agent-Teams teammate going idle (fires in the ORCHESTRATOR's session,"
note "                not in a claude -p child; confirm next cycle: grep agent.idle in events/)"
note "Notification  — needs a permission prompt / idle prompt"
note "SubagentStart/Stop, TaskCreated/TaskCompleted — fire in an interactive session; see dev_history"
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
