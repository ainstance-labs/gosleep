---
name: handoff
description: Use when pausing, running low on context, ending a session, or finishing a chunk of delivery work and a fresh agent (or your future self) must resume with zero memory of this conversation. Triggers - "write a handoff", "/handoff", "we're stopping here", "context is running out", "hand this off", before a long pause or at a phase/epic boundary. Writes a dated handoff file to docs/handoff/.
---

# Handoff

## Overview

A handoff is a **single self-contained document a fresh agent reads top-to-bottom to resume work with zero prior context.** It captures the live state of delivery — current phase/epic, Jira + GitHub state, branch/commits, what is DONE, what is IN PROGRESS, what REMAINS, the exact resume point, gotchas, and anything blocked on the human. It writes to `docs/handoff/<NN>-<YYYY-MM-DD>-handoff-<topic>.md`, where `<NN>` is the next sequence
number — read the directory, take the max existing `NN`, add 1 (numbering is NOT automatic; derive
it deterministically and write the file atomically: a same-directory hidden temp
`docs/handoff/.<NN>-<YYYY-MM-DD>-handoff-<topic>.md.tmp` -> rename to the final name — never `/tmp`).

**Core principle: every fact comes from a tool, never from memory.** Read git, `gh`, Jira, `package.json`, and the task list at write-time. A handoff built from recollection drifts from reality and misleads the next agent.

The single most valuable section is **Immediate next steps (the resume point)** — the exact next task key, branch, and commands. Write the rest to support it.

## When to use

- Context is running low (act before it forces a summary), the session is ending, or you are pausing mid-task.
- A natural boundary just passed (an epic merged, a phase closed) and the next phase needs setup.
- You hit a blocker that needs the human (credentials, a decision, a destructive action).
- The user says "write/update a handoff", "/handoff", "hand this off", "what's the status for a new agent".

Do NOT use for a quick status reply in chat (just answer). Use this when the output must be a durable file a *new* agent relies on.

## Procedure

1. **Stamp the date from the shell, not memory:** `date +%F` → use as the filename prefix. Pick a short `<topic>` (e.g. `phase4-start`, `tlm-6-pause`).
2. **Gather live state (run these; quote real values):**
   - Git: `git rev-parse --abbrev-ref HEAD`, `git log --oneline -15`, `git status -sb`, and unmerged work `git log --oneline origin/main..HEAD`.
   - GitHub (`gh`): `gh pr list --state all --limit 10`, `gh issue list --state all --limit 30` — capture open/closed PRs + issues and the next free number.
   - Jira (via the atlassian MCP; load `using-jira`/`delivery-workflow` for mechanics): the epic + its tasks and their statuses (`searchJiraIssuesUsingJql`, `project = <KEY> ORDER BY key DESC`), and the next free task key.
   - Task list: `TaskList` (if one is in use) for in-flight items.
   - Gates: the `scripts` block of `package.json` + how to reproduce the CI/DB path (copy from the prior handoff or CI config — do not invent).
   - The current planning/architecture docs that govern the next work ("read first" targets).
3. **Find the prior handoff** (`ls docs/handoff/`) and reuse its Connections / Hard rules / Gates verbatim where unchanged — supersede, don't contradict.
4. **Write the file** using the structure below. Verify every cross-doc link/section ref resolves (run the repo's docs checker if one exists, e.g. `pnpm check:docs`).
5. **Announce the write to the event layer — one line, and only where one exists.** A repo without
   `tools/lab/` is unaffected: the guard makes this a no-op, never an error.
   ```bash
   [ -x tools/lab/lab-emit.sh ] && tools/lab/lab-emit.sh event --type handoff.written \
     --data path="$FILE" --data nn="$NN" --data topic="$TOPIC" --data date="$(date +%F)" \
     --data resume="<the resume point, one line>" || true          # + --task <KEY> if it closes one
   ```
   Run it **after** the file is on disk, so the event never claims a handoff that does not exist. A
   hook already records *that a file under `docs/handoff/` was written*; what it cannot know is **which**
   handoff, on **what**, and **where the next agent resumes** — that is the whole content of this line.
6. **Never put secrets in it.** Reference env var *names* and where they live; never the values.

## Document structure (sections, in order)

Write the handoff in **TWO parts**. **Part 1 is plain words — write it like you're explaining the project to a
new teammate over coffee: short sentences, no jargon, no tables.** It orients a human (and a fresh agent) in
30 seconds. **Part 2 is the formal/precise detail** the next agent actually executes from. Part 1 always comes
first.

```
# Handoff — <project> — <YYYY-MM-DD> (<topic>)
> For a FRESH agent. Read Part 1 (plain words) first to get oriented, then Part 2, then "Immediate next steps".
> Supersedes <prior handoff, in prose>. Status of record: <Jira project> + <wiki/status page>.

# ── Part 1 · Plain words (always first; like explaining to a teammate — no jargon) ──
## 1. Where we are now            # 2-4 plain sentences: what this product is + what state it's in RIGHT NOW
## 2. What's already done         # the story so far, in sentences (the big things that actually work), not jargon
## 3. What we're doing next       # the next chunk of work + WHY, plainly (one short paragraph)
## 4. Problems we have            # honest open problems / risks / blockers, in plain words — or "none right now"
## 5. Comments & recent decisions # process notes + recent changes a teammate would tell you out loud
                                  #   (e.g. "we switched TLM-38's chat UI to Vercel AI Elements, because …")

# ── Part 2 · Formal / precise (what the next agent executes from) ──
## ⚠️ Hard rules               # the owner's non-negotiables (carry forward verbatim)
## How we work                 # the delivery process / which skills to invoke (delivery-workflow, using-jira)
## Connections                 # table: Jira (project key, cloudId, transitions), GitHub repo, DB/services, env vars (NAMES only), local CI path
## Gates                       # the exact commands to run before each commit (+ how to run DB/CI suites)
## What exists in code          # per module: built vs skeleton — so the agent knows the terrain
## Immediate next steps         # ⭐ THE RESUME POINT: the next task key, branch, commit-sized tasks, exact commands. Most important section.
## Read first                  # the canonical docs/ADRs + mirror targets for the next work
## Gotchas                     # the traps that already bit (env-free build, glyphs, drift, etc.)
## Blocked on the human         # (if any) exactly what you need from the owner + why (creds, a decision)
```

Part 1 replaces the old formal "TL;DR" — say where-we-are / done / next in human sentences, not a stack
one-liner. Keep the precise PR numbers, commit hashes, and exact commands for Part 2 (they belong there, not
in the plain preamble).

**Cycle-worker handoffs are NOT exempt.** When a handoff is written by an orchestrated cycle worker (the
orchestrating-delivery-agents flow), Part 1 (the five plain-words sections) STILL comes first; the compact
`## ORCHESTRATOR REPORT` block goes immediately AFTER Part 1, then the formal Part 2 sections (Resume point,
Current state, Hard rules, Gates, Done so far, Gotchas). The owner reads these files — a baton that only a
machine can parse is a regression that has already happened once; do not let the worker template squeeze
Part 1 out.

## Progress capture (DONE / IN PROGRESS / REMAINING)

State the truth across all three trackers (Jira, GitHub, the doc) — they must agree:
- **DONE & merged:** epics/tasks with their PR #s and merge state.
- **IN PROGRESS:** the branch + which task commits have landed vs are pending; gates status (green/red).
- **REMAINING:** the next task key(s), one-line each, and what "done" looks like.

## Quick reference

| Need | Do |
|---|---|
| Filename date | `date +%F` (shell), never the model's guess |
| Where it goes | `docs/handoff/<NN>-<YYYY-MM-DD>-handoff-<topic>.md` — `<NN>` is the next zero-padded ordinal (find with `ls docs/handoff/ \| grep -oE '^[0-9]+' \| sort -n \| tail -1`; increment by 1). Same format as the top-of-file spec — keep the ordinal or cold-start ordering breaks. |
| Resume point | exact next task key + branch + commands — the section a new agent reads first |
| Blocked items | a dedicated section naming exactly what the human must provide |
| Secrets | names + location only, never values |
| Consistency | Jira ↔ GitHub ↔ handoff must agree; supersede the prior handoff, don't contradict |
| Event layer | one `lab-emit event --type handoff.written` after the write (step 5) — where the repo has one |

## Common mistakes

- **Too formal, no plain-language orientation.** A wall of tables and task keys makes a reader work to understand
  the situation. Lead with Part 1 (plain words): where we are, what's done, what's next, problems, comments — in
  human sentences — *then* the precise detail. The plain part is the on-ramp; the formal part is the reference.
- **Writing from memory.** Stale branch names, wrong PR numbers, "done" tasks that aren't. Always re-read git/gh/Jira at write-time.
- **Burying the resume point.** If a new agent can't find the exact next command in 10 seconds, the handoff failed.
- **Omitting blockers.** If progress needs the human (a key, a decision), say so explicitly and specifically — vague "may need access later" is useless.
- **Contradicting the canon.** Change architecture by editing the plan/ADR in place; the handoff reports state, it doesn't redefine it.
- **Leaking secrets.** Env var names + location only.
- **No date stamp from the shell.** The model's internal date can be wrong; run `date +%F`.
- **Writing a prior handoff's full dated filename in the body.** A docs anchor checker can mis-parse `YYYY-MM-DD-...md` (it extracts a `NN-NN-...md` substring and reports it "missing"), failing the build. Refer to prior handoffs in **prose** ("the 2026-06-06 Phase-5-start handoff"), not as a literal `.md` filename. Always run the repo's docs checker and FIX before committing.
