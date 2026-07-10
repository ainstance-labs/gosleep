#!/usr/bin/env bash
# =============================================================================
# gosleep watchdog — mechanical (non-LLM) supervisor ABOVE the orchestrator.
#
# GSL-49 / PRD Phase 1 (docs/prd/PRD-gosleep-evolution.md), requirement R1.2.
# Consumer of the heartbeat protocol defined in
# skill/orchestrating-delivery-agents/SKILL.md ("Heartbeat protocol").
#
# Contract (must match the skill text — the orchestrator knows these rules):
#   * Liveness is judged from DURABLE ON-DISK STATE ONLY (heartbeat file mtime
#     + last parseable line), cross-checked against tmux session liveness.
#     Never from pane-content scraping, never from a single store. (C7)
#   * fresh heartbeat + dead session  = dead        -> re-wake
#   * stale heartbeat + live session  = divergence  -> ONE nudge first;
#     still stale after the nudge grace -> kill (EXPLICIT pane id only) + re-wake
#   * context_pct >= ceiling          -> send-keys "write handoff now";
#     handoff overdue -> kill + re-wake (fresh orchestrator reads the handoff)
#   * status:"quiesced"               -> chain deliberately ended, NEVER restart
#   * status:"rolling" + fresh hb     -> successor expected, wait
#   * Re-wake = the EXISTING cold-start protocol (re-attach to live workers,
#     never respawn them). This script contains ZERO LLM calls; the only
#     `claude` invocation is spawning the interactive replacement orchestrator.
#
# Safety invariants:
#   * kill only by explicit resolved pane id matching ^%[0-9]+$ —
#     NEVER kill-pane -a (2026-07-07 lesson: -a killed a live fleet).
#   * No launchctl / system mutation here. Installation is the owner's call
#     (see install-watchdog.sh, which only renders files + prints instructions).
#
# Usage:
#   watchdog.sh [--dry-run] [--config PATH] [--help]
#
# Config precedence: config file > environment (WD_*) > built-in defaults.
# All knobs documented in watchdog.conf.example. Invalid config fails LOUDLY
# at startup (exit 78 / EX_CONFIG) — a mis-armed watchdog is worse than none.
# =============================================================================

set -euo pipefail

WD_VERSION="0.1.0 (GSL-52)"
EX_CONFIG=78

# --- CLI -----------------------------------------------------------------
DRY_RUN=0
CLI_CONFIG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --config)  shift; CLI_CONFIG="${1:-}" ;;
    --help|-h)
      sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "watchdog: unknown argument: $1" >&2; exit "$EX_CONFIG" ;;
  esac
  shift
done

# --- locate repo root ----------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${WD_REPO_ROOT:="$(cd "$SCRIPT_DIR/../.." && pwd)"}"

# --- config: file > env > defaults ----------------------------------------
CONFIG_FILE="${CLI_CONFIG:-${WD_CONFIG:-"$SCRIPT_DIR/watchdog.conf"}}"
if [ -f "$CONFIG_FILE" ] && [ "$CONFIG_FILE" != "/dev/null" ]; then
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
fi

# Paths (heartbeat path is fixed by the skill contract; overridable for tests)
: "${WD_HEARTBEAT_FILE:="$WD_REPO_ROOT/docs/handoff/.orchestrator-heartbeat"}"
: "${WD_LEDGER_FILE:="$WD_REPO_ROOT/docs/handoff/.watchdog-ledger.jsonl"}"
: "${WD_STATE_DIR:="$WD_REPO_ROOT/.artifacts/watchdog"}"

# tmux topology (Agent Teams = orchestrator + worker split panes, one session)
: "${WD_TMUX_SESSION:="gosleep"}"
: "${WD_ORCH_PANE_TARGET:="${WD_TMUX_SESSION}:0.0"}"   # fallback resolver
: "${WD_ORCH_WINDOW_NAME:="orchestrator"}"             # preferred resolver
: "${WD_TMUX_BIN:="tmux"}"
: "${WD_CLAUDE_BIN:="claude"}"

# Thresholds (seconds / percent) — every one config-overridable
: "${WD_HB_STALE_SECS:=900}"        # heartbeat older than this = stale (pulse is 5-10 min)
: "${WD_NUDGE_GRACE_SECS:=240}"     # after a nudge, how long before kill+re-wake
: "${WD_CONTEXT_CEILING_PCT:=80}"   # orchestrator self-rolls at ~70%; watchdog forces above that
: "${WD_HANDOFF_WAIT_SECS:=600}"    # after "write handoff now", how long before kill+re-wake

# Test-mode probe injection (smoke tests only; forces dry-run for safety)
: "${WD_TEST_MODE:=0}"
: "${WD_TEST_SESSION_ALIVE:=0}"
: "${WD_TEST_ORCH_PANE:=}"

if [ "$WD_TEST_MODE" = "1" ]; then
  DRY_RUN=1
fi

# --- helpers ---------------------------------------------------------------
now_epoch() { date +%s; }
iso_ts()    { date -u +%Y-%m-%dT%H:%M:%SZ; }

die_config() {
  echo "watchdog: FATAL CONFIG ERROR: $*" >&2
  echo "watchdog: refusing to arm with invalid config (a mis-armed watchdog is worse than none)." >&2
  exit "$EX_CONFIG"
}

is_uint() { [[ "${1:-}" =~ ^[0-9]+$ ]]; }

validate_config() {
  local k
  for k in WD_HB_STALE_SECS WD_NUDGE_GRACE_SECS WD_CONTEXT_CEILING_PCT WD_HANDOFF_WAIT_SECS; do
    is_uint "${!k}" || die_config "$k must be a non-negative integer, got: '${!k}'"
  done
  [ "$WD_CONTEXT_CEILING_PCT" -le 100 ] || die_config "WD_CONTEXT_CEILING_PCT must be <= 100"
  [ -n "$WD_TMUX_SESSION" ] || die_config "WD_TMUX_SESSION must not be empty"
  [ -d "$WD_REPO_ROOT" ] || die_config "WD_REPO_ROOT does not exist: $WD_REPO_ROOT"
  if [ "$WD_TEST_MODE" != "1" ]; then
    command -v "$WD_TMUX_BIN" >/dev/null 2>&1 || die_config "tmux binary not found: $WD_TMUX_BIN"
  fi
}

file_mtime() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null; }

log() {
  local line
  line="$(iso_ts) $*"
  echo "$line"
  echo "$line" >> "$WD_STATE_DIR/watchdog.log" 2>/dev/null || true
}

# Minimal JSON string escaping for values we compose (quotes + backslashes)
json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

# ledger_emit EVENT key=value [key=value ...]
# Appends ONE JSON line to the watchdog ledger (append-only; never truncated).
ledger_emit() {
  local event="$1"; shift
  local json="{\"ts\":\"$(iso_ts)\",\"event\":\"$(json_escape "$event")\""
  local kv k v
  for kv in "$@"; do
    k="${kv%%=*}"; v="${kv#*=}"
    if is_uint "$v"; then
      json="$json,\"$k\":$v"
    else
      json="$json,\"$k\":\"$(json_escape "$v")\""
    fi
  done
  json="$json,\"dry_run\":$DRY_RUN}"
  printf '%s\n' "$json" >> "$WD_LEDGER_FILE"
}

# --- markers (tick-to-tick memory in state dir) ----------------------------
marker_path()  { echo "$WD_STATE_DIR/$1.marker"; }
marker_read()  { cat "$(marker_path "$1")" 2>/dev/null || echo ""; }
marker_write() { echo "$(now_epoch)" > "$(marker_path "$1")"; }
marker_clear() { rm -f "$(marker_path "$1")"; }
marker_age() {
  local v; v="$(marker_read "$1")"
  if is_uint "$v"; then echo $(( $(now_epoch) - v )); else echo ""; fi
}

# --- heartbeat reading -----------------------------------------------------
HB_EXISTS=0 HB_AGE="" HB_LAST="" HB_STATUS="" HB_CTX="" HB_WORKERS="" HB_CYCLE=""

hb_field_int() { printf '%s' "$HB_LAST" | sed -nE "s/.*\"$1\"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p"; }
hb_field_str() { printf '%s' "$HB_LAST" | sed -nE "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/p"; }

read_heartbeat() {
  if [ -f "$WD_HEARTBEAT_FILE" ]; then
    HB_EXISTS=1
    local mt; mt="$(file_mtime "$WD_HEARTBEAT_FILE")"
    if is_uint "$mt"; then
      HB_AGE=$(( $(now_epoch) - mt )); [ "$HB_AGE" -lt 0 ] && HB_AGE=0
    else
      HB_AGE=""
    fi
    HB_LAST="$(tail -n 1 "$WD_HEARTBEAT_FILE" 2>/dev/null || true)"
    HB_STATUS="$(hb_field_str status)"
    HB_CTX="$(hb_field_int context_pct)"
    HB_WORKERS="$(hb_field_int open_workers)"
    HB_CYCLE="$(hb_field_int cycle)"
  fi
}

hb_is_fresh() { [ "$HB_EXISTS" = "1" ] && is_uint "$HB_AGE" && [ "$HB_AGE" -lt "$WD_HB_STALE_SECS" ]; }

# --- tmux probes (injectable in test mode) ---------------------------------
probe_session_alive() {
  if [ "$WD_TEST_MODE" = "1" ]; then [ "$WD_TEST_SESSION_ALIVE" = "1" ]; return; fi
  "$WD_TMUX_BIN" has-session -t "$WD_TMUX_SESSION" 2>/dev/null
}

# Resolve the orchestrator pane to an EXPLICIT pane id (%N).
# Order: (1) first pane of the window named $WD_ORCH_WINDOW_NAME,
#        (2) the configured $WD_ORCH_PANE_TARGET.
resolve_orch_pane() {
  if [ "$WD_TEST_MODE" = "1" ]; then echo "$WD_TEST_ORCH_PANE"; return 0; fi
  local pane=""
  pane="$("$WD_TMUX_BIN" list-panes -t "${WD_TMUX_SESSION}:${WD_ORCH_WINDOW_NAME}" \
            -F '#{pane_id}' 2>/dev/null | head -n 1 || true)"
  if [ -z "$pane" ]; then
    pane="$("$WD_TMUX_BIN" display-message -p -t "$WD_ORCH_PANE_TARGET" '#{pane_id}' 2>/dev/null || true)"
  fi
  echo "$pane"
}

# --- actions (dry-run aware) ------------------------------------------------
act_send_text() { # $1=pane $2=text
  if [ "$DRY_RUN" = "1" ]; then
    log "[dry-run] would send-keys to $1: $2"
    return 0
  fi
  "$WD_TMUX_BIN" send-keys -t "$1" -l "$2"
  "$WD_TMUX_BIN" send-keys -t "$1" Enter
}

act_nudge() { # $1=pane
  local msg="[watchdog $(iso_ts)] heartbeat is stale (age=${HB_AGE:-none}s > ${WD_HB_STALE_SECS}s). Append a heartbeat line NOW (Heartbeat protocol) and re-arm your pulse. Next stale tick = kill + re-wake."
  act_send_text "$1" "$msg"
  ledger_emit "nudge" "target=$1" "reason=stale_heartbeat" "hb_age=${HB_AGE:-0}"
}

act_request_handoff() { # $1=pane
  local msg="[watchdog $(iso_ts)] context_pct=${HB_CTX}% >= ceiling ${WD_CONTEXT_CEILING_PCT}%. Follow the roll protocol NOW: update STATE, write a dated handoff, append a status:\"rolling\" heartbeat, start your successor, exit. Overdue in ${WD_HANDOFF_WAIT_SECS}s = kill + re-wake from the handoff."
  act_send_text "$1" "$msg"
  ledger_emit "handoff_requested" "target=$1" "context_pct=${HB_CTX}" "ceiling=$WD_CONTEXT_CEILING_PCT"
}

act_kill() { # $1=pane — EXPLICIT id only; refuses anything else. NEVER -a.
  local pane="$1"
  if ! [[ "$pane" =~ ^%[0-9]+$ ]]; then
    log "REFUSING kill: '$pane' is not an explicit pane id (%N). kill-pane -a is forbidden."
    ledger_emit "kill_refused" "target=$pane" "reason=not_explicit_pane_id"
    return 1
  fi
  if [ "$DRY_RUN" = "1" ]; then
    log "[dry-run] would kill-pane -t $pane (explicit id)"
  else
    "$WD_TMUX_BIN" kill-pane -t "$pane"
  fi
  ledger_emit "kill" "target=$pane" "reason=${DECISION_REASON:-unspecified}"
}

build_rewake_prompt() {
  local prompt_file="$WD_STATE_DIR/rewake-prompt.txt"
  cat > "$prompt_file" <<EOF
You are a REPLACEMENT orchestrator, re-woken by the mechanical watchdog (tools/watchdog/watchdog.sh) at $(iso_ts). Reason: ${DECISION_REASON:-unknown}.
Follow the orchestrating-delivery-agents skill, section "Recovering / cold-starting an in-progress chain", exactly:
1. Read ORCHESTRATION-STATE.md AND the highest-numbered docs/handoff/NN-*.md FIRST (on-disk before any live probes).
2. Read the watchdog ledger tail: $WD_LEDGER_FILE (your predecessor's death and this restart are recorded there). Append a CORRECTION/restart note to the STATE log.
3. Confirm reality: tmux list-panes, git log/status, gh pr list, tracker.
4. RE-ATTACH to live workers — do NOT respawn or duplicate them; never spawn until every pane is positively accounted for.
5. Append your first heartbeat line right after orientation (you are inside the startup-grace window; your first write ends it).
EOF
  echo "$prompt_file"
}

act_rewake() {
  local prompt_file launcher
  prompt_file="$(build_rewake_prompt)"
  # A generated launcher avoids fragile nested quoting through tmux's sh -c.
  launcher="$WD_STATE_DIR/rewake-launch.sh"
  cat > "$launcher" <<EOF
#!/usr/bin/env bash
cd "$WD_REPO_ROOT" || exit 1
exec "$WD_CLAUDE_BIN" "\$(cat "$prompt_file")"
EOF
  chmod +x "$launcher"
  if [ "$DRY_RUN" = "1" ]; then
    log "[dry-run] would re-wake orchestrator via cold-start (session=$WD_TMUX_SESSION, window=$WD_ORCH_WINDOW_NAME, launcher=$launcher)"
  else
    if probe_session_alive; then
      "$WD_TMUX_BIN" new-window -t "$WD_TMUX_SESSION" -n "$WD_ORCH_WINDOW_NAME" \
        -c "$WD_REPO_ROOT" "$launcher"
    else
      "$WD_TMUX_BIN" new-session -d -s "$WD_TMUX_SESSION" -n "$WD_ORCH_WINDOW_NAME" \
        -c "$WD_REPO_ROOT" "$launcher"
    fi
  fi
  marker_write "last-started"
  marker_clear "nudge"
  marker_clear "handoff-request"
  ledger_emit "orchestrator_restarted" "reason=${DECISION_REASON:-unspecified}" \
    "hb_age=${HB_AGE:-0}" "open_workers=${HB_WORKERS:-0}" "cycle=${HB_CYCLE:-0}"
}

# --- decision --------------------------------------------------------------
DECISION="" DECISION_REASON=""

decide_and_act() {
  local pane session_alive=0
  read_heartbeat

  # 1. Deliberate end states first — quiesced NEVER restarts, whatever tmux says.
  if [ "$HB_STATUS" = "quiesced" ]; then
    DECISION="ok_quiesced"; DECISION_REASON="status_quiesced"
    marker_clear "nudge"; marker_clear "handoff-request"
    return 0
  fi
  if [ "$HB_STATUS" = "rolling" ] && hb_is_fresh; then
    DECISION="waiting_successor"; DECISION_REASON="status_rolling_fresh"
    return 0
  fi

  if probe_session_alive; then session_alive=1; fi
  pane="$(resolve_orch_pane)"

  # 2. Dead session (or unresolvable orchestrator pane) — cross-check rule:
  #    fresh heartbeat + dead session = dead. Re-wake via cold-start.
  if [ "$session_alive" = "0" ] || [ -z "$pane" ]; then
    if [ "$session_alive" = "0" ]; then
      DECISION="rewake"; DECISION_REASON="dead_session"
    else
      DECISION="rewake"; DECISION_REASON="orchestrator_pane_missing"
    fi
    act_rewake
    return 0
  fi

  # 3. Live session + fresh heartbeat.
  if hb_is_fresh; then
    marker_clear "nudge"
    if is_uint "$HB_CTX" && [ "$HB_CTX" -ge "$WD_CONTEXT_CEILING_PCT" ]; then
      local hage; hage="$(marker_age handoff-request)"
      if [ -z "$hage" ]; then
        DECISION="handoff_requested"; DECISION_REASON="context_ceiling"
        act_request_handoff "$pane"
        marker_write "handoff-request"
      elif [ "$hage" -ge "$WD_HANDOFF_WAIT_SECS" ]; then
        DECISION="kill_rewake"; DECISION_REASON="handoff_overdue"
        marker_clear "handoff-request"
        act_kill "$pane" && act_rewake
      else
        DECISION="waiting_handoff"; DECISION_REASON="handoff_requested_${hage}s_ago"
      fi
    else
      marker_clear "handoff-request"
      DECISION="ok"; DECISION_REASON="fresh_heartbeat_live_session"
    fi
    return 0
  fi

  # 4. Live session + stale/missing heartbeat = write-divergence.
  #    One nudge first; still stale after the grace -> kill + re-wake.
  local nage; nage="$(marker_age nudge)"
  if [ -z "$nage" ]; then
    DECISION="nudged"; DECISION_REASON="stale_heartbeat"
    act_nudge "$pane"
    marker_write "nudge"
  elif [ "$nage" -ge "$WD_NUDGE_GRACE_SECS" ]; then
    DECISION="kill_rewake"; DECISION_REASON="stale_after_nudge"
    marker_clear "nudge"
    act_kill "$pane" && act_rewake
  else
    DECISION="waiting_nudge"; DECISION_REASON="nudged_${nage}s_ago"
  fi
}

# --- single-flight lock (basic; hardened with rate-limit in GSL-54) ---------
LOCK_DIR=""
release_lock() { [ -n "$LOCK_DIR" ] && rmdir "$LOCK_DIR" 2>/dev/null || true; }

acquire_lock() {
  LOCK_DIR="$WD_STATE_DIR/tick.lock"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    log "another watchdog tick is running (lock held: $LOCK_DIR) — exiting (single-flight)"
    LOCK_DIR=""
    exit 0
  fi
  trap release_lock EXIT
}

# --- main --------------------------------------------------------------------
main() {
  validate_config
  mkdir -p "$WD_STATE_DIR"
  mkdir -p "$(dirname "$WD_LEDGER_FILE")"
  acquire_lock
  decide_and_act
  log "DECISION=$DECISION reason=$DECISION_REASON hb_age=${HB_AGE:-none} hb_status=${HB_STATUS:-none} ctx=${HB_CTX:-none} workers=${HB_WORKERS:-none} dry_run=$DRY_RUN"
}

main
