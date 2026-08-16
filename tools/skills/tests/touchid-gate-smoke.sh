#!/usr/bin/env bash
# =============================================================================
# tools/skills/tests/touchid-gate-smoke.sh — asserts publish.sh's TouchID
# physical-gesture gate wiring (GSL-288; target-architecture rev 2 §7.3
# "Приоритет 1", rev-3 addendum Delta 4 items 3-4).
#
# Owner ruling (2026-08-16): the gate SHIPS DEFAULT-OFF behind
# `GOSLEEP_TOUCHID=1`. This smoke locks the default-off inert-stub path, all
# four opt-in exit codes, both bypass-guard branches, and two explicit
# prod-path bypass-refusal cases that mirror the GSL-254 test-guard pattern
# (fail-closed against any resolved production destination even under opt-in).
#
#   Group E — DEFAULT-OFF stub is inert; publish flows are unchanged:
#     E1. No GOSLEEP_TOUCHID → publish proceeds under the pre-GSL-288
#         owner-gate (`--yes` + env-nonce). The gate's "OFF (stub; ...)"
#         breadcrumb is logged; no "touchid gate rc=" line, no "TouchID
#         denied", no other gate fingerprint fires; override tree populated.
#         Setting GOSLEEP_TOUCHID_BYPASS=1 with the flag off does NOT trigger
#         the bypass refusal path either — the whole block is skipped.
#
#   Group C — GOSLEEP_TOUCHID=1 + exit code steers the flow:
#     C1. Mock gate rc=0 → publish proceeds; CHANGELOG row written; rsync
#         landed in the hermetic PROD_DIR override.
#     C2. Mock gate rc=1 → publish exits 3, NO rsync, NO backup, NO CHANGELOG.
#     C3. Mock gate rc=2 (no sensor) + no TTY (hermetic pipe context) →
#         publish exits 3 with the "no owner-presence path available"
#         fingerprint; NO mutation of the override tree.
#     C4. Mock gate rc=3 (framework error) → publish exits 3; NO mutation.
#
#   Group D — GOSLEEP_TOUCHID_BYPASS guards under opt-in:
#     D1. BYPASS=1 WITHOUT the hermetic path overrides → refuses with exit 3
#         (prevents accidental production bypass).
#     D2. BYPASS=1 WITH the hermetic overrides → skips the gate, proceeds.
#     D3. BYPASS=1 + GOSLEEP_SKILLS_PROD_DIR=$HOME/.claude/skills (real prod
#         tree) → refuses even though BACKUPS_DIR is hermetic. Fail-closed
#         against the real global skills tree.
#     D4. BYPASS=1 + GOSLEEP_SKILLS_BACKUPS_DIR=$REPO_ROOT/docs/skills/backups
#         (real prod backups tree) → refuses even though PROD_DIR is
#         hermetic. Fail-closed against the real production backups path.
#
# Every mutable path is redirected under .artifacts/touchid-gate-smoke/ via
# GOSLEEP_* env overrides. The real global tree $HOME/.claude/skills/ is
# snapshotted for mtime before/after so a leaky override fails loud. The mock
# gate binary is written to $WORK/mock-gate and reads the desired exit code
# from $WORK/mock-gate-rc — it NEVER touches LocalAuthentication or invokes
# the real .app bundle, so this smoke never triggers a biometric dialog.
#
# Exit codes:
#   0 — all invariants held,
#   1 — one or more invariants broke (details on stderr).
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

WORK="$REPO_ROOT/.artifacts/touchid-gate-smoke"
rm -rf "$WORK"
mkdir -p "$WORK/prod-scratch" "$WORK/backups" "$WORK/changelog" "$WORK/data"

PROD_ROOT_SCRATCH="$WORK/prod-scratch"
BACKUPS_DIR="$WORK/backups"
CHANGELOG_PATH="$WORK/changelog/CHANGELOG.jsonl"

# The gate (when opt-in) runs AFTER the DB preflight, so we need a real
# (migrated) DB or the preflight will refuse before we ever exercise the gate.
SCRATCH_DB="$WORK/data/gosleep.db"
if ! (cd "$REPO_ROOT" && GOSLEEP_DB_PATH="$SCRATCH_DB" bun run apps/core/scripts/migrate.ts) \
     >"$WORK/migrate.stdout.log" 2>"$WORK/migrate.stderr.log"; then
  echo "touchid-gate-smoke: FAILED — could not migrate scratch DB." >&2
  tail -n 20 "$WORK/migrate.stderr.log" >&2
  exit 1
fi

TARGET_SKILL="handoff"
REAL_PROD_DIR="$HOME/.claude/skills/$TARGET_SKILL"
REAL_BACKUPS_ROOT="$REPO_ROOT/docs/skills/backups"

REAL_MTIME_BEFORE=""
REAL_EXISTED_BEFORE="no"
if [ -d "$REAL_PROD_DIR" ]; then
  REAL_EXISTED_BEFORE="yes"
  REAL_MTIME_BEFORE="$(stat -f %m "$REAL_PROD_DIR" 2>/dev/null || stat -c %Y "$REAL_PROD_DIR" 2>/dev/null || echo "")"
fi

# Also snapshot the real prod backups root (docs/skills/backups) so D4 can
# prove the fail-closed guard is real — a bypass that landed anything in
# there would flip the mtime.
REAL_BACKUPS_MTIME_BEFORE=""
REAL_BACKUPS_EXISTED_BEFORE="no"
if [ -d "$REAL_BACKUPS_ROOT" ]; then
  REAL_BACKUPS_EXISTED_BEFORE="yes"
  REAL_BACKUPS_MTIME_BEFORE="$(stat -f %m "$REAL_BACKUPS_ROOT" 2>/dev/null || stat -c %Y "$REAL_BACKUPS_ROOT" 2>/dev/null || echo "")"
fi

# ---- mock gate binary --------------------------------------------------------
#
# publish.sh's gate_run() sees a plain executable at GOSLEEP_TOUCHID_GATE_BIN
# (not a .app bundle dir) and invokes it directly. The mock reads its desired
# exit code from $WORK/mock-gate-rc so each test case can rewrite it without
# touching the script itself.
cat >"$WORK/mock-gate" <<'MOCK'
#!/usr/bin/env bash
# Test mock — reads exit code from an rc-file next to itself. NEVER touches
# LocalAuthentication; safe to invoke from any CI without a biometric sensor.
RC_FILE="$(dirname "$0")/mock-gate-rc"
if [ -r "$RC_FILE" ]; then
  RC="$(cat "$RC_FILE" | tr -d '[:space:]')"
else
  RC=0
fi
echo "mock-gate: invoked with reason='${1:-}' rc=$RC" >&2
exit "${RC:-0}"
MOCK
chmod +x "$WORK/mock-gate"

FAIL=0

# Reset the hermetic filesystem state between cases so each assertion is
# unambiguous.
reset_state() {
  rm -rf "$PROD_ROOT_SCRATCH" "$BACKUPS_DIR" "$CHANGELOG_PATH"
  mkdir -p "$PROD_ROOT_SCRATCH" "$BACKUPS_DIR"
  : > "$CHANGELOG_PATH"
}

# ---- E1: default-off inert stub ----------------------------------------------
# NO GOSLEEP_TOUCHID → gate is inert; publish must proceed via the pre-GSL-288
# owner-gate (env-nonce + --yes). Also set GOSLEEP_TOUCHID_BYPASS=1 to prove
# the bypass guard is dormant when the flag is off (would otherwise fire).
reset_state
echo "0" > "$WORK/mock-gate-rc"
set +e
env -u CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS \
    -u GOSLEEP_TOUCHID \
    GOSLEEP_WEB_TOKEN="touchid-gate-smoke-nonce-32-hex-chars-a" \
    GOSLEEP_SKILLS_PROD_DIR="$PROD_ROOT_SCRATCH" \
    GOSLEEP_SKILLS_BACKUPS_DIR="$BACKUPS_DIR" \
    GOSLEEP_CHANGELOG_PATH="$CHANGELOG_PATH" \
    GOSLEEP_DB_PATH="$SCRATCH_DB" \
    GOSLEEP_TOUCHID_GATE_BIN="$WORK/mock-gate" \
    GOSLEEP_TOUCHID_BYPASS=1 \
  bash -c "bash \"$REPO_ROOT/tools/skills/publish.sh\" $TARGET_SKILL --yes </dev/null \
           >\"$WORK/E1.stdout.log\" 2>\"$WORK/E1.stderr.log\"; echo \$? >\"$WORK/E1.rc\""
set -e
E1_RC="$(cat "$WORK/E1.rc" 2>/dev/null || echo 99)"
if [ "$E1_RC" = "0" ] \
   && [ -d "$PROD_ROOT_SCRATCH/$TARGET_SKILL" ] \
   && grep -q 'touchid gate: OFF (stub' "$WORK/E1.stderr.log" \
   && ! grep -q 'touchid gate rc=' "$WORK/E1.stderr.log" \
   && ! grep -q 'refusing bypass' "$WORK/E1.stderr.log" \
   && ! grep -q 'TouchID denied' "$WORK/E1.stderr.log"; then
  echo "  PASS: E1 default-off → inert stub logged, publish proceeded via pre-GSL-288 owner-gate."
else
  echo "FAIL: E1 default-off failed — expected rc=0 + stub log + no gate/bypass fingerprints." >&2
  echo "  rc=$E1_RC, override present? $([ -d "$PROD_ROOT_SCRATCH/$TARGET_SKILL" ] && echo yes || echo no)" >&2
  tail -n 40 "$WORK/E1.stderr.log" >&2
  FAIL=1
fi

# ---- helper for opt-in cases (C1-C4, D1-D2) ---------------------------------
run_case() {
  # $1 = label, $2 = mock exit code, remaining args = env prefix pairs "KEY=val"
  local label="$1" mock_rc="$2"; shift 2
  echo "$mock_rc" > "$WORK/mock-gate-rc"
  local -a envs=(
    "GOSLEEP_TOUCHID=1"
    "GOSLEEP_WEB_TOKEN=touchid-gate-smoke-nonce-32-hex-chars-a"
    "GOSLEEP_SKILLS_PROD_DIR=$PROD_ROOT_SCRATCH"
    "GOSLEEP_SKILLS_BACKUPS_DIR=$BACKUPS_DIR"
    "GOSLEEP_CHANGELOG_PATH=$CHANGELOG_PATH"
    "GOSLEEP_DB_PATH=$SCRATCH_DB"
    "GOSLEEP_TOUCHID_GATE_BIN=$WORK/mock-gate"
  )
  for pair in "$@"; do envs+=("$pair"); done
  set +e
  env -u CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS "${envs[@]}" \
    bash -c "bash \"$REPO_ROOT/tools/skills/publish.sh\" $TARGET_SKILL --yes </dev/null \
             >\"$WORK/${label}.stdout.log\" 2>\"$WORK/${label}.stderr.log\"; echo \$? >\"$WORK/${label}.rc\""
  set -e
}

# ---- C1: mock rc=0 → publish proceeds ---------------------------------------
reset_state
run_case C1 0
C1_RC="$(cat "$WORK/C1.rc" 2>/dev/null || echo 99)"
if [ "$C1_RC" = "0" ] && [ -d "$PROD_ROOT_SCRATCH/$TARGET_SKILL" ] \
   && grep -q 'touchid gate rc=0' "$WORK/C1.stderr.log"; then
  echo "  PASS: C1 opt-in + gate rc=0 → publish proceeded, gate log line present."
else
  echo "FAIL: C1 expected rc=0 + override tree populated + gate log; got rc=$C1_RC." >&2
  tail -n 30 "$WORK/C1.stderr.log" >&2
  FAIL=1
fi

# ---- C2: mock rc=1 → publish exits 3, no rsync ------------------------------
reset_state
run_case C2 1
C2_RC="$(cat "$WORK/C2.rc" 2>/dev/null || echo 99)"
if [ "$C2_RC" = "3" ] \
   && [ ! -d "$PROD_ROOT_SCRATCH/$TARGET_SKILL" ] \
   && grep -q 'TouchID denied' "$WORK/C2.stderr.log"; then
  echo "  PASS: C2 opt-in + gate rc=1 → publish refused (rc=3), no rsync, 'TouchID denied' fingerprint."
else
  echo "FAIL: C2 expected rc=3 refusal + no rsync + fingerprint; got rc=$C2_RC." >&2
  tail -n 30 "$WORK/C2.stderr.log" >&2
  FAIL=1
fi

# ---- C3: mock rc=2 (no sensor) + no TTY → publish exits 3 --------------------
reset_state
run_case C3 2
C3_RC="$(cat "$WORK/C3.rc" 2>/dev/null || echo 99)"
if [ "$C3_RC" = "3" ] \
   && [ ! -d "$PROD_ROOT_SCRATCH/$TARGET_SKILL" ] \
   && grep -q 'no owner-presence path available' "$WORK/C3.stderr.log"; then
  echo "  PASS: C3 opt-in + gate rc=2 + no TTY → publish refused with sensorless-pipe fingerprint."
else
  echo "FAIL: C3 expected rc=3 refusal + no rsync + 'no owner-presence path available'; got rc=$C3_RC." >&2
  tail -n 30 "$WORK/C3.stderr.log" >&2
  FAIL=1
fi

# ---- C4: mock rc=3 (framework error) → publish exits 3 -----------------------
reset_state
run_case C4 3
C4_RC="$(cat "$WORK/C4.rc" 2>/dev/null || echo 99)"
if [ "$C4_RC" = "3" ] \
   && [ ! -d "$PROD_ROOT_SCRATCH/$TARGET_SKILL" ] \
   && grep -q 'TouchID framework error' "$WORK/C4.stderr.log"; then
  echo "  PASS: C4 opt-in + gate rc=3 → publish refused with framework-error fingerprint."
else
  echo "FAIL: C4 expected rc=3 refusal + no rsync + framework-error fingerprint; got rc=$C4_RC." >&2
  tail -n 30 "$WORK/C4.stderr.log" >&2
  FAIL=1
fi

# ---- D1: opt-in + BYPASS=1 without hermetic overrides → refusal --------------
reset_state
echo "0" > "$WORK/mock-gate-rc"
set +e
env -u CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS \
    -u GOSLEEP_SKILLS_PROD_DIR -u GOSLEEP_SKILLS_BACKUPS_DIR \
    GOSLEEP_TOUCHID=1 \
    GOSLEEP_WEB_TOKEN="touchid-gate-smoke-nonce-32-hex-chars-a" \
    GOSLEEP_CHANGELOG_PATH="$CHANGELOG_PATH" \
    GOSLEEP_DB_PATH="$SCRATCH_DB" \
    GOSLEEP_TOUCHID_GATE_BIN="$WORK/mock-gate" \
    GOSLEEP_TOUCHID_BYPASS=1 \
  bash -c "bash \"$REPO_ROOT/tools/skills/publish.sh\" $TARGET_SKILL --yes </dev/null \
           >\"$WORK/D1.stdout.log\" 2>\"$WORK/D1.stderr.log\"; echo \$? >\"$WORK/D1.rc\""
set -e
D1_RC="$(cat "$WORK/D1.rc" 2>/dev/null || echo 99)"
if [ "$D1_RC" = "3" ] && grep -q 'refusing bypass' "$WORK/D1.stderr.log"; then
  echo "  PASS: D1 opt-in + BYPASS=1 without hermetic overrides → refused (rc=3, 'refusing bypass')."
else
  echo "FAIL: D1 expected rc=3 refusal + 'refusing bypass' fingerprint; got rc=$D1_RC." >&2
  tail -n 30 "$WORK/D1.stderr.log" >&2
  FAIL=1
fi

# ---- D2: opt-in + BYPASS=1 with hermetic overrides → proceeds ----------------
reset_state
set +e
env -u CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS \
    GOSLEEP_TOUCHID=1 \
    GOSLEEP_WEB_TOKEN="touchid-gate-smoke-nonce-32-hex-chars-a" \
    GOSLEEP_SKILLS_PROD_DIR="$PROD_ROOT_SCRATCH" \
    GOSLEEP_SKILLS_BACKUPS_DIR="$BACKUPS_DIR" \
    GOSLEEP_CHANGELOG_PATH="$CHANGELOG_PATH" \
    GOSLEEP_DB_PATH="$SCRATCH_DB" \
    GOSLEEP_TOUCHID_GATE_BIN="$WORK/mock-gate" \
    GOSLEEP_TOUCHID_BYPASS=1 \
  bash -c "bash \"$REPO_ROOT/tools/skills/publish.sh\" $TARGET_SKILL --yes </dev/null \
           >\"$WORK/D2.stdout.log\" 2>\"$WORK/D2.stderr.log\"; echo \$? >\"$WORK/D2.rc\""
set -e
D2_RC="$(cat "$WORK/D2.rc" 2>/dev/null || echo 99)"
if [ "$D2_RC" = "0" ] \
   && [ -d "$PROD_ROOT_SCRATCH/$TARGET_SKILL" ] \
   && grep -q 'TouchID gate skipped' "$WORK/D2.stderr.log"; then
  echo "  PASS: D2 opt-in + BYPASS=1 + hermetic overrides → publish proceeded (rc=0)."
else
  echo "FAIL: D2 expected rc=0 + override tree populated + 'skipped' fingerprint; got rc=$D2_RC." >&2
  tail -n 30 "$WORK/D2.stderr.log" >&2
  FAIL=1
fi

# ---- D3: opt-in + BYPASS=1 + REAL prod tree in PROD_DIR → refusal ------------
#
# The caller explicitly points PROD_DIR at $HOME/.claude/skills. Even with
# BYPASS=1 and a hermetic BACKUPS_DIR, the guard must refuse — mirrors the
# GSL-254 production test-guard pattern (fail-closed against production paths).
reset_state
echo "0" > "$WORK/mock-gate-rc"
set +e
env -u CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS \
    GOSLEEP_TOUCHID=1 \
    GOSLEEP_WEB_TOKEN="touchid-gate-smoke-nonce-32-hex-chars-a" \
    GOSLEEP_SKILLS_PROD_DIR="$HOME/.claude/skills" \
    GOSLEEP_SKILLS_BACKUPS_DIR="$BACKUPS_DIR" \
    GOSLEEP_CHANGELOG_PATH="$CHANGELOG_PATH" \
    GOSLEEP_DB_PATH="$SCRATCH_DB" \
    GOSLEEP_TOUCHID_GATE_BIN="$WORK/mock-gate" \
    GOSLEEP_TOUCHID_BYPASS=1 \
  bash -c "bash \"$REPO_ROOT/tools/skills/publish.sh\" $TARGET_SKILL --yes </dev/null \
           >\"$WORK/D3.stdout.log\" 2>\"$WORK/D3.stderr.log\"; echo \$? >\"$WORK/D3.rc\""
set -e
D3_RC="$(cat "$WORK/D3.rc" 2>/dev/null || echo 99)"
if [ "$D3_RC" = "3" ] && grep -q 'refusing bypass' "$WORK/D3.stderr.log"; then
  echo "  PASS: D3 opt-in + BYPASS=1 + PROD_DIR=\$HOME/.claude/skills → refused (fail-closed)."
else
  echo "FAIL: D3 expected rc=3 refusal against real prod tree; got rc=$D3_RC." >&2
  tail -n 30 "$WORK/D3.stderr.log" >&2
  FAIL=1
fi

# ---- D4: opt-in + BYPASS=1 + REAL prod backups in BACKUPS_DIR → refusal ------
#
# Same guard, opposite variable: point BACKUPS_DIR at the real production
# backups tree docs/skills/backups. Even with a hermetic PROD_DIR the guard
# must refuse.
reset_state
echo "0" > "$WORK/mock-gate-rc"
set +e
env -u CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS \
    GOSLEEP_TOUCHID=1 \
    GOSLEEP_WEB_TOKEN="touchid-gate-smoke-nonce-32-hex-chars-a" \
    GOSLEEP_SKILLS_PROD_DIR="$PROD_ROOT_SCRATCH" \
    GOSLEEP_SKILLS_BACKUPS_DIR="$REAL_BACKUPS_ROOT" \
    GOSLEEP_CHANGELOG_PATH="$CHANGELOG_PATH" \
    GOSLEEP_DB_PATH="$SCRATCH_DB" \
    GOSLEEP_TOUCHID_GATE_BIN="$WORK/mock-gate" \
    GOSLEEP_TOUCHID_BYPASS=1 \
  bash -c "bash \"$REPO_ROOT/tools/skills/publish.sh\" $TARGET_SKILL --yes </dev/null \
           >\"$WORK/D4.stdout.log\" 2>\"$WORK/D4.stderr.log\"; echo \$? >\"$WORK/D4.rc\""
set -e
D4_RC="$(cat "$WORK/D4.rc" 2>/dev/null || echo 99)"
if [ "$D4_RC" = "3" ] && grep -q 'refusing bypass' "$WORK/D4.stderr.log"; then
  echo "  PASS: D4 opt-in + BYPASS=1 + BACKUPS_DIR=docs/skills/backups → refused (fail-closed)."
else
  echo "FAIL: D4 expected rc=3 refusal against real prod backups; got rc=$D4_RC." >&2
  tail -n 30 "$WORK/D4.stderr.log" >&2
  FAIL=1
fi

# ---- REAL global tree untouched ---------------------------------------------
if [ "$REAL_EXISTED_BEFORE" = "yes" ]; then
  REAL_MTIME_AFTER="$(stat -f %m "$REAL_PROD_DIR" 2>/dev/null || stat -c %Y "$REAL_PROD_DIR" 2>/dev/null || echo "")"
  if [ "$REAL_MTIME_BEFORE" != "$REAL_MTIME_AFTER" ]; then
    echo "FAIL: real global tree mtime changed ($REAL_MTIME_BEFORE → $REAL_MTIME_AFTER) — the smoke is leaky." >&2
    FAIL=1
  else
    echo "  PASS: real global tree ($REAL_PROD_DIR) mtime unchanged across all cases."
  fi
else
  if [ -d "$REAL_PROD_DIR" ]; then
    echo "FAIL: real global tree $REAL_PROD_DIR did not exist before but does now — the smoke is leaky." >&2
    FAIL=1
  else
    echo "  PASS: real global tree $REAL_PROD_DIR still absent (never mkdir'd)."
  fi
fi

# ---- REAL production backups root untouched ---------------------------------
if [ "$REAL_BACKUPS_EXISTED_BEFORE" = "yes" ]; then
  REAL_BACKUPS_MTIME_AFTER="$(stat -f %m "$REAL_BACKUPS_ROOT" 2>/dev/null || stat -c %Y "$REAL_BACKUPS_ROOT" 2>/dev/null || echo "")"
  if [ "$REAL_BACKUPS_MTIME_BEFORE" != "$REAL_BACKUPS_MTIME_AFTER" ]; then
    echo "FAIL: real backups root mtime changed ($REAL_BACKUPS_MTIME_BEFORE → $REAL_BACKUPS_MTIME_AFTER) — the smoke is leaky." >&2
    FAIL=1
  else
    echo "  PASS: real backups root ($REAL_BACKUPS_ROOT) mtime unchanged across all cases."
  fi
else
  if [ -d "$REAL_BACKUPS_ROOT" ]; then
    echo "FAIL: real backups root $REAL_BACKUPS_ROOT did not exist before but does now — the smoke is leaky." >&2
    FAIL=1
  else
    echo "  PASS: real backups root $REAL_BACKUPS_ROOT still absent (never mkdir'd)."
  fi
fi

if [ "$FAIL" -eq 0 ]; then
  echo "touchid-gate-smoke: OK — default-off stub inert, opt-in exit codes steer flow, bypass fail-closed vs real prod paths."
  exit 0
else
  echo "touchid-gate-smoke: FAILED — one or more invariants broke." >&2
  echo "  logs under $WORK/" >&2
  exit 1
fi
