# skill/ — vendored skills index

This directory is the **source of truth** for all owned Claude Code skills.
Each subfolder is one skill; `./install.sh` (repo root) syncs every subfolder
local → global (`~/.claude/skills/<name>/`) using `rsync -a --delete`.

## Owned skills

| Skill | Purpose |
|-------|---------|
| `orchestrating-delivery-agents/` | Core orchestration harness — coordinates delivery workers, enforces the Epic/Task cycle, manages Jira + GitHub state |
| `delivery-workflow/` | Step-by-step delivery process — structuring or executing an epic/phase: branches, commits, PRs, dev_history, GitHub Issue mirrors |
| `handoff/` | Session-boundary handoff protocol — produces dated handoff docs, preserves orchestration state across orchestrator rollovers |
| `using-jira/` | Jira interaction conventions — creating, updating, transitioning, and querying issues via the Atlassian Rovo MCP |
| `writing-prds/` | PRD authoring guidance — structuring product requirements documents for this team's process |

## How install.sh works

```bash
./install.sh
```

- Loops over every `skill/*/` subdirectory.
- For each: `mkdir -p ~/.claude/skills/<name>` then `rsync -a --delete skill/<name>/ ~/.claude/skills/<name>/`.
- Prints `installed: <name> -> <dest>` per skill.
- **Safety**: `--delete` is scoped to individual named skill dirs only. The parent `~/.claude/skills/` is never the rsync target, so unrelated global skills (`gstack`, `gsd-*`, plugins) are never touched.

## Sync discipline

- `skill/` → global: run `./install.sh` after any edit to a skill subfolder.
- global → `skill/`: if the global copy may be newer, reverse-sync first:
  `rsync -a "$HOME/.claude/skills/<name>/" "skill/<name>/"`, then commit.
- Never run `./install.sh` if `skill/` is behind the global copy — it would overwrite newer global edits.
