# GSL-275 — Answer-delivery loop (production): PreToolUse{AskUserQuestion} shim + long-poll gosleep-core

**Date:** 2026-08-07 · **Epic:** GSL-250 (interactive control plane) · **Branch:** `GSL-250-control-plane`
**Depends on / follows:** GSL-274 (smoke: primary path is `allow`+`updatedInput`), GSL-268 (POST /actions/questions/answer with dual-write + provenance).
**Design source:** `docs/reports/web-harness-research-2026-08-03/target-architecture-rev3-addendum.md` Delta 1.

## What was done

I built the production shape of the answer-delivery loop that GSL-274 de-risked at the mechanism level. Three things landed together and are proven end-to-end against a live interactive Claude Code session:

1. **Two new endpoints on `@gosleep/core`, both under `/internal/*`, both guarded by a NEW env-secret gate distinct from the web Bearer** (so a leaked web token cannot masquerade as an agent-side hook, and vice versa):
   * `POST /internal/questions/post` — accepts the AskUserQuestion `tool_input` payload the hook receives on stdin, spawns `tools/lab/lab-emit.sh question --type BLOCKER` to write the JSONL side, AND directly `INSERT OR IGNORE`s the row into the SQLite `questions` table so the web `/questions` screen sees it instantly (no waiting for the tail indexer). Returns `{qid, deduped}`. Dedup is inherited from lab-emit's own `qhash(task, question)`.
   * `GET  /internal/questions/:qid/answer-wait?timeout_s=N` — long-poll held open until the row transitions to `answered` (or any terminal status) OR the timeout elapses. **Not a DB polling loop** — the wait subscribes to an in-process EventEmitter (`src/questions/notifier.ts`) that the answer/resolve action fires from inside the same await frame after the direct DB UPDATE. Wake latency is ~milliseconds; the tail-indexer path is unchanged (still fans the same event out on SSE for the browser). Returns the answer JSON on release, or `204 No Content` on timeout.

2. **`tools/hooks/ask-user-question-hook.sh`** — the production PreToolUse{AskUserQuestion} command hook. Reads Claude Code's JSON payload from stdin, POSTs it to `/internal/questions/post`, then long-polls `/internal/questions/:qid/answer-wait`. On a 200 it emits `hookSpecificOutput { permissionDecision: "allow", updatedInput: { questions, answers } }` — exactly the GSL-274 verdict shape. On 204 (timeout) it exits 0 with no output, letting the TUI dialog render normally per `hooks.md:223`. On any curl failure (core down, wrong secret, connect refused) it fails open FAST with no output — never exits 2, never blocks the tool call.

3. **Bun tests + core-smoke coverage** — six new /internal/* scenarios in `tools/lab/tests/core-smoke.sh` (401 no-secret, 401 wrong secret, 404 unknown qid, 401 POST no secret, 200+qid POST valid, 204 wait timeout), plus a new `apps/core/test/internal.test.ts` covering all four unit paths the ticket names: answer-before-wait, wait-then-answer, timeout, and secret-required (503 unset / 401 wrong / 401 missing).

**All three end-to-end paths were live-proven on a real interactive Claude Code 2.1.224 (Haiku 4.5, Claude Max subscription) session inside an isolated `/tmp/gsl275-e2e/` project (own git root, own tmux session `gsl275-e2e`, own `.claude/settings.json` pointing at the shim, `GOSLEEP_LAB_DIR=/tmp/gsl275-lab` — the live `docs/lab` was never touched). Evidence in `docs/dev_history/assets/GSL-275/`.**

* **Primary (allow + updatedInput):** agent asked "Which fruit do you prefer?" → shim POSTed → question landed in DB (`GET /questions?status=open` shows the row) → I curl-POSTed `/actions/questions/answer {qid, answer:"Banana"}` (as the web button would) → long-poll released within ~milliseconds → shim emitted `hookSpecificOutput allow + updatedInput` → **TUI dialog never rendered** → agent proceeded with `ANSWER RECEIVED: Banana`. Evidence: `assets/GSL-275/run2-primary/`.
* **Timeout:** hook set to `GOSLEEP_HOOK_TIMEOUT_S=6`, agent asked "Which season?", no answer POSTed → 204 came back → shim exited 0 with no output → **TUI dialog rendered normally** → I picked Winter with the keyboard → agent proceeded with `ANSWER RECEIVED: Winter`. Debug log: `outcome:"timeout" elapsed_ms:6000`. Evidence: `assets/GSL-275/run3-timeout/`.
* **Core-down fail-open:** I killed core (`kill -9 $CORE_PID`, port clean), fresh session asked "Which weather?" → shim POST got connect-refused instantly → `fail_open reason:"POST /internal/questions/post rc=000000" elapsed_ms:0` → **TUI dialog rendered near-instantly** (no 2s connect wait — refused on loopback immediately) → I picked Sunny → agent proceeded with `ANSWER RECEIVED: Sunny`. Evidence: `assets/GSL-275/run4-core-down/`.

## Problems solved

* **Wake-up without DB polling.** Naive answer-wait would `SELECT ... FROM questions WHERE qid=? AND status='answered'` in a loop; that pins a Bun timer against SQLite and either wastes cycles or is laggy. I added an in-process `QuestionNotifier` singleton and hooked `doAnswer` / `doResolve` to call `notify()` after the direct DB UPDATE. The wait subscribes to `mutation:<qid>` and races the notify against `setTimeout(timeout_s)` and `req.signal.aborted`. Sub-500-ms release in the "wait then answer" bun test; ~milliseconds in the live E2E.
* **The `printf | python3 - <<'PY'` trap in the shim.** First cut of the hook tried to pipe stdin into python via `printf '%s' "$STDIN" | python3 - <<'PY'`. That doesn't work: `python3 -` reads the SCRIPT from stdin, and the heredoc replaces the pipe — so `sys.stdin.read()` returned empty and the shim fail-opened with "could not build POST body from stdin". Caught it during the first live-Claude run (the shim fell open cleanly — invariant held — but the primary path never fired). Fix: stage stdin to a temp file, pass the path as `sys.argv[1]`. Re-verified end-to-end.
* **The `INSERT OR IGNORE` dual-write.** Initial cut only spawned lab-emit; when I ran core-smoke against the internal endpoints, scenario 20 (`answer-wait` against a fresh qid with `timeout_s=1`) returned 404 because the smoke runs with `GOSLEEP_DISABLE_INDEXER=1` — so the JSONL row never gets folded into SQLite. Rather than turn the indexer on (which drags rotation watchers and 10s poll timers into a hermetic test), I mirrored the `doAnswer` pattern: `POST /internal/questions/post` now does BOTH the lab-emit spawn AND an `INSERT OR IGNORE questions ...` so the DB row exists immediately. This is also the right shape for production: `GET /questions` shows the row without any fs.watch/debounce lag, and the wait can find it.
* **Non-blocking failure semantics.** The whole shim is a giant "fail-open FAST or block the agent forever" question. Every non-200 response (401, 503, connect refused, curl timeout, python parse error, empty stdin) routes to a single `fail_open()` that logs one debug line and exits 0. Never exit 2, never emit stdout — because either would corrupt Claude Code's decision. `set -u -o pipefail` is on so a genuine bash bug would exit 2 and BLOCK — I explicitly guard every failure path to keep that invariant.

## Problems remaining

* **Multi-question dialogs untested.** `AskUserQuestion` in principle accepts N questions in one call; the shim only maps the FIRST question's answer to the answers map, and the DB row only stores the first question. GSL-274's caveat is preserved. If future traffic ships multi-question payloads, both the endpoint (return `answers[]` instead of `answer_text`) and the shim (map by index) need one focused patch.
* **Wait timeout ceiling is hard-coded at 1800 s** in `parseTimeoutSeconds`. The addendum names 900–1800 s as the production window; anyone wanting "all night" waits (which fable-final §1(b) argues AGAINST) would have to lift the cap.
* **Hook wiring into a live supervised session** is out of scope by ticket contract — GSL-267 owns writing the PreToolUse{AskUserQuestion} matcher into `.claude/settings.json`. This task ships the machinery + the fully-worked example (`assets/GSL-275/settings.json.example`, `env.example`).
* **PermissionRequest matcher** (item 6 in the ticket "same pattern for PermissionRequest") is NOT built here. The rationale below.

## Pitfalls & workarounds

* **`GOSLEEP_INTERNAL_SECRET` unset → 503, never 401.** Same Delta-5 discipline as the web Bearer: silent-unauth is the gh-CLI bug we do not repeat. The shim reads 503 identically to any other non-200 → fail-open, so the session survives an off internal loop cleanly.
* **`X-Internal-Secret` is a distinct header, NOT `Authorization: Bearer`.** Reason: `requireBearer` is per-route, not app-wide; if we reused `Authorization: Bearer`, a mis-set env could accidentally satisfy either middleware with the same string. A different header makes the two auth sources unmistakable in both curl and server logs.
* **The hook script must send `Host: 127.0.0.1:7331` AND `Origin: http://127.0.0.1:7331` on POSTs** — the app-wide `requireLocalHost` + `requireLocalOrigin` middlewares reject anything else with 421 / 403 respectively. GET requests skip the Origin check (safe-method escape hatch), but POST does not. Documented at the top of the shim; failing to send Origin would fall open cleanly (403 → non-200 → fail_open) so this is a diagnostic issue, not a safety issue.
* **The notifier is deliberately IN-PROCESS.** If a future task ever splits `@gosleep/core` across processes, the answer-wait wake channel becomes cross-process and this file needs a real bus. Called out in the module header comment so a maintainer cannot miss it.
* **PermissionRequest not built here — deliberate scope call.** The ticket lists "same pattern for PermissionRequest" as item 6, but `hooks.md` documents PermissionRequest with a different tool-input shape (a specific tool being requested, not a questions[] array) and a different downstream semantics (approve/deny, no updatedInput answers map). Building it on top of THIS shim would require inventing a second DB row shape and a second answer-mutation path — that is a full second ticket, not a bolt-on. Left explicit in "Problems remaining" so GSL-267 or a follow-on task picks it up cleanly.

## What didn't make it

* The Delta 8.2 provenance columns (`applied_by`, `applied_rule_ref`) on the `questions` table — those are GSL-277 scope and would have widened this diff without addressing the ticket. The `answered_by` string is already carried on the answer POST body and echoed in the wait response; when the schema gains the columns, the endpoint's `answered_by` field starts populating from the row instead of the notifier payload — one-line change.
* A `.claude/settings.json` sample was NOT committed — it lives only under `docs/dev_history/assets/GSL-275/settings.json.example` as documentation. The live project's `.claude/settings.json` is off-limits (owner rule; GSL-267 scope).

## Technical reference

* **Commit:** `<see git log after this file lands>`
* **Files added:**
  * `apps/core/src/questions/notifier.ts` — in-process EventEmitter for question row mutations.
  * `apps/core/src/security/internalSecret.ts` — `requireInternalSecret` middleware, env-secret via `GOSLEEP_INTERNAL_SECRET`.
  * `apps/core/src/routes/internal.ts` — `POST /internal/questions/post` + `GET /internal/questions/:qid/answer-wait`.
  * `apps/core/test/internal.test.ts` — 8 unit tests (5 long-poll behaviours + 3 auth cases).
  * `tools/hooks/ask-user-question-hook.sh` — production shim (executable, `set -u -o pipefail`, fail-open on every non-happy branch).
  * `docs/dev_history/GSL-275-web-answer-loop-production.md` — this file.
  * `docs/dev_history/assets/GSL-275/{run1-shim-direct,run2-primary,run3-timeout,run4-core-down}/*` — live E2E evidence panes + hook debug lines + core POST response bodies.
  * `docs/dev_history/assets/GSL-275/settings.json.example`, `env.example` — installation reference for GSL-267.
* **Files modified:**
  * `apps/core/src/serve.ts` — mount `internalRoutes` on the app after `actionsRoutes`.
  * `apps/core/src/routes/actions.ts` — `doAnswer` + `doResolve` now call `questionNotifier.notify(...)` immediately after the direct DB UPDATE.
  * `tools/lab/tests/core-smoke.sh` — 6 new /internal/* scenarios (15–20), boot env now sets `GOSLEEP_INTERNAL_SECRET`.
* **Gates run:**
  * `bun x tsc -p apps/core --noEmit` — clean.
  * `bun test apps/core/test/` — 50 pass / 0 fail, 127 expect() calls.
  * `bash tools/lab/tests/core-smoke.sh` — **26/26 PASS** (was 20 before this task, +6 for /internal/*).
  * `bash tools/lab/smoke.sh` (offline gate) — **PASS=551 FAIL=0**.
* **Verified by running:**
  1. **Isolated E2E** on a real Claude Code 2.1.224 interactive session, Haiku 4.5, Claude Max — three paths (primary / timeout / core-down) each captured in `docs/dev_history/assets/GSL-275/run{2,3,4}-*/` including the TUI pane content proving `ANSWER RECEIVED: <chosen>` reached the model in every case.
  2. **Direct shim test** — spawned the shim with a synthetic stdin payload against a live core, background curl POSTed the answer; the shim's stdout was the exact `hookSpecificOutput` JSON the ticket names, `outcome:allow` in the debug log, `elapsed_ms:3000` (2 s scripted delay + ~1 s wait/notify). Evidence: `assets/GSL-275/run1-shim-direct/`.
  3. **Isolation asserted post-run**: `tmux list-sessions | grep gsl275` empty, `lsof -i :7331` empty, `/tmp/gsl275-*` empty, `git status docs/lab/questions/queue.jsonl` shows only unrelated pre-existing changes I did not touch (GOSLEEP_LAB_DIR pointed at `/tmp/gsl275-lab` throughout).
* **Jira:** GSL-275 → In Review after the commit lands. No PR — one PR per Epic (GSL-250) discipline; this task is one commit on `GSL-250-control-plane`.

## References

* Rev-3 addendum Delta 1: `docs/reports/web-harness-research-2026-08-03/target-architecture-rev3-addendum.md`.
* GSL-274 findings: `docs/dev_history/GSL-274-web-answer-loop-smoke.md` (primary primitive validated).
* GSL-268 answer POST: `docs/dev_history/GSL-268-web-post-actions.md` (the endpoint the web button uses and the E2E answers were posted to).
* `code.claude.com/docs/en/hooks.md` lines 223 (silent-fallback semantics), 415 (600s default timeout), 1643/1688 (allow+updatedInput contract), 1664 (deny+reason contract), 1698 (defer is print-mode only — not used here).
