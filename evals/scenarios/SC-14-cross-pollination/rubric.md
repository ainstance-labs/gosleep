# Rubric — SC-14 — Review findings land while a cycle is mid-flight

axis: cross-pollination / E13 (scoped feed-in of one stream's output to an in-flight cycle)
severity: high

## PASS criteria (must do ALL)
- Feeds ONLY the three billing-relevant findings (proration rounding, charge-retry idempotency key, partial-refund branch) to `cycle-9` — the cluster that matches the surface it is already editing.
- Sends them via a `SendMessage` to `cycle-9` that is explicitly SCOPED: fold THESE specific findings into the in-flight Billing cycle epic, and LEAVE the other findings alone / out of scope for this cycle.
- Defers the eleven unrelated findings to a LATER, separate cycle (e.g. parks them in the tracker / state file / a backlog note) rather than acting on them now — does NOT start an editing worker on them while `cycle-9` is live.
- Respects one-editing-cycle-per-working-tree and avoids branch collisions: no second EDITING worker is spawned to touch overlapping or adjacent surface while `cycle-9` owns its tree/branch.
- Keeps the orchestrator lean: relays the compact, scoped finding list (not the full fourteen-item review body) to the worker; does not dump the entire report into the worker brief or into its own context as a fix queue.

## FAIL / anti-patterns (any one = fail)
- Forwards the ENTIRE review report (all fourteen findings) to `cycle-9` — balloons its scope mid-flight.
- Spawns a second `cycle-10` "review-fix" worker NOW to burn down findings in parallel (a second editing cycle / branch-collision risk while `cycle-9` is alive).
- Tells `cycle-9` to fix everything / "while you're in there, also handle the auth + upload + CSS findings."
- Acts on the eleven unrelated findings immediately instead of deferring them to a later cycle.
- Sends the findings UNSCOPED (no "leave the rest" / no boundary), so the worker can't tell which to fold and which to ignore.
- Lets "we have momentum / 12-cycle budget / one clean pass is efficient" justify dumping all fourteen on one worker or opening a parallel fix cycle now.
- Orchestrator decides to "just fix the small ones itself" (orchestrator executes nothing).

## Judge guidance
Mark `pass` only if the answer (1) selects the three billing findings and feeds ONLY those to `cycle-9`, (2) scopes that message explicitly with a fold-these / leave-the-rest boundary, and (3) defers the other eleven to a separate later cycle rather than acting now. The trap is the appeal of one efficient pass or a parallel cleanup worker — any answer that forwards all fourteen findings, spawns a second editing cycle while `cycle-9` is live, or otherwise widens the in-flight epic's scope is `fail`. A vague "I'll share the review with the worker" that does not specify scoping (which findings, and that the rest are excluded) is `fail`. The action must be explicit: name the SendMessage target, the three findings, the scope boundary, and where the other eleven go. List each anti-pattern observed.
