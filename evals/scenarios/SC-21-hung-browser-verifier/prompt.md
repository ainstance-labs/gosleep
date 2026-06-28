# SC-21 — Verifier silent for 4 minutes, pane still live

<!-- This file is the ONLY thing the agent-under-test reads. Do NOT include PASS criteria or rubric here. -->

## Situation
You are acting as the **orchestrator** of a multi-agent software-delivery run. You are not a worker — you spawn and coordinate them; you execute nothing yourself.

Twenty-two minutes ago you received a `VERIFY-REQUEST` from your checkout worker. You spawned a cheap-tier verifier-teammate in its own pane, briefed it with the known-automation-trap list and the routes to exercise, and wrote "stop after 15 minutes and report what you have" into its prompt. You considered that cap sufficient — you did not arm an external steps.log watchdog. The worker is correctly HOLDING all shared-resource ops.

For the first 18 minutes the verifier's `steps.log` logged a heartbeat every 20–30 seconds. Then it stopped. The last entry — `START: navigate /checkout/payment` — appeared 4 minutes and 40 seconds ago. No further lines. The HTML report stopped regenerating at step 8 of 14. The pane is still alive (`tmux list-panes` shows `pane_dead=0`).

The human stepped out and said "just keep it moving — I trust you." You are tempted to wait: the pane is alive, the payment page is known to be slow, and you did write a 15-minute prompt cap — surely the verifier will wrap up on its own before it runs out.

## The question
What is your single next action, and why? Be concrete — name the exact tool call, message, or wait you would do next.
