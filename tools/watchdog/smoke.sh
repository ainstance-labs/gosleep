#!/usr/bin/env bash
# =============================================================================
# gosleep watchdog — smoke harness (GSL-52..55 gates).
#
# Drives every decision branch of watchdog.sh deterministically:
# heartbeat fixtures (fresh / stale / missing / quiesced / rolling / high-ctx)
# x tmux probe injection (WD_TEST_MODE) — always --dry-run, no tmux, no kills.
#
# All artifacts under <repo>/.artifacts/watchdog-smoke/ (gitignored).
# macOS/BSD userland assumed (date -v, touch -t) — same box launchd targets.
#
# Usage: smoke.sh            exit 0 = all scenarios pass
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WD="$SCRIPT_DIR/watchdog.sh"
WORK="$REPO_ROOT/.artifacts/watchdog-smoke"

rm -rf "$WORK"
mkdir -p "$WORK"

PASS=0
FAIL=0
NOW="$(date +%s)"

ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

# --- static gates -------------------------------------------------------------
echo "== static gates =="
if bash -n "$WD" && bash -n "$SCRIPT_DIR/install-watchdog.sh"; then
  ok "bash -n (syntax)"
else
  bad "bash -n (syntax)"
fi

# R1.2 acceptance: the watchdog contains ZERO LLM calls (no headless claude).
if grep -qE 'claude (-p|--print)|api\.anthropic|ANTHROPIC_API_KEY=' "$WD"; then
  bad "0-LLM check: found a headless/API call in watchdog.sh"
else
  ok "0-LLM check (no claude -p / API calls)"
fi

# kill-pane safety: every real invocation must be '-t' (explicit id); never -a.
if grep -E 'kill-pane' "$WD" | grep -vE 'kill-pane -t|forbidden|NEVER' | grep -q .; then
  bad "kill-pane safety: found kill-pane without explicit -t"
else
  ok "kill-pane safety (explicit -t only, no -a)"
fi

# --- scenario helpers ---------------------------------------------------------
fresh_hb() { # $1=file $2=json-line
  printf '%s\n' "$2" > "$1"
}
stale_hb() { # $1=file $2=json-line  (mtime pushed 30 min back)
  printf '%s\n' "$2" > "$1"
  touch -t "$(date -v-30M +%Y%m%d%H%M.%S)" "$1"
}

# All healthy fixtures carry the C1 identity field: "pane" = the orchestrator's
# own $TMUX_PANE (%42 in tests — matches WD_TEST_ORCH_PANE when it should exist).
HB_OK='{"ts":"2026-07-10T03:00:00Z","cycle":12,"context_pct":41,"open_workers":2,"status":"ok","pane":"%42"}'
HB_SOLO='{"ts":"2026-07-10T03:00:00Z","cycle":12,"context_pct":41,"open_workers":1,"status":"ok","pane":"%42"}'
HB_HIGH_CTX='{"ts":"2026-07-10T03:00:00Z","cycle":14,"context_pct":85,"open_workers":2,"status":"ok","pane":"%42"}'
HB_QUIESCED='{"ts":"2026-07-10T03:00:00Z","cycle":15,"context_pct":50,"open_workers":0,"status":"quiesced","pane":"%42"}'
HB_ROLLING='{"ts":"2026-07-10T03:00:00Z","cycle":15,"context_pct":72,"open_workers":2,"status":"rolling","pane":"%42"}'
# C1 fixtures: heartbeat names a pane that no longer exists (%4 — the dead
# orchestrator; the only LIVE pane, %42, is a worker) / carries no pane at all.
HB_ORPHAN='{"ts":"2026-07-10T03:00:00Z","cycle":12,"context_pct":41,"open_workers":2,"status":"ok","pane":"%4"}'
HB_NOPANE='{"ts":"2026-07-10T03:00:00Z","cycle":12,"context_pct":41,"open_workers":2,"status":"ok"}'
HB_BADPANE='{"ts":"2026-07-10T03:00:00Z","cycle":12,"context_pct":41,"open_workers":2,"status":"ok","pane":"orchestrator"}'

# run_case NAME EXPECTED_DECISION SESSION_ALIVE PANE HB_KIND HB_JSON [setup-fn]
# Extra per-case env (e.g. WD_TEST_PROC_ALIVE=0) via global CASE_ENV, cleared after.
CASE_ENV=""
run_case() {
  local name="$1" expected="$2" alive="$3" pane="$4" hb_kind="$5" hb_json="$6" setup="${7:-}"
  local dir="$WORK/$name"
  mkdir -p "$dir/state"
  case "$hb_kind" in
    fresh)   fresh_hb "$dir/hb" "$hb_json" ;;
    stale)   stale_hb "$dir/hb" "$hb_json" ;;
    missing) : ;;
  esac
  [ -n "$setup" ] && "$setup" "$dir"
  local out rc=0
  # shellcheck disable=SC2086
  out="$(
    env WD_CONFIG=/dev/null \
    WD_TEST_MODE=1 \
    WD_TEST_SESSION_ALIVE="$alive" \
    WD_TEST_ORCH_PANE="$pane" \
    WD_STATE_DIR="$dir/state" \
    WD_HEARTBEAT_FILE="$dir/hb" \
    WD_LEDGER_FILE="$dir/ledger.jsonl" \
    $CASE_ENV \
    bash "$WD" --dry-run 2>&1
  )" || rc=$?
  CASE_ENV=""
  echo "$out" > "$dir/output.txt"
  if [ "$rc" -ne 0 ]; then
    bad "$name: watchdog exited rc=$rc (expected 0)"
    return
  fi
  if echo "$out" | grep -qE "DECISION=$expected( |$)"; then
    ok "$name -> $expected"
  else
    bad "$name: expected DECISION=$expected, got: $(echo "$out" | grep -oE 'DECISION=[a-z_]+' | tail -1)"
  fi
}

seed_old_nudge()   { echo $((NOW - 400)) > "$1/state/nudge.marker"; }
seed_old_handoff() { echo $((NOW - 700)) > "$1/state/handoff-request.marker"; }

# GSL-53 seeds: restart-budget history + escalation marker
seed_3_recent_restarts() { { echo $((NOW-300)); echo $((NOW-600)); echo $((NOW-900)); } > "$1/state/restarts.history"; }
seed_2_recent_restarts() { { echo $((NOW-300)); echo $((NOW-600)); } > "$1/state/restarts.history"; }
seed_3_old_restarts()    { { echo $((NOW-7200)); echo $((NOW-7300)); echo $((NOW-7400)); } > "$1/state/restarts.history"; }
seed_exhausted_and_escalated() { seed_3_recent_restarts "$1"; echo $((NOW-60)) > "$1/state/escalated.marker"; }
seed_escalated_only()    { echo $((NOW-60)) > "$1/state/escalated.marker"; }

echo "== decision scenarios (dry-run, injected probes) =="
#         name                      expected            alive pane  hb       json
run_case  ok-fresh-alive            ok                  1     %42   fresh    "$HB_OK"
run_case  dead-session-fresh-hb     rewake              0     ""    fresh    "$HB_SOLO"
run_case  dead-session-stale-hb     rewake              0     ""    stale    "$HB_SOLO"
# Live session but the heartbeat's pane is gone / absent: identity can no longer
# be verified -> refuse + escalate, never guess (review C1; was: blind rewake/nudge).
run_case  pane-missing-session-up   identity_unverified 1     ""    fresh    "$HB_OK"
run_case  stale-first-tick          nudged              1     %42   stale    "$HB_OK"
run_case  stale-after-nudge         kill_rewake         1     %42   stale    "$HB_OK"      seed_old_nudge
run_case  missing-hb-alive          identity_unverified 1     %42   missing  ""
run_case  quiesced-dead-session     ok_quiesced         0     ""    fresh    "$HB_QUIESCED"
run_case  rolling-fresh             waiting_successor   0     ""    fresh    "$HB_ROLLING"
run_case  ctx-ceiling-first-tick    handoff_requested   1     %42   fresh    "$HB_HIGH_CTX"
run_case  ctx-ceiling-overdue       kill_rewake         1     %42   fresh    "$HB_HIGH_CTX" seed_old_handoff

echo "== restart budget scenarios (GSL-53) =="
#         name                      expected            alive pane  hb       json           seed
run_case  budget-exhausted          escalated           0     ""    fresh    "$HB_SOLO"     seed_3_recent_restarts
run_case  budget-available          rewake              0     ""    fresh    "$HB_SOLO"     seed_2_recent_restarts
run_case  budget-window-pruned      rewake              0     ""    fresh    "$HB_SOLO"     seed_3_old_restarts
run_case  escalation-suppressed     escalated           0     ""    fresh    "$HB_SOLO"     seed_exhausted_and_escalated
run_case  ok-clears-escalated       ok                  1     %42   fresh    "$HB_OK"       seed_escalated_only

# Budget exhausted: escalation in ledger, NO restart, marker written.
if grep -q '"event":"escalation"' "$WORK/budget-exhausted/ledger.jsonl" \
   && ! grep -q '"event":"orchestrator_restarted"' "$WORK/budget-exhausted/ledger.jsonl" \
   && [ -f "$WORK/budget-exhausted/state/escalated.marker" ]; then
  ok "exhausted budget -> escalation, no restart, marker set (F1-S4)"
else
  bad "exhausted budget: expected escalation + no restart + marker"
fi
# Budget available: restart happened, recorded (3 lines now), backoff 4s (n=2).
if grep -q '"event":"orchestrator_restarted"' "$WORK/budget-available/ledger.jsonl" \
   && [ "$(wc -l < "$WORK/budget-available/state/restarts.history" | tr -d ' ')" = "3" ] \
   && grep -q 'would backoff 4s' "$WORK/budget-available/output.txt"; then
  ok "budget available -> backoff 4s (n=2), restart recorded (2->3 in window)"
else
  bad "budget available: expected restart + history=3 + backoff 4s"
fi
# Window pruning: old restarts don't count; restart allowed again.
if grep -q '"event":"orchestrator_restarted"' "$WORK/budget-window-pruned/ledger.jsonl"; then
  ok "restarts outside the window are pruned (budget refreshes)"
else
  bad "window pruning failed: old restarts still blocking"
fi
# Fresh escalation marker suppresses a duplicate notification.
if ! grep -q '"event":"escalation"' "$WORK/escalation-suppressed/ledger.jsonl" 2>/dev/null; then
  ok "repeat escalation suppressed while marker is fresh"
else
  bad "duplicate escalation despite fresh marker"
fi
# Healthy tick clears the escalation marker (new episode can re-escalate).
if [ ! -f "$WORK/ok-clears-escalated/state/escalated.marker" ]; then
  ok "healthy tick clears escalated marker"
else
  bad "escalated marker not cleared on healthy tick"
fi

echo "== Gastown debounce scenarios (GSL-54) =="
seed_last_started()      { echo $((NOW - 30)) > "$1/state/last-started.marker"; }
seed_zombie_2()          { echo 2 > "$1/state/zombie.count"; }
seed_zombie_2_recover()  { echo 2 > "$1/state/zombie.count"; }
seed_nudged_and_cooldown() { echo $((NOW - 400)) > "$1/state/nudge.marker"; echo $((NOW - 60)) > "$1/state/last-kill.marker"; }

# (a) startup grace — Gastown #567 / F1-S2
CASE_ENV="WD_TEST_SESSION_CREATED=$((NOW - 30))"
run_case  grace-session-created     ok_grace            1     %42   missing  ""
run_case  grace-last-started        ok_grace            1     %42   missing  ""             seed_last_started
CASE_ENV="WD_TEST_SESSION_CREATED=$((NOW - 500))"
# Grace expired with no heartbeat at all -> no pane identity -> refuse (C1);
# pre-C1 this was a positional nudge into whatever pane came first.
run_case  grace-expired             identity_unverified 1     %42   missing  ""

# (b) zombie debounce — 3 consecutive cycles / F1-S3
CASE_ENV="WD_TEST_PROC_ALIVE=0"
run_case  zombie-first-cycle        zombie_watch        1     %42   stale    "$HB_OK"
CASE_ENV="WD_TEST_PROC_ALIVE=0"
run_case  zombie-third-cycle        kill_rewake         1     %42   stale    "$HB_OK"       seed_zombie_2
run_case  zombie-recovers           nudged              1     %42   stale    "$HB_OK"       seed_zombie_2_recover

# (c) kill cooldown  (d) mass-death
run_case  kill-cooldown-defers      kill_deferred       1     %42   stale    "$HB_OK"       seed_nudged_and_cooldown
run_case  mass-death                mass_death          0     ""    fresh    "$HB_OK"

if [ "$(cat "$WORK/zombie-first-cycle/state/zombie.count" 2>/dev/null)" = "1" ]; then
  ok "zombie counter incremented to 1 (no kill on first divergence)"
else
  bad "zombie counter wrong after first cycle"
fi
if grep -qE 'zombie_confirmed_3_cycles' "$WORK/zombie-third-cycle/output.txt" \
   && grep -q '"event":"orchestrator_restarted"' "$WORK/zombie-third-cycle/ledger.jsonl"; then
  ok "zombie confirmed only on 3rd consecutive cycle -> kill+re-wake (F1-S3)"
else
  bad "zombie 3-cycle confirmation failed"
fi
if [ ! -f "$WORK/zombie-recovers/state/zombie.count" ]; then
  ok "process reappears -> zombie counter reset (consecutive, not cumulative)"
else
  bad "zombie counter not reset on recovery"
fi
if ! grep -q '"event":"kill"' "$WORK/kill-cooldown-defers/ledger.jsonl" 2>/dev/null; then
  ok "kill within cooldown deferred (no kill event)"
else
  bad "kill executed despite cooldown"
fi
if grep -q '"event":"mass_death"' "$WORK/mass-death/ledger.jsonl" \
   && grep -q '"event":"escalation"' "$WORK/mass-death/ledger.jsonl" \
   && ! grep -q '"event":"orchestrator_restarted"' "$WORK/mass-death/ledger.jsonl"; then
  ok "mass death -> escalate, no blind restart"
else
  bad "mass death handling wrong"
fi

# (e) single-flight + rate limit — the watchdog itself is debounced
dir="$WORK/rate-limit"; mkdir -p "$dir/state"; fresh_hb "$dir/hb" "$HB_OK"
env1="WD_CONFIG=/dev/null WD_TEST_MODE=1 WD_TEST_SESSION_ALIVE=1 WD_TEST_ORCH_PANE=%42 WD_STATE_DIR=$dir/state WD_HEARTBEAT_FILE=$dir/hb WD_LEDGER_FILE=$dir/ledger.jsonl"
# shellcheck disable=SC2086
out1="$(env $env1 bash "$WD" --dry-run 2>&1)" || true
# shellcheck disable=SC2086
out2="$(env $env1 bash "$WD" --dry-run 2>&1)" || true
if echo "$out1" | grep -q "DECISION=ok" && echo "$out2" | grep -q "rate-limited"; then
  ok "second tick within min interval is rate-limited"
else
  bad "rate limit failed (out2: $(echo "$out2" | tail -1))"
fi

dir="$WORK/lock-held"; mkdir -p "$dir/state/tick.lock"; fresh_hb "$dir/hb" "$HB_OK"
# shellcheck disable=SC2086
out="$(env WD_CONFIG=/dev/null WD_TEST_MODE=1 WD_TEST_SESSION_ALIVE=1 WD_TEST_ORCH_PANE=%42 \
      WD_STATE_DIR="$dir/state" WD_HEARTBEAT_FILE="$dir/hb" WD_LEDGER_FILE="$dir/ledger.jsonl" \
      bash "$WD" --dry-run 2>&1)" || true
if echo "$out" | grep -q "single-flight" && ! echo "$out" | grep -q "DECISION="; then
  ok "fresh lock held -> tick exits without acting (single-flight)"
else
  bad "single-flight lock not respected"
fi

dir="$WORK/lock-stale"; mkdir -p "$dir/state/tick.lock"; fresh_hb "$dir/hb" "$HB_OK"
touch -t "$(date -v-30M +%Y%m%d%H%M.%S)" "$dir/state/tick.lock"
out="$(env WD_CONFIG=/dev/null WD_TEST_MODE=1 WD_TEST_SESSION_ALIVE=1 WD_TEST_ORCH_PANE=%42 \
      WD_STATE_DIR="$dir/state" WD_HEARTBEAT_FILE="$dir/hb" WD_LEDGER_FILE="$dir/ledger.jsonl" \
      bash "$WD" --dry-run 2>&1)" || true
if echo "$out" | grep -q "stealing stale" && echo "$out" | grep -q "DECISION=ok"; then
  ok "stale lock (crashed tick) stolen, tick proceeds"
else
  bad "stale lock not stolen"
fi

echo "== route-through-reap + ledger scenarios (GSL-55) =="
# Ordering guarantee: reap BEFORE kill BEFORE orchestrator_restarted.
L="$WORK/stale-after-nudge/ledger.jsonl"
rl="$(grep -n '"event":"reap"' "$L" | head -1 | cut -d: -f1 || true)"
kl="$(grep -n '"event":"kill"' "$L" | head -1 | cut -d: -f1 || true)"
ol="$(grep -n '"event":"orchestrator_restarted"' "$L" | head -1 | cut -d: -f1 || true)"
if [ -n "$rl" ] && [ -n "$kl" ] && [ -n "$ol" ] && [ "$rl" -lt "$kl" ] && [ "$kl" -lt "$ol" ]; then
  ok "ledger order: reap -> kill -> orchestrator_restarted"
else
  bad "ledger order wrong (reap=$rl kill=$kl restart=$ol)"
fi
# Reap snapshot exists and carries the post-mortem sections.
snap="$(ls "$WORK/stale-after-nudge/state/reaps/"*.txt 2>/dev/null | head -1 || true)"
if [ -n "$snap" ] && grep -q "heartbeat tail" "$snap" && grep -q "git snapshot" "$snap"; then
  ok "reap snapshot written (heartbeat tail + git snapshot sections)"
else
  bad "reap snapshot missing or incomplete"
fi
# The ledger reap line preserves branch + HEAD (committed work never silently lost).
if grep '"event":"reap"' "$L" | grep -q '"branch":"' && grep '"event":"reap"' "$L" | grep -q '"head":"'; then
  ok "reap ledger line records branch + HEAD"
else
  bad "reap ledger line missing branch/head"
fi
# Session death takes recorded workers with it -> worker_died on the record.
if grep '"event":"worker_died"' "$WORK/dead-session-fresh-hb/ledger.jsonl" | grep -q '"count":1' \
   && grep -q '"event":"reap"' "$WORK/dead-session-fresh-hb/ledger.jsonl"; then
  ok "dead session -> worker_died(count=1) + reap before restart"
else
  bad "dead session: worker_died/reap missing"
fi
if grep '"event":"worker_died"' "$WORK/mass-death/ledger.jsonl" | grep -q '"count":2'; then
  ok "mass death -> worker_died(count=2) recorded"
else
  bad "mass death: worker_died missing"
fi
# Gates run BEFORE reap: an exhausted budget or a cooldown-deferred kill reaps nothing.
if ! grep -q '"event":"reap"' "$WORK/budget-exhausted/ledger.jsonl" \
   && ! grep -q '"event":"reap"' "$WORK/kill-cooldown-defers/ledger.jsonl" 2>/dev/null; then
  ok "no reap on budget-escalated / cooldown-deferred ticks (gates first)"
else
  bad "reap emitted on a gated tick"
fi

echo "== review-fix scenarios (C1 identity / M1 brief / M2 kill-verify) =="
# --- C1: positive pane identity. The main failure the epic exists for:
# orchestrator pane (%4) dies, a WORKER (%42) is now the first live pane of the
# window. The watchdog must refuse to touch it — never nudge/kill/re-wake a guess.
run_case  c1-orch-dead-worker-lives identity_unverified 1     %42   stale    "$HB_ORPHAN"
run_case  c1-no-pane-field          identity_unverified 1     %42   stale    "$HB_NOPANE"
run_case  c1-invalid-pane-field     identity_unverified 1     %42   fresh    "$HB_BADPANE"
# Startup grace still shields the identity gate (a just-re-woken orchestrator's
# heartbeat still names its dead predecessor's pane until the first write).
CASE_ENV="WD_TEST_SESSION_CREATED=$((NOW - 30))"
run_case  c1-grace-shields-identity ok_grace            1     %42   stale    "$HB_ORPHAN"

L="$WORK/c1-orch-dead-worker-lives/ledger.jsonl"
if grep '"event":"kill_refused"' "$L" | grep -q '"reason":"identity_unverified"' \
   && ! grep -q '"event":"kill"' "$L" \
   && ! grep -q '"event":"nudge"' "$L" \
   && ! grep -q '"event":"orchestrator_restarted"' "$L" \
   && grep -q '"event":"escalation"' "$L"; then
  ok "C1: unverified identity -> kill_refused(identity_unverified) + escalate; NO nudge/kill/re-wake"
else
  bad "C1: identity refusal wrong (worker pane was touched or no escalation)"
fi
if grep '"event":"kill_refused"' "$WORK/c1-orch-dead-worker-lives/ledger.jsonl" | grep -q '"identity":"not_found"' \
   && grep '"event":"kill_refused"' "$WORK/c1-no-pane-field/ledger.jsonl" | grep -q '"identity":"no_field"' \
   && grep '"event":"kill_refused"' "$WORK/c1-invalid-pane-field/ledger.jsonl" | grep -q '"identity":"invalid_field"'; then
  ok "C1: identity detail recorded (not_found / no_field / invalid_field)"
else
  bad "C1: identity detail missing from kill_refused lines"
fi

# --- M1: the re-wake prompt is built FROM the skill's re-wake-brief.md
# (BRIEF-START/END block) with the watchdog placeholders substituted.
P="$WORK/dead-session-fresh-hb/state/rewake-prompt.txt"
if [ -f "$P" ] && grep -q "re-woken automatically by the mechanical watchdog" "$P" \
   && grep -q "The previous orchestrator of $REPO_ROOT is gone (reason: dead_session)" "$P" \
   && grep -q "restart 1/3" "$P"; then
  ok "M1: re-wake prompt built from re-wake-brief.md (PROJECT_DIR/REASON/RESTART_N/BUDGET substituted)"
else
  bad "M1: re-wake prompt not built from the brief template (see $P)"
fi
if [ -f "$P" ] && ! grep -qE '\{\{(PROJECT_DIR|REASON|RESTART_N|RESTART_BUDGET|TS)\}\}' "$P"; then
  ok "M1: no unsubstituted watchdog placeholders remain in the prompt"
else
  bad "M1: unsubstituted placeholders left in the prompt"
fi
if grep -q "restart 3/3" "$WORK/budget-available/state/rewake-prompt.txt" 2>/dev/null; then
  ok "M1: RESTART_N reflects the budget window (3rd restart -> 'restart 3/3')"
else
  bad "M1: RESTART_N wrong for the 3rd in-window restart"
fi
CASE_ENV="WD_REWAKE_BRIEF=/nonexistent/re-wake-brief.md"
run_case  m1-brief-missing-fallback rewake              0     ""    fresh    "$HB_SOLO"
if grep -q '"event":"rewake_brief_missing"' "$WORK/m1-brief-missing-fallback/ledger.jsonl" \
   && grep -q "REPLACEMENT orchestrator" "$WORK/m1-brief-missing-fallback/state/rewake-prompt.txt"; then
  ok "M1: missing brief -> inline fallback + rewake_brief_missing ledger warning"
else
  bad "M1: brief-missing fallback path broken"
fi

# --- M2: a kill that does not stick must NEVER be followed by a re-wake
# (a surviving pane + a fresh orchestrator = two live orchestrators).
CASE_ENV="WD_TEST_KILL_FAILS=1"
run_case  m2-kill-fails-no-rewake   kill_failed         1     %42   stale    "$HB_OK"      seed_old_nudge
L="$WORK/m2-kill-fails-no-rewake/ledger.jsonl"
if grep -q '"event":"kill_failed"' "$L" \
   && ! grep -q '"event":"kill"' "$L" \
   && ! grep -q '"event":"orchestrator_restarted"' "$L" \
   && grep -q '"event":"escalation"' "$L" \
   && grep -q '"event":"reap"' "$L" \
   && [ ! -f "$WORK/m2-kill-fails-no-rewake/state/last-kill.marker" ]; then
  ok "M2: failed kill -> kill_failed + escalate; reap kept, NO re-wake, no last-kill marker"
else
  bad "M2: kill-failure handling wrong (re-wake after failed kill?)"
fi

echo "== side-effect assertions =="
# kill+rewake path must log the kill and the restart to the ledger, dry-run flagged.
if grep -q '"event":"kill"' "$WORK/stale-after-nudge/ledger.jsonl" \
   && grep -q '"event":"orchestrator_restarted"' "$WORK/stale-after-nudge/ledger.jsonl"; then
  ok "ledger records kill + orchestrator_restarted on kill_rewake"
else
  bad "ledger missing kill/orchestrator_restarted events"
fi
if grep -q '"event":"nudge"' "$WORK/stale-first-tick/ledger.jsonl"; then
  ok "ledger records nudge"
else
  bad "ledger missing nudge event"
fi
if [ -f "$WORK/dead-session-fresh-hb/state/last-started.marker" ]; then
  ok "rewake writes last-started marker (startup-grace input)"
else
  bad "rewake did not write last-started marker"
fi
# quiesced must produce NO restart even with a dead session.
if grep -q '"event":"orchestrator_restarted"' "$WORK/quiesced-dead-session/ledger.jsonl" 2>/dev/null; then
  bad "quiesced chain was restarted (must never happen)"
else
  ok "quiesced chain not restarted"
fi

echo "== config validation (must fail LOUDLY) =="
rc=0
out="$(WD_CONFIG=/dev/null WD_TEST_MODE=1 WD_HB_STALE_SECS=abc \
       WD_STATE_DIR="$WORK/badcfg" WD_HEARTBEAT_FILE="$WORK/badcfg-hb" \
       WD_LEDGER_FILE="$WORK/badcfg-ledger" bash "$WD" --dry-run 2>&1)" || rc=$?
if [ "$rc" -eq 78 ] && echo "$out" | grep -q "FATAL CONFIG ERROR"; then
  ok "invalid config -> loud failure (exit 78)"
else
  bad "invalid config: expected exit 78 + FATAL CONFIG ERROR, got rc=$rc"
fi

echo "== plist render =="
rc=0
out="$(bash "$SCRIPT_DIR/install-watchdog.sh" --out "$WORK/render.plist" 2>&1)" || rc=$?
if [ "$rc" -eq 0 ] && [ -f "$WORK/render.plist" ] && ! grep -q "__[A-Z_]*__" "$WORK/render.plist" \
   && echo "$out" | grep -q "launchctl bootstrap"; then
  ok "plist renders, placeholders substituted, instructions printed (nothing installed)"
else
  bad "plist render failed (rc=$rc)"
fi

echo
echo "RESULT: $PASS passed, $FAIL failed (artifacts: $WORK)"
[ "$FAIL" -eq 0 ]
