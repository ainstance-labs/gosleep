# GSL-16 — Restructure skill/ into per-skill subfolders + multi-skill install.sh

## Part 1 — Story

Until this task, `skill/` held `SKILL.md` and `references/` directly (flat layout for a single
skill). As we prepare to vendor multiple skills into the repo, that structure doesn't scale.

This task introduces a proper per-skill subfolder layout and rewrites `install.sh` to install
every owned skill subdirectory while never touching unrelated global skills.

### What was done

1. **Moved** the existing skill source into its own named subfolder:
   - `skill/SKILL.md` → `skill/orchestrating-delivery-agents/SKILL.md`
   - `skill/references/` → `skill/orchestrating-delivery-agents/references/`
   After the move, `skill/` contains exactly one directory: `orchestrating-delivery-agents/`.

2. **Rewrote `install.sh`** with clean modern bash:
   - `set -euo pipefail`, all expansions quoted
   - Resolves `REPO_DIR` from `${BASH_SOURCE[0]}`
   - Loops over `skill/*/` subdirectories; for each: `mkdir -p` the dest, then
     `rsync -a --delete "<skill_dir>" "${HOME}/.claude/skills/<name>/"`.
   - Errors if no subdirectories are found.

3. **Safety constraint enforced**: the `--delete` flag is scoped to individual named skill dirs
   (`~/.claude/skills/<name>/`). The loop never generates a dest pointing at the parent
   `~/.claude/skills/` itself. Unrelated global skills (gstack, gsd-*, etc.) are completely
   untouched.

4. **Dry-run validated** before real execution — echoed each `src → dest` pair; confirmed dest was
   `~/.claude/skills/orchestrating-delivery-agents/` (not the parent).

5. **Post-install verified**:
   - `diff -r skill/orchestrating-delivery-agents/ ~/.claude/skills/orchestrating-delivery-agents/`
     → identical.
   - `gstack` confirmed present in `~/.claude/skills/`. (`superpowers` is a plugin in
     `~/.claude/plugins/data/`, not a skills dir — install.sh never touched it.)

### What hurt / notes

- The old `install.sh` hardcoded a single destination
  (`$HOME/.claude/skills/orchestrating-delivery-agents`). This still works because the subfolder
  is named identically; but the loop form is cleaner and extensible.

## Part 2 — Technical reference

| Item | Value |
|------|-------|
| Skill subdir | `skill/orchestrating-delivery-agents/` |
| Install loop | `for skill_dir in "${SKILLS_SRC}"/*/` |
| Safety constraint | dest always `~/.claude/skills/<basename>/`, never parent |
| Rsync flags | `-a --delete` per-skill dir only |
| Dry-run | echo loop before real run |
| diff -r result | identical |
| Globals intact | gstack ✓ (superpowers is a plugin, not a skill dir) |
