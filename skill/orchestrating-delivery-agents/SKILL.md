---
name: orchestrating-delivery-agents
description: Use when delivery work — a roadmap, migration, or multi-epic feature — is too large for one agent's context; when you keep manually restarting an agent that ran out of context; when a human wants to watch and steer agents at boundaries; or when resuming / cold-starting a fresh orchestrator onto an already-in-progress agent chain after the previous orchestrator was compacted, crashed, or restarted — including when a mechanical watchdog has just re-woken you with a re-wake brief.
---

# Orchestrating Delivery Agents

## Overview

Long delivery jobs (a whole roadmap, a migration, a multi-epic feature) outlive any single agent's
context window. Instead of one agent that runs out of context and gets restarted by hand, you act as a
**pure orchestrator**: you never execute the work yourself — you spawn a sequence of fresh **worker
agents**, each doing one context-bounded chunk, and you chain them through **handoff files**.

**Core principle: the orchestrator stays lean and keeps its own state ON DISK, so it can outlive every
worker — and survive its own compaction or restart.** You relay handoff paths and compact reports; you
do not read heavy files (handoff bodies, source, agent transcripts). Workers hold the detail; a small
on-disk ledger holds the thread.

Three roles:
- **Orchestrator (you):** spawns workers, monitors them, chains cycles, decides forks, talks to the human, keeps the on-disk state file. Executes nothing.
- **Cycle-worker:** a fresh agent that does ONE chunk until ~75–80% of its context, then writes a handoff and reports. Disposable by design.
- **Handoff:** the memory baton between workers — a self-contained doc a fresh worker reads to resume with zero prior context.

**Capability check (do this first):** which spawning surface do you have?
- **Agent Teams** (workers in **tmux split panes**, live two-way `SendMessage`) — best when a human watches and you steer mid-cycle.
- **Background subagents** (run-to-completion `/workflows` tasks, killed with `TaskStop`) — works headless with no live nudging; some live-monitoring edge cases below don't apply.
Pick per environment; the protocol below marks where the two differ.

## When to use / not

Use for: work that exceeds one agent's context; an agent you keep restarting on context exhaustion;
a human who wants to watch and steer; resuming a broken/abandoned chain.
**Not** for: a single bounded task (just do it / one subagent); pure fan-out with no sequential
dependency (use a Workflow — see `superpowers:dispatching-parallel-agents`).

## The lifecycle decision that keeps the chain stable

The two ways orchestration breaks are **spawning a duplicate** (two workers → double-merge) and
**killing a productive worker** (its report was just slow). Both come from misreading "idle". This is
where you go wrong if you go fast:

```dot
digraph idle {
  "Worker idle, no report" [shape=box];
  "Report arrived (in-flight)?" [shape=diamond];
  "Handle report; if done: terminate -> CONFIRM -> chain next" [shape=box];
  "Liveness: report? /workflows done? pane alive? git moved?" [shape=diamond];
  "FINALIZE EXCEPTION: all tasks committed + no PR/report + patience window elapsed?" [shape=diamond];
  "Send ONE concrete finalize nudge NOW (pane-alive does NOT exempt you past the ceiling)" [shape=box];
  "Alive/moving -> WAIT (mid-cycle idle only — NOT a finalize stall past the ceiling)" [shape=box];
  "No git progress ~10-15m OR no report ~45-60m?" [shape=diamond];
  "Keep waiting; re-check on a timer" [shape=box];
  "Already nudged this stall?" [shape=diamond];
  "ONE nudge: send PROGRESS or finalize (do NOT also spawn a duplicate)" [shape=box];
  "Safe to kill? (no uncommitted SOURCE: git status --porcelain)" [shape=diamond];
  "Hard-kill per surface -> CONFIRM -> fresh cycle rebuilds from git" [shape=box];
  "Directive nudge: commit-or-revert WIP + approve shutdown in N min" [shape=box];
  "Now clean / responsive?" [shape=diamond];
  "BLOCKED_ON_HUMAN (AskUserQuestion: discard WIP+kill vs keep waiting)" [shape=box];

  "Worker idle, no report" -> "Report arrived (in-flight)?";
  "Report arrived (in-flight)?" -> "Handle report; if done: terminate -> CONFIRM -> chain next" [label="yes"];
  "Report arrived (in-flight)?" -> "Liveness: report? /workflows done? pane alive? git moved?" [label="no"];
  "Liveness: report? /workflows done? pane alive? git moved?" -> "FINALIZE EXCEPTION: all tasks committed + no PR/report + patience window elapsed?" [label="alive"];
  "FINALIZE EXCEPTION: all tasks committed + no PR/report + patience window elapsed?" -> "Send ONE concrete finalize nudge NOW (pane-alive does NOT exempt you past the ceiling)" [label="yes — finalize stall"];
  "FINALIZE EXCEPTION: all tasks committed + no PR/report + patience window elapsed?" -> "Alive/moving -> WAIT (mid-cycle idle only — NOT a finalize stall past the ceiling)" [label="no — mid-cycle"];
  "Liveness: report? /workflows done? pane alive? git moved?" -> "No git progress ~10-15m OR no report ~45-60m?" [label="static"];
  "No git progress ~10-15m OR no report ~45-60m?" -> "Keep waiting; re-check on a timer" [label="no"];
  "No git progress ~10-15m OR no report ~45-60m?" -> "Already nudged this stall?" [label="yes"];
  "Already nudged this stall?" -> "ONE nudge: send PROGRESS or finalize (do NOT also spawn a duplicate)" [label="no"];
  "Already nudged this stall?" -> "Safe to kill? (no uncommitted SOURCE: git status --porcelain)" [label="yes"];
  "Safe to kill? (no uncommitted SOURCE: git status --porcelain)" -> "Hard-kill per surface -> CONFIRM -> fresh cycle rebuilds from git" [label="yes"];
  "Safe to kill? (no uncommitted SOURCE: git status --porcelain)" -> "Directive nudge: commit-or-revert WIP + approve shutdown in N min" [label="no (dirty source)"];
  "Directive nudge: commit-or-revert WIP + approve shutdown in N min" -> "Now clean / responsive?";
  "Now clean / responsive?" -> "Hard-kill per surface -> CONFIRM -> fresh cycle rebuilds from git" [label="clean"];
  "Now clean / responsive?" -> "BLOCKED_ON_HUMAN (AskUserQuestion: discard WIP+kill vs keep waiting)" [label="still stuck"];
}
```

> **FINALIZE EXCEPTION — why it exists:** `pane-alive → WAIT` is correct for mid-cycle idle
> (the worker is just between turns). It is WRONG at a finalize stall — all tasks committed, no
> PR opened, no COMPLETE report, patience window elapsed. At that point the pane-alive signal is
> irrelevant: the ceiling has expired, and you MUST send ONE concrete nudge NOW regardless of pane
> state. The exception routes through the time ceiling check BEFORE falling back to WAIT. Without
> this check the orchestrator sees the pane alive, routes to WAIT, and stalls the chain forever.

**Iron rule of chaining: confirm the prior worker is TERMINATED before spawning the next cycle.**
Spawning a replacement while the original is alive is the #1 cause of duplicate/destructive work.
**Never let one worker stall the pipeline forever** — the escape hatch above (nudge → directive nudge →
human) always terminates.

**PR / finalize boundary — patience vs active nudge (distinct concepts, do not conflate):**
- **Patience** = a worker that is idle between turns is NORMAL; idle ≠ stuck, idle ≠ slow. A worker
  that committed all tasks and then went quiet is finishing up. DO NOT send a message just because
  it is quiet.
- **Active nudge** = a deliberate one-shot message you send when the patience window has elapsed
  with NO PR opened and NO report sent. At a FINALIZE/PR boundary, after the normal patience window
  elapses (~45–60 min of no report, after all tasks committed), send EXACTLY ONE "finalize-or-handoff"
  nudge. After that single nudge: wait for its reply; do NOT re-send; do NOT spawn a duplicate worker.
  If the nudge goes unanswered past the hard ceiling → apply the kill/escalation tree above. The
  answer is NEVER "wait indefinitely" and NEVER "spawn a fresh finalize worker while the original
  is alive."
- **CRITICAL — pane-alive ≠ exempt at a finalize stall past the ceiling.** The lifecycle flowchart
  routes `pane-alive → WAIT` for MID-CYCLE idle (the worker is between turns — normal). That routing
  does NOT apply at a finalize stall where all tasks are committed, no PR has been opened, and the
  patience window has elapsed. At that specific state, CHECK THE TIME CEILING FIRST (see FINALIZE
  EXCEPTION in the flowchart above): if the ceiling has elapsed → send ONE concrete nudge NOW,
  regardless of whether the pane is alive. Pane-alive does not mean "keep waiting indefinitely"
  when the patience ceiling has passed. Example nudge wording: *"All tasks are committed but no PR
  or handoff report after [elapsed time]. Please open the PR or write the handoff now — I will wait
  for your reply before taking any other action."*
- **FORBIDDEN PHRASES at a finalize stall (window elapsed, no PR/report):** "keep monitoring",
  "wait and see", "give it more time", "continue watching", "I'll check back later". These are not
  actions. They leave the chain permanently stalled. They are NEVER the correct move.
- **The THREE valid moves ONLY:**
  1. Keep waiting silently — but ONLY while the patience window has NOT yet elapsed.
  2. Send EXACTLY ONE concrete nudge — when the window IS elapsed. Use THIS wording verbatim:
     *"All tasks are committed but no PR or handoff report after [elapsed time]. Please open the
     PR (or write the handoff) now — I will wait for your reply before taking any other action."*
  3. Apply the kill/escalation tree — after the nudge goes unanswered past the hard ceiling.
  There is no option 4. "Keep monitoring" is not an option.

## Spawning a cycle worker

- Use a worker type that has `SendMessage` (e.g. general-purpose). A read-only / no-SendMessage type cannot report — have it `Bash`-write findings to a known file you Read.
- **Least privilege:** give each cycle the minimum tools it needs; do NOT run unattended workers with sandbox disabled / permissions bypassed beyond what the task requires.
- Give a self-sufficient brief — see `references/worker-cycle-template.md`. Spawn mechanics per surface and a background-only loop are in `references/lifecycle-and-edge-cases.md`.
- One worker per working tree (see Concurrency). For cycle #1 on a NEW project, see "Starting from zero".

## Monitoring without burning your context

- Signals: `SendMessage` reports (real) and idle notifications (turn boundaries — NOT a stop/finish signal).
- **Liveness, ranked (highest first):** a report = reached a boundary; a `/workflows` task in terminal state = exited; `tmux list-panes -F '#{pane_id} #{pane_dead}'` = running vs exited; git movement = proves *progress*, never proves *stopped*. Before concluding "stuck", check non-git evidence too (`tmux capture-pane -p | tail`, build/log mtime).
- **Probe read-only and OFF the worker's tree:** `git fetch --quiet` first, then `git log origin/main..origin/<branch> --oneline`; treat `gh pr view <n> --json state,mergedAt` as the authoritative done-signal (local `main` does NOT advance on a remote merge). Use `gh`, `git ls-remote`, or `git -C <path>` — don't run `git status` against a live worker's tree (its branch switch would misreport your view). **Never read the worker's transcript** (context overflow) — not even under the dead-worker report-recovery exception; that exception covers the HANDOFF FILE only, never any transcript.
- **Two patience clocks:** kill-timer arms on (a) no git progress ~10–15 min AND also (b) no report for a hard ceiling ~45–60 min *regardless of git movement* (a looping worker commits forever — git motion ≠ health). Require workers to `SendMessage` a one-line `PROGRESS` before any long (>~10 min) no-commit step, and key patience on last-known-liveness, not time-since-spawn.
- **Verification watchdog (refines the coarse ~20-min clock for any verification step).** A declared
  verification step — run by an orchestrator-spawned verifier-teammate (the live-validated default for
  user-facing surfaces) or a worker-owned background subagent — is the one place that coarse silence clock
  is too slow, and prompt-level time caps do NOT self-enforce (observed: a "10-min cap" written into a
  verifier's prompt ran 33 min). So arm an EXTERNAL watchdog: a background watcher polling the verifier's
  `steps.log` heartbeat every ~20s. ~3 min of silence → wake and intervene, FIRST killing the automation
  browser (the gentle unstick — it errors the frozen step so the turn ends and steering resumes; pane-kill
  the verifier itself only if it stays stuck). ~15 min total → cap reached, take the PARTIAL report. The
  journal's last `START` line pinpoints the frozen step. Identify hung automation processes by their flags
  (e.g. `--allow-pre-commit-input`) + recent start time — NEVER the human's own browser. See edge case E17
  in `references/lifecycle-and-edge-cases.md`.
- **Stay lean:** don't probe on every idle — probe on a timer (stall start, then ~270s — the cadence table's active-monitoring tier) or a `Monitor` poll loop; keep probes terse and compare a stored SHA in the state file; log nothing on no-change.

## Terminating + chaining

1. **Prefer self-quiescence:** brief workers to finish → write handoff → `SendMessage` report → go idle. A clean COMPLETE report is your terminate signal; you needn't originate a shutdown for liveness.
2. **Graceful stop** (to free a pane/resource after a report): send `{type:'shutdown_request', reason}`. The worker REPLIES `{type:'shutdown_response', request_id, approve:true}` at its NEXT turn boundary and exits (it MAY reject with `approve:false`). Originating shutdown is a legacy path — reserve it for workers that didn't self-quiesce.
3. **Forced stop** (unresponsive worker) — **per surface:**
   - Agent Teams pane → `tmux kill-pane -t <pane_id>` (re-list panes first; identify by worker NAME, not a recycled `%N`).
   - Background subagent → `TaskStop(task_id)` using the spawn-result id. **Never** kill a background task with tmux.
4. **Confirm termination — per surface — before chaining:** pane → `teammate_terminated` naming THAT worker (and the pane is gone on re-list); background → `TaskStop` success / terminal `/workflows` status. A later `SendMessage` after a kill is a **late in-flight message, not liveness**.
5. THEN spawn the next cycle, pointed at the handoff the prior worker wrote.

## The orchestrator's own state lives on disk, not in your context

Keep ONE file — `docs/handoff/ORCHESTRATION-STATE.md` — readable by BOTH the human owner and a
replacement orchestrator. Structure (in this order):

1. **"At a glance" human section (FIRST, ~5-8 bullets):** what we're working on (phase/epic + PR),
   progress (N/M tasks), which cycle is running on which worker, latest review verdicts, the standing
   model/verification policy, what's next. The owner must understand the situation in one glance —
   no key-soup, no abbreviations invented mid-chain.
2. **LIVE-STATUS block (machine, overwritten each change):** `cycle N | worker=<name> (model) id=<pane|task> tree=<path> branch=<b>@<sha> | latest handoff=<path> | status=...`.
3. **TELEMETRY block (cumulative, persisted each change):** `cycles_completed=N | tokens_total=T | tokens_workers=W | tokens_orchestrator=O | open_workers=[name,...]`. A rolled-over or restarted orchestrator reads this block to resume cumulative tallies — never reset to zero.

   **MANDATORY STEP — after EVERY worker terminates:** APPEND one structured line to the TELEMETRY
   block in ORCHESTRATION-STATE.md (write atomically via hidden temp as usual). Use EXACTLY this format:
   ```
   cycle=N worker=<name> model=<model> tokens_out=<N> tokens_in=<N> cache_read=<N> | running: cycles=N total_tokens=T
   ```
   Example verbatim append line:
   ```
   cycle=13 worker=cycle-13 model=claude-sonnet-4-5 tokens_out=4821 tokens_in=12340 cache_read=58200 | running: cycles=13 total_tokens=421000
   ```
   Do this BEFORE spawning the next cycle. Do not defer it. "I'll tally later" = the line never
   gets written. If the worker's report does not include token counts, write what you have and
   note `tokens_out=unknown`. Never leave this step undone.
4. **Standing rules/decisions + known-automation-traps:** the owner's non-negotiables and policy
   decisions, dated; and a per-project **known-automation-trap registry** — routes/flows that reproducibly
   misbehave under the browser-automation tooling (e.g. "route X hangs under the automation MCP — skip it;
   curl-first that route to separate an app fault from an automation flake"). Every verifier brief you
   write carries the current trap list.
5. **Log — structured, NOT prose walls:** subsections by **date** (`### YYYY-MM-DD — Phase <N> (epic <KEY>)`),
   under each date group by **cycle** (`**Cycle N (worker-name)**`), and inside each cycle short
   bullets that LEAD WITH THE TASK KEY (`- TLM-82: grid landed @ <sha>; browser-verify PASS; 1 review major fixed`).
   Date → phase/epic → cycle → task-keyed bullets lets both the owner and a cold-started orchestrator
   scan it top-down without parsing paragraphs.

**Write the STATE file atomically:** write to a same-directory hidden temp (`docs/handoff/.ORCHESTRATION-STATE.md.tmp`), then `mv`/rename into place. Same-directory rename is atomic; a crash mid-write can't leave a truncated or half-updated STATE file. Never write directly to the final path. On startup, detect and remove any stale `.tmp` left by a prior crash.

This file — not chat scrollback — is ground truth for you and any replacement orchestrator. Keep the
human section current every time LIVE-STATUS changes; compress old log entries rather than letting
them sprawl.

## Heartbeat protocol — orchestrator liveness on disk

An external mechanical watchdog (non-LLM; launchd/cron script) may sit above you and judge YOUR
liveness. It judges from **durable on-disk state ONLY** — file mtime + parseable content — never from
chat self-report or pane-content scraping (a wedged agent can't report; a dead one can't say so).
The heartbeat file is that signal. Write it even when no watchdog is installed — one tiny write per
pulse makes the chain supervisable at any moment.

- **Path:** `docs/handoff/.orchestrator-heartbeat` — project-scoped, next to the STATE file. Runtime
  state, NOT history: gitignore it (pattern `docs/handoff/.orchestrator-heartbeat*` — covers the
  `.tmp` too); never commit it.
- **When:** the **FIRST act of every pulse / wake-up tick** — before reading STATE, before probing
  workers, before anything else. Write-first is the mid-pulse-wedge mitigation: a wedged orchestrator
  never starts its NEXT pulse, so mtime stops advancing and staleness is observable within one pulse
  interval. Also write a final line at every session boundary (see `status`).
- **Format — append ONE JSON line** (JSONL; the watchdog reads `tail -1` + `stat` mtime):
  `{"ts":"2026-07-10T03:14:07Z","cycle":12,"context_pct":41,"open_workers":2,"status":"ok","pane":"%4"}`
  Required: `ts` (UTC ISO-8601) · `cycle` (current cycle N) · `context_pct` (your HONEST estimate —
  the watchdog compares it to the roll ceiling; a fabricated number defeats roll-at-~70%) ·
  `open_workers` (count of live workers) · `pane` (YOUR OWN tmux pane id — literally `$TMUX_PANE`;
  this self-declared id is the watchdog's ONLY way to tell which pane is you: it nudges/kills the
  pane named here and NOTHING else. Positional guessing is forbidden on its side — after you die,
  the "first pane of the window" is typically a live WORKER. Omit or mangle this field and the
  watchdog refuses to act on a live session and escalates to the owner instead). Optional:
  `status` — `"ok"` (default) · `"rolling"` (dated
  handoff written, successor orchestrator expected — write as the LAST act before exiting a session)
  · `"quiesced"` (deliberately not progressing — tells the watchdog NOT to restart anything,
  whatever tmux says. Two forms: **chain done** — `open_workers` MUST be 0, the stand-down is
  permanent; **quota-wait** — `note` MUST carry `quota-wait until <ISO ETA>` and `open_workers`
  stays the REAL count of held workers; this form's stand-down is **ETA-bounded**: once the noted
  ETA is more than `WD_QUOTA_GRACE_SECS` (default 900s) in the past, the watchdog treats you as
  re-wakeable again — the alarm-clock backstop, see Quota auto-wait section); `mode` — `"night"` while inside the declared night window
  (see Night mode section; omitted or `"day"` otherwise — the mode must be readable from disk);
  `note` (free text, ≤80 chars).
- **Atomic append, self-truncating** (same-directory hidden temp + rename, the STATE-file convention):
  ```bash
  hb="docs/handoff/.orchestrator-heartbeat"
  line='{"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","cycle":12,"context_pct":41,"open_workers":2,"status":"ok","pane":"'"${TMUX_PANE:-}"'"}'
  { [ -f "$hb" ] && tail -n 199 "$hb"; printf '%s\n' "$line"; } > "$hb.tmp" && mv "$hb.tmp" "$hb"
  ```
  Same-dir rename is atomic — a crash mid-write can't leave a truncated file; `tail -n 199` caps the
  file at 200 lines so it stays compact forever.
- **How the watchdog reads it (contract — know it so you don't fight it):** heartbeat mtime older
  than its threshold → one nudge, then kill (explicit id ONLY) + re-wake via the cold-start protocol
  — and the nudge/kill target is taken EXCLUSIVELY from your `pane` field: a live session whose
  heartbeat carries no verifiable pane id is never guessed at — the watchdog refuses
  (`kill_refused reason=identity_unverified`) and escalates to the owner;
  `context_pct` ≥ ceiling → "write handoff now" + fresh orchestrator from the handoff;
  `status:"quiesced"` → no restart (quota-wait form: only until the noted reset ETA is > grace
  overdue — then normal supervision resumes; see Quota auto-wait). **Startup grace:** a fresh orchestrator is exempt from staleness
  for a warm-up window (~90–120 s — Gastown #567: heartbeat checks killed freshly-started sessions
  before they could write one), so write your FIRST heartbeat during cold-start orientation, right
  after the on-disk reads. **Never judged from a single store:** the watchdog cross-checks heartbeat
  age against tmux/session liveness before declaring you stuck (fresh heartbeat + dead session =
  dead; stale heartbeat + live session = write-divergence → nudge first). One missed write won't kill
  you — that is not a license to skip writes.
- **Relation to the pulse rule:** the standing pulse (self-check on a short cadence while the fleet
  is live; never end a turn without an armed wake-up) is the heartbeat *generator*. Heartbeat-first
  makes each pulse externally observable, and a turn that ends with no armed wake-up also stops the
  heartbeat — so silent quiesce is caught too. (Pulse cadence/economics are the next section; this
  section fixes only WHAT gets written and WHEN.)

## Pulse cadence — self-pacing on cache windows

**The armed-wake-up rule (HARD):** a turn that ends while `open_workers > 0` MUST end with an armed
wake-up (`ScheduleWakeup`; a cron/`sleep` wrapper on surfaces without it). No exceptions — not "the
worker will message me anyway" (a wedged worker won't), not "nothing to do right now" (that is what
a cheap tick is for). An unarmed turn with a live fleet = silent quiesce: the pulse stops, the
heartbeat goes stale, and the watchdog's next move is a nudge at YOUR pane. Ending a turn = exactly
one of three states: **(a)** a wake-up is armed (the normal live-fleet case); **(b)** the chain is
done — final heartbeat `status:"quiesced"`, `open_workers:0`; **(c)** a session boundary — final
heartbeat `status:"rolling"` (successor expected; every worker already terminated per the roll
HARD GATE) with NO wake-up armed: an armed wake-up would re-invoke the old session alongside its
successor — two live orchestrators, the exact failure this skill exists to prevent. Nothing else.

**The pulse is a cheap triage tick, not a work turn:** heartbeat first, then read STATE + probe
only for deltas (new reports, git movement vs the stored SHA, expired patience clocks), act only on
what changed. Nothing changed → write nothing, re-arm, end the turn (see the HEARTBEAT_OK
fast-path). Never let a wake-up re-trigger heavy work — re-running a slash command, re-reading
handoffs, re-auditing the tree on every tick is the documented hazard (claude-code #54086).

**Cadence table — pick the delay by what you are waiting for, priced against the ~5-min prompt-cache
TTL** (a tick inside the TTL reads your context from cache almost for free; a tick past it re-reads
everything cold — one cache miss — so a miss must buy a LONG sleep to amortize):

| Mode | Delay | When | Economics |
|---|---|---|---|
| **Active monitoring** | **~270s** | Unsticking a stall, verifier running under its watchdog, report/termination expected within minutes, quota-reset ETA imminent | Inside the cache TTL — context stays warm, ticks are near-free; the only mode where fast polling is rational |
| **Stable waiting** | **~540s** | Workers mid-cycle and healthy, next boundary expected in ~10–20 min | One cache miss per tick, amortized ≥2× vs dead-zone ticking; keeps the heartbeat comfortably fresher than the watchdog's staleness clock |
| **Long waiting** | **1200–1800s** | Workers deep in long cycles, night idle, nothing actionable expected for 20+ min | One cache miss buys the whole sleep; the cheapest healthy cadence there is |
| **Dead zone** | **≥300s and <540s — NEVER** | — | Worst of both: pays the full cache miss without amortizing it. Half-open on purpose: 540s itself is the stable-waiting floor, not the zone. "I'll check in 5 minutes" (300s) is exactly this trap — think in cache windows, not round minutes |

**Watchdog alignment:** any standing delay at or above the watchdog's staleness threshold
(`WD_HB_STALE_SECS`, default 900s) schedules your own false-stale nudge — the watchdog interrupts
the sleep you deliberately chose. Long-waiting cadence (1200–1800s) therefore requires the owner to
raise `WD_HB_STALE_SECS` in `watchdog.conf` above the longest standing delay (e.g. 2100s for
unattended/night operation); with the default threshold, cap standing delays below ~840s. Never
resolve the conflict by skipping heartbeats or by silently ignoring nudges.

**Cadence anti-patterns:**
- **Unarmed end-of-turn with a live fleet** — the #1 violation; everything above exists to prevent it.
- **Round-number thinking** — "wait 5 minutes" lands in the dead zone every time. 270s or 540s+.
- **Polling faster than the awaited thing changes** — a worker mid-45-min-cycle polled at 270s is
  ~10 wasted ticks; match the delay to the expected boundary, then step down to active monitoring
  as it approaches.
- **Heavy wake-ups** — a pulse that spawns, audits, or re-reads files "while I'm here" stops being
  a triage tick; heavy actions happen because a DELTA demanded them, never because you woke up.
- **Sleeping just past a threshold** — either just past the cache TTL (dead zone) or just past
  `WD_HB_STALE_SECS` (self-inflicted nudge). Sleep decisively short or decisively long.

### HEARTBEAT_OK fast-path — the minimal tick

When every worker is alive and its files are growing, the pulse must cost almost nothing
(OpenClaw heartbeat: a tiny STABLE checklist; "HEARTBEAT_OK → do nothing"). Run these checks in
order — they are the whole tick:

1. **Heartbeat written** (FIRST act — always, fast-path or not).
2. **Inbox empty** — no worker reports, no owner messages waiting.
3. **Fleet census unchanged** — one `tmux list-panes` (or `/workflows` glance): same pane ids/count
   as LIVE-STATUS.
4. **Progress probe** — ONE `git log` (or handoff-dir mtime) against the SHA stored in STATE:
   movement = grinding. No movement is STILL green while item 5's clocks are unexpired — idle ≠
   stuck.
5. **No expired clocks** — patience windows, breaker `next_probe`, quota ETA, mode boundary
   (night/morning) all un-crossed.

**ALL green → HEARTBEAT_OK:** write nothing to STATE (log nothing on no-change), read nothing
further — no handoff bodies, no STATE rewrite, no extra probes — re-arm per the cadence table, end
the turn. Target cost: ≤3–4 cheap tool calls, zero file reads beyond the probes.

**ANY check non-green → leave the fast-path** and triage ONLY that delta through its own tree
(idle/liveness, finalize exception, mode boundary, breaker, quota-wait). The fast-path is an exit
ramp for healthy ticks, never a way to skip a delta you already saw.

Worked example (night, stable fleet, long-waiting cadence):
```
[tick 03:41] hb appended: {"ts":"2026-07-10T03:41:07Z","cycle":13,"context_pct":44,
             "open_workers":2,"status":"ok","mode":"night","pane":"%4"}
inbox: empty | panes: %5 %7 — matches LIVE-STATUS | git probe: worker branch
@ a1b2c3d -> a9e8f7c (moved — grinding) | clocks: patience 12m/45m, breaker
CLOSED, no quota-wait, night until 08:30 — none expired
=> HEARTBEAT_OK. Nothing written, nothing else read. ScheduleWakeup 1500s. End turn.
```

## Night mode — activeHours

The owner declares **activeHours** — the attended window in the owner's local time. Outside it the
chain runs in **`mode=night`**: interactivity is *loosened* (nobody will answer), rails are
*tightened* (nobody will catch a mistake). Night mode is the standing-schedule generalization of
the re-wake unattended deltas — same buffering discipline, entered by the clock instead of by a
watchdog restart.

- **Where declared:** a dated line in the STATE file's Standing rules, e.g.
  `activeHours: 09:00–24:00 local (night = 00:00–08:30)`. Default when undeclared: night =
  00:00–08:30. (The Phase-3 decision manifest becomes the canonical home when it exists; the
  Standing-rules line moves there.) The owner saying "я спать" / "going to sleep" = enter night
  mode NOW regardless of clock; "I'm back" = day mode now. Derive the mode at every pulse from the
  clock + standing overrides — it is never a memory-only flag.
- **What changes at night** (everything else — telemetry, heartbeat, patience clocks, termination
  gates — is mode-independent):

| Behavior | Day | Night |
|---|---|---|
| Questions at genuine forks | `AskUserQuestion` (Decision forks section) — still log the record to the question queue | **AskUserQuestion FORBIDDEN except denylist items (= BLOCKER type).** Classify + append a typed record to the question queue (Question buffer section), take the reversible default (CLARIFY / DECISION-with-deadline) or park ONLY the affected item (BLOCKER), continue on unblocked work |
| Escalations | Notify the owner directly | **Buffered** into STATE + surfaced at the morning boundary — EXCEPT critical: denylist hit, mass-death, restart-budget exhaustion, circuit-breaker OPEN, `BUDGET_EXCEEDED`. Critical still escalates immediately (watchdog hook / push when it exists) |
| Work selection | Owner may steer mid-cycle | Autonomous reversible green delivery only; at a milestone boundary continue into the next unblocked phase (owner mandate 2026-07-10) — do not stop to ask |
| Idle cadence | Per cadence table | Long-waiting tier (1200–1800s) is the default between boundaries; step down only for an active stall/verifier |
| Irreversible actions | Denylist → `BLOCKED_ON_HUMAN` | Same denylist, zero exceptions — night grants NO extra authority |

- **Heartbeat records the mode:** add the optional `mode` field to every heartbeat line while in
  night mode — `"mode":"night"` (omitted or `"day"` otherwise; see Heartbeat protocol). The mode
  must be readable from disk by the watchdog/owner/replacement orchestrator — never context-only.
- **Entering night** (first pulse past the window edge, or the owner's sign-off): append a
  `MODE → night` line to the STATE log, write the heartbeat with `mode:"night"`, confirm the
  wake-up is armed. One-time owner setup for unattended nights: raise `WD_HB_STALE_SECS` in
  `watchdog.conf` above the long-waiting tier (e.g. 2100s) and set the night restart budget
  (e.g. 3 per night window) — see `tools/watchdog/watchdog.conf.example`.
- **Morning boundary** (first pulse at/after activeHours start): append `MODE → day` to the STATE
  log; drop `mode:"night"` from the heartbeat; **surface the night's buffer** — every open
  question-queue record and every buffered escalation goes into ONE compact owner-facing summary
  (the Phase-3 morning digest when it exists; until then a short message + pointer to the STATE
  section). Buffered items are never silently dropped: they stay open in STATE until answered or
  superseded. Then resume day-mode escalation behavior.
- **A question buffered at night is not a stalled chain:** park only the affected task, reroute the
  worker to unblocked work, keep pulsing. `BLOCKED_ON_HUMAN` panes at night are reserved for
  denylist items alone.

## Question buffer — four question types, four behaviors

The #1 autonomy gap is a question that stops a pane: a synchronous `AskUserQuestion` at 03:00
blocks work until morning and dies with the session. Phase-3 inversion: **the question RECORD is
primary; a live `AskUserQuestion` is just one delivery channel**, raised for the same record only
when the owner is present (owner messaged within ~15 min, or said "I'm back"). Owner absent →
write the record to the question queue (`docs/lab/questions/queue.jsonl` — see the Question queue
section) and behave per type below. The queue supersedes the STATE `QUESTIONS-PENDING` mechanic
as the buffer's home — same discipline (buffer, default, reroute), but durable typed records on
disk instead of ad-hoc STATE lines; night mode and re-wake briefs both write HERE. Either way the
answer is logged back to the queue — the learning loop needs it whether it came live or buffered.

**Typology — classify EVERY ownable question BEFORE acting on it:**

| Type | When (classification) | Orchestrator behavior | Wakes the owner at night? |
|---|---|---|---|
| **BLOCKER** | Work cannot proceed AND no safe default exists: missing credentials, any denylist action, an irreversible fork | Park ONLY the affected item (park-per-task, never park-the-fleet); reroute workers to unblocked work; queue the record | **Yes — push immediately** (the only type that may wake the owner; manifest quiet-hours may batch even this) |
| **DECISION** | A genuine fork with viable branches AND a defensible, reversible default | Queue the record with `default`, `default_rationale`, `reversibility` and an `auto_apply_at` deadline ("if unanswered by T, I do X"); keep working elsewhere; at T apply the default and log `decision.made` | No — batched into the morning digest, unless the record is marked high-impact |
| **CLARIFY** | Ambiguity with one obviously-reasonable reading | Take the default IMMEDIATELY; record as answered-by-default so the owner can veto retroactively | No — digest only |
| **FYI** | No answer needed: recovered incidents, thresholds crossed, policy rules tripped | Record only | No — digest only (unless severity ≥ incident) |

**Classification rules — apply in order, first match wins:**
1. **No safe default** (credentials, denylist, irreversible-if-wrong)? → **BLOCKER**.
   Irreversibility alone forces BLOCKER: buffer-and-default is licensed by reversibility — never
   default an irreversible fork, however confident the default feels.
2. **Real fork + defensible reversible default?** → **DECISION**. The record must say what the
   default is, why it is defensible, and when it auto-applies.
3. **One obviously-reasonable reading?** → **CLARIFY** — proceeding is cheaper than asking; the
   record exists so the owner can veto after the fact.
4. **Nothing to answer?** → **FYI**.

Severity shorthand: `BLOCKER > DECISION > CLARIFY > FYI`; "type ≤ DECISION" means
DECISION/CLARIFY/FYI — everything that continues without a human.

**Night-mode wiring** (the table above IS the night question policy — the Night mode section's
question row delegates here): **BLOCKER is the only question type on the night critical list** —
it may push/wake immediately, alongside the existing critical escalations (denylist hit,
mass-death, restart-budget exhaustion, breaker OPEN, `BUDGET_EXCEEDED`). DECISION/CLARIFY/FYI
never wake anyone: they buffer into the queue and surface at the morning boundary. Day mode uses
the SAME records — the only day/night difference is the delivery channel (live ask vs
queue+digest), never the record or its type.

**Dedup before posing (question-spam guard):** five workers hitting the same ambiguity = ONE
record. Before appending, check open records for the same `(task, question-hash)`; a duplicate
appends a `seen_by` patch to the existing record, never a second question (mechanics in the
Question queue section).

## Question queue — `docs/lab/questions/queue.jsonl`

The buffer's durable home. **Append-only JSONL:** a record is NEVER rewritten — every status
change is a NEW patch record `{"re":"<id>", ...}` appended after it; corrections append a
superseding record, never edit history (the C8/ledger discipline). All writes go through the
helper — **`tools/lab/lab-emit.sh`** — which owns id generation, dedup and atomic append (mkdir
lock + single-line `O_APPEND`); never hand-append concurrently.

One question record (05 §4.2 schema; full field reference in `docs/lab/questions/README.md`):
```json
{"id":"q-2026-07-08-003","ts":"2026-07-08T01:12:40Z","type":"DECISION","from":"orchestrator",
 "task":"GSL-45","links":{"jira":"GSL-45","gh":"#52"},
 "question":"PR #56 conflicts after main moved; rebase or merge main into the epic branch?",
 "options":[{"label":"rebase","pros":"linear history","cons":"rewrites unpushed commits"},
            {"label":"merge main in","pros":"no rewrite","cons":"merge bubble"}],
 "default":"merge main in","default_rationale":"no-force-push standing rule; reversible",
 "reversibility":"high","impact_if_wrong":"cosmetic history",
 "auto_apply_at":"2026-07-08T10:00:00Z","status":"open","qhash":"ab12cd34ef"}
```
Patch records: answered `{"re":…,"status":"answered","answer":…,"answered_by":"owner","channel":…}` ·
auto-resolved `{"re":…,"status":"auto-resolved","applied":…}` · duplicate `{"re":…,"seen_by":"<worker>"}`.
Current status = fold of the question record + its patches (last wins): `open` (BLOCKER/DECISION
awaiting) · `answered` · `auto-resolved` (default applied at deadline) · `answered-by-default`
(CLARIFY) · `noted` (FYI).

**Helper commands:**
- **Pose:** `tools/lab/lab-emit.sh question --type DECISION --from <actor> --task GSL-45
  --question "…" --default "…" --default-rationale "…" --reversibility high|med|low
  [--auto-apply-at ISO] [--link jira=GSL-45] [--option "label|pros|cons"] [--high-impact]` —
  prints the new id, or `DUPLICATE <id>` when deduped. A DECISION without an explicit deadline
  gets the manifest §2 default (posed at night → 10:00 local; day → +2h). DECISION/CLARIFY
  REQUIRE `--default` — a fork with no defensible default is a BLOCKER, reclassify it.
- **Answer / resolve:** `lab-emit.sh answer --re <id> --answer "…" --by owner --channel telegram` ·
  `lab-emit.sh resolve --re <id> --applied "…"` (deadline hit → default applied).
- **Read:** `lab-emit.sh list` (open) · `list --due` (DECISIONs past deadline — act on these at
  every pulse) · `list --count` (one-liner for LIVE-STATUS) · `list --status all --json`.

**Git policy:** queue.jsonl is LIVE project data — committed at ledger boundaries exactly like
STATE and handoffs (it is the owner's phone-readable, phone-answerable surface), never
gitignored. Answered/expired records are compacted to `archive.jsonl` by the Phase-4 chronicler;
until it exists the queue just grows (it's tiny).

## Quota auto-wait — session-limit quiesce & resume

The subscription quota window is account-wide: when it exhausts (`You've hit your session limit`,
`StopFailure(rate_limit)`), you AND every worker stop being able to run turns at once. This is not
a failure — it is scheduled weather with a known reset time. The chain must wait it out quietly
and resume itself (validated in production 2026-07-07→08), not die, not park silently, and not let
the watchdog burn its restart budget on re-wakes that are guaranteed to hit the same limit.

**Detection — multi-signal, never one error string** (ralph #183 lesson: a timeout misread as a
rate limit parks a healthy fleet):
1. Your own turn/tool call fails naming the session limit or `rate_limit`.
2. A worker's report / StopFailure names it.
3. The WHOLE fleet goes silent simultaneously right after heavy usage — suspect quota before
   suspecting N independent bugs; confirm via signal 1/2 before quiescing.
4. Distinguish from transient `overloaded` / `server_error`: those retry with backoff and do NOT
   quiesce; only a limit with a reset window does.

**Quiesce protocol (in this order):**
1. **Determine the reset ETA:** the limit message usually names it; else quota-window start + 5h.
   When uncertain, **err LATE, never early** — every resume mechanism (your armed wake-up AND the
   watchdog backstop, step 5) keys off this ETA: an ETA declared too early re-wakes into a
   still-closed window and burns restart budget; too late merely resumes later. (An overestimated
   ETA still gets a free probe at +3600s — the wake-up cap in step 5.)
2. **Hold the fleet — kill nothing, spawn nothing.** Workers are held, not stuck: their panes keep
   in-flight state and resume free of charge when the window opens. Best-effort `SendMessage` to
   each live worker: *"quota-wait until <ETA> — hold; finish nothing heavy; do not start new
   steps."* (They likely can't act on it until reset — that's fine, it's queued.)
3. **STATE:** LIVE-STATUS gets `status=quota-wait until=<ISO ETA>`; append a log line
   `QUOTA-WAIT entered (signal=<...>, eta=<...>)`.
4. **Heartbeat:** `status:"quiesced"`, `note:"quota-wait until <ISO ETA>"`, `open_workers` = the
   REAL count of held workers (the quota-wait form — Heartbeat protocol above). This single line is
   what tells the watchdog to stand down: quiesced is checked FIRST, before staleness, so the
   heartbeat going stale during the wait (you can't write while limited) triggers no nudge/kill.
5. **Arm ONE wake-up and STAY in the session:** delay = `min(3600, ETA − now + ~120s margin)`
   (3600s is the wake-up cap). Be honest about what this buys: a tick that fires while the window
   is still closed cannot run a turn (step 4's own premise — you can't write while limited), so it
   can NEVER re-arm a next hop, and no retry/queue semantics are guaranteed by the harness. There
   is no multi-hop "chain." ETA within ~3600s → your wake-up fires past the reset and resumes you
   directly. ETA further out → the armed wake-up dies under the limit (accept it — it still
   doubles as a free early probe in case the ETA was overestimated) and resume falls to the
   **watchdog's alarm-clock backstop** (contract v0.5.1): the `quiesced` shield is ETA-bounded —
   once the `note`'s reset ETA is more than `WD_QUOTA_GRACE_SECS` (default 900s) in the past, the
   watchdog stops standing down and runs its normal tree: stale heartbeat + live pane → ONE nudge
   (which lands, since the window is open by now) → kill + re-wake only if the nudge doesn't take.
   Do NOT write a handoff and exit — the armed wake-up is the fast resume path, the backstop the
   guaranteed one; the first tick that RUNS is your evidence the window opened.

**Resume protocol (first successful tick):**
1. Heartbeat `status:"ok"` (+ `mode` per the clock) — this one write re-enters watchdog supervision.
2. STATE: `QUOTA-WAIT exited (waited <X>m)`; restore LIVE-STATUS.
3. Re-census the fleet (`tmux list-panes` / `/workflows`) — a pane may have died during the wait;
   reconcile per the cold-start rules before acting.
4. Un-hold workers (`SendMessage`: *"quota window reset — resume"*), resume normal pulse cadence.

**Residual risk (accepted, documented):** the resume path is layered, not absolute. (1) **No
watchdog installed** → an ETA beyond ~3600s has no automatic resume: the single armed wake-up dies
under the limit and the chain waits for the owner. (2) **The backstop keys off YOUR declared ETA:**
declared too early, the watchdog nudges/re-wakes into a still-closed window and burns restart
budget right before it's needed — that is why step 1 says err late. (3) **A pane that dies DURING
the wait** stays down until ETA + grace — the shield suppresses earlier re-wakes on purpose (they
would fail serially and exhaust the budget); a whole-session death with ≥2 recorded workers
escalates to the owner (mass-death rule) instead of restarting blindly. In every branch the ETA in
the heartbeat `note` tells the owner at a glance why everything is quiet.

After compaction, crash, or a fresh session days later — **do NOT reconstruct from memory and do NOT
"spawn fresh to be safe":**
1. The prior orchestrator MUST have written a dated handoff on exit. Read BOTH: `ORCHESTRATION-STATE.md`
   AND the highest-numbered `docs/handoff/NN-...md`. If no dated handoff exists, the prior orchestrator
   violated the session-boundary rule — reconstruct from the STATE file + live git as best you can.
2. **If the STATE file seems missing, stale, or context was lost: stay on-disk-first.** Before running
   ANY live probes or tools, read the highest-numbered `docs/handoff/NN-...md` on disk. Never skip the
   on-disk layer to jump straight to live tooling — the handoff is cheaper and usually sufficient to
   orient you. Run live probes (step 3) only AFTER reading what's on disk.
3. Confirm reality: `tmux list-panes`; `/workflows` survivors; `git fetch && git log origin/main..origin/<branch>`; `gh pr list`; tracker; highest-numbered handoff.
4. Reconcile: alive-in-file-but-gone = cycle ended (chain from its handoff); alive-with-no-report = in-flight (apply the idle tree, do NOT assume dead); adopt or terminate orphans BEFORE spawning. **When live git/gh contradicts the handoff: live truth wins — immediately overwrite LIVE-STATUS and append a CORRECTION note to the log (see Handoffs section for the exact mechanics).**
5. Never spawn until every pane/task is positively accounted for.
6. Once oriented (steps 1–3 done), append your first heartbeat line (Heartbeat protocol above) — you
   are inside the watchdog's startup-grace window; your first write is what ends it.

## Re-wake — automated restart by watchdog

When the mechanical watchdog declares the orchestrator dead, wedged, or over the context ceiling,
it kills the old session (explicit id ONLY) and starts a fresh `claude` session seeded with a
**re-wake brief** — the template in `references/re-wake-brief.md` (the watchdog script reads that
file and substitutes the `{{...}}` placeholders; keep template and this section in sync). Re-wake
is the cold-start protocol above run **unattended**: same steps, same on-disk-first order, plus
the deltas below. It never "resumes" the dead session — the fresh orchestrator is seeded purely
from durable state (STATE → newest dated handoff → heartbeat tail), never from the corpse's
context or transcript.

**If your session opened with a re-wake brief, you are that fresh orchestrator.** Run cold-start
steps 1–6 exactly, with these deltas:

| Manual cold-start | Watchdog re-wake (unattended) |
|---|---|
| A human started you and can answer questions | **Nobody is present.** NEVER block on AskUserQuestion: append a typed record to the question queue (Question buffer section), take the reversible default or park only the affected item, and continue on unblocked work. Only denylist items (BLOCKER) stay parked as `BLOCKED_ON_HUMAN`. |
| Restarting was a human's decision | Restart is **counted** — the watchdog's restart budget (GSL-53 tooling: N-in-window + backoff, escalate-and-STOP on exhaustion). The brief carries `restart N of M`; treat a high N as a signal, not trivia. |
| Predecessor usually rolled cleanly (dated handoff written) | Predecessor likely died mid-flight: the newest handoff may be stale or truncated — apply the suspect-handoff rules; live git/gh wins. |

**Idempotency — reconcile-then-dispatch, never double-dispatch:**
- Fleet re-census BEFORE any acting step: `tmux list-panes`, `/workflows`. A live worker is
  **ADOPTED** — leave it running, record it in LIVE-STATUS, apply the normal idle/liveness tree.
  Never re-spawn a live worker: the prior orchestrator's death does not invalidate its workers.
- Never spawn until every pane/task is positively accounted for (cold-start rule 5, verbatim).
- Running the same brief twice must be harmless: if STATE already records this restart AND the
  heartbeat is advancing again, another orchestrator beat you — exit quietly (no writes, no spawns).

**First acts, in order:** (1) on-disk reads (STATE → newest handoff → `tail -5` heartbeat);
(2) fleet census + reconcile; (3) FIRST heartbeat line — `status:"ok"`, `note:"re-wake: <reason>"`
(this ends the watchdog's startup grace); (4) restart record appended to the STATE log:
`- ORCHESTRATOR RESTARTED (re-wake; reason=<...>; restart N/M; adopted=[...])`; (5) resume the
pulse — never end a turn without an armed wake-up while workers are live.

**Anti-crash-loop — the watchdog's half vs yours.** The watchdog owns the budget: after N restarts
in the window it STOPS restarting and escalates to the owner (GSL-53 — "never mask an orchestrator
bug with a restart loop"); do not re-implement that here. YOUR half: read the heartbeat tail and
STATE log for prior re-wake records. If predecessors died repeatedly at the same point, do NOT
charge into that same action — park the item and advance on a different unblocked path; if nothing
is safe to advance, wind down deliberately (supervise live workers to natural COMPLETE, spawn
nothing new, write a dated handoff naming the killer, end with a `status:"quiesced"` heartbeat
once `open_workers` is 0) so the watchdog stops instead of burning budget on the same wall.

## Orchestrator self-monitoring (roll before you're compacted)

Your longevity is the whole point, but you are not immortal. Self-monitor your OWN context; at **~70%**
(earlier than a worker — a mid-chain compaction can orphan a live worker), roll at a **clean boundary**
(worker terminated, nothing spawned): ensure `ORCHESTRATION-STATE.md` is current with the **latest
cumulative TELEMETRY block** (cycles_completed, tokens_total, open_workers), **write/refresh a
DATED handoff file** (`docs/handoff/NN-YYYY-MM-DD-...md`) capturing the exact resume point, then
start a fresh orchestrator pointed at BOTH the STATE file and the dated handoff, **explicitly passing
the cumulative telemetry + budget tallies** from the TELEMETRY block so the new orchestrator resumes
running totals rather than resetting to zero, then exit. Do this at EVERY session boundary (restart,
roll, compaction, or planned pause) — updating only the STATE file is not enough. Plan to roll roughly
every **~8–15 cycles** rather than assuming immortality. Last act before exiting the session: append
a `status:"rolling"` heartbeat line (Heartbeat protocol above) so the watchdog expects a successor
instead of counting you dead; if the chain is DONE (no successor, no live workers), append
`status:"quiesced"` with `open_workers:0` instead.

**HARD GATE — before any roll/compact/handoff/fresh-orchestrator, confirm EVERY worker is TERMINATED.**
"I'm low on context" does not override this rule. Rationalization ("I'll roll now and the worker will
be fine") is wrong — rolling with a live worker orphans it: the orphan keeps running, may write to
shared files, corrupt the chain, or consume budget with no supervision. The ONLY safe sequences are:
- **Wait:** receive the worker's COMPLETE `SendMessage` report → confirm terminated (per surface) →
  THEN update STATE + write dated handoff + start fresh orchestrator.
- **Terminate first:** send `shutdown_request` → receive `shutdown_response{approve:true}` (or
  hard-kill per surface) → CONFIRM dead (pane gone from `tmux list-panes` re-list, or `TaskStop`
  success) → THEN update STATE + write dated handoff + start fresh orchestrator.

**CRITICAL — "Terminate first" ≠ "kill to roll faster."** The `shutdown_request` path exists ONLY
when a worker has reached a natural stopping point and can cleanly exit. It is NOT a license to
force-terminate a productive, mid-cycle worker just to reach a clean boundary sooner. Sending
`shutdown_request` to a worker actively producing work is orphaning by another name — you lose its
in-progress output. The clean boundary must be reached NATURALLY (the worker self-quiesces with a
COMPLETE report, THEN you terminate), never FORCED. If you're low on context while a worker is
mid-cycle: (A) wait for its natural COMPLETE `SendMessage` and self-quiesce, or (B) let it finish
its current task and self-quiesce — NEVER send `shutdown_request` or kill a PRODUCTIVE live worker
to roll faster.

There is no "roll now and deal with the worker later." If you cannot terminate cleanly and cannot
wait, surface `BLOCKED_ON_HUMAN` — do not roll.

## Cost & runaway control

- Agree a **max cycle count and/or aggregate-token ceiling** up front; after EVERY worker terminates, APPEND one telemetry line to the TELEMETRY block of ORCHESTRATION-STATE.md (format and example in the STATE file section above — do this BEFORE spawning the next cycle; never defer).
- **Mandatory TELEMETRY in every worker brief:** every cycle brief MUST include a requirement that the worker reports a telemetry line at the end of its COMPLETE report: `tokens_out=N tokens_in=N cache_read=N`. Tally each cycle into the STATE TELEMETRY block before spawning the next cycle. This is not optional — it is the only way cumulative cost tracking stays accurate.
- **Token recovery when a dead worker failed to report tokens:** (1) RECOVER — range-read ONLY the `## ORCHESTRATOR REPORT` block of the dead worker's handoff file (the existing read-exception covers exactly this — see "Common mistakes"); extract token counts from that block. (2) If the report block is absent or the file cannot be found: report the verified subtotal from other cycles with the gap EXPLICITLY FLAGGED — e.g. `tokens_this_cycle=UNRECOVERED — gap flagged; cumulative excludes this cycle`. NEVER fabricate an aggregate to fill the gap. NEVER say "data not available" and move on as if the cost didn't happen. The gap must be visible in the TELEMETRY block.
- On ceiling → STOP and surface `BUDGET_EXCEEDED` as a decision fork. A ceiling is a hard budget
  boundary, NOT a breaker signal — it never cools down and never HALF_OPEN-probes.
- **Loop guard:** two consecutive cycles with the same / non-advancing `NEXT`, or N cycles with no
  new merged PR, = no forward progress. A chain with no forward progress is a runaway, even if it
  looks busy. These two signals do not hard-stop on their own anymore — they feed the circuit
  breaker (next section), which stages the response: OPEN → cooldown → one probe → owner.

## Circuit breaker — staged anti-runaway (extends the loop guard)

A bare hard-STOP loop guard has two overnight failure modes: a transient flake trips it
PERMANENTLY (false halt — nobody is awake to un-stick it), and runaway shapes it doesn't watch
(the same error recurring cycle after cycle, output quietly shrinking) spin unnoticed. The breaker
keeps the loop-guard signals, adds ralph's, and stages the response with state + cooldown + a
single probe (ralph-claude-code `lib/circuit_breaker.sh`; counters human-resettable per autosk).

**States:** `CLOSED` (normal) → `OPEN` (tripped) → `HALF_OPEN` (one probe after cooldown) →
`CLOSED` on success / back to `OPEN` on failure.

**Trip signals — counted at every cycle boundary, persisted in STATE:**

| Signal | Trips at (default) | Counting rule |
|---|---|---|
| Non-advancing `NEXT` (loop guard) | 2 consecutive cycles | same/unchanged `NEXT` across a boundary = +1; any advance resets |
| No new merged PR (loop guard) | 3 cycles (owner-set) | resets on any merge |
| Same error signature | 3 consecutive cycles | signature = first line of the failing gate/tool error, paths/timestamps normalized; a DIFFERENT error resets the count (new information ≠ spinning) |
| Output/progress decline | 2 consecutive cycles | cycle produced < ~30% of the chain's typical substance (commits + report content — ralph's >70% decline); git motion counts toward progress, never toward completion |

Any single signal at threshold → **OPEN**.

**On OPEN:** spawn nothing new (live workers finish NATURALLY — the breaker never kills productive
work); write the breaker line to STATE (below); escalate to the owner — OPEN is on the night-mode
critical list, so it escalates immediately even at night; append `note:"breaker=OPEN"` to the next
heartbeat. Keep pulsing (long-waiting cadence): supervising the wind-down and honoring the cooldown
still need a live pulse.

**Cooldown → HALF_OPEN → probe:** after the cooldown (default 30 min) move to `HALF_OPEN` and run
EXACTLY ONE probe cycle — the smallest unblocked task, fresh context, normal worker tier. Probe
advances for real (gates green + a genuine commit/PR advance, and the tripping signal did not
recur) → `CLOSED`, zero the counters, log `BREAKER closed by probe`. Probe fails or re-trips →
back to `OPEN`, escalate again, DOUBLE the cooldown (cap ~2h), and run NO further probes until the
owner resets — a repeatedly-OPEN breaker is an owner problem, not a retry problem.

**The breaker line — STATE persistence + manual reset.** One line, kept next to the TELEMETRY
block, updated atomically at every cycle boundary:
```
breaker=CLOSED since=<ISO ts> next_probe=- counters: next_same=0/2 no_pr=0/3 err_same=0/3 decline=0/2 last_error_sig=""
```
Human-resettable (autosk phone-editable counters): the owner edits the line to `breaker=CLOSED`
with zeroed counters — from a phone via the repo if need be. The orchestrator re-reads the line
every pulse and OBEYS THE FILE (STATE is the authority): never argue with a manual reset — log
`BREAKER manually reset by owner` and resume. A replacement/re-woken orchestrator inherits the
line as-is: **a restart does not reset the breaker** (that would mask the bug the breaker caught).

**Adjacent rails — related, never conflated:**
- **Watchdog restart budget** (GSL-53) guards orchestrator DEATH loops at the process level; the
  breaker guards a LIVE chain that stopped producing. Both exist to stop masking a real bug.
- **Re-wake anti-crash-loop** ("predecessors died at the same point → don't charge in") is the
  post-restart cousin; an OPEN breaker line in STATE binds a re-woken orchestrator too.
- **`BUDGET_EXCEEDED`** is a ceiling: STOP + fork, no cooldown, no probe.

## Security & worker authority

Guardrails matter MORE with no human in the loop.
- **Least privilege** per cycle (above).
- **Denylist — surface as `BLOCKED_ON_HUMAN`, never do autonomously:** force-push / rewriting published history, deleting branches/tags/releases, prod deploys, secret rotation, destructive DB migrations on shared data, external communications, deleting cloud/infra resources.
- "Merge green PR + advance" authority covers **reversible, in-repo delivery only** — not the denylist.

## Model economy & the execute-nothing rule (hard-won; one violation burned ~1/3 of a weekly token limit)

- **The orchestrator executes NOTHING — not even reviews.** Workflow results returning into your
  context are the longevity killer (one audit result = ~15k chars of your window). Everything runs in
  disposable teammates; only ≤~12-line reports enter your context.
- **Three model tiers:** the orchestrator may sit on the premium model (it only coordinates — tiny
  volume); workers and reviewers run on the mid tier; ALL verification runs on the cheap tier. Split by
  hang risk: a **hang-prone long-running tool** the worker must run itself is spawned BY THE WORKER as a
  cheap-tier BACKGROUND subagent (`run_in_background: true`, no `name` — non-blocking, the worker stays
  reachable by mail, killable via `TaskStop` — see worker template), NEVER a plain SYNCHRONOUS in-process
  subagent that would freeze its parent's turn if it hangs, and NEVER a teammate (the roster is FLAT — a
  worker cannot spawn a teammate; only the orchestrator can — and for any USER-FACING SURFACE that
  orchestrator-run, pane-visible path is now the live-validated DEFAULT (the worker requests it by
  `SendMessage`; see the next bullet), the background subagent reserved for a hang-prone NON-browser tool
  the worker must run itself); fast non-browser checks (skeptics, mechanical re-checks) run as plain single
  cheap subagents the worker/reviewer spawns. ALWAYS pass `model:` explicitly when spawning —
  subagent/teammate defaults differ from what you expect.
- **Orchestrator-run verification of user-facing surfaces (VERIFY-REQUEST — live-validated default).**
  A worker that never drives a browser can never be frozen by one, so for any user-facing surface the
  worker does NOT spawn even a background browser-verifier — when the surface is ready (gates green,
  committed) it sends YOU a `VERIFY-REQUEST` and then HOLDS every shared-resource operation (builds,
  server starts — shared port + `.next`), doing only read-only/docs work until your ALL-CLEAR. The request
  must carry routes, flows-to-check, a creds pointer, and explicit DEGRADED-state definitions (what PASS
  looks like with no keys/credentials/providers — else normal degradation gets reported as bugs). YOU
  spawn the verifier as a cheap-tier teammate in its OWN pane (the flat roster is exactly why the worker
  must request, not spawn), brief it with the current known-automation-traps + the instrumented-verifier
  contract (a `steps.log` heartbeat + an incrementally regenerated HTML report — see E17), arm the
  watchdog (above), then relay the verdict back; on critical/major findings tell the worker to FOLD before
  it resumes. Verifiers self-report their model in the result — a mismatch is noted, never retried in a loop.
- **Workers get NO multi-agent Workflow tool** (ban it in the brief; watch /workflows and kill
  worker-owned runs). Prompt-level caps get ignored under pressure; mechanism-level caps hold. A
  worker that "reviews" by fanning out N fresh skeptics re-reads the same diff N times — the
  documented anti-pattern.
- **Boundary reviews = disposable reviewer-teammate per cycle** (mid-tier model): reads the PUSHED
  diff pinned to a SHA via `git show` (off-tree — may run in parallel with the next editing cycle),
  runs 3-4 review lenses ITSELF sequentially in one context, dedupes, then ONE cheap-tier grouped
  skeptic verifies only critical/major findings (with code quotes). Full report goes to a FILE
  (`<project>/docs/reviews/REVIEW-<cycle>.md` — gitignored, never committed); the orchestrator gets
  ≤12 lines (counts + path + top-3) and relays the PATH to the next cycle — findings never transit
  the orchestrator's context. **All orchestration artifacts — handoff temps, review reports,
  screenshots, scratch files — live INSIDE the project working tree under project-scoped paths;
  `/tmp` is forbidden (machine-global → cross-project collisions, OS-purged, invisible to the project).**

## Visibility surfaces

- **Agent Teams** → tmux **split panes** (`teammateMode` is panes, never windows; don't `break-pane` unless the human wants windows). Background (non-team) subagents do NOT appear in tmux.
- **Workflow** (`/workflows`) → orchestrator-authored bounded fan-out. Use ONLY for one-off preflight audits where no editing chain is running yet, with caps written IN THE SCRIPT CODE (`slice(0,N)`, explicit cheap `model:` per agent) and the result returned as a tiny summary + a report FILE — never a full findings dump into your own context. During an active chain, prefer reviewer-teammates (above).

## Concurrency & git safety

- **One editing cycle per working tree.** Git checks out one branch per tree; two editors corrupt each other. Sequence editing work; don't parallelize it in one tree.
- **Never force-push a shared delivery branch** (`--force`/`--force-with-lease` banned on any branch another cycle touched). On push rejection: `git fetch` + rebase/merge `origin/<branch>`, re-run gates, push.
- **Merge freshness:** before merging, confirm checks are green ON THE CURRENT HEAD and the PR is up to date (`gh pr view <n> --json mergeStateStatus` → `CLEAN`). Merging A invalidates B's base → tell B to rebase onto new main and re-run gates.
- A **read-only review** may run during an editing cycle, but pin it to an immutable ref (`gh pr diff <n>`, or a throwaway `git worktree add` at a fixed SHA) — a live edited tree can yield a self-inconsistent snapshot.
- `isolation:'worktree'` for parallel *editing* is rarely worth it: a fresh worktree lacks `node_modules` and gitignored `.env.local`, so builds/tests fail there. Sequencing usually beats it.

## Handoffs

- Workers write their own (structure in `references/worker-cycle-template.md`) — self-contained, every fact from a live tool, **resume-point first**, plus a top `## ORCHESTRATOR REPORT` block.
- **Write atomically** (write a same-directory hidden temp `docs/handoff/.NN-...md.tmp`, then rename into `NN-...md` — same-dir rename is atomic and project-scoped) so a worker dying mid-write can't leave a truncated baton; rename a detected partial to `.partial`.
- **Numbering is not automatic** — derive the next number deterministically (read the dir, max `NN`, +1).
- **Live git wins over any handoff.** The newest handoff is NOT auto-trustworthy if its author died: sanity-check its branch/commits/PR/IDs against `git log`/`gh pr list` and that it isn't truncated; if suspect, fall back to the prior handoff + committed state.

**Concrete mechanics when live truth contradicts a handoff (suspect-handoff state update):**
DO NOT proceed with stale data. IMMEDIATELY do ALL of the following (atomically via hidden temp):
1. Overwrite the LIVE-STATUS block with the live fact. Example: handoff says `pr=TBD`, but
   `gh pr list` shows PR #42 open → update LIVE-STATUS to `pr=#42 (open)`.
2. Append a correction note to the current cycle's log entry. Example:
   ```
   - CORRECTION: handoff claimed pr=TBD; live gh shows PR #42 open. LIVE-STATUS updated.
   ```
3. If the handoff listed a PR/SHA/issue-# that doesn't exist in live git/gh, note it as stale
   and use the live fact. Never carry a contradicted ID forward.

**Concrete mechanics for a late-arriving ID (e.g. PR# or GH issue# arrives after TBD was written):**
Find the exact line in ORCHESTRATION-STATE.md containing the TBD/placeholder and REPLACE it
in-place (idempotent atomic rewrite via hidden temp). Never add a second line; never leave TBD
standing. Example: log entry reads `- GSL-30: gh issue TBD`; worker later reports `GH #34` →
find that line, replace with `- GSL-30: gh issue #34 (https://github.com/org/repo/issues/34)`.
The update is idempotent: if the real ID is already there, do nothing.

## Decision forks (when to pause for the human)

Proceed autonomously on reversible green delivery (merge green PRs, advance phases) under granted authority.
**Pause and ask** (AskUserQuestion) at genuine forks: missing credentials, anything on the denylist,
irreversible/destructive actions, ambiguous product decisions, a completed milestone with no unblocked
next step, `BUDGET_EXCEEDED`, or a worker the escape-hatch escalated.

## Starting a chain from zero

A new project has no handoffs. Before cycle #1:
1. Prereq: a written plan/roadmap (`superpowers:writing-plans`).
2. Confirm with the human (this fills the template slots): autonomy level, the **gate commands for THIS stack**, tracker (or none), base branch, handoff dir + numbering, and the working-tree/parallelism strategy.
3. Cycle #1 has no resume handoff — brief it from the plan and have it CREATE the handoff dir + handoff `01-...` and `ORCHESTRATION-STATE.md`.

## Quick reference

| Situation | Do |
|---|---|
| Pulse / wake-up tick begins | FIRST act: append heartbeat JSON line to `docs/handoff/.orchestrator-heartbeat` (atomic temp+rename, self-truncating — snippet in Heartbeat protocol). THEN the HEARTBEAT_OK checklist: inbox / census / progress probe / clocks — all green = re-arm + end turn, nothing else read or written. |
| Ending a turn, `open_workers > 0` | ARM a wake-up (ScheduleWakeup) — ALWAYS. Delay by cadence table: ~270s active monitoring / ~540s stable waiting / 1200–1800s long waiting; NEVER ≥300 and <540s (dead zone). |
| Pulse crosses into the night window (or owner signs off) | `MODE → night` in STATE log; heartbeat carries `mode:"night"`; non-denylist questions → typed record in the question queue + reversible default; escalations buffered except critical; long-waiting cadence. |
| Morning boundary (first pulse inside activeHours) | `MODE → day` in STATE log; surface ALL buffered questions/escalations in ONE owner summary. Buffered items stay open in STATE until answered — never silently dropped. |
| Session limit hit (`You've hit your session limit` / StopFailure rate_limit) | Quiesce: hold workers (no kills, no spawns), STATE `status=quota-wait until=<ETA>`, heartbeat `status:"quiesced"` + `note:"quota-wait until <ETA>"` (`open_workers` = real count), arm ONE wake-up `min(3600s, ETA+~120s)` — a limited tick can't re-arm, so no hop chains; ETA > 1h out → resume falls to the watchdog alarm-clock (quiesced shield drops past ETA + `WD_QUOTA_GRACE_SECS`). STAY in session. First tick that runs = resume: heartbeat ok, re-census, un-hold. |
| Ending a session (roll / chain done) | Final heartbeat line: `status:"rolling"` (successor expected) or `status:"quiesced"` + `open_workers:0` (chain done — watchdog must not restart). |
| Worker idle, no report | Liveness-rank check (report/pane/`/workflows`/git). Idle ≠ stopped, idle ≠ stuck. |
| About to spawn next cycle | Confirm prior worker TERMINATED (per surface). |
| About to roll / compact / hand off to fresh orchestrator | HARD GATE: confirm EVERY worker TERMINATED first (pane gone from re-list or `TaskStop` success). Never roll with a live worker. |
| Low on context, worker is mid-cycle (productive) | WAIT for natural COMPLETE / current task to finish. NEVER send `shutdown_request` or kill a productive worker to force a roll boundary — that is orphaning. Cannot wait → `BLOCKED_ON_HUMAN`. |
| Terminate | Pane → `tmux kill-pane`; background → `TaskStop(task_id)`. Worker replies `shutdown_response{approve}`. |
| Committed all tasks, quiet (patience window not elapsed) | Normal — patience. Idle ≠ stuck. Do NOT nudge yet. |
| Committed all tasks, no PR/report past patience window | ONE concrete nudge — exact wording: *"All tasks committed but no PR/handoff after [elapsed]. Please open the PR or write the handoff now — I'll wait for your reply."* Then wait. Never re-nudge; never spawn a duplicate while alive; never "keep monitoring"; never wait past ceiling without escalating. |
| Pane alive + all tasks committed + no PR + patience window elapsed | FINALIZE EXCEPTION: check time ceiling FIRST. Send ONE concrete finalize nudge NOW — pane-alive does NOT exempt you at a finalize stall past the ceiling. |
| Silent + no git progress, dirty tree | Directive nudge (commit/revert WIP); still stuck → `BLOCKED_ON_HUMAN`. |
| Check progress | `git fetch` then `git log origin/main..origin/<branch>`; `gh pr view <n>`. Never the transcript. |
| Lost the thread (compaction/restart) | Read `ORCHESTRATION-STATE.md` + confirm reality; never "spawn fresh to be safe". |
| Session opened with a re-wake brief (watchdog restart) | Cold-start steps 1–6 + unattended deltas: ADOPT live workers (never re-spawn), buffer questions as typed queue records (no AskUserQuestion-block), heartbeat `note:"re-wake: <reason>"`, restart record in the log. |
| Worker just terminated | APPEND telemetry line to ORCHESTRATION-STATE.md TELEMETRY block NOW (before spawning next cycle): `cycle=N worker=<name> model=<model> tokens_out=<N> tokens_in=<N> cache_read=<N> \| running: cycles=N total_tokens=T` |
| Live git/gh contradicts handoff | Live truth wins: overwrite LIVE-STATUS block + append `CORRECTION:` note to cycle log (atomic via hidden temp). Never carry contradicted IDs forward. |
| Late-arriving ID (PR#/issue# after TBD written) | Find the TBD placeholder line in STATE; replace in-place (idempotent). Never add a second line; never leave TBD standing. |
| Cost ceiling | Cumulative totals in TELEMETRY block → STOP + surface `BUDGET_EXCEEDED` when hit. Ceiling ≠ breaker: no cooldown, no probe. |
| Breaker signal at threshold (same `NEXT` ×2 / no new PR ×3 / same error ×3 / output decline ×2) | OPEN: spawn nothing, breaker line in STATE, escalate (critical — even at night), keep pulsing. Cooldown 30m → ONE HALF_OPEN probe → CLOSED on real advance; re-trip → OPEN, cooldown ×2, no more probes until owner reset (edit the breaker line). Restart never resets the breaker. |
| Dead worker's tokens not reported | (1) Range-read ONLY the `## ORCHESTRATOR REPORT` block in its handoff — extract tokens from there. (2) If still unrecoverable: record `tokens_this_cycle=UNRECOVERED — gap flagged` in TELEMETRY. NEVER say "unavailable" and move on. |
| Irreversible action requested | Denylist → `BLOCKED_ON_HUMAN`. |

## Common mistakes

- **Reading heavy files yourself** (handoff bodies, source, transcripts) → orchestrator runs out of context. Relay paths + compact reports. The ONE narrow exception: a **range-read of ONLY the top `## ORCHESTRATOR REPORT` block** of a **DEAD worker's HANDOFF FILE** to recover a lost report. This exception never covers: (a) any transcript (dead or live), (b) a live worker's files, (c) reading the full handoff file, or (d) any other heavy file. Do not stretch it.
- **Keeping chain state only in chat** → a compaction/restart orphans workers. State lives in `ORCHESTRATION-STATE.md`.
- **Heartbeat written last / skipped on a "nothing changed" pulse / committed to git / fabricated `context_pct`** → the watchdog either restarts a healthy orchestrator or trusts a corpse. The heartbeat is the FIRST act of EVERY pulse (a pulse with nothing to do still writes it), gitignored, honest numbers only.
- **Rolling with only STATE updated, no dated handoff** → the next orchestrator has no resume point; it must probe live tools blind. Write a dated `docs/handoff/NN-...md` at EVERY session boundary.
- **Spawning a replacement before confirming termination** → duplicate/destructive work.
- **Killing on the first idle** → you kill productive workers. Patience + liveness-rank + git first.
- **"Keep monitoring" / "wait and see" at a finalize stall** (patience window elapsed, no PR/report) → the chain never moves. These phrases are not decisions. Send ONE concrete nudge (verbatim wording in the patience-vs-nudge section above); after that, either wait for reply or escalate. There is no "keep watching" path.
- **Rolling/handing off with a live worker** → orphans it; the orphan may write shared files, corrupt the chain, or consume budget with no supervision. "I'm low on context" does not override this. The sequence is ALWAYS: wait-for-COMPLETE-report OR terminate+confirm-dead (per surface), THEN roll. Rolling first is always wrong.
- **Sending `shutdown_request` to a productive mid-cycle worker to force a roll boundary** → this is orphaning by another name. You lose its in-progress output. The "terminate first" path exists only for workers at a natural exit point, not to clear the decks for your own roll. Wait for COMPLETE or current-task-finish; NEVER force-terminate a productive worker just to roll sooner.
- **`git status` as the kill gate / against a live tree** → hides unsaved source or misreports. Use `git status --porcelain` for the safe-to-kill check; probe off-tree.
- **Letting workers send verbose reports** → their prose is permanent in your context. Keep `SendMessage` tight (~12 lines, no logs/diffs).
- **Two editing workers, one tree** / **force-pushing a shared branch** → corruption / lost commits.
- **Assuming handoff numbers auto-increment** → drift/collisions.
- **Skipping the telemetry append after a worker terminates** → cost tracking goes dark; the TELEMETRY block becomes stale. "I'll tally it later" means it never happens. Write the line BEFORE spawning the next cycle, even if token counts are approximate. Format: `cycle=N worker=<name> model=<model> tokens_out=<N> tokens_in=<N> cache_read=<N> | running: cycles=N total_tokens=T`.
- **"Tokens weren't reported — I'll mark it unavailable and move on."** → the cost still happened; skipping it fabricates a lower total. RECOVER via range-read of the dead worker's `## ORCHESTRATOR REPORT` block in its handoff. If unrecoverable, write `tokens_this_cycle=UNRECOVERED — gap flagged` to the TELEMETRY block. Never silently omit a cycle's cost.
- **Omitting the TELEMETRY requirement from a worker brief** → the worker never knows it must report tokens in its COMPLETE message, so the data goes dark from the start. Every brief must include: *"End your COMPLETE report with a telemetry line: `tokens_out=N tokens_in=N cache_read=N`."*
- **Carrying a stale/contradicted ID or TBD forward** → the STATE file accumulates lies; a recovery orchestrator acts on wrong data. When live git/gh contradicts the handoff: (1) overwrite LIVE-STATUS with the live fact, (2) append a `CORRECTION:` note to the cycle log — both atomically. When a late-arriving ID resolves a TBD: find the placeholder line and replace it in-place; never add a second line and never leave TBD standing.

## Red flags — STOP

- "It's idle, must be done/stuck — I'll spawn the next one." → Confirm termination; liveness-rank first.
- "I'll just kill it." (after one idle, <window, unknown git/liveness) → Patience + check first.
- "I got compacted — I'll spawn fresh to be safe." → No. Read `ORCHESTRATION-STATE.md` + list panes/workflows.
- "Updated STATE + chat summary, that's enough to restart." → No: write a dated handoff too. STATE + chat without a dated handoff leaves the next orchestrator with no resume point.
- "STATE file not found → I'll just probe live tools." → No: read the newest on-disk handoff (`docs/handoff/NN-...md`) FIRST. On-disk layer before live tooling, always.
- "Let me read the handoff/source to understand." → No (except a dead worker's top report block — handoff file only, range-read, not the transcript).
- "The exception lets me read the transcript / the full handoff / a live worker's file." → No. The exception is a range-read of ONLY the top `## ORCHESTRATOR REPORT` block of a DEAD worker's HANDOFF FILE. Transcripts are never covered.
- **"I'll keep monitoring." / "I'll wait and see." / "Give it more time." / "Continue watching."** (at finalize boundary, patience window elapsed, no PR/report) → **STOP. These phrases are not actions — they permanently stall the chain.** Send EXACTLY ONE concrete nudge: *"All tasks are committed but no PR or handoff report after [elapsed time]. Please open the PR or write the handoff now — I will wait for your reply before taking any other action."* Then wait for the reply. The only valid moves at a finalize stall: keep waiting (window NOT elapsed) | ONE nudge (window elapsed) | kill/escalate (nudge unanswered past ceiling). Nothing else.
- **"The pane is still alive, so I'll keep waiting."** (at a finalize stall — all tasks committed, no PR/report, patience window elapsed) → **NO. Pane-alive ≠ exempt past the ceiling.** `pane-alive → WAIT` is correct for mid-cycle idle only. At a finalize stall past the patience ceiling, CHECK THE TIME CEILING FIRST (FINALIZE EXCEPTION in the flowchart) — then send ONE concrete finalize nudge NOW regardless of pane state. Example: *"All tasks are committed but no PR or handoff report after [elapsed]. Please open the PR or write the handoff now — I will wait for your reply."*
- **"I'm low on context, I'll roll / compact / start a fresh orchestrator now."** (while a worker is alive and unterminated) → **HARD BLOCK. You will orphan the live worker.** "Low on context" never overrides the termination gate. The ONLY safe sequences: (A) wait for the worker's COMPLETE `SendMessage` report → confirm terminated → THEN roll; or (B) send `shutdown_request` → receive `approve:true` → confirm dead (pane gone from re-list or `TaskStop` success) → THEN roll. Example correct action: *"My context is at 73%. I have a live worker (cycle-13). I will wait for its COMPLETE report before rolling. I will NOT hand off yet."* If you cannot wait or terminate, surface `BLOCKED_ON_HUMAN`.
- **"I'm low on context and a worker is busy mid-cycle — I'll shut it down so I can roll at a clean boundary."** → **NO. Killing a productive worker to force a roll boundary is orphaning by another name — you lose its in-progress output.** The clean boundary must arrive NATURALLY (worker self-quiesces with COMPLETE, then you terminate). Wait for the natural COMPLETE or let it finish its current task and self-quiesce. NEVER send `shutdown_request` or kill a productive live worker to roll faster. If you truly cannot wait, surface `BLOCKED_ON_HUMAN`.
- **"The worker didn't report its tokens, so I'll note it as unavailable and move on."** → **NO. RECOVER first:** range-read ONLY the `## ORCHESTRATOR REPORT` block of the dead worker's handoff file (the read-exception covers this). If tokens are in that block, extract and tally them. If truly unrecoverable, record `tokens_this_cycle=UNRECOVERED — gap flagged` in the TELEMETRY block. NEVER fabricate totals; NEVER omit the gap as if the cycle had zero cost.
- "Nothing changed this pulse — I'll skip the heartbeat write." → No. The heartbeat proves LIVENESS, not progress. Skip it and the watchdog's staleness clock runs toward a false restart of a healthy chain. Write it FIRST, every pulse.
- **"Workers are busy — I'll end my turn; they'll message me when done."** → No. A live fleet with
  no armed wake-up is a silent quiesce: a wedged worker never messages, the pulse stops, the
  heartbeat goes stale. EVERY turn with `open_workers > 0` ends with `ScheduleWakeup` (cadence
  table). "I'll check back in 5 minutes" is doubly wrong — unarmed intent AND the ≥300/<540s dead zone.
- **"The watchdog re-woke me — I'll ask the owner how to proceed." / "Predecessor died, so its
  workers must be dead too — I'll respawn the fleet."** → No, twice. Re-wake is UNATTENDED: buffer
  questions as typed records in the question queue and continue on unblocked work — only denylist
  items park. And a dead orchestrator does NOT invalidate its workers: re-census (`tmux list-panes`,
  `/workflows`) and ADOPT live workers; re-spawning them is double-dispatch.
- **"Session limit hit — I'll write a handoff and exit; the watchdog will restart me after reset."**
  → No. Re-wakes during the limit fail serially and burn the restart budget; the watchdog
  deliberately stands down until ETA + grace (the alarm-clock backstop), so exiting early just
  delays resume to the backstop's worst case. Quiesce IN PLACE: hold workers, `note:"quota-wait
  until <ETA>"`, arm ONE `min(3600s, ETA+~120s)` wake-up, stay in the session — the wake-up is the
  fast resume path; the watchdog's expired-ETA re-wake is the guaranteed one.
- **"Quota exhausted — the workers are stuck, I'll kill them and respawn fresh after reset."** → No.
  They are held, not stuck: panes keep in-flight state and resume free when the window opens.
  Killing them trades a free resume for a paid rebuild. Kill nothing, spawn nothing, wait.
- **"It's 3am but this question genuinely matters — I'll AskUserQuestion / ping the owner."** → No.
  In night mode ONLY BLOCKER-type items (denylist, credentials, irreversible) may wake the owner.
  Everything else: typed record in the question queue + reversible default (or park just that
  item) + reroute the worker + surface it at the morning boundary. A 3am question the owner can't
  answer is a stalled pane, not diligence.
- "It's been merged, I'll keep chaining." (same `NEXT` twice / no new PR / same error again) →
  Breaker signal: count it in the STATE breaker line; at threshold → OPEN, not "one more cycle".
- **"The breaker is OPEN but I'm confident the next cycle will work — I'll spawn it."** → No. OPEN
  means NO new spawns, full stop. The path back is exactly one: cooldown → ONE HALF_OPEN probe →
  CLOSED only on a real advance. A failed probe returns to OPEN and waits for the OWNER's manual
  reset (edit the breaker line) — never a second probe on your own initiative, and a restart/re-wake
  never resets the breaker either.
- "Full authority, so I'll force-push / deploy / drop-table." → Denylist → `BLOCKED_ON_HUMAN`.

## Reference files

- `references/worker-cycle-template.md` — the reusable cycle-worker prompt, handoff-body skeleton, compact-report contract, idempotent-creates (find-or-create by stable key + reconcile late-arriving IDs) and security hard rules.
- `references/lifecycle-and-edge-cases.md` — spawn mechanics per surface (incl. background-only mode), liveness signals, the full edge-case catalog with correct handling.
- `references/re-wake-brief.md` — the machine-consumed prompt template a mechanical watchdog passes to a fresh orchestrator session after killing/losing the previous one (placeholders + unattended rules; see "Re-wake" section).

**Related skills:** `superpowers:writing-plans` (plan a milestone before cycles), `handoff` (REQUIRED at orchestrator session boundaries — a baton format helper), `delivery-workflow` + `using-jira` (one team's delivery mechanics workers follow), `superpowers:dispatching-parallel-agents` (pure fan-out), `superpowers:receiving-code-review` (apply review findings with judgment).
