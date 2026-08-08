# GSL-284 [Repo][Web] PermissionRequest matcher for the web question loop

**Date:** 2026-08-08 (shift 75 / cycle 209 impl-web-12, autonomous night)
**Branch:** GSL-250-control-plane
**Model:** Opus 4.7 (owner global pin)
**Depends on:** GSL-275 (answer-delivery loop), GSL-268 (POST /actions/* layer),
GSL-281 (SessionAdapter seam — deliverAnswer routes decision through the adapter).

## Part 1 — the story

The cycle-205 review flagged a gap in GSL-275: the PreToolUse hook shim handles
`AskUserQuestion` cleanly, but `PermissionRequest` (the tool Claude Code fires when the
model asks the user for permission to invoke another tool) has a completely different
`tool_input` shape and a completely different downstream semantics (boolean allow/deny
instead of a free-text answer). Left ignored, an agent asking for permission bypasses
the web control plane entirely — the owner never sees it, no provenance lands, no
audit trail exists.

This task extends the GSL-275 machinery with a permission-specific lane:

- **`POST /internal/permissions/post`** — sister of `/internal/questions/post`, tailored
  to the `{tool, params, message?}` shape. Writes a `kind='permission'` row with
  canonical `[{label:'Allow'},{label:'Deny'}]` options and a human-readable
  `"Permission request: <tool>\n\n<message>\n\n<params-preview>"` summary. Fires a
  fire-and-forget `lab-log --type permission.posed` so the tail indexer + SSE
  broadcaster carry the row to the web client within a tick. Returns a `p-YYYYMMDD-...`
  qid — distinct prefix from BLOCKER's `q-*`, so a reader can tell rows apart at a
  glance.

- **`POST /actions/permissions/decide {qid, decision, updated_message?}`** — sister of
  `/actions/questions/answer`. Guards on `kind='permission'` (deciding on a BLOCKER
  qid → 409, deciding on an already-answered permission → 409, unknown qid → 404,
  bad decision → 400). Writes `answer_text = 'allow' | 'deny'`, `applied_by = 'owner'`,
  and stores the optional `updated_message` in the `applied` column so the shim can
  read it back on the wait payload. Wakes the hook long-poll via the SessionAdapter
  seam (GSL-281): `getSessionAdapter().deliverAnswer(...)` — same wire as
  AskUserQuestion, same in-process notifier under the hood today.

- **`GET /internal/questions/:qid/answer-wait` extension** — the wait payload now
  carries `kind` and `applied` so the shim can distinguish the two lanes and pull
  the deny reason without a second GET.

- **`tools/hooks/permission-request-hook.sh`** — new shim that mirrors the
  ask-user-question shim's fail-open discipline (never exit 2, never emit noise on any
  non-happy branch, empty stdin → fail-open, secret missing → fail-open, core down →
  fail-open). Reads Claude Code's PreToolUse stdin, POSTs to
  `/internal/permissions/post`, long-polls the SHARED
  `/internal/questions/:qid/answer-wait` endpoint (one wait, one notifier, one wire),
  then emits `hookSpecificOutput { permissionDecision: "allow" }` or
  `{ permissionDecision: "deny", permissionDecisionReason: "<updated_message>" }` on
  the deny path.

- **Web Questions screen extension** — `kind === 'permission'` rows render an
  Allow/Deny button pair; Answer / Apply-manifest / Defer / Mark-resolved are HIDDEN
  on permission rows so a free-text answer cannot leak into the boolean decision
  path. Deny goes through a small dialog that collects the optional reason
  (`permissionDecisionReason`); Allow sends immediately.

### Isolated e2e proof (shim-direct pattern from GSL-275)

Ran `docs/dev_history/assets/GSL-284/run-e2e-driver.sh` under isolation
(`/tmp/gsl284-e2e`, port 7401, own Bearer + internal secret, own scratch DB, own
GOSLEEP_LAB_DIR — the live `docs/lab` was NEVER touched). Three paths, all green:

- **Path 1 — allow.** Shim POSTed → qid `p-20260808-…-7397268b` landed in the DB →
  curl POSTed `/actions/permissions/decide {decision:"allow"}` → long-poll released
  within ~ms → shim stdout: `{"hookSpecificOutput": {"hookEventName": "PreToolUse",
  "permissionDecision": "allow"}}`.
- **Path 2 — deny + reason.** Same flow with `{decision:"deny", updated_message:"E2E
  — destructive rm rejected"}` → shim stdout:
  `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision":
  "deny", "permissionDecisionReason": "E2E — destructive rm rejected"}}`.
- **Path 3 — fail-open (core down).** Killed core, port clean, spawned shim with the
  same stdin → shim exited 0 with EMPTY stdout in ~1 second. Debug log:
  `outcome:"fail_open" reason:"POST /internal/permissions/post rc=000000"`. TUI would
  render normally per hooks.md:223.

Evidence: `docs/dev_history/assets/GSL-284/{allow.stdout.json, deny.stdout.json,
failopen.stdout.txt, decide-allow.json, decide-deny.json, hook-debug.jsonl,
run-e2e-transcript.txt, run-e2e-driver.sh}`.

### Why lab-emit dual-write was skipped

Every AskUserQuestion path POST uses `lab-emit question --type BLOCKER` to write the
JSONL side; the tail indexer then re-folds the queue.jsonl and the row's `kind`
becomes what the JSONL record's `type` field says. lab-emit's `--type` accepts only
`{BLOCKER, DECISION, CLARIFY, FYI}` — no `permission`. If I dual-wrote via
`--type BLOCKER`, the tail re-fold would overwrite my `kind='permission'` back to
`BLOCKER` and the web UI's kind check would silently break.

Alternative approaches considered:
- **Extend lab-emit to accept `--type permission`.** Out of scope; touches a shared
  CLI tool the whole harness relies on, requires manifest §2 discussion.
- **Emit BLOCKER + override kind in the DB write, tolerate refold drift.** Fragile.
- **Skip the JSONL side entirely, direct DB INSERT only.** Chosen. Loses the JSONL
  audit trail for permission rows (they only exist in the DB), but the SSE fan-out
  is preserved via a `lab-log --type permission.posed` event on the events.jsonl
  side. A v2 task can extend lab-emit if the audit trail becomes important.

Documented in the header of `apps/core/src/routes/internal.ts` at the
`POST /internal/permissions/post` block so a reader hitting this code sees the shape
difference in one place.

### The answer-wait field surface widening

Added `kind` and `applied` to the `AnswerPayload` returned from `answer-wait`. The
permission shim needs `applied` to read the deny reason without a second GET; the
BLOCKER shim ignores it (backward-compatible, defaults to null on rows without an
applied column). The notifier's mutation is intentionally lean and does not carry
`applied` — on wake, the wait handler re-reads the row from SQLite via
`readQuestionRow(qid)` and builds the AnswerPayload from the fresh row. The extra
query is <1 ms on the hot loopback path.

## Part 2 — technical reference

### Files added

```
apps/core/src/routes/internal.ts               # POST /internal/permissions/post + helpers
apps/core/src/routes/actions.ts                # POST /actions/permissions/decide + doDecidePermission
packages/schema/src/index.ts                   # PermissionDecision, DecidePermissionActionInput/Result/Response
packages/sdk/src/index.ts                      # CoreClient.decidePermission()
apps/web/src/data/queries.ts                   # useDecidePermission
apps/web/src/screens/Questions.tsx             # permission card path (Allow/Deny + deny dialog)
tools/hooks/permission-request-hook.sh         # new shim
tools/lab/tests/core-smoke.sh                  # 9 new scenarios (42-50)
apps/core/test/internal.test.ts                # 6 new unit tests
docs/dev_history/GSL-284-phase7-permission-request-matcher.md
docs/dev_history/assets/GSL-284/*              # e2e evidence bundle
```

### Files modified (also affecting AskUserQuestion path — backward-compatible)

```
apps/core/src/routes/internal.ts               # answer-wait payload gains kind + applied
```

### Gates

- `bun x tsc -p apps/core --noEmit` — clean.
- `bun x tsc -p packages/schema --noEmit` — clean.
- `bun x tsc -p packages/sdk --noEmit` — clean.
- `bun x tsc -p apps/web --noEmit` — clean.
- `bun x tsc -p packages/runner-adapter --noEmit` — clean.
- `apps/core` `bun test` — 108 pass / 400 expects.
- `bash tools/lab/tests/core-smoke.sh` — **66 / 66 PASS** (was 55 before this task,
  +11 for permission scenarios; +1 for the guard on wrong-kind decide).
- `bash tools/lab/smoke.sh` — 549 / 551 (2 pre-existing FAILs unrelated to this
  task, same as GSL-281 dev history).
- **e2e (isolated shim-direct proof):** `docs/dev_history/assets/GSL-284/run-e2e-*` —
  allow / deny+reason / fail-open all PASS.

### Acceptance tripwires (from the GSL-284 Jira description)

- ✅ A PermissionRequest fired by a Claude Code agent lands as a `questions` row
  within a tick of the hook running (proven by shim-direct e2e: DB row visible
  within ~500 ms of POST).
- ✅ Answering via POST `/actions/permissions/decide` releases the agent's long-poll
  in the same ~ms window as the AskUserQuestion path (proven by shim-direct e2e:
  wall-clock <1 s from decide POST to shim stdout).
- ✅ Questions screen shows the permission card with Allow/Deny buttons; a click
  writes a row with `applied_by='owner'` and `answer_text='allow'|'deny'` (proven
  by the DB assertions in core-smoke scenarios 48 / 48b).

### Cleanup

- `/tmp/gsl284-e2e/` scrubbed.
- `/tmp/gsl284-driver.sh` scrubbed (copied under `docs/dev_history/assets/GSL-284/`
  for the record).
- No background bun processes, no leftover port 7401 listeners
  (verified `lsof -i :7401` empty).
- `.claude/settings.json` in the live project — UNTOUCHED. Installing the hook into
  a supervised session's settings is GSL-267's scope, not this task's.
