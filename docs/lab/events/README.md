# `docs/lab/events/` — the timeline (T1)

One line per event, append-only, one file per UTC day. Written by `tools/lab/lab-log.sh` — the **only**
writer. Do not hand-append: `seq` is allocated under a lock, and a hand-written line has none.

Producers, and what each one's provenance is worth:

| `src` | Producer | Means |
|---|---|---|
| `hook:*` | Claude Code hooks (`.claude/settings.json`) | **Observed** as it happened. 0 tokens, no model cooperation. |
| `emit` | `tools/lab/lab-emit.sh event` | **Stated** by an agent — meaning a hook cannot see. |
| `poll-fill` | `tools/lab/poll-fill.sh` (GSL-87) | **Inferred afterwards** from `git` / `gh` / Jira, because no hook saw it: a PR merged from the web, an issue dragged on a phone, a commit the hooks dropped. `ts` = when we learned it; `data.occurred_at` = when it happened. |

All three are true. They are not the same *kind* of true, so they never share a tag.

## Envelope

```json
{"ts":"2026-07-12T20:36:39Z","run_id":"2026-07-12","seq":2,"actor":"781cfb8b",
 "type":"vcs.commit","src":"hook:PostToolUse",
 "data":{"cmd":"git -C /repo commit -m 'GSL-83 …'","sha":"3c2563c"},
 "session_id":"781cfb8b-…","agent_id":"impl-lab-1","agent_type":"claude","cwd":"/repo"}
```

| Field | Meaning |
|---|---|
| `ts` | ISO-8601 UTC, second resolution. |
| `run_id` | `$GOSLEEP_RUN_ID`, else the UTC date. One orchestration run = one night = one daily file. |
| `seq` | Monotonic **within the file**. Allocated under a lock by reading the tail — no sidecar counter to drift. Not globally unique (see README §"What is committed"). |
| `actor` | Who did it: `agent_id` → `agent_type` → short `session_id`. `$GOSLEEP_ACTOR` overrides. |
| `type` | See the vocabulary below. |
| `src` | **Provenance.** `hook:<HookEventName>` = mechanical, 0 tokens, no model cooperation (this is how F4-S1 is *proved*, not asserted). `emit` = an agent stated it. `poll-fill` = reconciled after the fact from `gh`/Jira/`git`. |
| `data` | Type-specific. Strings clamped to 500 chars — an event is a pointer, not an archive. |
| `session_id`, `agent_id`, `agent_type`, `cwd` | Attribution, straight from the hook payload. Present only when the hook supplied them. Per-worker attribution **with zero model cooperation**. |
| `task` | Optional Jira key (semantic emits). |
| `supersedes` | Optional. A correction points at the `seq` it replaces — the log is never rewritten. |

## Vocabulary

**Mechanical (`src=hook:*`)** — written by hooks, cost nothing, need nobody's cooperation:

| Type | Hook | Note |
|---|---|---|
| `pane.started` / `pane.ended` | `SessionStart` / `SessionEnd` | ✅ verified by a real run |
| `agent.spawned` / `agent.terminated` | `SubagentStart` / `SubagentStop` | |
| `agent.idle` | `TeammateIdle` | ⚠️ never observed yet — see below |
| `agent.turn_ended` | `Stop` | ✅ verified by a real run |
| `vcs.commit` / `vcs.push` / `vcs.pr.opened` / `vcs.pr.merged` | `PostToolUse` (Bash) | ✅ verified — the logged sha matched the commit git actually made |
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
| `TeammateIdle` → `agent.idle` | ✅ **fires** | one line, 2026-07-12. The PRD's "never tested / most likely to disappoint" turned out to work. |
| `TaskCreated` / `TaskCompleted` | ✅ **fire** | `task.created`, `task.completed` — both present. |
| `StopFailure`, `PreCompact`/`PostCompact`, `Notification`, `SubagentStart/Stop` | still unobserved | nothing can force them: they need a real rate-limit, a real compaction, a real idle subagent. |

**And one hook that fires but LIES BY OMISSION — the reason GSL-87 exists.** `PostToolUse` on
`git commit` missed a real commit (`3f52736`, GSL-86): its message was passed as a heredoc inside a
command substitution, and the parser lost the `git commit` inside it. A second commit was logged with
an **empty** `sha`. Both are worse than a missing hook, because the log *looks* complete.

Two consequences, both live:

- **`vcs.commit` from a hook is necessary but not sufficient.** `poll-fill` (below) reconciles
  `git log` against the timeline every chronicler pass and backfills what the hook dropped. Both of
  the commits above were recovered that way, tagged `src="poll-fill"`.
- **`tracker.issue.transitioned` from a hook carries no destination** — the MCP payload has a
  transition *id*, not a status name, so `data.transition` is empty. It witnesses THAT an issue moved,
  never WHERE to. poll-fill supplies the state separately as `tracker.issue.updated`.

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
