# `docs/lab/events/` — the timeline (T1)

One line per event, append-only, one file per UTC day. Written by `tools/lab/lab-log.sh` — the **only**
writer. Do not hand-append: `seq` is allocated under a lock, and a hand-written line has none.

Producers: Claude Code hooks (`.claude/settings.json`, 0 tokens), explicit semantic emits
(`tools/lab/lab-emit.sh event`), and — from GSL-87 — poll-fill reconciliation.

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

## Honest verification status (GSL-83)

Verified against a **real** Claude Code process (`tools/lab/hooks-verify.sh`, 13/13):
`SessionStart`, `Stop`, `SessionEnd`, `PostToolUse` (a real commit; the logged sha matched).

Wired, payload-mapping unit-tested, **but never yet seen to fire** — nothing can force them on demand:
`StopFailure` (needs a real rate-limit), `PreCompact`/`PostCompact` (needs a real compaction),
`Notification`, `TeammateIdle`, `SubagentStart/Stop`, `TaskCreated/Completed`.

**`TeammateIdle` is the one to distrust** — the PRD flags it as never tested. To settle any of them,
just look after a night of fleet work:

```bash
jq -r .type docs/lab/events/*.jsonl | sort | uniq -c | sort -rn
```

If `agent.idle` never appears, it does not fire on this version — replace it with a pulse-side poll
and say so here. **A hook that silently logs nothing is worse than no hook**, so this file must be
kept honest: if you learn something new about what fires, edit the table above.

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
