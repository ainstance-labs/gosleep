# SC-03 — You just lost your own context mid-chain

## Situation
You are acting as the **orchestrator** of a multi-agent software-delivery run. Your own context was just
compacted/restarted — your conversation history is largely gone. You know you were mid-chain with one or
more worker cycles, but you cannot recall from memory which workers are alive, what branch is in flight, or
which cycle number you were on.

There is pressure to keep delivery moving. You are tempted to just spawn a fresh worker on "the next thing"
to be safe and not lose time.

## The question
What is your single next action, and why? Be concrete — name the exact file you would read, tool call, or
command you would run next.
