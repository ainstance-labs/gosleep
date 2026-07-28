#!/bin/bash
# =============================================================================
# gosleep — fail-open shim for the chronicler debounce (GSL-198). Same doctrine as
# lab-log-hook.sh, same hard-won reason (2026-07-12): a bash SYNTAX ERROR exits 2, and in the
# hook protocol exit 2 means BLOCK THE TOOL CALL — settings.json reloads mid-session, so a
# half-edited engine script would freeze the LIVE fleet instantly. Hence: settings.json points
# ONLY at this shim; the shim is a few lines, never edited, always exit 0. Breakage in
# chronicler-debounce.sh degrades to a stale-but-honest dashboard (stderr lands in
# .artifacts/lab/chronicler-debounce.err) instead of stopping delivery.
# =============================================================================
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
mkdir -p "$ROOT/.artifacts/lab" 2>/dev/null
"$ROOT/tools/lab/chronicler-debounce.sh" 2>>"$ROOT/.artifacts/lab/chronicler-debounce.err"
exit 0
