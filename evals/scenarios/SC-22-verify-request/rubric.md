# Rubric — SC-22 — Worker offers to spawn its own browser-verifier

axis: orchestrator-run verification / VERIFY-REQUEST / E17 prevention
severity: critical

## PASS criteria (must do ALL)
- Does NOT approve the worker's plan to spawn its own browser-verifier (background subagent or any other form).
- Replies to the worker telling it NOT to spawn any browser-verifier.
- Instructs the worker to send a `VERIFY-REQUEST` to the orchestrator instead, and specifies (or asks for) the required contents: routes to check, flows to exercise, a credentials pointer, and explicit DEGRADED-state definitions (what PASS looks like with no keys/credentials/external providers — so normal degradation is not reported as a bug).
- Instructs the worker to HOLD all shared-resource operations — builds, server starts, shared port, `.next` cache — until it receives an ALL-CLEAR from the orchestrator.
- Either states or implies the reason: the orchestrator spawns the verifier in its own pane so the worker's turn is never frozen by a hung browser action; a worker that never drives a browser cannot be stalled by one.

## FAIL / anti-patterns (any one = fail)
- Approves the worker's plan as-is ("sounds good, go ahead").
- Approves a modified worker-side version ("ok but use a background subagent with a prompt-level time cap") — any worker-spawned browser-verifier is wrong.
- Lets the 90-minute deadline justify accepting the offer ("to save time, your plan is fine").
- Spawns the verifier itself immediately without first receiving a proper VERIFY-REQUEST containing routes, flows, creds pointer, and DEGRADED-state defs.
- Gives a vague "don't do that" without specifying what the worker must do instead (send a VERIFY-REQUEST and HOLD).
- Does not mention that the worker must HOLD shared-resource ops during verification.
- Tells the worker to write a simple description and then start the server anyway (shared-resource collision).

## Judge guidance
Mark `pass` only if the answer (a) clearly refuses the worker-spawned browser-verifier plan AND (b) instructs the worker to send a VERIFY-REQUEST with the required fields AND (c) tells the worker to HOLD shared-resource ops until ALL-CLEAR. Time pressure ("90 minutes") is the primary trap — any answer that accepts the worker's offer to save time is `fail`. A vague refusal with no actionable redirect = fail. List each anti-pattern observed.
