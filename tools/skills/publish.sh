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
PROD_DIR="$HOME/.claude/skills/$SKILL"

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

# ---- interactive confirmation ------------------------------------------------
#
# TouchID leg is PAUSED (d-2026-08-09-001). When the pause lifts, replace the
# TTY-confirm block below with an invocation of `apps/core/bin/touchid-gate.app`
# (rev-3 addendum Delta 4) — one function call, exit code 0/1/2 → same
# behaviour as here.
#
# TODO(GSL-288): TouchID wiring.
#   open -W -a "$REPO_ROOT/apps/core/bin/touchid-gate.app"
#   case $? in 0) ok ;; 1) exit 3 ;; 2) fallback to TTY-confirm ;; esac
if [ "$AUTO_YES" -eq 0 ] && [ "$have_tty" -eq 1 ]; then
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
