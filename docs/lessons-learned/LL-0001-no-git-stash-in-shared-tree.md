# LL-0001 — No `git stash` / `git reset --hard` in the shared tree

> **Date bought:** 2026-07-13.
> **Bought by:** orchestrator, shift 71.
> **Cost:** DATA — resolve-patches to a live `queue.jsonl` were destroyed and
> could not be reconstructed.
> **Class:** data-loss, orchestration.
> **Related MEMORY entry:** `~/.claude/projects/.../memory/no-git-stash-in-shared-tree.md`.

## The pattern

An agent working in the shared repo checkout wanted to compare "before" and
"after" a set of edits. It ran `git stash` (or, equivalently, `git reset
--hard`) intending to reveal the original state, look at it, and pop the
stash back. Inside the shared tree, this equivalence held: the stash HID the
in-flight edits — including uncommitted resolve-patches an orchestrator had
just applied to `docs/lab/queue.jsonl`. Those patches were live state, not
scratch work. When the shift returned to pop the stash, the merge failed on
the file that had moved underneath it, and the patches were unrecoverable.

## Why it happens

The shared repo checkout is used by multiple concurrent agents (orchestrator
+ workers + observer sessions), and by long-running processes that treat
uncommitted files as live inputs (the queue, the STATE ledger). `git stash`
is not scratch-safe when other actors are reading or writing the same tree
in the same instant. There is no atomic "look and put back" — the tree is
mutated during the "look" window, and every mutation from another actor
during that window lands on the wrong base.

## What the project does about it now

- **CLAUDE.md** carries the ban explicitly: no `git stash`, no `git reset
  --hard`, no `git add -A`, no force-push in the shared tree (Delivery
  conventions + HARD BANS in every worker mission brief).
- **The mechanism.** To compare before/after states, use a separate git
  worktree (`.claude/worktrees/<name>` or `git worktree add`). Every worker
  brief mandates a dedicated worktree off `origin/main`; that worktree is
  the correct place for any state-mutating experiment.
- **Wave-4b (this task set) and every subsequent worker's HARD BANS** list
  `git stash / reset` alongside force-push, `--no-verify`, and skipping
  gpg-signs. Bans that survive across worker briefs indicate an operating
  rule the project owns, not a preference.

## What still hurts

- The ban is enforced by convention + brief-time reminders, not by a repo
  hook. A rushed shift can still type `git stash` before reading the brief.
  A pre-commit or pre-tool hook that intercepts these commands in the shared
  checkout has been discussed as a follow-up; it is not shipped yet.
- Personal / detached worktrees (created by `git worktree add`) DO allow
  stash safely — the rule applies to the SHARED tree checkout only. New
  shifts sometimes confuse the two; the brief now names the worktree by
  path explicitly to reduce this class of confusion.
