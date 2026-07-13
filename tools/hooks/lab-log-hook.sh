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
"$ROOT/tools/lab/lab-log.sh" 2>>"$ROOT/.artifacts/lab/lab-log.err"
exit 0
