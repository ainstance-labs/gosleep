#!/usr/bin/env bash
# Sync the skill source-of-truth into the active Claude Code skills dir.
# Idempotent: re-run after editing skill/ to refresh the active skill.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/skill"
DEST="$HOME/.claude/skills/orchestrating-delivery-agents"

if [ ! -f "$SRC/SKILL.md" ]; then
  echo "error: $SRC/SKILL.md not found — run from the harness project root." >&2
  exit 1
fi

mkdir -p "$DEST"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "$SRC/" "$DEST/"
else
  rm -rf "$DEST" && mkdir -p "$DEST" && cp -R "$SRC/." "$DEST/"
fi
echo "installed: orchestrating-delivery-agents -> $DEST"
