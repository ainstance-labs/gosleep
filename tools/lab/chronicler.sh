#!/usr/bin/env bash
# =============================================================================
# gosleep lab — chronicler: the T3 regenerator.
# (GSL-86; PRD Phase 4 R4.4 / F4-S2 / F4-S3 / F4-S4; C1, C3, C5, C6-cheap, C8.)
#
# Reads the machine-first tiers and REGENERATES every derived surface:
#
#   docs/lab/events/*.jsonl    (T1 — hooks, 0 tokens)   -.
#   docs/lab/questions/*.jsonl (queue, folded by lab-emit) |->  docs/lab/status.json  (machine)
#   docs/lab/decisions/log.jsonl                           |    docs/lab/site/*.html  (owner, file://)
#   git / gh / heartbeat / ORCHESTRATION-STATE            -'    docs/lab/digest/*.md  (owner, phone)
#
# THREE THINGS THIS IS NOT:
#
#   1. NOT a live pane agent (C5). A bounded job: no pane, no spawn slot, no seat in the fleet of
#      three. The invariant is grep-checkable, and smoke.sh checks it:
#          grep -Ei 'tmux|spawn|Agent tool' tools/lab/chronicler.py   ->   no hits.
#      It runs at a cycle boundary / debounced / on demand, and it exits.
#   2. NOT LLM-driven (C3 + F4-S3). Every artifact -- status.json, the whole dashboard, all seven
#      digest sections -- is built by deterministic code from files on disk. `claude -p` is OPTIONAL
#      glue (--narrate) that adds ONE prose paragraph under --max-budget-usd with an EMPTY
#      --allowedTools. Missing, over budget, or killed: the artifacts are still complete and the page
#      says the narrator was unavailable. A dashboard that exists only when an LLM cooperates fails
#      F4-S3 on its first bad night.
#   3. NOT a writer of events. It reads the timeline and never appends to it (no recursion; the log
#      records what the fleet did, not what the chronicler thought about it). The one exception is
#      delegated: the poll-fill pass (GSL-87), whose lines are provenance-tagged src="poll-fill".
#
# STALENESS IS THE PRODUCT (F4-S3). Every page carries generated_at + max event age and grades itself
# fresh / stale / dead. If the chronicler dies, delivery does not stop -- the pages simply age, and
# they SAY so. A hub that hides its own rot is the tasty-lunch wiki (blueprint 05 section 1.4-1).
#
# WHY THE PYTHON LIVES IN chronicler.py AND NOT IN A HEREDOC HERE (do not "tidy" this away):
#   macOS ships bash 3.2, whose parser for $( ... ) is NOT heredoc-aware: it counts backticks and
#   quotes INSIDE a quoted heredoc. An odd number of backticks in the embedded program -- e.g. one
#   more `word` in a docstring -- makes bash hunt for a closing backtick to EOF and die with
#   "unexpected EOF while looking for matching '`'". It bit this very script at 33 backticks.
#   A syntax error in a hook script means exit 2, and exit 2 in the hook protocol means BLOCK THE
#   OPERATION -- that is how a broken lab script froze every Write/Edit in a live session (GSL-83).
#   So: no embedded program, no counting game. The wrapper stays trivially correct.
#
# Usage:
#   tools/lab/chronicler.sh                     # regenerate everything for today (UTC)
#   tools/lab/chronicler.sh --date 2026-07-12   # ...for a given day (the digest is per-day)
#   tools/lab/chronicler.sh --narrate           # ...+ the bounded claude -p prose paragraph
#   tools/lab/chronicler.sh --dry-run --json    # ...plan only: write nothing, print the report
#
# Flags:
#   --repo PATH            repo root (default: this script's ../..)
#   --date YYYY-MM-DD      target day for digest/timeline (default: today, UTC)
#   --narrate|--no-narrate bounded claude -p prose in the digest (default: off -- opt-in)
#   --max-budget-usd N     hard cap for the narrator      (default: 0.25)
#   --model M              narrator model, cheap tier     (default: claude-haiku-4-5-20251001)
#   --prune|--no-prune     apply events retention         (default: prune, 30d per docs/lab/README.md)
#   --retention-days N     override the 30-day window
#   --compact-queue        also rewrite queue.jsonl without archived records (default: archive only)
#   --no-poll              skip the poll-fill reconcile pass (GSL-87)
#   --dry-run              compute everything, write nothing
#   --json                 print the run report as JSON
#   --quiet                errors only
#   --mode NAME            provenance stamp for the run ledger (default: shell). Reserved values:
#                          "shell" (a human ran it), "debounce" (post-emit debounce waiter), "tick"
#                          (called from tick.sh), "web" (spawned from gosleep-core /actions/*). The
#                          value lands in .artifacts/lab/chronicler-ledger.jsonl as {"mode":"…"} so
#                          the debounce waiter, tick, and web writer never draw a double ledger.
#
# TOP-LEVEL LOCK (GSL-259). Two parallel chronicler runs used to race — the second one clobbered
# the first's bundle after the first finished writing, and a "publish"-triggered web run could roll
# the state BACK to whatever the debounce waiter had already rebuilt seconds earlier (redteam-
# verdict.md critical #2). We now hold a mkdir-based lock in .artifacts/lab/chronicler.lock around
# the whole python3 invocation:
#   1. The FIRST caller creates the lock dir and runs to completion.
#   2. A SECOND caller arriving while the lock is held POLLS every 1 s for up to 15 s
#      (GOSLEEP_CHRONICLER_LOCK_WAIT_S).
#   3. If the lock releases within the window -> the second caller acquires it and runs its own
#      pass (the ledger records mode + rc + waited_s so the receipt is honest).
#   4. If the window elapses -> the second caller STAMPS its intent in the ledger with
#      result="skipped-lock-held" and exits 0. The running pass finishes the work.
#   5. A lock older than GOSLEEP_CHRONICLER_LOCK_STALE_S (default 900 = 15 min; a healthy run
#      finishes in seconds) is treated as a corpse and stolen. Modelled on tick.sh:117-131.
# The lock covers only the python3 process; a --dry-run --json call still takes the lock so a real
# regen cannot race a plan.
#
# Exit: 0 even when a source is unavailable (gh offline, no claude, no heartbeat) -- degraded, never
# fatal, and every degradation is DATA: it lands in status.json, on the page, and in the digest.
# Non-zero only on a genuine internal error -- and even then the OLD artifacts survive intact, because
# lab-write.sh is atomic: a reader sees the entire old file or the entire new one, never a prefix.
#
# 0 API keys (C1 -- grep confirms: none here; claude -p rides the subscription). python3 stdlib only.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT_DEFAULT="$(cd "$SCRIPT_DIR/../.." && pwd)"
export CHRONICLER_REPO_DEFAULT="$REPO_ROOT_DEFAULT"

# ── shell-only flag parse: strip --mode <name> before handing --... to python ──
# python's chronicler.py does not know --mode; we filter it out here. Every OTHER flag is passed
# through unchanged so the python parser owns validation for its own surface.
MODE="shell"
PY_ARGS=()
REPO_FLAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --mode)
      shift
      MODE="${1:-shell}"
      ;;
    --mode=*)
      MODE="${1#--mode=}"
      ;;
    --repo)
      REPO_FLAG="${2:-}"
      PY_ARGS+=("$1" "${2:-}")
      shift
      ;;
    --repo=*)
      REPO_FLAG="${1#--repo=}"
      PY_ARGS+=("$1")
      ;;
    *)
      PY_ARGS+=("$1")
      ;;
  esac
  shift || true
done

REPO_ROOT="${REPO_FLAG:-$REPO_ROOT_DEFAULT}"

# ── top-level lock: one chronicler at a time (GSL-259) ─────────────────────────
LOCK="$REPO_ROOT/.artifacts/lab/chronicler.lock"
LEDGER="$REPO_ROOT/.artifacts/lab/chronicler-ledger.jsonl"
LOCK_WAIT_S="${GOSLEEP_CHRONICLER_LOCK_WAIT_S:-15}"
LOCK_STALE_S="${GOSLEEP_CHRONICLER_LOCK_STALE_S:-900}"

mkdir -p "$(dirname "$LOCK")" 2>/dev/null || true

ledger_line() {  # ledger_line <result> <rc> <waited_s>
  # No-op if the ledger dir is not writable; a broken telemetry sink must never break the wrapper.
  mkdir -p "$(dirname "$LEDGER")" 2>/dev/null || return 0
  printf '{"ts":"%s","mode":"%s","result":"%s","rc":%s,"waited_s":%s,"pid":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$MODE" "$1" "$2" "$3" "$$" \
    >> "$LEDGER" 2>/dev/null || true
}

acquire_lock() {
  # Try up to LOCK_WAIT_S seconds. Return 0 on acquired, 1 on giving up.
  local waited=0
  while ! mkdir "$LOCK" 2>/dev/null; do
    local now lock_ts
    now="$(date +%s)"
    lock_ts="$(stat -f %m "$LOCK" 2>/dev/null || echo "$now")"
    if [ $((now - lock_ts)) -gt "$LOCK_STALE_S" ]; then
      # A pass that has been holding for >stale-s is a corpse: steal.
      rmdir "$LOCK" 2>/dev/null || true
      continue
    fi
    if [ "$waited" -ge "$LOCK_WAIT_S" ]; then
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "$waited"
  return 0
}

T0="$(date +%s)"
WAITED="$(acquire_lock)" || {
  # Give-up path: another run is doing the work; stamp intent and exit clean.
  ledger_line "skipped-lock-held" null "$LOCK_WAIT_S"
  exit 0
}
: "${WAITED:=0}"
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT INT TERM

python3 "$SCRIPT_DIR/chronicler.py" "${PY_ARGS[@]}"
RC=$?

ledger_line "ran" "$RC" "$WAITED"
exit "$RC"
