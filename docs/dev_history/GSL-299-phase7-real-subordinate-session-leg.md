# GSL-299 [Core][Docs] Real subordinate Claude Code session leg (follow-up)

**Date:** 2026-08-09 (shift 76 / epic GSL-297).
**Branch:** `GSL-297-web-feature-complete`.
**Model:** Opus 4.7 (worker), Haiku 4.5 (subordinate pilot session under test).
**Depends on:** GSL-299 initial commit `e6676a5` (shim-direct evidence for four variants).

## Part 1 — the story

Orchestrator acceptance check after commit `e6676a5`: the Jira description asks
for "a real subordinate Claude Code session with `env GOSLEEP_WEB_QUESTIONS=1
GOSLEEP_INTERNAL_SECRET=<same> claude …`" as the harness. The initial commit
landed with FOUR variants proven via **shim-direct** invocation composed with
GSL-274's transcript-identical acceptance verdict and GSL-267's earlier
live-subordinate proof — a complete argument, but not a *fresh* real-session leg
in THIS run. Descriptions win over speed (owner rule). This follow-up commit adds
that leg.

**What I tried first (documented for the record).** `claude --print
--allowedTools AskUserQuestion --dangerously-skip-permissions <prompt>` — headless
mode disables the AskUserQuestion tool regardless of `--allowedTools`, and Haiku
politely refuses ("К сожалению, инструмент AskUserQuestion отключён в этой
сессии"). The tool is interactive-only by product design in `-p` mode.

**What I ran instead.** Interactive `tmux` session (the same shape GSL-267 used
for its pilot):

```
tmux new-session -d -s gsl297pilot -x 200 -y 50 \
  '<launcher that exports GOSLEEP_WEB_QUESTIONS=1 GOSLEEP_INTERNAL_SECRET=… \
    GOSLEEP_CORE_URL=http://127.0.0.1:7332 GOSLEEP_HOOK_TIMEOUT_S=180, then \
    exec claude --model haiku --dangerously-skip-permissions>'
tmux pipe-pane -t gsl297pilot -o 'cat >> …/live-pilot-pane.log'
tmux send-keys -t gsl297pilot 'Call the AskUserQuestion tool NOW with ONE
question…' Enter
```

**Timeline (all timestamps UTC 2026-08-09):**

- `20:58:22Z` — prompt sent to Haiku session in tmux.
- `20:58:23Z` — Haiku's model turn started, called AskUserQuestion with a
  two-option prompt ("Which color should we use for the badge?" — blue / green).
  The `PreToolUse{AskUserQuestion}` shim fired, guard passed (env has
  `GOSLEEP_WEB_QUESTIONS=1`), shim POSTed to `/internal/questions/post`, core
  wrote `q-2026-08-09-006` (kind=BLOCKER, status=open). qid landed in the DB in
  **≤ 1 second**.
- `20:58:31Z` — owner-simulating curl fires `POST /actions/questions/answer`
  with `{"qid":"q-2026-08-09-006","answer":"blue"}`. Server responded 200 in
  124 ms with `result.status=answered, answered_by=owner-web`.
- `20:58:50Z` — shim's long-poll received the answer, emitted
  `hookSpecificOutput.permissionDecision:"allow"` + `updatedInput.answers` with
  `{"Which color…": "blue"}`. Total shim elapsed: **19 s** (matches the
  shim-debug JSONL line).
- `20:58:50Z–20:59:05Z` — Haiku's model turn continued. The pane shows:
  ```
  ⎿  · Which color should we use for the badge? → blue

  ⏺ You chose blue for the badge.
  ```
  The TUI dialog **never rendered** (the shim intercepted upstream).

**Verdict.** Real subordinate session leg PASSES. Every step of the loop
end-to-end — model → shim → core → owner (curl) → core → shim → model → agent's
next line surfaces the answer — is captured in `assets/v7-real-session-*`.

**Fleet fields side-effect (GSL-301 remaining-gap probe).** During and after the
real session, `agent_sessions` stayed EMPTY. Confirms the "no hook in
`tools/hooks/` today CALLS `/internal/agents/tool-observed`" finding — the real
session did NOT feed the endpoint. The already-shipped GSL-301 fix + manual
POST proof still stands; the last-mile shim is still the named follow-up.

## Part 2 — the reference

- **Commit:** `GSL-299 …` follow-up (per delivery convention: follow-up commits
  under the same task key are allowed for evidence additions; dev-history
  precedent GSL-267 pilot notes established the pattern).
- **Files:**
  - `docs/reports/verifications/GSL-297/runs/01/assets/v7-real-session-answer-response.json`
  - `docs/reports/verifications/GSL-297/runs/01/assets/v7-real-session-db-after.txt`
  - `docs/reports/verifications/GSL-297/runs/01/assets/v7-real-session-pane.txt`
    (tmux capture-pane -S -100 — includes the "You chose blue for the badge"
    line and the AskUserQuestion prompt frame)
  - `docs/reports/verifications/GSL-297/runs/01/assets/v7-real-session-shim-debug.jsonl`
    (single line: `{ts, outcome:"allow", qid:"q-2026-08-09-006", elapsed_ms:19000}`)
  - `docs/reports/verifications/GSL-297/runs/01/payload.json` — R7.2 flip
    updated to reference both shim-direct and real-session evidence; `not_reverified`
    rewritten to reflect what was and was not spent.
  - `docs/reports/verifications/GSL-297/runs/01/index.html` — R7.2 row + "What
    was NOT re-verified" paragraph updated to match.
  - `docs/dev_history/GSL-299-phase7-real-subordinate-session-leg.md` (this file).
- **Verified by running:** the exact tmux + curl transcript captured above; DB
  row confirms `status=answered, answer_text=blue`.
- **Links:** Jira [GSL-299](https://ainstance-labs.atlassian.net/browse/GSL-299),
  parent epic [GSL-297](https://ainstance-labs.atlassian.net/browse/GSL-297).
