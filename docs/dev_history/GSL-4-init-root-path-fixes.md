# GSL-4 — Fix stale pre-move ROOT paths in report generators and eval runner

## What was done

Four tooling files that still carried the old absolute path from before the project was moved out
of tasty-lunch were updated. The fix replaces every hardcoded `ROOT` / `SRC` constant with a
dynamic path derived from `__dirname` (two directories up from the script), falling back to the
new absolute root only when `__dirname` is unavailable in the Workflow sandbox.

Files fixed (all were pre-existing WIP, none newly touched):

- `docs/report/build-report.js` — `SRC` and `REPORT` constants + two `spec` strings that
  referenced `${SRC}/design/` and `${SRC}/dev-history/` (now `docs/design/` and `docs/dev-history/`
  relative to the new root).
- `docs/report/build-subagents.py` — three relative HTML links (`../evals/`, `../skill/`)
  corrected to `../../evals/`, `../../skill/` (the HTML is served from `docs/report/`, so
  two levels up is the project root).
- `evals/runner/eval-runner.js` — `ROOT` constant.
- `evals/runner/gen-scenarios.js` — `ROOT` constant.

The Jira task also listed `docs/report/build-study.py`, `docs/report/build-issues.py`, and
`docs/report/data/runs.json` as potential targets. Inspection showed all three already resolve
paths relative to `__file__` / `os.path.dirname(__file__)` or contain no absolute paths — no
changes needed.

## Problems solved

All four generators and the eval runner would fail with a stale-path / ENOENT error when
launched from the current project root. The fix makes each script derive its root from its own
location on disk, so it survives future moves without another round of manual edits.

## Problems remaining

- The eval suite has not been re-run since the harness import (2026-06-09); the 8 FAIL
  scenarios from the last run are unaddressed. That work was always out of scope for GSL-4.
- Full functional smoke-testing (actually running a page build or a scenario eval) requires
  a Workflow harness and would trigger LLM calls — neither was done here. Static path
  verification was performed instead (see Technical reference).

## Pitfalls & workarounds

- `build-subagents.py` carries no Python `ROOT` constant; its stale paths were HTML relative
  links inside string literals. The fix is therefore different in character from the JS fixes
  (string literal replace vs. constant redefinition), but the root cause is the same: the
  project was one directory shallower than the scripts assumed.
- The `__dirname` pattern is ESM-incompatible in strict environments; the WIP uses a conditional
  (`typeof __dirname !== 'undefined'`) to stay safe in both CommonJS and Workflow sandboxes.

## What didn't make it

- Full functional smoke-run — blocked by the Workflow-only launch interface and LLM-call
  requirement; static verification covers the path resolution.

---

## Technical reference

- **Commit:** see git log — `GSL-4 Fix stale pre-move ROOT paths in report generators and
  eval runner` on branch `GSL-1-project-init`.
- **Files touched:** `docs/report/build-report.js`, `docs/report/build-subagents.py`,
  `evals/runner/eval-runner.js`, `evals/runner/gen-scenarios.js`, plus this dev_history file
  and `docs/dev_history/README.md`.
- **Files inspected and confirmed clean (no changes needed):** `docs/report/build-study.py`,
  `docs/report/build-issues.py`, `docs/report/data/runs.json`.
- **Verification (static):**
  ```
  # build-report.js — __dirname = .../docs/report, slice(-2) → project root
  node --input-type=module: SRC resolves to .../gosleep; DATA exists: true ✓

  # eval-runner.js / gen-scenarios.js — __dirname = .../evals/runner, slice(-2) → project root
  node --input-type=module: ROOT resolves to .../gosleep; skill/ and evals/scenarios exist ✓

  # build-subagents.py — no ROOT constant; HTML relative links fixed from ../ to ../../
  # (static inspection only — no Python path constant to verify)
  ```
  Functional run not performed: scripts require Workflow harness + LLM calls.
- **Links:** Jira GSL-4 (https://ainstance-labs.atlassian.net/browse/GSL-4), parent GSL-1;
  mirrored GitHub issue ainstance-labs/gosleep#4 (https://github.com/ainstance-labs/gosleep/issues/4).
