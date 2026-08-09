# v9 — PermissionRequest real-session leg: honest impossibility

**Attempt (UTC 2026-08-09 T21:38..T21:41):** Launched interactive tmux session
`bash .artifacts/gsl297-live/launch-pilot-perm.sh` — Claude Code 2.1.226,
model=haiku, WITHOUT `--dangerously-skip-permissions`, with
`GOSLEEP_WEB_QUESTIONS=1` + `GOSLEEP_INTERNAL_SECRET=gsl297-live-internal`
pointing at scratch core `127.0.0.1:7332`. Prompted the model to run
`echo "gsl297-perm-test-$(date +%s)" > /tmp/gsl297-perm-test.txt` — a Bash
command that requires permission approval.

**Observed:** the TUI permission dialog rendered directly in the pane
("Do you want to proceed? 1. Yes / 2. Yes, always / 3. No"). The
`permission-request-hook.sh` shim was NEVER invoked — the shim's
`GOSLEEP_HOOK_DEBUG_LOG` file
(`.artifacts/gsl297-live/logs/live-pilot-perm-shim-debug.jsonl`) remained
zero bytes, and the scratch DB (`questions` table) has zero rows with
`kind='permission'` created during the attempt window (only
`q-2026-08-09-007` from an earlier unrelated session).

**Conclusion:** the `PreToolUse` matcher string `"PermissionRequest"` in
`.claude/settings.json` (line 107) does NOT match the event Claude Code
2.1.226 emits when a real Bash tool call needs permission. The TUI
short-circuits straight to the modal.

**Why we stopped:** the closer plan for GSL-297 authorises this exact
escape hatch — "If the real leg proves technically impossible WITHOUT
touching `.claude/settings.json` — STOP this sub-item, keep shim-direct
as the standing evidence, and report the exact reason honestly; the
frozen file stays byte-identical to main (verifier proved 0-diff — keep
it that way)". Diagnosing whether the matcher should be a tool name
(`"Bash"`) with a shim-side permission check, whether it needs a
different string, or whether the CC 2.1.x feature is not shipped, would
require editing `.claude/settings.json`.

**Standing evidence for the PermissionRequest contract:** shim-direct
proofs `v5-perm-allow-*` and `v5-perm-deny-*` in this same assets/ dir
(GSL-300, commit 0fdf988) exercise the shim end-to-end by handing the
POST → long-poll path a synthesised stdin payload; `GSL-284` smoke
scenarios 42-50 cover the endpoint's HTTP shape (401/400/404/valid/409/
wrong-kind). The gap is limited to "Claude Code -> hook wiring", not
"hook -> core -> decide -> hook release".

**Artefacts captured:**
- `v9-perm-real-attempt-shim-debug-empty.jsonl` — the zero-byte debug
  log proving the shim never ran.
- Pane transcript: kept out-of-tree at
  `.artifacts/gsl297-live/logs/live-pilot-perm-pane.log` (~41 KB); the
  key line was the TUI dialog `Do you want to proceed? 1. Yes / 2.
  Yes, always / 3. No`. Full log is scratch and not committed.
