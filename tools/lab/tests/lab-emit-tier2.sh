#!/usr/bin/env bash
# =============================================================================
# gosleep lab — lab-emit-tier2: prove GSL-228 tier-2 hard floor at question emit.
#
# Money / external comms / secrets / destructive+production keywords force the
# question to BLOCKER by CODE. A non-BLOCKER `question` is refused with an
# actionable error naming the category. FYI/DECISION questions that only
# mention a nearby noun ("budget 80% crossed") are NOT tripped — the floor is
# verb-focused on purpose.
#
# Usage:  tools/lab/tests/lab-emit-tier2.sh   exit 0 = all cases pass
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
EMIT="$REPO_ROOT/tools/lab/lab-emit.sh"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/gsl228.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
export GOSLEEP_LAB_DIR="$WORK/lab"
mkdir -p "$GOSLEEP_LAB_DIR/questions" "$GOSLEEP_LAB_DIR/decisions" "$GOSLEEP_LAB_DIR/events"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  PASS  %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$*"; }

# expect_refused <label> <expected-category> -- <emit args>
expect_refused() {
  local label="$1" cat="$2"; shift 2
  # drop leading --
  [ "$1" = "--" ] && shift
  local err rc
  err=$(bash "$EMIT" "$@" 2>&1 >/dev/null)
  rc=$?
  if [ "$rc" -eq 0 ]; then
    bad "$label: expected refusal, got exit 0"
    return
  fi
  if printf '%s' "$err" | grep -q "tier-2 floor"; then
    if printf '%s' "$err" | grep -q "$cat"; then
      ok "$label -> refused, category=$cat"
    else
      bad "$label refused but wrong category (want=$cat, err=$err)"
    fi
  else
    bad "$label refused for a different reason: $err"
  fi
}

expect_accepted() {
  local label="$1"; shift
  [ "$1" = "--" ] && shift
  local out rc
  out=$(bash "$EMIT" "$@" 2>&1)
  rc=$?
  if [ "$rc" -eq 0 ] && [ -n "$out" ]; then
    ok "$label -> accepted ($out)"
  else
    bad "$label: rc=$rc out=$out"
  fi
}

# ── money ────────────────────────────────────────────────────────────────────
expect_refused "spend beyond ceiling" "money" -- question \
  --type DECISION --from smoke --task GSL-1 \
  --question "spend beyond the token ceiling this week?" \
  --default "yes" --reversibility high
expect_refused "purchase a subscription" "money" -- question \
  --type CLARIFY --from smoke --task GSL-1 \
  --question "should we purchase the Vercel Pro subscription?" \
  --default "no" --reversibility high

# ── secrets ──────────────────────────────────────────────────────────────────
expect_refused "rotate the api key" "secrets" -- question \
  --type DECISION --from smoke --task GSL-1 \
  --question "rotate the leaked API key overnight?" \
  --default "no" --reversibility high
expect_refused "publish the token" "secrets" -- question \
  --type CLARIFY --from smoke --task GSL-1 \
  --question "publish the token in the runbook?" \
  --default "no" --reversibility high

# ── external comms ───────────────────────────────────────────────────────────
expect_refused "send email to customer" "external_comms" -- question \
  --type DECISION --from smoke --task GSL-1 \
  --question "send email to customer about the outage?" \
  --default "no" --reversibility high
expect_refused "publish blog post" "external_comms" -- question \
  --type DECISION --from smoke --task GSL-1 \
  --question "publish blog post announcing the incident?" \
  --default "no" --reversibility high

# ── destructive / production ─────────────────────────────────────────────────
expect_refused "force-push" "destructive" -- question \
  --type DECISION --from smoke --task GSL-1 \
  --question "force-push the epic branch?" \
  --default "no" --reversibility high
expect_refused "delete branch" "destructive" -- question \
  --type DECISION --from smoke --task GSL-1 \
  --question "delete branch feature/x now?" \
  --default "no" --reversibility high
expect_refused "prod deploy" "destructive" -- question \
  --type DECISION --from smoke --task GSL-1 \
  --question "deploy to production before the freeze?" \
  --default "no" --reversibility high

# ── BLOCKER is allowed — the floor is BLOCKER, and the question already is one ─
expect_accepted "spend beyond ceiling as BLOCKER" -- question \
  --type BLOCKER --from smoke --task GSL-1 \
  --question "spend beyond the token ceiling this week?"
expect_accepted "rotate api key as BLOCKER" -- question \
  --type BLOCKER --from smoke --task GSL-1 \
  --question "rotate the leaked API key overnight?"

# ── negative cases — NOT tier-2, must not trip ───────────────────────────────
expect_accepted "budget 80% crossed FYI" -- question \
  --type FYI --from smoke --question "budget 80% crossed for the week"
expect_accepted "rebase or merge main" -- question \
  --type DECISION --from smoke --task GSL-1 \
  --question "rebase or merge main into the epic branch?" \
  --default "merge main in" --reversibility high
expect_accepted "sentence-case README heading" -- question \
  --type CLARIFY --from smoke --task GSL-1 \
  --question "README heading case?" --default "sentence case" --reversibility high

printf '\nresult: %d pass, %d fail\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
