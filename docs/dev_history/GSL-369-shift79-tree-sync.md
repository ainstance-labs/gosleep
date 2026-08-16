# GSL-369 — [Process][Repo] Sync shared tree to main; commit shift-78 ledger

## Part 1 — What happened (plain-language)

The shared working tree sat on a stale local branch `GSL-174-skills-management`
with 19 modified tracked files (orchestrator lab state, handoffs, `.claude/settings.json`)
and 34 untracked path groups (six new handoffs 57-62, six morning digests, ten daily
events files, five verification report dirs, two plan/research report dirs, and a
`docs/reports/web-stack-audit-2026-08-06/` follow-up). Nothing that hit main in the last
two weeks (Observer-mode Phases A + B, GSL-350..366, five merged PRs #349..#351) had
been checked into this tree. Housekeep-79 was the shift-79 worker tasked with folding
everything back onto `main` without losing a byte, without touching another worker's
in-flight `docs/reports/backlog-triage-2026-08-16/` directory, and without touching
anything under `data/`.

The pre-flight cleared cleanly: `git log origin/main..HEAD` empty, `git cherry -v
origin/main` empty — the stale branch had ZERO commits absent from main by content, so
the fast-forward path was safe (main was 63 commits ahead, not diverged). All 19
modified tracked files were per-file backed up to
`.claude/backups/tree-sync-2026-08-16/`, byte-verified with `cmp` (fail=0).

The interesting wrinkle was `git checkout main` refusing to switch because 546 local
untracked files under `docs/reports/verifications/web-e2e-2026-08-10/runs/{03..07}/`
and `tools/e2e/` would be overwritten by tracked versions in main (these directories
were merged into main during shift-78 while the local tree was still on the pre-merge
branch). The systematic fix: build the intersection set via `comm -12` of `git
ls-files --others --exclude-standard` and `git ls-tree -r main --name-only` (546 paths
exactly), then compare local vs main using `git hash-object --stdin-paths` against
`git ls-tree -r main` blob SHAs (fast: seconds instead of the 2-minute timeout that
per-file `git show | cmp` produced). Every one of the 546 was SHA-identical to main —
so moving them aside under `.claude/backups/tree-sync-2026-08-16/moved-aside/` (per
procedure step 4, never `git checkout --` to discard) was a redundant-but-honest
safety copy, not a data-loss risk. Checkout then succeeded, `git pull --ff-only` was a
no-op (already at `origin/main` tip `53bab60`), and the 19 modifications carried
forward onto main unchanged (they were on top of a committed base already in main).

Staging was explicit-by-path per rule: each of the 19 M/MM files individually, each
of the six shift-78 handoffs individually, `docs/lab/digest/`, `docs/lab/events/`, and
each of the six new report directories. `.claude/backups/` and
`docs/reports/backlog-triage-2026-08-16/` were consciously left out. One commit, one
`git push origin main` (no rejection), one Jira transition to Done, one GH mirror
close comment.

## Part 2 — Technical reference

**Pre-flight (proved safe to fast-forward):**
- `git log origin/main..HEAD --oneline` → empty (0 unmerged local commits by content)
- `git cherry -v origin/main` → empty
- HEAD before: `db30235` (GSL-251 reverse-sync); origin/main: `53bab60` (merge #351)
- Modified count: 19; untracked path groups: 34

**Backup discipline:**
- 19 M/MM tracked files → `.claude/backups/tree-sync-2026-08-16/<same-rel-path>`;
  byte-verified with `cmp -s` (all 19 identical, fail=0)
- 546 conflict files under `docs/reports/verifications/web-e2e-2026-08-10/runs/{03..07}/`
  and `tools/e2e/` → `.claude/backups/tree-sync-2026-08-16/moved-aside/<same-rel-path>`
  (SHA-verified against main blob hashes first; all 546 identical to main)

**Fast SHA comparison (the interesting bit):**
```
git hash-object --stdin-paths < /tmp/conflicts.txt > /tmp/local-shas.txt
git ls-tree -r main | awk '{print $4"\t"$3}' | sort > /tmp/main-tree.tsv
paste /tmp/conflicts.txt /tmp/local-shas.txt |
  awk -F'\t' 'NR==FNR{main[$1]=$2; next} {if($2!=main[$1]) print}' /tmp/main-tree.tsv -
```
Zero divergence — the naive `git show main:$f | cmp -s - "$f"` loop took >120s and
timed out; SHA comparison finished in <2s.

**What got committed (explicit paths — no `git add -A`):**
- `.claude/settings.json` (owner-approved permissions from shift 78)
- `docs/handoff/ORCHESTRATION-STATE.md` + handoffs 57..62 (six new files)
- `docs/lab/digest/` (six new morning digests: 2026-08-07..11 + 08-16)
- `docs/lab/events/` (10 new daily event files 2026-08-06..16, plus 08-05 tail update)
- `docs/lab/decisions/log.jsonl`, `docs/lab/questions/*.jsonl`,
  `docs/lab/supervision/*.jsonl`, `docs/lab/site/*.html`,
  `docs/lab/render_bundle.json`, `docs/lab/status.json`, `docs/lab/mobile/README.md`
- `docs/reports/plugin-migration-research-2026-08-15/`
- `docs/reports/skills-management-plan-2026-08-10/`
- `docs/reports/web-stack-audit-2026-08-06/`
- `docs/reports/verifications/GSL-174-night/runs/01/index.html`
- `docs/reports/verifications/GSL-174-night/runs/02/`
- `docs/reports/verifications/GSL-250/`, `.../GSL-347/`
- `docs/reports/verifications/plugin-e2e-2026-08-16/`
- `docs/reports/verifications/web-e2e-2026-08-10/runs/01/`, `02/`, `08/`

**Consciously excluded:**
- `docs/reports/backlog-triage-2026-08-16/` (in-flight by another worker; happens to
  be empty in this tree — nothing to leak)
- Anything under `data/` (git-ignored anyway; `smoke.sh` guard also enforces this)
- `.claude/backups/` (the backup dir itself; not intended for commit)

**Ban list honoured:** no `git stash`, no `git reset`, no `git checkout -- <file>`
discard, no `git add -A` / `.`, no force-push, no `/tmp` for repo content (only for
scratch analysis files consumed and forgotten), no writes to `~/.claude`, no Workflow
tool, no touches to `data/gosleep.db` or `docs/reports/backlog-triage-2026-08-16/`.

**Jira / GH:** GSL-369 (Task, In Progress → Done); GH mirror #352 (closed with
commit link).
