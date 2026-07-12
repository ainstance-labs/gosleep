# docs/lab — the machine-first laboratory layer

Everything the orchestration chain writes for itself and for the owner. Phase 3 (epic GSL-72) gave it
questions, decisions and digests — things an agent *states*. Phase 4 (epic GSL-81) added the half no
agent has to cooperate with: an **event log written by hooks**, and the derived surfaces a chronicler
regenerates from it. Blueprint: `docs/research/2026-07-07-orchestration/05-lab-ui-mobile-autonomy.md`
§3.3; contract: PRD Phase 4, R4.1–R4.4.

## Layout

```
docs/lab/
  events/YYYY-MM-DD.jsonl   # T1 — the timeline. Hooks + explicit emits. Append-only, daily. (GSL-83)
  events/README.md          #      the envelope + the type vocabulary — read this before consuming
  questions/queue.jsonl     # typed question buffer — append-only + patch records (GSL-75)
  questions/archive.jsonl   # answered/expired, moved by the chronicler                (GSL-86)
  decisions/manifest.md     # owner-sovereign — the ONLY hand-edited file here         (GSL-76)
  decisions/log.jsonl       # every autonomous decision / owner answer, append-only    (GSL-77)
  digest/YYYY-MM-DD-morning.md  # the morning digest — regenerated, not written        (GSL-86)
  status.json               # derived snapshot: events + STATE at the last pass        (GSL-86)
  telemetry.jsonl           # per-cycle token/cost lines (STATE TELEMETRY grammar)
  site/index.html           # derived static dashboard — never hand-edited             (GSL-86)
  site/timeline.html        #   …the full timeline + provenance tallies
  site/library.html         #   …the Library index: digests, handoffs, dev_history, decisions
  scratch/                  # GITIGNORED: temps, partials, hook traces, drop counters
```

## The chronicler — the only thing that writes T3

```bash
tools/lab/chronicler.sh                  # regenerate status.json + site/ + today's digest
tools/lab/chronicler.sh --narrate        # …+ one bounded claude -p paragraph of prose
tools/lab/chronicler.sh --dry-run --json # …plan only; print what it would write
```

It is a **bounded job, not the fourth live agent** (C5): no pane, no spawn slot, it runs at a cycle
boundary / on demand and exits. Everything it builds is built by deterministic code from files on
disk; `claude -p` is opt-in glue for one prose paragraph, under `--max-budget-usd` with an empty
`--allowedTools` (C3, F4-S4). **Kill it and the laboratory is unharmed** — the artifacts age, they do
not corrupt (`lab-write.sh` is atomic) and they do not lie (see staleness, below). Delivery never
waits for it (F4-S3).

Sources it reads, and what it does when one is missing: events, queue (folded by `lab-emit`, never
re-folded here), decisions, `git`, `gh`, the orchestrator heartbeat, and `ORCHESTRATION-STATE.md`.
Any of them can be absent — the pass still completes, and the gap is **named** in `status.json`
(`degraded[]`), on the page, and in the digest. "Section 5 is empty" and "section 5 could not be read"
look identical to a sleeping owner; they are not the same thing.

## Staleness — the contract every derived page signs

`status.json`, all three pages, and the digest carry `generated_at` + max event age and grade
themselves:

| Grade | Age of the newest event | What it says |
|---|---|---|
| `fresh` | ≤ 30 min | the laboratory is writing itself right now |
| `stale` | ≤ 3 h | delivery may still be running; **this page is not** |
| `dead` | > 3 h | do not trust anything below without checking git |

Thresholds: `GOSLEEP_FRESH_S` / `GOSLEEP_DEAD_S`. This is the whole reason a page can be trusted at
07:00 without opening a terminal: **a dead page looks dead.** A stale hub that hides its staleness is
worse than no hub — that is the tasty-lunch wiki, and it is what killed the last one.

## Three tiers — and how to tell them apart at a glance

| Tier | Producer | Costs | Trust |
|---|---|---|---|
| **T1 — events** | Claude Code hooks → `tools/lab/lab-log.sh` | **0 tokens** | Mechanical. Fires whether or not the model cooperates — an agent that lies, forgets, hangs or is killed still leaves the line. |
| **T2 — narrative** | agents by convention: handoffs, dev_history, reviews | already paid | Behavioural. As good as the agent. |
| **T3 — synthesis** | the chronicler: `status.json`, `site/`, digest, indexes | budgeted | Derived. Regenerated only — **never hand-edited**, or it rots (the tasty-lunch wiki lesson). |

Every event line carries `src`, so the tier is not a claim, it is **queryable**:

```bash
jq -r 'select(.src | startswith("hook:")) | .type' docs/lab/events/2026-07-12.jsonl   # 0-token half
jq -r 'select(.src == "emit")            | .type' docs/lab/events/2026-07-12.jsonl   # agent-stated half
jq -r 'select(.src == "poll-fill")       | .type' docs/lab/events/2026-07-12.jsonl   # reconciled after the fact
```

## Write discipline — two rules, two tools, no exceptions

| Kind | Tool | Rule |
|---|---|---|
| append-only JSONL (`events/`, `queue.jsonl`, `log.jsonl`) | `tools/lab/lab-log.sh`, `tools/lab/lab-emit.sh` | **Never rewritten.** A correction is a NEW record (`{"re": <id>, …}` patch, or `supersedes: <seq>`). History is not edited, it is appended to. (C8) |
| whole-file artifacts (`status.json`, `site/`, digests) | `tools/lab/lab-write.sh` | **Atomic:** same-dir temp → fsync → `rename(2)`. A reader sees the entire old file or the entire new one, never a prefix. The chronicler runs under a budget cap and *can* be killed mid-write. |

A bare `>` redirect into `docs/lab/` is a bug. So is a hand-append to a JSONL while agents are live —
`seq` is allocated under a lock, and a hand-written line has no `seq` at all.

## What is committed, and what is not

Committed — including `events/*.jsonl`. This is the owner's phone-readable surface: he opens GitHub in
the morning and the night is *there*. Only `scratch/` is gitignored (temps, hook traces, drop counters:
disposable by definition).

Two consequences worth knowing before they surprise you:

- **The live event log is expected to be dirty between commits.** A commit's own `vcs.commit` event is
  written *after* the commit, by the hook. It is swept into git at the next ledger/chronicler boundary
  — exactly like `queue.jsonl`. A dirty `docs/lab/events/<today>.jsonl` is normal, not a mistake.
- **`seq` is unique per file, not globally.** If two branches ever append to the same day's file, a
  merge (`.gitattributes` sets `merge=union`, so it will not conflict) can interleave two independent
  seq runs. Consumers that need identity should key on the whole record, not on `seq` alone. Today one
  machine runs the fleet, so this stays theoretical; if that changes, put a machine id into `run_id`.

## Retention — what is memory, and what is just exhaust

| Path | Kept | Why |
|---|---|---|
| `events/*.jsonl` | 30 days (chronicler prunes older) | Raw, high-volume, and **reconstructible**: poll-fill (GSL-87) rebuilds missed events from `gh` / Jira / `git log`. Not precious. |
| `digest/`, `docs/dev_history/`, `docs/handoff/` | forever | This is the actual memory. The raw log is the source; the digest is what survives. |
| `decisions/log.jsonl` | forever | The learning loop mines it (`lab-emit candidates`): the same question decided the same way ×3 becomes a manifest proposal. Pruning it lobotomises that. |
| `questions/queue.jsonl` | forever (answered records move to `archive.jsonl`) | Small, and the audit trail of what was decided for the owner while he slept. |
| `status.json`, `site/` | regenerated every pass | Derived. Both carry `generated_at` + `max_event_age`: **a dead page must look dead.** A stale hub that hides its staleness is worse than no hub. |
| `scratch/` | disposable | Gitignored. Delete at will. |

## Authority

`ORCHESTRATION-STATE.md` + live git **win on conflict** (C8). `status.json` is derived and may lag;
`decisions/manifest.md` is owner-sovereign — agents read it and may *propose* edits in the digest, but
never write it themselves.
