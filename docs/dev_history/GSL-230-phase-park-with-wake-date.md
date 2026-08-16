# GSL-230 — `park` subcommand: parking a question requires a wake date

**Parent epic.** [GSL-243](https://ainstance-labs.atlassian.net/browse/GSL-243).
**GH mirror.** https://github.com/ainstance-labs/gosleep/issues/230.
**Branch.** `GSL-243-systems-audit-tail`.

## What changed

Audit finding 80: a question deferred without a wake date silently disappears — the queue holds it, the digest filters `deferred` out of the "open" bucket, and no worker is scheduled to bring it back.

New `lab-emit park --re q-ID --wake-at ISO-UTC [--by ACTOR]`:
- Refuses without `--wake-at` (with the exact audit-finding language: "a parked question that carries no wake date is exactly what silently disappears").
- Refuses malformed ISO (regex-anchored to `YYYY-MM-DDTHH:MM:SSZ`).
- Refuses parking a closed record (`open|answered` only).

Storage is the same shape as `defer --defer-until` (status="deferred", `defer_until=<ISO>`) plus a `parked:true` marker — so every existing reader (chronicler's digest, apps/core's SQLite indexer, the `defer-reopen` worker in apps/core) interoperates with `defer` without change. The `park`/`defer` distinction is about the CALL site — park is the safer verb — not the record shape.

Chronicler's digest section 1 now bubbles parked-due rows under a **"Parked, due to return"** mini-list, so in a queue.jsonl-only run (no live apps/core worker) the owner sees them on the wake day.

## Files touched

- `tools/lab/lab-emit.sh` — new `cmd_park()`, `ISO_UTC_RE`; help text updated; command dispatch and usage banner include `park`.
- `tools/lab/chronicler.py` — `QUESTION_KEYS` gains `defer_until` + `parked`; `build_queue()` computes `parked_due`; digest section 1 renders it under a mini-heading.
- `tools/lab/tests/lab-emit-park.sh` — new gate, 6/6 pass.

## Verification

- `bash tools/lab/tests/lab-emit-park.sh` → 6/6 (missing `--wake-at`, bad ISO, happy path, record shape, closed-record refusal, defer/park interop).
- `bash tools/lab/smoke.sh` → PASS=405 / FAIL=161 (unchanged).
- `python3 -c "import py_compile; py_compile.compile('tools/lab/chronicler.py')"` → OK.

## Notes / decisions

- `iso_utc()` in chronicler.py takes a required ts arg (unlike in lab-emit); a first-pass edit called `iso_utc()` with no argument and blew up the smoke suite (405 → 252). Switched to `now_iso()`, which chronicler already has. Baseline restored on retest.
- `defer` was intentionally NOT tightened. Its existing "empty defer-until = owner reopens by hand" contract (GSL-278) is used by apps/core; `park` is the safer verb the audit asks for, side-by-side.
