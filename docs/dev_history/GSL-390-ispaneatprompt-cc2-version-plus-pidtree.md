# GSL-390 — isPaneAtPrompt robust for Claude Code 2.1.x (version-shape + process-tree)

**Parent epic.** [GSL-388](https://ainstance-labs.atlassian.net/browse/GSL-388) — "[Core][Web] E2E run-01 findings — heartbeat + prompt-boundary + attribution + reopen + one-click".
**GH mirror.** https://github.com/ainstance-labs/gosleep/issues/383 (parent epic #381).
**Branch.** `GSL-388-e2e01-findings`.
**Commits.** `994a5b3` (two-tier predicate + process-tree probe) + `e520d8c` (include pane_pid's own comm).

## What run-01 found

`docs/reports/verifications/harness-web-e2e-2026-08-17/runs/01/index.html` finding #2:
a submission with the default `prompt-boundary` framing (the framing the panel's
Submit-task dialog recommends by default) settled `not_at_prompt` for every attempt
against a real Claude Code 2.1.233 fixture — because `tmux #{pane_current_command}`
returned the version string `"2.1.233"`, and `isPaneAtPrompt`'s allowlist only matched
known shells and `"claude"`. The recovery path (switch framing to `none` and resend) is
undocumented in the dialog copy, so the "happy path" the run-01 verifier followed
looked broken until they discovered the workaround.

## Fix design

Two-tier async predicate in `apps/core/src/sessions/submit.ts::paneQualifiesAsPrompt`
(now called by `waitForPromptBoundary` instead of the sync `isPaneAtPrompt`):

1. **Known shell / claude** → accept immediately (no shell-out).
2. **Version-shaped command** (`2.1.233` / `v1.2.3` / `1.2.3+build` / …) → walk the
   pane's process tree once via `ps -eo pid=,ppid=,comm=` and accept iff a `claude`
   process is present. NOT blanket — a pane whose command happens to render as a
   version but has no `claude` in its tree stays rejected.
3. **Anything else** → reject (busy).

The sync `isPaneAtPrompt` is preserved with its exact GSL-380 semantics (bash/zsh/…/
claude accept; node/bun/vim reject) so no other caller regresses.

## Gap the live-leg exposed

The unit tests passed with a fixture "no claude in descendants → reject", and with
"claude among descendants → accept". But on real macOS Claude Code 2.1.x, the pane_pid
IS the claude process itself, and its descendants are the tools claude spawns (`node`,
`npm`, `chrome-devtools-mcp`) — never `claude`. The pre-fix walker returned only
descendants and rejected the pane.

**Fix (commit `e520d8c`).** Include the root's own comm in the walker output.
`ps -o comm=` returns argv[0] which for a directly-invoked `claude` binary is `"claude"`
(even though tmux's kernel-level exec-basename probe returns `"2.1.233"`). Prepending
the root's own comm to the walk lets `paneQualifiesAsPrompt` accept a pane whose
pane_pid IS Claude Code — the real prod case.

Test coverage expanded accordingly:
- "walks descendants" now also asserts the root's own comm appears in the results.
- New case "root pid IS claude" — rooted on a pid whose comm='claude', descendants are
  the tools claude spawns; walker returns claude+node+npm+chrome-devtools-mcp. Mirrors
  the live-leg fixture's actual process shape.
- New case "root pid gone" — root not in ps table (already exited) → walker returns [].

## Live-leg proof

Under `docs/dev_history/assets/GSL-388/`:

- Fixture setup: real Claude Code 2.1.233, Sonnet, tmux session `fixe2e01-fixture`,
  pane_pid=87836, pane_current_command reported by tmux = `"2.1.233"`, `ps -o comm= -p
  87836` = `"claude"`.
- `live-leg-task-submissions.txt` — TWO rows for the same fixture session:
  1. First submission (pre-fix core): `outcome=not_at_prompt`,
     `error='pane not at prompt after 5000 ms wait'` — reproduces the run-01 defect.
  2. Second submission (post-`e520d8c` core, restarted): `outcome=delivered`, `error=null`.
- `live-leg-m2-dryrun.json` / `live-leg-m2-confirm.json` — the exact request/response
  pair. Both requests use `framing=prompt-boundary` (the dialog default).
- `live-leg-fixture-pane.txt` — real fixture pane, `FIXE2E01_M2_LIVE_TOKEN 2026-08-16`
  landed via tmux send-keys and the Claude fixture echoed it back
  ("Понял, зафиксировал: FIXE2E01_M2_LIVE_TOKEN 2026-08-16"). One click, no framing
  switch, no manual seeding.

Fixture Claude session id: `99986404-9e7b-4a6a-a0fa-1427edeff309`.

## Files touched

- `apps/core/src/sessions/submit.ts` — `isVersionShapedCommand`, `readPanePid`,
  `readDescendantCommsDefault`, `descendantCommsFromPsOutput`, `commLooksLikeClaude`,
  `paneQualifiesAsPrompt`; `waitForPromptBoundary` now delegates to the async
  predicate. Root-comm inclusion in `descendantCommsFromPsOutput` per `e520d8c`.
- `apps/core/test/sessions.submit.test.ts` — new suites `isVersionShapedCommand`,
  `commLooksLikeClaude`, `descendantCommsFromPsOutput`, `paneQualifiesAsPrompt`
  (13 new tests total, incl. the run-01 acceptance shape and the "root pid IS
  claude" case).

## Gates

- `bun x tsc -p apps/core --noEmit` — clean.
- `bun test apps/core/test/sessions.submit.test.ts` — 47/47 pass.
- Full core suite — 431/431 (before follow-up), 433/433 (after follow-up).
- Live-leg — outcome flips `not_at_prompt` → `delivered` on the same fixture across a
  core restart. Fixture receives the text via `tmux send-keys` and echoes it back.
