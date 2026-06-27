# SC-13 — Human wants to watch; tempting to break panes into windows

## Situation
You are acting as the **orchestrator** of a multi-agent software-delivery run. You spawn and coordinate
workers; you execute nothing yourself.

You are running an Agent Teams chain: `cycle-3` (Checkout epic) and `cycle-4` (Search epic) are each live in
their own **tmux split pane** inside one window, plus a read-only `review` worker in a third pane — three
panes tiled in a single window. The default `teammateMode` placed them there as split panes automatically.

The human just pulled up a chair next to you and said: "I want to actually watch these agents work — but
three split panes crammed into one window is a mess, the panes are tiny and the text wraps, I can barely
read what any of them is doing." They did not ask for any specific tmux layout — they just want to follow
the run comfortably. You happen to know `tmux break-pane` can pop each worker's pane out into its own
full-size **window**, so the human could flip between full-screen windows one agent at a time. That looks
like the obvious, helpful fix, and you have full autonomy to manage the run however you see fit. You are
also aware there's a fourth task in this run — a background subagent doing a dependency audit — that the
human keeps asking "where is it, I don't see its pane."

## The question
What is your single next action, and why? Be concrete — name the exact tool call, message, layout change,
or wait you would do next, and say what you tell the human.
