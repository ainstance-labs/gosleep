# GSL-305 [Core] Wire real PermissionRequest event + adapt shim output + real-session evidence

**Date:** 2026-08-10 (night-autonomy shift, epic GSL-304).
**Branch:** `GSL-304-permreq-fix`.
**Model:** Opus 4.7 (owner default for night-autonomy workers).
**Depends on:** GSL-284 (shim body + endpoints), GSL-267 (guarded pilot), GSL-297
(broken-state evidence at runs/01 `v9-perm-real-attempt-note.md`).
**Owner decision:** `d-2026-08-09-005` — `.claude/settings.json` unfrozen; night-autonomy
worker may edit it minimally.

## Part 1 — the story

Follow-up to a documented dead-end. The GSL-297 dossier landed with one honest
impossibility: the `PreToolUse[matcher:"PermissionRequest"]` wiring never fired on a real
Claude Code 2.1.226 session — TUI dialog rendered directly, `permission-request-hook.sh`
was never invoked, debug log stayed zero-bytes, scratch DB had no `p-*` rows during the
window. The GSL-297 closer left the frozen `.claude/settings.json` alone per the owner's
explicit escape hatch. GSL-302 documented the residual gap (index.html section
"remaining_gaps"). Owner unfroze `.claude/settings.json` on 2026-08-09
(`d-2026-08-09-005`) so this could be fixed properly.

**Doc-driven diagnosis.** Two WebFetch reads of the current Claude Code hooks docs
(https://code.claude.com/docs/en/hooks) — separated by ~30 minutes so cache was fresh —
were unambiguous: `PermissionRequest` is a **dedicated top-level hook event**, a peer of
`PreToolUse`, not a matcher value on it. `PreToolUse.matcher` matches on `tool_name` (the
tool being called: `Bash`, `Edit`, `Write`, `mcp__*`). No tool is literally named
`PermissionRequest`; the string-value matcher matched no event, hence the empty debug log.
The PermissionRequest event fires exactly when CC would otherwise render the permission
modal. Its output contract is different from PreToolUse's:

- **PreToolUse deny:** `hookSpecificOutput.{permissionDecision:"deny", permissionDecisionReason:"…"}`.
- **PermissionRequest deny:** `hookSpecificOutput.{hookEventName:"PermissionRequest", decision:{behavior:"deny"}}`.

**The fix — two files, minimal diff.**

`.claude/settings.json`:

- REMOVED the dead `PreToolUse[matcher:"PermissionRequest"]` entry (~5 lines).
- ADDED a top-level `PermissionRequest[matcher:".*"]` block wired at the SAME shim,
  with a `$comment` naming GSL-304 as the rationale and pointing at the GSL-297 v9
  evidence.
- Total: 4 lines added / 1 line removed (plus in-place `$comment` rewrite on the
  surviving `PreToolUse[matcher:"AskUserQuestion"]` entry so future readers understand
  what's where and why).

`tools/hooks/permission-request-hook.sh`:

- Header block rewritten to name the DEDICATED `PermissionRequest` event, quote the
  real payload shape (session_id, prompt_id, transcript_path, cwd, permission_mode,
  hook_event_name, tool_use_id, tool_name, tool_input, `permission_suggestions[]` —
  the last is a CC 2.1.226 bonus field not in the docs).
- Added `GOSLEEP_PERM_REQ_DUMP` diagnostic knob (pattern precedent GSL-303
  `GOSLEEP_TOOL_OBSERVED_DUMP`) — when set to a path prefix, appends the raw stdin
  payload as `<prefix>.<epoch-ns>`; write failures swallowed.
- Section 4 (build output) rewritten from PreToolUse shape to PermissionRequest
  shape: `hookSpecificOutput.{hookEventName:"PermissionRequest", decision:{behavior:"allow"|"deny", reason?:"…"}}`.
- Everything else (guard on `GOSLEEP_WEB_QUESTIONS=1`, POST to
  `/internal/permissions/post`, long-poll on `/internal/questions/:qid/answer-wait`,
  background call into `tool-observed-feed.sh`, fail-open on every non-happy branch,
  no secret in stdout) preserved byte-identical.

**Empirical proof — real interactive Claude Code 2.1.226 session, three lanes.** Scratch
core on `127.0.0.1:7332`, scratch DB under `.artifacts/permreq-fix/gosleep.db`, scratch
lab dir, scratch Bearer + internal secret. Pilot: `tmux new-session -d -s permreq-pilot
bash launch-pilot.sh` where `launch-pilot.sh` exports `GOSLEEP_WEB_QUESTIONS=1`,
`GOSLEEP_INTERNAL_SECRET=scratch-internal-DO-NOT-USE`,
`GOSLEEP_CORE_URL=http://127.0.0.1:7332`, `GOSLEEP_PERM_REQ_DUMP=…`,
`GOSLEEP_HOOK_DEBUG_LOG=…`, then `exec claude --model haiku` (deliberately WITHOUT
`--dangerously-skip-permissions` so the permission mode actually prompts).

- **Lane 1 (allow):** prompted the pilot to run `echo "permreq-fix-allow-lane-$(date
  +%s)" > /tmp/permreq-fix-allow.txt`. The PermissionRequest event fired — payload
  captured as `permreq-stdin.1786314924700534000` (649 bytes; committed as
  `assets/v1-perm-allow-payload.json`). Shim POSTed → row `p-20260809-223524-60bd06f6`
  landed with `kind=permission status=open`. Panel decide via curl (`{"qid":"…",
  "decision":"allow"}`) returned 200. Shim's long-poll released within ~ms → stdout
  `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}`.
  CC surfaced "Allowed by PermissionRequest hook", the Bash command ran, `/tmp` file
  landed with contents `permreq-fix-allow-lane-1786314955`.
- **Lane 2 (deny):** prompted the pilot to run `rm -rf
  /tmp/permreq-fix-deny-marker.txt`. Second event fired — payload captured as
  `permreq-stdin.1786314985223527000` (680 bytes; committed as
  `assets/v2-perm-deny-payload.json`). Panel decide via curl
  (`{"qid":"…","decision":"deny","updated_message":"blocked by night-autonomy policy:
  destructive rm -rf without dry-run"}`) returned 200. Shim released with
  `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","reason":"…"}}}`.
  CC surfaced "Denied by PermissionRequest hook"; the `rm` did NOT run; agent's next
  turn text acknowledged the block ("Хук заблокировал выполнение этой команды.
  Пожалуйста, проверьте конфигурацию хуков в .claude/settings.json …").
- **Lane 3 (AskUserQuestion regression):** immediately after the deny, prompted the
  pilot to call the AskUserQuestion tool with three color options. Row
  `q-2026-08-09-001` landed (`kind=BLOCKER status=open`), `ask-user-question-hook.sh`
  long-polled, panel POST `/actions/questions/answer` with `{"answer":"blue"}`
  returned 200, shim released with `permissionDecision:"allow"` +
  `updatedInput.answers`, agent's next line surfaced "You chose blue for the badge."
  — proves the settings.json edit did NOT regress the AskUserQuestion path.

Shim debug log for the three lanes (`assets/v1v2-pilot-shim-debug.jsonl`):

```
{"ts":"2026-08-09T22:35:55Z","hook":"permission-request","outcome":"decided","qid":"p-20260809-223524-60bd06f6","elapsed_ms":31000}
{"ts":"2026-08-09T22:36:36Z","hook":"permission-request","outcome":"decided","qid":"p-20260809-223625-cf0fa77c","elapsed_ms":11000}
{"ts":"2026-08-09T22:38:24Z","hook":"ask-user-question","outcome":"allow","qid":"q-2026-08-09-001","elapsed_ms":26000}
```

**Documented caveat — CC 2.1.226 does NOT surface `decision.reason` to the model.**
Reading the docs one more time, the PermissionRequest decision object is documented as
`{behavior:"allow"|"deny"}` only — no `reason` / `message` / `rule` field is in the schema
table for the model-visible payload. We still emit `decision.reason` when the deny row's
`applied` column is non-empty (harmless — CC accepts unknown fields silently) so it lands
in the JSONL evidence and the DB `applied` audit column; the model's transcript shows
CC's own "Denied by PermissionRequest hook" line and the model composes a generic
"blocked by hook" response. The DENY IS HONORED — that's the safety-critical fact. If a
future task needs the specific reason string in the model's transcript, the pattern would
be to switch the shim to a `PreToolUse[matcher:"Bash|Edit|Write|MultiEdit|mcp__.*"]`
intercept (which has `permissionDecisionReason` in its documented shape) — at the cost of
intercepting EVERY tool call, not just those that would prompt. Deferred as out of scope
here.

**Bonus intel from the captured payload.** CC 2.1.226 includes a `permission_suggestions`
array in the event payload — an undocumented field carrying the "always allow …" /
"switch to acceptEdits mode" hints the TUI modal would have offered. Two entries in
`v2-perm-deny-payload.json`: `{type:"addDirectories",directories:["/tmp"],destination:"session"}`
and `{type:"setMode",mode:"acceptEdits",destination:"session"}`. Worth mining later for a
"suggest a rule" panel affordance.

**Gates (all clean).**

- `bun x tsc -p apps/core --noEmit` — pass.
- `bun test` (apps/core) — 191/0.
- `bash tools/lab/tests/core-smoke.sh` — 96/0 (unchanged; smoke does not touch the shim
  and does not run under `GOSLEEP_WEB_QUESTIONS=1`, so the shim's new output shape is not
  exercised by smoke — real-session evidence in `runs/01/` covers that).
- `bash -n tools/hooks/permission-request-hook.sh` — pass.
- `jq . .claude/settings.json > /dev/null` — pass.

**Rollback.** `git revert` of this task's commit brings back the dead PreToolUse entry
and the PreToolUse-shape shim output. The file watcher unloads the `PermissionRequest`
event live; sessions in-flight fall back to the TUI modal on the next permission prompt.
Nothing in `data/` needs cleaning up (scratch DB lives in `.artifacts/permreq-fix/` and
is gitignored).

## Part 2 — technical reference

- **Files touched (3):**
  - `.claude/settings.json` — 4 lines added / 1 line removed (plus `$comment` rewrite).
  - `tools/hooks/permission-request-hook.sh` — header block rewritten (docs), diagnostic
    knob added (~7 lines), section 4 output shape rewritten (~10 lines).
  - `docs/runbooks/gosleep-core.md` section 8 — event name updated, new PermissionRequest
    control-path bullet added, rollback bullet mentions both matchers.
  - `docs/prd/01-phase7-interactive-control-plane.md` — new bullet "PermissionRequest
    known-limitation FIXED (GSL-304, 2026-08-10)" under "Acceptance criteria + end-check".
- **Evidence:** `docs/reports/verifications/GSL-304/runs/01/assets/` — 10 files including
  two real event-payload samples, shim debug log, DB row snapshots, decide-endpoint
  response bodies, pane captures.
- **Real-session env used:** `GOSLEEP_WEB_QUESTIONS=1`,
  `GOSLEEP_INTERNAL_SECRET=scratch-internal-DO-NOT-USE`,
  `GOSLEEP_CORE_URL=http://127.0.0.1:7332`, `GOSLEEP_HOOK_TIMEOUT_S=180`,
  `GOSLEEP_HOOK_DEBUG_LOG=…`, `GOSLEEP_PERM_REQ_DUMP=…`.
- **Owner decision drivers:** `d-2026-08-09-005` (settings.json unfrozen),
  `d-2026-08-08-001` (widening to all sessions still owner-gated — this task does NOT
  widen; guard stays inside the shim).
- **Cross-links:** Jira epic GSL-304, task GSL-305; GH mirrors #304 (epic), #305 (task);
  PR TBD after gates land.
