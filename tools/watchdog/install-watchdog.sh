#!/usr/bin/env bash
# =============================================================================
# gosleep watchdog — plist renderer + install/uninstall INSTRUCTIONS (GSL-52).
#
# This script NEVER touches the system: it does NOT copy into
# ~/Library/LaunchAgents and it NEVER runs launchctl. It renders the launchd
# plist template into the repo's gitignored .artifacts/ and PRINTS the exact
# commands the owner would run. Loading the agent is the owner's decision
# (runbook: GSL-57).
#
# Usage:
#   install-watchdog.sh [--interval SECONDS] [--out PATH] [--print]
#     --interval   launchd StartInterval, default 180 (PRD R1.2: 2-5 min)
#     --out        where to write the rendered plist
#                  (default: <repo>/.artifacts/watchdog/com.gosleep.watchdog.plist)
#     --print      render to stdout instead of a file
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEMPLATE="$SCRIPT_DIR/com.gosleep.watchdog.plist.template"
LABEL="com.gosleep.watchdog"

INTERVAL=180
OUT="$REPO_ROOT/.artifacts/watchdog/$LABEL.plist"
PRINT=0

while [ $# -gt 0 ]; do
  case "$1" in
    --interval) shift; INTERVAL="${1:-}" ;;
    --out)      shift; OUT="${1:-}" ;;
    --print)    PRINT=1 ;;
    --help|-h)  sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "install-watchdog: unknown argument: $1" >&2; exit 78 ;;
  esac
  shift
done

[[ "$INTERVAL" =~ ^[0-9]+$ ]] || { echo "install-watchdog: --interval must be an integer" >&2; exit 78; }
if [ "$INTERVAL" -lt 120 ] || [ "$INTERVAL" -gt 300 ]; then
  echo "install-watchdog: WARNING: interval ${INTERVAL}s is outside the PRD range (120-300s)." >&2
fi
[ -f "$TEMPLATE" ] || { echo "install-watchdog: template not found: $TEMPLATE" >&2; exit 78; }

# PATH for launchd: current PATH is the best guess for where tmux/claude live.
RENDER_PATH="${WD_LAUNCHD_PATH:-$PATH}"

render() {
  sed -e "s|__REPO_ROOT__|$REPO_ROOT|g" \
      -e "s|__INTERVAL__|$INTERVAL|g" \
      -e "s|__PATH__|$RENDER_PATH|g" \
      "$TEMPLATE"
}

if [ "$PRINT" = "1" ]; then
  render
  exit 0
fi

mkdir -p "$(dirname "$OUT")"
render > "$OUT"

# Sanity: no placeholder left behind.
if grep -q "__[A-Z_]*__" "$OUT"; then
  echo "install-watchdog: FATAL: unsubstituted placeholder remains in $OUT" >&2
  exit 1
fi
# Validate plist syntax if plutil is available (macOS).
if command -v plutil >/dev/null 2>&1; then
  plutil -lint "$OUT" >/dev/null || { echo "install-watchdog: FATAL: rendered plist failed plutil -lint" >&2; exit 1; }
fi

cat <<EOF
Rendered: $OUT  (interval ${INTERVAL}s)

This script has NOT installed anything. To install (OWNER decision — runbook GSL-57):

  # 1. Put the rendered plist in place:
  cp "$OUT" ~/Library/LaunchAgents/$LABEL.plist

  # 2. Load it (modern launchctl):
  launchctl bootstrap gui/\$(id -u) ~/Library/LaunchAgents/$LABEL.plist

  # 3. Verify:
  launchctl print gui/\$(id -u)/$LABEL | head -20
  tail -f "$REPO_ROOT/.artifacts/watchdog/watchdog.log"

To UNINSTALL:

  launchctl bootout gui/\$(id -u)/$LABEL
  rm ~/Library/LaunchAgents/$LABEL.plist

Notes:
  * macOS sleep pauses BOTH the watchdog and the fleet (PRD Phase 1 risk):
    keep the machine awake (e.g. caffeinate) or accept that sleep pauses everything.
  * Config: copy watchdog.conf.example -> tools/watchdog/watchdog.conf and edit
    (session name, absolute tmux path for launchd). Do not commit watchdog.conf.
EOF
