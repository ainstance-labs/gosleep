# Loop engineering — community state of the art for autonomous agent loops (2025–2026)

> Research worker: res-loops · Date: 2026-07-07 · Phase: GSL-41 orchestration research
> Sources: primary repos in `.research-cache/` (ralph-claude-code, gastown, autosk, warren, overstory, claude-squad), web primary sources (dated + linked inline).
> Goal lens: gosleep = an orchestrator that runs overnight without a human.

## 1. What "loop engineering" is (plain-language canon)

**The one-sentence definition:** loop engineering is the discipline of wrapping a coding agent in an
*outer* control loop — restart it fresh, feed it persistent state from disk, check progress, decide to
continue / stop / escalate — so that useful work continues past any single context window and without a
human pressing "continue".

The insight that started the field: an LLM agent is already a loop (the *inner* loop: model → tool call →
result → model, until the model stops). That inner loop dies with its context window. The community's
answer was embarrassingly simple: **put a `while true` around the whole agent** and make the filesystem +
git the memory that survives each iteration. Everything since — stop conditions, budgets, circuit
breakers, checkpoints — is engineering discipline layered onto that `while true`.

A vocabulary map, introduced gradually as it appears below:
- **Inner loop** — the agent's own think→tool→observe cycle inside one context window.
- **Outer loop** — the harness that re-invokes the agent across context windows (the `while true`).
- **Harness** — everything around the model: tools, state files, restart logic, guards. "Harness
  engineering" and "loop engineering" are near-synonyms; "loop engineering" stresses the restart cycle.
- **Stop condition / definition-of-done** — the machine-checkable predicate that ends the outer loop.
- **Circuit breaker / loop guard** — detectors that halt a loop making no progress (runaway protection).
- **Checkpoint & resume** — durable state written at boundaries so a fresh agent can continue.
- **Park / escalate** — routing a stuck task to a human queue instead of retrying forever.

## 2. Origin story and the canon (dated primary sources)

**Phase 0 — the agent IS a loop (2024–early 2025).** Anthropic's "Building effective agents"
(Dec 2024) and Thorsten Ball's "How to build an agent" popularized the observation that a coding agent
is ~300 lines: model + tools + a while-loop. This is the *inner* loop. Its limit: the context window.

**Phase 1 — the Ralph loop (Jul 2025).** Geoffrey Huntley, ["Ralph Wiggum as a 'software
engineer'"](https://ghuntley.com/ralph/) (2025-07-14) — the founding document of outer-loop
engineering. The whole technique:

```bash
while :; do cat PROMPT.md | claude-code ; done
```

Named after Ralph Wiggum (The Simpsons): try the same thing over and over until it works. Key claims,
in Huntley's own framing:
- *"Deterministically bad in an undeterministic world"* — the loop is dumb ON PURPOSE; determinism
  lives in the PROMPT.md + specs on disk, not in orchestration cleverness.
- **One item of work per iteration** — conserves context, makes failures cheap and retryable.
- **Specs/plan files as the stable scaffolding** re-read every cycle (state-on-disk before it had a name).
- **Backpressure via gates**: wire compilers/static analyzers/tests in so a bad iteration can't advance.
- Documented failure modes + prompt-level mitigations: false "not implemented" assumptions (force a
  search first), placeholder implementations (all-caps ban), duplicate implementations (narrow scope).
- Explicitly an *overnight* technique: "shipped 6 repos overnight" (YC hackathon field report);
  "$50k contract, delivered, MVP, tested + reviewed… $297 USD". And the caveat that keeps it honest:
  *"LLMs are mirrors of operator skill"* — no senior-authored specs, no magic.
- Follow-up repo: [ghuntley/how-to-ralph-wiggum](https://github.com/ghuntley/how-to-ralph-wiggum).

**Phase 2 — canonization (late 2025).**
- Anthropic ships an official **ralph-wiggum plugin** inside the claude-code repo
  ([plugins/ralph-wiggum](https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum)) —
  the vendor adopting the community pattern (it re-feeds the prompt via a Stop hook: the loop moves
  from bash INTO the harness).
- Anthropic engineering, ["Effective harnesses for long-running
  agents"](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
  (2025-11-26): the research-grade write-up of the same shape. Two-agent split: an **initializer agent**
  (session 1: `init.sh`, `claude-progress.txt`, first commit) + a **coding agent** (every later session:
  read git log + progress file → pick ONE highest-priority failing feature → implement → verify →
  commit). Definition-of-done = a JSON **feature list** (200+ items, all start "failing"; editing or
  deleting tests declared "unacceptable" in the spec). Verification finding: agents declared victory
  prematurely until given browser automation (Puppeteer MCP) to test like a user.
- Community hardening: [frankbria/ralph-claude-code](https://github.com/frankbria/ralph-claude-code)
  (v0.11.x, 784 tests — dissected in §3) turns the bash one-liner into a production loop runner.
- Industrial scale: Steve Yegge's **Gas Town** (in `.research-cache/gastown`, active through 2026-07)
  — an org-chart of loops: worker loops (Polecats), watchdog loops (Witness, Deacon), and a
  watchdog-of-the-watchdog (Boot the Dog). Dissected in §3.

**Phase 3 — "loop engineering" becomes the name (2026).** Addy Osmani, ["Long-running
Agents"](https://addyosmani.com/blog/long-running-agents/) (2026-04-28) systematized the pattern
vocabulary (amnesiac agent + durable external state; planner/worker/judge; done-conditions declared
before execution; cost circuit breakers; test ratchets; checkpoint-and-resume), citing Huntley, Ryan
Carson's Ralph variant, and Anthropic's harness work; headline datapoint: **30+ hours of autonomous
coding** by Claude Sonnet, 11k-line app in one run; METR's time-horizon metric doubling ~every 7
months. In June 2026 Osmani popularized the term **"loop engineering"** (building on Peter Steinberger
and Boris Cherny), and an explainer wave followed (Cobus Greyling on Medium, Jun 2026; MindStudio,
explainx.ai, tosea.ai guides). The consensus five blocks in those explainers: **a way to find work →
act → verify → remember → repeat on a trigger** (timer, git event, or CI signal).

The arc in one line: 2024 "the agent is a loop" → 2025 "put a loop around the agent" (Ralph) →
2026 "engineer that loop like production infrastructure" (loop engineering).

## 3. Pattern catalog

Format per pattern: **essence → where implemented (primary sources) → pitfalls.**

### 3.1 Outer loop vs inner loop

- **Essence:** the inner loop (model→tool→observe) is bounded by one context window and is the
  vendor's problem; the outer loop (spawn fresh agent → point at durable state → check progress →
  decide continue/stop/escalate) is bounded only by your guards and is YOUR problem. Loop engineering
  = engineering the outer loop.
- **Implemented in:** Ralph (`while :; do cat PROMPT.md | claude-code; done`, ghuntley.com/ralph,
  2025-07-14); Anthropic's initializer/coding-agent split (eng blog 2025-11-26); every runner below.
- **Pitfalls:** conflating the two loops — inner-loop tricks (compaction, bigger windows) delay but
  never remove the need for an outer loop; Osmani (2026-04-28): *context rot degrades performance well
  before token limits*, so fresh-context restarts beat context stretching.

### 3.2 Stop conditions & definition-of-done

- **Essence:** the loop must end on a machine-checkable predicate declared BEFORE the run, never on
  the model "feeling done". State it as data, not prose.
- **Implemented in:**
  - *Anthropic harness* — a JSON **feature list** (200+ items all starting `failing`); done = all
    `passing`; spec text forbids editing/removing tests ("unacceptable") to block gaming the predicate.
  - *snarktank/ralph* (Ryan Carson) — `prd.json` stories with `passes: false→true`; loop exits when the
    agent emits `<promise>COMPLETE</promise>` AND all stories pass; hard `max_iterations` (default 10)
    as backstop.
  - *frankbria/ralph-claude-code* — the most engineered exit gate found anywhere: a **dual-condition
    exit** requiring BOTH accumulated completion indicators (≥2 across recent loops, tracked in
    `.ralph/.exit_signals` JSON) AND the agent's explicit `EXIT_SIGNAL: true` in its response; plus a
    **safety force-exit after 5 consecutive EXIT_SIGNAL=true** responses in case the normal path
    wedges; plus `STATUS: COMPLETE` with `EXIT_SIGNAL: false` explicitly continues (fixed as bug #146).
  - *loopengineering.run* — "explicit done-conditions documented before execution" as table stakes.
- **Pitfalls:** (a) single-signal exits — the model says "done" prematurely (Anthropic observed
  constant early victory declarations until verification was strengthened); (b) the model editing the
  done-predicate itself (hence "don't touch tests" clauses and keeping `prd.json` semantics
  deterministic — "no semantic interpretation, just state and dependencies"); (c) stale exit signals
  surviving a session restart (ralph-claude-code explicitly clears `.exit_signals` between sessions).

### 3.3 Budget guards / token ceilings

- **Essence:** hard, mechanism-level caps on iterations, calls, tokens, and dollars — because
  prompt-level caps do not self-enforce under pressure.
- **Implemented in:**
  - *ralph-claude-code* — `MAX_CALLS_PER_HOUR=100` (with hourly reset), optional
    `MAX_TOKENS_PER_HOUR` cumulative cap, per-run E2B sandbox `MAX_COST` in USD (stop gracefully at
    estimated spend), per-call timeout (default 15 min).
  - *snarktank/ralph* — `max_iterations` circuit breaker.
  - *autosk* — visit-count budgets persisted in `task.json` (`step_visits`), human-resettable (see §4).
  - *warren* — restart budget (5-restarts-in-60s) for its own components; and the hard-won rule that
    **malformed budget values fail OPEN** — "a budget typo must never silently cancel every run"
    (neighbor's 02 notes §4).
  - *Osmani 2026* — "cost circuit breakers and spend caps" as a named essential.
- **Pitfalls:** budgets that only exist in the prompt (ignored); budgets without persistence (a
  restarted loop forgets it already spent the ceiling — hence ralph's `.ralph/` state files and
  autosk's task.json counters); budgets that fail closed on config errors (warren's lesson).

### 3.4 Checkpoint & resume

- **Essence:** every iteration ends by writing durable state (commit + progress note) so ANY next
  iteration — same loop or a cold restart days later — resumes from disk, not from memory.
- **Implemented in:**
  - *Anthropic harness* — `claude-progress.txt` + descriptive git commits; each session starts by
    reading git log + progress file; the *initializer agent* exists purely to create this resume
    surface (plus `init.sh` so environment setup isn't re-derived every session).
  - *snarktank/ralph* — memory between iterations is ONLY git history + `progress.txt` (append-only
    learnings) + `prd.json` flags; also updates `AGENTS.md` with codebase learnings so later
    iterations inherit gotchas ("this codebase uses X for Y") — checkpointing *knowledge*, not just
    position. Auto-archives prior runs to `archive/YYYY-MM-DD-feature/` on feature switch.
  - *ralph-claude-code* — session continuity via `claude --resume <session_id>` (deliberately NOT
    `--continue`, which caused session hijacking, bug #151), with a 24h session-expiration default.
  - *warren* — even watchdog-killed runs route "through reap, not bare finalize" so partial committed
    work is still pushed as a branch (nothing a dead worker did is lost).
- **Pitfalls:** checkpointing to chat/scrollback (lost on compaction); resuming a *stale* session
  instead of a fresh context (hijacking bug class); progress files that grow unbounded (append-only
  needs compression policy); trusting the checkpoint over live git (dead-writer truncation — our
  skill already handles this with atomic temp+rename and "live git wins").

### 3.5 Self-pacing: dynamic wake-ups and prompt-cache-window economics

- **Essence:** an unattended loop must decide *when to wake next* — fixed cron is simple but either
  wasteful (nothing changed) or slow (something urgent). The 2026 refinement: pick intervals against
  the **prompt-cache TTL window**, because cache economics dominate idle-loop cost.
- **Implemented in:**
  - *OpenClaw* (Peter Steinberger; started as Clawdbot 2025-11) — the canonical **heartbeat vs cron**
    split ([docs](https://docs.openclaw.ai/gateway/heartbeat)): heartbeat = periodic agent turn in the
    MAIN session (default 30 min; 1h on subscription OAuth) that reads a small stable `HEARTBEAT.md`
    checklist and batches all checks (inbox, calendar, CI) into one turn; cron = detached isolated
    jobs. Cost levers: `isolatedSession` (~100K → 2–5K tokens/run), `lightContext`, cheap model,
    `activeHours` windows (skip ticks outside 09:00–22:00), `target:"none"` for silent state-only runs.
  - *Cache economics* — Anthropic's cache TTL default silently dropped **1h → 5min on 2026-03-06**
    (community reports: +30–60% effective cost for loops that poll every 15–30 min, which were tuned
    for the old TTL). The emergent rule: **poll inside the cache window (<5 min) or commit to long
    sleeps (20–30 min+) and eat ONE cache miss** — the worst cadence is just past the TTL. Claude
    Code's own `/loop` dynamic mode / ScheduleWakeup encodes exactly this ("don't pick 300s").
  - *Claude Code* — native `ScheduleWakeup`/dynamic-loop pacing; feature request #28229 for daemon
    mode shows demand; bug #54086 (ScheduleWakeup re-firing expensive slash commands) shows the
    hazard side.
- **Pitfalls:** polling every N min "to be safe" (each tick is a full agent turn — OpenClaw users
  report burnout-by-token-bill; Ewan Mak's "Seven hard-won lessons" is entirely about this); wake-up
  prompts that re-trigger expensive work instead of a cheap triage (#54086); heartbeat that
  keeps a session's context growing forever (OpenClaw's answer: isolatedSession + tiny checklist);
  fixed cron with no "nothing to do → say HEARTBEAT_OK and exit cheap" path.

### 3.6 Overnight / unattended patterns

- **Essence:** the loop runs while the human sleeps; every human touchpoint is either removed
  (auto-approve within scoped permissions), deferred (morning queue), or fatal (park). The morning
  deliverable is a *reviewable digest*, not raw logs.
- **Implemented in:**
  - *Ralph lineage* — Huntley: "6 repos overnight"; Carson: "ship features in your sleep… come back
    in the morning to find completed features, passing tests, and committed code"; Geocodio's
    field report ["Ship features in your sleep with Ralph
    loops"](https://www.geocod.io/code-and-coordinates/2026-01-27-ralph-loops) (2026-01-27).
  - *ralph-claude-code* — explicit **unattended mode**: the Claude API 5-hour subscription limit
    prompt auto-waits instead of exiting (v0.11.5 fix #183 — three-layer API-limit detection so a
    timeout isn't misread as a rate limit); desktop notifications for key loop events; git backup
    branches + `--rollback`.
  - *OpenClaw* — morning-brief cron (`0 7 * * *`: top unread emails, calendar, overnight CI
    failures); activeHours for quiet nights; HEARTBEAT_OK suppression = "only wake the human for
    alerts".
  - *loopengineering.run* — a taxonomy of standing unattended loops: PR babysitter, daily triage, CI
    sweeper, post-merge cleanup, dependency sweeper, changelog drafter — all "on a schedule or
    trigger… but a final human decision at defined gates" (merge/deploy/delete stay human).
  - *Gas Town* — the whole town runs on patrols: Deacon patrol cycles keep workers fed overnight;
    "capability ledger" gives the owner a morning-readable record of what every agent did.
  - *autosk* — the "park-to-human" morning queue: anything unclear ends up parked with a reason, the
    owner triages parked tasks after waking (neighbor's 01 notes §7).
- **Pitfalls:** auto-approving beyond scoped permissions (the community consensus keeps
  merge/deploy/destructive ops human-gated even in max-autonomy setups); rate-limit windows
  misdetected as errors (ralph #183); the human waking up to 40 unlabeled branches — the digest/ledger
  is as important as the work; no rollback path (ralph's `--backup`).

### 3.7 Question buffering (don't stop on questions)

- **Essence:** overnight, a blocking question is a stall. Three community answers, in increasing
  sophistication: (a) **park** the task and move on to other work (autosk); (b) **pause with a
  budget** — wait for an async human answer, then auto-resolve on timeout (warren); (c) **buffer and
  continue** — log the question, take the reversible default, keep working, surface the buffer in the
  morning digest (the ideal for gosleep; least implemented in public code).
- **Implemented in:**
  - *warren* — the most concrete: workers emit `question_posed` onto the Plot event log → run flips
    to `paused`; the human can answer via API, OR the **pause budget** expires and the run proceeds /
    finalizes (neighbor's 02 notes §4). Questions are events, not modal dialogs.
  - *autosk* — park-to-human as the universal sink: never spin on a question, park with reason
    `agent_did_not_transit` etc., human un-parks by editing task.json (neighbor's 01 notes).
  - *OpenClaw* — the inverse discipline for notifications: batch checks, suppress OK-noise, only
    alert-worthy content reaches the human — i.e., the question CHANNEL is rate-limited by design.
  - *Osmani 2026* — "delegated approval with full execution state preservation": an approval request
    freezes state so approval-later loses nothing.
  - *Community practice* — "use auto-approve permissions so it doesn't stop to ask" is a standard
    unattended-loop tip (loop-engineering explainers) — crude question-avoidance by widening authority.
- **Pitfalls:** parking too eagerly (one ambiguous lint rule shouldn't stall a feature — the
  buffer-and-default variant exists precisely for low-stakes questions); answering questions with
  irreversible defaults (buffering only works when the default is cheap to undo); question spam
  (buffer needs dedup: same question asked by 5 cycles = 1 morning item).

### 3.8 Verification loops (fresh context judges the work)

- **Essence:** the generator must not grade its own homework. A separate loop stage — fresh agent,
  test suite, or browser — verifies each increment BEFORE the done-flag flips; ratchets prevent
  regression.
- **Implemented in:**
  - *Anthropic harness* — the decisive finding of the 2025-11-26 post: Claude marked features done
    prematurely until given **browser automation (Puppeteer MCP)** to test "like a user"; per-session
    mandatory self-verification before status changes; "testing mirrors human user workflows rather
    than relying solely on unit tests".
  - *loopengineering.run* — "a separate verifier checks tests, diffs, requirements, and failure
    modes. The agent that generated the change should not grade its own homework."
  - *Osmani 2026* — planner/worker/**judge** separation (crediting Cursor's architecture); **test
    ratchets** preventing quality degradation (coverage/counts may only go up).
  - *Huntley* — "backpressure": compilers, static analyzers (Dialyzer, Pyright), tests wired so a bad
    iteration cannot advance the loop.
  - *Gas Town* — the Refinery reviews Polecat output; Witness verifies progress independently of the
    worker's claims.
- **Pitfalls:** verifier sharing the generator's context (inherits its assumptions — fresh context is
  the point); verification the model can edit (test deletion — hence the Anthropic "unacceptable"
  clause and ratchets); verifier hangs freezing the loop (our skill's E17 watchdog exists for this;
  ralph's per-call timeout is the loop-level equivalent).

### 3.9 Anti-runaway protections

- **Essence:** a loop that spins without progress is worse than a stopped loop — it burns budget and
  can damage the tree. Detection is multi-signal (progress, error repetition, output shape), response
  is staged (halt → cooldown → human).
- **Implemented in:**
  - *ralph-claude-code* — a full Nygard-style **circuit breaker** (`lib/circuit_breaker.sh`):
    states CLOSED/HALF_OPEN/OPEN; opens on **3 loops with no progress**, **5 loops with the same
    error**, **>70% output decline**, or **2 permission-denial loops**; 30-min cooldown then
    HALF_OPEN probing; all thresholds env-configurable; state persisted as JSON in `.ralph/`.
    Plus response-analyzer heuristics: `MAX_CONSECUTIVE_TEST_LOOPS=3` (loop only running tests =
    stuck), `MAX_CONSECUTIVE_DONE_SIGNALS=2`. Progress detection counts git commits within a loop
    (bug #141) — git motion counts as progress but never as completion.
  - *Gas Town* — the **watchdog chain**: Witness watches Polecats; Deacon (daemon patrol) watches
    system health; **Boot the Dog checks the Deacon every 5 minutes** — "a chain of accountability"
    for who-watches-the-watchdog. Three separate heartbeat stores (file, session state,
    bead label) with the hard rule: **never declare an agent stuck from a single store** — cross-check
    tmux activity first; a live session with a stale store is "heartbeat-write divergence, not a stuck
    agent" (docs/concepts/heartbeats.md, incident hq-qxl9).
  - *warren* — heartbeat computed from the newest EVENT row (not self-reported); watchdog cancels
    through the normal reap path so partial work survives; watchdog self-arms by default ("must not
    depend on an operator remembering an env var"); single-flight ticks so the watchdog can't
    pile up on itself; long-lived conversation runs exempted (idle ≠ hung).
  - *autosk* — three nested bounded loops (turn corrections ×3 → step visit caps → park), §4.
- **Pitfalls:** single-signal stuck-detection (gastown's divergence lesson; our skill's "git motion ≠
  health" is the same finding from the opposite side); watchdogs nobody watches (Boot exists because
  the Deacon itself died in practice); kill paths that destroy partial work (warren's reap rule);
  self-reported heartbeats (a wedged agent can't report — derive liveness from artifacts: events,
  commits, file mtimes).

### 3.10 State-on-disk

- **Essence:** the filesystem + git ARE the loop's memory. Everything the loop needs to decide
  "what next" must be re-derivable from disk by a context-free reader.
- **Implemented in:** every serious system, converging on the same trio —
  1. **Work state**: `prd.json` passes-flags (Carson), feature-list JSON (Anthropic), Beads ledger
     (Gas Town), `task.json` incl. loop counters (autosk), event log as source of truth (warren).
  2. **Narrative/progress**: `progress.txt` append-only learnings (Carson), `claude-progress.txt`
     (Anthropic), capability ledger (Gas Town), AGENTS.md accumulation of codebase gotchas (Carson —
     notable: the loop improves its own future prompts).
  3. **Loop-control state**: `.ralph/` (exit signals, circuit-breaker JSON, metrics JSONL),
     heartbeat stores (Gas Town), pause/visit budgets in task files (warren/autosk).
- **Pitfalls:** state only in the session (dies with it); non-atomic writes (truncated batons — our
  skill's temp+rename rule; autosk has the same atomic-write machinery per neighbor's notes);
  human-unreadable state (the owner must be able to triage from a phone — autosk's
  human-resettable JSON counters are the exemplar); prose walls instead of structured state.

## 4. AutoSK vs the loop-engineering canon

(Full autosk teardown: `01-autosk.md`; this section only maps it onto §3.)

AutoSK.app markets itself around loop-based autonomy; what the code ships (per 01-autosk §7) is
**three nested bounded loops**: turn-level kickback/corrections (budget 3) → step-level workflow
bounce loops with persisted visit caps (`step_visits`, e.g. dev-visits ≥5 → park) → system-level
scheduler loop (event-driven scans + 30s rescan backstop). Mapped to the canon:

| Canon pattern (§3) | AutoSK | Verdict vs state of the art |
|---|---|---|
| Stop conditions | workflow graph reaches `done`; transit-as-MCP-tool validated by `onTransit` | Strong — done is a *graph state*, stronger than a text `EXIT_SIGNAL` |
| Budget guards | correction + visit counters, persisted, human-resettable | Canon-quality; but **no token/cost budgets at all** |
| Anti-runaway | every loop's exit is `park-to-human`; "bounded autonomy, park early, never spin" | Philosophically clean; no circuit-breaker heuristics (no-progress/same-error) like ralph-claude-code |
| Checkpoint/resume | task.json state machine; but **no auto-resume after daemon restart** | Below canon (warren reaps partial work; ralph resumes sessions) |
| Self-pacing / overnight scheduling | **none** — no cron, no heartbeat, no scheduled enrollment | Biggest gap vs canon; runs unattended only per-task once enrolled |
| Question buffering | park-to-human = variant (a) park-only | warren's pause-budget and buffer-and-continue are both beyond it |
| Verification loops | reviewer/validator steps in `feature-dev` graph with bounce-back caps | Solid mid-canon |

Takeaway for gosleep: AutoSK's contribution to loop engineering is the **minimal loop-safety
vocabulary** (bounded counters at every nesting level + one universal human sink, all persisted and
phone-editable) — adopt that; but for pacing, restarts, budgets-in-dollars, and verification depth the
canon leaders are ralph-claude-code (guards), Gas Town (watchdog chains), warren (event-derived
liveness), and Anthropic's harness post (verification + resume surface).

## 5. Gap analysis: canon patterns vs `skill/orchestrating-delivery-agents`

Read against SKILL.md + references/ (2026-07-07, branch GSL-41). "Owner mandate" = in memory/STATE
but NOT yet mechanized in the skill.

| Canon pattern | In our skill today? | Gap / note |
|---|---|---|
| Outer loop (cycle-workers, fresh context per chunk) | ✅ Core of the skill | — |
| State-on-disk (ORCHESTRATION-STATE.md, atomic writes, handoffs) | ✅ Strong (atomic temp+rename, live-git-wins, correction mechanics) | Matches/exceeds canon |
| Checkpoint & resume (handoff batons, cold-start protocol) | ✅ Strong | Missing only Carson's *knowledge* checkpoint: no standing "append learnings to a LEARNINGS/AGENTS file each cycle" step |
| Definition-of-done | ⚠️ Partial — per-cycle DONE via reports/PRs; roadmap-level done implicit | No machine-checkable feature-list/prd.json equivalent; "phase done" is judgment, not data |
| Budget guards / token ceilings | ✅ TELEMETRY block, aggregate ceiling, BUDGET_EXCEEDED fork | Ceiling is orchestrator-enforced prose, not a mechanism; no per-hour caps; no dollar caps |
| Loop guard (non-advancing NEXT, no-new-PR) | ✅ Present | Cruder than ralph's breaker: no same-error / output-decline signals, no cooldown/HALF_OPEN retry — ours stops, never probes |
| Patience clocks / liveness ranking | ✅ Strong (two clocks, finalize exception, E17 watchdog) | Single-store lesson already learned; gastown's cross-check rule confirms our design |
| Verification loops (fresh verifier, watchdog) | ✅ Strong (VERIFY-REQUEST, cheap-tier verifier, steps.log watchdog) | No test-ratchet concept (quality may only go up) |
| **Orchestrator self-pulse / armed wake-up** | ❌ NOT in skill (owner mandate 2026-07-07 exists in memory: check every 5–10 min, never end a turn without an armed wake-up) | THE gap. Skill says "re-check on a timer" but defines no mechanism (ScheduleWakeup/Monitor/cron), no cadence policy, no cache-window economics |
| **Auto-restart after orchestrator death** | ❌ Cold-start protocol exists but something must *invoke* it | No watchdog-above-the-orchestrator (gastown's Boot; warren's supervisor with restart budget). Today: dead orchestrator = fleet orphaned until the human notices |
| **Question buffering / park queue** | ❌ Only BLOCKED_ON_HUMAN (modal, stalls that thread) | No park-and-continue, no pause budget, no morning question queue with dedup |
| **Self-pacing / night mode** | ❌ Nothing | No activeHours, no morning-digest deliverable, no quiet-hours notification policy |
| **Dynamic self-planning of wake intervals** | ❌ Nothing | Canon: match interval to what you're waiting for; respect the 5-min cache TTL (poll <5m or sleep 20m+, never just past the window) |
| Anti-runaway: watchdog chain | ⚠️ Partial — orchestrator watches workers; nothing watches the orchestrator | Boot-the-Dog layer missing (same as auto-restart row) |
| Overnight authority model | ✅ Denylist + reversible-green autonomy is exactly the community consensus | Already canon-grade |

**Summary:** we are at-or-above canon on worker-side loop safety (state, batons, patience,
verification, telemetry) and **below canon on orchestrator-side loop mechanics** — the skill assumes
an orchestrator that is awake because a human keeps its session warm. Every ❌ row is a facet of one
missing capability: *the orchestrator as a self-scheduling, self-healing loop*.

## 6. What to adopt in gosleep (ranked)

Ranking = (value for owner-sleeps ÷ effort). Mechanic → detects/solves → effort.

1. **Armed self-pulse with cache-aware pacing** — orchestrator NEVER ends a turn while the fleet is
   live without a scheduled wake-up (ScheduleWakeup in Claude Code; cron/`sleep` wrapper elsewhere).
   Pulse = cheap triage tick: read STATE + probe liveness signals, act only on deltas
   (OpenClaw-heartbeat shape: tiny stable checklist, "HEARTBEAT_OK → do nothing" fast path). Cadence
   policy from the canon: <5 min while actively wedging a stall (cache warm), 20–30 min while workers
   grind (one cache miss, amortized), aligned to what is actually being awaited. *Solves:* the whole
   "orchestrator dozes off / turn ends and nobody watches" class — the owner's pulse-rule mandate,
   mechanized. **Effort: LOW** (skill text + a pacing table; the tools already exist).
2. **Night mode + morning digest** — a declared unattended window (activeHours inverse): during it,
   AskUserQuestion is forbidden except for denylist items; every would-be question goes to the buffer
   (item 3); at window end the orchestrator writes `docs/handoff/MORNING-DIGEST-<date>.md`: work
   landed, verdicts, parked items, buffered questions, budget spent vs ceiling. *Solves:* the owner
   waking to 40 branches and no narrative; makes "go to sleep" an explicit mode with tightened rails.
   **Effort: LOW-MED** (protocol + template; no new infra).
3. **Question buffer with pause-budget defaults** — three-tier triage of any fork that isn't
   denylist: (a) reversible + low-stakes → take the default, LOG the question+choice to
   `QUESTIONS.md` (buffer-and-continue); (b) material but not dangerous → warren-style pause THAT
   TASK with a budget, park it, reassign the worker to the next unblocked task; (c) denylist/irreversible →
   BLOCKED_ON_HUMAN as today. Dedup identical questions across cycles. *Solves:* overnight stalls on
   questions — currently every ambiguity stops a thread until morning. **Effort: MED** (protocol in
   worker template + orchestrator triage rules).
4. **Watchdog above the orchestrator (Boot layer)** — an external, dumb, non-LLM check (cron script
   or cheap Monitor loop): "has ORCHESTRATION-STATE.md mtime / TELEMETRY line advanced in N min while
   open_workers>0?" If stale → notify owner AND/OR relaunch a fresh orchestrator pointed at the
   cold-start protocol, under a warren-style restart budget (e.g. 3 restarts/night, then page the
   owner). Liveness derived from ARTIFACTS (file mtime, git), never self-report. *Solves:* dead/
   compacted orchestrator orphaning a live fleet overnight — the one failure the skill can't
   self-recover from. **Effort: MED** (small script + skill section; the cold-start protocol it
   triggers already exists).
5. **Machine-checkable definition-of-done per phase** — adopt the feature-list/prd.json pattern:
   each epic carries a JSON checklist with `passes` flags only flipped after verification; loop-level
   done = all-passing + PR merged, not "worker said COMPLETE". Also ban done-predicate edits (Anthropic's
   "unacceptable" clause) in worker briefs. *Solves:* premature victory across cycle boundaries; gives
   the loop guard a real predicate. **Effort: MED** (fits existing Jira-mirrored task structure).
6. **Circuit-breaker upgrade for the loop guard** — extend the existing loop guard with
   ralph-claude-code's signals: same-error-N-times across cycles, output/progress decline, and a
   cooldown+HALF_OPEN probe (one cheap retry after pause) instead of hard STOP; counters persisted in
   STATE and human-resettable (autosk's phone-editable counters). *Solves:* both false-halts (transient
   flake trips the guard permanently) and busy-runaways the current two-signal guard misses.
   **Effort: MED.**
7. **Per-cycle learnings checkpoint (AGENTS.md pattern)** — workers append codebase gotchas to a
   standing LEARNINGS file the next brief points at; the loop's prompts improve as it runs (Carson's
   most-copied trick). *Solves:* every fresh cycle re-discovering the same traps (we already do this
   for automation-traps only — generalize it). **Effort: LOW.**

8. **Sleep-time consolidation (idle-gap compute)** — while workers grind and the orchestrator waits,
   spend idle wake-ups on cheap memory work: compress old STATE log entries, distill the night's
   LEARNINGS, pre-draft the morning digest. Canon: Letta's **sleep-time compute** (paper 2025-04,
   [letta.com/blog/sleep-time-compute](https://www.letta.com/blog/sleep-time-compute/)): background
   agents share memory with the primary and rewrite it asynchronously — reported up to 18% accuracy
   gains and 2.5× lower cost/query by precomputing during idle. *Solves:* STATE-file sprawl and
   morning-digest latency for free during waits. **Effort: LOW** (a standing "if nothing to triage,
   do one consolidation chore" clause in the pulse checklist). Rank last: nice-to-have, not
   sleep-blocking.

Items 1+2+3 together are the minimum viable "owner goes to sleep" package; 4 makes it survive
orchestrator death; 5-8 raise long-run quality/economy.

## 7. Deep-dive addenda (2026-07-08 continuation)

### 7.1 Gas Town's watchdog stack — implementation-level findings (read from source)

The concepts docs (§3.9) undersell how much *debouncing engineering* the real code carries. From
`internal/boot/boot.go`, `internal/deacon/*.go`, `internal/daemon/daemon.go`:

- **Boot is an LLM triage agent, not a dumb timer.** "Boot is a dog that runs fresh on each daemon
  tick, deciding whether to wake/nudge/interrupt the Deacon or let it continue. This centralizes the
  'when to wake' decision in an agent" (boot.go header). Its decision vocabulary is exactly four
  actions: `start/wake/nudge/nothing`, persisted to `.boot-status.json`; a `flock` + `.boot-running`
  marker prevents overlapping triage runs (single-flight, same as warren's ticks).
- **Stuck detection is counter+cooldown, never one-shot:** ping timeout 30s → force-kill only after
  **3 consecutive failures** → then a **5-min cooldown between force-kills**; all three knobs
  config-overridable (`stuck.go`). Heartbeat aging is tiered: 5 min = stale, 20 min = very-stale →
  poke (`heartbeat.go`). Redispatch and feed-stranded interventions carry their own cooldowns
  (5 min / 10 min).
- **Production war wounds visible in daemon.go:**
  - *Startup grace period* — `deaconLastStarted` exists because the heartbeat check killed
    freshly-started sessions before they wrote a heartbeat (issue #567): every watchdog needs a
    warm-up exemption.
  - *Boot spawn cooldown* — the watchdog itself is rate-limited so it can't fire on every tick.
  - *RestartTracker with exponential backoff* — anti-crash-loop for daemon-managed components
    (same finding as warren's 5-restarts-in-60s budget, independently evolved).
  - *Zombie debounce* — `mayorZombieCount >= 3` consecutive patrol cycles of "tmux session exists
    but agent process not detected" before a zombie restart, "debouncing transient gaps during
    handoffs". Pane-alive and process-alive are DIFFERENT signals that diverge routinely.
  - *Mass-death detection* — recent session deaths tracked as a set; many deaths at once is a
    different (systemic) failure than one death.
  - *Bounded fan-out in the watchdog itself* — per-rig checks run in a worker pool with per-rig
    timeouts "so one slow rig cannot block all others".
  - *Specialized maintenance dogs* (quota, doctor, compactor, checkpoint), each with an `Enabled`
    flag, thresholds, and throttling ("only pour when anomaly detected AND cooldown elapsed").
- **Lesson distilled for gosleep item #4 (Boot layer):** every watchdog decision should be
  (a) counter-debounced, (b) cooldown-limited, (c) exempt during warm-up, and (d) the watchdog
  itself single-flight + rate-limited. A one-shot "STATE stale → restart orchestrator" script will
  fire on false positives its first night.

### 7.2 Official ralph-wiggum plugin (anthropics/claude-code) — the in-session loop variant

Verified from the plugin README: the loop is a **Stop hook** (`hooks/stop-hook.sh`) that intercepts
session exit and **reinjects the original prompt** — iteration happens INSIDE one session, no external
bash. Controls: `/ralph-loop "<prompt>" --max-iterations <n> --completion-promise "<text>"`;
completion = **exact string match** on the promise (e.g. `<promise>COMPLETE</promise>`);
`--max-iterations` explicitly documented as "your primary safety mechanism"; `/cancel-ralph` to abort.
Docs warn: not for tasks needing human judgment; best for auto-verifiable work.

**Design tension vs classic Ralph:** the bash loop resets context every iteration (fresh eyes, immune
to context rot, needs disk-state discipline); the Stop-hook loop accumulates context (cheaper per
iteration, remembers its own recent attempts, but rots and can rationalize). Gosleep mapping: worker
inner retries ≈ Stop-hook style (bounded, in-context); cycle chaining ≈ bash style (fresh context +
handoff). Both belong, at different radii — same conclusion as autosk's turn-vs-step budget split.

### 7.3 claude-squad — surveyed (README-level)

smtg-ai/claude-squad (in `.research-cache`, last commit 2026-06-17): a Go TUI (`cs`) managing N
agent instances (Claude Code/Codex/Gemini/Aider) in tmux, one **git worktree per task**, background
execution with auto-accept ("yolo") mode, review-before-apply of diffs. Verdict for this report: a
*multiplexer*, not a loop engine — the human is the outer loop; no stop conditions, budgets, or
watchdogs of its own. Relevant to gosleep only as prior art for pane/worktree management on our
Agent-Teams surface. (Daemon internals not read.)

### 7.4 Sleep-time compute (Letta) — the research-line cousin of overnight loops

Letta (Packer/Wooders, UC Berkeley Sky Lab) coined **sleep-time compute** in an April 2025 paper
([blog](https://www.letta.com/blog/sleep-time-compute/),
[repo](https://github.com/letta-ai/sleep-time-compute)): agents use idle time to rewrite memory,
precompute likely answers, and consolidate — a background agent **shares memory blocks with the
primary agent and edits them asynchronously**. Reported: up to +18% accuracy on reasoning tasks,
2.5× cost-per-query reduction. Distinction worth keeping sharp: Ralph-style loops do *more work*
overnight; sleep-time compute makes the *next day's work cheaper/smarter*. Gosleep can have both —
delivery cycles are the former; idle-gap STATE/LEARNINGS consolidation (adoption item 8) is the
latter.

## COVERAGE

**Covered (high confidence):**
- Origin/canon with dated primary sources: Huntley Ralph (2025-07-14, fetched), Anthropic harness
  post (2025-11-26, fetched), Osmani long-running agents (2026-04-28, fetched) + "loop engineering"
  term wave (Jun 2026), loopengineering.run (fetched), OpenClaw heartbeat docs (fetched),
  snarktank/ralph README (fetched).
- Code-level dissection of ralph-claude-code (exit gate, circuit breaker, budgets — read from
  `.research-cache`) and Gas Town loop concepts (glossary, heartbeats.md, propulsion-principle.md —
  read from `.research-cache`).
- Cross-references to neighbors' autosk (01) and warren/overstory (02) findings; 10-pattern catalog;
  gap table vs SKILL.md (read in full) + references (grepped); ranked adoption list.
- **Added 2026-07-08 (§7):** gastown Deacon/Boot/daemon watchdog *implementation* read from Go source
  (thresholds, debounces, cooldowns, crash-loop backoff, zombie debounce, startup grace); official
  ralph-wiggum plugin Stop-hook mechanics (README verified); claude-squad surveyed (README-level);
  Letta sleep-time compute (paper gist + distinction from work-loops); adoption item 8 added.

**NOT covered:**
- Ralph-orchestrator variants beyond snarktank/frankbria (e.g. mikeyobrien/ralph-orchestrator);
  Boris Cherny's/Steinberger's original loop posts first-hand (cited via Osmani/explainers); METR
  methodology; claude-squad daemon internals; ralph-wiggum stop-hook.sh source itself (README-level
  only); cost numbers for a gosleep night run.
- No hands-on run of any loop runner (static/code reading + web only).

**Confidence:** high on canon chronology, pattern catalog, gap analysis, and gastown watchdog
mechanics (primary sources/code read); medium on AutoSK mapping (relies on neighbor's 01 notes,
spot-checked); medium on "buffer-and-continue is rare in public code" (absence claim — searched, not
proven); claude-squad claims are README-level only.
