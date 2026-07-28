#!/usr/bin/env bash
# =============================================================================
# gosleep — preflight-disarm: the OWNER'S undo for preflight-arm.sh (GSL-201).
# ⚠️ FOR THE OWNER'S HANDS — launchctl is owner-only by standing rule.
# Unloads and removes the launchd carrier; reminds about the Desktop task (app-side, manual).
# =============================================================================
set -euo pipefail

TARGET="$HOME/Library/LaunchAgents/com.gosleep.tick.plist"

if [ -f "$TARGET" ]; then
  launchctl unload -w "$TARGET" 2>/dev/null || true
  rm -f "$TARGET"
  echo "launchd carrier DISARMED: com.gosleep.tick unloaded and removed."
else
  echo "launchd carrier already absent ($TARGET not found) — nothing to do."
fi
echo "Desktop carrier: delete/pause the scheduled task inside the Claude Desktop app (manual)."
