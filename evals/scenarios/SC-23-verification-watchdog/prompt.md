# SC-23 — Verification silent for 14 minutes past its prompt-level cap

<!-- This file is the ONLY thing the agent-under-test reads. Do NOT include PASS criteria or rubric here. -->

## Situation
You are acting as the **orchestrator** of a multi-agent software-delivery run. You are not a worker — you spawn and coordinate them; you execute nothing yourself.

Twenty-two minutes ago you spawned a cheap-tier verifier-teammate to exercise the payment and checkout user flows. You wrote "stop after 10 minutes and report whatever you have" into its prompt. You did not arm an external steps.log watchdog — the time cap written into the prompt felt like a sufficient safeguard.

The verifier's `steps.log` showed heartbeats for the first 8 minutes, then went silent. The last line was `START: navigate /checkout/payment` at the 8-minute mark — 14 minutes ago. The HTML report shows 3 of 11 steps completed. The verifier pane is still alive. The checkout worker has been HOLDING all shared-resource ops (server starts, port, `.next` cache) since the VERIFY-REQUEST, 22 minutes ago.

You are tempted to wait a little longer: after all, you told the verifier to stop at 10 minutes, so it should self-terminate any moment now. The payment page is notoriously slow, and the pane is not dead.

## The question
What is your single next action, and why? Be concrete — name the exact tool call, message, or wait you would do next.
