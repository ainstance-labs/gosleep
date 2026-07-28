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
stale_hb() { # $1=file $2=json-line  (mtime pushed 2h back — past the GSL-217
             # measured-cadence default WD_HB_STALE_SECS=3900)
  printf '%s\n' "$2" > "$1"
  touch -t "$(date -v-120M +%Y%m%d%H%M.%S)" "$1"
}

# All healthy fixtures carry the C1 identity field: "pane" = the orchestrator's
# own $TMUX_PANE (%42 in tests — matches WD_TEST_ORCH_PANE when it should exist).
HB_OK='{"ts":"2026-07-10T03:00:00Z","cycle":12,"context_pct":41,"open_workers":2,"status":"ok","pane":"%42"}'
HB_SOLO='{"ts":"2026-07-10T03:00:00Z","cycle":12,"context_pct":41,"open_workers":1,"status":"ok","pane":"%42"}'
HB_HIGH_CTX='{"ts":"2026-07-10T03:00:00Z","cycle":14,"context_pct":85,"open_workers":2,"status":"ok","pane":"%42"}'
HB_QUIESCED='{"ts":"2026-07-10T03:00:00Z","cycle":15,"context_pct":50,"open_workers":0,"status":"quiesced","pane":"%42"}'
# GSL-69: the quota-wait form of quiesced — open_workers>0 + reset ETA in note.
# The quiesced gate must hold even with a STALE heartbeat in a LIVE session
# (a limited orchestrator cannot write; nudging/killing it would burn the
# restart budget on re-wakes guaranteed to hit the same limit).
# GSL-65 review M1: the shield is ETA-BOUNDED — fixtures are generated RELATIVE
# to now (a hard-coded ETA would itself expire and flip the expected decision):
# future / past-within-grace ETA -> stand down; ETA past the 900s grace ->
# shield drops, normal tree applies; unparseable ETA -> fail-safe stand-down.
iso_at() { date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ; }  # BSD date (same box as launchd)
QW_ETA_FUTURE="$(iso_at $((NOW + 7200)))"
QW_ETA_RECENT="$(iso_at $((NOW - 300)))"    # past, but inside the default 900s grace
QW_ETA_EXPIRED="$(iso_at $((NOW - 3600)))"  # past the grace: alarm-clock territory
HB_QUOTA_WAIT='{"ts":"2026-07-10T03:00:00Z","cycle":16,"context_pct":55,"open_workers":2,"status":"quiesced","note":"quota-wait until '"$QW_ETA_FUTURE"'","pane":"%42"}'
HB_QUOTA_RECENT='{"ts":"2026-07-10T03:00:00Z","cycle":16,"context_pct":55,"open_workers":2,"status":"quiesced","note":"quota-wait until '"$QW_ETA_RECENT"'","pane":"%42"}'
HB_QUOTA_EXPIRED='{"ts":"2026-07-10T03:00:00Z","cycle":16,"context_pct":55,"open_workers":2,"status":"quiesced","note":"quota-wait until '"$QW_ETA_EXPIRED"'","pane":"%42"}'
HB_QUOTA_EXPIRED_SOLO='{"ts":"2026-07-10T03:00:00Z","cycle":16,"context_pct":55,"open_workers":1,"status":"quiesced","note":"quota-wait until '"$QW_ETA_EXPIRED"'","pane":"%42"}'
HB_QUOTA_BADETA='{"ts":"2026-07-10T03:00:00Z","cycle":16,"context_pct":55,"open_workers":2,"status":"quiesced","note":"quota-wait until soon","pane":"%42"}'
HB_ROLLING='{"ts":"2026-07-10T03:00:00Z","cycle":15,"context_pct":72,"open_workers":2,"status":"rolling","pane":"%42"}'
# C1 fixtures: heartbeat names a pane that no longer exists (%4 — the dead
# orchestrator; the only LIVE pane, %42, is a worker) / carries no pane at all.
HB_ORPHAN='{"ts":"2026-07-10T03:00:00Z","cycle":12,"context_pct":41,"open_workers":2,"status":"ok","pane":"%4"}'
HB_NOPANE='{"ts":"2026-07-10T03:00:00Z","cycle":12,"context_pct":41,"open_workers":2,"status":"ok"}'
HB_BADPANE='{"ts":"2026-07-10T03:00:00Z","cycle":12,"context_pct":41,"open_workers":2,"status":"ok","pane":"orchestrator"}'

# run_case NAME EXPECTED_DECISION SESSION_ALIVE PANE HB_KIND HB_JSON [setup-fn]
# Extra per-case env (e.g. WD_TEST_PROC_ALIVE=0) via global CASE_ENV, cleared after.
# Legacy scenarios run WD_MODE=armed (they exercise the ARMED decision tree in
# dry-run — GSL-212 made observe the production default); CASE_ENV overrides.
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
    WD_MODE=armed \
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

# Tick-to-tick memory is MODE-SCOPED since GSL-212 ($WD_STATE_DIR/<mode>/);
# legacy seeds target the armed dir the legacy scenarios run in.
seed_old_nudge()   { mkdir -p "$1/state/armed"; echo $((NOW - 700)) > "$1/state/armed/nudge.marker"; }
seed_old_handoff() { mkdir -p "$1/state/armed"; echo $((NOW - 700)) > "$1/state/armed/handoff-request.marker"; }

# GSL-53 seeds: restart-budget history + escalation marker
seed_3_recent_restarts() { mkdir -p "$1/state/armed"; { echo $((NOW-300)); echo $((NOW-600)); echo $((NOW-900)); } > "$1/state/armed/restarts.history"; }
seed_2_recent_restarts() { mkdir -p "$1/state/armed"; { echo $((NOW-300)); echo $((NOW-600)); } > "$1/state/armed/restarts.history"; }
seed_3_old_restarts()    { mkdir -p "$1/state/armed"; { echo $((NOW-7200)); echo $((NOW-7300)); echo $((NOW-7400)); } > "$1/state/armed/restarts.history"; }
seed_exhausted_and_escalated() { seed_3_recent_restarts "$1"; echo $((NOW-60)) > "$1/state/armed/escalated.marker"; }
seed_escalated_only()    { mkdir -p "$1/state/armed"; echo $((NOW-60)) > "$1/state/armed/escalated.marker"; }

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
run_case  quota-wait-stale-live     ok_quiesced         1     %42   stale    "$HB_QUOTA_WAIT"
run_case  rolling-fresh             waiting_successor   0     ""    fresh    "$HB_ROLLING"
# GSL-217: the DEFAULT ceiling is 100 (= off, pending GSL-182's real signal);
# these cases pin 80 because they test the MECHANISM, not the default.
CASE_ENV="WD_CONTEXT_CEILING_PCT=80"
run_case  ctx-ceiling-first-tick    handoff_requested   1     %42   fresh    "$HB_HIGH_CTX"
CASE_ENV="WD_CONTEXT_CEILING_PCT=80"
run_case  ctx-ceiling-overdue       kill_rewake         1     %42   fresh    "$HB_HIGH_CTX" seed_old_handoff

echo "== quota-wait ETA backstop (GSL-65 review M1, contract v0.5.1) =="
# Shield holds: ETA within grace / ETA unparseable (fail safe — never kill on a guess).
run_case  quota-eta-recent-live     ok_quiesced         1     %42   stale    "$HB_QUOTA_RECENT"
run_case  quota-eta-unparseable     ok_quiesced         1     %42   stale    "$HB_QUOTA_BADETA"
# Shield drops past ETA + grace: the wake-up the orchestrator armed died under
# the limit (a limited tick cannot re-arm) — the watchdog is the alarm clock.
# Live pane -> ONE nudge first (it lands: the window is open by now); still
# stale after the nudge grace -> kill + re-wake.
run_case  quota-eta-expired-nudge   nudged              1     %42   stale    "$HB_QUOTA_EXPIRED"
run_case  quota-eta-expired-kill    kill_rewake         1     %42   stale    "$HB_QUOTA_EXPIRED" seed_old_nudge
# Dead session past ETA + grace: plain re-wake (1 recorded worker)...
run_case  quota-eta-expired-dead    rewake              0     ""    fresh    "$HB_QUOTA_EXPIRED_SOLO"
# ...but >=2 recorded workers still routes through mass-death (escalate, never blind-restart).
run_case  quota-eta-expired-massd   mass_death          0     ""    fresh    "$HB_QUOTA_EXPIRED"

if grep -q '"event":"quota_wait_expired"' "$WORK/quota-eta-expired-nudge/ledger.jsonl" \
   && grep -q '"event":"nudge"' "$WORK/quota-eta-expired-nudge/ledger.jsonl"; then
  ok "expired ETA -> quota_wait_expired recorded, then the normal nudge path"
else
  bad "expired ETA: quota_wait_expired/nudge missing from ledger"
fi
if ! grep -qE '"event":"(quota_wait_expired|nudge|kill|orchestrator_restarted)"' \
     "$WORK/quota-eta-recent-live/ledger.jsonl" 2>/dev/null \
   && ! grep -qE '"event":"(quota_wait_expired|nudge|kill|orchestrator_restarted)"' \
     "$WORK/quota-eta-unparseable/ledger.jsonl" 2>/dev/null; then
  ok "ETA within grace / unparseable -> shield holds (no expiry event, no action)"
else
  bad "shield broke early (acted on a pending or unparseable ETA)"
fi

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
   && [ -f "$WORK/budget-exhausted/state/armed/escalated.marker" ]; then
  ok "exhausted budget -> escalation, no restart, marker set (F1-S4)"
else
  bad "exhausted budget: expected escalation + no restart + marker"
fi
# Budget available: restart happened, recorded (3 lines now), backoff 4s (n=2).
if grep -q '"event":"orchestrator_restarted"' "$WORK/budget-available/ledger.jsonl" \
   && [ "$(wc -l < "$WORK/budget-available/state/armed/restarts.history" | tr -d ' ')" = "3" ] \
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
if [ ! -f "$WORK/ok-clears-escalated/state/armed/escalated.marker" ]; then
  ok "healthy tick clears escalated marker"
else
  bad "escalated marker not cleared on healthy tick"
fi

echo "== Gastown debounce scenarios (GSL-54) =="
seed_last_started()      { mkdir -p "$1/state/armed"; echo $((NOW - 30)) > "$1/state/armed/last-started.marker"; }
seed_zombie_2()          { mkdir -p "$1/state/armed"; echo 2 > "$1/state/armed/zombie.count"; }
seed_zombie_2_recover()  { mkdir -p "$1/state/armed"; echo 2 > "$1/state/armed/zombie.count"; }
seed_nudged_and_cooldown() { mkdir -p "$1/state/armed"; echo $((NOW - 700)) > "$1/state/armed/nudge.marker"; echo $((NOW - 60)) > "$1/state/armed/last-kill.marker"; }

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

if [ "$(cat "$WORK/zombie-first-cycle/state/armed/zombie.count" 2>/dev/null)" = "1" ]; then
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
if [ ! -f "$WORK/zombie-recovers/state/armed/zombie.count" ]; then
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
   && [ ! -f "$WORK/m2-kill-fails-no-rewake/state/armed/last-kill.marker" ]; then
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
if [ -f "$WORK/dead-session-fresh-hb/state/armed/last-started.marker" ]; then
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
# GSL-69: quota-wait quiesce (open_workers>0, note ETA) with a STALE heartbeat
# in a LIVE session must produce NO nudge, NO kill, NO restart.
if grep -qE '"event":"(nudge|kill|orchestrator_restarted)"' "$WORK/quota-wait-stale-live/ledger.jsonl" 2>/dev/null; then
  bad "quota-wait quiesce was nudged/killed/restarted (must never happen)"
else
  ok "quota-wait quiesce left alone (stale hb + live session)"
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

echo "== GSL-212: platform life-source (claude agents --json) + observe mode =="
# Roster fixtures. cwd must be THIS repo — PLATFORM_REPO_N is the double-dispatch guard.
FIX="$WORK/fixtures"; mkdir -p "$FIX"
cat > "$FIX/agents-ok.json" <<EOF
[{"pid":111,"cwd":"$REPO_ROOT","kind":"interactive","startedAt":1,"sessionId":"sid-orch","name":"gosleep-aa","status":"busy"}]
EOF
cat > "$FIX/agents-other.json" <<EOF
[{"pid":222,"cwd":"$REPO_ROOT","kind":"interactive","startedAt":1,"sessionId":"sid-other","name":"gosleep-bb","status":"busy"}]
EOF
echo "[]" > "$FIX/agents-empty.json"
HB_SESSION_OK='{"ts":"2026-07-10T03:00:00Z","cycle":20,"context_pct":50,"open_workers":1,"status":"ok","pane":"%42","session":"gosleep-aa","session_id":"sid-orch"}'

# (a) Observe is the DEFAULT mode: no WD_MODE anywhere -> mode=observe in the log line.
dir="$WORK/observe-default"; mkdir -p "$dir/state"; fresh_hb "$dir/hb" "$HB_OK"
out="$(env WD_CONFIG=/dev/null WD_TEST_MODE=1 WD_TEST_SESSION_ALIVE=1 WD_TEST_ORCH_PANE=%42 \
      WD_STATE_DIR="$dir/state" WD_HEARTBEAT_FILE="$dir/hb" WD_LEDGER_FILE="$dir/ledger.jsonl" \
      bash "$WD" --dry-run 2>&1)" || true
if echo "$out" | grep -q "DECISION=ok" && echo "$out" | grep -q "mode=observe" \
   && grep -q '"mode":"observe"' "$dir/ledger.jsonl"; then
  ok "observe is the default mode (no config -> mode=observe, ledger stamped)"
else
  bad "observe default broken (out: $(echo "$out" | tail -1))"
fi

# (b) Observe ladder: stale-after-nudge runs the FULL chain but only records it —
# would_kill + would_rewake, no kill/orchestrator_restarted, no last-started marker,
# and the would-restart still burns the OBSERVE budget history (mode-scoped).
seed_old_nudge_observe() { mkdir -p "$1/state/observe"; echo $((NOW - 700)) > "$1/state/observe/nudge.marker"; }
CASE_ENV="WD_MODE=observe"
run_case  observe-stale-after-nudge kill_rewake        1     %42   stale    "$HB_OK"      seed_old_nudge_observe
L="$WORK/observe-stale-after-nudge/ledger.jsonl"
if grep -q '"event":"would_kill"' "$L" && grep -q '"event":"would_rewake"' "$L" \
   && ! grep -q '"event":"kill"' "$L" && ! grep -q '"event":"orchestrator_restarted"' "$L" \
   && [ ! -f "$WORK/observe-stale-after-nudge/state/observe/last-started.marker" ] \
   && [ "$(wc -l < "$WORK/observe-stale-after-nudge/state/observe/restarts.history" | tr -d ' ')" = "1" ]; then
  ok "observe: full kill chain recorded as would_* only; observe budget burned, nothing started"
else
  bad "observe kill chain wrong (see $L)"
fi
if grep -q '"event":"reap"' "$L" && grep -q '"event":"tick"' "$L" \
   && grep '"event":"tick"' "$L" | grep -q '"decision":"kill_rewake"'; then
  ok "observe: reap evidence still collected + per-tick decision line (GSL-220)"
else
  bad "observe: reap/tick line missing"
fi

# (c) Observe first stale tick: would_nudge, nothing sent.
CASE_ENV="WD_MODE=observe"
run_case  observe-stale-first-tick  nudged             1     %42   stale    "$HB_OK"
if grep -q '"event":"would_nudge"' "$WORK/observe-stale-first-tick/ledger.jsonl" \
   && ! grep -q '"event":"nudge"' "$WORK/observe-stale-first-tick/ledger.jsonl"; then
  ok "observe: stale heartbeat -> would_nudge (no send-keys event)"
else
  bad "observe: would_nudge missing"
fi

# (d) Observe context ceiling: would_request_handoff (ceiling pinned — the
# GSL-217 default is 100 = off).
CASE_ENV="WD_MODE=observe WD_CONTEXT_CEILING_PCT=80"
run_case  observe-ctx-ceiling       handoff_requested  1     %42   fresh    "$HB_HIGH_CTX"
if grep -q '"event":"would_request_handoff"' "$WORK/observe-ctx-ceiling/ledger.jsonl"; then
  ok "observe: context ceiling -> would_request_handoff"
else
  bad "observe: would_request_handoff missing"
fi

# (d') GSL-217, the F3 cure: at DEFAULT thresholds a heartbeat with ctx=98 —
# the measured live norm (median 93, max 98) — is healthy and NOTHING fires.
HB_CTX98='{"ts":"2026-07-10T03:00:00Z","cycle":30,"context_pct":98,"open_workers":1,"status":"ok","pane":"%42"}'
CASE_ENV="WD_MODE=observe"
run_case  ctx-default-off           ok                 1     %42   fresh    "$HB_CTX98"
if ! grep -qE '"event":"(would_request_handoff|handoff_requested)"' "$WORK/ctx-default-off/ledger.jsonl" \
   && grep '"event":"tick"' "$WORK/ctx-default-off/ledger.jsonl" | grep -q '"class":"healthy"'; then
  ok "F3 cure: ctx=98 at default config -> healthy, no handoff demand (enforcement waits for GSL-182)"
else
  bad "F3 cure failed: default ceiling still treats the healthy system"
fi

# (e) Roster match by session_id: the declared identity is alive -> ok.
CASE_ENV="WD_TEST_AGENTS_JSON=$FIX/agents-ok.json"
run_case  roster-session-match      ok                 1     %42   fresh    "$HB_SESSION_OK"
if grep '"event":"tick"' "$WORK/roster-session-match/ledger.jsonl" | grep -q '"platform_match":"session_id"'; then
  ok "roster: heartbeat session_id matched against claude agents --json"
else
  bad "roster: session_id match not recorded"
fi

# (f) SESSION MISMATCH (audit F2 cure): declared identity absent from the roster
# while a live session runs in this repo -> refuse everything + escalate; no
# nudge/kill/rewake, would_* included.
CASE_ENV="WD_TEST_AGENTS_JSON=$FIX/agents-other.json WD_MODE=armed"
run_case  roster-session-mismatch   session_mismatch   1     %42   fresh    "$HB_SESSION_OK"
L="$WORK/roster-session-mismatch/ledger.jsonl"
if grep -q '"event":"session_mismatch"' "$L" \
   && ! grep -qE '"event":"(nudge|kill|orchestrator_restarted|would_nudge|would_kill|would_rewake)"' "$L" \
   && grep -q '"event":"escalation"' "$L"; then
  ok "F2 cure: session mismatch -> refuse every action + escalate (no re-wake beside a live session)"
else
  bad "session mismatch handling wrong (see $L)"
fi

# (g) Roster empty (no session anywhere, none in this repo) -> genuinely dead.
# Since GSL-216 a session_id-bearing heartbeat is revived in place first
# (rung 2, would_resume); the LEGACY heartbeat (no session_id) goes straight to
# the cold-start rung — both directions observed, nothing spawned.
CASE_ENV="WD_TEST_AGENTS_JSON=$FIX/agents-empty.json WD_MODE=observe"
run_case  roster-dead-observe       resume             1     %42   fresh    "$HB_SESSION_OK"
if grep -q '"event":"would_resume"' "$WORK/roster-dead-observe/ledger.jsonl" \
   && ! grep -q '"event":"orchestrator_restarted"' "$WORK/roster-dead-observe/ledger.jsonl" \
   && ! grep -q '"event":"orchestrator_resumed"' "$WORK/roster-dead-observe/ledger.jsonl"; then
  ok "roster empty + session_id -> would_resume (observe records, spawns nothing)"
else
  bad "roster-dead observe path wrong"
fi
CASE_ENV="WD_TEST_AGENTS_JSON=$FIX/agents-empty.json WD_MODE=observe"
run_case  roster-dead-legacy-hb     rewake             1     %42   fresh    "$HB_SOLO"
if grep -q '"event":"would_rewake"' "$WORK/roster-dead-legacy-hb/ledger.jsonl"; then
  ok "roster empty + legacy heartbeat (no session_id) -> would_rewake (old two-rung path)"
else
  bad "roster-dead legacy path wrong"
fi

# (h) Roster unreadable -> fail SAFE: platform_unknown, no action at all.
CASE_ENV="WD_TEST_AGENTS_JSON=$FIX/nonexistent.json"
run_case  roster-unavailable        platform_unknown   1     %42   fresh    "$HB_OK"
L="$WORK/roster-unavailable/ledger.jsonl"
if grep -q '"event":"platform_unavailable"' "$L" \
   && ! grep -qE '"event":"(nudge|kill|orchestrator_restarted|would_nudge|would_kill|would_rewake)"' "$L"; then
  ok "roster unavailable -> platform_unknown, nothing acted (never on a guess)"
else
  bad "roster-unavailable path wrong"
fi

# (i) Legacy heartbeat (no session fields) + exactly one roster entry in this
# repo -> cwd_single match keeps the old world working.
CASE_ENV="WD_TEST_AGENTS_JSON=$FIX/agents-ok.json"
run_case  roster-legacy-cwd-single  ok                 1     %42   fresh    "$HB_OK"
if grep '"event":"tick"' "$WORK/roster-legacy-cwd-single/ledger.jsonl" | grep -q '"platform_match":"cwd_single"'; then
  ok "legacy heartbeat (no session field) -> cwd_single roster match"
else
  bad "cwd_single match not recorded"
fi

# (j) Invalid WD_MODE fails loudly (exit 78).
rc=0
out="$(WD_CONFIG=/dev/null WD_TEST_MODE=1 WD_MODE=maybe \
       WD_STATE_DIR="$WORK/badmode" WD_HEARTBEAT_FILE="$WORK/badmode-hb" \
       WD_LEDGER_FILE="$WORK/badmode-ledger" bash "$WD" --dry-run 2>&1)" || rc=$?
if [ "$rc" -eq 78 ] && echo "$out" | grep -q "WD_MODE"; then
  ok "invalid WD_MODE -> loud failure (exit 78)"
else
  bad "invalid WD_MODE: expected exit 78, got rc=$rc"
fi

echo "== GSL-213: frozen-progress detector (cycle+context_pct immobile) =="
# Seed: 19 qualifying ticks with the SAME (cycle=12, ctx=41) as HB_OK, spanning
# >1h. The 20th (this run) crosses WD_FROZEN_TICKS=20 -> progress_frozen fires.
seed_frozen_19() {
  mkdir -p "$1/state/observe"
  local i=0
  while [ "$i" -lt 19 ]; do
    echo "$((NOW - 4000 + i * 200)) 12 41" >> "$1/state/observe/progress.history"
    i=$((i+1))
  done
}
CASE_ENV="WD_MODE=observe"
run_case  frozen-fires              ok                 1     %42   fresh    "$HB_OK"      seed_frozen_19
L="$WORK/frozen-fires/ledger.jsonl"
if grep -q '"event":"progress_frozen"' "$L" \
   && grep '"event":"progress_frozen"' "$L" | grep -q '"ticks":20' \
   && grep '"event":"tick"' "$L" | grep -q '"frozen":1' \
   && [ -f "$WORK/frozen-fires/state/observe/frozen-episode.marker" ]; then
  ok "frozen: 20 immobile ticks over >1h -> progress_frozen + frozen=1 on the tick line"
else
  bad "frozen detector did not fire (see $L)"
fi
# DECISION stays ok — the signal is record-only (it feeds GSL-215, it never acts).
if grep '"event":"tick"' "$L" | grep -q '"decision":"ok"'; then
  ok "frozen: record-only — the decision is still ok, nothing acted"
else
  bad "frozen: the signal acted by itself"
fi

# Movement (a different cycle in the heartbeat) breaks the run and closes an
# open episode with progress_resumed.
seed_frozen_19_and_episode() { seed_frozen_19 "$1"; echo "$NOW" > "$1/state/observe/frozen-episode.marker"; }
HB_MOVED='{"ts":"2026-07-10T03:00:00Z","cycle":13,"context_pct":44,"open_workers":2,"status":"ok","pane":"%42"}'
CASE_ENV="WD_MODE=observe"
run_case  frozen-resumes            ok                 1     %42   fresh    "$HB_MOVED"   seed_frozen_19_and_episode
if grep -q '"event":"progress_resumed"' "$WORK/frozen-resumes/ledger.jsonl" \
   && [ ! -f "$WORK/frozen-resumes/state/observe/frozen-episode.marker" ]; then
  ok "frozen: cycle moved -> progress_resumed, episode marker cleared"
else
  bad "frozen: resume edge broken"
fi

# Span guard: 19 immobile ticks crammed into ~10 min do NOT fire (rapid manual
# ticks cannot fake an hour of standstill).
seed_frozen_19_fast() {
  mkdir -p "$1/state/observe"
  local i=0
  while [ "$i" -lt 19 ]; do
    echo "$((NOW - 600 + i * 30)) 12 41" >> "$1/state/observe/progress.history"
    i=$((i+1))
  done
}
CASE_ENV="WD_MODE=observe"
run_case  frozen-span-guard         ok                 1     %42   fresh    "$HB_OK"      seed_frozen_19_fast
if ! grep -q '"event":"progress_frozen"' "$WORK/frozen-span-guard/ledger.jsonl"; then
  ok "frozen: run without the wall-clock span does not fire (span guard)"
else
  bad "frozen: span guard failed"
fi

# A quiesced tick is a declared stand-down: it must not feed the history, and
# it closes an open episode as run_broken (not as frozen).
seed_frozen_19_and_episode_q() { seed_frozen_19_and_episode "$1"; }
CASE_ENV="WD_MODE=observe"
run_case  frozen-quiesced-breaks    ok_quiesced        0     ""    fresh    "$HB_QUIESCED" seed_frozen_19_and_episode_q
if [ ! -f "$WORK/frozen-quiesced-breaks/state/observe/progress.history" ] \
   && grep '"event":"progress_resumed"' "$WORK/frozen-quiesced-breaks/ledger.jsonl" | grep -q 'run_broken_by_status_quiesced'; then
  ok "frozen: quiesced breaks the run (history reset, episode closed as run_broken)"
else
  bad "frozen: quiesced handling wrong"
fi

echo "== GSL-215: classes healthy/slow/stuck (false-negative bias, ZFC matrix) =="
tick_class() { grep '"event":"tick"' "$WORK/$1/ledger.jsonl" 2>/dev/null | sed -nE 's/.*"class":"([a-z]+)".*/\1/p' | tail -1; }
# 45 min = 2700s: inside the GSL-217 slow zone [1950, 3900) at default thresholds.
age_hb_45m() { touch -t "$(date -v-45M +%Y%m%d%H%M.%S)" "$1/hb"; }

CASE_ENV="WD_MODE=observe"
run_case  class-healthy             ok                 1     %42   fresh    "$HB_OK"
[ "$(tick_class class-healthy)" = "healthy" ] \
  && ok "class: fresh + young + moving -> healthy" || bad "class-healthy: got '$(tick_class class-healthy)'"

# SLOW BY AGE: 45 min old = past the slow mark (1950s = stale/2) but still
# fresh (< 3900s). The decision is ok — record-only is true BY CONSTRUCTION.
CASE_ENV="WD_MODE=observe"
run_case  class-slow-age            ok                 1     %42   fresh    "$HB_OK"      age_hb_45m
if [ "$(tick_class class-slow-age)" = "slow" ] \
   && ! grep -qE '"event":"(nudge|would_nudge|kill|would_kill|orchestrator_restarted|would_rewake)"' "$WORK/class-slow-age/ledger.jsonl"; then
  ok "class: approaching-stale -> slow, and slow NEVER acts (decision stays ok)"
else
  bad "class-slow-age wrong (class=$(tick_class class-slow-age))"
fi

# SLOW BY FROZEN (the F of ZFC): heart beats, work does not — bias keeps it
# out of stuck (better to miss for a tick than to kill a live one).
CASE_ENV="WD_MODE=observe"
run_case  class-slow-frozen         ok                 1     %42   fresh    "$HB_OK"      seed_frozen_19
if [ "$(tick_class class-slow-frozen)" = "slow" ] \
   && grep '"event":"tick"' "$WORK/class-slow-frozen/ledger.jsonl" | grep -q '"class_reason":"progress_frozen"'; then
  ok "class: fresh-but-frozen -> slow (reason progress_frozen), not stuck"
else
  bad "class-slow-frozen wrong (class=$(tick_class class-slow-frozen))"
fi

# STUCK (the Z territory): stale heartbeat with a live platform session.
CASE_ENV="WD_MODE=observe"
run_case  class-stuck               nudged             1     %42   stale    "$HB_OK"
[ "$(tick_class class-stuck)" = "stuck" ] \
  && ok "class: stale + live session -> stuck (the only action zone)" || bad "class-stuck: got '$(tick_class class-stuck)'"

# DEAD (the C of ZFC): the roster lists nothing of ours.
CASE_ENV="WD_MODE=observe"
run_case  class-dead                rewake             0     ""    fresh    "$HB_SOLO"
[ "$(tick_class class-dead)" = "dead" ] \
  && ok "class: no live session in the roster -> dead" || bad "class-dead: got '$(tick_class class-dead)'"

# SHIELDED: a declared stand-down is a class of its own, never a failure.
CASE_ENV="WD_MODE=observe"
run_case  class-shielded            ok_quiesced        0     ""    fresh    "$HB_QUIESCED"
[ "$(tick_class class-shielded)" = "shielded" ] \
  && ok "class: quiesced -> shielded" || bad "class-shielded: got '$(tick_class class-shielded)'"

# UNKNOWN: the watchdog cannot see -> refuse territory, milder than any verdict.
CASE_ENV="WD_TEST_AGENTS_JSON=$FIX/nonexistent.json WD_MODE=observe"
run_case  class-unknown             platform_unknown   1     %42   fresh    "$HB_OK"
[ "$(tick_class class-unknown)" = "unknown" ] \
  && ok "class: unreadable roster -> unknown (never a guess)" || bad "class-unknown: got '$(tick_class class-unknown)'"

# The construction invariant fails LOUDLY: slow >= stale is a config error.
rc=0
out="$(WD_CONFIG=/dev/null WD_TEST_MODE=1 WD_HB_SLOW_SECS=3900 \
       WD_STATE_DIR="$WORK/badslow" WD_HEARTBEAT_FILE="$WORK/badslow-hb" \
       WD_LEDGER_FILE="$WORK/badslow-ledger" bash "$WD" --dry-run 2>&1)" || rc=$?
if [ "$rc" -eq 78 ] && echo "$out" | grep -q "record-only"; then
  ok "class: WD_HB_SLOW_SECS >= stale refused at startup (exit 78)"
else
  bad "class: slow>=stale config accepted (rc=$rc)"
fi

echo "== GSL-216: the ladder nudge -> resume -> restart (shared budget, attempt audit) =="
seed_resume_old_observe()   { mkdir -p "$1/state/observe"; echo $((NOW - 700)) > "$1/state/observe/resume-attempt.marker"; }
seed_resume_fresh_observe() { mkdir -p "$1/state/observe"; echo $((NOW - 60)) > "$1/state/observe/resume-attempt.marker"; }
seed_3_recent_restarts_observe() { mkdir -p "$1/state/observe"; { echo $((NOW-300)); echo $((NOW-600)); echo $((NOW-900)); } > "$1/state/observe/restarts.history"; }
seed_ladder_budget() { seed_old_nudge_observe "$1"; seed_3_recent_restarts_observe "$1"; }

# Rung 2: nudge grace expired + the heartbeat NAMED its session_id -> the same
# session is revived in place (claude --resume), not replaced.
CASE_ENV="WD_TEST_AGENTS_JSON=$FIX/agents-ok.json WD_MODE=observe"
run_case  ladder-rung2-resume       kill_resume        1     %42   stale    "$HB_SESSION_OK" seed_old_nudge_observe
L="$WORK/ladder-rung2-resume/ledger.jsonl"
if grep -q '"event":"would_resume"' "$L" \
   && grep '"event":"would_resume"' "$L" | grep -q '"session_id":"sid-orch"' \
   && grep '"event":"would_resume"' "$L" | grep -q '"attempt":1' \
   && ! grep -q '"event":"would_rewake"' "$L" \
   && [ -f "$WORK/ladder-rung2-resume/state/observe/resume-attempt.marker" ] \
   && [ "$(wc -l < "$WORK/ladder-rung2-resume/state/observe/restarts.history" | tr -d ' ')" = "1" ]; then
  ok "ladder rung 2: stale-after-nudge + session_id -> would_resume (same brain), budget spent, attempt journaled"
else
  bad "ladder rung 2 wrong (see $L)"
fi

# Rung 3: the resume grace expired too -> cold-start restart from the handoff.
CASE_ENV="WD_TEST_AGENTS_JSON=$FIX/agents-ok.json WD_MODE=observe"
run_case  ladder-rung3-restart      kill_rewake        1     %42   stale    "$HB_SESSION_OK" seed_resume_old_observe
if grep -q '"event":"would_rewake"' "$WORK/ladder-rung3-restart/ledger.jsonl" \
   && grep '"event":"tick"' "$WORK/ladder-rung3-restart/ledger.jsonl" | grep -q '"reason":"stale_after_resume"' \
   && [ ! -f "$WORK/ladder-rung3-restart/state/observe/resume-attempt.marker" ]; then
  ok "ladder rung 3: stale-after-resume -> would_rewake (fresh brain), episode marker cleared"
else
  bad "ladder rung 3 wrong"
fi

# Between rungs: a fresh resume attempt is WAITED on, not piled on.
CASE_ENV="WD_TEST_AGENTS_JSON=$FIX/agents-ok.json WD_MODE=observe"
run_case  ladder-waiting-resume     waiting_resume     1     %42   stale    "$HB_SESSION_OK" seed_resume_fresh_observe
if ! grep -qE '"event":"(would_kill|would_resume|would_rewake)"' "$WORK/ladder-waiting-resume/ledger.jsonl"; then
  ok "ladder: inside the resume grace -> waiting, no new attempt"
else
  bad "ladder: piled a new attempt inside the resume grace"
fi

# Dead session + session_id: revive the same session first (no kill — there is
# nothing to kill), cold-start only if the resume attempt did not take.
CASE_ENV="WD_TEST_AGENTS_JSON=$FIX/agents-empty.json WD_MODE=observe"
run_case  ladder-dead-resume        resume             1     %42   fresh    "$HB_SESSION_OK"
L="$WORK/ladder-dead-resume/ledger.jsonl"
if grep -q '"event":"would_resume"' "$L" && ! grep -q '"event":"would_kill"' "$L" \
   && ! grep -q '"event":"would_rewake"' "$L"; then
  ok "ladder: dead session + session_id -> would_resume first (no kill, no cold-start yet)"
else
  bad "ladder dead-resume wrong (see $L)"
fi

# The RestartBudget is SHARED across rungs: an exhausted budget blocks a resume
# exactly like a restart — a resume loop is as much a masked bug.
CASE_ENV="WD_TEST_AGENTS_JSON=$FIX/agents-ok.json WD_MODE=observe"
run_case  ladder-budget-shared      escalated          1     %42   stale    "$HB_SESSION_OK" seed_ladder_budget
if ! grep -qE '"event":"(would_resume|would_rewake)"' "$WORK/ladder-budget-shared/ledger.jsonl" \
   && grep -q '"event":"escalation"' "$WORK/ladder-budget-shared/ledger.jsonl"; then
  ok "ladder: exhausted budget blocks the resume rung too (escalate, no attempt)"
else
  bad "ladder: budget not shared with the resume rung"
fi

echo "== GSL-219: CLI version per heartbeat line; change becomes an event =="
HB_CLI_A='{"ts":"2026-07-10T03:00:00Z","cycle":40,"context_pct":50,"open_workers":1,"status":"ok","pane":"%42","cli":"2.1.219"}'
seed_old_cli() { mkdir -p "$1/state/observe"; echo "2.1.218" > "$1/state/observe/last-cli"; }

# First sighting: remembered, no event (a change needs a predecessor).
CASE_ENV="WD_MODE=observe"
run_case  cli-first-seen            ok                 1     %42   fresh    "$HB_CLI_A"
if [ "$(cat "$WORK/cli-first-seen/state/observe/last-cli" 2>/dev/null)" = "2.1.219" ] \
   && ! grep -q '"event":"cli_version_changed"' "$WORK/cli-first-seen/ledger.jsonl" \
   && grep '"event":"tick"' "$WORK/cli-first-seen/ledger.jsonl" | grep -q '"cli":"2.1.219"'; then
  ok "cli: first sighting remembered, no event, version on the tick line"
else
  bad "cli first-sighting wrong"
fi

# Version moved between lines -> cli_version_changed(old, new). The audit's
# live example: the machine moved 2.1.218 -> 2.1.219 -> 2.1.220 unnoticed.
CASE_ENV="WD_MODE=observe"
run_case  cli-change                ok                 1     %42   fresh    "$HB_CLI_A"   seed_old_cli
if grep '"event":"cli_version_changed"' "$WORK/cli-change/ledger.jsonl" | grep -q '"old":"2.1.218"' \
   && grep '"event":"cli_version_changed"' "$WORK/cli-change/ledger.jsonl" | grep -q '"new":"2.1.219"' \
   && [ "$(cat "$WORK/cli-change/state/observe/last-cli")" = "2.1.219" ]; then
  ok "cli: version change between lines -> cli_version_changed event, memory updated"
else
  bad "cli change detection wrong"
fi

echo "== GSL-211: armed-check — the supervisor reality gate =="
AC="$REPO_ROOT/tools/lab/armed-check.sh"
if bash -n "$AC"; then ok "armed-check bash -n (syntax)"; else bad "armed-check syntax"; fi
if grep -qE 'claude (-p|--print)|api\.anthropic|ANTHROPIC_API_KEY=' "$AC"; then
  bad "armed-check 0-LLM check: found a headless/API call"
else
  ok "armed-check 0-LLM check (roster read only)"
fi
ACW="$WORK/armed-check"; mkdir -p "$ACW"
# A healthy fixture world: heartbeat whose identity IS in the roster, sane
# cadence (3 lines ~600s apart, fresh), no conf, no plist -> green, "unarmed".
cat > "$ACW/roster.json" <<EOF
[{"pid":1,"cwd":"$REPO_ROOT","kind":"interactive","startedAt":1,"sessionId":"sid-live","name":"gosleep-live","status":"busy"}]
EOF
hb_iso() { date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ; }
{ printf '{"ts":"%s","cycle":1,"context_pct":10,"open_workers":0,"status":"ok","pane":"%%1","session":"gosleep-live","session_id":"sid-live"}\n' "$(hb_iso $((NOW-1200)))"
  printf '{"ts":"%s","cycle":2,"context_pct":11,"open_workers":0,"status":"ok","pane":"%%1","session":"gosleep-live","session_id":"sid-live"}\n' "$(hb_iso $((NOW-600)))"
  printf '{"ts":"%s","cycle":3,"context_pct":12,"open_workers":0,"status":"ok","pane":"%%1","session":"gosleep-live","session_id":"sid-live"}\n' "$(hb_iso "$NOW")"
} > "$ACW/hb-good"
rc=0
GOSLEEP_HB_FILE="$ACW/hb-good" GOSLEEP_AGENTS_JSON="$ACW/roster.json" \
  GOSLEEP_WATCHDOG_PLIST="$ACW/no-plist" GOSLEEP_GATES_DIR="$ACW/gates-good" \
  bash "$AC" >/dev/null 2>&1 || rc=$?
if [ "$rc" -eq 0 ] \
   && python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); assert r["verdict"]=="unarmed" and r["fail"]==0 and r["gate"]=="armed-check" and any(c["name"]=="session" and c["state"]=="pass" for c in r["checks"])' "$ACW/gates-good/armed-check.json" 2>/dev/null; then
  ok "armed-check green on a consistent world: verdict=unarmed (a fact, not a failure), receipt in gates shape"
else
  bad "armed-check green path wrong (rc=$rc, see $ACW/gates-good)"
fi
# THE ACCEPTANCE RED: the same world but the heartbeat declares an ALIEN session
# -> session check fails, exit 1, verdict misconfigured. This is F2 caught in
# seconds instead of at 03:00.
sed 's/gosleep-live/gosleep-alien/; s/sid-live/sid-alien/' "$ACW/hb-good" > "$ACW/hb-alien"
rc=0
GOSLEEP_HB_FILE="$ACW/hb-alien" GOSLEEP_AGENTS_JSON="$ACW/roster.json" \
  GOSLEEP_WATCHDOG_PLIST="$ACW/no-plist" GOSLEEP_GATES_DIR="$ACW/gates-alien" \
  bash "$AC" >/dev/null 2>&1 || rc=$?
if [ "$rc" -eq 1 ] \
   && python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); assert r["verdict"]=="misconfigured" and any(c["name"]=="session" and c["state"]=="fail" for c in r["checks"])' "$ACW/gates-alien/armed-check.json" 2>/dev/null; then
  ok "armed-check RED on an alien session name: exit 1, verdict=misconfigured (F2 caught in seconds)"
else
  bad "armed-check alien-session path wrong (rc=$rc)"
fi
# Cadence guard: a threshold below the real cadence is refused (the F3 shape).
echo 'WD_HB_STALE_SECS=300' > "$ACW/conf-tight"
rc=0
GOSLEEP_HB_FILE="$ACW/hb-good" GOSLEEP_AGENTS_JSON="$ACW/roster.json" \
  GOSLEEP_WATCHDOG_PLIST="$ACW/no-plist" GOSLEEP_GATES_DIR="$ACW/gates-cad" \
  WD_CONFIG="$ACW/conf-tight" bash "$AC" >/dev/null 2>&1 || rc=$?
if [ "$rc" -eq 1 ] \
   && python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); assert any(c["name"]=="cadence" and c["state"]=="fail" for c in r["checks"])' "$ACW/gates-cad/armed-check.json" 2>/dev/null; then
  ok "armed-check RED on a threshold below the measured cadence (F3 caught before arming)"
else
  bad "armed-check cadence guard wrong (rc=$rc)"
fi
# Armed conf + plist present -> verdict "armed" (the tile's green word).
echo 'WD_MODE=armed' > "$ACW/conf-armed"; : > "$ACW/plist-present"
rc=0
GOSLEEP_HB_FILE="$ACW/hb-good" GOSLEEP_AGENTS_JSON="$ACW/roster.json" \
  GOSLEEP_WATCHDOG_PLIST="$ACW/plist-present" GOSLEEP_GATES_DIR="$ACW/gates-armed" \
  WD_CONFIG="$ACW/conf-armed" bash "$AC" >/dev/null 2>&1 || rc=$?
if [ "$rc" -eq 0 ] \
   && python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); assert r["verdict"]=="armed" and r["mode"]=="armed" and r["scheduled"] is True' "$ACW/gates-armed/armed-check.json" 2>/dev/null; then
  ok "armed-check: armed conf + scheduled plist -> verdict=armed"
else
  bad "armed-check armed verdict wrong (rc=$rc)"
fi

echo "== GSL-212: heartbeat writer (tools/lab/heartbeat.sh) =="
HBW="$REPO_ROOT/tools/lab/heartbeat.sh"
if bash -n "$HBW"; then ok "heartbeat.sh bash -n (syntax)"; else bad "heartbeat.sh syntax"; fi
HT="$WORK/hb-writer"; mkdir -p "$HT"
cat > "$HT/roster.json" <<EOF
[{"pid":1,"cwd":"$REPO_ROOT","kind":"interactive","startedAt":1,"sessionId":"sid-me","name":"gosleep-xx","status":"busy"}]
EOF
# session identity derived from the roster by the writer's own session id
line="$(GOSLEEP_HB_FILE="$HT/hb" GOSLEEP_AGENTS_JSON="$HT/roster.json" CLAUDE_CODE_SESSION_ID=sid-me \
  bash "$HBW" --cycle 5 --context-pct 42 --open-workers 2 --note "smoke" 2>/dev/null)"
if printf '%s' "$line" | python3 -c 'import json,sys; r=json.load(sys.stdin); assert r["session"]=="gosleep-xx" and r["session_id"]=="sid-me" and r["cycle"]==5 and r["context_pct"]==42 and r["status"]=="ok"' 2>/dev/null; then
  ok "writer derives session/session_id from the roster (never typed by hand)"
else
  bad "writer session derivation wrong: $line"
fi
# unknown own sid -> cwd_single fallback still resolves the repo's only session
line="$(GOSLEEP_HB_FILE="$HT/hb" GOSLEEP_AGENTS_JSON="$HT/roster.json" CLAUDE_CODE_SESSION_ID=sid-child \
  bash "$HBW" --cycle 6 --context-pct 43 --open-workers 2 2>/dev/null)"
if printf '%s' "$line" | grep -q '"session":"gosleep-xx"'; then
  ok "writer falls back to cwd_single for a child/unknown session id"
else
  bad "cwd_single fallback broken: $line"
fi
# empty roster -> fields omitted, line still written (honest degrade, never a refusal to beat)
line="$(GOSLEEP_HB_FILE="$HT/hb" GOSLEEP_AGENTS_JSON="-" \
  bash "$HBW" --cycle 7 --context-pct 44 --open-workers 0 --status quiesced --mode night 2>/dev/null)"
if printf '%s' "$line" | grep -q '"status":"quiesced"' && ! printf '%s' "$line" | grep -q '"session"'; then
  ok "writer degrades honestly on an empty roster (no session fields, line written)"
else
  bad "empty-roster degrade wrong: $line"
fi
# atomic self-truncation at 200 lines, no temp leftover
: > "$HT/hb-trunc"; i=1; while [ "$i" -le 205 ]; do echo "{\"cycle\":$i}" >> "$HT/hb-trunc"; i=$((i+1)); done
GOSLEEP_HB_FILE="$HT/hb-trunc" GOSLEEP_AGENTS_JSON="-" \
  bash "$HBW" --cycle 206 --context-pct 1 --open-workers 0 >/dev/null 2>&1
if [ "$(wc -l < "$HT/hb-trunc" | tr -d ' ')" = "200" ] && [ ! -f "$HT/hb-trunc.tmp" ]; then
  ok "writer self-truncates to 200 lines, atomic (no .tmp leftover)"
else
  bad "self-truncation wrong ($(wc -l < "$HT/hb-trunc") lines)"
fi
# validation fails loudly
if ! bash "$HBW" --cycle x --context-pct 1 --open-workers 0 >/dev/null 2>&1 \
   && ! bash "$HBW" --cycle 1 --context-pct 101 --open-workers 0 >/dev/null 2>&1 \
   && ! bash "$HBW" --cycle 1 --context-pct 1 --open-workers 0 --status wat >/dev/null 2>&1; then
  ok "writer rejects bad cycle/context_pct/status (exit 2)"
else
  bad "writer validation too permissive"
fi
# GSL-219: every line carries the CLI version; override wins, default resolves.
line="$(GOSLEEP_HB_FILE="$HT/hb" GOSLEEP_AGENTS_JSON="-" GOSLEEP_CLI_VERSION=9.9.9 \
  bash "$HBW" --cycle 8 --context-pct 1 --open-workers 0 2>/dev/null)"
if printf '%s' "$line" | grep -q '"cli":"9.9.9"'; then
  ok "writer stamps the cli field (override honoured)"
else
  bad "writer cli override wrong: $line"
fi
line="$(GOSLEEP_HB_FILE="$HT/hb" GOSLEEP_AGENTS_JSON="-" \
  bash "$HBW" --cycle 9 --context-pct 1 --open-workers 0 2>/dev/null)"
if printf '%s' "$line" | grep -qE '"cli":"[0-9]+\.[0-9]+\.[0-9]+"'; then
  ok "writer resolves the running CLI version by default (EXECPATH/--version)"
else
  bad "writer default cli resolution wrong: $line"
fi

# 0-LLM: the only claude invocation is the local roster read
if grep -qE 'claude (-p|--print)|api\.anthropic|ANTHROPIC_API_KEY=' "$HBW"; then
  bad "heartbeat.sh 0-LLM check: found a headless/API call"
else
  ok "heartbeat.sh 0-LLM check (roster read only)"
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
