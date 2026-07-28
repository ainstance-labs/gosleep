#!/usr/bin/env bash
# =============================================================================
# gosleep watchdog — mechanical (non-LLM) supervisor ABOVE the orchestrator.
#
# GSL-49 / PRD Phase 1 (docs/prd/PRD-gosleep-evolution.md), requirement R1.2.
# Consumer of the heartbeat protocol defined in
# skill/orchestrating-delivery-agents/SKILL.md ("Heartbeat protocol").
#
# Contract (must match the skill text — the orchestrator knows these rules):
#   * MODES (GSL-212/220, d-2026-07-28-001): WD_MODE=observe (the DEFAULT) —
#     the full decision tree runs and every action is LOGGED to the ledger as
#     would_* (would_nudge / would_kill / would_rewake …); nothing is nudged,
#     killed, spawned, slept-for or notified. WD_MODE=armed — actions are live;
#     armable ONLY by an explicit line in the owner's watchdog.conf. The
#     observational run (GSL-220) is observe mode on a schedule; arming is the
#     OWNER's step. Tick-to-tick memory (markers/counters/restart history) is
#     MODE-SCOPED ($WD_STATE_DIR/<mode>/) so an observational simulation can
#     never pre-spend the armed budget or vice versa.
#   * Liveness is judged from DURABLE ON-DISK STATE (heartbeat file mtime
#     + last parseable line), cross-checked against the PLATFORM ROSTER —
#     `claude agents --json`, Claude Code's own machine status: one entry per
#     live top-level CLI session ({pid,cwd,sessionId,name,status}); teammate
#     subagents do not appear, which is what makes it a clean liveness oracle
#     (GSL-212, d-2026-07-28-001). Never from pane-content scraping, never
#     from a single store. (C7) tmux degrades to the ACTION address space
#     (which pane an armed watchdog may nudge/kill) plus a corroboration bit
#     in the ledger — it is no longer the life oracle.
#   * SESSION IDENTITY (GSL-212, audit F2 cure): the heartbeat carries
#     "session"/"session_id", written by tools/lab/heartbeat.sh FROM the
#     roster itself — the orchestrator cannot mistype what it never types.
#     A declared identity absent from the roster while other live session(s)
#     exist in this repo = session_mismatch -> refuse every action + escalate:
#     a re-wake beside a possibly-live orchestrator is the double dispatch
#     the audit proved the old default config would have caused.
#   * A roster the watchdog cannot read (CLI missing/erroring) = fail SAFE:
#     platform_unknown, no action ever — never kill on a guess.
#   * POSITIVE IDENTITY (review C1): the orchestrator pane is identified ONLY
#     from the heartbeat's own "pane" field ($TMUX_PANE, GSL-51). Positional
#     guessing (first pane of a window, session:0.0) is FORBIDDEN — after the
#     orchestrator dies, the first pane of its window is typically a live
#     WORKER. Unverifiable identity in a live session -> kill_refused
#     (reason=identity_unverified) + escalate; never nudge/kill/re-wake a guess.
#   * fresh heartbeat + dead session  = dead        -> re-wake
#   * stale heartbeat + live session  = divergence  -> ONE nudge first;
#     still stale after the nudge grace -> kill (EXPLICIT pane id only) + re-wake
#   * context_pct >= ceiling          -> send-keys "write handoff now";
#     handoff overdue -> kill + re-wake (fresh orchestrator reads the handoff)
#   * status:"quiesced"               -> deliberately not progressing. Two
#     forms (GSL-69): chain ended (open_workers=0) -> NEVER restart, whatever
#     tmux/staleness say. quota-wait (note carries "quota-wait until <ETA>",
#     open_workers = held workers) -> stand down while the ETA holds, but the
#     shield is ETA-BOUNDED (GSL-65 review M1): a limited orchestrator cannot
#     run turns, so the wake-up it armed cannot survive the wait — once the
#     ETA is > WD_QUOTA_GRACE_SECS in the past the watchdog IS the alarm
#     clock: quiesced stops shielding and the normal decision tree applies
#     (nudge first — it lands now that the window is open; kill + re-wake only
#     if the nudge doesn't take). No/unparseable ETA = shield stays up (fail
#     safe: never kill on a guess).
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
#     never respawn them). The first prompt is built from the skill's re-wake
#     brief template (references/re-wake-brief.md, BRIEF-START/END markers,
#     {{...}} placeholders — GSL-56 contract); inline fallback ONLY if the
#     template is missing (ledger-warned). This script contains ZERO LLM calls;
#     the only `claude` invocation is spawning the replacement orchestrator.
#
# Safety invariants:
#   * kill only by explicit resolved pane id matching ^%[0-9]+$ —
#     NEVER kill-pane -a (2026-07-07 lesson: -a killed a live fleet).
#   * kill success is VERIFIED (rc + re-list, review M2): a pane that survives
#     the kill -> kill_failed + escalate, NO re-wake — a surviving pane plus
#     a fresh orchestrator would mean two live orchestrators (double dispatch).
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

WD_VERSION="0.6.4 (GSL-217: thresholds from measured cadence; context ceiling off pending GSL-182)"
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

# tmux topology (Agent Teams = orchestrator + worker split panes, one session).
# The orchestrator pane is identified ONLY from the heartbeat's "pane" field
# (review C1) — there is deliberately NO positional pane target here.
# WD_ORCH_WINDOW_NAME only names the window a re-woken orchestrator spawns in.
: "${WD_TMUX_SESSION:="gosleep"}"
: "${WD_ORCH_WINDOW_NAME:="orchestrator"}"
: "${WD_TMUX_BIN:="tmux"}"
: "${WD_CLAUDE_BIN:="claude"}"

# Mode (GSL-212/220): observe = decide + ledger only, every action suppressed
# into a would_* event; armed = actions live. The DEFAULT is observe — arming
# is the owner's explicit `WD_MODE=armed` line in watchdog.conf, never a default.
: "${WD_MODE:=observe}"

# Re-wake brief template (GSL-56 contract, review M1): extracted between the
# BRIEF-START/END markers with {{...}} placeholders substituted. If the file
# is missing the watchdog falls back to a minimal inline prompt (ledger-warned).
: "${WD_REWAKE_BRIEF:="$WD_REPO_ROOT/skill/orchestrating-delivery-agents/references/re-wake-brief.md"}"

# Thresholds (seconds / percent) — every one config-overridable.
# GSL-217: the numbers below come from MEASUREMENT, not from the head — 222
# heartbeat lines (archive + live, 2026-07-21..28): busy fleet (open_workers>0)
# median 436s / p90 620s; idle median 1856s / p90 5120s. Every historical gap
# above 3900s was an owner standby or a declared pause. The acceptance
# invariant: no staleness threshold below the measured idle median (1856s).
: "${WD_HB_STALE_SECS:=3900}"       # heartbeat older than this = stale. ~2.1x the idle
                                    # median; historically ~5% of gaps exceed it and ALL of
                                    # them were owner standbys written as status "ok" — the
                                    # observational run measures exactly that noise before
                                    # anything is armed (the orchestrator-side cure is
                                    # declaring standby as "quiesced", not a higher number)
: "${WD_HB_SLOW_SECS:=0}"           # GSL-215: the "slow" zone starts here — INSIDE fresh,
                                    # strictly below stale, so by construction no action can
                                    # attach to it (record-only class). 0 = derive stale/2
                                    # (1950s — right at the measured idle median)
: "${WD_NUDGE_GRACE_SECS:=600}"     # after a nudge, how long before the next rung: a busy
                                    # orchestrator's turn routinely runs minutes (busy p90
                                    # 620s) — the nudge lands at the NEXT turn boundary
: "${WD_RESUME_GRACE_SECS:=600}"    # GSL-216 rung 2: after a resume attempt (claude --resume,
                                    # same session, context intact), how long before rung 3
                                    # (cold-start restart from the handoff) — a resumed
                                    # session needs minutes to orient and write its first line
: "${WD_CONTEXT_CEILING_PCT:=100}"  # GSL-217: 100 = context enforcement OFF (the guard below
                                    # skips the branch at >= 100). Measured reality: median
                                    # context_pct 93, max 98, 150/222 lines >= the old 80 —
                                    # the harness compacts on its own and the owner's standing
                                    # rule forbids rolling on the model's self-estimate; a
                                    # ceiling here would "treat" a healthy system (audit F3).
                                    # Re-enable (<=99) only when GSL-182 lands a real harness
                                    # signal instead of the self-estimate
: "${WD_HANDOFF_WAIT_SECS:=600}"    # after "write handoff now", how long before kill+re-wake
: "${WD_QUOTA_GRACE_SECS:=900}"     # quota-wait quiesce: how far past the note's reset ETA the
                                    # stand-down holds; beyond it the quiesced shield drops
                                    # (alarm-clock backstop, GSL-65 review M1). Keep LONGER than
                                    # the orchestrator's own ~120s resume margin

# Restart budget (PRD R1.3; warren RestartBudget). Persistent across watchdog
# restarts (file-backed). Exhausted budget = NO kill, NO restart, escalate.
: "${WD_RESTART_BUDGET:=3}"         # max restarts per window (owner may set 3/night)
: "${WD_RESTART_WINDOW_SECS:=3600}" # sliding budget window
: "${WD_BACKOFF_BASE_SECS:=1}"      # exponential backoff base
: "${WD_BACKOFF_CAP_SECS:=16}"      # exponential backoff cap
: "${WD_ESCALATE_REPEAT_SECS:=3600}" # re-escalate at most this often while still down
: "${WD_ESCALATE_HOOK:=}"           # optional executable: called with the escalation
                                    # message (phase-6 push / ntfy extension point)

# Frozen-progress detector (GSL-213; audit findings 5, 88 — the number-one
# failure of the whole audit: 60.8h of an immobile cycle under a healthy pulse).
# "Alive but useless" is observable for zero tokens because context_pct is not
# invented on a frozen orchestrator — it is frozen too. A run of consecutive
# ticks in which BOTH `cycle` and `context_pct` are immobile, judged only on a
# FRESH heartbeat with status "ok" (staleness has its own branch; quiesced /
# rolling are declared stand-downs), spanning at least the minimum window =
# progress_frozen. RECORD-ONLY signal: it feeds classification (GSL-215),
# it never acts by itself. Caveat named for the observational run: legit owner
# standby also freezes the cycle — that is exactly what the observe ledger is
# for (measure the false-positive rate before anything is armed).
: "${WD_FROZEN_TICKS:=20}"          # consecutive immobile ticks before the signal
                                    # (launchd tick is 180s -> 20 ticks ~= 1 hour)
: "${WD_FROZEN_MIN_SPAN_SECS:=3600}" # the run must also SPAN this much wall clock
                                    # (rapid manual ticks can't fake an hour)

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
: "${WD_TEST_AGENTS_JSON:=}"        # roster fixture FILE for probe_platform (GSL-212);
                                    # empty in test mode = mirror WD_TEST_SESSION_ALIVE
: "${WD_TEST_ORCH_PANE:=}"
: "${WD_TEST_SESSION_CREATED:=}"    # epoch of session start (grace tests)
: "${WD_TEST_PROC_ALIVE:=1}"        # agent process detected under the pane (zombie tests)
: "${WD_TEST_KILL_FAILS:=0}"        # simulate a failed force-kill (M2 tests)

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
  for k in WD_HB_STALE_SECS WD_HB_SLOW_SECS WD_NUDGE_GRACE_SECS WD_RESUME_GRACE_SECS WD_CONTEXT_CEILING_PCT WD_HANDOFF_WAIT_SECS \
           WD_QUOTA_GRACE_SECS WD_FROZEN_TICKS WD_FROZEN_MIN_SPAN_SECS \
           WD_RESTART_BUDGET WD_RESTART_WINDOW_SECS WD_BACKOFF_BASE_SECS WD_BACKOFF_CAP_SECS \
           WD_ESCALATE_REPEAT_SECS WD_STARTUP_GRACE_SECS WD_ZOMBIE_CYCLES WD_KILL_COOLDOWN_SECS \
           WD_MASS_DEATH_WORKERS WD_MIN_TICK_INTERVAL_SECS WD_LOCK_STALE_SECS; do
    is_uint "${!k}" || die_config "$k must be a non-negative integer, got: '${!k}'"
  done
  case "$WD_MODE" in observe|armed) : ;; *) die_config "WD_MODE must be 'observe' or 'armed', got: '$WD_MODE'" ;; esac
  [ "$WD_ZOMBIE_CYCLES" -ge 1 ] || die_config "WD_ZOMBIE_CYCLES must be >= 1"
  [ "$WD_FROZEN_TICKS" -ge 2 ] || die_config "WD_FROZEN_TICKS must be >= 2"
  # Derive the slow threshold (GSL-215) and pin the invariant that makes
  # "slow never acts" TRUE BY CONSTRUCTION: slow lives strictly below stale.
  [ "$WD_HB_SLOW_SECS" -eq 0 ] && WD_HB_SLOW_SECS=$(( WD_HB_STALE_SECS / 2 ))
  [ "$WD_HB_SLOW_SECS" -lt "$WD_HB_STALE_SECS" ] \
    || die_config "WD_HB_SLOW_SECS ($WD_HB_SLOW_SECS) must be < WD_HB_STALE_SECS ($WD_HB_STALE_SECS) — the slow class is record-only and must sit inside the no-action zone"
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
  json="$json,\"mode\":\"$WD_MODE\",\"dry_run\":$DRY_RUN}"
  printf '%s\n' "$json" >> "$WD_LEDGER_FILE"
}

# --- markers (tick-to-tick memory in state dir) ----------------------------
# MODE-SCOPED (GSL-212): observe and armed keep separate memory. An observational
# simulation that "spent" nudge markers, kill cooldowns or the restart budget
# must never gate the real thing when the owner arms — and vice versa.
marker_path()  { echo "$WD_STATE_DIR/$WD_MODE/$1.marker"; }
marker_read()  { cat "$(marker_path "$1")" 2>/dev/null || echo ""; }
marker_write() { echo "$(now_epoch)" > "$(marker_path "$1")"; }
marker_clear() { rm -f "$(marker_path "$1")"; }
marker_age() {
  local v; v="$(marker_read "$1")"
  if is_uint "$v"; then echo $(( $(now_epoch) - v )); else echo ""; fi
}

# --- heartbeat reading -----------------------------------------------------
HB_EXISTS=0 HB_AGE="" HB_LAST="" HB_STATUS="" HB_CTX="" HB_WORKERS="" HB_CYCLE="" HB_PANE="" HB_NOTE=""
HB_SESSION="" HB_SESSION_ID="" HB_MODE=""

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
    HB_PANE="$(hb_field_str pane)"
    HB_NOTE="$(hb_field_str note)"
    HB_SESSION="$(hb_field_str session)"
    HB_SESSION_ID="$(hb_field_str session_id)"
    HB_MODE="$(hb_field_str mode)"
  fi
}

hb_is_fresh() { [ "$HB_EXISTS" = "1" ] && is_uint "$HB_AGE" && [ "$HB_AGE" -lt "$WD_HB_STALE_SECS" ]; }

# GSL-69 quota-wait ETA (GSL-65 review M1). Parses "quota-wait until <ISO>" out
# of the heartbeat note. Sets QUOTA_ETA_STATE:
#   none    — no ETA in the note, or an unparseable one (fail SAFE: an
#             unreadable ETA keeps the quiesced shield up — never kill on a
#             guess; a chain-done quiesce has no ETA and never restarts)
#   pending — ETA + grace still ahead: stand down, the wait is legitimate
#   expired — ETA more than WD_QUOTA_GRACE_SECS in the past: the orchestrator's
#             own armed wake-up provably failed (a limited tick cannot re-arm),
#             the shield drops and the normal decision tree applies
QUOTA_ETA_STATE="none" QUOTA_ETA_EPOCH="" QUOTA_ETA_ISO=""
quota_eta_check() {
  QUOTA_ETA_STATE="none"; QUOTA_ETA_EPOCH=""; QUOTA_ETA_ISO=""
  local iso
  iso="$(printf '%s' "$HB_NOTE" | sed -nE 's/.*quota-wait until ([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?Z).*/\1/p')"
  [ -z "$iso" ] && return 0
  case "$iso" in *:*:*Z) : ;; *) iso="${iso%Z}:00Z" ;; esac  # seconds optional
  QUOTA_ETA_ISO="$iso"
  # BSD date (the launchd target box) first, GNU date fallback.
  QUOTA_ETA_EPOCH="$(date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$iso" +%s 2>/dev/null \
                   || date -u -d "$iso" +%s 2>/dev/null || true)"
  if ! is_uint "$QUOTA_ETA_EPOCH"; then QUOTA_ETA_EPOCH=""; return 0; fi
  if [ $(( $(now_epoch) - QUOTA_ETA_EPOCH )) -gt "$WD_QUOTA_GRACE_SECS" ]; then
    QUOTA_ETA_STATE="expired"
  else
    QUOTA_ETA_STATE="pending"
  fi
}

# --- platform probe (GSL-212): the life oracle is the harness itself --------
# `claude agents --json` — Claude Code's own roster of live top-level CLI
# sessions. Match precedence: heartbeat session_id (exact) -> session name ->
# for a LEGACY heartbeat with neither field, "exactly one roster entry whose
# cwd is this repo" (ambiguity = no match; never guessed). Sets:
#   PLATFORM_STATE    found | not_found | unavailable (fail SAFE: no action ever)
#   PLATFORM_MATCH    session_id | name | cwd_single | mirror (test) | none
#   PLATFORM_STATUS   the harness's own status word for the matched session
#   PLATFORM_SESSIONS how many live sessions the roster listed in total
#   PLATFORM_REPO_N   how many of them run in THIS repo (the double-dispatch guard)
PLATFORM_STATE="unavailable" PLATFORM_MATCH="none" PLATFORM_STATUS="-"
PLATFORM_SESSIONS=0 PLATFORM_REPO_N=0 TMUX_ALIVE=0
probe_platform() {
  PLATFORM_STATE="unavailable"; PLATFORM_MATCH="none"; PLATFORM_STATUS="-"
  PLATFORM_SESSIONS=0; PLATFORM_REPO_N=0
  local json="" out
  if [ "$WD_TEST_MODE" = "1" ] && [ -z "$WD_TEST_AGENTS_JSON" ]; then
    # Legacy-scenario compatibility: without a roster fixture the platform
    # mirrors the injected tmux liveness, matching whatever identity the
    # heartbeat declares — pre-GSL-212 scenarios keep their exact meaning.
    if [ "$WD_TEST_SESSION_ALIVE" = "1" ]; then
      PLATFORM_STATE="found"; PLATFORM_MATCH="mirror"; PLATFORM_STATUS="busy"
      PLATFORM_SESSIONS=1; PLATFORM_REPO_N=1
    else
      PLATFORM_STATE="not_found"
    fi
    return 0
  fi
  if [ "$WD_TEST_MODE" = "1" ]; then
    json="$(cat "$WD_TEST_AGENTS_JSON" 2>/dev/null || true)"
  else
    json="$("$WD_CLAUDE_BIN" agents --json 2>/dev/null || true)"
  fi
  [ -z "$json" ] && return 0   # unavailable — fail safe (never act on a guess)
  out="$(printf '%s' "$json" | python3 -c '
import json, sys
try:
    rows = json.load(sys.stdin)
    assert isinstance(rows, list)
except Exception:
    print("unavailable none - 0 0"); raise SystemExit
repo, sid, name = sys.argv[1], sys.argv[2], sys.argv[3]
repo_n = sum(1 for r in rows if r.get("cwd") == repo)
hit, match = None, "none"
if sid:
    hit = next((r for r in rows if r.get("sessionId") == sid), None)
    if hit is not None:
        match = "session_id"
if hit is None and name:
    hit = next((r for r in rows if r.get("name") == name), None)
    if hit is not None:
        match = "name"
if hit is None and not sid and not name:
    cands = [r for r in rows if r.get("cwd") == repo]
    if len(cands) == 1:
        hit, match = cands[0], "cwd_single"
if hit is not None:
    print("found %s %s %d %d" % (match, (hit.get("status") or "-"), len(rows), repo_n))
else:
    print("not_found none - %d %d" % (len(rows), repo_n))
' "$WD_REPO_ROOT" "$HB_SESSION_ID" "$HB_SESSION" 2>/dev/null || echo "unavailable none - 0 0")"
  # shellcheck disable=SC2086
  set -- $out
  PLATFORM_STATE="${1:-unavailable}"; PLATFORM_MATCH="${2:-none}"
  PLATFORM_STATUS="${3:--}"; PLATFORM_SESSIONS="${4:-0}"; PLATFORM_REPO_N="${5:-0}"
}

# --- frozen-progress detector (GSL-213) --------------------------------------
# History: one "epoch cycle context_pct" line per QUALIFYING tick (fresh
# heartbeat, status ok, parseable counters) in the MODE state dir, capped.
# FROZEN fires when the run of trailing entries whose (cycle, context_pct)
# equal the newest one reaches WD_FROZEN_TICKS ticks AND spans
# WD_FROZEN_MIN_SPAN_SECS of wall clock. Episode-edged: progress_frozen once
# on entering, progress_resumed once on leaving — the per-tick `tick` line
# carries frozen=0/1 in between (no ledger spam, no lost signal).
FROZEN=0 FROZEN_TICKS=0 FROZEN_SPAN=0
progress_history_path() { echo "$WD_STATE_DIR/$WD_MODE/progress.history"; }

track_progress() {
  FROZEN=0; FROZEN_TICKS=0; FROZEN_SPAN=0
  local hist; hist="$(progress_history_path)"
  # Qualify: a frozen VERDICT is only meaningful on a beating heart doing
  # nothing. Stale heartbeats have their own branch; quiesced/rolling are
  # declared stand-downs; unparseable counters cannot be compared. A
  # non-qualifying tick BREAKS the run (episode over, if one was open).
  if ! hb_is_fresh || { [ -n "$HB_STATUS" ] && [ "$HB_STATUS" != "ok" ]; } \
     || ! is_uint "$HB_CYCLE" || ! is_uint "$HB_CTX"; then
    local breach="counters_unparseable"
    if ! hb_is_fresh; then
      breach="hb_stale_or_missing"
    elif [ -n "$HB_STATUS" ] && [ "$HB_STATUS" != "ok" ]; then
      breach="status_${HB_STATUS}"
    fi
    if [ -n "$(marker_read frozen-episode)" ]; then
      marker_clear "frozen-episode"
      ledger_emit "progress_resumed" "reason=run_broken_by_${breach}"
    fi
    rm -f "$hist"
    return 0
  fi
  echo "$(now_epoch) $HB_CYCLE $HB_CTX" >> "$hist"
  # cap the file (same discipline as the heartbeat: bounded forever)
  if [ "$(wc -l < "$hist" | tr -d ' ')" -gt 500 ]; then
    tail -n 400 "$hist" > "$hist.tmp" && mv "$hist.tmp" "$hist"
  fi
  # trailing run of entries equal to the newest (cycle, ctx)
  local run_len=0 run_first="" run_last="" e c x
  while read -r e c x; do
    if [ "$c" = "$HB_CYCLE" ] && [ "$x" = "$HB_CTX" ]; then
      run_len=$(( run_len + 1 ))
      [ -z "$run_first" ] && run_first="$e"
      run_last="$e"
    else
      run_len=0; run_first=""; run_last=""
    fi
  done < "$hist"
  FROZEN_TICKS="$run_len"
  if is_uint "$run_first" && is_uint "$run_last"; then
    FROZEN_SPAN=$(( run_last - run_first ))
  fi
  if [ "$run_len" -ge "$WD_FROZEN_TICKS" ] && [ "$FROZEN_SPAN" -ge "$WD_FROZEN_MIN_SPAN_SECS" ]; then
    FROZEN=1
    if [ -z "$(marker_read frozen-episode)" ]; then
      marker_write "frozen-episode"
      ledger_emit "progress_frozen" "cycle=${HB_CYCLE}" "context_pct=${HB_CTX}" \
        "ticks=$run_len" "span_secs=$FROZEN_SPAN" \
        "threshold_ticks=$WD_FROZEN_TICKS" "threshold_span=$WD_FROZEN_MIN_SPAN_SECS"
    fi
  else
    if [ -n "$(marker_read frozen-episode)" ]; then
      marker_clear "frozen-episode"
      ledger_emit "progress_resumed" "cycle=${HB_CYCLE}" "context_pct=${HB_CTX}"
    fi
  fi
}

# --- classification (GSL-215): healthy / slow / stuck + dead / shielded / unknown
# The ZFC matrix (borrowed from overstory: Zombie / Frozen / Crashed) mapped
# onto this contour — the rule table lives in docs/runbooks/watchdog.md.
# BIAS IS FALSE-NEGATIVE by design: ambiguity always resolves to the MILDER
# class — better to miss a stuck orchestrator for one tick than to kill a live
# one. The class DECIDES NOTHING here; it is recorded on the tick line and the
# reaction ladder consults it (slow is record-only BY CONSTRUCTION: its zone
# sits strictly below the stale threshold, where the decision tree already
# does nothing).
#   healthy  — platform found, heartbeat fresh and young, counters moving
#   slow     — platform found, heartbeat fresh but PAST the slow mark
#              (age >= WD_HB_SLOW_SECS), or fresh-but-frozen (GSL-213 F-signal)
#   stuck    — platform found, heartbeat stale (the action zone: write-
#              divergence / zombie live here — overstory Z-signal)
#   dead     — the roster lists no session of ours anywhere (overstory C-signal)
#   shielded — declared stand-down (quiesced; rolling with a fresh heartbeat)
#   unknown  — the watchdog cannot see (roster unreadable / session mismatch);
#              refuse-and-escalate territory, never action territory
WD_CLASS="" WD_CLASS_REASON=""
classify() {
  if [ "$HB_STATUS" = "quiesced" ] || { [ "$HB_STATUS" = "rolling" ] && hb_is_fresh; }; then
    WD_CLASS="shielded"; WD_CLASS_REASON="status_${HB_STATUS}"; return 0
  fi
  case "$PLATFORM_STATE" in
    unavailable)
      WD_CLASS="unknown"; WD_CLASS_REASON="platform_unavailable"; return 0 ;;
    not_found)
      if [ "$PLATFORM_REPO_N" -ge 1 ]; then
        WD_CLASS="unknown"; WD_CLASS_REASON="session_mismatch"
      else
        WD_CLASS="dead"; WD_CLASS_REASON="no_live_session_in_roster"
      fi
      return 0 ;;
  esac
  if in_startup_grace; then
    WD_CLASS="healthy"; WD_CLASS_REASON="startup_grace"; return 0
  fi
  if hb_is_fresh; then
    if [ "$FROZEN" = "1" ]; then
      WD_CLASS="slow"; WD_CLASS_REASON="progress_frozen"
    elif is_uint "$HB_AGE" && [ "$HB_AGE" -ge "$WD_HB_SLOW_SECS" ]; then
      WD_CLASS="slow"; WD_CLASS_REASON="hb_age_${HB_AGE}s_past_slow_${WD_HB_SLOW_SECS}s"
    else
      WD_CLASS="healthy"; WD_CLASS_REASON="fresh_and_moving"
    fi
  else
    WD_CLASS="stuck"; WD_CLASS_REASON="hb_stale_${HB_AGE:-missing}s"
  fi
}

# --- tmux probes (injectable in test mode) ---------------------------------
probe_session_alive() {
  if [ "$WD_TEST_MODE" = "1" ]; then [ "$WD_TEST_SESSION_ALIVE" = "1" ]; return; fi
  "$WD_TMUX_BIN" has-session -t "$WD_TMUX_SESSION" 2>/dev/null
}

# Does an explicit pane id currently exist AT ALL? Searched server-wide (-a),
# not inside the configured session (GSL-212): pane ids (%N) are globally
# unique, and scoping the search to WD_TMUX_SESSION would re-import the exact
# F2 failure (a mis-configured session name making a live pane invisible).
probe_pane_exists() { # $1 = pane id (%N)
  if [ "$WD_TEST_MODE" = "1" ]; then [ -n "$1" ] && [ "$1" = "$WD_TEST_ORCH_PANE" ]; return; fi
  "$WD_TMUX_BIN" list-panes -a -F '#{pane_id}' 2>/dev/null | grep -qx -- "$1"
}

# POSITIVE identification of the orchestrator pane (review C1). The ONLY source
# of truth is the heartbeat's own "pane" field ($TMUX_PANE — the orchestrator
# names itself, GSL-51). Positional guessing (first pane of a window,
# session:0.0) is FORBIDDEN: after the orchestrator pane dies, the first pane
# of its window is typically a live WORKER — nudging/killing it masks the death
# and destroys in-flight work. A correct-looking id of the WRONG pane passes
# the ^%[0-9]+$ gate; only self-declared identity is trusted.
# Sets: ORCH_PANE (the verified id or "") and PANE_IDENTITY
# (verified | no_field | invalid_field | not_found). Call directly — NOT in
# a command substitution (it must set globals).
ORCH_PANE="" PANE_IDENTITY=""
resolve_orch_pane() {
  ORCH_PANE=""
  if [ -z "$HB_PANE" ]; then PANE_IDENTITY="no_field"; return 0; fi
  if ! [[ "$HB_PANE" =~ ^%[0-9]+$ ]]; then PANE_IDENTITY="invalid_field"; return 0; fi
  if probe_pane_exists "$HB_PANE"; then
    PANE_IDENTITY="verified"; ORCH_PANE="$HB_PANE"
  else
    PANE_IDENTITY="not_found"
  fi
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
# Mode-scoped like the markers (GSL-212): observe's consecutive-cycle chains
# must never pre-confirm (or reset) the armed watchdog's, and vice versa.
counter_path()  { echo "$WD_STATE_DIR/$WD_MODE/$1.count"; }
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
  if [ "$WD_MODE" = "observe" ]; then
    log "[observe] would nudge $1 (stale heartbeat, age=${HB_AGE:-none}s > ${WD_HB_STALE_SECS}s) — nothing sent"
    ledger_emit "would_nudge" "target=$1" "reason=stale_heartbeat" "hb_age=${HB_AGE:-0}"
    return 0
  fi
  local msg="[watchdog $(iso_ts)] heartbeat is stale (age=${HB_AGE:-none}s > ${WD_HB_STALE_SECS}s). Append a heartbeat line NOW (Heartbeat protocol) and re-arm your pulse. Next stale tick = kill + re-wake."
  act_send_text "$1" "$msg"
  ledger_emit "nudge" "target=$1" "reason=stale_heartbeat" "hb_age=${HB_AGE:-0}"
}

act_request_handoff() { # $1=pane
  if [ "$WD_MODE" = "observe" ]; then
    log "[observe] would request handoff from $1 (context_pct=${HB_CTX}% >= ${WD_CONTEXT_CEILING_PCT}%) — nothing sent"
    ledger_emit "would_request_handoff" "target=$1" "context_pct=${HB_CTX}" "ceiling=$WD_CONTEXT_CEILING_PCT"
    return 0
  fi
  local msg="[watchdog $(iso_ts)] context_pct=${HB_CTX}% >= ceiling ${WD_CONTEXT_CEILING_PCT}%. Follow the roll protocol NOW: update STATE, write a dated handoff, append a status:\"rolling\" heartbeat, start your successor, exit. Overdue in ${WD_HANDOFF_WAIT_SECS}s = kill + re-wake from the handoff."
  act_send_text "$1" "$msg"
  ledger_emit "handoff_requested" "target=$1" "context_pct=${HB_CTX}" "ceiling=$WD_CONTEXT_CEILING_PCT"
}

# act_kill outcome for the caller: refused (safety gate) | failed (kill did
# not stick — review M2) | killed. Only "killed" may be followed by a re-wake.
KILL_OUTCOME=""
act_kill() { # $1=pane — EXPLICIT id only; refuses anything else. NEVER -a.
  local pane="$1" rc=0
  KILL_OUTCOME="refused"
  if ! [[ "$pane" =~ ^%[0-9]+$ ]]; then
    log "REFUSING kill: '$pane' is not an explicit pane id (%N). kill-pane -a is forbidden."
    ledger_emit "kill_refused" "target=$pane" "reason=not_explicit_pane_id"
    return 1
  fi
  # Observe (GSL-212): the safety gates above still ran; the kill itself is
  # only recorded. KILL_OUTCOME=killed lets the caller continue into the
  # would_rewake record — the ledger shows the WHOLE chain that would fire.
  if [ "$WD_MODE" = "observe" ]; then
    KILL_OUTCOME="killed"
    log "[observe] would kill-pane -t $pane (explicit id) — nothing killed"
    ledger_emit "would_kill" "target=$pane" "reason=${DECISION_REASON:-unspecified}"
    return 0
  fi
  if [ "$DRY_RUN" = "1" ]; then
    if [ "$WD_TEST_MODE" = "1" ] && [ "$WD_TEST_KILL_FAILS" = "1" ]; then
      KILL_OUTCOME="failed"
      log "kill FAILED (test-injected): $pane would survive the kill"
      ledger_emit "kill_failed" "target=$pane" "reason=test_injected_failure"
      return 1
    fi
    log "[dry-run] would kill-pane -t $pane (explicit id)"
  else
    # Review M2: a failed kill must NEVER be followed by a re-wake — a
    # surviving pane + a fresh orchestrator = two live orchestrators
    # (double dispatch). Check the rc AND re-list to confirm the pane is gone.
    "$WD_TMUX_BIN" kill-pane -t "$pane" || rc=$?
    if [ "$rc" -ne 0 ]; then
      KILL_OUTCOME="failed"
      log "kill-pane -t $pane FAILED (rc=$rc) — the pane may still be alive"
      ledger_emit "kill_failed" "target=$pane" "reason=kill_pane_rc_$rc"
      return 1
    fi
    if probe_pane_exists "$pane"; then
      KILL_OUTCOME="failed"
      log "kill-pane -t $pane returned 0 but the pane STILL EXISTS — treating as kill failure"
      ledger_emit "kill_failed" "target=$pane" "reason=pane_survived_kill"
      return 1
    fi
  fi
  KILL_OUTCOME="killed"
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

# Build the fresh orchestrator's first prompt (review M1): consume the re-wake
# brief template shipped with the skill (GSL-56 contract) — extract the block
# between the BRIEF-START/END markers, substitute the placeholders the watchdog
# knows. {{REASON}} carries DECISION_REASON verbatim (the reason dictionary
# lives in re-wake-brief.md — keep the two in sync). {{RESTART_N}} is THIS
# restart's index (record_restart has already run when act_rewake calls us).
# Inline fallback ONLY if the template is missing or markerless (ledger-warned).
build_rewake_prompt() {
  local prompt_file="$WD_STATE_DIR/rewake-prompt.txt"
  local n ts
  n="$(restarts_in_window)"
  ts="$(iso_ts)"
  if [ -f "$WD_REWAKE_BRIEF" ] && grep -q 'BRIEF-START' "$WD_REWAKE_BRIEF"; then
    sed -n '/BRIEF-START/,/BRIEF-END/p' "$WD_REWAKE_BRIEF" | sed '1d;$d' \
      | sed -e "s|{{PROJECT_DIR}}|$WD_REPO_ROOT|g" \
            -e "s|{{REASON}}|${DECISION_REASON:-unknown}|g" \
            -e "s|{{RESTART_N}}|$n|g" \
            -e "s|{{RESTART_BUDGET}}|$WD_RESTART_BUDGET|g" \
            -e "s|{{TS}}|$ts|g" > "$prompt_file"
  else
    log "WARNING: re-wake brief template missing/markerless ($WD_REWAKE_BRIEF) — inline fallback prompt" >&2
    ledger_emit "rewake_brief_missing" "path=$WD_REWAKE_BRIEF" "fallback=inline"
    cat > "$prompt_file" <<EOF
You are a REPLACEMENT orchestrator, re-woken by the mechanical watchdog (tools/watchdog/watchdog.sh) at $ts. Reason: ${DECISION_REASON:-unknown}. This is restart $n of $WD_RESTART_BUDGET in the current window. No human is present.
Follow the orchestrating-delivery-agents skill, sections "Recovering / cold-starting an in-progress chain" AND "Re-wake — automated restart by watchdog" (unattended deltas), exactly:
1. Read ORCHESTRATION-STATE.md AND the highest-numbered docs/handoff/NN-*.md FIRST (on-disk before any live probes).
2. Read the watchdog ledger tail: $WD_LEDGER_FILE (your predecessor's death and this restart are recorded there). Append a CORRECTION/restart note to the STATE log.
3. Confirm reality: tmux list-panes, git log/status, gh pr list, tracker.
4. RE-ATTACH to live workers — do NOT respawn or duplicate them; never spawn until every pane is positively accounted for.
5. Append your first heartbeat line right after orientation (you are inside the startup-grace window; your first write ends it).
EOF
  fi
  echo "$prompt_file"
}

# GSL-216 rung 2: revive the SAME session — `claude --resume <session_id>`
# relaunches the exact session the heartbeat named, context intact. Softer than
# a cold-start replacement (rung 3): the brain survives, only the process is
# new. Exists ONLY when the heartbeat carries session_id (GSL-212) — identity
# for the resume is the same construction-derived fact life is judged by.
act_resume() {
  local n; n="$(restarts_in_window)"
  if [ "$WD_MODE" = "observe" ]; then
    log "[observe] would resume session ${HB_SESSION_ID} in-place (claude --resume, context intact) — nothing spawned"
    marker_write "resume-attempt"
    ledger_emit "would_resume" "session_id=${HB_SESSION_ID}" \
      "reason=${DECISION_REASON:-unspecified}" "attempt=$n"
    return 0
  fi
  local launcher="$WD_STATE_DIR/resume-launch.sh"
  cat > "$launcher" <<EOF
#!/usr/bin/env bash
cd "$WD_REPO_ROOT" || exit 1
exec "$WD_CLAUDE_BIN" --resume "$HB_SESSION_ID"
EOF
  chmod +x "$launcher"
  if [ "$DRY_RUN" = "1" ]; then
    log "[dry-run] would resume session ${HB_SESSION_ID} (launcher=$launcher)"
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
  marker_write "resume-attempt"
  ledger_emit "orchestrator_resumed" "session_id=${HB_SESSION_ID}" \
    "reason=${DECISION_REASON:-unspecified}" "attempt=$n" \
    "hb_age=${HB_AGE:-0}" "open_workers=${HB_WORKERS:-0}" "cycle=${HB_CYCLE:-0}"
}

act_rewake() {
  local prompt_file launcher
  prompt_file="$(build_rewake_prompt)"
  # Observe (GSL-212): the re-wake brief IS built (evidence of exactly what a
  # replacement would have been told — that is observational data), but nothing
  # is spawned and no last-started marker is written: no start happened, so no
  # startup grace may be granted for it.
  if [ "$WD_MODE" = "observe" ]; then
    log "[observe] would re-wake orchestrator via cold-start (session=$WD_TMUX_SESSION, window=$WD_ORCH_WINDOW_NAME, prompt=$prompt_file) — nothing spawned"
    marker_clear "nudge"
    marker_clear "handoff-request"
    ledger_emit "would_rewake" "reason=${DECISION_REASON:-unspecified}" \
      "hb_age=${HB_AGE:-0}" "open_workers=${HB_WORKERS:-0}" "cycle=${HB_CYCLE:-0}" \
      "attempt=$(restarts_in_window)" "prompt=$prompt_file"
    return 0
  fi
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
    "hb_age=${HB_AGE:-0}" "open_workers=${HB_WORKERS:-0}" "cycle=${HB_CYCLE:-0}" \
    "attempt=$(restarts_in_window)"
}

# --- restart budget + backoff + escalation (PRD R1.3) ------------------------
# Persistent history: one epoch per line; pruned to the sliding window on read.
restarts_in_window() {
  local hist="$WD_STATE_DIR/$WD_MODE/restarts.history" cutoff
  if [ ! -f "$hist" ]; then echo 0; return 0; fi
  cutoff=$(( $(now_epoch) - WD_RESTART_WINDOW_SECS ))
  awk -v c="$cutoff" '$1 >= c' "$hist" > "$hist.tmp" && mv "$hist.tmp" "$hist"
  wc -l < "$hist" | tr -d ' '
}

record_restart() {
  echo "$(now_epoch)" >> "$WD_STATE_DIR/$WD_MODE/restarts.history"
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
  if [ "$WD_MODE" = "observe" ]; then
    # Observe is externally SILENT (GSL-220): the escalation is on the record
    # (ledger + log) for the morning read, but the owner is not pinged — a
    # miscalibrated threshold must cost a ledger line, not a night's sleep.
    log "[observe] escalation recorded, owner NOT notified"
  elif [ "$DRY_RUN" = "1" ]; then
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

# The ONLY gate through which any kill/resume/restart may pass.
# $1 = pane to kill first ("" = none); $2 = rung: "resume" (claude --resume,
# GSL-216 rung 2) or "restart" (cold-start re-wake, rung 3; default). BOTH
# rungs spend the SAME RestartBudget and share the backoff — a resume loop is
# as much a masked bug as a restart loop. Sets DECISION on refusal/escalation.
do_restart() {
  local pane="${1:-}" rung="${2:-restart}" n delay
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
      if [ "$KILL_OUTCOME" = "failed" ]; then
        # Review M2: the kill did not stick — the old pane may still be alive.
        # Re-waking anyway would risk TWO live orchestrators (double dispatch):
        # escalate and stop; the owner (or a later successful kill) resolves it.
        DECISION="kill_failed"
        DECISION_REASON="kill_failed:${DECISION_REASON}"
        escalate "force-kill failed for the orchestrator pane $pane (${DECISION_REASON}) — NOT re-waking: a surviving pane plus a fresh orchestrator would double-dispatch. Intervene manually (tmux attach) or wait for the next tick."
      else
        DECISION="kill_refused"
      fi
      return 0
    fi
    marker_write "last-kill"
  else
    # Restart without a kill (dead session/pane): still reap what's reapable
    # (git snapshot, heartbeat tail) so the restart is never a silent event.
    reap "" "orchestrator"
  fi
  delay="$(backoff_secs)"
  if [ "$WD_MODE" = "observe" ] && [ "$DRY_RUN" != "1" ]; then
    log "[observe] would backoff ${delay}s before re-wake (restart $((n+1))/$WD_RESTART_BUDGET in window) — not sleeping"
  elif [ "$DRY_RUN" = "1" ]; then
    log "[dry-run] would backoff ${delay}s before re-wake (restart $((n+1))/$WD_RESTART_BUDGET in window)"
  else
    log "backoff ${delay}s before re-wake (restart $((n+1))/$WD_RESTART_BUDGET in window)"
    sleep "$delay"
  fi
  record_restart
  if [ "$rung" = "resume" ]; then act_resume; else act_rewake; fi
}

# --- decision --------------------------------------------------------------
DECISION="" DECISION_REASON=""

decide_and_act() {
  local pane session_alive=0
  read_heartbeat
  # Probes first (GSL-212) so EVERY tick line — including shielded quiesced/
  # rolling ticks — carries real platform + tmux corroboration data.
  probe_platform
  TMUX_ALIVE=0; probe_session_alive && TMUX_ALIVE=1
  # Frozen-progress bookkeeping (GSL-213): record-only, feeds GSL-215 classes.
  track_progress
  # Classification (GSL-215): computed from the signals, recorded on the tick
  # line, decides nothing here — the reaction ladder consults it.
  classify

  # 1. Deliberate end states first. Chain-done quiesced NEVER restarts, whatever
  #    tmux says — but the quota-wait form is ETA-BOUNDED (GSL-65 review M1):
  #    a limited orchestrator cannot run turns, so the wake-up it armed cannot
  #    survive the wait. Once the note's reset ETA is > WD_QUOTA_GRACE_SECS in
  #    the past, the shield drops and the NORMAL tree below applies: stale +
  #    live pane -> ONE nudge (which lands — the window is open by now), kill +
  #    re-wake only if the nudge doesn't take; dead-session / mass-death rules
  #    unchanged. No ETA or an unparseable one keeps the shield up (fail safe).
  if [ "$HB_STATUS" = "quiesced" ]; then
    quota_eta_check
    if [ "$QUOTA_ETA_STATE" = "expired" ]; then
      local overdue=$(( $(now_epoch) - QUOTA_ETA_EPOCH ))
      log "quota-wait ETA expired: eta=$QUOTA_ETA_ISO overdue=${overdue}s (> ${WD_QUOTA_GRACE_SECS}s grace) — quiesced shield drops, normal decision tree applies"
      ledger_emit "quota_wait_expired" "eta=$QUOTA_ETA_ISO" \
        "overdue_secs=$overdue" "grace_secs=$WD_QUOTA_GRACE_SECS"
    else
      DECISION="ok_quiesced"; DECISION_REASON="status_quiesced"
      marker_clear "nudge"; marker_clear "handoff-request"; marker_clear "escalated"
      return 0
    fi
  fi
  if [ "$HB_STATUS" = "rolling" ] && hb_is_fresh; then
    DECISION="waiting_successor"; DECISION_REASON="status_rolling_fresh"
    return 0
  fi

  # 1b. Life oracle (GSL-212): the platform roster, with tmux demoted to a
  #     corroboration bit that travels in the ledger but decides nothing.
  #     Roster unreadable = fail SAFE: no decision tree at all — a watchdog
  #     that cannot see may not act (never kill on a guess).
  if [ "$PLATFORM_STATE" = "unavailable" ]; then
    DECISION="platform_unknown"; DECISION_REASON="agents_roster_unavailable"
    ledger_emit "platform_unavailable" "tmux_alive=$TMUX_ALIVE"
    if [ "$WD_MODE" = "armed" ]; then
      escalate "platform roster (claude agents --json) unavailable — supervising blind is forbidden, no action taken until it reads again"
    fi
    return 0
  fi

  #     Declared identity absent from the roster while live session(s) still
  #     run in THIS repo = session_mismatch (audit F2 cure): the heartbeat's
  #     author may be one of them under a different identity, or a live
  #     orchestrator may simply not be the one the heartbeat named. Every
  #     action is refused — a re-wake beside a possibly-live orchestrator is
  #     the double dispatch this epic exists to make impossible.
  if [ "$PLATFORM_STATE" = "not_found" ] && [ "$PLATFORM_REPO_N" -ge 1 ]; then
    DECISION="session_mismatch"; DECISION_REASON="hb_session_not_in_roster"
    ledger_emit "session_mismatch" "hb_session=${HB_SESSION:-none}" \
      "hb_session_id=${HB_SESSION_ID:-none}" "repo_sessions=$PLATFORM_REPO_N" \
      "tmux_alive=$TMUX_ALIVE"
    escalate "heartbeat declares session '${HB_SESSION:-none}' but the platform roster does not list it, while $PLATFORM_REPO_N live session(s) run in this repo — refusing every action (re-wake here risks two live orchestrators, audit F2)"
    return 0
  fi

  [ "$PLATFORM_STATE" = "found" ] && session_alive=1

  # 2. Dead session — cross-check rule: fresh heartbeat + dead PLATFORM = dead
  #    (the roster lists no session of ours anywhere, and none in this repo).
  #    Re-wake via cold-start (no kill: there is nothing left to kill).
  if [ "$session_alive" = "0" ]; then
    # Mass-death detection (Gastown): the WHOLE session gone while the last
    # heartbeat recorded >= N live workers is a systemic failure (tmux server
    # died, reboot, sleep) — do NOT restart blindly, escalate to the owner.
    if is_uint "$HB_WORKERS" && [ "$HB_WORKERS" -ge "$WD_MASS_DEATH_WORKERS" ]; then
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
    if is_uint "$HB_WORKERS" && [ "$HB_WORKERS" -ge 1 ]; then
      ledger_emit "worker_died" "count=$HB_WORKERS" "reason=session_gone" \
        "observed=heartbeat_recorded"
    fi
    # Rung choice for a dead session (GSL-216): a heartbeat that named its
    # session_id lets us revive the SAME brain (claude --resume) instead of
    # cold-starting a replacement; a legacy heartbeat goes straight to rung 3.
    if [ -n "$HB_SESSION_ID" ] && [ -z "$(marker_read resume-attempt)" ]; then
      DECISION="resume"; DECISION_REASON="dead_session_resume"
      do_restart "" resume
    else
      DECISION="rewake"; DECISION_REASON="dead_session"
      marker_clear "resume-attempt"
      do_restart "" restart
    fi
    return 0
  fi

  # 3. Live session: POSITIVE IDENTITY GATE (review C1). The orchestrator pane
  #    is resolved ONLY from the heartbeat's own "pane" field and must exist in
  #    the session. Anything less than "verified" means every possible target
  #    is a guess — and a guessed pane may be a live WORKER (the C1 failure:
  #    orchestrator dies, first pane of its window is now a worker; a nudge
  #    feeds it prompts, a kill destroys its in-flight work). So: never nudge,
  #    never kill, never re-wake on a guess — refuse and escalate.
  resolve_orch_pane
  if [ "$PANE_IDENTITY" != "verified" ]; then
    # A fresh session may not have written its first (pane-bearing) heartbeat
    # yet — same warm-up exemption as staleness (Gastown #567).
    if in_startup_grace; then
      DECISION="ok_grace"; DECISION_REASON="startup_grace_${WD_STARTUP_GRACE_SECS}s"
      counter_clear "zombie"
      return 0
    fi
    DECISION="identity_unverified"; DECISION_REASON="pane_identity_${PANE_IDENTITY}"
    counter_clear "zombie"   # identity lost = the consecutive-cycle chain is broken
    ledger_emit "kill_refused" "target=${HB_PANE:-none}" "reason=identity_unverified" \
      "identity=$PANE_IDENTITY"
    escalate "cannot positively identify the orchestrator pane (${PANE_IDENTITY}; heartbeat pane='${HB_PANE:-none}') in live session '$WD_TMUX_SESSION' — refusing to nudge/kill/re-wake a guessed pane (review C1)"
    return 0
  fi
  pane="$ORCH_PANE"

  # 4. Live session + fresh heartbeat (verified pane).
  if hb_is_fresh; then
    marker_clear "nudge"
    marker_clear "resume-attempt"   # the ladder episode is over: the heart beats
    counter_clear "zombie"
    # Context ceiling (GSL-217): ceiling >= 100 means the whole branch is OFF —
    # context_pct is the model's self-estimate of the share CONSUMED, the
    # harness compacts on its own, and enforcement waits for GSL-182's real
    # signal. The value still travels on every tick line for the record.
    if is_uint "$HB_CTX" && [ "$WD_CONTEXT_CEILING_PCT" -le 99 ] \
       && [ "$HB_CTX" -ge "$WD_CONTEXT_CEILING_PCT" ]; then
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

  # 5. Live session + stale heartbeat (verified pane).
  # 5a. Startup grace (Gastown #567): a fresh session that hasn't written its
  #     first heartbeat yet is exempt from staleness for the warm-up window.
  if in_startup_grace; then
    DECISION="ok_grace"; DECISION_REASON="startup_grace_${WD_STARTUP_GRACE_SECS}s"
    counter_clear "zombie"
    return 0
  fi

  # 5b. Zombie debounce: pane exists but no agent process under it. Judged by
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

  # 5c. Write-divergence: process alive but heartbeat stale.
  #     THE LADDER (GSL-216): nudge -> resume -> restart, each rung with its own
  #     grace, rungs 2-3 through the shared RestartBudget + backoff gate.
  #     Rung 2 (kill + claude --resume: same session, context intact) exists
  #     only when the heartbeat named its session_id — a legacy heartbeat
  #     degrades to the historical two-rung nudge -> restart by construction.
  local nage rage
  nage="$(marker_age nudge)"
  rage="$(marker_age resume-attempt)"
  if [ -n "$rage" ]; then
    # A resume was already attempted this episode.
    if [ "$rage" -ge "$WD_RESUME_GRACE_SECS" ]; then
      DECISION="kill_rewake"; DECISION_REASON="stale_after_resume"
      marker_clear "resume-attempt"
      marker_clear "nudge"
      do_restart "$pane" restart
    else
      DECISION="waiting_resume"; DECISION_REASON="resumed_${rage}s_ago"
    fi
  elif [ -z "$nage" ]; then
    DECISION="nudged"; DECISION_REASON="stale_heartbeat"
    act_nudge "$pane"
    marker_write "nudge"
  elif [ "$nage" -ge "$WD_NUDGE_GRACE_SECS" ]; then
    if [ -n "$HB_SESSION_ID" ]; then
      DECISION="kill_resume"; DECISION_REASON="stale_after_nudge"
      marker_clear "nudge"
      do_restart "$pane" resume
    else
      DECISION="kill_rewake"; DECISION_REASON="stale_after_nudge"
      marker_clear "nudge"
      do_restart "$pane" restart
    fi
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
  mkdir -p "$WD_STATE_DIR" "$WD_STATE_DIR/$WD_MODE"
  mkdir -p "$(dirname "$WD_LEDGER_FILE")"
  acquire_lock
  decide_and_act
  # GSL-220 acceptance: EVERY tick leaves one ledger line carrying the decision
  # AND its basis — the observational run is readable from the ledger alone.
  ledger_emit "tick" "decision=${DECISION:-none}" "reason=${DECISION_REASON:-none}" \
    "class=${WD_CLASS:-none}" "class_reason=${WD_CLASS_REASON:-none}" \
    "hb_age=${HB_AGE:-none}" "hb_status=${HB_STATUS:-none}" "cycle=${HB_CYCLE:-none}" \
    "context_pct=${HB_CTX:-none}" "open_workers=${HB_WORKERS:-none}" \
    "platform=$PLATFORM_STATE" "platform_status=$PLATFORM_STATUS" \
    "platform_match=$PLATFORM_MATCH" "sessions=$PLATFORM_SESSIONS" \
    "repo_sessions=$PLATFORM_REPO_N" "tmux_alive=$TMUX_ALIVE" \
    "frozen=$FROZEN" "frozen_ticks=$FROZEN_TICKS" "frozen_span=$FROZEN_SPAN"
  log "DECISION=$DECISION reason=$DECISION_REASON class=${WD_CLASS:-none} mode=$WD_MODE hb_age=${HB_AGE:-none} hb_status=${HB_STATUS:-none} ctx=${HB_CTX:-none} workers=${HB_WORKERS:-none} platform=$PLATFORM_STATE/$PLATFORM_STATUS tmux=$TMUX_ALIVE dry_run=$DRY_RUN"
}

main
