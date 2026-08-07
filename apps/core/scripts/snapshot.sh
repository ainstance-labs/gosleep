#!/usr/bin/env bash
# =============================================================================
# @gosleep/core — atomic SQLite snapshot (GSL-261).
#
# Uses `sqlite3 .backup` which is WAL-friendly and atomic: it locks the source only long
# enough to copy pages, so a running gosleep-core keeps serving reads while a snapshot happens.
# This is the same shape Warren uses (target-architecture section 4.4).
#
# Layout under `data/`:
#   data/snapshots/                 chmod 0700, never in git
#     daily-<ts>.db                 launchd-cron nightly runs (`com.gosleep.snapshot.plist`)
#     pre-<ts>.db                   before migrations (scripts/migrate.ts writes these directly)
#     pre-publish-<ts>.db           before skill publish (later task; the file naming is
#                                   reserved so retention below already handles it)
#     manual-<label>-<ts>.db        `snapshot.sh --label <label>` for operator-driven checkpoints
#
# Retention (executed at the end of every run):
#   - daily-*.db          keep 30 days (mtime cutoff)
#   - pre-*.db            keep the 5 most recent (post-migration audit trail)
#   - pre-publish-*.db    keep the 5 most recent
#   - manual-*.db         KEPT INDEFINITELY — operator-tagged, only the operator prunes
#
# Usage:
#   snapshot.sh                       # daily-<ts>.db
#   snapshot.sh --label myfix         # manual-myfix-<ts>.db
#   snapshot.sh --kind pre            # pre-<ts>.db (migrate.ts calls this indirectly)
#   GOSLEEP_DB_PATH=/tmp/x.db snapshot.sh    # override source path (tests)
#
# Exit codes: 0 on success, 1 on any snapshot failure. Retention failures WARN and continue —
# a full disk should never eat the primary DB.
# =============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_ROOT="$(cd "$HERE/.." && pwd)"
REPO_ROOT="$(cd "$CORE_ROOT/../.." && pwd)"

DB_PATH="${GOSLEEP_DB_PATH:-$REPO_ROOT/data/gosleep.db}"
SNAP_DIR="$(dirname "$DB_PATH")/snapshots"

KIND="daily"
LABEL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --kind)  KIND="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    -h|--help)
      grep -E '^# ' "$0" | sed 's/^# //'
      exit 0
      ;;
    *) echo "snapshot: unknown flag $1" >&2; exit 2 ;;
  esac
done

if [ ! -f "$DB_PATH" ]; then
  echo "snapshot: source DB not found at $DB_PATH" >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "snapshot: sqlite3 CLI not on PATH — install with 'brew install sqlite3'" >&2
  exit 1
fi

mkdir -p "$SNAP_DIR"
chmod 0700 "$SNAP_DIR"

TS="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
case "$KIND" in
  daily|pre|pre-publish) BASENAME="${KIND}-${TS}.db" ;;
  manual)
    if [ -z "$LABEL" ]; then
      echo "snapshot: --kind manual requires --label" >&2
      exit 2
    fi
    BASENAME="manual-${LABEL}-${TS}.db"
    ;;
  *) echo "snapshot: unknown --kind $KIND (want: daily|pre|pre-publish|manual)" >&2; exit 2 ;;
esac
TARGET="$SNAP_DIR/$BASENAME"

# .backup writes a fresh consistent copy; single-quote the path so labels with weird chars do
# not fool sqlite3's quoted-argument parser.
if ! sqlite3 "$DB_PATH" ".backup '$TARGET'"; then
  echo "snapshot: .backup failed" >&2
  exit 1
fi
chmod 0600 "$TARGET"

echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"event\":\"core.snapshot.ok\",\"kind\":\"$KIND\",\"path\":\"$TARGET\"}"

# ---- Retention ---------------------------------------------------------------------------
# `find -mtime` uses 24h-blocks; +30 = strictly older than 30 days.
find "$SNAP_DIR" -maxdepth 1 -type f -name 'daily-*.db' -mtime +30 -print -delete >/dev/null || \
  echo "snapshot: warn: daily-retention prune failed" >&2

# keep the N most recent by mtime; delete the rest. Portable macOS/GNU form via `ls -1t`.
prune_keep_last() {  # prune_keep_last <glob> <keep>
  local pattern="$1"
  local keep="$2"
  # shellcheck disable=SC2012  # ls sorting is fine here; filenames come from us.
  ls -1t "$SNAP_DIR"/$pattern 2>/dev/null | tail -n +"$((keep + 1))" | while read -r f; do
    rm -f -- "$f" || echo "snapshot: warn: could not prune $f" >&2
  done
}
prune_keep_last "pre-*.db"         5
prune_keep_last "pre-publish-*.db" 5
# manual-*.db is retained indefinitely — the label is a promise the operator made to future-self.
