#!/usr/bin/env bash
# =============================================================================
# gosleep — bg-preflight: is the break-glass path actually reachable tonight?
# (GSL-107 / R6.4; acceptance F6-S4.)
#
# Break-glass is the LAST line: Remote Control dies ~10 min after the phone goes
# offline, ntfy is one-way. This path — Tailscale + mosh + tmux — is the only one
# that gives full control of a live fleet from bed. It is also the path nobody
# exercises until the night it is needed, which is the worst moment to discover
# that one link of it was never installed.
#
# So this script walks the chain link by link and reports the WEAKEST one. Every
# link below is a NECESSARY condition for `tmux attach` from a phone; a chain
# that is four-fifths present is a chain that does not carry.
#
#   1. tailscale CLI     — present at all (App Store builds hide it in the bundle)
#   2. tailnet           — daemon running, this machine authorised, has an IP
#   3. SSH transport     — Tailscale SSH *or* system Remote Login; mosh bootstraps
#                          over SSH, so with neither, mosh cannot start at all
#   4. mosh-server       — on the Mac (mosh-client lives on the phone: not probeable)
#   5. tmux + a session  — something to attach TO
#
# What this script will NOT do: install anything, run `tailscale up`, enable
# Remote Login, or touch a pane. Bringing up a VPN and opening an SSH daemon on
# the owner's machine are the owner's decisions, made awake. Preflight reports.
#
# 0-LLM (C1): no model in the loop.
#
# Usage:  tools/breakglass/bg-preflight.sh          human-readable verdict
#         tools/breakglass/bg-preflight.sh --json   machine-readable, one object
# Exit:   0 = ready       (every link present)
#         1 = degraded    (chain exists but is broken somewhere a human must fix)
#         2 = unavailable (no Tailscale at all — the chain has no foundation)
# =============================================================================
set -uo pipefail

# ---- SURFACE ----------------------------------------------------------------
# Version-fragile knowledge lives HERE and nowhere else, same discipline as
# tools/rc/rc-preflight.sh. NOTE, and this matters for how the results below are
# reported: Tailscale is NOT installed on this machine (verified 2026-07-20), so
# these invocations are written from the documented surface and have NOT been
# exercised against a live daemon. That is exactly why every probe below has an
# "unknown" outcome distinct from "off" — see the read_* helpers.
TS_BIN_CANDIDATES=(
  "tailscale"                                                  # PATH (brew, standalone pkg)
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale"       # Mac App Store build: CLI inside the bundle
  "/usr/local/bin/tailscale"
  "/opt/homebrew/bin/tailscale"
)
TS_STATUS_CMD=(status --json)          # tailnet membership + peers
TS_PREFS_CMD=(debug prefs)             # carries RunSSH — whether Tailscale SSH is serving
TS_SSH_PREF_KEY="RunSSH"               # true => tailscaled terminates SSH itself
MOSH_SERVER_BIN="mosh-server"          # what the Mac side needs; the phone carries mosh-client
SSH_PORT=22
# -----------------------------------------------------------------------------

JSON_OUT=0
[[ "${1:-}" == "--json" ]] && JSON_OUT=1

# BG_SSHD_STATE lets the harness control the one input it cannot fake through
# PATH (a listening socket). Unset => probe for real. A verifier that cannot
# control its inputs proves nothing.
SSHD_STATE_OVERRIDE="${BG_SSHD_STATE:-auto}"

READY=0; DEGRADED=0; BROKEN=0
NOTES=()
note()  { NOTES+=("$1"); }
good()  { READY=$((READY+1));       [[ $JSON_OUT == 1 ]] || echo "  OK        $1"; }
warn()  { DEGRADED=$((DEGRADED+1)); [[ $JSON_OUT == 1 ]] || echo "  DEGRADED  $1"; }
dead()  { BROKEN=$((BROKEN+1));     [[ $JSON_OUT == 1 ]] || echo "  MISSING   $1"; }

[[ $JSON_OUT == 1 ]] || echo "== break-glass preflight (Tailscale + mosh + tmux) =="

# --- 1. Is there a Tailscale CLI at all? -------------------------------------
TS_BIN=""
for cand in "${TS_BIN_CANDIDATES[@]}"; do
  if [[ "$cand" == */* ]]; then
    [[ -x "$cand" ]] && { TS_BIN="$cand"; break; }
  else
    command -v "$cand" >/dev/null 2>&1 && { TS_BIN="$(command -v "$cand")"; break; }
  fi
done

if [[ -z "$TS_BIN" ]]; then
  dead "tailscale CLI not found — no tailnet, so no path to this machine from a phone"
  note "install is an OWNER step: a system VPN on the owner's machine is not an agent's call"
else
  good "tailscale CLI at $TS_BIN"
  [[ "$TS_BIN" == /Applications/* ]] && \
    note "CLI lives inside the .app bundle (App Store build) — symlink it onto PATH or the runbook's commands need the full path"
fi

# --- 2. Is this machine actually IN a tailnet? -------------------------------
# "Installed" and "reachable" are different sentences. A CLI that is present but
# logged out is a machine a phone cannot see.
TAILNET_STATE="unknown"; TS_IP=""
if [[ -n "$TS_BIN" ]]; then
  TS_STATUS="$(timeout 15 "$TS_BIN" "${TS_STATUS_CMD[@]}" 2>/dev/null)"
  if [[ -z "$TS_STATUS" ]]; then
    TAILNET_STATE="unknown"
    warn "tailscale ${TS_STATUS_CMD[*]} returned nothing — daemon down, or the surface moved; cannot judge membership"
  else
    TS_IP="$(python3 -c 'import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit()
ips=(d.get("Self") or {}).get("TailscaleIPs") or []
print(ips[0] if ips else "")' <<<"$TS_STATUS" 2>/dev/null)"
    BACKEND="$(python3 -c 'import json,sys
try: print((json.load(sys.stdin).get("BackendState") or ""))
except Exception: pass' <<<"$TS_STATUS" 2>/dev/null)"
    if [[ "$BACKEND" == "Running" && -n "$TS_IP" ]]; then
      TAILNET_STATE="up"; good "tailnet up — this machine is $TS_IP (no inbound port required)"
    elif [[ -n "$BACKEND" ]]; then
      # NB: the warn below is on its own line on purpose. The harness greps this script for
      # machine-mutating calls, and its comment-stripper only drops a line when the line STARTS
      # with a printer — so `STATE=x; warn "...tailscale up..."` would read as an actual invocation.
      TAILNET_STATE="down"
      warn "tailnet backend is '$BACKEND' — machine not connected; bringing it up is an owner step"
    else
      TAILNET_STATE="unknown"; warn "could not read backend state from status output — reporting unknown, not up"
    fi
  fi
fi

# --- 3. The SSH transport: mosh cannot bootstrap without one -----------------
# This is the link the chain most often lacks, because Tailscale being green
# *looks* like the job is done. It is not: mosh starts mosh-server by running it
# over SSH. With no SSH terminator, a perfectly healthy tailnet still gives no
# shell. Two independent providers, and ONE of them is enough.

# 3a. Tailscale SSH — tailscaled terminates SSH inside the tailnet. Nothing
#     listens on a machine port at all, which is the only way to satisfy
#     "without opening inbound ports" both in letter and in spirit.
TS_SSH="unknown"
if [[ -n "$TS_BIN" ]]; then
  TS_PREFS="$(timeout 15 "$TS_BIN" "${TS_PREFS_CMD[@]}" 2>/dev/null)"
  if [[ -n "$TS_PREFS" ]]; then
    case "$(python3 -c 'import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit()
v=d.get("'"$TS_SSH_PREF_KEY"'")
print("true" if v is True else ("false" if v is False else ""))' <<<"$TS_PREFS" 2>/dev/null)" in
      true)  TS_SSH="on" ;;
      false) TS_SSH="off" ;;
      *)     TS_SSH="unknown" ;;
    esac
  fi
fi

# 3b. System Remote Login — the classic path. Works with mosh, and opens :22 on
#     EVERY interface the Mac has, cafe Wi-Fi included.
if [[ "$SSHD_STATE_OVERRIDE" != "auto" ]]; then
  SSHD="$SSHD_STATE_OVERRIDE"
elif nc -z -G 2 localhost "$SSH_PORT" >/dev/null 2>&1; then
  SSHD="on"
else
  SSHD="off"
fi

case "$TS_SSH" in
  on)      good "Tailscale SSH is serving ($TS_SSH_PREF_KEY=true) — SSH terminates inside the tailnet, no machine port opens" ;;
  off)     note "Tailscale SSH is off ($TS_SSH_PREF_KEY=false)" ;;
  unknown) note "Tailscale SSH state UNKNOWN (no readable prefs) — reported as unknown, never rounded up to on" ;;
esac

if [[ "$SSHD" == "on" ]]; then
  good "system Remote Login is on — sshd answers on :$SSH_PORT"
  warn "…and :$SSH_PORT is open on EVERY interface, not just tailscale0 — see the runbook's ListenAddress recipe"
else
  note "system Remote Login is off — :$SSH_PORT closed (good for exposure; it also means this is NOT a transport right now)"
fi

# The verdict on link 3 is about the CHAIN, not about either provider.
if [[ "$TS_SSH" == "on" || "$SSHD" == "on" ]]; then
  :
elif [[ "$TS_SSH" == "unknown" ]]; then
  warn "no SSH transport could be CONFIRMED (Tailscale SSH unknown, Remote Login off) — mosh may have nothing to bootstrap over"
else
  warn "no SSH transport at all (Tailscale SSH off, Remote Login off) — mosh cannot start mosh-server, so the tailnet leads nowhere"
fi

# --- 4. mosh-server on this side ---------------------------------------------
if command -v "$MOSH_SERVER_BIN" >/dev/null 2>&1; then
  good "$MOSH_SERVER_BIN present — roaming survives a phone changing networks"
else
  warn "$MOSH_SERVER_BIN not installed — plain \`ssh\` still works over the tailnet, but every network change drops the session"
fi
note "mosh-client lives on the phone (Blink/Termius) — nothing here can probe it; that leg is verified by the owner only"

# --- 5. Something to attach TO ------------------------------------------------
if ! command -v tmux >/dev/null 2>&1; then
  warn "tmux not installed — nothing to attach to"
else
  SESSIONS="$(tmux list-sessions -F '#{session_name}' 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "${SESSIONS:-0}" -gt 0 ]]; then
    good "tmux server up with $SESSIONS session(s) — there is a live target for \`tmux attach\`"
  else
    warn "tmux is installed but no server/sessions are running — an attach tonight would find nothing"
  fi
fi

# --- 6. Verdict ---------------------------------------------------------------
# Tailscale missing is categorically different from a toggle being off: without
# it there is no chain to repair, only one to build.
if   (( BROKEN > 0 ));   then STATUS="unavailable"; CODE=2
elif (( DEGRADED > 0 )); then STATUS="degraded";    CODE=1
else                          STATUS="ready";       CODE=0
fi

if [[ $JSON_OUT == 1 ]]; then
  python3 - "$STATUS" "$TS_BIN" "$TAILNET_STATE" "$TS_SSH" "$SSHD" "$READY" "$DEGRADED" "$BROKEN" "${NOTES[@]}" <<'PY'
import json,sys
a=sys.argv
print(json.dumps({"status":a[1],"tailscale_bin":a[2],"tailnet":a[3],
  "tailscale_ssh":a[4],"remote_login":a[5],
  "ok":int(a[6]),"degraded":int(a[7]),"missing":int(a[8]),"notes":a[9:]},
  ensure_ascii=False))
PY
else
  for n in "${NOTES[@]}"; do echo "  note      $n"; done
  echo
  echo "VERDICT: $STATUS  (ok=$READY degraded=$DEGRADED missing=$BROKEN)"
  if (( CODE != 0 )); then
    echo "Installing Tailscale and enabling a transport are OWNER steps — see docs/runbooks/break-glass.md."
  fi
fi
exit $CODE
