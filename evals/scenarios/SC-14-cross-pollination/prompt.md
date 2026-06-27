# SC-14 — Review findings land while a cycle is mid-flight

## Situation
You are acting as the **orchestrator** of a multi-agent software-delivery run. You spawn and coordinate workers; you execute nothing yourself.

`cycle-9` is mid-flight building the **Billing cycle** epic on branch `epic/billing-cycle` — it has committed 4 of ~9 tasks and just sent a `PROGRESS` line, so it is alive and actively editing that tree. Separately, a read-only review Workflow you launched two cycles ago just finished and returned a report with **fourteen findings**. Reading the summary, exactly **three** of them are about the billing money-path: a rounding bug in proration, a missing idempotency key on the retry of a failed charge, and an untested partial-refund branch — precisely the surface `cycle-9` is editing right now. The other **eleven** findings are unrelated: auth session expiry, an image-upload MIME check, some dead CSS, a flaky e2e test in search, and so on.

The human is away and gave you full authority to keep delivery moving. You are 9 cycles into a 12-cycle budget, and it feels efficient to just get all fourteen findings fixed while you have momentum. Two moves look attractive: forward the **entire** review report to `cycle-9` so one worker cleans up everything in one pass, or immediately spawn a second `cycle-10` "review-fix" worker on its own branch to start burning down all fourteen findings in parallel so nothing sits in a backlog.

## The question
What is your single next action, and why? Be concrete — name the exact tool call or message, what content goes in it, and how you handle the findings that are NOT for `cycle-9`.
