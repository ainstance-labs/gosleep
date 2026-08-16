#!/usr/bin/env bash
# =============================================================================
# gosleep lab — lab-emit-rule: prove GSL-227 rule validation and rule_kind tagging.
#
# Hermetic: builds a fixture lab dir + fixture manifest under a temp path, runs
# `lab-emit decision` against them, and asserts the pass/fail cases. Never
# touches the live docs/lab/ tree.
#
# Usage:  tools/lab/tests/lab-emit-rule.sh   exit 0 = all cases pass
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
EMIT="$REPO_ROOT/tools/lab/lab-emit.sh"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/gsl227.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

export GOSLEEP_LAB_DIR="$WORK/lab"
export GOSLEEP_MANIFEST_PATH="$WORK/lab/decisions/manifest.md"
mkdir -p "$WORK/lab/questions" "$WORK/lab/decisions" "$WORK/lab/events"

# Minimal fixture manifest with three bullets across two sections. If the parser is right,
# §2.merge-strategy and §5.slots pass, §9.does-not-exist fails.
cat >"$GOSLEEP_MANIFEST_PATH" <<'MD'
# Fixture manifest

## 2. Decide-by-default

- §2.merge-strategy — regular merge on delivery branches
- §2.model-policy — Opus by default

## 5. Budget & runway

- §5.slots — max 3 worker slots
MD

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  PASS  %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$*"; }

run_emit() {
  # $1 = expected exit (0|nonzero); rest passed to lab-emit
  local want="$1"; shift
  local out err rc
  out=$(bash "$EMIT" "$@" 2>"$WORK/err") ; rc=$?
  err=$(cat "$WORK/err" 2>/dev/null)
  if [ "$want" = "0" ] && [ "$rc" -eq 0 ]; then
    printf '%s\n' "$out"
    return 0
  fi
  if [ "$want" != "0" ] && [ "$rc" -ne 0 ]; then
    printf 'ERR: %s\n' "$err" >&2
    return 0
  fi
  printf 'unexpected rc=%d out=%s err=%s\n' "$rc" "$out" "$err" >&2
  return 1
}

# ── case A: valid manifest citation ─────────────────────────────────────────
d_id=$(run_emit 0 decision --question "what merge strategy?" --decision "regular merge" \
                 --rule "manifest §2.merge-strategy") \
  && [ -n "$d_id" ] \
  && ok "accepts 'manifest §2.merge-strategy' -> $d_id" \
  || bad "rejected valid manifest citation"

# ── case B: valid manifest citation (short form) ────────────────────────────
d_id=$(run_emit 0 decision --question "how many worker slots?" --decision "3" \
                 --rule "§5.slots") \
  && ok "accepts short-form '§5.slots' -> $d_id" \
  || bad "rejected valid short-form citation"

# ── case C: unknown manifest bullet — must be rejected with a helpful error ─
if run_emit 1 decision --question "spend budget?" --decision "no" \
              --rule "manifest §9.does-not-exist" 2>&1 | grep -q "not in the manifest"; then
  ok "rejects §9.does-not-exist with 'not in the manifest' error"
else
  bad "did not reject unknown bullet with clear error"
fi

# ── case D: delegation rule — accepted as advisory ──────────────────────────
d_id=$(run_emit 0 decision --question "delegate a call?" --decision "yes" \
                 --rule "delegation:owner 2026-08-16") \
  && ok "accepts 'delegation:owner 2026-08-16' -> $d_id" \
  || bad "rejected valid delegation"

# ── case E: garbage rule — must be rejected ─────────────────────────────────
if run_emit 1 decision --question "some q" --decision "y" --rule "just because" 2>&1 \
     | grep -q "neither a manifest citation"; then
  ok "rejects free-form rule with citation-or-delegation error"
else
  bad "free-form rule was accepted or produced unclear error"
fi

# ── case F: owner-authored decision skips validation ────────────────────────
d_id=$(run_emit 0 decision --question "owner-authored" --decision "y" \
                 --by owner --rule "any string is fine when owner is the source") \
  && ok "owner-authored decisions skip rule validation -> $d_id" \
  || bad "owner-authored decision was rejected"

# ── case G: rule_kind is tagged on the record ────────────────────────────────
if python3 - <<PY
import json
p = "$GOSLEEP_LAB_DIR/decisions/log.jsonl"
recs = [json.loads(l) for l in open(p) if l.strip()]
kinds = [r.get("rule_kind","") for r in recs]
# Expect: manifest, manifest, delegation, "" (owner-skipped)
have_manifest = kinds.count("manifest") == 2
have_deleg    = kinds.count("delegation") == 1
have_blank    = kinds.count("") == 1  # owner-authored
assert have_manifest and have_deleg and have_blank, "unexpected rule_kind mix: %r" % kinds
# Canonical form must include the "manifest §" prefix on manifest citations
first = recs[0]
assert first["rule"].startswith("manifest §"), "canonicalization missing: %r" % first["rule"]
PY
then
  ok "records carry rule_kind + canonical rule string"
else
  bad "rule_kind or canonicalization missing"
fi

printf '\nresult: %d pass, %d fail\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
