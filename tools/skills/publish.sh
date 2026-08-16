#!/usr/bin/env bash
# =============================================================================
# tools/skills/publish.sh — publish a single skill from `skill/<name>/` into
# `~/.claude/skills/<name>/` (T3, GSL-253 partial; PRD F8-S2).
#
# THIS IS THE ONLY SANCTIONED PATH from development to production. All four
# defense layers converge here:
#
#   Layer 1 — CLAUDE.md prose rule (agents forbidden to touch ~/.claude/skills/).
#   Layer 2 — THIS FILE: owner-gate + backup + single-skill discipline.
#   Layer 3 — production test-guard (tools/lab/smoke.sh, T10).
#   Layer 4 — install.sh guard (already on since 2026-07-20).
#
# TOUCHID IS PAUSED (`d-2026-08-09-001`). Tonight's ship: TTY-confirm interim
# plus the env-nonce path the web endpoint uses. The TouchID leg lands as a
# one-line function call swap when the pause lifts (marked TODO below).
#
# OWNER GATES (owner must satisfy ONE):
#   A. Interactive TTY on stdin: `isatty(0) == true`. Prints a prompt to
#      /dev/tty; owner types y.
#   B. Non-empty $GOSLEEP_WEB_TOKEN. Only the web endpoint sets this via
#      spawn env (per-request random nonce). An agent under Claude Code with
#      no TTY and no endpoint spawn has neither.
#
# HARD REFUSALS (any of these → exit non-zero, no rsync):
#   * Missing / --all / multi-arg / path-traversal / glob-shape name.
#   * Skill dir does not exist under `skill/<name>/`.
#   * verify-local.sh fails (broken references, unclean working tree, etc.).
#   * Both owner gates fail (agent in a pipe with no env-nonce).
#   * $CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS set to anything non-empty
#     (belt-and-braces defense, plan Q2 default).
#
# EXIT CODES (contract with T5 spawner):
#   0  — publish succeeded end-to-end (verify → backup → rsync → CHANGELOG).
#   1  — verify-local.sh failed / rsync failed / CHANGELOG append failed.
#   2  — usage error (bad arg).
#   3  — owner gate refused (no TTY + no env-nonce, or --dangerously-skip
#         env var present).
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# CHANGELOG_PATH is not read by this file — it is used by record-publish.ts
# (which honors GOSLEEP_CHANGELOG_PATH). Kept here as documentation for the
# grep-verifier hunting the audit surface.
CHANGELOG_PATH="${GOSLEEP_CHANGELOG_PATH:-$REPO_ROOT/docs/skills/CHANGELOG.jsonl}"
# BACKUPS_DIR — where the pre-rsync production snapshot lands. Override with
# GOSLEEP_SKILLS_BACKUPS_DIR for a hermetic live-proof that does not pollute
# the real docs/skills/backups/ tree.
BACKUPS_DIR="${GOSLEEP_SKILLS_BACKUPS_DIR:-$REPO_ROOT/docs/skills/backups}"
VERIFY="$REPO_ROOT/tools/skills/verify-local.sh"
RECORD="$REPO_ROOT/apps/core/scripts/record-publish.ts"

# ---- usage --------------------------------------------------------------------

usage() {
  cat <<'USAGE' >&2
tools/skills/publish.sh — publish a single skill (repo → production).

Usage: publish.sh <skill-name> [--lesson "…"] [--task GSL-N] [--intent-id …]
                                 [--yes] [--no-confirm]

  <skill-name>   Directory name under skill/ (single, no globs, no --all).
  --lesson       Free-text lesson attached to the CHANGELOG row. Default: "".
  --task         Jira task key. Default: derived from the last commit
                 message that starts with GSL-N in `skill/<name>/`, else GSL-174.
  --intent-id    server_intents.intent_id from the web endpoint (T5). Omitted
                 → CLI mode → CHANGELOG row's intent_id will be null.
  --yes          Owner-only: skip the interactive prompt. STILL requires a
                 TTY (isatty(0)) OR env-nonce — a pipe-context agent cannot
                 satisfy either gate.
  --no-confirm   Alias for --yes.

Exit codes: 0 = published, 1 = error, 2 = usage, 3 = owner gate refused.
USAGE
}

if [ "$#" -lt 1 ]; then
  echo "publish: exactly one skill name required" >&2
  usage
  exit 2
fi

# Parse args
SKILL=""
LESSON=""
TASK=""
INTENT_ID=""
AUTO_YES=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --all)
      echo "publish: bulk sync is not supported. This tool publishes ONE named skill at a time." >&2
      exit 2
      ;;
    --lesson)   LESSON="${2:-}"; shift 2 ;;
    --task)     TASK="${2:-}";   shift 2 ;;
    --intent-id) INTENT_ID="${2:-}"; shift 2 ;;
    --yes|--no-confirm) AUTO_YES=1; shift ;;
    --help|-h)  usage; exit 0 ;;
    --*)
      echo "publish: unknown flag: $1" >&2
      usage
      exit 2
      ;;
    *)
      if [ -n "$SKILL" ]; then
        echo "publish: exactly one skill name required (got '$SKILL' and '$1')" >&2
        exit 2
      fi
      SKILL="$1"; shift
      ;;
  esac
done

if [ -z "$SKILL" ]; then
  echo "publish: exactly one skill name required" >&2
  usage
  exit 2
fi

case "$SKILL" in
  --all|*/*|..*|*/..*|"")
    echo "publish: refusing bad skill name: '$SKILL' (no globs, no path traversal)" >&2
    exit 2
    ;;
  --*)
    echo "publish: '$SKILL' looks like a flag; skill names do not start with --" >&2
    exit 2
    ;;
esac

SKILL_DIR="$REPO_ROOT/skill/$SKILL"
# PROD_ROOT / PROD_DIR — the production tree this publish rsyncs into.
# Default: $HOME/.claude/skills (the real global skill tree). Override with
# GOSLEEP_SKILLS_PROD_DIR for a hermetic live-proof that must not touch the
# real global tree (GSL-174 verifier run 02 m-1). The value is used both as
# the rsync destination and as the diff/backup reference — a scratch dir
# under .artifacts/ is the intended override for verification.
# Every refusal path stays intact under this override: the owner gate (TTY /
# GOSLEEP_WEB_TOKEN), CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS, verify-local.sh,
# and the DB preflight all run unchanged and unaware of PROD_ROOT.
PROD_ROOT="${GOSLEEP_SKILLS_PROD_DIR:-$HOME/.claude/skills}"
PROD_DIR="$PROD_ROOT/$SKILL"

# Announce the resolved destination up front so the owner (and hermetic
# verifiers) can see where the publish WOULD write regardless of whether a
# subsequent gate refuses. Mirrors the "publish: prod = <PROD_DIR>" line
# printed later in the flow; harmless duplicate for the pass-through case.
echo "publish:   prod = $PROD_DIR" >&2

if [ ! -d "$SKILL_DIR" ]; then
  echo "publish: skill dir does not exist: $SKILL_DIR" >&2
  exit 2
fi

# ---- belt-and-braces: refuse under --dangerously-skip-permissions -----------
if [ -n "${CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS:-}" ]; then
  echo "publish: CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS is set — refusing (plan Q2 default)." >&2
  exit 3
fi

# ---- owner gate (isatty OR non-empty env-nonce) -----------------------------
have_tty=0
have_env=0
if [ -t 0 ] && (: < /dev/tty) 2>/dev/null; then
  have_tty=1
fi
if [ -n "${GOSLEEP_WEB_TOKEN:-}" ] && [ "${#GOSLEEP_WEB_TOKEN}" -ge 16 ]; then
  have_env=1
fi

if [ "$have_tty" -eq 0 ] && [ "$have_env" -eq 0 ]; then
  echo "publish: refusing — no TTY on stdin AND no GOSLEEP_WEB_TOKEN env-nonce (agent-in-pipe context)." >&2
  exit 3
fi

# ---- pre-publish sanity (T2, GSL-254) ----------------------------------------
if [ ! -x "$VERIFY" ]; then
  echo "publish: verify-local.sh missing at $VERIFY" >&2
  exit 1
fi
if ! VERBOSE=1 "$VERIFY" "$SKILL" >&2; then
  echo "publish: verify-local.sh rejected skill '$SKILL' — aborting before rsync." >&2
  exit 1
fi

# ---- DB preflight (GSL-254, verifier GSL-174-night M1 fix) -------------------
#
# The publish flow's last step folds CHANGELOG.jsonl into the `skills` table (via
# record-publish.ts). If that table is missing (fresh clone, corrupted DB, migration
# skipped), the fold used to fail AFTER the rsync + JSONL write had already landed,
# leaving a half-published state (filesystem + JSONL ahead of the DB, orphaned
# "published" row in the JSONL, endpoint returned 500).
#
# Preflight closes that gap: probe the DB read-only BEFORE any mutation. Failure here
# means NOTHING was written — no backup, no rsync, no CHANGELOG row.
#
# The launchd-managed core migrates the DB at boot; a bare CLI invocation on a fresh
# checkout must run `bun run apps/core/scripts/migrate.ts` first. See
# docs/runbooks/gosleep-core.md section 10 for the operator flow.
if ! (cd "$REPO_ROOT" && bun run "$RECORD" check) >&2; then
  echo "publish: DB preflight FAILED — the 'skills' table is missing." >&2
  echo "publish:   Fix: bun run apps/core/scripts/migrate.ts (or bounce launchd, which migrates at boot)." >&2
  echo "publish:   NO filesystem changes were made — backup + CHANGELOG untouched." >&2
  exit 1
fi

# ---- diff (informational; the actual gate is verify-local + backup) ---------
UTC_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
FILENAME_TS="$(date -u +%Y%m%dT%H%M%SZ)"
DIFF_OUTPUT="$(diff -u -r "$PROD_DIR" "$SKILL_DIR" 2>&1 || true)"

echo "==============================================================================" >&2
echo "publish: skill='$SKILL'" >&2
echo "publish:   dev  = $SKILL_DIR" >&2
echo "publish:   prod = $PROD_DIR" >&2
echo "publish:   diff (- prod / + dev):" >&2
if [ -z "$DIFF_OUTPUT" ]; then
  echo "publish:     (empty — dev matches prod; nothing to publish, but proceeding to record the checkpoint)" >&2
else
  # Limit the console spew to the first 200 lines; the backup + rsync capture the full change.
  printf '%s\n' "$DIFF_OUTPUT" | head -n 200 | sed 's/^/publish:     /' >&2
fi
echo "==============================================================================" >&2

# ---- TouchID physical-gesture gate (GSL-288 wiring; OFF by default) ----------
#
# STATUS as of 2026-08-16 (owner ruling recorded on GSL-288): the TouchID gate
# is WIRED into this script but SHIPS DEFAULT-OFF, behind an explicit opt-in
# flag. The harness+web program comes first; the physical-gesture layer is
# deferred until the owner enables it as part of a later task (tied to
# GSL-266 activation). With the flag OFF (the default) this block is a
# documented inert stub — the TTY-confirm block below is the sole owner-gate
# for daily publish flows, exactly as before this task landed.
#
# Enable path (future task; the owner will flip this deliberately):
#   1. Build the .app bundle:  bash apps/core/scripts/build-touchid-gate.sh
#   2. Wire the flag into the launchd plist EnvironmentVariables dict
#      (apps/core/plist/com.gosleep.core.plist) AND into the endpoint
#      spawner (apps/core/src/actions/publish.ts) — currently NEITHER sets
#      it, so a production spawn today enters this block with the flag off.
#   3. Set GOSLEEP_TOUCHID=1 in the calling shell before invoking publish.sh
#      by hand; the block below then activates with the exit-code map
#      documented under the "opt-in mechanics" comment.
#
# Design intent: land the wiring and the mock-driven smoke coverage NOW so
# turning the flag on later is a one-line env change, not a fresh
# implementation. Nothing about the current publish behaviour changes with
# the flag off — no biometric prompt fires, no path resolves through
# LocalAuthentication.
#
# Ordering rationale: this block sits AFTER verify-local + DB preflight so a
# broken repo state or unmigrated DB refuses without ever invoking the
# sensor even under opt-in.
#
# ---- opt-in mechanics (only active with GOSLEEP_TOUCHID=1) -----------------
#
# Exit-code contract with apps/core/bin/touchid-gate.swift:
#   0 → owner tapped TouchID / Face ID; proceed with backup + rsync.
#   1 → owner cancelled or biometric failed → exit 3 (owner-gate refused).
#   2 → sensor unavailable → fall back to TTY-confirm; refuse if no TTY.
#   3 → framework error → exit 3.
#
# Test-only overrides (NEVER set in the launchd plist or the web endpoint
# spawner — both leave these unset):
#   GOSLEEP_TOUCHID_GATE_BIN   Path to an alternative gate binary or bundle.
#                              Used by tools/skills/tests/touchid-gate-smoke.sh
#                              with a mock that returns a chosen exit code
#                              without touching the biometric subsystem.
#   GOSLEEP_TOUCHID_BYPASS=1   Skip the gate under opt-in. FAIL-CLOSED against
#                              production paths: refuses (exit 3) unless BOTH
#                              GOSLEEP_SKILLS_PROD_DIR and
#                              GOSLEEP_SKILLS_BACKUPS_DIR are set AND the
#                              RESOLVED PROD_DIR + BACKUPS_DIR both sit
#                              outside "$HOME/.claude/skills" (mirrors the
#                              GSL-254 production test-guard pattern —
#                              impossible to trip in a production spawn even
#                              if a caller sets both env vars pointing at the
#                              real tree by mistake).

GATE_BIN="${GOSLEEP_TOUCHID_GATE_BIN:-$REPO_ROOT/apps/core/bin/touchid-gate.app}"
GATE_REASON="gosleep-core: publish skill '$SKILL' to production"
GATE_RC=""
GATE_BYPASS=0

if [ "${GOSLEEP_TOUCHID:-0}" != "1" ]; then
  # Default OFF — inert stub. Log one line so operators reading logs know the
  # gate exists in the script but is not participating in this run; then fall
  # through to the pre-existing TTY-confirm block, whose behaviour is exactly
  # what publish.sh had before this task.
  echo "publish:   touchid gate: OFF (stub; owner-deferred 2026-08-16; opt in with GOSLEEP_TOUCHID=1)" >&2
else
  # Opt-in: the flag is set. Fail-closed bypass check first, so even a caller
  # that sets GOSLEEP_TOUCHID_BYPASS=1 cannot ever route around the sensor on
  # a production tree.
  #
  # The guard checks the RESOLVED destination paths, not just the env-var
  # names. `PROD_DIR` here is the value already computed above from
  # GOSLEEP_SKILLS_PROD_DIR (default $HOME/.claude/skills/<name>); if that
  # resolves under the real global tree, refuse the bypass unconditionally.
  # Same for BACKUPS_DIR vs docs/skills/backups.
  if [ "${GOSLEEP_TOUCHID_BYPASS:-0}" = "1" ]; then
    bypass_ok=1
    resolved_prod_root="${GOSLEEP_SKILLS_PROD_DIR:-}"
    resolved_backups="${GOSLEEP_SKILLS_BACKUPS_DIR:-}"
    # Refuse if either override is unset — a bypass without both overrides
    # cannot possibly be a hermetic test.
    [ -z "$resolved_prod_root" ] && bypass_ok=0
    [ -z "$resolved_backups" ]   && bypass_ok=0
    # Refuse if either resolves under the real global tree, verbatim or by
    # prefix — mirrors the GSL-254 preflight guard against production paths.
    case "$resolved_prod_root" in
      "$HOME/.claude/skills"|"$HOME/.claude/skills/"*) bypass_ok=0 ;;
    esac
    case "$resolved_backups" in
      "$HOME/.claude/skills"|"$HOME/.claude/skills/"*) bypass_ok=0 ;;
    esac
    # Also refuse if the resolved BACKUPS points at the real production
    # backups tree under docs/skills/backups — the launchd default. This
    # catches "hermetic + prod backups" hybrids.
    case "$resolved_backups" in
      "$REPO_ROOT/docs/skills/backups"|"$REPO_ROOT/docs/skills/backups/"*) bypass_ok=0 ;;
    esac
    if [ "$bypass_ok" -eq 1 ]; then
      GATE_BYPASS=1
      echo "publish: WARN: GOSLEEP_TOUCHID_BYPASS=1 — TouchID gate skipped (hermetic test override)." >&2
      echo "publish:        prod=$resolved_prod_root backups=$resolved_backups" >&2
    else
      echo "publish: refusing bypass — GOSLEEP_TOUCHID_BYPASS=1 requires GOSLEEP_SKILLS_PROD_DIR" >&2
      echo "publish:   AND GOSLEEP_SKILLS_BACKUPS_DIR set to hermetic paths outside the real tree." >&2
      echo "publish:   Resolved: prod='$resolved_prod_root' backups='$resolved_backups'." >&2
      echo "publish:   Real tree: prod-refused='\$HOME/.claude/skills[/*]',  backups-refused='\$HOME/.claude/skills[/*]' AND '\$REPO_ROOT/docs/skills/backups[/*]'." >&2
      exit 3
    fi
  fi

  if [ "$GATE_BYPASS" -eq 0 ]; then
    gate_run() {
      if [ -d "$GATE_BIN" ] && [ -x "$GATE_BIN/Contents/MacOS/touchid-gate" ]; then
        # Real .app bundle — must be launched via `open -W -a` so the biometric
        # entitlement attached to the bundle identity is honored. `open -W`
        # propagates the app's exit status on macOS 11+ (per Apple's open(1)).
        echo "publish:   touchid gate: launching $GATE_BIN via 'open -W -a'" >&2
        /usr/bin/open -W -a "$GATE_BIN" --args "$GATE_REASON"
        return $?
      fi
      if [ -x "$GATE_BIN" ]; then
        # Bare executable — used by tools/skills/tests/touchid-gate-smoke.sh
        # with a mock binary that never touches LocalAuthentication.
        echo "publish:   touchid gate: exec $GATE_BIN (bare binary; mock-friendly path)" >&2
        "$GATE_BIN" "$GATE_REASON"
        return $?
      fi
      echo "publish: touchid-gate binary not found at $GATE_BIN — refusing." >&2
      echo "publish:   Fix: bash apps/core/scripts/build-touchid-gate.sh (rev-3 addendum Delta 4)." >&2
      return 3
    }

    gate_run
    GATE_RC=$?
    echo "publish:   touchid gate rc=$GATE_RC" >&2
    case "$GATE_RC" in
      0)
        # Physical gesture confirmed. The TTY-confirm block below is skipped —
        # asking the owner to type "yes" after they already tapped TouchID is
        # noise, not defense.
        :
        ;;
      1)
        echo "publish: TouchID denied (rc=1) — owner cancelled or biometric failed. Aborting." >&2
        exit 3
        ;;
      2)
        echo "publish: TouchID sensor unavailable (rc=2) — trying TTY-confirm fallback (§7.3 Priority 1)." >&2
        if [ "$have_tty" -ne 1 ]; then
          echo "publish: no TTY on stdin either — no owner-presence path available. Aborting." >&2
          echo "publish:   Re-run the publish from an interactive shell on a host with either a" >&2
          echo "publish:   biometric sensor or a controlling terminal, or use tty-confirm.sh directly." >&2
          exit 3
        fi
        # Fall through to the TTY-confirm block below.
        ;;
      3|*)
        echo "publish: TouchID framework error (rc=$GATE_RC) — aborting." >&2
        exit 3
        ;;
    esac
  fi
fi

# ---- interactive TTY-confirm fallback ----------------------------------------
#
# Runs in three cases:
#   (a) TouchID gate OFF (GOSLEEP_TOUCHID != 1) — the default path today. This
#       is the pre-GSL-288 owner-gate: TTY prompt when interactive, silent
#       proceed when --yes was passed and either a TTY or env-nonce is present.
#   (b) TouchID opt-in + gate exited 2 (no sensor) + a TTY is present — the
#       §7.3 Priority 1 fallback documented in the Swift source.
#   (c) TouchID opt-in + hermetic bypass — the smoke test override; still
#       prompts on --yes-off + TTY for shape parity with (a).
# Under a TouchID exit 0 pass the physical gesture already gave consent; there
# is no second TTY prompt.
if { [ "${GOSLEEP_TOUCHID:-0}" != "1" ] \
     || [ "${GATE_RC:-2}" = "2" ] \
     || [ "$GATE_BYPASS" -eq 1 ]; } \
   && [ "$AUTO_YES" -eq 0 ] && [ "$have_tty" -eq 1 ]; then
  CONFIRM=""
  {
    echo ""
    echo "publish: Publish skill '$SKILL' to $PROD_DIR ?"
    echo "publish:   backup will be written to docs/skills/backups/${SKILL}-${FILENAME_TS}/"
    echo "publish:   rsync -a --delete skill/${SKILL}/ ${PROD_DIR}/"
    echo -n "publish: type 'yes' to proceed: "
  } > /dev/tty
  IFS= read -r -t 60 CONFIRM < /dev/tty || {
    echo "" > /dev/tty
    echo "publish: no reply within 60 s — aborting." >&2
    exit 3
  }
  case "$(printf '%s' "$CONFIRM" | tr '[:upper:]' '[:lower:]')" in
    yes|y) : ;;
    *)
      echo "publish: owner declined (typed '$CONFIRM') — aborting." >&2
      exit 3
      ;;
  esac
fi

# ---- pre-rsync backup --------------------------------------------------------
BACKUP_DIR="$BACKUPS_DIR/${SKILL}-${FILENAME_TS}"
mkdir -p "$BACKUPS_DIR"
if [ -d "$PROD_DIR" ]; then
  cp -a "$PROD_DIR" "$BACKUP_DIR" || {
    echo "publish: cp -a backup FAILED — aborting before rsync." >&2
    exit 1
  }
  echo "publish: backup written to $BACKUP_DIR" >&2
else
  # Production dir does not exist — no backup possible, but record the fact.
  mkdir -p "$BACKUP_DIR"
  echo "no-prod-copy-at-publish-time" > "$BACKUP_DIR/.gosleep-no-prod-copy"
  echo "publish: production dir absent; recorded placeholder backup at $BACKUP_DIR" >&2
fi

# ---- rsync (single skill, --delete) -----------------------------------------
mkdir -p "$PROD_DIR"
if ! rsync -a --delete "$SKILL_DIR/" "$PROD_DIR/"; then
  echo "publish: rsync FAILED — attempt to restore from backup:" >&2
  if [ -d "$BACKUP_DIR" ]; then
    rsync -a --delete "$BACKUP_DIR/" "$PROD_DIR/" || echo "publish: restore FAILED — production may be broken." >&2
  fi
  exit 1
fi
echo "publish: rsync ok" >&2

# ---- CHANGELOG row (via record-publish.ts write) -----------------------------
# Derive the commit from the latest commit that touched skill/<name>/.
COMMIT="$(cd "$REPO_ROOT" && git log -n 1 --format=%H -- "skill/$SKILL" 2>/dev/null || true)"
if [ -z "$COMMIT" ] || ! echo "$COMMIT" | grep -Eq '^[0-9a-f]{40}$'; then
  # Never-committed skill dir; use HEAD as an approximation and let the validator flag if needed.
  COMMIT="$(cd "$REPO_ROOT" && git rev-parse HEAD 2>/dev/null || echo 0000000000000000000000000000000000000000)"
fi

# Derive task key if not supplied.
if [ -z "$TASK" ]; then
  TASK="$(cd "$REPO_ROOT" && git log -n 1 --format=%s -- "skill/$SKILL" 2>/dev/null | grep -Eo '^GSL-[0-9]+' | head -1 || true)"
  [ -z "$TASK" ] && TASK="GSL-174"
fi

RECORD_ARGS=(run "$RECORD" write --skill "$SKILL" --task "$TASK" --commit "$COMMIT" --lesson "$LESSON" --status published)
if [ -n "$INTENT_ID" ]; then
  RECORD_ARGS+=(--intent-id "$INTENT_ID")
fi

if ! (cd "$REPO_ROOT" && bun "${RECORD_ARGS[@]}") >&2; then
  echo "publish: record-publish.ts FAILED to append CHANGELOG row — the rsync ALREADY LANDED." >&2
  echo "publish:   The backup is at $BACKUP_DIR; you can undo with:" >&2
  echo "publish:     rsync -a --delete $BACKUP_DIR/ $PROD_DIR/" >&2
  exit 1
fi

echo "publish: DONE — skill='$SKILL' → $PROD_DIR (backup: $BACKUP_DIR)" >&2

# Print a machine-readable JSON summary on stdout for the endpoint spawner.
printf '{"event":"skills.publish.done","skill":%s,"task":%s,"commit":%s,"backup":%s,"ts":%s,"intent_id":%s}\n' \
  "$(printf '%s' "$SKILL" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
  "$(printf '%s' "$TASK"  | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
  "$(printf '%s' "$COMMIT"| python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
  "$(printf '%s' "$BACKUP_DIR"| python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
  "$(printf '%s' "$UTC_TS"| python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
  "$(if [ -n "$INTENT_ID" ]; then printf '%s' "$INTENT_ID" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'; else printf 'null'; fi)"
