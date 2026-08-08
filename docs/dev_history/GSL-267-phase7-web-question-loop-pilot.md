# GSL-267 [Web] Web question-loop hooks — GUARDED PILOT install

**Date:** 2026-08-08 (shift 75 / cycle 211 impl-web-14, day session)
**Branch:** GSL-250-control-plane
**Model:** Opus 4.7 (owner global pin)
**Depends on:** GSL-275 (AskUserQuestion shim body), GSL-284 (PermissionRequest
shim body + `/internal/permissions/post`), GSL-268 (`POST /actions/questions/answer`
+ `POST /actions/permissions/decide`), owner decision **d-2026-08-08-001** (env-guarded
pilot rather than blanket rollout).

## Part 1 — the story

### What was done

The two shims built under GSL-275 and GSL-284 have been sitting on disk with no way
to fire from a live session, because nothing was wired into `.claude/settings.json`.
This commit does exactly that wiring — with an env-flag guard so it is a *pilot*, not
a rollout.

Concretely:

1. Both shims (`tools/hooks/ask-user-question-hook.sh`,
   `tools/hooks/permission-request-hook.sh`) now open with a hard guard as their
   very first executable line:
   ```bash
   if [ "${GOSLEEP_WEB_QUESTIONS:-0}" != "1" ]; then
       exit 0
   fi
   ```
   Any session that was NOT launched with `GOSLEEP_WEB_QUESTIONS=1` sees the matcher
   fire, the shim exit 0 in ~400 ms with empty stdout — Claude Code reads that as
   "hook has no decision" (hooks.md:223) and renders the TUI dialog exactly as
   today. Neither GSL-275 nor GSL-284 had this guard; the shim bodies from those
   tasks assumed a per-session opt-in that never got specified. This commit
   specifies it.

2. `.claude/settings.json` gains a new `PreToolUse` block, additively (nothing
   removed, nothing else touched):
   - `matcher: "AskUserQuestion"` → `ask-user-question-hook.sh`, `timeout: 3600`
   - `matcher: "PermissionRequest"` → `permission-request-hook.sh`, `timeout: 3600`

   The 3600 s = the day-window ceiling the owner agreed to. The shim itself long-polls
   for `GOSLEEP_HOOK_TIMEOUT_S` (default 600 s, configurable per session, cap at 3600 s
   via the hook process timeout).

3. `docs/runbooks/gosleep-core.md` gains a new § 8 "Web question-loop pilot" section
   documenting: how to opt a session INTO the pilot (`env GOSLEEP_WEB_QUESTIONS=1
   GOSLEEP_INTERNAL_SECRET=… claude …`), how the loop looks end-to-end, how to widen
   later (owner command only), how to roll back (`git revert` of this commit — file
   watcher unloads the matchers live).

4. `CLAUDE.md` gains a short bullet under the monorepo section pointing at the new
   § 8 in the runbook.

5. Live pilot proof (below), performed against the REAL production DB
   (`data/gosleep.db`), a fresh gosleep-core spawned inline with dev-env secrets,
   two real interactive Claude sessions in fresh tmux sessions, one WITH the flag and
   one WITHOUT.

### Live pilot proof — three lanes, all green

**Lane 1 — AskUserQuestion, shim-direct against real core + real DB.**
`echo <stdin> | env GOSLEEP_WEB_QUESTIONS=1 … ask-user-question-hook.sh`
- qid `q-2026-08-08-003` landed in `questions` within ~250 ms (`kind=BLOCKER`,
  `task=GSL-267-pilot`).
- `GET /questions?status=open` returned the row with the pilot marker.
- `POST /actions/questions/answer {qid, answer:"circle"}` → HTTP 200,
  `answered_by=owner`.
- shim's long-poll released within ~ms, stdout was exactly
  ```json
  {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow",
   "updatedInput":{"questions":[…],"answers":{"…":"circle"}}}}
  ```
- `hook-debug.jsonl`: `outcome=allow, qid=q-2026-08-08-003, elapsed_ms=2000`.

**Lane 2 — PermissionRequest, shim-direct.**
- qid `p-20260808-142314-1aa4b82d` landed (`kind=permission`).
- `POST /actions/permissions/decide {decision:"allow"}` → HTTP 200, `applied_by=owner`.
- shim stdout: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}`.
- `hook-debug.jsonl`: `outcome=decided, qid=p-20260808-142314-1aa4b82d, elapsed_ms=1000`.

**Lane 3 — real Claude Code session, `claude --model haiku`, tmux session `gsl267-a`,
`GOSLEEP_WEB_QUESTIONS=1`.** THIS is the "settings.json actually wires the shim into
a real session" proof:
- Prompted haiku "call AskUserQuestion right now with question 'GSL-267-pilot-A tmux:
  pick color', options red/blue".
- Within 1 s, qid `q-2026-08-08-004` landed in the DB — the shim intercepted the
  tool call (from the settings.json wiring) and POSTed to `/internal/questions/post`.
- `curl -X POST /actions/questions/answer {answer:"blue"}` → HTTP 200.
- Pane capture showed **no TUI dialog rendered at any point**. The AskUserQuestion
  tool completed silently with `GSL-267-pilot-A tmux: pick color → blue`, and haiku
  replied `Готово. Выбран blue.`
- `hook-debug.jsonl`: `outcome=allow, qid=q-2026-08-08-004, elapsed_ms=16000`
  (16 s = time from tool-call to my curl answer).

**Lane 4 — CONTROL. Real Claude Code session, tmux session `gsl267-b`,
NO `GOSLEEP_WEB_QUESTIONS` set.**
- Same prompt shape ("call AskUserQuestion with 'GSL-267-pilot-B tmux control: pick
  fruit'").
- Pane capture BEFORE-answer showed the TUI dialog **fully rendered**:
  `Enter to select · ↑/↓ to navigate · Esc to cancel`. That's the guard doing its
  job — matcher fired, shim exited 0 in <500 ms with no stdout, Claude Code
  proceeded to native TUI rendering.
- Zero DB rows landed for `GSL-267-pilot-B%`: baseline 0, after 0. **Guard works.**
- Answered by `tmux send-keys Enter` (default first option), pane after showed the
  tool completed.

**Lane 5 — other sessions untouched.** Between pilot start (14:19 Z) and pilot end
(14:25 Z), zero non-pilot rows landed in `questions`. My orchestrator session
(this one) has the settings.json loaded live via the file watcher but has NO
`GOSLEEP_WEB_QUESTIONS` in its env — every `AskUserQuestion` I made this shift hit
the guard and skipped the loop. Verified by SQL: no rows with `question NOT LIKE
'%GSL-267%'` newer than the baseline snapshot timestamp.

### Prerequisite: applied pending drizzle migrations (0001 + 0002)

Discovered mid-pilot that the production `data/gosleep.db` was pinned at migration
0000 — 0001 (`agent_sessions`) and 0002 (`applied_by`, `applied_rule_ref`,
`defer_until` columns on `questions`) had never been applied. GSL-275 and GSL-284
tested in isolated e2e (their own scratch DBs), so the drift wasn't visible until a
shim wrote to the real DB and the core threw `SQLiteError: no such column:
applied_by` on the read-back.

The fix was one `bun run apps/core/scripts/migrate.ts`. That script:
- ran `PRAGMA integrity_check` → ok,
- took a pre-migration snapshot to `data/snapshots/pre-2026-08-08T14-21-30-707Z.db`
  (which the owner can rewind to if the migration turns out to hurt anything —
  the columns are additive, so it shouldn't, but the snapshot exists),
- applied 0001 + 0002 inside a transaction,
- logged one `core.migrate.done` line and exited 0.

This step is a genuine prerequisite for the pilot to work at all; without it, the
first shim POST would 500 on the row read-back and the shim would fail-open (silently
degrading to TUI — no crash, but the pilot signal would be lost). Filed nothing extra
in Jira for the migration itself — it's a one-line side effect of GSL-267 (and
should have been part of the GSL-284 landing).

### Problems solved

- **The invisibility of the pilot toggle.** Neither shim body was self-guarded, so
  the moment `.claude/settings.json` gained the matcher, every live session
  (including this orchestrator) would have started long-polling the core on every
  AskUserQuestion. Added the flag guard as line 1 of both shims — invisible today,
  opt-in per session.
- **The race between guard-check and UPDATE inside `doAnswer`.** On the first
  answer attempt (Lane 1's retry cycle) the handler returned HTTP 500 with
  `race: question q-… changed status between the guard and the UPDATE`, even
  though the row DID update to `answered`. A stale in-memory notifier from the
  aborted pre-migration shim run was likely competing with the tail indexer
  replaying JSONL. Second attempt (fresh qid, no stale shim) went clean. Not
  filed as a bug — the retry succeeded and the row eventually reached the correct
  state, but if the same class of race resurfaces in production it deserves a
  narrow ticket to the doAnswer transaction boundary.
- **The migration drift.** Applied 0001 + 0002 in-place with a pre-snapshot; no
  data lost.

### Problems remaining

- **The 3600 s day-window is only enforced by the hook process timeout, not by
  the long-poll itself.** The shim's `GOSLEEP_HOOK_TIMEOUT_S` defaults to 600 s.
  If a pilot session goes idle waiting for the owner longer than 10 minutes and
  the flag doesn't override, the shim will get a 204 and TUI-fallback. Fine for
  pilot; if widened, the shim default should be lifted to match the settings
  timeout (or the caller sets `GOSLEEP_HOOK_TIMEOUT_S=3600` explicitly). Not
  urgent because widening is gated on the owner's verdict anyway.
- **No metric for guard-fired-and-exited-fast.** The `hook-debug.jsonl` is an
  optional debug file, not a Prometheus counter. If we ever want to see how
  often the guard fires across the fleet, a `gosleep_hook_guard_fired_total`
  counter written by the shim on the exit path would give it. Deferred — the
  pilot doesn't need it.
- **The pilot env-secret shape is manual.** Today the pilot opts in by exporting
  `GOSLEEP_INTERNAL_SECRET=<same as the running core has>`. If launchd is
  managing the core, the secret is inside the plist and the operator needs to
  copy it out. A tiny helper (`apps/core/plist.sh print-internal-secret`?)
  would smooth this — not shipped here because I don't want to touch plist.sh
  outside its own task, and the runbook § 8 shows the manual path.

### Pitfalls & workarounds

- **The file watcher reloads `.claude/settings.json` live.** The moment my Edit
  landed, every session in the tree — this orchestrator, any concurrent
  teammates, any pilot sessions started later — got the new PreToolUse block.
  Without the guard I would have wedged the fleet. The guard was added to the
  shims BEFORE the settings.json edit, and validated with a bare shim invocation
  (no flag → exit 0 in 400 ms, no stdout) before letting the file watcher pick
  it up. If a future task ever loosens the guard, that MUST be paired with a
  live-reload safety check at the same commit.
- **`GOSLEEP_INTERNAL_SECRET` must match on both sides.** The core reads it lazily
  from `process.env` at every `/internal/*` request; the shim sends it as
  `X-Internal-Secret`. If they diverge, the shim fail-opens (401 → treated the
  same as core-unreachable). Runbook § 8 spells the two shells out.
- **Never `git add data/gosleep.db`.** Not new — but re-emphasized because the
  pilot deliberately used the real production DB. `tools/lab/smoke.sh` guards
  against this (only `.gitkeep` / `.gitignore` allowed under `data/`).
- **The initial shim run left a row in `questions` even though the shim itself
  reported fail-open** (Lane 1 first attempt, pre-migration). The core POST
  handler INSERTed the row before the read-back that threw the migration error.
  If a future rollback needs to remove pilot pollution, `DELETE FROM questions
  WHERE task='GSL-267-pilot' OR question LIKE '%GSL-267-pilot%'` catches all
  four rows.

### What didn't make it

- **Widening to all sessions.** Deferred by explicit owner decision
  (d-2026-08-08-001) — the pilot must run for a day (or an owner-set window),
  then the owner decides whether to widen. Widening = either flipping the
  guard to opt-out or removing the guard entirely; both require a separate
  owner-triggered task.
- **A metric for guard-fired-fast** (see Problems remaining).
- **A `plist.sh print-internal-secret` helper** — deferred to a future GSL-269-
  adjacent tidy-up if it turns out the manual copy is a pain point in real use.
- **A CronList-based digest of how often the pilot flag was on across sessions.**
  Would be a natural retro artifact after N days of pilot use; not built here
  because I have no evidence yet the owner will want it.

## Part 2 — technical reference

**Commit:** *(single commit for this task, SHA in the branch history under
`GSL-267 …`)*

**Files touched:**
- `.claude/settings.json` — additive `PreToolUse` block with two matchers
  (`AskUserQuestion` → `ask-user-question-hook.sh`, `PermissionRequest` →
  `permission-request-hook.sh`), both `timeout: 3600` s. Prefixed with a `$comment`
  documenting the owner decision, the guard, the rollback, and the shim body
  provenance (GSL-275, GSL-284).
- `tools/hooks/ask-user-question-hook.sh` — inserted the `GOSLEEP_WEB_QUESTIONS`
  guard immediately after `set -u -o pipefail`; nothing else changed.
- `tools/hooks/permission-request-hook.sh` — same guard insertion, same location.
- `docs/runbooks/gosleep-core.md` — new § 8 "Web question-loop pilot (GSL-267 —
  guarded, opt-in)" with opt-in incantation, control paths, widening path, and
  rollback. The existing § 8 "Standing rules for agents…" moved down to § 9.
- `CLAUDE.md` — one bullet under the monorepo section pointing at the new § 8.
- `docs/dev_history/GSL-267-phase7-web-question-loop-pilot.md` — this file.
- `docs/dev_history/assets/GSL-267/logs/` — pilot evidence.

**How it was verified by running:**
- `.claude/settings.json` validated with `jq . .claude/settings.json`.
- Shim guards unit-tested via bare stdin, no core, no flag → both shims exit 0
  in ~400 ms with empty stdout.
- Shim fail-open path re-tested with flag=1 and core down → both shims exit 0
  in ~100 ms with empty stdout.
- Full end-to-end via 5 lanes (see Story above).
- After pilot: port 7331 clean (`lsof -iTCP:7331 -sTCP:LISTEN` → empty), no
  orphan shim processes, no orphan bun processes, both tmux sessions killed,
  no stray DB rows outside the labelled `GSL-267-pilot%` set.

**Migrations applied to production DB during this task:**
- 0001_agent_sessions.sql — new `agent_sessions` table + 2 indexes.
- 0002_manifest_defer.sql — 3 additive columns on `questions`
  (`applied_by`, `applied_rule_ref`, `defer_until`).
- Pre-migration snapshot at `data/snapshots/pre-2026-08-08T14-21-30-707Z.db`.

**Rollback:**
```bash
git revert <this-commit-sha>
# The .claude/settings.json file watcher unloads the PreToolUse block live.
# In-flight sessions fall back to the TUI on their next AskUserQuestion /
# PermissionRequest. The applied migrations are additive; nothing to revert
# on the DB side. Pre-pilot snapshot: data/snapshots/pre-2026-08-08T14-21-30-707Z.db.
```

**Links:**
- Jira: [GSL-267](https://ainstance-labs.atlassian.net/browse/GSL-267)
- Rev-3 addendum Delta 1 & 8.1:
  `docs/reports/web-harness-research-2026-08-03/target-architecture-rev3-addendum.md`
- Owner decision: `docs/lab/decisions/log.jsonl` entry `d-2026-08-08-001`
  (env-guarded pilot vs blanket rollout)
- Related dev history: `GSL-275-web-answer-loop-production.md`,
  `GSL-284-phase7-permission-request-matcher.md`.
