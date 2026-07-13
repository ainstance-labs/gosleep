# `docs/lab/events/` — the timeline (T1)

One line per event, append-only, one file per UTC day. Written by `tools/lab/lab-log.sh` — the **only**
writer. Do not hand-append: `seq` is allocated under a lock, and a hand-written line has none.

Producers, and what each one's provenance is worth:

| `src` | Producer | Means |
|---|---|---|
| `hook:*` | Claude Code hooks (`.claude/settings.json`) | **Observed** as it happened. 0 tokens, no model cooperation. |
| `emit` | `tools/lab/lab-emit.sh event` | **Stated** by an agent — meaning a hook cannot see. |
| `poll-fill` | `tools/lab/poll-fill.sh` (GSL-87) | **Inferred afterwards** from `git` / `gh` / Jira, because no hook saw it: a PR merged from the web, an issue dragged on a phone, a commit the hooks dropped. `ts` = when it **happened** (back-dated, GSL-89); `logged_at` = when we **learned** it. |

All three are true. They are not the same *kind* of true, so they never share a tag.

## Envelope

```json
{"ts":"2026-07-12T20:36:39Z","run_id":"2026-07-12","seq":2,"actor":"781cfb8b",
 "type":"vcs.commit","src":"hook:PostToolUse",
 "data":{"cmd":"git -C /repo commit -m 'GSL-83 …'","sha":"3c2563c"},
 "session_id":"781cfb8b-…","agent_id":"impl-lab-1","agent_type":"claude","cwd":"/repo"}
```

A reconciled line adds the two fields that only hindsight has — when it *really* happened, and which
earlier line it retires:

```json
{"ts":"2026-07-12T21:26:18Z","logged_at":"2026-07-13T05:34:31Z","run_id":"2026-07-13","seq":7,
 "actor":"poll-fill","type":"vcs.commit","src":"poll-fill","supersedes":"2026-07-12:4",
 "data":{"sha":"3f52736","subject":"GSL-86 …","occurred_at":"2026-07-12T23:26:18+02:00","source":"git"}}
```

| Field | Meaning |
|---|---|
| `ts` | ISO-8601 UTC, second resolution. **When the event happened.** Written as `now` unless `lab-log --ts` back-dates it. Consumers sort the timeline lexically on this, so it is always normalized to UTC — an offset left in place would sort hours away from where it belongs. |
| `logged_at` | Present **only** when `ts` was back-dated: when the line was actually written. `ts` says when it happened, `logged_at` says when we found out, and the gap between them is the honest measure of how blind the hooks were that night. Collapse them and the log can no longer tell observation from hindsight. |
| `run_id` | `$GOSLEEP_RUN_ID`, else the UTC date. One orchestration run = one night = one daily file. |
| `seq` | Monotonic **within the file**. Allocated under a lock by reading the tail — no sidecar counter to drift. Not globally unique (see README §"What is committed"). |
| `actor` | Who did it: `agent_id` → `agent_type` → short `session_id`. `$GOSLEEP_ACTOR` overrides. |
| `type` | See the vocabulary below. |
| `src` | **Provenance.** `hook:<HookEventName>` = mechanical, 0 tokens, no model cooperation (this is how F4-S1 is *proved*, not asserted). `emit` = an agent stated it. `poll-fill` = reconciled after the fact from `gh`/Jira/`git`. |
| `data` | Type-specific. Strings clamped to 500 chars — an event is a pointer, not an archive. |
| `session_id`, `agent_id`, `agent_type`, `cwd` | Attribution, straight from the hook payload. Present only when the hook supplied them. Per-worker attribution **with zero model cooperation**. |
| `task` | Optional Jira key (semantic emits). |
| `supersedes` | Optional. A correction **names the record it retires** — the log is never rewritten (C8). A reference is a *(file, seq)* coordinate, because `seq` is unique per file, not globally: `4` = seq 4 in this event's own day file; `"2026-07-12:4"` = seq 4 in **that** day's file. Written as a bare seq, a cross-day correction would retire whichever innocent line happens to hold seq 4 today. Consumers must **fold before they count** (`chronicler.fold_superseded`), or a corrected event is shown twice. |

## Vocabulary

**Mechanical (`src=hook:*`)** — written by hooks, cost nothing, need nobody's cooperation:

| Type | Hook | Note |
|---|---|---|
| `pane.started` / `pane.ended` | `SessionStart` / `SessionEnd` | ✅ verified by a real run |
| `agent.spawned` / `agent.terminated` | `SubagentStart` / `SubagentStop` | |
| `agent.idle` | `TeammateIdle` | ⚠️ never observed yet — see below |
| `agent.turn_ended` | `Stop` | ✅ verified by a real run |
| `vcs.commit` / `vcs.push` / `vcs.pr.opened` / `vcs.pr.merged` | `PostToolUse` (Bash) | ✅ verified — a logged sha matched the commit git actually made. ⚠️ but an **empty** `sha` may have no commit behind it at all: the hook fires on the command, not on its success (see below) |
| `tracker.issue.created` / `.transitioned` / `.updated` | `PostToolUse` (`mcp__atlassian__*`, `gh issue create`) | |
| `handoff.written` / `dev_history.written` | `PostToolUse` (Write/Edit under `docs/handoff/`, `docs/dev_history/`) | ✅ verified |
| `api.failure` | `StopFailure` | `data.error_type` = `rate_limit\|overloaded\|server_error\|…` — **this is the quota-window detector Phase 2 wanted, for free.** |
| `context.pre_compact` / `context.post_compact` | `PreCompact` / `PostCompact` | A compaction on the orchestrator is a red flag. |
| `task.created` / `task.completed` | `TaskCreated` / `TaskCompleted` | |
| `notification.raised` | `Notification` | |
| `hook.unmapped` | any unknown hook | A new Claude Code event surfaces as a visible unknown rather than vanishing. |

**Semantic (`src=emit`)** — what a hook cannot see, because it is meaning, not mechanics:

`run.started|finished` · `cycle.started|ended` · `question.posed|answered|auto_resolved|deduped` ·
`decision.made` · `verify.verdict` · `handoff.written` · `agent.message` · `mode.entered` ·
`quota.wait_started|wait_ended` · `breaker.opened|closed` · `restart.recorded`

Emit with `tools/lab/lab-emit.sh event --type <T> …`. The type is validated against this closed list:
a typo'd type is a line no consumer will ever read — silently useless — so it is an error, not a new
type. The Phase-3 queue mirrors itself here automatically (`question.*`, `decision.made`).

## Honest verification status — updated 2026-07-12 (GSL-83 → GSL-87)

Verified against a **real** Claude Code process (`tools/lab/hooks-verify.sh`, 13/13):
`SessionStart`, `Stop`, `SessionEnd`, `PostToolUse` (a real commit; the logged sha matched).

**Settled by a night of actual fleet work, exactly as this section predicted it would be** (cycle 46
read the log instead of arguing about the docs):

| Hook | Verdict | Evidence |
|---|---|---|
| `TeammateIdle` → `agent.idle` | ✅ **fires** | 2 lines. The PRD's "never tested / most likely to disappoint" turned out to work. |
| `TaskCreated` / `TaskCompleted` | ✅ **fire** | `task.created`, `task.completed` — both present. |
| `SubagentStop` → `agent.terminated` | ✅ **fires** | 2 lines (settled in cycle 47, again by reading the log rather than the docs). |
| `Notification` → `notification.raised` | ✅ **fires** | 3 lines. |
| `SubagentStart` → `agent.spawned` | ❌ **wired, never fired** | zero lines — while its `Stop` twin has two. The pair is asymmetric; do not sit waiting for `agent.spawned`. Worker spawn is in the log anyway: a teammate IS a session, so it arrives as `pane.started` (4 lines, one per cycle). |
| `StopFailure` → `api.failure`; `PreCompact` / `PostCompact` → `context.*` | still unobserved | nothing can force them — they need a real rate-limit and a real compaction. All 13 hooks **are** wired in `.claude/settings.json`, so an absence here means the hook never fired, not that nobody asked it to. |

**And one hook that fires but LIES BY OMISSION — the reason GSL-87 exists.** `PostToolUse` on
`git commit` missed a real commit (`3f52736`, GSL-86): its message was passed as a heredoc inside a
command substitution, and the parser lost the `git commit` inside it. `9a056bb` (GSL-82) never reached
the log either. Both were recovered by poll-fill. A missing line is bad because the log *looks* complete.

**And one line that is worse than missing — it ASSERTS something that never happened** (2026-07-12,
`seq` 4; found in cycle 47, still in the log). It is a `vcs.commit` with an **empty `sha`**, and there
is no commit behind it at all: `git` holds nothing in that minute, and the message it carries (GSL-83)
was committed 2.4 minutes later as `2e33632`, by a different command, logged separately at `seq` 6.
The hook fires on the **command, not on its success** — `bash_event()` never looks at the exit status,
so a `git commit` that fails still leaves a line claiming a commit happened.

> Correcting the record: the GSL-87 dev_history reads this line as "`9a056bb`, logged with an empty
> sha". That was wrong. `9a056bb` was never hook-logged at all (it arrives only as `src="poll-fill"`,
> `seq` 41), and the empty-sha line is a **phantom**, not a sha-less commit. Verified against `git log`
> and the log itself, not from memory.

Three consequences, all live:

- **`vcs.commit` from a hook is necessary but not sufficient.** `poll-fill` (below) reconciles
  `git log` against the timeline every chronicler pass and backfills what the hook dropped, tagged
  `src="poll-fill"`.
- **An empty `sha` must NEVER be "repaired" into a commit.** It does not mean "a commit whose sha we
  lost"; it can mean *no commit happened*. poll-fill therefore refuses to bind a sha-less line to a
  nearby commit, however well the timestamps line up: guessing would launder a phantom into an
  authoritative record, and an authoritative lie is the one failure this layer cannot survive. The
  line is left standing as what it is — evidence that a commit was **attempted**. (`--supersedes`
  exists for corrections whose identity is *proven*. Here there is no proof.)
- **`tracker.issue.transitioned` from a hook carries no destination** — the MCP payload has a
  transition *id*, not a status name, so `data.transition` is empty. It witnesses THAT an issue moved,
  never WHERE to. poll-fill supplies the state separately as `tracker.issue.updated`.

A related, harmless twin worth knowing before it confuses you: `1da14bf` is in the log with a valid sha
and a real git object — but it is reachable from no branch (it was amended away; the surviving GSL-85
commit is `e9a1ccc`). Nothing is wrong here. **The timeline records attempts; `git` records outcomes.**
They are different questions, and the log is not required to agree with `git log --all`.

To re-settle any of this yourself — read the log, do not trust this table:

```bash
jq -r .type docs/lab/events/*.jsonl | sort | uniq -c | sort -rn      # what actually fires
jq -r 'select(.src=="poll-fill") | .type' docs/lab/events/*.jsonl    # what the hooks MISSED
```

That second query is the health check for the hook layer: **a growing poll-fill share means a hook is
rotting.** A hook that silently logs nothing — or logs a commit with no sha — is worse than no hook,
so keep this section honest: when you learn something new about what fires, edit the table.

## Debugging: "did the hook even run?"

A dropped event and a hook that never fired look identical here — both are absent. They differ in the
trace:

```bash
GOSLEEP_LAB_TRACE=1 …            # lab-log dumps every RAW hook payload to scratch/hook-trace.jsonl
jq -r '.hook' docs/lab/scratch/hook-trace.jsonl | sort | uniq -c
```

Errors never surface as a broken session (hooks are fail-open behind `tools/hooks/lab-log-hook.sh`);
they land in `.artifacts/lab/lab-log.err`. Check there when the log looks thin.

## Reading

```bash
jq -r '"\(.ts)  \(.actor)  \(.type)  \(.data.sha // .data.path // .data.key // "")"' 2026-07-12.jsonl
jq -s 'group_by(.type) | map({type: .[0].type, n: length})' 2026-07-12.jsonl
```
