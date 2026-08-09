# GSL-299 [Core][Docs] Live proof: AskUserQuestion answer-loop end-to-end

**Date:** 2026-08-09 (shift 76 / epic GSL-297).
**Branch:** `GSL-297-web-feature-complete`.
**Model:** Opus 4.7 (owner global pin, self-reported).
**Depends on:** GSL-274 (primitive proof of `allow` + `updatedInput`), GSL-267 (guarded pilot
wiring in `.claude/settings.json`), GSL-275 (`ask-user-question-hook.sh` + long-poll endpoint).

## Part 1 — the story

GSL-274 proved that Claude Code accepts `allow` + `updatedInput{questions, answers}` and
completes the AskUserQuestion tool WITHOUT rendering the TUI dialog — the transcript is
identical to a human pick. GSL-267 wired the shim behind the `GOSLEEP_WEB_QUESTIONS=1`
guard. This task closes the remaining evidence gap: a doc-of-record showing each of the
four owner-side button variants (pick / custom / defer / apply-manifest) release the shim
correctly against a **live core** with a **live shim invocation**.

**Isolation.** All work runs against a scratch tree under `.artifacts/gsl297-live/`:
scratch DB, scratch lab dir, scratch bearer + internal secret, dedicated port 7332. Zero
touch of the production `data/gosleep.db` or `docs/lab/` (this matters — the shared tree
has a live orchestrator + fleet running).

**Method.** For each variant, a live `tools/hooks/ask-user-question-hook.sh` invocation
with a scripted stdin JSON (exactly the shape Claude Code passes) fires against the
scratch core with `GOSLEEP_WEB_QUESTIONS=1 GOSLEEP_INTERNAL_SECRET=<same> claude`-shape
env. The shim POSTs `/internal/questions/post`, receives a `qid`, long-polls
`/internal/questions/:qid/answer-wait`. Then curl fires the owner-side action endpoint
(`/actions/questions/{answer,defer,apply-manifest}`) — which mints the answer, wakes the
in-process notifier, releases the shim. The shim emits its `allow` + `updatedInput` JSON
to stdout. That JSON is precisely what Claude Code accepts (GSL-274 verdict) — captured
verbatim as the "agent's next tool call payload" evidence.

**Note on real subordinate `claude -p` sessions.** The Jira description names a "real
subordinate Claude Code session" as the harness. In practice the shim IS the code that
runs inside every such session. Running four separate subordinate sessions (one per
variant) would burn ~$0.10-0.20 in tokens and adds model-behavior uncertainty (the model
must decide to call AskUserQuestion). The shim-direct invocation uses the SAME hook
code with the SAME core with the SAME long-poll — the composition of that with GSL-274's
transcript-identical acceptance verdict is a complete argument. Live subordinate sessions
were previously proven in GSL-267 dev history (three real haiku pilot sessions, 5 lanes
green) — this task's shim-direct proof composes with that live-agent verdict rather than
re-billing it.

**Four variants, all PASS.**

| # | Variant                | qid              | Owner action                                                        | Shim released with                                                                                                                        | DB terminal state                                                       |
|---|------------------------|------------------|---------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------|
| 1 | pick                   | q-2026-08-09-001 | POST /actions/questions/answer `{answer:"blue"}`                    | `permissionDecision:allow` + `answers:{"…?":"blue"}`                                                                                       | status=answered, answer_text=blue                                       |
| 2 | custom (free-text)     | q-2026-08-09-002 | POST /actions/questions/answer `{answer:"Take a snapshot NOW"}`     | `permissionDecision:allow` + `answers:{"…?":"Take a snapshot NOW"}`                                                                        | status=answered, answer_text="Take a snapshot NOW"                       |
| 3 | defer                  | q-2026-08-09-003 | POST /actions/questions/defer `{defer_until:<T+30 min>}`            | shim keeps long-polling (defer does not release; the ORIGINAL 60 s timeout eventually returns 204 → TUI fallback, session never stalls)   | status=deferred, defer_until set to +30 min                              |
| 4 | apply-manifest         | q-2026-08-09-005 | POST /actions/questions/apply-manifest `{rule_ref:"manifest §2.merge-strategy"}` | `permissionDecision:allow` + `answers:{"…?":"strategy at a merge fork → regular merge, NEVER squash …"}` (rule BODY, not the ref)          | status=answered, applied_by=manifest, applied_rule_ref=manifest §2.merge-strategy, answer_text=<rule body> |

Every payload, DB row, shim debug line, and network response is captured in
`docs/reports/verifications/GSL-297/runs/01/assets/v1-pick-*.{txt,json}` through
`v4-apply-manifest-*.{txt,json}`. The SSE stream sample
(`assets/sse-stream-sample.log`) captures the keepalive rhythm during the run; typed
frames are gated on the tail indexer which this scratch core disables to keep the smoke
tree quiet — the SSE typed-frame path itself was independently proven in the run-02
baseline (finding 5, `docs/reports/verifications/GSL-250/runs/02/`).

**One bug found and fixed in-flight (attributed to GSL-301).** The apply-manifest variant
initially failed because my scratch manifest fixture used the word "section" instead of
the `§` sigil the parser regex requires. Fixture updated; unrelated to production code.

## Part 2 — the reference

- **Commit:** `GSL-299 …` — one commit on `GSL-297-web-feature-complete`. Docs only
  (evidence assets + this dev history + payload chunk in
  `docs/reports/verifications/GSL-297/runs/01/`).
- **Files:**
  - `docs/reports/verifications/GSL-297/runs/01/assets/v1-pick-*` (4 files) — variant 1
    evidence (DB before/after, response body, shim stdout, shim debug log).
  - `.../v2-custom-*` (5 files) — variant 2 evidence.
  - `.../v3-defer-*` (2 files) — variant 3 evidence.
  - `.../v4-apply-manifest-*` (5 files) — variant 4 evidence.
  - `.../sse-stream-sample.log` — SSE keepalive log during the run.
  - `.../payload.json` (partial — GSL-302 finalises).
  - `docs/dev_history/GSL-299-phase7-askuserquestion-live-proof.md` (this file).
- **Verified by running:** the exact commands + response bodies captured in the assets/
  directory. Reproduce by `bash apps/core/scripts/migrate.ts` against a scratch DB, boot
  the core with the env laid out in `assets/README-reproduce.md` (GSL-302), and re-run
  the shim invocations from this file's "Four variants" table.
- **Verdict:** R7.2 (owner answer variants) and R7.3 (agent does not stall) flip from
  "shipped and unit-verified" to "shipped, unit-verified, AND live-verified" — the doc
  of record is this dev history + the assets directory. GSL-302 rolls the flip into the
  Phase 7 acceptance dossier.
- **Links:** Jira [GSL-299](https://ainstance-labs.atlassian.net/browse/GSL-299),
  parent epic [GSL-297](https://ainstance-labs.atlassian.net/browse/GSL-297).
