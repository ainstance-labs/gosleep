#!/usr/bin/env bash
# =============================================================================
# @gosleep/core — TTY-confirm fallback gate (GSL-264, target-architecture §7.3 Priority 1).
#
# WHAT THIS IS. The section-7.3 fallback for high-blast writes on hosts without a Touch ID
# sensor (MacBook Air with no biometrics; the SSH corner). Prints a one-line prompt to the
# OWNER'S `/dev/tty` (not stdin — stdin belongs to whoever spawned us, and an agent's stdin
# is a pipe from Claude Code we must not read), then waits for `y` or `N` with a timeout.
#
# WHY /dev/tty (NOT stdin). An agent running under Claude Code inherits stdin from Claude; if
# we read from stdin the agent's shell noise satisfies the prompt. `/dev/tty` addresses the
# owner's controlling terminal directly — an agent in a pipe context does NOT have a
# `/dev/tty` and this script exits 2 (no-TTY), which is the semantic the caller uses to
# decide "no fallback path available, refuse the write".
#
# CONTRACT WITH THE CALLER.
#   0 — owner typed 'y' (case-insensitive).
#   1 — owner typed 'n' / anything else / hit Enter with no input.
#   2 — no /dev/tty available (agent-in-pipe context; the fallback cannot run here).
#   3 — read timed out before the owner replied.
#
# WHERE THE PROMPT COMES FROM. `$1` is the action name; it is embedded verbatim into the
# prompt line so social-engineering ("owner approves the wrong thing") is mitigated per
# target-architecture §7.5. Callers MUST pass a specific action name — no default is provided
# so a missing argument surfaces as a `usage` error.
#
# TIMEOUT. `$2` (seconds; default 30) caps the wait. Bash `read -t` implements the timeout at
# the shell layer; on timeout `read` exits non-zero and we return 3.
#
# Usage:
#   tty-confirm.sh "Publish skill using-jira" 30
# =============================================================================
set -uo pipefail

ACTION="${1:-}"
TIMEOUT="${2:-30}"

if [ -z "$ACTION" ]; then
  echo "tty-confirm: usage: $0 <action-name> [timeout-seconds]" >&2
  exit 2
fi

# `/dev/tty` exists as a character device even for pipe-context children — the file test alone
# is not enough. The true test is: can we open it? A process with no controlling terminal gets
# ENXIO ("Device not configured") on the actual open. Do a `: < /dev/tty` probe and if that
# fails the pipe-context branch fires — exit 2 signals the caller to refuse the write.
if ! (: < /dev/tty) 2>/dev/null; then
  echo "tty-confirm: no controlling /dev/tty (agent-in-pipe context) — falling back cannot run" >&2
  exit 2
fi
if ! (: > /dev/tty) 2>/dev/null; then
  echo "tty-confirm: /dev/tty is not writable — refusing to run" >&2
  exit 2
fi

# Print the prompt to /dev/tty (visible to the owner regardless of caller's stdout/stderr
# redirects).
{
  echo ""
  echo "gosleep-core: high-blast confirmation required"
  echo "  action:  $ACTION"
  echo "  reply:   y  = approve       (any other key or Enter = deny)"
  echo "  timeout: ${TIMEOUT}s"
  printf '  > '
} > /dev/tty 2>&1

# Read one line from /dev/tty. `read -t <n>` implements the timeout; on timeout `read` returns
# non-zero — we distinguish that from a normal deny below by inspecting the return code path.
reply=""
if IFS= read -r -t "$TIMEOUT" reply < /dev/tty; then
  case "$(printf '%s' "$reply" | tr '[:upper:]' '[:lower:]')" in
    y|yes)
      echo "tty-confirm: approved" > /dev/tty
      exit 0
      ;;
    *)
      echo "tty-confirm: denied" > /dev/tty
      exit 1
      ;;
  esac
else
  echo "" > /dev/tty
  echo "tty-confirm: no reply in ${TIMEOUT}s — denied by timeout" > /dev/tty
  exit 3
fi
