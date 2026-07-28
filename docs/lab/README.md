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

### Rebuild discipline — the derivatives ship with the tree that made them (GSL-150)

The committed derivatives (`site/*.html`, `mobile/README.md`, `render_bundle.json`,
`status.json`) describe the checkout **at the instant of the pass** — branch name, HEAD, file
counts. Run 02 caught the failure mode this invites: a wave rebuilt its pages, then three more
documentation commits landed **without** a regeneration, and the merge carried derivatives into
`main` that named the *previous* branch as the current checkout and undercounted `dev_history` by
the three files written after the pass. Every page honestly carried `generated_at`, but the error
ran in the reassuring direction — which is this laboratory's named anti-goal.

The rule, so nobody rediscovers it per wave:

- **The regeneration is the LAST commit of a wave.** Write every source the pass indexes first —
  dev_history, README indexes, reports — then run `tools/lab/chronicler.sh` and commit all
  derivatives together as the branch's final commit.
- **No commit after the rebuild.** If anything touching `docs/**` or the view sources must land
  after it, the rebuild moves: re-run the chronicler and let the regeneration ride that commit.
- **After the merge, the derivatives still describe the branch tip** (a merge commit adds history
  the pass never saw, and the Delivery card names the branch it ran on). That residue is healed by
  the next routine chronicler pass on `main` — run one after merging if the Delivery card matters
  right now.
- **Never commit a bundle whose `grade != fresh` silently (GSL-194; audit finding 23).** The commit
  that carries `render_bundle.json` is made KNOWING the grade: read it first —
  `jq -r .staleness.grade docs/lab/render_bundle.json` — and if it is not `fresh`, either re-run
  the pass (the usual cause is committing yesterday's build instead of rebuilding) or say out
  loud, in the commit message and the handoff, that a non-fresh bundle is being committed and why.
  Finding 23 caught `main` carrying a bundle that declared itself DEAD at the instant of its own
  commit while a fresher build sat uncommitted in the working tree — the exact silent version of
  this. A non-fresh grade at shift close is a blocker to resolve, not a footnote.

## Staleness — the contract every derived artifact signs (F4-S3)

This is the whole reason a page can be trusted at 07:00 without opening a terminal: **a dead page looks
dead.** A stale hub that hides its staleness is worse than no hub — that is the tasty-lunch wiki, and it
is what killed the last one. So the rule is written down here as a **contract**, not left as a detail of
how the chronicler happens to work, and every future consumer signs it: Phase 5's UI, Phase 6's
notifications, anything at all that renders something out of `docs/lab/`. **If you show the data, you
show its grade.**

### What every artifact carries

| Field | Where | Means |
|---|---|---|
| `generated_at` | `status.json` · all 3 pages · the digest | UTC instant of the pass that produced this artifact. Its own age — `now − generated_at` — is the **reader's** business. |
| `staleness.max_event_age_s` (+ `…_human`) | same | how old the NEWEST event in the log was at that instant. The age of the **data**, not of the page. |
| `staleness.grade` | same | `fresh` / `stale` / `dead` — the verdict computed from that age. |
| `staleness.thresholds_s` | `status.json` | the thresholds this pass actually used, so a reader never has to guess which build made the call. |

### The grades

| Grade | Age of the newest event | What it tells the owner | Threshold |
|---|---|---|---|
| `fresh` | ≤ 30 min | the laboratory is writing itself right now | `GOSLEEP_FRESH_S=1800` |
| `stale` | ≤ 3 h | delivery may still be running; **this page is not** | — |
| `dead` | > 3 h | do not trust anything below without checking `git` | `GOSLEEP_DEAD_S=10800` |

It shows up in `status.json` (`staleness{}`), as a coloured banner at the top of **all three** pages,
and in the header of the morning digest. Nothing renders without it — that is what "contract" means.

### The part that is easy to get wrong: there are TWO ages, not one

The grade judges the **data** (`max_event_age`). It does not judge the **page**. A static file cannot
age itself — kill the chronicler at 02:00 while everything is fresh and the HTML on disk still reads
`fresh` at 07:00. Its verdict was true *when it was written*, and the file has no way to notice that
five hours went by. A page that says "Live" over a corpse is precisely the failure this phase exists to
prevent, and it hides inside an artifact that looks like it is doing its job.

Two answers, one per artifact:

- **The pages re-grade themselves when you open them** (GSL-89). From `generated_at` plus the event age
  baked in, the banner recomputes the true age and re-renders the verdict. It can only ever make the
  verdict **worse** — time moves one way, so a re-grade never softens one. With JavaScript off, the
  build-time verdict simply stands (the old behaviour, never a worse one). Nothing is fetched: the page
  stays `file://`-safe on a plane.
- **`status.json` has no script to run, so the reader owes it the arithmetic:** add `now − generated_at`
  to `max_event_age_s` *before* trusting `grade`. A consumer that renders `grade` without looking at
  `generated_at` will, sooner or later, show a corpse as alive. Stated once here so that nobody has to
  rediscover it at 07:00.

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
| append-only JSONL (`events/`, `queue.jsonl`, `log.jsonl`) | `tools/lab/lab-log.sh`, `tools/lab/lab-emit.sh` | **Never rewritten.** A correction is a NEW record: a `{"re": <id>, …}` patch in the queue, or `supersedes` in the timeline. History is not edited, it is appended to. (C8) |
| a correction that crosses a day | `lab-log.sh --supersedes` | `seq` is unique **per file**, so a reference carries the file when it crosses a day: `42` = seq 42 in this event's own day file; `2026-07-12:42` = seq 42 in *that* day's file. Written bare, a cross-day correction would retire whichever innocent line holds seq 42 today. poll-fill fixes last night's log this morning, so cross-day is the normal case. |
| an event that happened before it was logged | `lab-log.sh --ts` | Back-dates the **event**, never the **file**: the line still lands in today's log, carrying `ts` = when it happened and `logged_at` = when we learned it. Consumers sort by `ts` across all days, so it takes its true place without reopening a day that git already holds (and retention may have pruned). |
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
