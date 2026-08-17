# GSL-401 live spot-check evidence

Scratch core: 127.0.0.1:7369 (NEVER prod 7331)
Date: 2026-08-17T00:45:08Z
Session under test: e2e03-spot-check-sess-02

## Step 1 — fake PreToolUse{AskUserQuestion} → tool-observed-feed.sh (normal path)

```json
{"session_id":"e2e03-spot-check-sess-02","tool_name":"AskUserQuestion"}
```

Fired with:
```
env GOSLEEP_WEB_QUESTIONS=1 GOSLEEP_CORE_URL="http://127.0.0.1:7369" \
    GOSLEEP_TOOL_OBSERVED_TOOL="AskUserQuestion" \
    GOSLEEP_TOOL_OBSERVED_INTENT="AskUserQuestion pending owner answer" \
  bash tools/hooks/tool-observed-feed.sh
```

### Fleet row AFTER PreToolUse (expected: current_tool='AskUserQuestion', current_intent='AskUserQuestion pending owner answer')

```json
{
  "session_id": "e2e03-spot-check-sess-02",
  "status": "observed",
  "current_tool": "AskUserQuestion",
  "current_intent": "AskUserQuestion pending owner answer"
}
```

## Step 2 — fake PostToolUse{AskUserQuestion} with GOSLEEP_TOOL_OBSERVED_CLEAR=1 (the fix)

Fired with:
```
env GOSLEEP_WEB_QUESTIONS=1 GOSLEEP_CORE_URL="http://127.0.0.1:7369" \
    GOSLEEP_TOOL_OBSERVED_CLEAR=1 \
  bash tools/hooks/tool-observed-feed.sh
```

### Fleet row AFTER PostToolUse clear (expected: current_tool=null, current_intent=null — the m1 fix)

```json
{
  "session_id": "e2e03-spot-check-sess-02",
  "status": "ended",
  "current_tool": null,
  "current_intent": null
}
```

## Verdict

The PostToolUse-driven CLEAR path NULLs `current_tool` and `current_intent` for the target session_id, resolving E2E run-03 finding m1.
