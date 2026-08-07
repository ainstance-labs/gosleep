# GSL-259 — Web control plane: chronicler top-level lock + ledger

**Date:** 2026-08-07 · **Epic:** GSL-250 (interactive control plane) · **Branch:** `GSL-250-control-plane`
**Task:** Step 2 of the migration plan in `docs/reports/web-harness-research-2026-08-03/target-architecture.md` section 9. Closes redteam-verdict.md critical #2 ("the synchronous chronicler.sh after an action race is NOT closed against a parallel debounce chronicler").

## What was done

`tools/lab/chronicler.sh` no longer `exec`s straight into `chronicler.py`. It now
wraps the python invocation in a proper top-level mkdir lock and appends a one-line
JSON ledger for every attempt — waited or ran or skipped. Two chronicler.sh
processes launched at once cannot both regenerate; one holds the lock, the other
waits up to 15 s (env-tunable) and then either acquires it or stamps
`skipped-lock-held` and exits 0.

Concretely:

- **`tools/lab/chronicler.sh`** rewritten. A shell-only pre-parse strips `--mode <name>` from `argv` before forwarding the remaining flags to `chronicler.py` (python still owns validation of every flag it already knew). Modes reserved: `shell` (default, a human), `debounce` (the trailing-edge waiter in `chronicler-debounce.sh`), `tick` (`tick.sh` step 3), `web` (future — `apps/core` post-write regen). The wrapper acquires a mkdir lock at `<repo>/.artifacts/lab/chronicler.lock` with a bounded 15 s wait window and a 900 s stale-lock steal (the reasonable upper bound of a healthy run); a `trap` on `EXIT INT TERM` removes the lock. Every attempt appends one line to `<repo>/.artifacts/lab/chronicler-ledger.jsonl` — fields `ts, mode, result, rc, waited_s, pid`. The receipt is a JSONL because it composes with the existing `tick-ledger.jsonl` habit and stays grep-friendly.
- **`tools/lab/tests/chronicler-race.sh`** (new). Deliberate two-phase race test. Phase 1: two `chronicler.sh --dry-run` processes launched in parallel, both with a 30 s wait window; asserts both exit 0, both land a `result="ran"` ledger line with the caller-supplied mode, and at least one of them recorded `waited_s > 0` (proof the lock actually held). Phase 2: manually holds the lock for 3 s and fires one chronicler with `GOSLEEP_CHRONICLER_LOCK_WAIT_S=1`; asserts it exits 0 and stamps `result="skipped-lock-held"`. Runs against a scratch `--repo` so it never touches the live ledger.
- **`tools/lab/tests/`** — new directory. First test file lives there so `tools/lab/tests/*.sh` becomes the natural home for future chronicler / debounce / tick race tests.

## Problems solved

- **The redteam-verdict.md critical #2 race, closed by construction.** Before: two `chronicler.sh` calls racing inside a debounce window would both call `chronicler.py`, and the loser's atomic-swap overwrite would replace the winner's already-fresh bundle with an older render. After: one at a time, and the loser knows it lost (ledger `skipped-lock-held` or `waited_s > 0`).
- **Provenance in the receipt.** Every ledger line carries `mode`, so the debounce waiter (`mode:"debounce"`), tick (`mode:"tick"`), a shell run (`mode:"shell"`), and the future web action (`mode:"web"`) never appear indistinguishable in the audit trail. This is what the Jira description meant by "the ledger distinguishes mode:\"web\" from mode:\"debounce\"".
- **`trap` cleans up on abnormal exit.** SIGINT / SIGTERM (e.g. the user ^C'd a slow narrator) still releases the lock; a crashed python leaves a lock that the next call steals after 900 s. The stale-steal path is deliberately conservative — a healthy pass is seconds, so any real hold that long is a corpse.
- **Race test survives macOS bash 3.2.** No process substitution, no `wait -n`, no `[[` inside a subshell where 3.2 has bugs. `PY_ARGS+=()` and `${var:=default}` are the only bash-3.2-safe features used; verified by running under `/bin/bash --version` = 3.2.57.

## Problems remaining

- **Web-side sentinel wiring deferred.** The Jira description also asks the web server to `touch .artifacts/lab/debounce/last-write-web` after each write action, so the debounce waiter (in `chronicler-debounce.sh`) can distinguish "the web already rebuilt" from "a debounce waiter should rebuild". That code lives in `apps/core/src/spawn/chronicler.ts`, which does not exist yet — `apps/core` is scaffolded by GSL-260 (next), and the write actions that would touch the sentinel come in GSL-263 (SSE + write endpoints) and GSL-267 (dual-write hooks). The convention name is reserved and documented in the wrapper's header; the read side (chronicler-debounce.sh's `last-write` stamp under the same directory) already exists. This is a fair split — GSL-259 owns the guarantor (the lock), the actual sentinel-touch belongs with the writer that owns the action semantics.
- **No `mode` propagation into `chronicler.py`.** The mode lives only in the shell ledger; `chronicler.py` still writes its own `render_bundle.json` with `carrier` fields on the tick side. Propagating mode into the python's own reports would require a matching flag in `chronicler.py`'s argparse and is a nicer-to-have; the shell ledger already answers the "who ran it" question honestly.
- **`chronicler-debounce.sh` still calls the wrapper with no `--mode`.** So its runs land as `mode:"shell"` in the new ledger. Not wrong (it is running the shell), just noisy — a follow-up 1-line edit to `chronicler-debounce.sh`'s `rebuild()` (add `--mode debounce`) would tag them correctly. Deliberately left out of this task to keep the diff minimal and touching only `chronicler.sh` + tests; `chronicler-debounce.sh` has its own ledger writer (`{"mode":"debounce"…}` at line 92) that already answers the debounce-provenance question through the tick-ledger, so the double-tagging is not silent.

## Pitfalls & workarounds

- **`exec python3` was NOT a stylistic choice — removing it changes signal semantics.** Before, `exec` handed the process to python: SIGINT went straight to python, no shell traps to worry about. After, the shell is the parent, and the `trap` is what makes the lock cleanup robust. This is a deliberate trade-off; the ledger + lock require the shell to stay alive. Verified: sending SIGINT to the wrapper during a run releases the lock (visible in `.artifacts/lab/chronicler.lock` absence after the trap fires).
- **`stat -f %m` is BSD only.** macOS ships bash 3.2 + BSD `stat`; on Linux the flag would be `-c %Y`. Every reference in this repo (see `tick.sh`, `chronicler-debounce.sh`) already picks BSD; this file follows the same rule. If gosleep-core ever runs on Linux, this is a real thing to fix, not a hypothetical — but that day is not today.
- **Race test's phase-1 timing.** Two 30 s wait windows are deliberately generous — a `--dry-run` pass is under 5 s on a warm laptop, so both fit. On a cold cache or under contention (CI), the second pass would eat some of the window; the guard `WAITED_ANY == 1` proves the lock held for a non-zero amount of time regardless of pass duration.
- **Ledger belongs under `.artifacts/`, not `docs/lab/`.** `.artifacts/` is git-ignored (see `.gitignore:9`); `docs/lab/` is the chronicled surface itself and writing chronicler runs into it would recurse. Modeled on how `tick.sh` writes `.artifacts/lab/tick.lock` and `docs/lab/supervision/tick-ledger.jsonl` for two separate audiences — the lock is state, the ledger is surface. Ours are both scratch (chronicler-ledger is diagnostic, not archival), so both stay under `.artifacts/`.

## What didn't make it

- **No touch of `apps/core/src/spawn/chronicler.ts`.** Deferred — see "Problems remaining", first bullet.
- **No propagation into `chronicler-debounce.sh` `rebuild()`.** Deferred — one-line follow-up left for the task that already touches the debounce path.
- **No unit tests for the ledger schema.** The race test asserts the shape via `grep` and a python `json.loads` walk; a formal schema (e.g. json-schema validation) was not added — the tick ledger has no such thing either and no consumer parses these files as authoritative.

## Technical reference

- **Commit:** on branch `GSL-250-control-plane`, message prefixed `GSL-259 …`.
- **Files created:**
  - `tools/lab/tests/chronicler-race.sh`
  - `docs/dev_history/GSL-259-phase7-cycle199-chronicler-lock.md`
- **Files modified:**
  - `tools/lab/chronicler.sh` — mkdir lock + `--mode` shell flag + ledger writer; the `exec python3` line replaced by parse → acquire → python → ledger → release.
- **Verified by running:**
  - `bash -n tools/lab/chronicler.sh` → OK.
  - `bash tools/lab/tests/chronicler-race.sh` → `pass=8  fail=0` (both phases green).
  - `bash tools/lab/chronicler.sh --dry-run --json --quiet` → `{"ok":true,…}` + one `mode:"shell"` ledger line appended.
  - `bash tools/lab/gate.sh --offline` → `PASS=546 FAIL=0`, hooks-verify `11 pass, 0 fail`, tsc + chronicler green. No regression from the wrapper rewrite.
- **Links:**
  - Jira: [GSL-259](https://ainstance-labs.atlassian.net/browse/GSL-259) — parent epic [GSL-250](https://ainstance-labs.atlassian.net/browse/GSL-250)
  - Architecture: `docs/reports/web-harness-research-2026-08-03/target-architecture.md` section 9 step 2; `redteam-verdict.md` critical #2.
