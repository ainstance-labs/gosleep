# GSL-336 — [Docs][Skill] dev_history + CLAUDE.md note for orphan rescue

Part of GSL-334 (Phase 0 of the owner-approved skills → plugins strategy). Mirrors GH #338.

## Part 1 — the story

GSL-335 restored the 5 orphan skills into `skill/`. This task closes the paperwork on that
rescue: one dev-history file per Phase 0 task (this one + `GSL-335-…`), one epic entry in
`docs/dev_history/README.md`, and the CLAUDE.md skill-list note reflecting the new inventory
count.

The tricky bit was the count. The team-lead's brief said "12 owned skills = 7 dev copies + 5
rescued orphans", but that assumes `tmux-agents-orchestration` is already on `main`. It
isn't — it lives on the unmerged `GSL-174-skills-management` branch and only reaches `main`
when GSL-174 lands. So on THIS Phase-0 branch the accurate count is:

- 6 pre-existing dev copies on `origin/main`: `delivery-workflow`, `handoff`,
  `orchestrating-delivery-agents`, `remote-control`, `using-jira`, `writing-prds`
- 5 rescued orphans (GSL-335): `agentic-report-creator`, `agentic-scenario-runner`,
  `efficient-agent-evals`, `extra-usage`, `verifier-skeptic`
- **11 owned skills total on this branch.** Once GSL-174 merges (adding
  `tmux-agents-orchestration`), the count reaches 12.

Chose to reflect the ACTUAL state of THIS branch rather than an aspirational "will-become"
number — a CLAUDE.md count must match the tree it lives in. The note calls out the pending
delta explicitly so nobody trips over it later.

Also fixed a pre-existing drift: the CLAUDE.md skill list on `main` still said "5 owned
skills" and listed 5 of the 6 (missed `remote-control`). Left un-fixed, the update would have
been "5 owned skills → 11" which is worse than "6 → 11". Called out the fix inline.

## Part 2 — technical reference

**Files touched (T2):**

- `docs/dev_history/GSL-335-phase0-orphan-skill-rescue.md` — new; Part 1 story + Part 2 tech
  reference for the rescue commit itself.
- `docs/dev_history/GSL-336-phase0-devhistory-claudemd-inventory.md` — this file.
- `docs/dev_history/README.md` — inserted a new epic block `Epic GSL-334 — Phase 0 orphan
  skill rescue (5 global-only skills into repo)` above the `Epic GSL-330` block, with two
  bullet entries linking to the two Phase 0 task files.
- `CLAUDE.md` — `## Skill source of truth` section rewritten:
  - count: `all 5 owned skills` → `all 11 owned skills (6 dev copies + 5 rescued orphans)`
  - listing: added `remote-control/` (missed on `main`) + 5 rescued subdirs with brief notes
  - added a paragraph naming the orphan rescue as redundancy-only, not a source-of-truth flip
  - added the `→ 12` breadcrumb tied to GSL-174 landing
  - safety rules unchanged (they were already correct)

**Guardrails held:** identical to GSL-335 — no shared-tree writes, no `git stash`, no
`add -A`, no force-push, global never written, `./install.sh` / `publish.sh` never invoked.

**Gates:** same story as GSL-335 — the scope is documentation only (4 files), no shell/TS
touched, pre-existing smoke/tsc FAILs are not caused by this change (a scope diff against
`origin/main` proves it).
