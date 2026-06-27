# GSL-3 — Project anchors: CLAUDE.md, dev_history, README

## What was done

The delivery process got wired into the repo itself. `CLAUDE.md` now records the anchors a fresh
agent needs (Jira project GSL with cloudId and transition ids, the GitHub repo, the owner's
accountId) plus the team conventions (Epic+Task, one branch per epic, one commit per task, one PR
per epic, the GitHub-issues mirror, the dev-history format). The new per-task dev-history log
started at `docs/dev_history/` with this file and the GSL-2 entry, and the README was rewritten
for the standalone repo: real links, corrected paths, honest status.

## Problems solved

- The old README still described the project as "temporarily living under docs/ in tasty-lunch"
  and pointed at a `design/` directory that is actually `docs/design/` — both fixed.
- Connection data (cloudId, transition ids, accountId) previously lived only in a handoff file
  from the TLM era; a fresh session had to rediscover it. It is now in `CLAUDE.md`, which loads
  automatically.

## Problems remaining

- None new. GSL-4 (stale ROOT paths) is still the open task of the epic.

## Pitfalls & workarounds

- Two dev-history directories now coexist: `docs/dev-history/` (hyphen — legacy TLM-era narrative,
  numbered files, frozen) and `docs/dev_history/` (underscore — the live per-task log keyed by
  Jira task). This is deliberate: the legacy log is imported history, not a place for new entries.
- GitHub issue/PR numbers share one counter, so the Jira↔GitHub mapping must rely on in-body
  cross-links, never on number equality.

## What didn't make it

- Jira remote-links (the REST `remotelink` endpoint) — they need a Jira API token, which is not
  configured; the GitHub refs went into Jira as comments instead.
- A `docs/wiki/` status page — the project's knowledge base (`docs/report/`) already covers it;
  revisit if the wiki convention becomes useful here.

---

## Technical reference

- **Commit:** the commit carrying this file on branch `GSL-1-project-init` (message `GSL-3 …`).
- **Files:** `CLAUDE.md` (new), `docs/dev_history/README.md` (new index),
  `docs/dev_history/GSL-2-init-harness-import.md` (new), this file, `README.md` (rewritten).
- **Verified by running:** n/a (docs-only); links and paths spot-checked against the live repo
  and Jira board.
- **Links:** Jira GSL-3 (parent GSL-1); mirrored GitHub issue — see the Epic PR checklist.
