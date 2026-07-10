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

HB_OK='{"ts":"2026-07-10T03:00:00Z","cycle":12,"context_pct":41,"open_workers":2,"status":"ok"}'
HB_HIGH_CTX='{"ts":"2026-07-10T03:00:00Z","cycle":14,"context_pct":85,"open_workers":2,"status":"ok"}'
HB_QUIESCED='{"ts":"2026-07-10T03:00:00Z","cycle":15,"context_pct":50,"open_workers":0,"status":"quiesced"}'
HB_ROLLING='{"ts":"2026-07-10T03:00:00Z","cycle":15,"context_pct":72,"open_workers":2,"status":"rolling"}'

# run_case NAME EXPECTED_DECISION SESSION_ALIVE PANE HB_KIND HB_JSON [setup-fn]
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
  out="$(
    WD_CONFIG=/dev/null \
    WD_TEST_MODE=1 \
    WD_TEST_SESSION_ALIVE="$alive" \
    WD_TEST_ORCH_PANE="$pane" \
    WD_STATE_DIR="$dir/state" \
    WD_HEARTBEAT_FILE="$dir/hb" \
    WD_LEDGER_FILE="$dir/ledger.jsonl" \
    bash "$WD" --dry-run 2>&1
  )" || rc=$?
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

echo "== decision scenarios (dry-run, injected probes) =="
#         name                      expected            alive pane  hb       json
run_case  ok-fresh-alive            ok                  1     %42   fresh    "$HB_OK"
run_case  dead-session-fresh-hb     rewake              0     ""    fresh    "$HB_OK"
run_case  dead-session-stale-hb     rewake              0     ""    stale    "$HB_OK"
run_case  pane-missing-session-up   rewake              1     ""    fresh    "$HB_OK"
run_case  stale-first-tick          nudged              1     %42   stale    "$HB_OK"
run_case  stale-after-nudge         kill_rewake         1     %42   stale    "$HB_OK"      seed_old_nudge
run_case  missing-hb-alive          nudged              1     %42   missing  ""
run_case  quiesced-dead-session     ok_quiesced         0     ""    fresh    "$HB_QUIESCED"
run_case  rolling-fresh             waiting_successor   0     ""    fresh    "$HB_ROLLING"
run_case  ctx-ceiling-first-tick    handoff_requested   1     %42   fresh    "$HB_HIGH_CTX"
run_case  ctx-ceiling-overdue       kill_rewake         1     %42   fresh    "$HB_HIGH_CTX" seed_old_handoff

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
