# GSL-14 — Track orchestration artifacts in git; gitignore .vscode

## What was done

Added the untracked orchestration artifacts (handoff files, ORCHESTRATION-STATE.md, kickoff prompts)
to git so they persist across machines and are visible in PR history. Also added `.vscode/` to
`.gitignore` so editor settings don't pollute the working-tree status output.

## Problems solved

These files existed on disk but were not committed, meaning a clone or fresh checkout would lose the
orchestration ledger (handoffs 02 and 03, the state file, the prompts directory). They were listed
as untracked noise in `git status` which obscures real changes.

## Problems remaining

None for this task.

## Pitfalls & workarounds

`docs/handoff/ORCHESTRATION-STATE.md` is committed as-is — it is a live file that the orchestrator
overwrites on each status change, so it will need periodic commits; this first commit just brings it
under version control without editing its content.

## What didn't make it

N/A — scope was narrow and fully executed.

---

## Part 2 — Technical

- **Commit:** see commit
- **Files touched:**
  - `.gitignore` — appended `.vscode/` entry
  - `docs/handoff/02-2026-06-25-handoff-skill-sync.md` — newly tracked
  - `docs/handoff/03-2026-06-26-handoff-gsl1-complete-pane-mode.md` — newly tracked
  - `docs/handoff/ORCHESTRATION-STATE.md` — newly tracked (content unchanged)
  - `docs/prompts/` — entire directory newly tracked
  - `docs/dev_history/GSL-14-harden-track-orchestration-artifacts.md` — this file
  - `docs/dev_history/README.md` — index line appended
- **How verified:** `git status` after staging shows exactly the intended files; `.vscode/` no longer
  appears as untracked.
