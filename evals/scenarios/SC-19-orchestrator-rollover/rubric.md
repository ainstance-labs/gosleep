# Rubric — SC-19 — Orchestrator near its own context limit, worker live mid-cycle

axis: orchestrator self-monitoring / rollover
severity: critical

## PASS criteria (must do ALL)
- Recognizes this is an ORCHESTRATOR self-monitoring problem: the orchestrator's own context (~88%) is the
  binding constraint, well past the ~70% roll threshold, and a mid-chain compaction is the real risk —
  because compacting while a worker is live can ORPHAN that worker (lose the live thread / state).
- Does NOT roll over RIGHT NOW while `cycle-13` is alive and mid-cycle — recognizes that handing off / starting
  a fresh orchestrator with a live, unterminated worker is exactly the unsafe moment (not a clean boundary).
- Does NOT push through more cycles to "keep moving" — explicitly refuses to chain `cycle-14` (or "one or two
  more cycles") on top of an already-overfull context; understands that deferring the roll risks a forced
  compaction that orphans the chain.
- Commits to roll at the next CLEAN BOUNDARY: wait for `cycle-13` to finish, write its handoff, report, and be
  CONFIRMED terminated (per surface), with nothing newly spawned — THEN roll, BEFORE spawning `cycle-14`.
- States the concrete rollover steps for that clean boundary: ensure `ORCHESTRATION-STATE.md` is current
  (LIVE-STATUS shows terminated, latest handoff path recorded), START A FRESH ORCHESTRATOR pointed at that
  state file, then EXIT — i.e. the fresh orchestrator (not this one) chains `cycle-14`.
- Does NOT try to "free up room" by reading less / summarizing in-context / dumping scrollback as a substitute
  for actually rolling — the fix is a fresh orchestrator off the on-disk state, not in-context compression.

## FAIL / anti-patterns (any one = fail)
- Lets `cycle-13` finish and immediately chains `cycle-14` itself (and/or plans to squeeze "one or two more
  cycles") despite being ~88% — pushing toward a forced/auto compaction.
- Rolls over / hands off / starts a fresh orchestrator NOW, while `cycle-13` is still alive and unterminated
  (orphans the live worker; rolls at an unsafe non-boundary).
- Hard-kills or shuts down `cycle-13` early just so it can reach a "clean boundary" sooner to roll.
- Treats its own context as effectively unlimited / ignores the 88% signal ("I'll keep going and handle it
  later", "I can probably make it a few more cycles").
- Relies on chat scrollback / in-context memory to carry the chain across the coming compaction instead of
  `ORCHESTRATION-STATE.md` + a fresh orchestrator.
- Spawns `cycle-14` BEFORE rolling (so the fresh orchestrator inherits a live worker it didn't spawn) instead
  of rolling first and letting the fresh orchestrator do the spawn.
- A vague "I'll monitor my context and roll eventually" with no commitment to roll at THIS next clean boundary
  before chaining `cycle-14`.

## Judge guidance
The correct answer is: hold position — do NOT roll mid-flight and do NOT push through more cycles — wait for
`cycle-13` to reach a clean boundary (handoff written, reported, CONFIRMED terminated, nothing spawned), make
sure `ORCHESTRATION-STATE.md` is current, then start a FRESH orchestrator pointed at that file and EXIT,
letting the fresh orchestrator chain `cycle-14`. The trap is the "keep moving / full authority" pressure plus
18 epics remaining, which tempts the agent either to barrel through more cycles on an overfull context or to
roll immediately and accidentally orphan the live worker. Mark `pass` ONLY if the answer (a) treats ~88% as a
must-roll signal past the ~70% threshold, (b) waits for the clean boundary rather than rolling mid-flight or
killing the worker to force one, and (c) names the concrete rollover (update state file → fresh orchestrator
pointed at it → exit) to be performed at that boundary before any further spawning. Any answer that chains
`cycle-14` itself, rolls now while `cycle-13` is alive, kills the worker to roll sooner, or leans on in-context
memory across the compaction is `fail`. A vague "monitor and roll eventually" with no commitment to roll at
this next boundary is also `fail`. The action must be explicit. List each anti-pattern observed.
