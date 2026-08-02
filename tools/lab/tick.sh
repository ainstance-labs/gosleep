#!/usr/bin/env bash
# =============================================================================
# gosleep lab — tick: the idempotent safety tick (GSL-199; audit findings 11, 89, both MAJOR).
#
# THE INSURANCE, NOT THE ENGINE-OF-FIRST-RESORT. During a live session the debounce hook
# (GSL-198) keeps the derived surfaces fresh within seconds of every docs/lab/ write. The tick
# exists for every OTHER hour: no agents alive, the machine awake at 03:00, a DECISION deadline
# passing with nobody watching. One run makes the system do everything it is obliged to do
# regularly, and proves it did so with exactly one ledger line.
#
# STEPS (each degraded-never-fatal, in dependency order):
#   1. poll-fill            — reconcile external truth (git / gh / Jira dump) into the timeline
#   2. lab-emit apply-due   — apply the default of every open DECISION whose deadline passed
#   3. chronicler           — rebuild the derived surfaces, but ONLY if the debounce has not
#                             already kept them fresh (bundle age <= GOSLEEP_TICK_FRESH) and
#                             apply-due applied nothing; --force overrides. Runs with --no-poll
#                             BY COMPOSITION: step 1 just polled — polling twice per tick is the
#                             only thing that flag legitimately prevents here (GSL-203 removes it
#                             from the standalone shift gate, where there is no step 1 before it).
#   4. armed-check          — if tools/lab/armed-check.sh exists (GSL-211, watchdog epic), run it
#                             and record its verdict; absent today, and the ledger SAYS "absent"
#                             rather than pretending the check passed (R2: no armedness theatre).
#   4b. watchdog observe    — one supervisor tick in FORCED observe mode (GSL-220, q-2026-07-28-006):
#                             the tick engine IS the observational run's carrier — the ledger the
#                             owner reads before arming starts accumulating with the first tick of
#                             ANY carrier, no launchctl needed. WD_MODE=observe is forced here BY
#                             DESIGN: the tick carrier observes, only the watchdog's own plist
#                             (owner-installed) may ever act. Degraded-never-fatal.
#   5. one ledger line      — docs/lab/supervision/tick-ledger.jsonl (tracked, same doctrine as
#                             events/: append-only, one writer discipline, survives in git).
#
# IDEMPOTENT BY CONSTRUCTION (the acceptance criterion): every step is itself idempotent
# (poll-fill dedups on external identity, apply-due closes what it applies, the chronicler
# regenerates byte-stable artifacts), so two runs back-to-back change nothing beyond the second
# run's own ledger line. Exit is non-zero ONLY on a real internal error — a degraded source
# (gh offline, no Jira feed) is DATA in the report, not a failure of the tick.
#
# ONE TICK AT A TIME: an mkdir lock with heartbeat; a second tick landing while one runs writes
# a result="skipped-lock-held" ledger line and exits 0 (the running tick will do the work).
# A lock silent for >30 min is a corpse and is stolen.
#
# Usage:
#   tools/lab/tick.sh                       # the full tick
#   tools/lab/tick.sh --carrier launchd     # same, stamping WHO fired it into the ledger
#   tools/lab/tick.sh --force               # rebuild surfaces even if fresh
#   tools/lab/tick.sh --quiet               # errors only on stderr; the ledger still gets its line
#   tools/lab/tick.sh --repo PATH           # tick a different checkout (smoke ticks fixtures;
#                                           # lab dir, bundle, ledger, lock all follow the repo)
#
# Env:
#   GOSLEEP_TICK_CARRIER     default carrier stamp when --carrier is not given (default "manual";
#                            the launchd plist sets "launchd", the Desktop task says "desktop")
#   GOSLEEP_TICK_FRESH       bundle age (seconds) considered fresh enough to skip the rebuild
#                            (default 240 — deliberately UNDER the 300 s carrier interval, so a
#                            quiet night still rebuilds every tick and generated_at can never age
#                            past one interval, which is the epic's done-criterion)
#   GOSLEEP_TICK_LEDGER      ledger path (default docs/lab/supervision/tick-ledger.jsonl)
#   GOSLEEP_LAB_DIR          honoured transitively by lab-emit/lab-log (smoke uses it)
#
# 0 LLM calls (C1): no headless narrator anywhere on this path (the C1 grep in smoke proves it) —
# a tick spends no tokens and opens no quota window, whoever fires it and however often.
# python3 stdlib only. macOS bash 3.2 safe.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FRESH="${GOSLEEP_TICK_FRESH:-240}"
CARRIER="${GOSLEEP_TICK_CARRIER:-manual}"
FORCE=0
QUIET=0
REPO="$ROOT"

while [ $# -gt 0 ]; do
  case "$1" in
    --carrier) CARRIER="${2:-manual}"; shift 2 ;;
    --repo)    REPO="${2:-$ROOT}"; shift 2 ;;
    --force)   FORCE=1; shift ;;
    --quiet)   QUIET=1; shift ;;
    *) echo "tick: unknown flag $1" >&2; exit 2 ;;
  esac
done

# Everything follows the repo being ticked: the lab dir (lab-emit/lab-log honour the env), the
# bundle whose age gates the rebuild, the ledger, and the lock (two ticks on two fixtures must
# never contend). Explicit env still wins — smoke pins single pieces when it wants to.
export GOSLEEP_LAB_DIR="${GOSLEEP_LAB_DIR:-$REPO/docs/lab}"
LEDGER="${GOSLEEP_TICK_LEDGER:-$GOSLEEP_LAB_DIR/supervision/tick-ledger.jsonl}"
BUNDLE="${GOSLEEP_TICK_BUNDLE:-$GOSLEEP_LAB_DIR/render_bundle.json}"
LOCK="$REPO/.artifacts/lab/tick.lock"

say() { [ "$QUIET" = "1" ] || echo "tick: $*"; }

T0="$(date +%s)"

ledger_line() {  # ledger_line <result> <poll_rc> <applied> <chronicler> <chronicler_rc> <armed>
  mkdir -p "$(dirname "$LEDGER")" 2>/dev/null || return 0
  printf '{"ts":"%s","mode":"tick","carrier":"%s","result":"%s","poll_rc":%s,"applied":%s,"chronicler":"%s","chronicler_rc":%s,"armed_check":"%s","duration_s":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$CARRIER" "$1" "$2" "$3" "$4" "$5" "$6" \
    "$(( $(date +%s) - T0 ))" >> "$LEDGER" 2>/dev/null || true
}

bundle_age() {
  # Seconds since the bundle's generated_at; a missing/unreadable bundle reads as infinitely old.
  python3 - "$BUNDLE" <<'PY' 2>/dev/null || echo 999999
import json, sys, time
from datetime import datetime, timezone
try:
    g = json.load(open(sys.argv[1]))["generated_at"]
    t = datetime.strptime(g, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    print(max(0, int(time.time() - t.timestamp())))
except Exception:
    print(999999)
PY
}

# ── one tick at a time ───────────────────────────────────────────────────────
mkdir -p "$(dirname "$LOCK")" 2>/dev/null
if ! mkdir "$LOCK" 2>/dev/null; then
  NOW="$(date +%s)"
  LOCK_TS="$(stat -f %m "$LOCK" 2>/dev/null || echo "$NOW")"
  if [ $((NOW - LOCK_TS)) -gt 1800 ]; then
    say "stealing a lock silent for $((NOW - LOCK_TS))s (a crashed tick)"
    rmdir "$LOCK" 2>/dev/null || true
  fi
  if ! mkdir "$LOCK" 2>/dev/null; then
    say "another tick is running — skipping (it will do the work)"
    ledger_line "skipped-lock-held" null null "skipped" null "skipped"
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

# ── 0. don't wake anything if there is no work (GSL-202; borrowed from 5dive) ─
# Finding 89 (MAJOR): a scheduler that unconditionally spins up work opens quota windows and burns
# tokens on nights when nothing changed. This tick spends 0 tokens by construction, but the idle
# gate makes the no-work case COST ZERO BEYOND ITS OWN LEDGER LINE: no network poll, no rebuild,
# no agent session — the ledger records result="idle" so the quiet run is visible, not invisible.
# "No work" is a conjunction the rest of this script enforces piecewise: the surfaces are fresh
# (the debounce or a recent tick rebuilt within GOSLEEP_TICK_FRESH) AND no open DECISION deadline
# has passed. A fresh bundle implies a recent poll (every rebuild path polls first), so skipping
# the reconcile here forgets nothing. --force overrides, for the owner's "run it NOW".
if [ "$FORCE" != "1" ]; then
  AGE0="$(bundle_age)"
  if [ "$AGE0" -le "$FRESH" ]; then
    DUE_OPEN="$(bash "$SCRIPT_DIR/lab-emit.sh" list --due 2>/dev/null | head -1)"
    if [ -z "$DUE_OPEN" ]; then
      say "idle: bundle ${AGE0}s fresh, no deadline due — nothing woken, nothing spent"
      ledger_line "idle" null 0 "skipped-fresh" null "skipped"
      exit 0
    fi
  fi
fi

# ── 1. poll-fill: reconcile-don't-trust ──────────────────────────────────────
say "poll-fill (reconcile external truth)"
bash "$SCRIPT_DIR/poll-fill.sh" --repo "$REPO" >/dev/null 2>&1
POLL_RC=$?
[ "$POLL_RC" -eq 0 ] || say "poll-fill exited $POLL_RC (a real error, not a degraded source)"

# ── 2. apply-due: the deadlines nobody attended ──────────────────────────────
say "apply-due (expired DECISION defaults)"
AD_OUT="$(bash "$SCRIPT_DIR/lab-emit.sh" apply-due 2>&1)"
AD_RC=$?
APPLIED="$(printf '%s\n' "$AD_OUT" | sed -n 's/^applied=\([0-9][0-9]*\)$/\1/p' | tail -1)"
[ -n "$APPLIED" ] || APPLIED=0
if [ "$AD_RC" -ne 0 ]; then
  say "apply-due failed: $AD_OUT"
  ledger_line "error:apply-due" "$POLL_RC" "$APPLIED" "skipped" null "skipped"
  exit 1
fi
[ "$APPLIED" -gt 0 ] && say "applied $APPLIED overdue default(s)"

# ── 3. chronicler: only if the debounce has not already kept us fresh ────────
AGE="$(bundle_age)"
CH_RC=null
if [ "$FORCE" = "1" ] || [ "$APPLIED" -gt 0 ] || [ "$AGE" -gt "$FRESH" ]; then
  say "chronicler (bundle age ${AGE}s > ${FRESH}s fresh window, or work was done)"
  bash "$SCRIPT_DIR/chronicler.sh" --repo "$REPO" --no-poll --quiet >/dev/null 2>&1
  CH_RC=$?
  CH="ran"
  if [ "$CH_RC" -ne 0 ]; then
    say "chronicler exited $CH_RC"
    ledger_line "error:chronicler" "$POLL_RC" "$APPLIED" "$CH" "$CH_RC" "skipped"
    exit 1
  fi
else
  CH="skipped-fresh"
  say "chronicler skipped — bundle is ${AGE}s old (fresh window ${FRESH}s; the debounce did its job)"
fi

# ── 4. armed-check: report armedness, never fake it ──────────────────────────
# GSL-211 shipped it. Everything it reads and writes follows the repo being
# ticked (fixture ticks must never grade — or overwrite the receipt of — the
# real machine); explicit env still wins, same rule as the lab dir above.
if [ -x "$SCRIPT_DIR/armed-check.sh" ]; then
  GOSLEEP_HB_FILE="${GOSLEEP_HB_FILE:-$REPO/docs/handoff/.orchestrator-heartbeat}" \
  GOSLEEP_WD_LEDGER="${GOSLEEP_WD_LEDGER:-$REPO/docs/handoff/.watchdog-ledger.jsonl}" \
  GOSLEEP_GATES_DIR="${GOSLEEP_GATES_DIR:-$REPO/.artifacts/lab/gates}" \
  WD_CONFIG="${WD_CONFIG:-$REPO/tools/watchdog/watchdog.conf}" \
    bash "$SCRIPT_DIR/armed-check.sh" >/dev/null 2>&1
  ARMED="rc=$?"
else
  ARMED="absent"   # the ledger tells the truth if it ever goes missing again
fi

# ── 4b. watchdog observe tick (GSL-220): the observational run rides the tick ─
# Forced observe REGARDLESS of the owner's conf: this carrier only ever records
# what the supervisor WOULD do (would_nudge/would_kill/would_rewake + a tick
# line with the decision and its basis, per docs/handoff/.watchdog-ledger.jsonl
# -> archived to docs/lab/supervision/ by the chronicler). Acting is reserved
# for the watchdog's own launchd plist, which the OWNER installs after reading
# this very ledger. Degraded-never-fatal: a broken supervisor must not break
# the tick.
if [ -x "$REPO/tools/watchdog/watchdog.sh" ]; then
  WD_MODE=observe WD_REPO_ROOT="$REPO" \
    bash "$REPO/tools/watchdog/watchdog.sh" >/dev/null 2>&1 || true
fi

# ── 5. the one ledger line ───────────────────────────────────────────────────
RESULT="ok"
[ "$POLL_RC" -ne 0 ] && RESULT="error:poll-fill"
ledger_line "$RESULT" "$POLL_RC" "$APPLIED" "$CH" "$CH_RC" "$ARMED"
say "done: result=$RESULT poll_rc=$POLL_RC applied=$APPLIED chronicler=$CH armed_check=$ARMED"
[ "$RESULT" = "ok" ] || exit 1
exit 0
