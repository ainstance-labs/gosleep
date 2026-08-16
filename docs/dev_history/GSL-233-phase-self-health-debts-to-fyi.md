# GSL-233 — self-health debts become FYI queue rows (dedup-any)

**Parent epic.** [GSL-243](https://ainstance-labs.atlassian.net/browse/GSL-243).
**GH mirror.** https://github.com/ainstance-labs/gosleep/issues/233.
**Branch.** `GSL-243-systems-audit-tail`.

## What changed

Audit finding 80: the self-health meter names debts by name ("GSL-30 hanging since July 13") and fixes nothing. Numbers on a screen the owner has to open, not rows on the digest they already read.

Chronicler now turns each named debt into ONE deduped FYI queue row:
- Each missing `dev_history` key (e.g. "GSL-30") produces one FYI "no dev_history file committed for GSL-30 (epic <parent>) — audit and write, or archive".
- When handoff debt crosses its alarm threshold, one summary FYI "handoff debt: N cycle(s) closed without a committed handoff (alarm at K)" lands. The wording carries N — when the count changes, a NEW row lands. That is the point: the owner sees the number move even though the debt itself is one thing.

**Idempotency.** `lab-emit question` gained a new `--dedup-any` flag. The default dedup only folds against an OPEN row (good for BLOCKER spam, useless for FYIs which land as "noted" immediately and therefore never dedup on the next pass). With `--dedup-any`, a matching qhash under ANY status appends a seen_by patch instead of a fresh question. Running the chronicler every 15 min leaves at most one FYI per (task, question) tuple.

**Opt-in.** Guarded by `GOSLEEP_DEBT_FYI=1`. Chronicler on someone else's machine does NOT start writing rows to the queue by default. Fail-open: a broken emit calls `degrade("debt-fyis", exc)` and the build continues. `--dry-run` skips (an FYI is a write).

## Files touched

- `tools/lab/lab-emit.sh` — new `--dedup-any` flag on `question`; folds against any status when present.
- `tools/lab/chronicler.py` — new `emit_debt_fyis()` helper; wired into `main()` after `build_self_health()`.
- `tools/lab/tests/self-health-fyi.sh` — new gate, 6/6 pass.

## Verification

- `bash tools/lab/tests/self-health-fyi.sh` → 6/6 (baseline duplicates, `--dedup-any` folds across closed statuses, seen_by patch shape, per-task distinctness, fresh-row creation).
- `bash tools/lab/smoke.sh` → PASS=405 / FAIL=161 (unchanged).
- All four sibling lab-emit gates (rule/tier2/qshape/park) still 100 %.

## Notes / decisions

- Handoff debt uses the summary FYI wording deliberately: N-in-the-string means count-changes create new rows, and old ones stay dedup-folded. This is what "the number moves" costs — a small amount of digest churn — but it is what makes the trend visible.
- FYIs auto-close as `noted`. Under `--dedup-any` a `noted` row still absorbs new seen_by patches, so the FYI's identity is stable across chronicler ticks.
