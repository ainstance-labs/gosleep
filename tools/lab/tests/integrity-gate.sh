#!/usr/bin/env bash
# =============================================================================
# gosleep lab — integrity-gate test: prove GSL-234 warning-mode gate.
#
# Builds two tiny scratch repos: one where every artifact is in place (OK), one
# where all three are missing (WARN). Exercises the four checks (commit, dev_history,
# gh_mirror, and the --recent scan) and the three modes (text, json, json-only).
# The gate must always exit 0 in warning mode.
#
# Usage:  tools/lab/tests/integrity-gate.sh   exit 0 = all cases pass
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
GATE="$REPO_ROOT/tools/lab/integrity-gate.sh"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/gsl234.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  PASS  %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$*"; }

# ── build a scratch repo with everything in place ────────────────────────────
GOOD="$WORK/good"
mkdir -p "$GOOD"; cd "$GOOD"
git init -q -b main
git config user.email test@example.com
git config user.name test
mkdir -p docs/dev_history
cat > docs/dev_history/GSL-1000-phase-integrity-gate.md <<'MD'
# GSL-1000 — integrity gate happy path

Mirrors GH #12345 (https://github.com/ainstance-labs/gosleep/issues/12345).
MD
git add docs/dev_history/GSL-1000-phase-integrity-gate.md
git commit -q -m "GSL-1000 [Tooling] pass the integrity gate happy path"

cd "$REPO_ROOT"
# Under the good repo: GSL-1000 should be OK, GSL-2000 should WARN on all three.
out_stdout=$(GOSLEEP_REPO_ROOT="$GOOD" bash "$GATE" --json-only GSL-1000 GSL-2000 2>/dev/null)
rc=$?
[ "$rc" -eq 0 ] && ok "exits 0 in warning mode regardless of findings" \
              || bad "exit code $rc (should be 0 under warning mode)"

if printf '%s' "$out_stdout" | grep -q '"key":"GSL-1000","status":"ok"'; then
  ok "GSL-1000 with all three artifacts prints status=ok"
else
  bad "GSL-1000 was not marked ok. out=$out_stdout"
fi

if printf '%s' "$out_stdout" | grep -q '"key":"GSL-2000","status":"warn"'; then
  ok "GSL-2000 with no artifacts prints status=warn"
else
  bad "GSL-2000 was not marked warn"
fi

# Missing list must name all three
if printf '%s' "$out_stdout" | grep -q '"GSL-2000".*"commit".*"dev_history".*"gh_mirror"'; then
  ok "GSL-2000 missing list names commit + dev_history + gh_mirror"
else
  bad "missing list wrong. out=$out_stdout"
fi

# ── mixed-mode text output includes the exact per-key WARN line ─────────────
GOSLEEP_REPO_ROOT="$GOOD" bash "$GATE" GSL-1000 GSL-2000 >/dev/null 2>"$WORK/err"
if grep -qE '^WARN[[:space:]]+GSL-2000:[[:space:]]+missing=commit dev_history gh_mirror$' "$WORK/err"; then
  ok "text mode prints 'WARN GSL-2000: missing=commit dev_history gh_mirror'"
else
  bad "text-mode warn line missing or wrong shape (err=$(cat "$WORK/err"))"
fi

# ── partial artifacts: commit only, no dev_history, no mirror ────────────────
cd "$GOOD"
git commit --allow-empty -q -m "GSL-3000 [Tooling] commit-only, no history, no mirror"
cd "$REPO_ROOT"
out=$(GOSLEEP_REPO_ROOT="$GOOD" bash "$GATE" --json-only GSL-3000 2>/dev/null)
if printf '%s' "$out" | grep -q '"key":"GSL-3000","status":"warn"' \
   && printf '%s' "$out" | grep -q '"dev_history".*"gh_mirror"' \
   && ! printf '%s' "$out" | grep -q '"commit"'; then
  ok "commit-only task: missing includes dev_history + gh_mirror, NOT commit"
else
  bad "partial-artifact test wrong. out=$out"
fi

# ── mirror embedded in a commit BODY (not dev_history) still satisfies ──────
cd "$GOOD"
git commit --allow-empty -q -m "GSL-4000 [Tooling] mirror in body only

Mirrors GH #45678 (https://github.com/ainstance-labs/gosleep/issues/45678)."
mkdir -p docs/dev_history
touch docs/dev_history/GSL-4000-phase-mirror-body.md
git add docs/dev_history/GSL-4000-phase-mirror-body.md
git commit -q -m "GSL-4000 [Docs] history file (body has the mirror)"
cd "$REPO_ROOT"
out=$(GOSLEEP_REPO_ROOT="$GOOD" bash "$GATE" --json-only GSL-4000 2>/dev/null)
if printf '%s' "$out" | grep -q '"key":"GSL-4000","status":"ok"'; then
  ok "GSL-4000: mirror mentioned in a commit body counts as gh_mirror"
else
  bad "GSL-4000: commit-body mirror not detected. out=$out"
fi

# ── --recent scan picks up keys from the last N commits ──────────────────────
cd "$GOOD"
git commit --allow-empty -q -m "GSL-5000 [Tooling] recent-only, no history, no mirror"
cd "$REPO_ROOT"
out=$(GOSLEEP_REPO_ROOT="$GOOD" bash "$GATE" --recent 5 --json-only 2>/dev/null)
if printf '%s' "$out" | grep -q '"key":"GSL-5000","status":"warn"'; then
  ok "--recent picks up GSL-5000 from the last-5 commit window and warns on it"
else
  bad "--recent did not surface GSL-5000. out=$out"
fi

printf '\nresult: %d pass, %d fail\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
