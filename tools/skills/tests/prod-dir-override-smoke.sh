#!/usr/bin/env bash
# =============================================================================
# tools/skills/tests/prod-dir-override-smoke.sh — asserts the GSL-174
# verifier run 02 m-1 fix: publish.sh honors GOSLEEP_SKILLS_PROD_DIR so a
# hermetic verification can rsync into a scratch dir instead of the real
# $HOME/.claude/skills tree, while every existing refusal path stays intact.
#
# Invariants (each is its own PASS/FAIL line):
#
#   Group A — override actually redirects the destination:
#     A1. Announced "publish: prod = <PROD_ROOT>/<name>" carries the override,
#         not $HOME/.claude/skills.
#     A2. On a refused/aborted run (owner gate closed → rc=3), NEITHER the
#         override tree NOR the real global tree gets mkdir'd for this skill.
#
#   Group B — refusal paths unchanged under the override:
#     B1. No TTY + no GOSLEEP_WEB_TOKEN → rc=3 (owner-gate refusal). The
#         override does NOT relax the gate.
#     B2. CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS=1 (even with a nonce present)
#         → rc=3 refusal. Belt-and-braces still fires.
#     B3. Unmigrated DB (GOSLEEP_DB_PATH points at an empty file) → non-zero
#         with the preflight fingerprint on stderr. Preflight still runs.
#     B4. Bad shape (`--all`) → rc=2 usage refusal, no touch of the override
#         tree.
#
# Environment: fully hermetic under .artifacts/prod-dir-override-smoke/; no
# path outside REPO_ROOT/.artifacts/ is written. The real global tree
# ($HOME/.claude/skills/) is NEVER a destination and is snapshotted for
# mtime before/after to fail loud if that assumption ever cracks.
#
# Exit codes:
#   0 — all invariants held,
#   1 — one or more invariants broke (details on stderr).
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

WORK="$REPO_ROOT/.artifacts/prod-dir-override-smoke"
rm -rf "$WORK"
mkdir -p "$WORK/prod-scratch" "$WORK/backups" "$WORK/changelog" "$WORK/data"

PROD_ROOT_SCRATCH="$WORK/prod-scratch"
BACKUPS_DIR="$WORK/backups"
CHANGELOG_PATH="$WORK/changelog/CHANGELOG.jsonl"
SCRATCH_DB="$WORK/data/gosleep.db"
: > "$SCRATCH_DB"  # empty file → skills table missing → preflight will refuse

TARGET_SKILL="handoff"
REAL_PROD_DIR="$HOME/.claude/skills/$TARGET_SKILL"

# Snapshot the real global tree's mtime so we can PROVE the override kept it
# untouched. Missing is fine — the assertion is scoped to "no mkdir into it".
REAL_MTIME_BEFORE=""
REAL_EXISTED_BEFORE="no"
if [ -d "$REAL_PROD_DIR" ]; then
  REAL_EXISTED_BEFORE="yes"
  REAL_MTIME_BEFORE="$(stat -f %m "$REAL_PROD_DIR" 2>/dev/null || stat -c %Y "$REAL_PROD_DIR" 2>/dev/null || echo "")"
fi

FAIL=0

run_publish() {
  # $1 = label for logs; remaining args become argv to publish.sh.
  # env is passed by the caller via `env … run_publish …`.
  local label="$1"; shift
  local out="$WORK/${label}.stdout.log" err="$WORK/${label}.stderr.log"
  set +e
  bash "$REPO_ROOT/tools/skills/publish.sh" "$@" >"$out" 2>"$err"
  local rc=$?
  set -e
  echo "$rc" > "$WORK/${label}.rc"
  RC="$rc"
  STDERR="$err"
  STDOUT="$out"
}

# ---- A1 + B1: owner-gate closed under override → refusal, override announced ----

env -u GOSLEEP_WEB_TOKEN -u CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS \
    GOSLEEP_SKILLS_PROD_DIR="$PROD_ROOT_SCRATCH" \
    GOSLEEP_SKILLS_BACKUPS_DIR="$BACKUPS_DIR" \
    GOSLEEP_CHANGELOG_PATH="$CHANGELOG_PATH" \
    GOSLEEP_DB_PATH="$SCRATCH_DB" \
  bash -c "run_publish() { set +e; bash \"$REPO_ROOT/tools/skills/publish.sh\" \"\$@\" >\"$WORK/B1.stdout.log\" 2>\"$WORK/B1.stderr.log\"; echo \$? >\"$WORK/B1.rc\"; }; run_publish $TARGET_SKILL --yes </dev/null" || true

B1_RC="$(cat "$WORK/B1.rc" 2>/dev/null || echo 99)"
if [ "$B1_RC" = "3" ]; then
  echo "  PASS: B1 owner-gate refusal under override (rc=3)."
else
  echo "FAIL: B1 expected rc=3 (owner-gate refusal) under override, got rc=$B1_RC." >&2
  tail -n 20 "$WORK/B1.stderr.log" >&2
  FAIL=1
fi

# A1 — the "publish: prod = …" banner (printed AFTER the owner gate) must
# reflect the override root, not $HOME/.claude/skills. Asserted below on the
# B3 run (with env-nonce so we get past the owner gate to the banner).

# A2 — the override tree must NOT have been mkdir'd for this skill on a refused run.
if [ -d "$PROD_ROOT_SCRATCH/$TARGET_SKILL" ]; then
  echo "FAIL: A2 override tree got mkdir'd on a refused run: $PROD_ROOT_SCRATCH/$TARGET_SKILL" >&2
  FAIL=1
else
  echo "  PASS: A2 override tree not mkdir'd on refused run."
fi

# ---- B2: dangerously-skip-permissions still refuses under override ------------

env -u GOSLEEP_WEB_TOKEN \
    CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS=1 \
    GOSLEEP_SKILLS_PROD_DIR="$PROD_ROOT_SCRATCH" \
    GOSLEEP_SKILLS_BACKUPS_DIR="$BACKUPS_DIR" \
    GOSLEEP_CHANGELOG_PATH="$CHANGELOG_PATH" \
    GOSLEEP_DB_PATH="$SCRATCH_DB" \
  bash -c "bash \"$REPO_ROOT/tools/skills/publish.sh\" $TARGET_SKILL --yes </dev/null >\"$WORK/B2.stdout.log\" 2>\"$WORK/B2.stderr.log\"; echo \$? >\"$WORK/B2.rc\"" || true

B2_RC="$(cat "$WORK/B2.rc" 2>/dev/null || echo 99)"
if [ "$B2_RC" = "3" ]; then
  echo "  PASS: B2 CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS still refused (rc=3)."
else
  echo "FAIL: B2 expected rc=3 under CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS, got rc=$B2_RC." >&2
  tail -n 20 "$WORK/B2.stderr.log" >&2
  FAIL=1
fi

# ---- B3: unmigrated DB → preflight refusal under override ---------------------
# Uses env-nonce so we get PAST the owner gate — this is also the run that
# proves A1 (the "publish: prod = ..." banner reflects the override root).

env -u CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS \
    GOSLEEP_WEB_TOKEN="prod-dir-override-smoke-nonce-32-hex-aa" \
    GOSLEEP_SKILLS_PROD_DIR="$PROD_ROOT_SCRATCH" \
    GOSLEEP_SKILLS_BACKUPS_DIR="$BACKUPS_DIR" \
    GOSLEEP_CHANGELOG_PATH="$CHANGELOG_PATH" \
    GOSLEEP_DB_PATH="$SCRATCH_DB" \
  bash -c "bash \"$REPO_ROOT/tools/skills/publish.sh\" $TARGET_SKILL --yes </dev/null >\"$WORK/B3.stdout.log\" 2>\"$WORK/B3.stderr.log\"; echo \$? >\"$WORK/B3.rc\"" || true

B3_RC="$(cat "$WORK/B3.rc" 2>/dev/null || echo 99)"
if [ "$B3_RC" != "0" ] && grep -q -E 'DB preflight FAILED|skills.record-publish.check.fail' "$WORK/B3.stderr.log"; then
  echo "  PASS: B3 unmigrated-DB preflight still refused under override (rc=$B3_RC, fingerprint present)."
else
  echo "FAIL: B3 preflight refusal missing under override (rc=$B3_RC)." >&2
  tail -n 20 "$WORK/B3.stderr.log" >&2
  FAIL=1
fi

# A1 assertion (on the B3 stderr — this run passes the owner gate and reaches
# the "publish: prod = ..." banner before the preflight refuses).
if grep -qF "publish:   prod = $PROD_ROOT_SCRATCH/$TARGET_SKILL" "$WORK/B3.stderr.log"; then
  echo "  PASS: A1 override announced in banner ($PROD_ROOT_SCRATCH/$TARGET_SKILL)."
else
  echo "FAIL: A1 override banner missing on B3 stderr; publish.sh may not be honoring GOSLEEP_SKILLS_PROD_DIR." >&2
  echo "----- B3 stderr tail:" >&2
  tail -n 20 "$WORK/B3.stderr.log" >&2
  FAIL=1
fi

# ---- B4: --all is a hard usage refusal under override -------------------------

env GOSLEEP_SKILLS_PROD_DIR="$PROD_ROOT_SCRATCH" \
  bash -c "bash \"$REPO_ROOT/tools/skills/publish.sh\" --all </dev/null >\"$WORK/B4.stdout.log\" 2>\"$WORK/B4.stderr.log\"; echo \$? >\"$WORK/B4.rc\"" || true

B4_RC="$(cat "$WORK/B4.rc" 2>/dev/null || echo 99)"
if [ "$B4_RC" = "2" ]; then
  echo "  PASS: B4 --all still rejected under override (rc=2)."
else
  echo "FAIL: B4 expected rc=2 on --all under override, got rc=$B4_RC." >&2
  tail -n 20 "$WORK/B4.stderr.log" >&2
  FAIL=1
fi

# ---- REAL global tree untouched --------------------------------------------

if [ "$REAL_EXISTED_BEFORE" = "yes" ]; then
  REAL_MTIME_AFTER="$(stat -f %m "$REAL_PROD_DIR" 2>/dev/null || stat -c %Y "$REAL_PROD_DIR" 2>/dev/null || echo "")"
  if [ "$REAL_MTIME_BEFORE" != "$REAL_MTIME_AFTER" ]; then
    echo "FAIL: real global tree mtime changed ($REAL_MTIME_BEFORE → $REAL_MTIME_AFTER) — the override is leaky." >&2
    FAIL=1
  else
    echo "  PASS: real global tree ($REAL_PROD_DIR) mtime unchanged."
  fi
else
  # If the real dir didn't exist, prove none of the refused runs created it.
  if [ -d "$REAL_PROD_DIR" ]; then
    echo "FAIL: real global tree $REAL_PROD_DIR did not exist before but does now — the override is leaky." >&2
    FAIL=1
  else
    echo "  PASS: real global tree $REAL_PROD_DIR still absent (never mkdir'd)."
  fi
fi

if [ "$FAIL" -eq 0 ]; then
  echo "prod-dir-override-smoke: OK — override redirects destination; every refusal path intact."
  exit 0
else
  echo "prod-dir-override-smoke: FAILED — one or more invariants broke." >&2
  echo "  logs under $WORK/" >&2
  exit 1
fi
