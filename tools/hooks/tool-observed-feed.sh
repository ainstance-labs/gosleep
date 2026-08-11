#!/usr/bin/env bash
# =============================================================================
# gosleep — Fleet tool-observed feeder (GSL-303).
#
# One small POST to gosleep-core's `/internal/agents/tool-observed` per invocation. Kept in a
# SEPARATE file (not folded into `lab-log.sh`) so this network-touching path never sits inside
# the fail-open discipline the event-layer shim protects.
#
# CONTRACT
# --------
#   * Reads the hook payload on stdin (the same JSON Claude Code hands every PreToolUse /
#     PostToolUse hook). Extracts `session_id` + `tool_name`. Optional `intent` may be passed
#     via env `GOSLEEP_TOOL_OBSERVED_INTENT` (used by the AskUserQuestion / PermissionRequest
#     shims to tag the observation with human-readable context).
#   * POSTs `{ session_id, tool, intent? }` to `$GOSLEEP_CORE_URL/internal/agents/tool-observed`.
#     `context_pct` is intentionally OMITTED — Claude Code does not surface it in the hook
#     payload, and `fleet-poll.ts` already reads it from `claude agents --json` at 4 s cadence
#     (rev-3 addendum 8.1). The two paths merge on the same `agent_sessions` row.
#
# GUARDS (same discipline as ask-user-question-hook.sh):
#   * `GOSLEEP_WEB_QUESTIONS != 1` → exit 0 INSTANTLY. This is the pilot guard; a non-pilot
#     session sees a millisecond no-op. WIDENING is a separate owner-gated step
#     (d-2026-08-09-001).
#   * `GOSLEEP_INTERNAL_SECRET` unset OR empty → fail-open silently.
#   * `python3` / `curl` missing → fail-open.
#   * Any curl failure (connect refused, non-200) → fail-open + append one line to
#     `.artifacts/lab/tool-observed-feed.err` for post-mortem.
#
# NEVER exits with a non-zero code from ANY path. The lab-log-hook.sh trampoline that fires
# this in background also runs `wait`-less (`&`), so a slow POST cannot add latency to the
# hook return either.
#
# Env:
#   GOSLEEP_WEB_QUESTIONS        must be "1" — otherwise instant exit 0
#   GOSLEEP_INTERNAL_SECRET      shared secret with the running core
#   GOSLEEP_CORE_URL             default http://127.0.0.1:7331
#   GOSLEEP_TOOL_OBSERVED_INTENT optional single-line intent to tag the observation with
#   GOSLEEP_TOOL_OBSERVED_TOOL   optional override for tool name (used by the AskUserQuestion
#                                and PermissionRequest shims which have their own stdin
#                                payload that already gives them tool_name via the matcher)
#   GOSLEEP_HOOK_CONNECT_S       default 2 — hard cap on connect phase
# =============================================================================

set -u -o pipefail

if [ "${GOSLEEP_WEB_QUESTIONS:-0}" != "1" ]; then
  exit 0
fi

CORE_URL="${GOSLEEP_CORE_URL:-http://127.0.0.1:7331}"
INTERNAL_SECRET="${GOSLEEP_INTERNAL_SECRET:-}"
CONNECT_TIMEOUT_S="${GOSLEEP_HOOK_CONNECT_S:-2}"
INTENT="${GOSLEEP_TOOL_OBSERVED_INTENT:-}"
TOOL_OVERRIDE="${GOSLEEP_TOOL_OBSERVED_TOOL:-}"

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
ERR_LOG="$ROOT/.artifacts/lab/tool-observed-feed.err"
mkdir -p "$(dirname "$ERR_LOG")" 2>/dev/null || true

fail_open() {
  local reason="${1:-unspecified}"
  printf '{"ts":"%s","event":"tool-observed-feed.fail_open","reason":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)" "$reason" \
    >> "$ERR_LOG" 2>/dev/null || true
  exit 0
}

[ -z "$INTERNAL_SECRET" ] && fail_open "GOSLEEP_INTERNAL_SECRET unset"
command -v python3 >/dev/null 2>&1 || fail_open "python3 not on PATH"
command -v curl >/dev/null 2>&1 || fail_open "curl not on PATH"

STDIN_FILE="$(mktemp -t gosleep-tof-stdin.XXXXXX 2>/dev/null || echo "/tmp/gosleep-tof-stdin.$$")"
cat > "$STDIN_FILE" 2>/dev/null || true

# GSL-303 diagnostic: when GOSLEEP_TOOL_OBSERVED_DUMP is set to a path, copy the stdin
# payload there for one-time inspection. Never runs in production (env unset).
if [ -n "${GOSLEEP_TOOL_OBSERVED_DUMP:-}" ]; then
    cp "$STDIN_FILE" "${GOSLEEP_TOOL_OBSERVED_DUMP}.$(date +%s%N)" 2>/dev/null || true
fi

if [ ! -s "$STDIN_FILE" ] && [ -z "$TOOL_OVERRIDE" ]; then
  rm -f "$STDIN_FILE" 2>/dev/null || true
  fail_open "empty stdin and no tool override"
fi

# Build the POST body via python3 (no jq dep). Falls open on parse error.
#
# CONTEXT_PCT SOURCE. Claude Code does not emit `context_pct` in the hook payload today
# (confirmed empirically on 2.1.226 against Haiku 4.5 — the payload carries session_id,
# transcript_path, cwd, tool_name, tool_input, tool_response, duration_ms — nothing about
# tokens or context window). `claude agents --json` does not expose it either. Until
# Anthropic surfaces a first-class signal, we derive an APPROXIMATION from the transcript
# file size: bytes / (window_tokens * 4 bytes/token). Window defaults to 200_000
# (Haiku/Sonnet 4.5 base, before the 1M beta) — overridable via
# `GOSLEEP_CONTEXT_WINDOW_TOKENS`. Result clamped to [1, 100]; the Fleet card should read
# this as "roughly how full the window is" — not a byte-accurate meter, but real signal
# that moves as the session grows. Never blocks the POST if the transcript is
# unreadable — we simply omit context_pct in that case.
# Heredoc delimiter is QUOTED (`'PY'`) so bash performs no variable expansion or backtick
# execution inside the python body. Pre-GSL-332 this was unquoted (`<<PY`) — harmless while
# the comments only mentioned `intent` / `command` (single-word "commands" that either
# silently failed or, worse, hit the `command` builtin), but the moment a comment mentioned
# `gh pr create` bash tried to execute gh at every invocation of the hook (noisy stderr,
# still fail-open by construction but polluting logs). The python heredoc references NO shell
# variables — the STDIN filename is passed as `sys.argv[1]` — so quoting the delimiter is
# strictly safer and adds zero cost.
POST_BODY="$(python3 - "$STDIN_FILE" <<'PY' || true
import json, os, sys
try:
    raw = open(sys.argv[1]).read() if os.path.getsize(sys.argv[1]) > 0 else "{}"
    d = json.loads(raw) if raw.strip() else {}
except Exception:
    d = {}

session_id = d.get("session_id") or ""
tool_override = os.environ.get("GOSLEEP_TOOL_OBSERVED_TOOL", "")
tool = tool_override or d.get("tool_name") or ""
intent = os.environ.get("GOSLEEP_TOOL_OBSERVED_INTENT", "") or None

if not session_id or not tool:
    # Print nothing → caller falls open. session_id or tool empty is the routine "not a
    # PreToolUse/PostToolUse payload" case (e.g. SessionStart, TaskCreated).
    sys.exit(0)

body = {"session_id": session_id, "tool": tool}
if intent:
    body["intent"] = intent[:200]  # keep the intent short — Fleet card is one line.

# GSL-319 — attach short previews of the tool's stdin (command / arguments) and stdout so
# the core-side PR-URL extractor can spot `https://github.com/<org>/<repo>/pull/<n>` the
# moment `gh pr create` / `gh pr view` returns. Both fields are optional and independently
# capped at 600 chars — long payloads (a big diff, a full file body) never bloat the POST.
# The core scans command_preview + response_preview + intent for the PR URL pattern and
# UPSERTs it as `agent_sessions.last_pr_url`, which then flows through /fleet + /bundle
# and lands on Overview's "Latest PR" card.
#
# GSL-332 (run 09 finding #8): real `gh pr create` prints its status and URL block to
# STDERR (verified against the CC 2.1.226 PostToolUse payload; the URL landed on
# tool_response.stderr and stdout was empty). Pre-GSL-332 the loop only scanned
# stdout / output so the extractor never fired on a real agent action; the Latest-PR
# card only populated when the QA harness manually POSTed a synthetic payload with
# pr_url set. Fix: for the dict shape, take stdout AND stderr (each capped at ~300 chars
# so the concatenated total honors the server 600-char slice); the extractor scans the
# joined blob for the canonical GitHub PR URL, so whichever stream carried it wins.
try:
    tool_input = d.get("tool_input") or {}
    if isinstance(tool_input, dict):
        # Bash → {"command": "…", "description": "…"}. Others → serialise the whole blob.
        cmd = tool_input.get("command")
        if isinstance(cmd, str) and cmd:
            body["command_preview"] = cmd[:600]
        else:
            # Fallback: dump the tool_input JSON so an Edit/Write/mcp payload that mentions
            # a PR URL in a description still surfaces.
            body["command_preview"] = json.dumps(tool_input)[:600]
    tool_response = d.get("tool_response")
    if isinstance(tool_response, dict):
        # Collect every text stream the payload might carry. `stdout` + `stderr` are the
        # Bash tool contract; `output` is the text-tool contract (Edit / Write). We NEVER
        # skip a non-empty stream: `gh pr create` on 2.1.226 leaves stdout empty and
        # ships the pull-request URL on stderr, so a `break` after the first non-empty
        # stream would still lose it. All fields are truncated per-stream AND the
        # concatenated preview is capped at the same 600 chars the server slices.
        parts = []
        for key in ("stdout", "stderr", "output"):
            val = tool_response.get(key)
            if isinstance(val, str) and val:
                parts.append(val[:300])
        if parts:
            body["response_preview"] = ("\n".join(parts))[:600]
    elif isinstance(tool_response, str) and tool_response:
        body["response_preview"] = tool_response[:600]
except Exception:
    pass  # never fail-close on preview extraction; the PR URL is a nice-to-have.

# Approximate context_pct from transcript file size.
try:
    transcript_path = d.get("transcript_path") or ""
    if transcript_path and os.path.isfile(transcript_path):
        window_tokens = int(os.environ.get("GOSLEEP_CONTEXT_WINDOW_TOKENS", "200000"))
        bytes_per_token = 4  # rough English-heavy heuristic
        size = os.path.getsize(transcript_path)
        pct = int(round(size / (window_tokens * bytes_per_token) * 100))
        pct = max(1, min(100, pct))
        body["context_pct"] = pct
except Exception:
    pass  # context_pct is optional; a bad read is silent
json.dump(body, sys.stdout)
PY
)"
rm -f "$STDIN_FILE" 2>/dev/null || true

if [ -z "$POST_BODY" ]; then
  # No session_id / no tool → normal for non-tool events. Silent exit.
  exit 0
fi

HOST_HEADER="${CORE_URL#http://}"
HOST_HEADER="${HOST_HEADER#https://}"
HOST_HEADER="${HOST_HEADER%%/*}"
ORIGIN_HEADER="${CORE_URL%/}"

HTTP_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' \
  --connect-timeout "$CONNECT_TIMEOUT_S" --max-time "$((CONNECT_TIMEOUT_S + 3))" \
  -X POST \
  -H "Host: $HOST_HEADER" \
  -H "Origin: $ORIGIN_HEADER" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Secret: $INTERNAL_SECRET" \
  -d "$POST_BODY" \
  "$CORE_URL/internal/agents/tool-observed" 2>/dev/null || echo "000")"

if [ "$HTTP_STATUS" != "200" ]; then
  printf '{"ts":"%s","event":"tool-observed-feed.non_200","status":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)" "$HTTP_STATUS" \
    >> "$ERR_LOG" 2>/dev/null || true
fi

exit 0
