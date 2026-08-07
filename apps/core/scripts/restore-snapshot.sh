#!/usr/bin/env bash
# =============================================================================
# @gosleep/core — restore from an atomic SQLite snapshot (GSL-261).
#
# Restore procedure per target-arch section 4.4:
#   1. Refuse to run while gosleep-core is holding the DB (`plist.sh status` returns loaded).
#      The operator MUST `plist.sh uninstall` first; otherwise WAL contention silently
#      partially-recovers and leaves the DB half-restored.
#   2. Move `gosleep.db` (and its WAL/SHM sidecars) aside to `gosleep.db.<ts>.bak` so a bad
#      restore is itself recoverable.
#   3. Copy the snapshot to `gosleep.db`, chmod 0600.
#   4. Run PRAGMA integrity_check on the restored file. If it fails, the aside-file is moved
#      back and we exit non-zero — never leave the operator with a corrupt live DB.
#
# Usage:
#   restore-snapshot.sh data/snapshots/pre-2026-08-07T18-00-00Z.db
#   GOSLEEP_DB_PATH=/tmp/x.db restore-snapshot.sh /tmp/snapshots/foo.db  (tests)
#
# Exit codes: 0 = restored, 1 = declined or failed. In the "declined" case the live DB is
# untouched (the operator can re-attempt after uninstalling launchd).
# =============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_ROOT="$(cd "$HERE/.." && pwd)"
REPO_ROOT="$(cd "$CORE_ROOT/../.." && pwd)"

DB_PATH="${GOSLEEP_DB_PATH:-$REPO_ROOT/data/gosleep.db}"

if [ $# -lt 1 ]; then
  echo "restore-snapshot: usage: restore-snapshot.sh <snapshot-file>" >&2
  exit 2
fi
SRC="$1"

if [ ! -f "$SRC" ]; then
  echo "restore-snapshot: snapshot not found: $SRC" >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "restore-snapshot: sqlite3 CLI not on PATH — install with 'brew install sqlite3'" >&2
  exit 1
fi

# Refuse to clobber a live gosleep-core. `plist.sh status` prints a one-line JSON with `loaded`
# and `pid` fields. If either indicates a live process, bail out. When plist.sh is not on the
# expected path (dev boxes, tests) we skip this guard — the operator is on their own.
PLIST_SH="$CORE_ROOT/plist.sh"
if [ -x "$PLIST_SH" ] && [ -z "${GOSLEEP_RESTORE_SKIP_LIVE_CHECK:-}" ]; then
  STATUS="$(bash "$PLIST_SH" status 2>/dev/null || true)"
  if printf '%s' "$STATUS" | grep -qE '"(loaded|pid)":[[:space:]]*("?[^0"][^,}]*|[1-9][0-9]*)'; then
    echo "restore-snapshot: gosleep-core appears loaded (status='$STATUS')." >&2
    echo "restore-snapshot: run 'bash apps/core/plist.sh uninstall' first." >&2
    exit 1
  fi
fi

TS="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
DB_DIR="$(dirname "$DB_PATH")"
mkdir -p "$DB_DIR"

BAK="$DB_PATH.$TS.bak"
if [ -f "$DB_PATH" ]; then
  mv -- "$DB_PATH" "$BAK"
  # WAL/SHM sidecars ride with the primary. If gosleep-core is truly down these should be safe
  # to remove; move them into the same backup family instead.
  for side in "-wal" "-shm"; do
    [ -f "$DB_PATH$side" ] && mv -- "$DB_PATH$side" "$BAK$side"
  done
  echo "restore-snapshot: moved current DB aside to $BAK"
fi

cp -p -- "$SRC" "$DB_PATH"
chmod 0600 "$DB_PATH"

# Validate the restored file before declaring victory. A snapshot that fails integrity_check is
# worse than useless — it invites silent corruption to propagate.
CHECK="$(sqlite3 "$DB_PATH" "PRAGMA integrity_check;" 2>&1 || true)"
if [ "$CHECK" != "ok" ]; then
  echo "restore-snapshot: integrity_check failed: $CHECK" >&2
  echo "restore-snapshot: rolling back to $BAK" >&2
  rm -f -- "$DB_PATH"
  mv -- "$BAK" "$DB_PATH" 2>/dev/null || true
  for side in "-wal" "-shm"; do
    [ -f "$BAK$side" ] && mv -- "$BAK$side" "$DB_PATH$side"
  done
  exit 1
fi

echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"event\":\"core.restore.ok\",\"src\":\"$SRC\",\"target\":\"$DB_PATH\",\"backup\":\"$BAK\"}"
