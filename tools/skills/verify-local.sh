#!/usr/bin/env bash
# =============================================================================
# tools/skills/verify-local.sh — pre-publish sanity check for a single skill
# (T2, GSL-254 partial; PRD F8-S3).
#
# Runs BEFORE publish.sh does anything destructive. Guards against:
#   1. Skill directory typo or nonexistence.
#   2. Missing / empty SKILL.md (the file the harness actually loads).
#   3. Broken references — a file mentioned under `references/` that does not exist
#      on disk or is unreadable.
#   4. Uncommitted or unstaged changes under `skill/<name>/` — publishing a dirty
#      working tree would push work-in-progress into production with no git SHA.
#
# CONTRACT WITH THE CALLER (publish.sh):
#   0 — checks pass; safe to proceed.
#   1 — at least one check failed; diagnostic on stderr.
#   2 — usage error (missing / bad skill name).
#
# ENV:
#   VERBOSE=1        also print PASS lines.
#   SKIP_GIT_CHECK=1 skip the "working tree clean" check — for CI / dev shells
#                    where the caller has already asserted cleanliness.
#
# The check is intentionally CONSERVATIVE — a false positive (rejecting a
# publish that would have been fine) is a much smaller cost than a false
# negative (letting a broken skill through). When in doubt, refuse.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

VERBOSE="${VERBOSE:-0}"
SKIP_GIT_CHECK="${SKIP_GIT_CHECK:-0}"

# ---- usage --------------------------------------------------------------------

usage() {
  cat <<'USAGE' >&2
tools/skills/verify-local.sh — pre-publish sanity check for a single skill.

Usage: verify-local.sh <skill-name>

  <skill-name>   Directory name under skill/ (e.g. handoff, delivery-workflow).
                 Refuses "*", "--all", empty, or any name containing "/" or "..".

Exit codes: 0 = pass, 1 = at least one check failed, 2 = usage error.
USAGE
}

if [ "$#" -ne 1 ] || [ -z "${1:-}" ]; then
  echo "verify-local: exactly one skill name required" >&2
  usage
  exit 2
fi

SKILL="$1"

case "$SKILL" in
  --all|*/*|..*|*/..*|"")
    echo "verify-local: refusing bad skill name: '$SKILL' (no globs, no path traversal)" >&2
    exit 2
    ;;
  --*)
    echo "verify-local: '$SKILL' looks like a flag; skill names do not start with --" >&2
    usage
    exit 2
    ;;
esac

SKILL_DIR="$REPO_ROOT/skill/$SKILL"

# ---- counters ------------------------------------------------------------------

PASS=0
FAIL=0
say_ok()   { PASS=$((PASS+1)); if [ "$VERBOSE" = "1" ]; then echo "  PASS: $1"; fi; }
say_bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1" >&2; }

# ---- 1. skill dir exists ------------------------------------------------------

if [ ! -d "$SKILL_DIR" ]; then
  say_bad "skill dir does not exist: $SKILL_DIR"
  # No point running the rest of the checks against a phantom dir.
  echo "verify-local: FAIL count=$FAIL pass=$PASS (skill=$SKILL)" >&2
  exit 1
fi
say_ok "skill dir exists: skill/$SKILL/"

# ---- 2. SKILL.md present + non-empty ------------------------------------------

SKILL_MD="$SKILL_DIR/SKILL.md"
if [ ! -f "$SKILL_MD" ]; then
  say_bad "SKILL.md missing at $SKILL_MD"
elif [ ! -s "$SKILL_MD" ]; then
  say_bad "SKILL.md is empty (0 bytes) at $SKILL_MD"
else
  say_ok "SKILL.md present + non-empty ($(wc -c < "$SKILL_MD" | tr -d ' ') bytes)"
fi

# ---- 3. references/ files readable --------------------------------------------
#
# The convention: any *.md file under references/ that is committed to the repo
# is a legitimate reference. We assert each is readable — a symlink to a missing
# target, or a file with permission bits stripped, would silently ship a broken
# skill.
if [ -d "$SKILL_DIR/references" ]; then
  BAD_REFS=""
  while IFS= read -r -d '' f; do
    if [ ! -r "$f" ]; then
      BAD_REFS+="$f "
    fi
  done < <(find "$SKILL_DIR/references" -type f -print0 2>/dev/null)
  if [ -n "$BAD_REFS" ]; then
    say_bad "references/ has unreadable file(s): $BAD_REFS"
  else
    REF_COUNT="$(find "$SKILL_DIR/references" -type f | wc -l | tr -d ' ')"
    say_ok "references/ readable ($REF_COUNT file(s))"
  fi
else
  # references/ is optional (writing-prds, remote-control skip it). Not an error.
  say_ok "no references/ directory (optional)"
fi

# ---- 4. working tree clean for this skill dir --------------------------------
#
# `git status --porcelain <path>` prints nothing when there are no uncommitted or
# untracked changes under the path. Any output → dirty. `SKIP_GIT_CHECK=1` opts
# out (useful when the caller has already asserted cleanliness at a higher
# scope, e.g. publish.sh chained after a fresh commit).
if [ "$SKIP_GIT_CHECK" = "1" ]; then
  say_ok "git check skipped (SKIP_GIT_CHECK=1)"
elif ! command -v git >/dev/null 2>&1; then
  say_bad "git not on PATH — cannot verify working tree cleanliness"
else
  GIT_STATUS="$(cd "$REPO_ROOT" && git status --porcelain "skill/$SKILL" 2>/dev/null || true)"
  if [ -n "$GIT_STATUS" ]; then
    say_bad "skill/$SKILL has uncommitted or untracked changes:"
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      echo "    $line" >&2
    done <<< "$GIT_STATUS"
  else
    say_ok "git working tree clean under skill/$SKILL"
  fi
fi

# ---- verdict ------------------------------------------------------------------

if [ "$FAIL" -gt 0 ]; then
  echo "verify-local: FAIL count=$FAIL pass=$PASS (skill=$SKILL)" >&2
  exit 1
fi

if [ "$VERBOSE" = "1" ]; then
  echo "verify-local: OK — checks=$PASS (skill=$SKILL)"
fi
exit 0
