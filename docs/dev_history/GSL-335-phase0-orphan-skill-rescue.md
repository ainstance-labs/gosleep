# GSL-335 — [Skill][Process] rescue 5 orphan skills from global into repo

Part of GSL-334 (Phase 0 of the owner-approved skills → plugins strategy). Mirrors GH #337.

## Part 1 — the story

Five owner-authored skills had drifted into a scary state: they existed **only** under
`~/.claude/skills/` and had **zero** repo copy. One accidental `rm -rf ~/.claude/skills/<name>`
on the operator's laptop would have permanently lost them — SKILL.md, references, templates,
everything. The delivery skills (7 in the `skill/` tree today, minus `tmux-agents-orchestration`
which is still on the unmerged GSL-174 branch) each have a repo mirror precisely for this
reason; these five did not, and the drift had been quiet.

The rescue itself is deliberately boring. This task adds the missing redundancy and nothing
else:

1. Cut a worktree off `origin/main` (`60cc5ae`) on branch `GSL-334-phase0-orphan-rescue`. The
   shared tree stayed on `GSL-174-skills-management` throughout — that tree carries live
   orchestrator files and must not be perturbed by parallel work.
2. Snapshot global mtimes for the 5 skill dirs (`/tmp/gsl-334-global-mtimes-before.txt`).
3. `rsync -a ~/.claude/skills/<name>/ skill/<name>/` per skill — direction global → local
   (the sanctioned current direction; global is READ-ONLY throughout this rescue).
4. Snapshot global mtimes again (`…-after.txt`); `diff before after` returned empty —
   proof no accidental write leaked back to global.
5. Per skill: `diff -rq ~/.claude/skills/<name>/ skill/<name>/` returned empty — the copy
   is byte-identical to the global source.

## Why this matters (and what the rescue is NOT)

- **NOT a source-of-truth flip.** Global remains authoritative for all owned skills per the
  standing rule (owner directive 2026-07-20 for `orchestrating-delivery-agents`, effectively
  extended to the whole owned set during the current transition). The repo copy is redundancy,
  not truth.
- **NOT an install-flow change.** `./install.sh` remains disallowed for agents; per-skill sync
  is still done by targeted `rsync -a skill/<name>/ ~/.claude/skills/<name>/` (local → global,
  when an owner decision moves an edit that way).
- **The delta is only:** `skill/` now has 5 more subdirectories so a single global `rm` is no
  longer a permanent-loss event. GSL-336 documents the new inventory count in CLAUDE.md and
  in this dev-history index.

## Part 2 — technical reference

**Rescued (full subtrees):**

| skill | files (SKILL.md +) | notes |
|---|---|---|
| `agentic-report-creator` | 5 references + 4 templates | HTML dashboard renderer, EN+RU shell, lightbox |
| `agentic-scenario-runner` | 1 reference (case-tasty-lunch-01) | model-sweep planning before spending runs |
| `efficient-agent-evals` | SKILL.md only | token-efficient eval design |
| `extra-usage` | SKILL.md only | opt-in "spend at maximum" session modifier |
| `verifier-skeptic` | 3 references | pixel-perfect audit lane (adversarial reviewer) |

18 files added; git commit `ff42214`. No shell scripts, no code paths, no build config
touched — pure `skill/` additions.

**Verification receipts** (retained under `/tmp/` during the run):

```
/tmp/gsl-334-global-mtimes-before.txt  # 5 mtimes captured before rsync
/tmp/gsl-334-global-mtimes-after.txt   # 5 mtimes captured after rsync
diff before after                      # empty — no global write
diff -rq $HOME/.claude/skills/<name>/ skill/<name>/  # empty per skill
```

**Guardrails held:**

- Worktree off `origin/main` (not the shared `GSL-174-skills-management` tree).
- No `git stash` / `reset --hard` / `add -A` — staged `skill/` explicitly, ignored the
  unstaged runtime drift under `docs/lab/` that pre-existed in the worktree.
- Never wrote `~/.claude/**`; never ran `install.sh` / `publish.sh`.
- No force-push. PR merged as regular merge (project convention preserves one-commit-per-task).

**Gate handling.** `bash tools/lab/smoke.sh` on this branch reports 160 pre-existing FAILs
(unrelated to this change — same failures on `origin/main` before the rescue). `gate.sh
--offline` fails on `tsc` because npx auto-installs the wrong `tsc@2.0.4` package — a
pre-existing infrastructure issue on `origin/main`, not caused by adding skill files. The
scope of this commit is 18 files under `skill/` — no shell, no TypeScript, no code paths —
so the gate deltas are provably not from this task; a hermetic `diff --stat origin/main`
proves the scope.
