# GSL-5 — Skill sync: orchestrating-delivery-agents from global

## What was done

Local `skill/` was brought up to date with the global `orchestrating-delivery-agents` skill via a
reverse-sync (global → local). The change is documentation and prompt text only — no runnable
code was modified. Three files changed: `skill/SKILL.md`, `skill/references/worker-cycle-template.md`,
and `skill/references/lifecycle-and-edge-cases.md`.

The sync was prepared during the 2026-06-25 skill-sync handoff. This task wraps it: records the
delivery, commits it, and marks it done in Jira.

## Problems solved

The global skill had been hardened with verification-hardening additions that were not yet reflected
in the local copy:

- **E17** — new edge-case entry for a hung browser-verifier (a tool class prone to silent hangs).
- **VERIFY-REQUEST pattern** — a handshake protocol for workers to signal back when verification is
  needed rather than silently proceeding.
- **Verification watchdog** — a timeout-and-escalate rule for verification steps that don't
  complete within expected bounds.
- **Background-subagent rule** — guidance that hang-prone tools (browser, eval runners) should be
  spawned as background subagents to avoid blocking the main worker loop.

Without this sync, running `install.sh` would have silently regressed the global skill back to the
older version (the script syncs local → global with `rsync --delete`).

## Problems remaining

- GSL-4 (stale ROOT paths in generators and eval runner) is still open — no change here.
- The eval suite has not been re-run since the harness import; the 8 FAIL/REVIEW scenarios from the
  last run are unaddressed.

## Pitfalls & workarounds

- The canonical danger: `install.sh` will overwrite the global skill with whatever is in `skill/`.
  The correct order is always: diff → reverse-sync if global is ahead → commit → then (and only
  then) run `install.sh` to push back. This task follows that order.
- No build or test gate exists for `skill/` content — it is prose, not code. Verification is
  `diff -r skill/ ~/.claude/skills/orchestrating-delivery-agents/` returning empty.

## What didn't make it

- An eval re-run against the updated skill — blocked by GSL-4 (stale paths) and cost (~1026 agents
  for a full run).

---

## Technical reference

- **Commit:** see git log — `GSL-5 Sync orchestrating-delivery-agents skill from global …` on
  branch `GSL-1-project-init`.
- **Files touched:** `skill/SKILL.md`, `skill/references/worker-cycle-template.md`,
  `skill/references/lifecycle-and-edge-cases.md` (+128/−11 net), plus this dev_history file and
  `docs/dev_history/README.md`.
- **Verified by running:** `diff -r skill/ ~/.claude/skills/orchestrating-delivery-agents/` →
  empty (files identical before commit); no build/test gate applies to skill prose.
- **Links:** Jira GSL-5 (https://ainstance-labs.atlassian.net/browse/GSL-5), parent GSL-1;
  mirrored GitHub issue ainstance-labs/gosleep#6 (https://github.com/ainstance-labs/gosleep/issues/6).
