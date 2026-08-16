#!/usr/bin/env bash
# =============================================================================
# gosleep lab — integrity-gate: verify the three delivery artifacts before Done.
# (GSL-234; audit findings 25, 26, 27 MAJOR — "15 tasks Done without a single
#  artifact and 21 tasks without a mirror". The rule from CLAUDE.md is that a
#  task in Done must carry: (a) a commit whose SUBJECT starts with the task key,
#  (b) a docs/dev_history/<KEY>-*.md file, and (c) a GitHub mirror reference.)
#
# WARNING MODE. Prints missing items to stderr, exits 0. The task explicitly asks
# for "warning-mode start" so shipping under this gate does not slow delivery on
# day one; a later revision can flip the exit to non-zero when the fleet stops
# producing warnings.
#
# Usage:
#   integrity-gate.sh KEY [KEY ...]                  # check the given keys
#   integrity-gate.sh --recent [N]                   # last N=20 GSL keys from git log
#   integrity-gate.sh --json    KEY [KEY ...]        # JSON per task, one per line
#   integrity-gate.sh --json-only KEY [KEY ...]      # same, no summary text
#
# Env:
#   GOSLEEP_REPO_ROOT   override the repo root (default: derived from $0).
#
# Exit code: ALWAYS 0 under warning mode. A future strict mode would exit 1 on
# any warning; that decision is out of scope here (owner directive per audit).
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${GOSLEEP_REPO_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
cd "$REPO_ROOT"

MODE=text
KEYS=()

usage() {
  cat >&2 <<'USAGE'
usage: integrity-gate.sh [--json | --json-only] [--recent [N]] KEY [KEY ...]
  --json         emit one JSON object per task on stdout, keep the summary text
  --json-only    emit JSON only (no summary)
  --recent [N]   scan the last N=20 commits for GSL-* keys and check them all
  --help         this message

Checks for each task key:
  * commit       — `git log --grep "^KEY "` returns at least one commit
  * dev_history  — `docs/dev_history/KEY-*.md` exists in the git index
  * gh_mirror    — dev_history OR a commit body mentions the GH issues URL
                   (github.com/ainstance-labs/gosleep/issues/) or the
                   "Mirrors GH #N" phrase

Exit code: ALWAYS 0 under warning mode. Report is on stderr; --json output on stdout.
USAGE
  exit 2
}

# ── parse args ───────────────────────────────────────────────────────────────
while [ "$#" -gt 0 ]; do
  case "$1" in
    --json)      MODE=json; shift ;;
    --json-only) MODE=json-only; shift ;;
    --recent)
      shift
      N=20
      case "${1:-}" in [0-9]*) N="$1"; shift ;; esac
      # First token on each subject that matches GSL-N; sort -u to fold duplicates
      while IFS= read -r k; do
        [ -n "$k" ] && KEYS+=("$k")
      done < <(git log -n "$N" --format='%s' 2>/dev/null \
               | grep -oE '^GSL-[0-9]+' | sort -u)
      ;;
    -h|--help) usage ;;
    GSL-*|gsl-*)
      KEYS+=("$(printf '%s' "$1" | tr 'a-z' 'A-Z')"); shift ;;
    *) printf 'unknown arg: %s\n' "$1" >&2; usage ;;
  esac
done

[ "${#KEYS[@]}" -gt 0 ] || usage

# ── checks per key ───────────────────────────────────────────────────────────
say_stderr() { printf '%s\n' "$*" >&2; }

miss_total=0
warn_keys=0

for key in "${KEYS[@]}"; do
  missing=()

  # (a) commit with key at SUBJECT start. Anchor with `^KEY ` so a body mention
  # of the key does not launder as a commit subject. Capture the subjects first —
  # `git log | grep -q` under `set -o pipefail` returns 141 (git log SIGPIPE'd by
  # grep -q's early exit) which the `if !` would misread as "no commit found".
  SUBJECTS="$(git log --all --format='%s' 2>/dev/null || true)"
  if ! printf '%s\n' "$SUBJECTS" | grep -q "^${key} "; then
    missing+=("commit")
  fi

  # (b) dev_history file in the git INDEX (not the working tree). A fresh clone
  # gets what git carries, not what an uncommitted local branch shows.
  HISTORY_FILES="$(git ls-files -- "docs/dev_history/${key}-*.md" 2>/dev/null || true)"
  if [ -z "$HISTORY_FILES" ]; then
    missing+=("dev_history")
  fi

  # (c) GH mirror. Cheap heuristic: look for the GH issues URL or "Mirrors GH #N"
  # in EITHER the dev_history for this key OR the body of a commit carrying the
  # key in its subject. Both are how the delivery-workflow skill records mirrors.
  mirror_found=0
  if [ -n "$HISTORY_FILES" ]; then
    if printf '%s\n' "$HISTORY_FILES" | \
         xargs -I{} grep -lE 'github\.com/ainstance-labs/gosleep/issues/|Mirrors? GH #' {} \
         2>/dev/null | grep -q .; then
      mirror_found=1
    fi
  fi
  if [ "$mirror_found" -eq 0 ]; then
    BODIES="$(git log --all --format='%B' --grep "^${key} " 2>/dev/null || true)"
    if printf '%s\n' "$BODIES" | grep -qE 'github\.com/ainstance-labs/gosleep/issues/|Mirrors? GH #'; then
      mirror_found=1
    fi
  fi
  [ "$mirror_found" -eq 1 ] || missing+=("gh_mirror")

  # ── report per key
  if [ "${#missing[@]}" -gt 0 ]; then
    miss_total=$((miss_total + ${#missing[@]}))
    warn_keys=$((warn_keys + 1))
    case "$MODE" in
      json|json-only)
        # Build the JSON list without pulling in jq — 4 fixed labels, no user data.
        joined=""
        for m in "${missing[@]}"; do
          joined="${joined:+$joined,}\"$m\""
        done
        printf '{"key":"%s","status":"warn","missing":[%s]}\n' "$key" "$joined"
        ;;
    esac
    if [ "$MODE" != "json-only" ]; then
      say_stderr "WARN  $key: missing=${missing[*]}"
    fi
  else
    if [ "$MODE" = "json" ] || [ "$MODE" = "json-only" ]; then
      printf '{"key":"%s","status":"ok","missing":[]}\n' "$key"
    fi
    if [ "$MODE" = "text" ]; then
      printf 'OK    %s: commit=yes dev_history=yes gh_mirror=yes\n' "$key"
    fi
  fi
done

if [ "$MODE" != "json-only" ]; then
  total="${#KEYS[@]}"
  say_stderr "integrity-gate: keys=$total warn=$warn_keys items=$miss_total (mode=warning; exit=0)"
fi
exit 0
