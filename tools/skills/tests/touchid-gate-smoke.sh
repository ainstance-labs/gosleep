#!/usr/bin/env bash
# =============================================================================
# tools/skills/tests/touchid-gate-smoke.sh — asserts publish.sh's TouchID
# physical-gesture gate wiring (GSL-288; target-architecture rev 2 §7.3
# "Приоритет 1", rev-3 addendum Delta 4 items 3-4) AND the GSL-385 fail-closed
# realpath-normalized bypass guard.
#
# Owner ruling (2026-08-16): the gate SHIPS DEFAULT-OFF behind
# `GOSLEEP_TOUCHID=1`. This smoke locks:
#   * default-off inert-stub path (E1),
#   * all four opt-in exit codes (C1-C4),
#   * both bypass-guard sanity branches (D1-D2), and
#   * ALL SIX defeat classes from the GSL-288 verifier report against a
#     HERMETIC DECOY home fixture — the guard MUST refuse every attempt to
#     route a bypass into a "real" prod tree under `$HOME/.claude/skills`
#     or `$REPO_ROOT/docs/skills/backups`, no matter how the caller spells
#     it (D3 symlink, D4 uppercase, D5 relative-symlink, D6 HOME rewrite,
#     D7 `..` traversal, D8 backups symlink).
#
# NOTHING in this smoke reads or writes the real `~/.claude/skills` tree or
# the real `docs/skills/backups` tree during a defeat demonstration. The
# guard's forbidden anchors are steered at the decoy via test-only env
# overrides GOSLEEP_TOUCHID_ANCHOR_HOME / GOSLEEP_TOUCHID_ANCHOR_REPO
# (documented in publish.sh — never set in launchd or the endpoint spawner).
#
# We STILL snapshot the real prod-tree + real backups-tree mtimes at the
# START and END of the run as a belt-and-braces leak assertion: any change
# whatsoever fails the smoke. But no defeat demonstration ever names those
# paths — the six defeat scenarios live inside `.artifacts/`.
#
# Group E — DEFAULT-OFF stub is inert:
#   E1. No GOSLEEP_TOUCHID → publish proceeds under the pre-GSL-288
#       owner-gate. Setting GOSLEEP_TOUCHID_BYPASS=1 with the flag off does
#       NOT trigger the bypass refusal path — the whole block is skipped.
#
# Group C — GOSLEEP_TOUCHID=1 + mock gate exit code steers the flow:
#   C1. rc=0 → publish proceeds; rsync landed in the hermetic PROD_DIR.
#   C2. rc=1 → publish exits 3, no rsync, no backup.
#   C3. rc=2 (no sensor) + no TTY → exits 3 with sensorless-pipe fingerprint.
#   C4. rc=3 (framework error) → exits 3 with framework-error fingerprint.
#
# Group D — GOSLEEP_TOUCHID_BYPASS guards under opt-in:
#   D1. BYPASS=1 without hermetic overrides → refuses (exit 3).
#   D2. BYPASS=1 with hermetic overrides → skips the gate, proceeds.
#
# Group D (defeat classes; each MUST refuse — GSL-385) — all against a
# DECOY home fixture, never the real ~/.claude:
#   D3. Symlink into decoy prod. Attack: PROD_DIR points at a symlink that
#       lands under the decoy's .claude/skills tree.
#   D4. Uppercase segments on APFS/HFS+. PROD_DIR literal has an
#       uppercased segment; the FS still resolves it to the decoy's
#       .claude/skills.
#   D5. Relative-path symlink. cwd-relative symlink whose target sits under
#       the decoy prod tree.
#   D6. HOME-rewrite ignored. Caller sets HOME to a red-herring value AND
#       PROD_DIR to the literal decoy prod tree. The dscl/getent-anchored
#       HOME the guard uses is independent of $HOME, so it still refuses.
#   D7. `..` traversal. PROD_DIR string contains ../.. components that
#       resolve up and back into the decoy prod tree.
#   D8. Backups symlink into decoy backups. BACKUPS_DIR is a symlink whose
#       target sits under the decoy repo's docs/skills/backups tree.
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

# ---- decoy home + repo fixtures (GSL-385) -----------------------------------
#
# Both trees are populated with a CANARY sentinel and their mtime snapshotted
# so any leak into them under a defeat demonstration flips a check at the end.
# The guard is steered at these decoy anchors via GOSLEEP_TOUCHID_ANCHOR_HOME
# and GOSLEEP_TOUCHID_ANCHOR_REPO — test-only overrides documented in
# publish.sh under the "realpath-normalization helpers" block. Production
# never sets these vars, so the guard resolves to the real dscl/getent HOME
# and the script's own REPO_ROOT there.
DECOY_HOME="$WORK/decoy-home"
DECOY_REPO="$WORK/decoy-repo"
mkdir -p "$DECOY_HOME/.claude/skills/canary-target" \
         "$DECOY_REPO/docs/skills/backups/canary-target"
echo "decoy-prod-canary" > "$DECOY_HOME/.claude/skills/canary-target/canary.txt"
echo "decoy-backups-canary" > "$DECOY_REPO/docs/skills/backups/canary-target/canary.txt"

DECOY_PROD_MTIME_BEFORE="$(stat -f %m "$DECOY_HOME/.claude/skills" 2>/dev/null \
                          || stat -c %Y "$DECOY_HOME/.claude/skills" 2>/dev/null || echo "")"
DECOY_BACKUPS_MTIME_BEFORE="$(stat -f %m "$DECOY_REPO/docs/skills/backups" 2>/dev/null \
                             || stat -c %Y "$DECOY_REPO/docs/skills/backups" 2>/dev/null || echo "")"
DECOY_PROD_CANARY_BEFORE="$(cat "$DECOY_HOME/.claude/skills/canary-target/canary.txt" 2>/dev/null || echo "")"
DECOY_BACKUPS_CANARY_BEFORE="$(cat "$DECOY_REPO/docs/skills/backups/canary-target/canary.txt" 2>/dev/null || echo "")"

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

REAL_BACKUPS_MTIME_BEFORE=""
REAL_BACKUPS_EXISTED_BEFORE="no"
if [ -d "$REAL_BACKUPS_ROOT" ]; then
  REAL_BACKUPS_EXISTED_BEFORE="yes"
  REAL_BACKUPS_MTIME_BEFORE="$(stat -f %m "$REAL_BACKUPS_ROOT" 2>/dev/null || stat -c %Y "$REAL_BACKUPS_ROOT" 2>/dev/null || echo "")"
fi

# ---- mock gate binary --------------------------------------------------------
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

# Reset the hermetic filesystem state between cases.
reset_state() {
  rm -rf "$PROD_ROOT_SCRATCH" "$BACKUPS_DIR" "$CHANGELOG_PATH"
  mkdir -p "$PROD_ROOT_SCRATCH" "$BACKUPS_DIR"
  : > "$CHANGELOG_PATH"
}

# ---- E1: default-off inert stub ----------------------------------------------
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

# ---- C1-C4: opt-in gate exit-code steering ----------------------------------
reset_state; run_case C1 0
C1_RC="$(cat "$WORK/C1.rc" 2>/dev/null || echo 99)"
if [ "$C1_RC" = "0" ] && [ -d "$PROD_ROOT_SCRATCH/$TARGET_SKILL" ] \
   && grep -q 'touchid gate rc=0' "$WORK/C1.stderr.log"; then
  echo "  PASS: C1 opt-in + gate rc=0 → publish proceeded, gate log present."
else
  echo "FAIL: C1 expected rc=0 + override tree populated + gate log; got rc=$C1_RC." >&2
  tail -n 30 "$WORK/C1.stderr.log" >&2; FAIL=1
fi

reset_state; run_case C2 1
C2_RC="$(cat "$WORK/C2.rc" 2>/dev/null || echo 99)"
if [ "$C2_RC" = "3" ] && [ ! -d "$PROD_ROOT_SCRATCH/$TARGET_SKILL" ] \
   && grep -q 'TouchID denied' "$WORK/C2.stderr.log"; then
  echo "  PASS: C2 opt-in + gate rc=1 → publish refused (rc=3), 'TouchID denied' fingerprint."
else
  echo "FAIL: C2 expected rc=3 refusal + no rsync + fingerprint; got rc=$C2_RC." >&2
  tail -n 30 "$WORK/C2.stderr.log" >&2; FAIL=1
fi

reset_state; run_case C3 2
C3_RC="$(cat "$WORK/C3.rc" 2>/dev/null || echo 99)"
if [ "$C3_RC" = "3" ] && [ ! -d "$PROD_ROOT_SCRATCH/$TARGET_SKILL" ] \
   && grep -q 'no owner-presence path available' "$WORK/C3.stderr.log"; then
  echo "  PASS: C3 opt-in + gate rc=2 + no TTY → publish refused with sensorless-pipe fingerprint."
else
  echo "FAIL: C3 expected rc=3 refusal + no rsync + 'no owner-presence path available'; got rc=$C3_RC." >&2
  tail -n 30 "$WORK/C3.stderr.log" >&2; FAIL=1
fi

reset_state; run_case C4 3
C4_RC="$(cat "$WORK/C4.rc" 2>/dev/null || echo 99)"
if [ "$C4_RC" = "3" ] && [ ! -d "$PROD_ROOT_SCRATCH/$TARGET_SKILL" ] \
   && grep -q 'TouchID framework error' "$WORK/C4.stderr.log"; then
  echo "  PASS: C4 opt-in + gate rc=3 → publish refused with framework-error fingerprint."
else
  echo "FAIL: C4 expected rc=3 refusal + no rsync + framework-error fingerprint; got rc=$C4_RC." >&2
  tail -n 30 "$WORK/C4.stderr.log" >&2; FAIL=1
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
  echo "  PASS: D1 opt-in + BYPASS=1 without hermetic overrides → refused (rc=3)."
else
  echo "FAIL: D1 expected rc=3 refusal + 'refusing bypass' fingerprint; got rc=$D1_RC." >&2
  tail -n 30 "$WORK/D1.stderr.log" >&2; FAIL=1
fi

# ---- D2: opt-in + BYPASS=1 with hermetic overrides → proceeds ----------------
#
# Steer the guard's anchors at the decoy fixtures (test-only overrides) so
# this smoke never resolves anything against the real ~/.claude tree.
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
    GOSLEEP_TOUCHID_ANCHOR_HOME="$DECOY_HOME" \
    GOSLEEP_TOUCHID_ANCHOR_REPO="$DECOY_REPO" \
  bash -c "bash \"$REPO_ROOT/tools/skills/publish.sh\" $TARGET_SKILL --yes </dev/null \
           >\"$WORK/D2.stdout.log\" 2>\"$WORK/D2.stderr.log\"; echo \$? >\"$WORK/D2.rc\""
set -e
D2_RC="$(cat "$WORK/D2.rc" 2>/dev/null || echo 99)"
if [ "$D2_RC" = "0" ] && [ -d "$PROD_ROOT_SCRATCH/$TARGET_SKILL" ] \
   && grep -q 'TouchID gate skipped' "$WORK/D2.stderr.log"; then
  echo "  PASS: D2 opt-in + BYPASS=1 + hermetic overrides (decoy anchors) → publish proceeded."
else
  echo "FAIL: D2 expected rc=0 + override tree populated + 'skipped' fingerprint; got rc=$D2_RC." >&2
  tail -n 30 "$WORK/D2.stderr.log" >&2; FAIL=1
fi

# ---- attack helper (D3-D8): each attack must produce a refusal --------------
# Each defeat case sets its own GOSLEEP_SKILLS_PROD_DIR / BACKUPS_DIR (and
# optionally HOME); ANCHOR_HOME/ANCHOR_REPO steer the guard at the decoy so
# the check runs against the decoy prod + backups trees, never the real ones.
run_attack() {
  # $1=label, $2=cwd, $3=prod_dir, $4=backups_dir, remaining=extra env pairs
  local label="$1" cwd="$2" prod_dir="$3" backups_dir="$4"; shift 4
  echo "0" > "$WORK/mock-gate-rc"
  local -a envs=(
    "GOSLEEP_TOUCHID=1"
    "GOSLEEP_WEB_TOKEN=touchid-gate-smoke-nonce-32-hex-chars-a"
    "GOSLEEP_SKILLS_PROD_DIR=$prod_dir"
    "GOSLEEP_SKILLS_BACKUPS_DIR=$backups_dir"
    "GOSLEEP_CHANGELOG_PATH=$CHANGELOG_PATH"
    "GOSLEEP_DB_PATH=$SCRATCH_DB"
    "GOSLEEP_TOUCHID_GATE_BIN=$WORK/mock-gate"
    "GOSLEEP_TOUCHID_BYPASS=1"
    "GOSLEEP_TOUCHID_ANCHOR_HOME=$DECOY_HOME"
    "GOSLEEP_TOUCHID_ANCHOR_REPO=$DECOY_REPO"
  )
  for pair in "$@"; do envs+=("$pair"); done
  set +e
  ( cd "$cwd" && env -u CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS "${envs[@]}" \
      bash "$REPO_ROOT/tools/skills/publish.sh" "$TARGET_SKILL" --yes </dev/null \
      >"$WORK/${label}.stdout.log" 2>"$WORK/${label}.stderr.log"; echo $? >"$WORK/${label}.rc" )
  set -e
}

assert_refuse() {
  # $1=label, $2=human-readable defeat class
  local label="$1" desc="$2"
  local rc; rc="$(cat "$WORK/${label}.rc" 2>/dev/null || echo 99)"
  if [ "$rc" = "3" ] && grep -q 'refusing bypass' "$WORK/${label}.stderr.log"; then
    echo "  PASS: ${label} ${desc} → refused (rc=3, 'refusing bypass')."
  else
    echo "FAIL: ${label} ${desc} — expected rc=3 refusal; got rc=$rc." >&2
    tail -n 30 "$WORK/${label}.stderr.log" >&2
    FAIL=1
  fi
}

# ---- D3: symlink into decoy prod --------------------------------------------
reset_state
ln -s "$DECOY_HOME/.claude/skills/canary-target" "$WORK/attack-decoy-prod-symlink"
run_attack D3 "$WORK" "$WORK/attack-decoy-prod-symlink" "$BACKUPS_DIR"
assert_refuse D3 "symlink into decoy prod"

# ---- D4: uppercase segments on APFS/HFS+ ------------------------------------
# On Darwin (default APFS-CI) the FS resolves .CLAUDE → .claude → decoy prod;
# on a case-sensitive FS realpath fails and the guard treats it as literal
# text, which won't match anchor either — SKIP with a PASS on case-sensitive.
reset_state
if [ "$(uname -s)" = "Darwin" ]; then
  run_attack D4 "$WORK" "$DECOY_HOME/.CLAUDE/skills" "$BACKUPS_DIR"
  assert_refuse D4 "uppercase segment on APFS-CI"
else
  echo "  PASS: D4 skipped on non-Darwin (case-sensitive FS; attack not applicable)."
fi

# ---- D5: relative-path symlink ----------------------------------------------
reset_state
mkdir -p "$WORK/attack-rel-cwd"
ln -s "$DECOY_HOME/.claude/skills/canary-target" "$WORK/attack-rel-cwd/rel-decoy"
run_attack D5 "$WORK/attack-rel-cwd" "./rel-decoy" "$BACKUPS_DIR"
assert_refuse D5 "relative-path symlink into decoy prod"

# ---- D6: HOME rewrite ignored -----------------------------------------------
# Caller sets HOME to a red-herring value. dscl/getent anchor + ANCHOR_HOME
# override keep the guard's HOME pinned to the decoy — refuse still fires
# when PROD_DIR is the literal decoy prod path.
reset_state
mkdir -p "$WORK/attack-red-herring-home"
run_attack D6 "$WORK" "$DECOY_HOME/.claude/skills/canary-target" "$BACKUPS_DIR" \
  "HOME=$WORK/attack-red-herring-home"
assert_refuse D6 "HOME-rewrite red herring + literal decoy prod"

# ---- D7: `..` traversal -----------------------------------------------------
reset_state
# Build a deep-nested path that resolves up-and-back into the decoy prod tree.
mkdir -p "$WORK/attack-trav/deep/nested"
run_attack D7 "$WORK" \
  "$WORK/attack-trav/deep/nested/../../../decoy-home/.claude/skills/canary-target" \
  "$BACKUPS_DIR"
assert_refuse D7 "\`..\` traversal into decoy prod"

# ---- D8: backups symlink into decoy backups ---------------------------------
reset_state
ln -s "$DECOY_REPO/docs/skills/backups/canary-target" "$WORK/attack-decoy-backups-symlink"
run_attack D8 "$WORK" "$PROD_ROOT_SCRATCH" "$WORK/attack-decoy-backups-symlink"
assert_refuse D8 "symlink into decoy backups"

# Cleanup any leftover attack symlinks between phases so no run leaves them
# dangling for the next.
rm -f "$WORK/attack-decoy-prod-symlink" "$WORK/attack-decoy-backups-symlink"
rm -rf "$WORK/attack-rel-cwd" "$WORK/attack-red-herring-home" "$WORK/attack-trav"

# ---- decoy prod tree unchanged ---------------------------------------------
DECOY_PROD_MTIME_AFTER="$(stat -f %m "$DECOY_HOME/.claude/skills" 2>/dev/null \
                         || stat -c %Y "$DECOY_HOME/.claude/skills" 2>/dev/null || echo "")"
DECOY_PROD_CANARY_AFTER="$(cat "$DECOY_HOME/.claude/skills/canary-target/canary.txt" 2>/dev/null || echo "")"
if [ "$DECOY_PROD_MTIME_BEFORE" = "$DECOY_PROD_MTIME_AFTER" ] \
   && [ "$DECOY_PROD_CANARY_BEFORE" = "$DECOY_PROD_CANARY_AFTER" ] \
   && [ -n "$DECOY_PROD_CANARY_BEFORE" ]; then
  echo "  PASS: decoy prod tree ($DECOY_HOME/.claude/skills) mtime + canary unchanged."
else
  echo "FAIL: decoy prod tree mutated — a defeat class landed on the decoy (mtime $DECOY_PROD_MTIME_BEFORE → $DECOY_PROD_MTIME_AFTER, canary '$DECOY_PROD_CANARY_BEFORE' → '$DECOY_PROD_CANARY_AFTER')." >&2
  FAIL=1
fi

# ---- decoy backups tree unchanged ------------------------------------------
DECOY_BACKUPS_MTIME_AFTER="$(stat -f %m "$DECOY_REPO/docs/skills/backups" 2>/dev/null \
                            || stat -c %Y "$DECOY_REPO/docs/skills/backups" 2>/dev/null || echo "")"
DECOY_BACKUPS_CANARY_AFTER="$(cat "$DECOY_REPO/docs/skills/backups/canary-target/canary.txt" 2>/dev/null || echo "")"
if [ "$DECOY_BACKUPS_MTIME_BEFORE" = "$DECOY_BACKUPS_MTIME_AFTER" ] \
   && [ "$DECOY_BACKUPS_CANARY_BEFORE" = "$DECOY_BACKUPS_CANARY_AFTER" ] \
   && [ -n "$DECOY_BACKUPS_CANARY_BEFORE" ]; then
  echo "  PASS: decoy backups tree ($DECOY_REPO/docs/skills/backups) mtime + canary unchanged."
else
  echo "FAIL: decoy backups tree mutated — a defeat class landed on the decoy backups (mtime $DECOY_BACKUPS_MTIME_BEFORE → $DECOY_BACKUPS_MTIME_AFTER, canary '$DECOY_BACKUPS_CANARY_BEFORE' → '$DECOY_BACKUPS_CANARY_AFTER')." >&2
  FAIL=1
fi

# ---- REAL global tree untouched (belt-and-braces) ---------------------------
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
  echo "touchid-gate-smoke: OK — default-off stub inert, opt-in exit codes steer flow, bypass fail-closed vs six defeat classes (GSL-385)."
  exit 0
else
  echo "touchid-gate-smoke: FAILED — one or more invariants broke." >&2
  echo "  logs under $WORK/" >&2
  exit 1
fi
