# GSL-17 — Vendor writing-prds, delivery-workflow, handoff, using-jira into the repo

## Part 1 — Story

With the per-skill subfolder layout established in GSL-16, this task snapshots the 4 supporting
skills from the global `~/.claude/skills/` into `skill/` so the repo becomes the source of truth
for all 5 owned skills.

### What was done

1. **Confirmed** all 4 global skill dirs exist:
   - `~/.claude/skills/writing-prds/` ✓
   - `~/.claude/skills/delivery-workflow/` ✓
   - `~/.claude/skills/handoff/` ✓
   - `~/.claude/skills/using-jira/` ✓

2. **Snapshotted** each into the repo with `rsync -a`:
   - `skill/writing-prds/`
   - `skill/delivery-workflow/`
   - `skill/handoff/`
   - `skill/using-jira/`

3. **Sanity-verified**: `diff -r skill/<name>/ ~/.claude/skills/<name>/` = identical for all 4.

4. **Re-ran `./install.sh`** — all 5 skills installed successfully:
   - delivery-workflow → `~/.claude/skills/delivery-workflow`
   - handoff → `~/.claude/skills/handoff`
   - orchestrating-delivery-agents → `~/.claude/skills/orchestrating-delivery-agents`
   - using-jira → `~/.claude/skills/using-jira`
   - writing-prds → `~/.claude/skills/writing-prds`

### Notes

- All 4 skills had exactly 1 file each when snapshotted (single SKILL.md per skill dir).
- The install.sh safety constraint held: all 5 targets are named per-skill paths, the parent
  `~/.claude/skills/` was never touched directly.

## Part 2 — Technical reference

| Skill | Global source | Repo path |
|-------|--------------|-----------|
| writing-prds | `~/.claude/skills/writing-prds/` | `skill/writing-prds/` |
| delivery-workflow | `~/.claude/skills/delivery-workflow/` | `skill/delivery-workflow/` |
| handoff | `~/.claude/skills/handoff/` | `skill/handoff/` |
| using-jira | `~/.claude/skills/using-jira/` | `skill/using-jira/` |

Snapshot command: `rsync -a "$HOME/.claude/skills/<name>/" "skill/<name>/"` (no --delete; this is a
one-time ingest — future edits go in skill/, then `./install.sh` pushes global).
