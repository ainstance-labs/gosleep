#!/usr/bin/env bash
# =============================================================================
# gosleep lab — verifier-watch: the steps.log poller the contract demanded and
# nobody had built (GSL-218, epic GSL-178; audit finding 36).
#
# THE CONTRACT IT SERVES (SKILL.md "Verification watchdog" + E17): a browser
# verifier writes a `steps.log` heartbeat line around every action (~20s); ~3
# minutes of silence = a wedged automation that must be caught. The synthesis
# amendment is honoured honestly: protection from E17 rests on the fact that
# the ORCHESTRATOR spawns the verifier and owns it — this poller is not the
# barrier, it is the REACTION-TIME cut (20 min of "why is it quiet" -> 3 min
# of a loud named stall).
#
# TWO MODES:
#   --once      one mechanical check, for a pulse/tick: silent past the
#               threshold -> rc 1 (+ event), fresh -> rc 0. No sleeping.
#   (default)   poll every --interval seconds until the FIRST stall, then say
#               it loudly, mirror `verifier.stalled` into docs/lab/events/
#               (via lab-emit; GOSLEEP_LAB_DIR honoured -> fixture-safe) and
#               exit 1. A finished run is the orchestrator's to notice — it
#               owns both the verifier and this poller; --max-runtime (default
#               7200s) is the self-destruct so an orphaned poller cannot
#               outlive the night, exit 0 (watched, no stall seen).
#
# A MISSING file is a stall too once the threshold passes (--grace covers the
# verifier's boot: the file may legitimately not exist for the first minutes).
#
# Usage:
#   tools/lab/verifier-watch.sh --file docs/reports/verifications/<KEY>/runs/NN/steps.log \
#       [--threshold 180] [--interval 20] [--grace 180] [--once] [--actor NAME] [--max-runtime 7200]
#
# Exit: 0 fresh (or max-runtime reached without a stall) · 1 stall detected ·
#       2 usage error. 0 LLM calls. macOS bash 3.2 safe.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

FILE="" THRESHOLD=180 INTERVAL=20 GRACE=180 ONCE=0 ACTOR="verifier-watch" MAX_RUNTIME=7200
while [ $# -gt 0 ]; do
  case "$1" in
    --file)        FILE="${2:-}"; shift 2 ;;
    --threshold)   THRESHOLD="${2:-180}"; shift 2 ;;
    --interval)    INTERVAL="${2:-20}"; shift 2 ;;
    --grace)       GRACE="${2:-180}"; shift 2 ;;
    --actor)       ACTOR="${2:-verifier-watch}"; shift 2 ;;
    --max-runtime) MAX_RUNTIME="${2:-7200}"; shift 2 ;;
    --once)        ONCE=1; shift ;;
    --help|-h)     sed -n '2,36p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "verifier-watch: unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$FILE" ] || { echo "verifier-watch: --file is required" >&2; exit 2; }
case "$THRESHOLD$INTERVAL$GRACE$MAX_RUNTIME" in *[!0-9]*) echo "verifier-watch: numeric flags must be integers" >&2; exit 2 ;; esac

START="$(date +%s)"
mtime() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || echo ""; }

# silence_now -> prints the silence age and returns 0 if STALLED, 1 otherwise
check() {
  local now m age
  now="$(date +%s)"
  m="$(mtime "$FILE")"
  if [ -z "$m" ]; then
    # No file: inside the boot grace it is legitimate; past it, it IS the stall
    # (a verifier that never wrote a single step is the E17 shape exactly).
    age=$(( now - START ))
    if [ "$age" -ge "$GRACE" ]; then echo "$age"; return 0; fi
    echo "$age"; return 1
  fi
  age=$(( now - m ))
  [ "$age" -lt 0 ] && age=0
  if [ "$age" -ge "$THRESHOLD" ]; then echo "$age"; return 0; fi
  echo "$age"; return 1
}

stall() { # $1 = silence age
  echo "verifier-watch: STALL — '$FILE' silent for ${1}s (threshold ${THRESHOLD}s). E17 protocol: the orchestrator kills the wedged automation FIRST, reads the partial steps.log/report, then decides (SKILL.md 'Verification watchdog')." >&2
  bash "$SCRIPT_DIR/lab-emit.sh" event --type verifier.stalled --actor "$ACTOR" \
    --data "file=$FILE" --data "silent_secs=$1" --data "threshold=$THRESHOLD" >/dev/null 2>&1 \
    || echo "verifier-watch: WARNING: lab-emit failed (stall not mirrored to events)" >&2
  exit 1
}

if [ "$ONCE" = "1" ]; then
  AGE="$(check)" && stall "$AGE"
  echo "verifier-watch: fresh — '$FILE' last wrote ${AGE}s ago (threshold ${THRESHOLD}s)"
  exit 0
fi

echo "verifier-watch: watching '$FILE' (threshold ${THRESHOLD}s, interval ${INTERVAL}s, boot grace ${GRACE}s, max ${MAX_RUNTIME}s)"
while :; do
  AGE="$(check)" && stall "$AGE"
  if [ $(( $(date +%s) - START )) -ge "$MAX_RUNTIME" ]; then
    echo "verifier-watch: max-runtime ${MAX_RUNTIME}s reached with no stall — self-destructing (the run outlived its poller; arm a fresh one if it is still going)"
    exit 0
  fi
  sleep "$INTERVAL"
done
