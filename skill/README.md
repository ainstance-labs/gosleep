# skill/ — vendored skills index

This directory is the **source of truth** for all owned Claude Code skills.
Each subfolder is one skill; `./install.sh` (repo root) syncs every subfolder
local → global (`~/.claude/skills/<name>/`) using `rsync -a --delete`.

## Owned skills

Twelve owned skills total: seven dev copies + five orphan-rescued from the
global tree via GSL-334 Phase 0. **Global (`~/.claude/skills/<name>/`) remains
authoritative** per the standing rule (owner directive 2026-07-20); this repo
copy is a redundancy layer so a single `rm` on the global tree is not a
permanent-loss event.

| Skill | Purpose |
|-------|---------|
| `orchestrating-delivery-agents/` | Core orchestration harness — coordinates delivery workers, enforces the Epic/Task cycle, manages Jira + GitHub state |
| `delivery-workflow/` | Step-by-step delivery process — structuring or executing an epic/phase: branches, commits, PRs, dev_history, GitHub Issue mirrors |
| `handoff/` | Session-boundary handoff protocol — produces dated handoff docs, preserves orchestration state across orchestrator rollovers |
| `using-jira/` | Jira interaction conventions — creating, updating, transitioning, and querying issues via the Atlassian Rovo MCP |
| `writing-prds/` | PRD authoring guidance — structuring product requirements documents for this team's process |
| `remote-control/` | Remote-control pairing — reach a live Claude Code session from a phone (steer orchestrator, approve permissions, monitor overnight) |
| `tmux-agents-orchestration/` | Practical tmux pane discipline for orchestrator/teammate spawn/kill lifecycles (session caps, cleanup, incident lessons) |
| `agentic-report-creator/` | Structured-payload → shareable HTML dashboard (Vercel/Linear aesthetic; light + dark; EN primary + RU shell; keyboard-navigable screenshot lightbox) — rescued GSL-334 |
| `agentic-scenario-runner/` | Cost-aware sanity for runs / samples / evals / model comparisons before spending API calls or agent-hours — rescued GSL-334 |
| `efficient-agent-evals/` | Evaluation efficiency for AI skills / prompts / agent harnesses — same signal at a fraction of agents + tokens — rescued GSL-334 |
| `extra-usage/` | Opt-in session modifier lifting the default token-economy rails when the owner wants maximum spend — rescued GSL-334 |
| `verifier-skeptic/` | Adversarial Epic verification against design source of truth; files numbered `verifier`-labelled Jira Tasks + HTML dashboard — rescued GSL-334 |

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
