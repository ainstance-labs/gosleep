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
#   * restart budget (default 3-in-60-min, warren RestartBudget) with
#     exponential backoff (base 1s, cap 16s); exhausted -> NO kill, NO restart,
#     escalate to the owner instead — "never mask an orchestrator bug with a
#     restart loop" (warren supervisor/main.ts:12-14)
#   * Gastown debounce rails (every watchdog decision counter-debounced,
#     cooldown-limited, warm-up-exempt; the watchdog itself single-flight +
#     rate-limited — 04 §7.1):
#       startup grace  — fresh session exempt from staleness ~120s (issue #567)
#       zombie         — pane-alive != process-alive only after 3 consecutive
#                        cycles AND a stale heartbeat (never a single source)
#       kill cooldown  — >= 5 min between force-kills
#       mass-death     — whole session gone with >=2 workers recorded = systemic
#                        failure -> escalate, do NOT restart blindly
#   * route-through-reap (warren reap / overstory worker_died): NO silent kill —
#     before any kill/restart the watchdog collects state (heartbeat tail, git
#     branch+HEAD, pane inventory, pane capture) into a reap snapshot and
#     records it in the ledger FIRST. Committed work is never silently lost.
#     Ledger format: tools/watchdog/LEDGER.md
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

WD_VERSION="0.4.0 (GSL-55)"
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

# Restart budget (PRD R1.3; warren RestartBudget). Persistent across watchdog
# restarts (file-backed). Exhausted budget = NO kill, NO restart, escalate.
: "${WD_RESTART_BUDGET:=3}"         # max restarts per window (owner may set 3/night)
: "${WD_RESTART_WINDOW_SECS:=3600}" # sliding budget window
: "${WD_BACKOFF_BASE_SECS:=1}"      # exponential backoff base
: "${WD_BACKOFF_CAP_SECS:=16}"      # exponential backoff cap
: "${WD_ESCALATE_REPEAT_SECS:=3600}" # re-escalate at most this often while still down
: "${WD_ESCALATE_HOOK:=}"           # optional executable: called with the escalation
                                    # message (phase-6 push / ntfy extension point)

# Gastown debounce rails (PRD R1.4) — each threshold config-overridable
: "${WD_STARTUP_GRACE_SECS:=120}"   # warm-up exemption from staleness (Gastown #567)
: "${WD_ZOMBIE_CYCLES:=3}"          # consecutive pane-alive/process-dead ticks before zombie
: "${WD_KILL_COOLDOWN_SECS:=300}"   # minimum gap between force-kills
: "${WD_MASS_DEATH_WORKERS:=2}"     # session gone with >= this many recorded workers = systemic
: "${WD_MIN_TICK_INTERVAL_SECS:=60}" # watchdog self rate-limit (launchd tick is 180s)
: "${WD_LOCK_STALE_SECS:=900}"      # steal a single-flight lock older than this (crashed tick)
: "${WD_AGENT_PROC_REGEX:=claude}"  # process expected under the orchestrator pane

# Test-mode probe injection (smoke tests only; forces dry-run for safety)
: "${WD_TEST_MODE:=0}"
: "${WD_TEST_SESSION_ALIVE:=0}"
: "${WD_TEST_ORCH_PANE:=}"
: "${WD_TEST_SESSION_CREATED:=}"    # epoch of session start (grace tests)
: "${WD_TEST_PROC_ALIVE:=1}"        # agent process detected under the pane (zombie tests)

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
  for k in WD_HB_STALE_SECS WD_NUDGE_GRACE_SECS WD_CONTEXT_CEILING_PCT WD_HANDOFF_WAIT_SECS \
           WD_RESTART_BUDGET WD_RESTART_WINDOW_SECS WD_BACKOFF_BASE_SECS WD_BACKOFF_CAP_SECS \
           WD_ESCALATE_REPEAT_SECS WD_STARTUP_GRACE_SECS WD_ZOMBIE_CYCLES WD_KILL_COOLDOWN_SECS \
           WD_MASS_DEATH_WORKERS WD_MIN_TICK_INTERVAL_SECS WD_LOCK_STALE_SECS; do
    is_uint "${!k}" || die_config "$k must be a non-negative integer, got: '${!k}'"
  done
  [ "$WD_ZOMBIE_CYCLES" -ge 1 ] || die_config "WD_ZOMBIE_CYCLES must be >= 1"
  [ -n "$WD_AGENT_PROC_REGEX" ] || die_config "WD_AGENT_PROC_REGEX must not be empty"
  [ "$WD_CONTEXT_CEILING_PCT" -le 100 ] || die_config "WD_CONTEXT_CEILING_PCT must be <= 100"
  [ "$WD_RESTART_BUDGET" -ge 1 ] || die_config "WD_RESTART_BUDGET must be >= 1"
  [ "$WD_BACKOFF_CAP_SECS" -ge "$WD_BACKOFF_BASE_SECS" ] || die_config "WD_BACKOFF_CAP_SECS must be >= WD_BACKOFF_BASE_SECS"
  if [ -n "$WD_ESCALATE_HOOK" ] && [ ! -x "$WD_ESCALATE_HOOK" ]; then
    die_config "WD_ESCALATE_HOOK is set but not executable: $WD_ESCALATE_HOOK"
  fi
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

probe_session_created() { # epoch the tmux session was created (empty if unknown)
  if [ "$WD_TEST_MODE" = "1" ]; then echo "$WD_TEST_SESSION_CREATED"; return 0; fi
  "$WD_TMUX_BIN" display-message -p -t "$WD_TMUX_SESSION" '#{session_created}' 2>/dev/null || true
}

# pane-alive != process-alive (Gastown: the two signals diverge routinely).
# Walks the pane's process tree (<=6 generations) looking for the agent.
probe_agent_process_alive() { # $1 = pane id
  if [ "$WD_TEST_MODE" = "1" ]; then [ "$WD_TEST_PROC_ALIVE" = "1" ]; return; fi
  local pid gen all kids depth=0
  pid="$("$WD_TMUX_BIN" display-message -p -t "$1" '#{pane_pid}' 2>/dev/null || true)"
  is_uint "$pid" || return 1
  all="$pid"; gen="$pid"
  while [ -n "$gen" ] && [ "$depth" -lt 6 ]; do
    kids="$(pgrep -P "$(printf '%s' "$gen" | tr ' ' ',')" 2>/dev/null | tr '\n' ' ' | sed 's/ $//' || true)"
    [ -z "$kids" ] && break
    all="$all $kids"; gen="$kids"; depth=$(( depth + 1 ))
  done
  ps -o command= -p "$(printf '%s' "$all" | tr ' ' ',')" 2>/dev/null | grep -qE "$WD_AGENT_PROC_REGEX"
}

# --- counters (consecutive-cycle debounce, e.g. zombie) ----------------------
counter_path()  { echo "$WD_STATE_DIR/$1.count"; }
counter_read()  { local v; v="$(cat "$(counter_path "$1")" 2>/dev/null || echo 0)"; is_uint "$v" && echo "$v" || echo 0; }
counter_incr()  { local v; v="$(( $(counter_read "$1") + 1 ))"; echo "$v" > "$(counter_path "$1")"; echo "$v"; }
counter_clear() { rm -f "$(counter_path "$1")"; }

# --- startup grace (Gastown #567: don't judge a fresh session by heartbeat) --
# Sources (youngest wins): last-started marker (watchdog's own re-wake) and
# tmux session_created (owner started it manually).
in_startup_grace() {
  local now v
  now="$(now_epoch)"
  v="$(marker_read last-started)"
  if is_uint "$v" && [ $(( now - v )) -lt "$WD_STARTUP_GRACE_SECS" ]; then return 0; fi
  v="$(probe_session_created)"
  if is_uint "$v" && [ $(( now - v )) -lt "$WD_STARTUP_GRACE_SECS" ]; then return 0; fi
  return 1
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

# Route-through-reap (PRD R1.5): collect the dying component's state into a
# snapshot + ledger line BEFORE any kill. "No silently vanished work."
# $1 = pane id or "" (none to capture) ; $2 = role label for the snapshot name
reap() {
  local pane="${1:-}" role="${2:-orchestrator}" rf branch head
  mkdir -p "$WD_STATE_DIR/reaps"
  rf="$WD_STATE_DIR/reaps/$(now_epoch)-${role}.txt"
  {
    echo "reap @ $(iso_ts) role=$role pane=${pane:-none} reason=${DECISION_REASON:-unspecified}"
    echo "--- heartbeat tail (last 5) ---"
    tail -n 5 "$WD_HEARTBEAT_FILE" 2>/dev/null || echo "(no heartbeat file)"
    echo "--- git snapshot ($WD_REPO_ROOT) ---"
    git -C "$WD_REPO_ROOT" branch --show-current 2>/dev/null || echo "(git unavailable)"
    git -C "$WD_REPO_ROOT" log --oneline -5 2>/dev/null || true
    git -C "$WD_REPO_ROOT" status --porcelain 2>/dev/null | head -20 || true
    echo "--- tmux pane inventory ---"
    if [ "$WD_TEST_MODE" = "1" ]; then
      echo "(test mode: pane inventory skipped)"
    else
      "$WD_TMUX_BIN" list-panes -s -t "$WD_TMUX_SESSION" \
        -F '#{pane_id} #{window_name} dead=#{pane_dead} cmd=#{pane_current_command}' 2>/dev/null \
        || echo "(session gone)"
    fi
    if [ -n "$pane" ]; then
      echo "--- pane capture tail ($pane, last 60 lines) ---"
      if [ "$WD_TEST_MODE" = "1" ]; then
        echo "(test mode: capture skipped)"
      else
        "$WD_TMUX_BIN" capture-pane -p -t "$pane" 2>/dev/null | tail -60 || echo "(capture failed)"
      fi
    fi
  } > "$rf"
  branch="$(git -C "$WD_REPO_ROOT" branch --show-current 2>/dev/null || echo unknown)"
  head="$(git -C "$WD_REPO_ROOT" log -1 --format=%h 2>/dev/null || echo unknown)"
  ledger_emit "reap" "role=$role" "target=${pane:-session}" \
    "reason=${DECISION_REASON:-unspecified}" "branch=${branch:-unknown}" \
    "head=${head:-unknown}" "snapshot=$rf"
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

# --- restart budget + backoff + escalation (PRD R1.3) ------------------------
# Persistent history: one epoch per line; pruned to the sliding window on read.
restarts_in_window() {
  local hist="$WD_STATE_DIR/restarts.history" cutoff
  if [ ! -f "$hist" ]; then echo 0; return 0; fi
  cutoff=$(( $(now_epoch) - WD_RESTART_WINDOW_SECS ))
  awk -v c="$cutoff" '$1 >= c' "$hist" > "$hist.tmp" && mv "$hist.tmp" "$hist"
  wc -l < "$hist" | tr -d ' '
}

record_restart() {
  echo "$(now_epoch)" >> "$WD_STATE_DIR/restarts.history"
}

# delay = min(cap, base * 2^n), n = restarts already spent in the window
backoff_secs() {
  local n d i=0
  n="$(restarts_in_window)"
  d="$WD_BACKOFF_BASE_SECS"
  while [ "$i" -lt "$n" ] && [ "$d" -lt "$WD_BACKOFF_CAP_SECS" ]; do
    d=$(( d * 2 )); i=$(( i + 1 ))
  done
  [ "$d" -gt "$WD_BACKOFF_CAP_SECS" ] && d="$WD_BACKOFF_CAP_SECS"
  echo "$d"
}

# Escalate to the owner: ledger + local notify + optional hook (phase-6 push
# extension point). At most once per WD_ESCALATE_REPEAT_SECS while still down.
escalate() {
  local reason="$1" n eage msg
  n="$(restarts_in_window)"
  eage="$(marker_age escalated)"
  if [ -n "$eage" ] && [ "$eage" -lt "$WD_ESCALATE_REPEAT_SECS" ]; then
    log "escalation suppressed (already escalated ${eage}s ago): $reason"
    return 0
  fi
  msg="gosleep watchdog ESCALATION: $reason — $n restarts in the last ${WD_RESTART_WINDOW_SECS}s (budget $WD_RESTART_BUDGET). NOT restarting again; the orchestrator stays down until you intervene or the window frees. Ledger: $WD_LEDGER_FILE"
  log "ESCALATION: $msg"
  ledger_emit "escalation" "reason=$reason" "restarts_in_window=$n" \
    "budget=$WD_RESTART_BUDGET" "window_secs=$WD_RESTART_WINDOW_SECS"
  if [ "$DRY_RUN" = "1" ]; then
    log "[dry-run] would notify owner (osascript notification + hook)"
  else
    if command -v osascript >/dev/null 2>&1; then
      osascript -e "display notification \"$(printf '%s' "$msg" | cut -c1-200)\" with title \"gosleep watchdog\"" 2>/dev/null || true
    fi
    if [ -n "$WD_ESCALATE_HOOK" ]; then
      "$WD_ESCALATE_HOOK" "$msg" || log "WARNING: escalate hook failed (rc=$?)"
    fi
  fi
  marker_write "escalated"
}

# The ONLY gate through which any kill/restart may pass.
# $1 = pane to kill first ("" = none). Sets DECISION on refusal/escalation.
do_restart() {
  local pane="${1:-}" n delay
  n="$(restarts_in_window)"
  if [ "$n" -ge "$WD_RESTART_BUDGET" ]; then
    DECISION="escalated"
    DECISION_REASON="restart_budget_exhausted(${n}/${WD_RESTART_BUDGET}):${DECISION_REASON}"
    escalate "restart budget exhausted (${DECISION_REASON})"
    return 0
  fi
  if [ -n "$pane" ]; then
    # Kill cooldown (Gastown): >= WD_KILL_COOLDOWN_SECS between force-kills.
    local kage; kage="$(marker_age last-kill)"
    if [ -n "$kage" ] && [ "$kage" -lt "$WD_KILL_COOLDOWN_SECS" ]; then
      DECISION="kill_deferred"
      DECISION_REASON="kill_cooldown(${kage}s<${WD_KILL_COOLDOWN_SECS}s):${DECISION_REASON}"
      log "kill deferred: last force-kill ${kage}s ago (< ${WD_KILL_COOLDOWN_SECS}s cooldown)"
      return 0
    fi
    # Route-through-reap: collect state + ledger record BEFORE the kill.
    reap "$pane" "orchestrator"
    if ! act_kill "$pane"; then
      DECISION="kill_refused"
      return 0
    fi
    marker_write "last-kill"
  else
    # Restart without a kill (dead session/pane): still reap what's reapable
    # (git snapshot, heartbeat tail) so the restart is never a silent event.
    reap "" "orchestrator"
  fi
  delay="$(backoff_secs)"
  if [ "$DRY_RUN" = "1" ]; then
    log "[dry-run] would backoff ${delay}s before re-wake (restart $((n+1))/$WD_RESTART_BUDGET in window)"
  else
    log "backoff ${delay}s before re-wake (restart $((n+1))/$WD_RESTART_BUDGET in window)"
    sleep "$delay"
  fi
  record_restart
  act_rewake
}

# --- decision --------------------------------------------------------------
DECISION="" DECISION_REASON=""

decide_and_act() {
  local pane session_alive=0
  read_heartbeat

  # 1. Deliberate end states first — quiesced NEVER restarts, whatever tmux says.
  if [ "$HB_STATUS" = "quiesced" ]; then
    DECISION="ok_quiesced"; DECISION_REASON="status_quiesced"
    marker_clear "nudge"; marker_clear "handoff-request"; marker_clear "escalated"
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
    # Mass-death detection (Gastown): the WHOLE session gone while the last
    # heartbeat recorded >= N live workers is a systemic failure (tmux server
    # died, reboot, sleep) — do NOT restart blindly, escalate to the owner.
    if [ "$session_alive" = "0" ] && is_uint "$HB_WORKERS" \
       && [ "$HB_WORKERS" -ge "$WD_MASS_DEATH_WORKERS" ]; then
      DECISION="mass_death"; DECISION_REASON="session_gone_with_${HB_WORKERS}_workers"
      ledger_emit "mass_death" "open_workers=$HB_WORKERS" "reason=whole_session_gone"
      ledger_emit "worker_died" "count=$HB_WORKERS" "reason=whole_session_gone" \
        "observed=heartbeat_vs_tmux"
      reap "" "session"
      escalate "mass death: whole tmux session '$WD_TMUX_SESSION' gone with $HB_WORKERS live workers recorded — systemic failure, not restarting blindly"
      return 0
    fi
    # Below mass-death threshold but the session took recorded workers with it:
    # their death must still be on the record (overstory worker_died mail).
    if [ "$session_alive" = "0" ] && is_uint "$HB_WORKERS" && [ "$HB_WORKERS" -ge 1 ]; then
      ledger_emit "worker_died" "count=$HB_WORKERS" "reason=session_gone" \
        "observed=heartbeat_recorded"
    fi
    if [ "$session_alive" = "0" ]; then
      DECISION="rewake"; DECISION_REASON="dead_session"
    else
      DECISION="rewake"; DECISION_REASON="orchestrator_pane_missing"
    fi
    do_restart ""
    return 0
  fi

  # 3. Live session + fresh heartbeat.
  if hb_is_fresh; then
    marker_clear "nudge"
    counter_clear "zombie"
    if is_uint "$HB_CTX" && [ "$HB_CTX" -ge "$WD_CONTEXT_CEILING_PCT" ]; then
      local hage; hage="$(marker_age handoff-request)"
      if [ -z "$hage" ]; then
        DECISION="handoff_requested"; DECISION_REASON="context_ceiling"
        act_request_handoff "$pane"
        marker_write "handoff-request"
      elif [ "$hage" -ge "$WD_HANDOFF_WAIT_SECS" ]; then
        DECISION="kill_rewake"; DECISION_REASON="handoff_overdue"
        marker_clear "handoff-request"
        do_restart "$pane"
      else
        DECISION="waiting_handoff"; DECISION_REASON="handoff_requested_${hage}s_ago"
      fi
    else
      marker_clear "handoff-request"
      marker_clear "escalated"
      DECISION="ok"; DECISION_REASON="fresh_heartbeat_live_session"
    fi
    return 0
  fi

  # 4. Live session + stale/missing heartbeat.
  # 4a. Startup grace (Gastown #567): a fresh session that hasn't written its
  #     first heartbeat yet is exempt from staleness for the warm-up window.
  if in_startup_grace; then
    DECISION="ok_grace"; DECISION_REASON="startup_grace_${WD_STARTUP_GRACE_SECS}s"
    counter_clear "zombie"
    return 0
  fi

  # 4b. Zombie debounce: pane exists but no agent process under it. Judged by
  #     TWO sources (stale heartbeat AND process scan), and only after
  #     WD_ZOMBIE_CYCLES consecutive cycles — transient gaps during handoffs
  #     diverge routinely (Gastown mayorZombieCount >= 3).
  if ! probe_agent_process_alive "$pane"; then
    local zc; zc="$(counter_incr zombie)"
    if [ "$zc" -ge "$WD_ZOMBIE_CYCLES" ]; then
      DECISION="kill_rewake"; DECISION_REASON="zombie_confirmed_${zc}_cycles"
      counter_clear "zombie"
      marker_clear "nudge"
      do_restart "$pane"
    else
      DECISION="zombie_watch"; DECISION_REASON="zombie_${zc}_of_${WD_ZOMBIE_CYCLES}"
    fi
    return 0
  fi
  counter_clear "zombie"

  # 4c. Write-divergence: process alive but heartbeat stale.
  #     One nudge first; still stale after the grace -> kill + re-wake.
  local nage; nage="$(marker_age nudge)"
  if [ -z "$nage" ]; then
    DECISION="nudged"; DECISION_REASON="stale_heartbeat"
    act_nudge "$pane"
    marker_write "nudge"
  elif [ "$nage" -ge "$WD_NUDGE_GRACE_SECS" ]; then
    DECISION="kill_rewake"; DECISION_REASON="stale_after_nudge"
    marker_clear "nudge"
    do_restart "$pane"
  else
    DECISION="waiting_nudge"; DECISION_REASON="nudged_${nage}s_ago"
  fi
}

# --- single-flight lock + self rate-limit (Gastown: the watchdog itself is
# --- single-flight and rate-limited so it can't fire on every tick) ----------
LOCK_DIR=""
release_lock() { [ -n "$LOCK_DIR" ] && rmdir "$LOCK_DIR" 2>/dev/null || true; }

acquire_lock() {
  LOCK_DIR="$WD_STATE_DIR/tick.lock"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    # Steal only a provably stale lock (crashed tick), never a live one.
    local lm
    lm="$(file_mtime "$LOCK_DIR" || true)"
    if is_uint "$lm" && [ $(( $(now_epoch) - lm )) -ge "$WD_LOCK_STALE_SECS" ]; then
      log "stealing stale single-flight lock (age >= ${WD_LOCK_STALE_SECS}s — crashed tick)"
      rm -rf "$LOCK_DIR"
      if ! mkdir "$LOCK_DIR" 2>/dev/null; then
        log "lock contention after steal — exiting (single-flight)"
        LOCK_DIR=""; exit 0
      fi
    else
      log "another watchdog tick is running (lock held: $LOCK_DIR) — exiting (single-flight)"
      LOCK_DIR=""; exit 0
    fi
  fi
  trap release_lock EXIT
  # Rate limit: refuse to run more often than WD_MIN_TICK_INTERVAL_SECS.
  local tage; tage="$(marker_age last-tick)"
  if [ -n "$tage" ] && [ "$tage" -lt "$WD_MIN_TICK_INTERVAL_SECS" ]; then
    log "rate-limited: last tick ${tage}s ago < ${WD_MIN_TICK_INTERVAL_SECS}s — exiting"
    exit 0
  fi
  marker_write "last-tick"
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
