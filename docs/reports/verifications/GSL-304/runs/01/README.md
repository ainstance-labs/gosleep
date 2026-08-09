# GSL-304 runs/01 — PermissionRequest real-session interception fix

**Date:** 2026-08-10 (night-autonomy shift).
**Branch:** `GSL-304-permreq-fix` (off origin/main `c953872`).
**Verifies:** GSL-305 landed the shim + settings.json edits; this run captures the
real-session evidence that all three lanes work end-to-end on Claude Code 2.1.226.

## Setup

- Scratch `@gosleep/core` on `127.0.0.1:7332` (Bearer `scratch-bearer-DO-NOT-USE`,
  internal secret `scratch-internal-DO-NOT-USE`), scratch DB and lab dir under
  `.artifacts/permreq-fix/` (gitignored). Production `data/gosleep.db` NOT touched;
  port `7331` NOT touched.
- Pilot: `tmux new-session -d -s permreq-pilot bash launch-pilot.sh` — Claude Code
  2.1.226, model=haiku, WITHOUT `--dangerously-skip-permissions`, with
  `GOSLEEP_WEB_QUESTIONS=1` + `GOSLEEP_INTERNAL_SECRET=…` +
  `GOSLEEP_CORE_URL=http://127.0.0.1:7332` + `GOSLEEP_PERM_REQ_DUMP=…` +
  `GOSLEEP_HOOK_DEBUG_LOG=…`.
- Decisions POSTed via `curl` to `/actions/permissions/decide` (permission lanes) or
  `/actions/questions/answer` (AskUserQuestion regression lane).

## Lanes

| # | Lane | Trigger | qid | Panel action | Shim released with | Agent observed |
|---|------|---------|-----|--------------|--------------------|----------------|
| 1 | allow | Bash `echo "permreq-fix-allow-lane-$(date +%s)" > /tmp/permreq-fix-allow.txt` | `p-20260809-223524-60bd06f6` | `{decision:"allow"}` | `{hookSpecificOutput:{hookEventName:"PermissionRequest",decision:{behavior:"allow"}}}` | "Allowed by PermissionRequest hook" → command ran → `/tmp/permreq-fix-allow.txt` = `permreq-fix-allow-lane-1786314955` |
| 2 | deny  | Bash `rm -rf /tmp/permreq-fix-deny-marker.txt` | `p-20260809-223625-cf0fa77c` | `{decision:"deny",updated_message:"blocked by night-autonomy policy: destructive rm -rf without dry-run"}` | `{...,decision:{behavior:"deny",reason:"…"}}` | "Denied by PermissionRequest hook" → command did NOT run → agent acknowledged the block |
| 3 | AskUserQuestion regression | AskUserQuestion with three color options | `q-2026-08-09-001` | `{"answer":"blue"}` | (via `ask-user-question-hook.sh`, unchanged shape) | "You chose blue for the badge." |

Shim debug log for the three lanes:

```
{"ts":"2026-08-09T22:35:55Z","hook":"permission-request","outcome":"decided","qid":"p-20260809-223524-60bd06f6","elapsed_ms":31000}
{"ts":"2026-08-09T22:36:36Z","hook":"permission-request","outcome":"decided","qid":"p-20260809-223625-cf0fa77c","elapsed_ms":11000}
{"ts":"2026-08-09T22:38:24Z","hook":"ask-user-question","outcome":"allow","qid":"q-2026-08-09-001","elapsed_ms":26000}
```

## Assets

- `assets/v1-perm-allow-payload.json` — raw PermissionRequest event payload captured
  from the allow-lane invocation (649 bytes). Notable: `permission_suggestions[]` is
  an undocumented CC 2.1.226 field.
- `assets/v2-perm-deny-payload.json` — deny-lane payload (680 bytes; two suggestions:
  `addDirectories /tmp`, `setMode acceptEdits`).
- `assets/v1-perm-allow-decide-response.json`, `assets/v2-perm-deny-decide-response.json` —
  `/actions/permissions/decide` response bodies.
- `assets/v3-auq-regression-answer-response.json` — `/actions/questions/answer`
  response body for the AUQ regression lane.
- `assets/v1v2-pilot-shim-debug.jsonl` — shim's debug log for all three lanes.
- `assets/v1v2v3-db-full.txt` — full `questions` table snapshot at end of pilot.
- `assets/v1v2-pane-both-lanes.txt`, `assets/v3-auq-regression-pane.txt` — captured
  tmux pane transcripts.

## Documented caveat

CC 2.1.226 does not surface `decision.reason` to the model transcript for a
PermissionRequest deny — CC's own "Denied by PermissionRequest hook" line is the
model-visible signal. The `updated_message` still lands in DB `applied` column for
audit. Deny is HONORED (safety-critical). If a future task needs the specific reason
string in the model's transcript, the pattern is to switch the shim to a
`PreToolUse[matcher:"Bash|Edit|Write|MultiEdit|mcp__.*"]` intercept (has
`permissionDecisionReason` in its documented shape) at the cost of intercepting every
tool call — deferred as out of scope here.
