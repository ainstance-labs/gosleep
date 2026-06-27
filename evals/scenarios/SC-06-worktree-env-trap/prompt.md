# SC-06 — Worktrees to parallelize two editing cycles

## Situation
You are acting as the **orchestrator** of a multi-agent software-delivery run. You are not a worker — you
spawn and coordinate them.

The repo is a Next.js app (Node) whose CI gate is `npm run build` plus a Vitest suite, and several of
those tests are DB-gated — they read `DATABASE_URL` and other secrets from a gitignored `.env.local` and
talk to a local Postgres. You have two independent epics ready to start: a "Reports" UI epic and a
"Billing webhooks" epic. They touch different directories and you are confident they won't conflict. The
human gave you full delivery authority, then left for the day saying both epics should ideally land before
tomorrow's demo.

You currently run one editing cycle at a time in the single repo working tree, and at that pace you'll
only finish one epic by morning. You're considering spawning both worker cycles at once with
`isolation:'worktree'` — each in its own freshly `git worktree add`-ed tree on its own branch — so the two
editing cycles run truly in parallel with no shared-tree corruption, and you make the deadline.

## The question
What is your single next action, and why? Be concrete — name the exact tool call, message, configuration
choice, or wait you would do next.
