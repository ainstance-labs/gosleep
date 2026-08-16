# GSL-380 — task-submission executor (`apps/core/src/sessions/submit.ts`)

**Epic:** GSL-378 · **Branch:** `GSL-378-observer-task-submission` · **Base:** `origin/main` @ `a52b302`.

The one function inside core that shells out to `tmux send-keys` on behalf of the panel.
Deliberately narrow — literal-text-only body, argv arrays (no `sh -c`), UTF-8 payload
capped at 16 KB (R16.7), sub-0x20 bytes rejected except Tab/Newline (R16 Q5 default).
Any widening of this primitive is a security-model change and needs an explicit owner ask.

## Module shape

`apps/core/src/sessions/submit.ts` exports:

- `MAX_BODY_BYTES` (= 16 * 1024) and `PROMPT_BOUNDARY_WAIT_MS` (= 5 000) — constants that
  encode the PRD's defensible defaults for Q4 and Q1.
- `normaliseAndValidateBody(raw)` — trims trailing whitespace, checks UTF-8 byte-length
  against the cap, rejects sub-0x20 bytes (except 0x09 Tab and 0x0a Newline) and DEL (0x7f).
- `scanForSecretShapes(body)` — advisory-only regex sweep for AWS key ids, `sk-` /
  `sk-ant-` API keys, GitHub tokens, JWT-shaped strings, Bearer-header fragments. Returns
  `SubmissionWarning[]` the panel renders above the preview (R16 Q3 default: yes,
  advisory, non-blocking).
- `computeBodySha256(body)` — hex-lowercase SHA-256, used for the timeline event and the
  `task_submissions.body_sha256` column so a re-run against the same body converges.
- `resolvePaneRef(db, session_id)` — SELECT into `tmux_panes` at dispatch time (never
  from the request body — R16.4). Two-path LEFT JOIN mirrors `/fleet`:
  cwd-prefix heuristic first (prod default), pidtree fallback (opt-in). Returns null when
  neither path matches → the executor collapses to `outcome='pane_gone'`.
- `readPaneCurrentCommand(db, paneRef)` + `isPaneAtPrompt(cmd)` +
  `waitForPromptBoundary(db, paneRef, opts)` — the prompt-boundary heuristic: polls the
  `pane_current_command` column every 250 ms up to 5 s. The prompt-set is
  `bash|zsh|fish|sh|dash|ksh|tcsh|csh|node|bun|claude`; unknown commands default to
  "busy" so an unrecognised receiver takes the safer wait path.
- `previewSubmission(db, {session_id, body, framing?})` — runs all three preview guards
  (session-not-controlled 409, shim-not-registered 409, body-invalid 400) and returns
  `{resolved_target, keystroke_bytes, body_len, body_sha256, framing, warnings,
  previewed_at}` on success. Resolves the pane at preview time too so the panel can show
  "target: gsl378-target:@1.%42".
- `submitTask(db, {session_id, body, framing?}, deps?)` — the confirm-phase executor.
  Re-runs the three guards, resolves pane_ref again, waits at prompt-boundary if the
  framing calls for it, then fires two argv-array `tmux send-keys` calls:
  `["tmux", "send-keys", "-t", <ref>, "-l", <body>]` then
  `["tmux", "send-keys", "-t", <ref>, "Enter"]`. Two calls, never combined — the `-l`
  flag never interprets its argument, so a trailing Enter has to be a separate keystroke.
  Combining them would require dropping `-l` and letting tmux parse the whole body as a
  mix of literal + key names, which is exactly the widening R16.9 forbids.

`SubmitDeps` injects `spawn`, `waitForPromptBoundary` and `now` so tests never touch
real tmux and don't sleep.

## Outcome enum

Every path the executor can take:

- `delivered` — happy path: both tmux calls returned rc=0.
- `pane_gone` — pane_ref resolves to null at dispatch (F16-S5). No send.
- `released_mid_submit` — the session-state re-read at confirm returns `state!='controlled'`
  OR `shim_registered=false` (F16-S6, plus a related shim-un-registration case).
  No send.
- `not_at_prompt` — framing='prompt-boundary' waited PROMPT_BOUNDARY_WAIT_MS ms and the
  pane_current_command never entered the prompt-set. No send.
- `send_failed` — either the body send returned rc≠0 (nothing landed) OR the body sent
  but the Enter failed (the body typed but never submitted; the error message explicitly
  names "already landed in pane" so the drawer can flag it and the owner can press Enter
  manually).

## Tests

`apps/core/test/sessions.submit.test.ts` — 28 tests across five groups:

- normaliseAndValidateBody (7): empty, whitespace-only, over-cap, sub-0x20 byte, DEL,
  multibyte + Tab + Newline accepted, trailing-whitespace stripped.
- scanForSecretShapes (3): AWS AKIA-prefixed flagged, Anthropic sk-ant- flagged, clean
  body → no warnings.
- isPaneAtPrompt (2): shell/claude commands are prompts; unknown commands are busy.
- resolvePaneRef (2): heuristic match by cwd_project_root; null when no match.
- previewSubmission (3): session-not-controlled 409, shim-not-registered 409, happy path.
- submitTask (8) — one per outcome plus "framing='none' skips wait" plus "body cannot
  be substituted by request state" (deletes the pane row after seed to force null resolve).
- waitForPromptBoundary (3): immediate-prompt no-sleep, prompt-arrives-mid-wait,
  timeout when never at prompt.

All 28 pass. Full apps/core suite: 384 pass / 0 fail (356 baseline + 28 new).

## Live scratch-tmux proofs

`apps/core/scripts/smoke/submit-live-smoke.ts` — boots an in-memory DB with the three
tables the executor reads, seeds one controlled session pointing at a REAL tmux pane
whose ref is passed as argv[1], runs `submitTask({framing: "none"})`, and verifies the
body landed via `tmux capture-pane`. **Refuses to run** if the pane_ref does not start
with `gsl378-` — guardrail so this smoke can never accidentally send to a foreign pane
in the shared tmux server.

Run this shift against `tmux new-session -d -s gsl378-target ...`:
`{"outcome":"delivered","body_len":32,"body_sha256":"b72793d…","landed_in_pane":true}`.
Pane capture (in `docs/dev_history/assets/GSL-380/tmux-capture-after-submit.txt`) shows
the exact body typed into the bash prompt.

`apps/core/scripts/smoke/submit-live-refusals.ts` — three refusal cases (observer,
shim-unregistered, pane-gone), all confirming outcome==expected AND sent==false. Output
saved in `docs/dev_history/assets/GSL-380/refusals.json`.

Scratch tmux session torn down after the run (`tmux kill-session -t gsl378-target`);
teardown confirmed via `tmux ls | grep gsl378 || echo "scratch teardown ok"`.

## Follow-ups

- GSL-381 will call `previewSubmission` from the dry-run mode of the POST endpoint and
  `submitTask` from the confirm mode, wrapped in the standard three-layer envelope
  (`requireBearer` + `serialize("session.submit", session_id)` + `withTimeline`).
- GSL-382 will fire `task.submitted` / `task.submit.failed` timeline events from the
  endpoint's `withTimeline` closure, with `body_sha256` + `body_len` + `pane_ref` +
  `framing` on the payload.
