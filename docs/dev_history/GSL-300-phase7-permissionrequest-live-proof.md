# GSL-300 [Core][Docs] Live proof: PermissionRequest hook end-to-end

**Date:** 2026-08-09 (shift 76 / epic GSL-297).
**Branch:** `GSL-297-web-feature-complete`.
**Model:** Opus 4.7 (owner global pin, self-reported).
**Depends on:** GSL-284 (`/internal/permissions/post` + `/actions/permissions/decide` +
`tools/hooks/permission-request-hook.sh`), GSL-267 (guarded pilot wiring).

## Part 1 — the story

Sibling of GSL-299 for the second matcher in the layered live-signal contract (rev-3
addendum Delta 1 section 5). GSL-284 shipped the endpoint, the long-poll wait, the
shim, and 9 unit + smoke scenarios (42-50). This task adds the live doc-of-record for
both owner decisions — `allow` and `deny` — against the same isolated scratch core the
GSL-299 run used.

**Method.** Same shape as GSL-299 — a live `tools/hooks/permission-request-hook.sh`
invocation with a scripted stdin JSON (exactly the shape Claude Code's
PreToolUse{PermissionRequest} matcher passes), pilot env (`GOSLEEP_WEB_QUESTIONS=1
GOSLEEP_INTERNAL_SECRET=…`), pointed at the scratch core on 127.0.0.1:7332. The shim
POSTs `/internal/permissions/post`, receives a `p-<ts>-<hex>` qid, long-polls
`/internal/questions/:qid/answer-wait`. The owner-side `POST /actions/permissions/decide`
mints `answer_text: "allow"|"deny"`, wakes the notifier, releases the shim. The shim
emits its `permissionDecision` JSON to stdout.

**Both lanes PASS.**

| # | Decision | qid                              | Owner action                                                                                                | Shim released with                                                                                                                    | DB terminal state                                                          |
|---|----------|----------------------------------|-------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------|
| A | allow    | p-20260809-201639-e487aed3       | POST /actions/permissions/decide `{decision:"allow"}`                                                       | `permissionDecision:"allow"` (no `permissionDecisionReason` — allow doesn't carry one)                                                | status=answered, answer_text=allow, applied_by=owner                        |
| B | deny     | p-20260809-201659-6ae33310       | POST /actions/permissions/decide `{decision:"deny", updated_message:"GSL-300 deny lane: destructive command — declined by owner-web"}` | `permissionDecision:"deny"` + `permissionDecisionReason:"GSL-300 deny lane: destructive command — declined by owner-web"`             | status=answered, answer_text=deny, applied_by=owner, applied=<updated_message> |

The deny lane's `updated_message` carries the owner's reason through the DB's `applied`
column (semantically "what was applied when the row closed" per GSL-284 dev history's
schema design), then out through the shim as `permissionDecisionReason` — the field
Claude Code surfaces in the agent's transcript so a human reader of the transcript sees
WHY the tool call was aborted. That closes the loop the rev-3 addendum Delta 1 §5 asked
for.

**Smoke coverage confirmed adequate.** The Jira description asks "if the endpoint is not
yet covered in `tools/lab/tests/core-smoke.sh`, add a scenario asserting POST
`/actions/permissions/decide` returns 200 with a stubbed decision id." GSL-284's smoke
scenarios 42-50 already cover no-auth 401, bad-decision 400, unknown-qid 404, valid
allow → 200 + result.decision=allow + DB `answer_text=allow,applied_by=owner`,
already-answered 409, wrong-kind (BLOCKER) 409, and the full flow — nothing to add.
Confirmed by re-reading `tools/lab/tests/core-smoke.sh` lines 612-734.

**Evidence.** `docs/reports/verifications/GSL-297/runs/01/assets/v5-perm-allow-*.{txt,json}` +
`v5-perm-deny-*.{txt,json}` — DB before/after, response body, shim stdout, shim debug log,
for each lane.

## Part 2 — the reference

- **Commit:** `GSL-300 …` — one commit on `GSL-297-web-feature-complete`. Docs only.
- **Files:**
  - `docs/reports/verifications/GSL-297/runs/01/assets/v5-perm-allow-*` (5 files).
  - `.../v5-perm-deny-*` (5 files).
  - `docs/dev_history/GSL-300-phase7-permissionrequest-live-proof.md` (this file).
  - `docs/dev_history/README.md` (index entry).
- **Verified by running:** the exact commands + response bodies captured in the assets/
  directory. Reproduce per the "Method" table above.
- **Verdict:** rev-3 addendum Delta 1 section 5 "layered live-signal contract" now has
  its second-half live proof (first half = GSL-299 AskUserQuestion). Both allow and deny
  lanes exercised on a real hook + real core + real long-poll release. GSL-302 rolls the
  live proof into the Phase 7 acceptance dossier.
- **Links:** Jira [GSL-300](https://ainstance-labs.atlassian.net/browse/GSL-300),
  parent epic [GSL-297](https://ainstance-labs.atlassian.net/browse/GSL-297).
