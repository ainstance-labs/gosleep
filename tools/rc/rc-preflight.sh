#!/usr/bin/env bash
# =============================================================================
# gosleep — rc-preflight: the ONE place that knows Remote Control's surface.
# (GSL-104 / R6.1; acceptance F6-S1.)
#
# Remote Control is a research preview: its flags, its slash command and its
# settings keys are all free to move under us. So nothing else in this repo is
# allowed to name them. Orchestrator briefs, runbooks and the skill layer ask
# THIS script "is the phone path ready?" and read the verdict. When Anthropic
# renames something, exactly one block below changes — the SURFACE block.
#
# This script deliberately does NOT start Remote Control. Pairing is a QR scan
# between a terminal and a human's phone; there is no headless path, and a
# script that pretended otherwise would be theatre. Preflight answers the part
# a machine CAN answer — is the surface present, are both push toggles on —
# and names the human step it cannot take.
#
# 0-LLM (C1): no `claude -p`, no model in the loop. Only --version/--help.
#
# Usage:  tools/rc/rc-preflight.sh          human-readable verdict
#         tools/rc/rc-preflight.sh --json   machine-readable, one JSON object
# Exit:   0 = ready (surface present, both toggles on)
#         1 = degraded (surface present, something a human must flip)
#         2 = unavailable (no CLI, or the CLI is too old to pair at all)
# =============================================================================
set -uo pipefail

# ---- SURFACE (verified by hand against CLI 2.1.215 on 2026-07-20) -----------
# Everything version-fragile lives here and nowhere else.
RC_FLAG="--remote-control"                       # `claude --remote-control [name]` — pair a NEW session at start
RC_FLAG_PREFIX="--remote-control-session-name-prefix"
RC_SUBCOMMAND="remote-control"                   # `claude remote-control` — server mode; HIDDEN from --help, alias `rc`
RC_SLASH="/rc"                                   # in-session toggle (alias of /remote-control) — pairs a LIVE session
RC_MIN_VERSION="2.1.181"                         # presence-file suppression lands here (research 05 §6-1)
RC_PRESENCE_ENV="CLAUDE_CLIENT_PRESENCE_FILE"    # set => push suppressed while that file exists
RC_STARTUP_KEY="remoteControlAtStartup"          # settings key: pair automatically on session start
# Push toggles. Labels are what the owner sees in /config; both default to FALSE
# when the key is absent (binary: `t.<key> ?? !1`), so ABSENT means OFF, not on.
RC_TOGGLE_DECIDES="agentPushNotifEnabled"        # "Push when Claude decides"
RC_TOGGLE_ACTIONS="inputNeededNotifEnabled"      # "Push when actions required"
# The "actions required" row is additionally gated server-side by the
# tengu_kairos_input_needed_push flag: when that gate is off the row is not
# rendered in /config at all, and the only way in is the settings file.
# -----------------------------------------------------------------------------

JSON_OUT=0
[[ "${1:-}" == "--json" ]] && JSON_OUT=1

# RC_SETTINGS_FILE exists so the harness can point preflight at a throwaway
# settings file. A verifier that cannot control its input proves nothing.
USER_SETTINGS="${RC_SETTINGS_FILE:-$HOME/.claude/settings.json}"

READY=0; DEGRADED=0; BROKEN=0
NOTES=()
note()  { NOTES+=("$1"); }
good()  { READY=$((READY+1));       [[ $JSON_OUT == 1 ]] || echo "  OK        $1"; }
warn()  { DEGRADED=$((DEGRADED+1)); [[ $JSON_OUT == 1 ]] || echo "  DEGRADED  $1"; }
dead()  { BROKEN=$((BROKEN+1));     [[ $JSON_OUT == 1 ]] || echo "  MISSING   $1"; }

[[ $JSON_OUT == 1 ]] || echo "== Remote Control preflight =="

# --- 1. CLI present and new enough -------------------------------------------
CLI_VERSION=""
if ! command -v claude >/dev/null 2>&1; then
  dead "claude CLI not on PATH — no pairing surface at all"
else
  CLI_VERSION="$(claude --version 2>/dev/null | awk '{print $1}')"
  if [[ -z "$CLI_VERSION" ]]; then
    dead "claude --version returned nothing — cannot judge the surface"
  elif [[ "$(printf '%s\n%s\n' "$RC_MIN_VERSION" "$CLI_VERSION" | sort -V | head -1)" != "$RC_MIN_VERSION" ]]; then
    dead "CLI $CLI_VERSION is older than $RC_MIN_VERSION — presence suppression absent"
  else
    good "CLI $CLI_VERSION (>= $RC_MIN_VERSION)"
  fi
fi

# --- 2. The three pairing surfaces -------------------------------------------
# They are not interchangeable, and the difference is the whole point for us:
# the orchestrator is ALREADY RUNNING, so only the slash command can reach it.
HELP=""
[[ -n "$CLI_VERSION" ]] && HELP="$(claude --help 2>/dev/null)"

if [[ -n "$HELP" ]] && grep -q -- "$RC_FLAG " <<<"$HELP"; then
  good "flag  \`claude $RC_FLAG [name]\` — pairs a NEW session at start"
else
  warn "flag  \`claude $RC_FLAG\` not in --help — surface moved; re-verify by hand"
fi

if [[ -n "$CLI_VERSION" ]] && timeout 60 claude "$RC_SUBCOMMAND" --help >/dev/null 2>&1; then
  good "server \`claude $RC_SUBCOMMAND\` — hidden from --help, alias \`rc\`, multi-session"
else
  warn "server \`claude $RC_SUBCOMMAND\` did not answer --help — server mode unavailable"
fi

# The slash command is in-session React; there is no honest way to probe it from
# a shell. We report it as the documented path and say plainly that it is unproven
# here — rather than printing a green tick we did not earn.
note "slash \`$RC_SLASH [name]\` toggles RC on a LIVE session (only path for an already-running orchestrator); not probeable from a shell"

# --- 3. Push toggles ----------------------------------------------------------
read_toggle() {  # $1 = key; echoes true|false|absent
  [[ -f "$USER_SETTINGS" ]] || { echo absent; return; }
  python3 - "$USER_SETTINGS" "$1" <<'PY' 2>/dev/null || echo absent
import json,sys
try: d=json.load(open(sys.argv[1]))
except Exception: print("absent"); sys.exit()
v=d.get(sys.argv[2])
print("absent" if v is None else ("true" if v is True else "false"))
PY
}

T_DECIDES="$(read_toggle "$RC_TOGGLE_DECIDES")"
T_ACTIONS="$(read_toggle "$RC_TOGGLE_ACTIONS")"

case "$T_DECIDES" in
  true) good "push  \"Push when Claude decides\"   ($RC_TOGGLE_DECIDES=true)" ;;
  *)    warn "push  \"Push when Claude decides\"   is OFF ($RC_TOGGLE_DECIDES=$T_DECIDES) — /config, or set it in $USER_SETTINGS" ;;
esac
case "$T_ACTIONS" in
  true) good "push  \"Push when actions required\" ($RC_TOGGLE_ACTIONS=true)" ;;
  *)    warn "push  \"Push when actions required\" is OFF ($RC_TOGGLE_ACTIONS=$T_ACTIONS) — permission prompts will NOT reach the phone" ;;
esac

# --- 4. Presence suppression ---------------------------------------------------
if [[ -n "${!RC_PRESENCE_ENV:-}" ]]; then
  if [[ -e "${!RC_PRESENCE_ENV}" ]]; then
    note "$RC_PRESENCE_ENV set and the marker EXISTS — push is suppressed right now (owner counts as present)"
  else
    note "$RC_PRESENCE_ENV set, marker absent — push flows normally"
  fi
else
  note "$RC_PRESENCE_ENV unset — no presence suppression configured"
fi

# --- 5. Verdict ----------------------------------------------------------------
if   (( BROKEN > 0 ));   then STATUS="unavailable"; CODE=2
elif (( DEGRADED > 0 )); then STATUS="degraded";    CODE=1
else                          STATUS="ready";       CODE=0
fi

if [[ $JSON_OUT == 1 ]]; then
  python3 - "$STATUS" "$CLI_VERSION" "$T_DECIDES" "$T_ACTIONS" "$READY" "$DEGRADED" "$BROKEN" "${NOTES[@]}" <<'PY'
import json,sys
a=sys.argv
print(json.dumps({"status":a[1],"cli_version":a[2],
  "push_when_claude_decides":a[3],"push_when_actions_required":a[4],
  "ok":int(a[5]),"degraded":int(a[6]),"missing":int(a[7]),"notes":a[8:]},
  ensure_ascii=False))
PY
else
  for n in "${NOTES[@]}"; do echo "  note      $n"; done
  echo
  echo "VERDICT: $STATUS  (ok=$READY degraded=$DEGRADED missing=$BROKEN)"
  if (( CODE != 0 )); then
    echo "Pairing itself is a human step — see docs/runbooks/remote-control.md."
  fi
fi
exit $CODE
