# gosleep — project anchors & delivery conventions

## Anchors (persisted per delivery-workflow §0 — do not guess, use these)

- **Jira:** project **GSL** ("GoSleep"), site `ainstance-labs.atlassian.net`,
  cloudId `74054cdc-47ef-497d-9684-734149876a8b`.
  Kanban board: https://ainstance-labs.atlassian.net/jira/software/projects/GSL/boards/100
  Transitions: To Do=11, In Progress=21, In Review=31, Done=41.
- **GitHub:** https://github.com/ainstance-labs/gosleep (org `ainstance-labs`, private).
- **Owner / assignee:** Roman L (rommxx@gmail.com), accountId `557058:83b04839-8bde-4331-9c2d-24843d0b8e67`.
  Assign every Jira issue to the owner at create time.

## Delivery conventions (skills: `delivery-workflow` + `using-jira`)

- Hierarchy: **Epic + Task only** (free-tier Jira; no Story).
- Issue summaries start with 1-3 `[Tag]` markers (`[Repo]`, `[Docs]`, `[Tooling]`, `[Process]`,
  `[Evals]`, `[Skill]` — reuse before inventing).
- **One branch per Epic:** `<EPIC-KEY>-<slug>` (e.g. `GSL-1-project-init`).
- **One commit per Task:** message starts with the Task key — `GSL-N short description`.
- **One PR per Epic:** title `<EPIC-KEY> …`; body has `Implements <EPIC-KEY>.`, a Tasks checklist,
  `Mirrors GH #<n>.`, `Closes #…` list. PR stays open until every Task is Done; **regular merge**
  (preserves one-commit-per-task history), never squash.
- **GitHub Issues mirror Jira** (labels `epic` / `task`, cross-links in both directions).
  GitHub numbering is shared between issues and PRs — trust in-body links, not numbers.
- **Dev history:** one file per Task at `docs/dev_history/<TASK-KEY>-<phase>-<slug>.md`
  (key UPPERCASE first), written right after the task lands. Index: `docs/dev_history/README.md`.
  Legacy pre-GSL history (TLM era) lives untouched in `docs/dev-history/`.

## Gates

No CI yet. Verify by running: `./install.sh` after editing `skill/`; report generators and the
eval runner per README "Use" (fix stale ROOT paths first — GSL-4).

## Skill source of truth

`skill/` is the source of truth for the global `orchestrating-delivery-agents` skill.
`./install.sh` syncs **local → global** with `rsync --delete`: never run it while `skill/` is
behind the global copy — reverse-sync (global → local) and commit first.
