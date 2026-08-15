#!/usr/bin/env bash
# =============================================================================
# tools/skills/tests/preflight-smoke.sh — asserts publish.sh's DB preflight
# early-fail (fix for verifier GSL-174-night finding M1).
#
# Given an unmigrated scratch DB (the `skills` table does not exist), invoking
# publish.sh must:
#   1. exit non-zero (rc=1 from the preflight step),
#   2. leave the backups dir empty (no cp -a happened),
#   3. leave the CHANGELOG.jsonl absent (no record-publish.ts write happened),
#   4. leave the production skill dir under $HOME/.claude/skills/<name>/ untouched.
#
# NOTHING in this smoke touches production paths — every mutable path is redirected
# under .artifacts/preflight-smoke/ via GOSLEEP_* env overrides.
#
# Exit codes:
#   0 — all four invariants held,
#   1 — one or more invariants broke (details on stderr).
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

WORK="$REPO_ROOT/.artifacts/preflight-smoke"
rm -rf "$WORK"
mkdir -p "$WORK/backups" "$WORK/changelog"

SCRATCH_DB="$WORK/gosleep.db"
BACKUPS_DIR="$WORK/backups"
CHANGELOG_PATH="$WORK/changelog/CHANGELOG.jsonl"

# Create an empty file at the DB path — Bun's Database will open it happily but the
# `skills` table will be missing, exactly the state a fresh checkout is in.
: > "$SCRATCH_DB"

# Env-nonce satisfies publish.sh's owner-gate in a hermetic (no-TTY) run.
export GOSLEEP_WEB_TOKEN="preflight-smoke-nonce-32-hex-chars-aa"
export GOSLEEP_DB_PATH="$SCRATCH_DB"
export GOSLEEP_SKILLS_BACKUPS_DIR="$BACKUPS_DIR"
export GOSLEEP_CHANGELOG_PATH="$CHANGELOG_PATH"

# Snapshot the mtime of the (real) production dir for the target skill so we can
# assert the preflight-fail did not touch it. If the dir does not exist, skip that
# assertion — the preflight fires before publish.sh would ever mkdir it.
TARGET_SKILL="handoff"
PROD_DIR="$HOME/.claude/skills/$TARGET_SKILL"
PROD_MTIME_BEFORE=""
if [ -d "$PROD_DIR" ]; then
  PROD_MTIME_BEFORE="$(stat -f %m "$PROD_DIR" 2>/dev/null || stat -c %Y "$PROD_DIR" 2>/dev/null || echo "")"
fi

set +e
bash "$REPO_ROOT/tools/skills/publish.sh" "$TARGET_SKILL" --yes \
  > "$WORK/stdout.log" 2> "$WORK/stderr.log"
RC=$?
set -e

FAIL=0

# 1. Non-zero rc.
if [ "$RC" -eq 0 ]; then
  echo "FAIL: publish.sh returned rc=0 against an unmigrated DB; expected non-zero." >&2
  FAIL=1
else
  echo "  PASS: publish.sh exit rc=$RC (non-zero, as expected)."
fi

# 2. Preflight fingerprint must appear in stderr (the check.fail event or the
# publish preflight banner) — otherwise we may be catching a *different* failure.
if ! grep -q -E 'DB preflight FAILED|skills.record-publish.check.fail' "$WORK/stderr.log"; then
  echo "FAIL: preflight fingerprint absent from stderr (unexpected failure path)." >&2
  echo "----- stderr tail:" >&2
  tail -n 25 "$WORK/stderr.log" >&2
  FAIL=1
else
  echo "  PASS: preflight fingerprint present in stderr."
fi

# 3. Backups dir must be empty (no cp -a happened).
if [ -n "$(ls -A "$BACKUPS_DIR" 2>/dev/null)" ]; then
  echo "FAIL: backups dir $BACKUPS_DIR is NOT empty — backup was written despite early-fail." >&2
  ls -la "$BACKUPS_DIR" >&2
  FAIL=1
else
  echo "  PASS: backups dir untouched."
fi

# 4. CHANGELOG.jsonl must not exist (record-publish.ts write never ran).
if [ -e "$CHANGELOG_PATH" ]; then
  echo "FAIL: $CHANGELOG_PATH exists — CHANGELOG was written despite early-fail." >&2
  ls -la "$CHANGELOG_PATH" >&2
  FAIL=1
else
  echo "  PASS: CHANGELOG.jsonl untouched."
fi

# 5. Production skill dir untouched (mtime comparison; only when it existed before).
if [ -n "$PROD_MTIME_BEFORE" ]; then
  PROD_MTIME_AFTER="$(stat -f %m "$PROD_DIR" 2>/dev/null || stat -c %Y "$PROD_DIR" 2>/dev/null || echo "")"
  if [ "$PROD_MTIME_BEFORE" != "$PROD_MTIME_AFTER" ]; then
    echo "FAIL: production skill dir $PROD_DIR mtime changed ($PROD_MTIME_BEFORE → $PROD_MTIME_AFTER)." >&2
    FAIL=1
  else
    echo "  PASS: production skill dir mtime unchanged."
  fi
fi

if [ "$FAIL" -eq 0 ]; then
  echo "preflight-smoke: OK — early-fail leaves backups + CHANGELOG untouched."
  exit 0
else
  echo "preflight-smoke: FAILED — one or more invariants broke." >&2
  echo "  logs under $WORK/" >&2
  exit 1
fi
