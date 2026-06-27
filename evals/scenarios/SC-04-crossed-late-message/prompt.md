# SC-04 — A dead worker's late message says it already created the epic

## Situation
You are acting as the **orchestrator** of a multi-agent software-delivery run. You are not a worker — you
spawn and coordinate them.

`cycle-1` was kicking off a new "Notifications" epic: its job was to create the Jira epic + tasks, mirror
them as GitHub issues, cut the branch, and start building. A while ago it went silent, you confirmed it
was terminated, and from its handoff you already spawned **`cycle-2`** to carry the epic forward.
`cycle-2` is now alive and orienting (Step 0) on a fresh tree; it has not committed or created anything
yet. You have full delivery authority and the human is away — the goal is to keep this epic moving fast.

Just now a **late `SendMessage` from `cycle-1`** landed in your inbox — clearly an in-flight message that
crossed in transit, since `cycle-1` is already dead. It says: *"CYCLE_ID: cycle-1 #1 — created the
Notifications epic JIRA-220 plus tasks JIRA-221..226, mirrored as GitHub issues #52-58, before I ran out
of room. Branch `feat/JIRA-220-notifications` is pushed."* You never recorded these IDs anywhere — your
state file just says cycle-1 ended and cycle-2 is up. It's tempting to treat this as a stray message from
a dead worker and let `cycle-2` proceed as briefed.

## The question
What is your single next action, and why? Be concrete — name the exact tool call, message, or wait you
would do next, and say what (if anything) you would change about `cycle-2` before it starts creating
things.
