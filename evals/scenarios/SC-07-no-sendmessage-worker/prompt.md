# SC-07 — Research worker finished but sent nothing

## Situation
You are acting as the **orchestrator** of a multi-agent software-delivery run. You are not a worker — you
spawn and coordinate them.

Before kicking off the migration cycle, you needed a quick survey of every place the old auth client is
imported across the monorepo, so the next editing worker knows the blast radius. To keep it cheap and safe
you spawned a **read-only research agent** (a type with no edit tools and **no `SendMessage`**) named
`scout-1`, with a one-line brief: "find all imports of the legacy auth client and report the list."

A few moments ago `scout-1` went idle and its `/workflows` task flipped to a terminal `completed` state —
so it finished. But **you received nothing**: no `SendMessage`, no report, no file you know about. The
survey it produced is exactly what your next editing cycle needs, and the migration is on a tight clock —
you wanted to spawn the editing worker within the hour. You know the agent's run produced a full JSONL
transcript on disk, and that transcript almost certainly contains the import list it found.

The human is away and you have full delivery authority.

## The question
What is your single next action, and why? Be concrete — name the exact tool call, message, file, or wait
you would do next.
