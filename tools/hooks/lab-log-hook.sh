#!/bin/bash
# =============================================================================
# gosleep — fail-open shim for the T1 event layer (GSL-83). The ONLY thing
# .claude/settings.json points at. Its whole job: the event layer can never block a session.
#
# WHY (learned the hard way, 2026-07-12): Claude Code reads a hook's exit code, and **exit 2 means
# BLOCK the tool call**. A bash SYNTAX ERROR also exits 2. So a half-written tools/lab/lab-log.sh —
# a file future agents will keep editing — blocks every Write/Edit/git commit across the LIVE fleet,
# and hooks reload from settings.json mid-session, so it hits instantly. It happened during this very
# task, mid-edit. lab-log.sh's internal fail-open cannot help: bash dies before python ever starts.
#
# Hence this shim: four lines, never edited, always `exit 0`. Breakage in lab-log.sh degrades the
# event log (and leaves stderr in .artifacts/lab/lab-log.err) instead of stopping delivery — the
# same rule the PRD sets for the chronicler (F4-S3): a broken laboratory must never wedge the work.
# =============================================================================
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
mkdir -p "$ROOT/.artifacts/lab" 2>/dev/null

# GSL-303: buffer stdin ONCE so both lab-log.sh (primary) and the pilot-gated Fleet feeder
# (secondary, background) can consume it. Under the pilot flag we fan the payload out;
# without it, we behave exactly as before (feeder script exits 0 in <1 ms via its own guard).
# The feeder is fired with `&` so a slow POST never adds latency to the hook return path —
# preserving the shim's "never blocks a session" invariant that this file exists to protect.
STDIN_BUF="$(cat)"
printf '%s' "$STDIN_BUF" | "$ROOT/tools/lab/lab-log.sh" 2>>"$ROOT/.artifacts/lab/lab-log.err"

if [ "${GOSLEEP_WEB_QUESTIONS:-0}" = "1" ]; then
  # Background invocation, output redirected → hook returns immediately regardless of core
  # reachability. The feeder itself is fail-open (see tools/hooks/tool-observed-feed.sh).
  printf '%s' "$STDIN_BUF" | \
    "$ROOT/tools/hooks/tool-observed-feed.sh" \
      >>"$ROOT/.artifacts/lab/tool-observed-feed.err" 2>&1 &
  disown 2>/dev/null || true
fi
exit 0
