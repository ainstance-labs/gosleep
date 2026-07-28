#!/usr/bin/env bash
# =============================================================================
# gosleep lab — gate: THE standard shift gate, as code (GSL-203; audit finding 12, MAJOR).
#
# WHAT THIS FIXES. The shift gate used to live as PROSE in worker briefs and handoffs, and that
# prose said `chronicler.sh --no-poll` — so the standard path SKIPPED the tracker reconcile, the
# tracker went unpolled for 11 days, and 152 of 161 tasks sat statusless on the board while every
# gate shone green. A gate that is a sentence drifts; a gate that is a script has one truth.
#
# THE RULE THIS SCRIPT ENCODES: the STANDARD path polls. `--no-poll` is not an optimization, it
# is an OFFLINE MODE, and offline is a thing you declare (`--offline`), not a default you inherit.
# (Inside tick.sh the chronicler still runs --no-poll BY COMPOSITION — its step 1 just polled;
# that is "don't poll twice per tick", not "don't poll".)
#
# The four gates, in the order a worker runs them before every commit:
#   1. smoke.sh                 the lab contract, hermetic          (baseline grows per task)
#   2. hooks-verify.sh          the event layer FIRES on this box   (claude -p real-run leg)
#   3. tsc --noEmit             the UI typechecks
#   4. chronicler.sh            derived surfaces rebuild — WITH the poll-fill reconcile (the
#                               Jira feed rides docs/lab/scratch/jira-poll.json per GSL-223, or
#                               MCP-side dumps; a missing feed degrades LOUDLY in the report)
#
# Each runner already writes its own receipt to .artifacts/lab/gates/*.json (GSL-206); this
# script adds gate.json — the one-line verdict of the whole gate, timestamped, machine-readable.
#
# Usage:
#   tools/lab/gate.sh              # the standard shift gate (polls the tracker)
#   tools/lab/gate.sh --offline    # DECLARED offline: chronicler --no-poll, hooks-verify
#                                  # --offline (no claude -p leg); the receipt says offline=true
#   tools/lab/gate.sh --fast       # skip smoke + hooks-verify (mid-task sanity only — the
#                                  # pre-commit gate is the FULL one; the receipt says fast=true)
#
# Exit: 0 only when every gate it ran passed.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OFFLINE=0
FAST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --offline) OFFLINE=1; shift ;;
    --fast)    FAST=1; shift ;;
    *) echo "gate: unknown flag $1 (known: --offline --fast)" >&2; exit 2 ;;
  esac
done

FAILED=""
note() { echo "gate: $*"; }

run_gate() {  # run_gate <name> <cmd...>
  local name="$1"; shift
  note "── $name ──"
  "$@"
  local rc=$?
  if [ $rc -ne 0 ]; then
    FAILED="$FAILED $name"
    note "$name FAILED (rc=$rc)"
  fi
  return 0
}

if [ "$FAST" = "1" ]; then
  note "--fast: skipping smoke + hooks-verify (mid-task sanity; the pre-commit gate is the full one)"
else
  run_gate smoke bash "$SCRIPT_DIR/smoke.sh"
  if [ "$OFFLINE" = "1" ]; then
    run_gate hooks-verify bash "$SCRIPT_DIR/hooks-verify.sh" --offline
  else
    run_gate hooks-verify bash "$SCRIPT_DIR/hooks-verify.sh"
  fi
fi

run_gate tsc bash -c "cd '$SCRIPT_DIR/ui' && npx tsc --noEmit"

# The standard path POLLS. Offline is declared, never inherited (finding 12).
if [ "$OFFLINE" = "1" ]; then
  note "── chronicler (DECLARED offline: --no-poll) ──"
  run_gate chronicler bash "$SCRIPT_DIR/chronicler.sh" --no-poll --quiet
else
  run_gate chronicler bash "$SCRIPT_DIR/chronicler.sh" --quiet
fi

mkdir -p "$ROOT/.artifacts/lab/gates" 2>/dev/null
printf '{"gate":"gate","ts":"%s","offline":%s,"fast":%s,"failed":"%s","runner":"tools/lab/gate.sh"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$OFFLINE" "$FAST" "${FAILED# }" \
  > "$ROOT/.artifacts/lab/gates/gate.json" 2>/dev/null || true

if [ -n "$FAILED" ]; then
  note "VERDICT: FAILED —$FAILED"
  exit 1
fi
note "VERDICT: all gates green$( [ "$OFFLINE" = "1" ] && echo ' (offline mode — tracker NOT reconciled, say so in the report)' )"
exit 0
