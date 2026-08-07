# GSL-274 — Answer-delivery loop smoke test (interactive `allow` + `updatedInput`)

**Date:** 2026-08-07 · **Epic:** GSL-250 (interactive control plane) · **Branch:** `GSL-250-control-plane`
**Timebox:** 30 min allotted, ~12 min used for the live experiment.
**Design under test:** `docs/reports/web-harness-research-2026-08-03/target-architecture-rev3-addendum.md` Delta 1 (v1 answer-delivery loop) and `docs/reports/web-stack-audit-2026-08-06/fable-final-verdict.md` section 1 (a–d).

## Verdict

**PASS on all five sub-checks. The rev-3 answer-loop design is buildable exactly as specified.**

**Production primitive: `permissionDecision: "allow"` + `updatedInput{questions, answers}`.** The residual unknown flagged in fable-final section 1(c) — "whether interactive mode then skips the TUI dialog entirely is not stated in so many words" — is now resolved empirically: **interactive mode skips the TUI dialog entirely**, and the injected answer is recorded in the transcript with *byte-identical phrasing* to a human TUI selection. `deny` + reason remains a validated but semantically lossier fallback (kept documented, not needed as primary).

| Sub-check | Result | Evidence |
|---|---|---|
| S1 hook fires before TUI render; full payload captured | **PASS** | `assets/GSL-274/run1/captured.json`, `hook.log` |
| S2 session genuinely blocked while hook waits | **PASS** | `assets/GSL-274/run1/gsl274-s2-pane{1,2}.txt` |
| S3 `allow`+`updatedInput` → agent proceeds with injected answer | **PASS** | `assets/GSL-274/run1/pane-after-inject.txt`, `transcript-excerpt.txt` |
| S4 hook timeout → benign TUI fallback, session uncorrupted | **PASS** | `assets/GSL-274/run3/pane-timeout.txt`, `pane-selected.txt` |
| S5 fallback `deny`+reason → model reads answer, proceeds | **PASS** | `assets/GSL-274/run2/pane-after-deny.txt`, `transcript-excerpt.txt` |

## Environment

- Claude Code **2.1.224** (the exact build fable-final verified doc claims against), macOS, tmux 3.6a.
- Test sessions: interactive TUI, **Haiku 4.5**, Claude Max subscription — i.e. a LIVE interactive subscription session, the production contour.
- Isolation: `tmp-answer-loop-test/` at repo root, **its own `git init` root** so its `.claude/settings.json` is the project settings for the test session; gosleep's production `.claude/settings.json` untouched; the dir was gitignored during the test and removed after. Test session ran in a dedicated detached tmux session (`gsl274`), created and killed by this task only.
- User-global `~/.claude/settings.json` has no `PreToolUse{AskUserQuestion}` hooks — no interference (verified before the run).

## Test rig (snapshot in `assets/GSL-274/`)

- `settings.json` — `PreToolUse` matcher `AskUserQuestion`, command `"$CLAUDE_PROJECT_DIR"/hook.sh`, `timeout: 300` (S4 rerun used `timeout: 15`).
- `hook.sh` — simulates the gosleep-core long-poll: captures the stdin payload to `captured.json`, blocks in a `while [ ! -f answer.json ]` loop, then emits `answer.json` verbatim as the hook's stdout. The answer file *is* the full `hookSpecificOutput` JSON, so the same rig tests both variants without edits.

## Run 1 — S1/S2/S3, primary path

Prompt: ask color preference via AskUserQuestion, options Red/Blue; injected answer **Blue** (deliberately the non-first option, so injection is distinguishable from a default pick).

- **S1:** `captured.json` appeared ~5 s after prompt submit, containing the full `tool_input`: `{"questions":[{"question":"Which color do you prefer?","header":"Color preference","options":[{"label":"Red",...},{"label":"Blue",...}],"multiSelect":false}]}` plus `session_id`, `transcript_path`, `tool_use_id`, `permission_mode:"default"`. No question UI on screen at that point.
- **S2:** two pane captures 5 s apart show only the spinner (`Reticulating… (13s)` → `(18s)`), **no question dialog** — the session is held inside the hook, not rendering.
- **S3:** on writing `answer.json` (`allow` + `updatedInput` echoing `questions` + `answers: {"Which color do you prefer?": "Blue"}`) the session released within ~1–2 s. TUI rendered:
  ```
  ⏺ User answered Claude's questions:
    ⎿  · Which color do you prefer? → Blue
  ⏺ ANSWER RECEIVED: Blue
  ```
  The dialog **never** appeared. Transcript (structural JSONL read):
  ```
  TOOL_RESULT :: "Your questions have been answered: \"Which color do you prefer?\"=\"Blue\". You can now continue with these answers in mind."
  ```

## Run 2 — S5, documented fallback (same session, fresh question)

Prompt: animal preference, Cat/Dog; `answer.json` = `deny` + `permissionDecisionReason: "OWNER ANSWERED: Dog. …Proceed as if the user selected: Dog."`

- TUI renders the reason as an **error line**: `⎿ Error: OWNER ANSWERED: Dog. …` — then the model proceeded: `ANSWER RECEIVED: Dog`.
- Transcript: `tool_result … is_error: True`. Works end-to-end, but the turn carries a failed tool call — semantically lossier exactly as fable-final section 1(d)-2 predicted. Keep as fallback only.

## Run 3 — S4, timeout path (fresh session, `timeout: 15`, no answer file)

- Hook fired (payload captured), no `answer.json` written. **~15 s later the AskUserQuestion dialog rendered normally in the TUI** (Summer/Winter selector, plus built-in `Type something.` / `Chat about this` rows). No error surfaced to the user; the hook process was cancelled silently (its `hook-released` line never appeared in `hook.log`).
- Selecting Winter via keyboard: session proceeded normally (`ANSWER RECEIVED: Winter`), transcript `tool_result` well-formed, `is_error` absent. **Benign fallback confirmed; session not corrupted.**

## Findings beyond the sub-checks

1. **Injected ≡ human at the transcript level.** Run 1 (injected) and Run 3 (human TUI selection) produce the *same* canonical `tool_result` phrasing: `Your questions have been answered: "<q>"="<label>". You can now continue with these answers in mind.` Downstream consumers (chroniclers, indexers) cannot and need not distinguish the answer's origin — provenance must therefore live in gosleep-core (Delta 8.2 `applied_by`/`applied_rule_ref`), never be inferred from the session.
2. **TUI renders a synthetic confirmation** (`⏺ User answered Claude's questions: …`) for the injected path — the owner watching the pane still sees what was answered. Good for the fleet-screen story.
3. **Timeout cancellation is silent and clean** — matches hooks.md:223 ("no decision to report → normal permission flow"). The 600 s default / per-hook `timeout` semantics behaved as documented at 15 s and 300 s.
4. **Hook latency is negligible**: capture ≤1 s after tool call; release ≤2 s after the answer file lands (1 s poll loop + 0.3 s settle in the rig).

## Caveats (honest scope limits)

- Single-question, single-select only; `multiSelect` and multi-question arrays untested (schema-identical mechanism, low risk, but untested here).
- Timeout tested at 15 s and held at ≤300 s; the production 900–1800 s window and Esc-during-hold behavior remain untested (rev-3 already scopes waits to a bounded window).
- One run per path (smoke, not eval); Haiku 4.5 as the in-session model — the hook mechanics are model-independent, the model-side reaction (S3/S5 compliance) was clean on first attempt in both variants.

## Consequence for the epic

GSL-274 was the gate on Delta 1. **Gate open:** build `POST /internal/questions/post` + `GET /internal/questions/<qid>/wait` long-poll and the per-session `PreToolUse{AskUserQuestion}` hook exactly per rev-3, with `allow`+`updatedInput` as the primary and `deny`+reason kept as a config-selectable fallback.
