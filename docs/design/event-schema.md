# Event schema (foundation for live observability) — DRAFT

The single architectural decision that makes any UI (TUI or web) possible: **emit a stable, append-only
stream of structured events; decouple producers (agents) from consumers (UI/tests/audit) via that stream.**
One event log gives you: live view, run replay, audit trail, AND test fixtures.

## Transport / storage
- Producers append JSONL events to a per-run log (`runs/<run-id>/events.jsonl`); later: SQLite/Postgres.
- A small server tails the log and pushes to clients via **SSE** (one-way live) or **WebSocket** (if the
  UI also controls the run — pause/kill).

## Event envelope (proposed)
```json
{ "ts": "<iso8601>", "run_id": "...", "seq": 123, "actor": "orchestrator|<cycle-name>|judge",
  "type": "<event type>", "data": { ... } }
```

## Event types (initial)
- `run.started` / `run.finished` — { goal, budget }
- `cycle.started` / `cycle.ended` — { cycle, worker, branch, status }
- `agent.spawned` / `agent.idle` / `agent.terminated` — { name, surface (pane|background), id }
- `agent.message` — { from, to, kind (report|nudge|progress|shutdown), summary }
- `tool.call` — { actor, tool, args_summary } (from PreToolUse/PostToolUse hooks or SDK tool events)
- `handoff.written` — { path, cycle }
- `tracker.issue.created` / `tracker.issue.transitioned` — { key, summary, status }
- `vcs.commit` / `vcs.pr.opened` / `vcs.pr.merged` — { sha|pr, branch }
- `orchestrator.state` — snapshot of ORCHESTRATION-STATE.md LIVE-STATUS

## Where events come from (to verify at build time)
- Inside Claude Code: hooks (PreToolUse/PostToolUse/SessionStart/Stop) + explicit log writes by
  orchestrator/workers; workflow task telemetry.
- Custom harness: the Claude Agent SDK (own the loop → emit directly).

(Verify exact hook/SDK capabilities against current docs when implementing — do not assume from memory.)
