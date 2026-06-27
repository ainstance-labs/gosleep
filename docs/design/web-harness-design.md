# Live observability harness — design notes (web vs console) — DRAFT

Captures the consultation. Decision deferred; this records the recommended direction.

## Goal
Watch a run live in a browser: the fleet of agents, their statuses, tool calls, inter-agent messages, and
what's happening in Jira/GitHub — for a "professional harness" feel.

## Core principle
Build on the **event stream** (`event-schema.md`), not on the UI. Producers emit events; the UI is just a
consumer. This keeps TUI/web/replay/tests/audit all hanging off one source.

## Options
| Option | Pros | Cons |
|---|---|---|
| **tmux panes (today)** | free, live, zero infra | no graphs, hard to share/remote, raw |
| **TUI dashboard** (Textual / Ink / Bubble Tea) | runs where agents run, no server | caps out on graphs, sharing, remote |
| **Web app** | rich fleet graph + timeline + message feed + Jira panel, shareable/remote | needs a server + event plumbing |

## Recommended direction
- **Web**, built on the event log, with **tmux panes kept as the raw live view**.
- Stack: **Next.js (App Router)** — matches the team's existing TS/Next stack. Route Handler to ingest
  events; an **SSE** endpoint to push to the browser; React UI.
- Views: fleet/tree (React Flow / d3 / Mermaid), cycle timeline (Gantt), live message feed, per-agent
  drill-down (tool calls, task, tokens), Jira/GitHub panel (API/webhooks).
- Persist events (JSONL → SQLite/Postgres) for **replay** and audit.
- For a true product, consider building the orchestration loop itself on the **Claude Agent SDK
  (TypeScript)** so event emission is first-class (verify SDK specifics at build time).

## Sequencing
1. Lock the event schema; make the current orchestrator/workers emit events (hooks + log writes).
2. Thin viewer (even `tail -f` / a minimal SSE page) to validate the stream.
3. Build out the web UI views.
4. (Optional) Re-platform the loop onto the Agent SDK for clean, programmatic observability + control.
