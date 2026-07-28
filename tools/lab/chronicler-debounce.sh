#!/usr/bin/env bash
# =============================================================================
# gosleep lab — chronicler-debounce: the RETURNED PostToolUse trigger (GSL-198).
#
# THE ELEMENT THAT FELL OUT. The original research (05-lab-ui-mobile-autonomy.md:184) designed
# three chronicler triggers, one of them verbatim: "a PostToolUse async hook debounced on writes
# to docs/lab/". The PostToolUse hook got built (GSL-83, three matchers), the debounce did not —
# so every derived surface (status.json, site/, digest/) went stale until a live agent REMEMBERED
# to run the chronicler. Audit findings 1 and 11 (both MAJOR): the described mechanism had no
# executor. This script is that executor: 0 tokens, no model cooperation, no pane, no spawn slot.
#
# HOW IT WORKS (classic trailing-edge debounce with a max-wait ceiling):
#   1. Every PostToolUse payload is piped in by the fail-open shim
#      (tools/hooks/chronicler-debounce-hook.sh). A crude bash `case` rejects the ~95% of calls
#      that cannot have touched a lab surface — no process spawned, exit in ~1ms.
#   2. A python3 check then matches PRECISELY on tool_input (file_path / command), never on
#      tool_response — the GSL-83 lesson: a command whose OUTPUT merely mentions docs/lab/
#      (`git status` in this repo!) must not count as a write to it.
#   3. A hit touches the last-write stamp and arms ONE background waiter (mkdir lock). The waiter
#      sleeps until docs/lab/ has been quiet for GOSLEEP_DEBOUNCE_QUIET seconds (default 90) —
#      or until GOSLEEP_DEBOUNCE_MAX_WAIT (default 600) has passed since the first pending write,
#      so a chatty session cannot starve the rebuild forever. Then it runs the chronicler ONCE,
#      appends one ledger line, re-checks for writes that landed DURING the rebuild, and exits.
#
# WHAT A TRIGGER IS (and is not). tool_input containing "docs/lab/" or "tools/lab/lab-" — the
# lab surfaces and the lab writers (lab-emit/lab-log/lab-write append to docs/lab/ without naming
# it on the command line). NOT chronicler.sh / tick.sh / smoke.sh runs: the rebuild must never
# re-trigger itself. A false positive costs one idempotent rebuild; a false negative costs a stale
# dashboard — so ties break toward firing.
#
# THE EXIT RACE, HONESTLY. Between the waiter's final re-check and its lock release there is a
# window where a new write sees the lock still held and arms nothing. The window is milliseconds;
# the cost is one missed debounce; the safety net is exactly tools/lab/tick.sh (GSL-199), whose
# job is "the chronicler, if the debounce did not fire". Belt here, braces there.
#
# Env (all optional — the defaults are production):
#   GOSLEEP_DEBOUNCE_DISABLE=1   kill switch: exit 0 before reading anything
#   GOSLEEP_DEBOUNCE_DIR         state dir (stamps + waiter lock), default .artifacts/lab/debounce
#   GOSLEEP_DEBOUNCE_QUIET       seconds of silence before the rebuild (default 90)
#   GOSLEEP_DEBOUNCE_MAX_WAIT    rebuild ceiling under continuous writes (default 600)
#   GOSLEEP_DEBOUNCE_CMD         test seam: run THIS instead of chronicler.sh (smoke uses it)
#   GOSLEEP_TICK_LEDGER          ledger path, default docs/lab/supervision/tick-ledger.jsonl
#
# Exit: ALWAYS 0 through the shim (the event layer never blocks a session — GSL-83, learned the
# hard way). Directly: 0 on no-op or armed; the waiter's fate never propagates to the tool call.
# 0 LLM calls (C1). bash + python3 stdlib + BSD stat/date only. macOS bash 3.2 safe.
# =============================================================================
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
STATE="${GOSLEEP_DEBOUNCE_DIR:-$ROOT/.artifacts/lab/debounce}"
QUIET="${GOSLEEP_DEBOUNCE_QUIET:-90}"
MAX_WAIT="${GOSLEEP_DEBOUNCE_MAX_WAIT:-600}"
RUN_CMD="${GOSLEEP_DEBOUNCE_CMD:-}"
LEDGER="${GOSLEEP_TICK_LEDGER:-$ROOT/docs/lab/supervision/tick-ledger.jsonl}"
LOCK="$STATE/waiter.lock"

[ "${GOSLEEP_DEBOUNCE_DISABLE:-0}" = "1" ] && exit 0

PAYLOAD="$(cat 2>/dev/null || true)"

# Fast path: most tool calls never mention a lab surface anywhere in the payload — reject them
# without spawning a single process. Substring over the WHOLE payload here is deliberately crude
# (tool_response included); precision comes next.
case "$PAYLOAD" in
  *"docs/lab/"*) : ;;
  *"tools/lab/lab-"*) : ;;
  *) exit 0 ;;
esac

# Precise check: only tool_input counts. `git status` listing a dirty docs/lab/events file is a
# READ of the world, not a write to the lab — tool_response must never arm the debounce.
printf '%s' "$PAYLOAD" | python3 -c '
import json, sys
try:
    p = json.load(sys.stdin)
except Exception:
    sys.exit(1)
ti = p.get("tool_input") or {}
s = " ".join(str(ti.get(k, "")) for k in ("file_path", "command", "edits", "content"))
sys.exit(0 if ("docs/lab/" in s or "tools/lab/lab-" in s) else 1)
' || exit 0

mkdir -p "$STATE" 2>/dev/null || exit 0
[ -f "$STATE/first-write" ] || : > "$STATE/first-write"
: > "$STATE/last-write"

ledger_line() {
  # One O_APPEND line (< PIPE_BUF => atomic). The ledger is the debounce's only voice: it is how
  # tick.sh (GSL-199) and the owner tell "the hook rebuilt at 03:07" from "nothing ever ran".
  mkdir -p "$(dirname "$LEDGER")" 2>/dev/null || return 0
  printf '{"ts":"%s","mode":"debounce","carrier":"post-tool-use-hook","rc":%s,"duration_s":%s,"quiet_s":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$QUIET" >> "$LEDGER" 2>/dev/null || true
}

rebuild() {
  local t0 t1 rc
  t0="$(date +%s)"
  if [ -n "$RUN_CMD" ]; then
    bash -c "$RUN_CMD" >/dev/null 2>&1
    rc=$?
  else
    bash "$ROOT/tools/lab/chronicler.sh" --quiet >/dev/null 2>&1
    rc=$?
  fi
  t1="$(date +%s)"
  ledger_line "$rc" "$((t1 - t0))"
}

waiter() {
  local now last first run_started wait_s
  while :; do
    touch "$LOCK" 2>/dev/null || true     # heartbeat: a silent lock is a dead waiter (stealable)
    now="$(date +%s)"
    last="$(stat -f %m "$STATE/last-write" 2>/dev/null || echo 0)"
    first="$(stat -f %m "$STATE/first-write" 2>/dev/null || echo "$now")"
    if [ $((now - last)) -ge "$QUIET" ] || [ $((now - first)) -ge "$MAX_WAIT" ]; then
      run_started="$(date +%s)"
      rm -f "$STATE/first-write" 2>/dev/null
      rebuild
      # Writes that landed while the chronicler ran: go around again instead of dropping them.
      last="$(stat -f %m "$STATE/last-write" 2>/dev/null || echo 0)"
      if [ "$last" -le "$run_started" ]; then
        break
      fi
      : > "$STATE/first-write"
    else
      wait_s=$((QUIET - (now - last)))
      [ "$wait_s" -gt 15 ] && wait_s=15
      [ "$wait_s" -lt 1 ] && wait_s=1
      sleep "$wait_s"
    fi
  done
  rmdir "$LOCK" 2>/dev/null || true
}

if mkdir "$LOCK" 2>/dev/null; then
  waiter </dev/null >/dev/null 2>>"$STATE/waiter.err" &
  disown 2>/dev/null || true
else
  # A waiter already holds the lock. Its heartbeat touches the lock every loop; a lock older than
  # the longest legitimate wait is a corpse — steal it so one crash cannot silence the debounce
  # until someone notices the dashboard aged.
  NOW="$(date +%s)"
  LOCK_TS="$(stat -f %m "$LOCK" 2>/dev/null || echo "$NOW")"
  if [ $((NOW - LOCK_TS)) -gt $((MAX_WAIT + QUIET + 120)) ]; then
    rmdir "$LOCK" 2>/dev/null || true
    if mkdir "$LOCK" 2>/dev/null; then
      waiter </dev/null >/dev/null 2>>"$STATE/waiter.err" &
      disown 2>/dev/null || true
    fi
  fi
fi
exit 0
