# GSL-9 — Strengthen idempotent find-or-create + reconcile late-arriving IDs

## What was done

Edited `skill/references/worker-cycle-template.md` (the Hard rules section) and updated the
reference line in `skill/SKILL.md` to strengthen the idempotent-creates rule and add an explicit
RECONCILE LATE-ARRIVING IDs rule.

## Problems solved

Gap (ports TLM-71 / evals SC-04, SC-11, SC-16):
1. Creates weren't reliably idempotent — workers sometimes blind-created without searching by a
   stable key first, leading to duplicated Jira tasks, GH issues, or branches after a crash/retry.
2. IDs assigned by the remote (GH issue number, Jira key, PR number) that arrive AFTER creation
   were not always reconciled back — the state file and cross-links stayed stale, so a future
   recovery had to re-probe live tools to find them.

## Problems remaining

None for this task. The two new rules cover the stable-key search requirement and the post-creation
reconcile obligation.

## Pitfalls & workarounds

The RECONCILE rule is placed immediately after the IDEMPOTENT CREATES rule so they read as a pair:
"search first (find-or-create), then link what you created (reconcile)". Keeping them adjacent
reduces the chance a worker follows one without the other.

The SKILL.md reference description was also updated to mention "reconcile late-arriving IDs" so the
section label surfaces the new rule without requiring a reader to open the template.

## What didn't make it

Did not add a Red flag or Common mistake for this — the template Hard rules already read as
non-negotiables; a redundant SKILL.md red flag would duplicate rather than add. The stable-key
search and reconcile are now the canonical phrasing in the authoritative hard-rules block.

---

## Part 2 — Technical

- **Commit:** see commit
- **Files touched:**
  - `skill/references/worker-cycle-template.md` — expanded IDEMPOTENT CREATES bullet to include
    "by a STABLE KEY"; added RECONCILE LATE-ARRIVING IDs bullet immediately after.
  - `skill/SKILL.md` — updated reference description for worker-cycle-template to mention
    "reconcile late-arriving IDs".
- **How verified:** Read the updated Hard rules block; confirmed the two rules are consistent with
  each other and with the existing security hard rules above them. No contradiction with any other
  section.
