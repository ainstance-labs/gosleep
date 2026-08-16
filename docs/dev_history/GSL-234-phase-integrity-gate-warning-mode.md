# GSL-234 — integrity-gate.sh: warning-mode delivery-artifact gate

**Parent epic.** [GSL-243](https://ainstance-labs.atlassian.net/browse/GSL-243).
**GH mirror.** https://github.com/ainstance-labs/gosleep/issues/234.
**Branch.** `GSL-243-systems-audit-tail`.

## What changed

Audit findings 25, 26, 27 (MAJOR): 15 tasks moved to Done without a single artifact and 21 without a mirror. CLAUDE.md's delivery conventions require three artifacts per Done task — a commit with the key in its SUBJECT, a `docs/dev_history/<KEY>-*.md` file, a GitHub mirror — but nothing enforced any of them.

New `tools/lab/integrity-gate.sh` checks all three per key and warns on the missing:

- **commit** — `git log --grep "^KEY "` matches at least one subject.
- **dev_history** — `git ls-files -- docs/dev_history/KEY-*.md` returns at least one path.
- **gh_mirror** — the URL `github.com/ainstance-labs/gosleep/issues/` or the phrase `Mirrors GH #N` appears in EITHER the dev_history file OR the body of a commit with the key at the subject start.

Modes: `text` (default), `--json`, `--json-only`; input can be an explicit `KEY [KEY …]` list or `--recent [N]` to sweep the last N=20 commits.

**Warning mode.** Exits 0 always. The task explicitly asks for this so the gate ships without slowing delivery. A future strict-mode flip would exit 1 on any warning — deferred to an owner decision.

## Files touched

- `tools/lab/integrity-gate.sh` — new gate.
- `tools/lab/tests/integrity-gate.sh` — new test suite, 8/8 pass.

## Verification

- `bash -n tools/lab/integrity-gate.sh` → clean.
- `bash tools/lab/tests/integrity-gate.sh` → 8/8 (exit-0-under-warning, OK path, WARN path, missing-list content, text output shape, commit-only partial, mirror-in-commit-body detection, `--recent` scan).
- Real-run demo (`--recent 30`) on this branch: 19 keys scanned, 13 warn — including this worker's own uncommitted GSL-227..233 dev_history debt (which this commit + siblings resolve).

## Notes / decisions

- **`set -o pipefail` bug pinned.** First iteration used `git log --format='%s' | grep -q ...` — `grep -q` short-circuits and sends SIGPIPE to `git log`, which returns 141 under `-o pipefail`, and the outer `if !` misreads that as "no commit found". Fixed by capturing subjects to a variable first, then greping. The test suite includes a case where two consecutive commits for the same key would have failed the old code.
- **Mirror heuristic is deliberately cheap.** No `gh` calls — the gate stays offline-safe. If a mirror exists in Jira but not in any commit body or dev_history, the gate can't see it. That's acceptable for warning mode; a strict-mode flip may add a `gh` verification pass.
