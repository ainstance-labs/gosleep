#!/usr/bin/env bash
# =============================================================================
# gosleep — preflight-arm: the OWNER'S one command to arm the tick-carrier preflight night
# (GSL-201; decisions d-2026-07-28-003 "preflight BOTH carriers on one real night" and
# d-2026-07-28-005 "the owner picks the date; starting it must be one action").
#
# ⚠️ FOR THE OWNER'S HANDS. Agents prepare this script and never run it: installing a LaunchAgent
# (launchctl) is an owner-only act by standing rule. Running it as an agent is an incident.
#
# What one run does:
#   1. renders tools/lab/preflight/com.gosleep.tick.plist (the __REPO__ template) with THIS
#      checkout's absolute path into ~/Library/LaunchAgents/com.gosleep.tick.plist;
#   2. loads it (launchctl load) — launchd starts ticking every 300 s, one tick fires
#      immediately (RunAtLoad), each stamped carrier="launchd" in the ledger;
#   3. prints the SECOND carrier's arming instruction (Claude Desktop scheduled task — it cannot
#      be armed from a shell; it is a one-minute click-path in the app, printed verbatim);
#   4. prints how to read the verdict in the morning: tools/lab/tick-preflight-report.sh.
#
# The night itself runs on your usual setup (caffeinate etc.) — this script deliberately touches
# NO power settings: the preflight measures the carriers under the real night, not a staged one.
#
# Undo: tools/lab/preflight/preflight-disarm.sh (also owner-only).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TEMPLATE="$SCRIPT_DIR/com.gosleep.tick.plist"
TARGET="$HOME/Library/LaunchAgents/com.gosleep.tick.plist"

echo "gosleep preflight — arming the launchd carrier for repo: $REPO"
mkdir -p "$HOME/Library/LaunchAgents" "$REPO/.artifacts/lab"

sed "s|__REPO__|$REPO|g" "$TEMPLATE" > "$TARGET"
plutil -lint "$TARGET"

# `load -w` clears any stale disabled-flag from an earlier unload; bootstrapping twice is safe
# (launchctl reports "already loaded" and changes nothing).
launchctl unload "$TARGET" 2>/dev/null || true
launchctl load -w "$TARGET"
echo "launchd carrier ARMED: com.gosleep.tick, every 300 s, first tick fired just now."
echo "Check: tail -1 $REPO/docs/lab/supervision/tick-ledger.jsonl   (expect carrier=\"launchd\")"
echo
cat <<'DESKTOP'
── Second carrier: Claude Desktop scheduled task (cannot be armed from a shell) ──────────────
In the Claude Desktop app (must stay RUNNING all night — that is part of what the preflight
measures), create a scheduled task:

  1. Claude Desktop -> the scheduled tasks UI (Settings / Tasks, naming varies by version).
  2. Schedule: every 5 minutes (or the minimum the app allows).
  3. Task prompt — exactly this one line, nothing more:

     Run exactly this one command and reply with the single word done:
     bash __REPO__/tools/lab/tick.sh --carrier desktop --quiet

     (replace __REPO__ with the path printed above)

  4. Grant the task permission to run Bash commands when the app asks.

Honesty note: unlike launchd, every Desktop firing is a (small) agent session — tokens are spent
on the wrapper even when the tick itself exits idle. That cost, and the after-wake catch-up run
the Desktop scheduler promises, are exactly what the preflight night is measuring (question 5).
──────────────────────────────────────────────────────────────────────────────────────────────
DESKTOP
echo
echo "Morning after: bash tools/lab/tick-preflight-report.sh   (the per-carrier verdict table)"
