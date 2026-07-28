#!/usr/bin/env bash
# =============================================================================
# gosleep lab — heartbeat.sh: the orchestrator's heartbeat writer (GSL-212, epic GSL-178).
#
# WHY A WRITER EXISTS. Until GSL-212 the orchestrator composed the heartbeat JSON by hand
# (inline snippet in the skill). The audit (F2, finding 32) showed where that ends: the
# watchdog's idea of "which session is the orchestrator" lived in a config default that was
# never checked against reality, and arming it would have raised a SECOND orchestrator beside
# the live one. The cure is constructive, not procedural: the heartbeat line itself carries
# the session identity, and this writer DERIVES it from the platform roster
# (`claude agents --json`) — the orchestrator cannot mistype what it never types.
#
# THE SCHEMA (tools-side source of truth; the skill's "Heartbeat protocol" section mirrors it —
# deltas to the GLOBAL skill copy travel by errata, never by agent sync — q-2026-07-28-007):
#   {"ts":"2026-07-28T15:13:02Z","cycle":149,"context_pct":97,"open_workers":1,"status":"ok",
#    "pane":"%10","session":"gosleep-21","session_id":"a716426f-…","note":"…"}
#
#   ts           UTC ISO-8601 — stamped by this writer.
#   cycle        current orchestration cycle N (caller supplies).
#   context_pct  HONEST share of the context window CONSUMED so far, 0-100 — "how much is
#                spent", never "how much remains" (GSL-217 fixes this phrase everywhere).
#                It freezes when work freezes — exactly what makes the frozen-cycle
#                detector (GSL-213) possible.
#   open_workers count of live workers (caller supplies).
#   status       ok | rolling | quiesced — same semantics as the skill contract.
#   mode         day | night (optional; omitted = day).
#   pane         $TMUX_PANE — the ACTION address: the pane an ARMED watchdog may nudge/kill.
#                Identity for actions, not for liveness.
#   session      the Claude Code session NAME as `claude agents --json` reports it — the
#                LIFE identity (GSL-212; d-2026-07-28-001: the platform roster is the source
#                of life, not tmux scraping). Derived here by matching this process's own
#                $CLAUDE_CODE_SESSION_ID against the roster.
#   session_id   the sessionId UUID of the same roster entry (the exact match key; the name
#                is for humans, the UUID is for machines).
#   note         free text ≤ 80 chars (longer input is truncated with a stderr warning).
#
# Usage:
#   tools/lab/heartbeat.sh --cycle 149 --context-pct 97 --open-workers 1 \
#       [--status ok|rolling|quiesced] [--mode day|night] [--note "..."]
#
# Env:
#   GOSLEEP_HB_FILE       heartbeat path (default <repo>/docs/handoff/.orchestrator-heartbeat)
#   GOSLEEP_AGENTS_JSON   test fixture: read the roster from this FILE instead of invoking
#                         `claude agents --json` (smoke uses it; "-" = empty roster)
#   GOSLEEP_CLAUDE_BIN    claude binary (default: claude)
#   CLAUDE_CODE_SESSION_ID  set by the harness inside every Bash tool call — this writer's
#                         own identity. Child sessions (CLAUDE_CODE_CHILD_SESSION=1) are not
#                         in the roster; the writer then falls back to "exactly one roster
#                         entry whose cwd is this repo", and if that is ambiguous it omits
#                         the session fields and says so on stderr (honest, never guessed).
#
# Atomic + self-truncating: same-directory temp + rename, tail -n 199 (the skill contract —
# a crash mid-write can never leave a truncated file; the file caps at 200 lines forever).
# 0 LLM calls: `claude agents --json` is a local roster read, not a model call.
# python3 stdlib only. macOS bash 3.2 safe.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
HB_FILE="${GOSLEEP_HB_FILE:-$ROOT/docs/handoff/.orchestrator-heartbeat}"
CLAUDE_BIN="${GOSLEEP_CLAUDE_BIN:-claude}"

CYCLE="" CTX="" WORKERS="" STATUS="ok" MODE="" NOTE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --cycle)        CYCLE="${2:-}"; shift 2 ;;
    --context-pct)  CTX="${2:-}"; shift 2 ;;
    --open-workers) WORKERS="${2:-}"; shift 2 ;;
    --status)       STATUS="${2:-}"; shift 2 ;;
    --mode)         MODE="${2:-}"; shift 2 ;;
    --note)         NOTE="${2:-}"; shift 2 ;;
    --help|-h) sed -n '2,60p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "heartbeat: unknown argument: $1" >&2; exit 2 ;;
  esac
done

is_uint() { [[ "${1:-}" =~ ^[0-9]+$ ]]; }
is_uint "$CYCLE"   || { echo "heartbeat: --cycle must be a non-negative integer" >&2; exit 2; }
is_uint "$CTX"     || { echo "heartbeat: --context-pct must be a non-negative integer" >&2; exit 2; }
[ "$CTX" -le 100 ] || { echo "heartbeat: --context-pct must be <= 100" >&2; exit 2; }
is_uint "$WORKERS" || { echo "heartbeat: --open-workers must be a non-negative integer" >&2; exit 2; }
case "$STATUS" in ok|rolling|quiesced) : ;; *) echo "heartbeat: --status must be ok|rolling|quiesced" >&2; exit 2 ;; esac
case "$MODE" in ""|day|night) : ;; *) echo "heartbeat: --mode must be day|night" >&2; exit 2 ;; esac

# Roster: fixture file (tests) or the live platform read. Degraded roster (CLI missing,
# non-JSON output) is NOT fatal — the line is still written, without session fields, and
# the degradation is said out loud. A heartbeat that refuses to beat is worse than one
# that admits it could not resolve its name.
ROSTER_JSON=""
if [ -n "${GOSLEEP_AGENTS_JSON:-}" ]; then
  if [ "$GOSLEEP_AGENTS_JSON" = "-" ]; then
    ROSTER_JSON="[]"
  else
    ROSTER_JSON="$(cat "$GOSLEEP_AGENTS_JSON" 2>/dev/null || echo '')"
  fi
else
  ROSTER_JSON="$("$CLAUDE_BIN" agents --json 2>/dev/null || echo '')"
fi

mkdir -p "$(dirname "$HB_FILE")"

HB_ROOT="$ROOT" HB_PATH="$HB_FILE" HB_CYCLE="$CYCLE" HB_CTX="$CTX" HB_WORKERS="$WORKERS" \
HB_STATUS="$STATUS" HB_MODE="$MODE" HB_NOTE="$NOTE" HB_PANE="${TMUX_PANE:-}" \
HB_ROSTER="$ROSTER_JSON" HB_SID="${CLAUDE_CODE_SESSION_ID:-}" \
python3 - <<'PY'
import json, os, sys, time

root    = os.environ["HB_ROOT"]
path    = os.environ["HB_PATH"]
note    = os.environ.get("HB_NOTE", "")
if len(note) > 80:
    sys.stderr.write("heartbeat: note truncated to 80 chars (schema cap)\n")
    note = note[:80]

# --- resolve the session identity from the platform roster (GSL-212) ---------
session = session_id = None
roster_raw = os.environ.get("HB_ROSTER", "")
rows = None
if roster_raw.strip():
    try:
        rows = json.loads(roster_raw)
        assert isinstance(rows, list)
    except Exception:
        rows = None
if rows is None:
    sys.stderr.write("heartbeat: platform roster unavailable (claude agents --json) — "
                     "session fields omitted\n")
else:
    sid = os.environ.get("HB_SID", "")
    hit = None
    if sid:
        hit = next((r for r in rows if r.get("sessionId") == sid), None)
    if hit is None:
        cands = [r for r in rows if r.get("cwd") == root]
        if len(cands) == 1:
            hit = cands[0]
        elif sid or cands:
            sys.stderr.write("heartbeat: cannot resolve own session unambiguously "
                             "(%d candidate(s) in this repo) — session fields omitted\n"
                             % len(cands))
    if hit is not None:
        session, session_id = hit.get("name"), hit.get("sessionId")

# --- compose the line (key order = the documented schema order) ---------------
line = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "cycle": int(os.environ["HB_CYCLE"]),
        "context_pct": int(os.environ["HB_CTX"]),
        "open_workers": int(os.environ["HB_WORKERS"]),
        "status": os.environ["HB_STATUS"]}
if os.environ.get("HB_MODE"):
    line["mode"] = os.environ["HB_MODE"]
line["pane"] = os.environ.get("HB_PANE", "")
if session is not None:
    line["session"] = session
if session_id is not None:
    line["session_id"] = session_id
if note:
    line["note"] = note
out = json.dumps(line, ensure_ascii=False, separators=(",", ":"))

# --- atomic self-truncating append (same-dir temp + rename, tail -n 199) ------
tail = []
try:
    with open(path, encoding="utf-8", errors="replace") as f:
        tail = [l.rstrip("\n") for l in f if l.strip()][-199:]
except FileNotFoundError:
    pass
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    for l in tail:
        f.write(l + "\n")
    f.write(out + "\n")
os.replace(tmp, path)
print(out)
PY
