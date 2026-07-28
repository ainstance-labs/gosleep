#!/usr/bin/env bash
# =============================================================================
# gosleep lab — armed-check: the supervisor reality gate (GSL-211, epic GSL-178).
#
# THE LESSON IT ENCODES (audit F4 vs F1/F2/F3): a green 75-case smoke proved the
# watchdog's LOGIC and proved nothing about the MACHINE — armed with defaults it
# would have hunted a tmux session that does not exist and raised a second
# orchestrator beside the live one. This gate closes exactly that gap: it checks
# the supervisor's configuration AGAINST THE LIVE MACHINE, in seconds, with zero
# LLM calls. It is also the single source for the web's "armed / not armed"
# tile: the receipt lands in .artifacts/lab/gates/armed-check.json — the same
# gates directory the chronicler already reads.
#
# CHECKS (each one named in the receipt, with the reason when it is red):
#   config-valid   the watchdog itself accepts the config (a scratch --dry-run
#                  tick; exit 78 = invalid, and a mis-armed watchdog is worse
#                  than none)
#   session        the heartbeat's declared identity (session_id -> name ->
#                  legacy cwd-single fallback) is ALIVE in `claude agents
#                  --json` — the F2 killer: red on any alien/mismatched name
#   cadence        the measured heartbeat cadence fits the configured
#                  staleness threshold (median of recent gaps < WD_HB_STALE_SECS;
#                  a threshold below the real cadence = a false-stale storm)
#   plist          launchd carries com.gosleep.watchdog.plist (is anything
#                  SCHEDULED; informational for observe, required for "armed")
#   ledger         the watchdog ledger exists and how fresh it is (has the
#                  observational run actually been producing evidence)
#
# VERDICTS: armed | armed-unscheduled | observing | unarmed | misconfigured.
# Exit 0 = the machine is consistent with the resolved mode (green);
# exit 1 = something is misconfigured (red). "Not armed" is a FACT, not a
# failure — arming is the owner's step (GSL-220); lying about it would be.
#
# Usage: tools/lab/armed-check.sh [--json]     # --json: print the receipt too
# Env (tests): GOSLEEP_HB_FILE, GOSLEEP_AGENTS_JSON, GOSLEEP_WATCHDOG_PLIST,
#              GOSLEEP_GATES_DIR, WD_CONFIG (all default to the live paths).
# 0 LLM calls. python3 stdlib only. macOS bash 3.2 safe.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WD="$ROOT/tools/watchdog/watchdog.sh"
CONF="${WD_CONFIG:-$ROOT/tools/watchdog/watchdog.conf}"
HB="${GOSLEEP_HB_FILE:-$ROOT/docs/handoff/.orchestrator-heartbeat}"
PLIST="${GOSLEEP_WATCHDOG_PLIST:-$HOME/Library/LaunchAgents/com.gosleep.watchdog.plist}"
LEDGER_FILE="${GOSLEEP_WD_LEDGER:-$ROOT/docs/handoff/.watchdog-ledger.jsonl}"
GATES_DIR="${GOSLEEP_GATES_DIR:-$ROOT/.artifacts/lab/gates}"
JSON_OUT=0
[ "${1:-}" = "--json" ] && JSON_OUT=1

PASS=0; FAIL=0
NAMES=""; STATES=""; WHYS=""
note() { # name state why   (state: pass | fail | info)
  NAMES="$NAMES|$1"; STATES="$STATES|$2"; WHYS="$WHYS|$3"
  case "$2" in pass) PASS=$((PASS+1)); echo "  PASS: $1 — $3" ;;
               fail) FAIL=$((FAIL+1)); echo "  FAIL: $1 — $3" ;;
               *)    echo "  INFO: $1 — $3" ;;
  esac
}

# --- resolve the effective mode + staleness threshold the way the watchdog does
MODE_AND_STALE="$( ( [ -f "$CONF" ] && . "$CONF" >/dev/null 2>&1; \
  echo "${WD_MODE:-observe} ${WD_HB_STALE_SECS:-3900}" ) 2>/dev/null )"
MODE="${MODE_AND_STALE%% *}"; STALE="${MODE_AND_STALE##* }"
case "$STALE" in ''|*[!0-9]*) STALE=3900 ;; esac

if [ -f "$CONF" ]; then
  note "config-file" "info" "watchdog.conf present (mode=$MODE stale=${STALE}s)"
else
  note "config-file" "info" "no watchdog.conf — built-in defaults apply (mode=observe, observe is safe by construction)"
fi

# --- 1. config-valid: the watchdog itself must accept this config -------------
SCRATCH="$ROOT/.artifacts/lab/armed-check-scratch"
rm -rf "$SCRATCH"; mkdir -p "$SCRATCH"
rc=0
WD_CONFIG="$CONF" WD_STATE_DIR="$SCRATCH/state" WD_LEDGER_FILE="$SCRATCH/ledger.jsonl" \
  WD_HEARTBEAT_FILE="$HB" bash "$WD" --dry-run >/dev/null 2>&1 || rc=$?
if [ "$rc" -eq 0 ]; then
  note "config-valid" "pass" "watchdog accepts the config (scratch dry-run tick, rc=0)"
else
  note "config-valid" "fail" "watchdog refuses this config (rc=$rc; 78 = FATAL CONFIG ERROR — a mis-armed watchdog is worse than none)"
fi

# --- 2 + 3. session identity + cadence, judged from the live machine ----------
ROSTER=""
if [ -n "${GOSLEEP_AGENTS_JSON:-}" ]; then
  [ "$GOSLEEP_AGENTS_JSON" = "-" ] && ROSTER="[]" || ROSTER="$(cat "$GOSLEEP_AGENTS_JSON" 2>/dev/null || echo '')"
else
  ROSTER="$(claude agents --json 2>/dev/null || echo '')"
fi

SESSION_LINE="$(AC_ROOT="$ROOT" AC_HB="$HB" AC_STALE="$STALE" AC_ROSTER="$ROSTER" python3 - <<'PY'
import json, os, sys
from datetime import datetime, timezone

root, hb_path, stale = os.environ["AC_ROOT"], os.environ["AC_HB"], int(os.environ["AC_STALE"])
out = {"session": ("fail", "no verdict"), "cadence": ("fail", "no verdict")}

# roster
rows = None
raw = os.environ.get("AC_ROSTER", "")
if raw.strip():
    try:
        rows = json.loads(raw); assert isinstance(rows, list)
    except Exception:
        rows = None

# heartbeat tail + intervals
lines = []
try:
    with open(hb_path, encoding="utf-8", errors="replace") as f:
        for l in f:
            l = l.strip()
            if not l: continue
            try: lines.append(json.loads(l))
            except Exception: pass
except FileNotFoundError:
    pass

if not lines:
    out["session"] = ("fail", "no heartbeat at %s - nothing declares an identity" % hb_path)
    out["cadence"] = ("fail", "no heartbeat - cadence unmeasurable")
elif rows is None:
    out["session"] = ("fail", "claude agents --json unreadable - identity cannot be checked against the platform")
else:
    last = lines[-1]
    sid, name = last.get("session_id"), last.get("session")
    hit, how = None, None
    if sid:
        hit = next((r for r in rows if r.get("sessionId") == sid), None); how = "session_id"
    if hit is None and name:
        hit = next((r for r in rows if r.get("name") == name), None); how = "name"
    if hit is None and not sid and not name:
        cands = [r for r in rows if r.get("cwd") == root]
        if len(cands) == 1:
            hit, how = cands[0], "cwd_single(legacy heartbeat: no session fields yet)"
    if hit is not None:
        out["session"] = ("pass", "declared identity %s alive in the roster (matched by %s, status %s)"
                          % (hit.get("name"), how, hit.get("status")))
    else:
        repo_n = sum(1 for r in rows if r.get("cwd") == root)
        out["session"] = ("fail", "declared session %r / id %r NOT in claude agents --json (%d session(s) in this repo) - the F2 configuration lie, arming now would double-dispatch"
                          % (name, sid, repo_n))

if lines:
    def ts(r):
        try: return datetime.strptime(r["ts"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        except Exception: return None
    stamps = [t for t in (ts(r) for r in lines) if t]
    gaps = sorted((b - a).total_seconds() for a, b in zip(stamps, stamps[1:]) if (b - a).total_seconds() > 0)
    recent = gaps[-20:] if len(gaps) > 20 else gaps
    if not recent:
        out["cadence"] = ("fail", "not enough heartbeat lines to measure a cadence")
    else:
        med = recent[len(recent)//2]
        age = (datetime.now(timezone.utc) - stamps[-1]).total_seconds()
        if med > stale:
            out["cadence"] = ("fail", "median of recent gaps %.0fs EXCEEDS WD_HB_STALE_SECS=%ds - the threshold guarantees a false-stale storm (GSL-217: thresholds come from measurement)" % (med, stale))
        else:
            out["cadence"] = ("pass", "median of recent gaps %.0fs fits the %ds threshold (last line %.0fs ago)" % (med, stale, age))

for k in ("session", "cadence"):
    print("%s\t%s\t%s" % (k, out[k][0], out[k][1]))
PY
)"
while IFS=$'\t' read -r n s w; do [ -n "$n" ] && note "$n" "$s" "$w"; done <<EOF
$SESSION_LINE
EOF

# --- 4. plist: is anything scheduled ------------------------------------------
if [ -f "$PLIST" ]; then
  note "plist" "info" "launchd agent present at $PLIST (a tick is scheduled)"
  SCHEDULED=1
else
  note "plist" "info" "no launchd agent at $PLIST — nothing is scheduled; by the runbook the launchctl step is the OWNER's"
  SCHEDULED=0
fi

# --- 5. ledger: is the observational run producing evidence -------------------
if [ -f "$LEDGER_FILE" ]; then
  LLINES="$(grep -c . "$LEDGER_FILE" 2>/dev/null | tr -d ' ')"
  note "ledger" "info" "watchdog ledger has $LLINES line(s) (observational evidence exists)"
else
  note "ledger" "info" "no watchdog ledger yet — the observational run (GSL-220) has not produced evidence in this tree"
fi

# --- verdict ------------------------------------------------------------------
if [ "$FAIL" -gt 0 ]; then
  VERDICT="misconfigured"
elif [ "$MODE" = "armed" ] && [ "$SCHEDULED" = "1" ]; then
  VERDICT="armed"
elif [ "$MODE" = "armed" ]; then
  VERDICT="armed-unscheduled"
elif [ "$SCHEDULED" = "1" ]; then
  VERDICT="observing"
else
  VERDICT="unarmed"
fi

# --- receipt (the web's tile source; same directory, same shape as the gates) -
mkdir -p "$GATES_DIR"
AC_NAMES="$NAMES" AC_STATES="$STATES" AC_WHYS="$WHYS" AC_VERDICT="$VERDICT" \
AC_MODE="$MODE" AC_PASS="$PASS" AC_FAIL="$FAIL" AC_SCHEDULED="$SCHEDULED" \
python3 - > "$GATES_DIR/armed-check.json" <<'PY'
import json, os, time
names  = [x for x in os.environ["AC_NAMES"].split("|") if x]
states = [x for x in os.environ["AC_STATES"].split("|") if x]
whys   = [x for x in os.environ["AC_WHYS"].split("|") if x]
print(json.dumps({
    "gate": "armed-check",
    "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "pass": int(os.environ["AC_PASS"]),
    "fail": int(os.environ["AC_FAIL"]),
    "verdict": os.environ["AC_VERDICT"],
    "mode": os.environ["AC_MODE"],
    "scheduled": os.environ["AC_SCHEDULED"] == "1",
    "checks": [{"name": n, "state": s, "why": w} for n, s, w in zip(names, states, whys)],
    "runner": "tools/lab/armed-check.sh",
}, ensure_ascii=False))
PY
[ "$JSON_OUT" = "1" ] && cat "$GATES_DIR/armed-check.json"

echo "armed-check: verdict=$VERDICT mode=$MODE scheduled=$SCHEDULED pass=$PASS fail=$FAIL (receipt: $GATES_DIR/armed-check.json)"
[ "$FAIL" -eq 0 ]
