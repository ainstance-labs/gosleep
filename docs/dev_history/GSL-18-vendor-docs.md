# GSL-18 — Document the multi-skill layout (CLAUDE.md + skill/README.md)

## Part 1 — Story

GSL-16 and GSL-17 established the per-skill subfolder layout and vendored all 5 skills, but the
project docs still described the old single-skill model. This task brings docs into alignment.

### What was done

1. **Updated `CLAUDE.md`** — "Skill source of truth" and "Gates" sections:
   - Changed from "source of truth for the global `orchestrating-delivery-agents` skill" to
     "source of truth for all 5 owned skills, each in its own named subfolder".
   - Added the full skill directory tree listing.
   - Documented new `install.sh` semantics: loops over every subfolder, installs local → global.
   - Added hard safety rules in bold: `--delete` is per-skill-dir only; parent never touched;
     unrelated globals (gstack, gsd-*, plugins) untouched.
   - Added reverse-sync guidance (global → local) for when the global might be newer.

2. **Added `skill/README.md`** — new index file for the `skill/` directory:
   - Table of all 5 owned skills with name and one-line purpose.
   - Short explanation of how `install.sh` works (loop, per-skill rsync, safety constraint).
   - Sync discipline section covering both directions.

## Part 2 — Technical reference

| File | Change |
|------|--------|
| `CLAUDE.md` | "Skill source of truth" section rewritten; "Gates" section preserved |
| `skill/README.md` | New file: 5-skill index + install.sh mechanics + sync discipline |
