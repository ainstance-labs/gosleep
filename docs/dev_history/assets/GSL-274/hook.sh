#!/bin/bash
# GSL-274 smoke-test hook: simulates gosleep-core long-poll for AskUserQuestion answers.
# 1) captures the PreToolUse stdin payload, 2) blocks until answer.json exists,
# 3) emits answer.json verbatim as the hook output (it holds the full hookSpecificOutput JSON).
DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")" && pwd)}"
cat > "$DIR/captured.json"
echo "$(date +%s.%N) hook-start pid=$$" >> "$DIR/hook.log"
while [ ! -f "$DIR/answer.json" ]; do
  sleep 1
done
sleep 0.3  # let the answer file write settle
echo "$(date +%s.%N) hook-released" >> "$DIR/hook.log"
cat "$DIR/answer.json"
exit 0
