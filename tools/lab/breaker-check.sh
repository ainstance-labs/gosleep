#!/usr/bin/env bash
# =============================================================================
# gosleep lab — breaker-check: the circuit breaker's mechanical half (GSL-214).
#
# THE AUDIT FACT IT ANSWERS (F11): the circuit breaker existed only as prose in
# the skill — the prescribed `breaker=` line never appeared in STATE across
# ~104 cycles, breaker.* fired 0 times out of 1933 events. An instruction the
# LLM must remember every cycle, with zero machine support, is not a breaker.
#
# THE MINIMAL DESIGN (per the task): the ORCHESTRATOR writes ONE line in
# ORCHESTRATION-STATE.md at every cycle boundary (exact text + anchor:
# docs/handoff/GSL-178-errata-orchestration-state.md — STATE is sovereign, this
# tool never writes it); THIS script is the HEARTBEAT_OK item that READS it:
#
#   breaker=CLOSED since=<ISO> counters: next_same=0/2 no_pr=0/3 err_same=0/3 decline=0/2 …
#
# Checks: the line exists · parses (state CLOSED|OPEN|HALF_OPEN, since, four
# counters WITH denominators) · discipline holds (a counter at/over its
# denominator while CLOSED = the breaker is not being executed). State
# TRANSITIONS become events in docs/lab/events/ via lab-emit (breaker.opened /
# breaker.closed), edge-triggered through a memo file — reruns never duplicate.
#
# Exit codes (the HEARTBEAT_OK contract):
#   0  line present, parses, CLOSED or HALF_OPEN, counters under thresholds
#   1  line MISSING (today's honest F11 state, until the errata is applied),
#      malformed, or discipline violated (counter tripped but still CLOSED)
#   2  breaker is OPEN — a deliberate STOP, distinct from a format problem
#
# Usage: tools/lab/breaker-check.sh [--quiet]
# Env: GOSLEEP_STATE_FILE  (default <repo>/docs/handoff/ORCHESTRATION-STATE.md)
#      GOSLEEP_BREAKER_MEMO (default <repo>/.artifacts/lab/breaker-last-state)
#      GOSLEEP_LAB_DIR      honoured transitively by lab-emit (fixtures emit
#                           into their own lab dir — q-2026-07-28-005 discipline)
# 0 LLM calls. python3 stdlib only. macOS bash 3.2 safe.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_FILE="${GOSLEEP_STATE_FILE:-$ROOT/docs/handoff/ORCHESTRATION-STATE.md}"
MEMO="${GOSLEEP_BREAKER_MEMO:-$ROOT/.artifacts/lab/breaker-last-state}"
QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1
say() { [ "$QUIET" = "1" ] || echo "breaker-check: $*"; }

LINE="$(grep -E '^breaker=' "$STATE_FILE" 2>/dev/null | head -1 || true)"
if [ -z "$LINE" ]; then
  say "NO breaker= line in $STATE_FILE — the breaker discipline is not on the record (audit F11). Exact text to insert: docs/handoff/GSL-178-errata-orchestration-state.md"
  exit 1
fi

PARSED="$(printf '%s' "$LINE" | python3 -c '
import re, sys
line = sys.stdin.read().strip()
m = re.match(
    r"^breaker=(CLOSED|OPEN|HALF_OPEN)\s+since=(\S+)\s+counters:\s+"
    r"next_same=(\d+)/(\d+)\s+no_pr=(\d+)/(\d+)\s+err_same=(\d+)/(\d+)\s+decline=(\d+)/(\d+)",
    line)
if not m:
    print("MALFORMED"); raise SystemExit
state, since = m.group(1), m.group(2)
pairs = [(int(m.group(i)), int(m.group(i + 1))) for i in (3, 5, 7, 9)]
names = ["next_same", "no_pr", "err_same", "decline"]
tripped = [n for n, (a, b) in zip(names, pairs) if b > 0 and a >= b]
print("%s %s %s" % (state, since, (",".join(tripped) or "-")))
' 2>/dev/null || echo "MALFORMED")"

if [ "$PARSED" = "MALFORMED" ]; then
  say "breaker line MALFORMED (state/since/4 counters with denominators required): $LINE"
  exit 1
fi
B_STATE="$(printf '%s' "$PARSED" | awk '{print $1}')"
B_SINCE="$(printf '%s' "$PARSED" | awk '{print $2}')"
B_TRIPPED="$(printf '%s' "$PARSED" | awk '{print $3}')"

PREV="$(cat "$MEMO" 2>/dev/null || echo "")"
emit() { # $1=type $2=note
  bash "$SCRIPT_DIR/lab-emit.sh" event --type "$1" --actor breaker-check \
    --data "state=$B_STATE" --data "since=$B_SINCE" --data "note=$2" >/dev/null 2>&1 \
    || say "WARNING: lab-emit $1 failed (event not mirrored)"
}
mkdir -p "$(dirname "$MEMO")" 2>/dev/null || true

# Edge-triggered event mirroring: transitions only, reruns never duplicate.
if [ "$B_STATE" = "OPEN" ] && [ "$PREV" != "OPEN" ]; then
  emit "breaker.opened" "circuit breaker OPEN since=$B_SINCE (read from STATE by breaker-check)"
elif [ "$B_STATE" != "OPEN" ] && [ "$PREV" = "OPEN" ]; then
  emit "breaker.closed" "circuit breaker back to $B_STATE (read from STATE by breaker-check)"
fi
echo "$B_STATE" > "$MEMO" 2>/dev/null || true

if [ "$B_STATE" = "OPEN" ]; then
  say "breaker is OPEN since=$B_SINCE — deliberate STOP: no new work until cooldown + probe (skill: Circuit breaker section)"
  exit 2
fi
if [ "$B_TRIPPED" != "-" ]; then
  say "DISCIPLINE VIOLATED: counter(s) [$B_TRIPPED] at/over threshold while state=$B_STATE — the breaker should have opened and did not"
  exit 1
fi
say "breaker=$B_STATE since=$B_SINCE counters under thresholds — HEARTBEAT_OK item green"
exit 0
