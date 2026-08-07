# GSL-262 — One-shot JSONL importer (events + questions + decisions + heartbeat → SQLite)

**Date:** 2026-08-07 · **Epic:** GSL-250 (interactive control plane) · **Branch:** `GSL-250-control-plane`
**Task:** Step 4 (part 2) of the migration plan in `docs/reports/web-harness-research-2026-08-03/target-architecture.md` sections 4.5 and 9. Idempotence contract per R30, R31.

## What was done

`apps/core/scripts/import-jsonl.ts` reads the four historical JSONL logs into the eight-table SQLite schema from GSL-261 in one shot, idempotently. A second run leaves the store bit-for-bit unchanged; a killed mid-run leaves the store partially populated up to the last COMMITted transaction and a re-run resumes cleanly, no duplicates.

Concretely:

- **`apps/core/scripts/import-jsonl.ts`** — the importer. Reads:
  - `docs/lab/events/*.jsonl` (chronologically, filename `YYYY-MM-DD.jsonl` = lex-sort = date order) → `INSERT OR IGNORE INTO events` with `ingested_from = "jsonl:events/<basename>#<lineno>"`. The `uq_events_ingested` unique index absorbs duplicates on `--reset-offsets` or on a sha256 tripwire rebuild.
  - `docs/lab/questions/queue.jsonl` + `archive.jsonl` → the chronicler contract (chronicler.py L1324): fold each source with lab-emit semantics, then merge with **queue winning on `qid` collision** because it is the fresher truth. Upserts into `questions` via `INSERT ... ON CONFLICT(qid) DO UPDATE`.
  - `docs/lab/decisions/log.jsonl` → `INSERT OR IGNORE INTO decisions` keyed on `did`.
  - `docs/lab/supervision/heartbeat.jsonl` → append-only `INSERT INTO heartbeat`; deduplicated purely by the byte-offset cursor in `ingest_state` (no natural PK exists in the source stream).
- **Fold logic ported 1:1 from `tools/lab/lab-emit.sh::fold()`** — a base record with `id` seeds the state (`seen_by` defaults to `[from]`); a patch record with `re` appends to `seen_by`, may overwrite `status`, and may set any of `answer / answered_by / channel / applied / applied_by`. Later patches win. Dangling patches (with `re` pointing to a qid the fold hasn't seen) are silently dropped, matching lab-emit.
- **`ingest_state` cursor** — every file's `last_ingested_offset` + sha256 of first 4 KB is written **inside the same transaction as the row inserts**. A crash between the two rolls both back; a re-run reads from the last committed offset without duplication. This upgrades the design in the Jira description from "write ingest_state after inserts" (crash window) to strictly ACID.
- **sha256 tripwire** — on every file, before opening the stream we hash the first 4 KB and compare to the stored prefix. Mismatch (non-append edit: rebase, truncate, historical hand-fix) forces `fromOffset = 0` and lets the event unique index absorb the overlap. `import.file.prefix_mismatch` is logged so the operator sees it.
- **Per-file transactions** — one txn per source file. Small enough (typical day ≤ 1 KB rows, largest so far is 784) that memory is never a concern; big enough that WAL flush cost drops from per-row to per-file.
- **CLI flag `--reset-offsets`** — maintenance escape hatch. Ignores `ingest_state` and re-reads every file from offset 0. Events + decisions dedup via their unique/PK indexes; heartbeat WILL duplicate under this flag (documented limit — heartbeat's natural PK does not exist in the source; the offset cursor is its only defense in normal operation).
- **Structured logging** — one `import.file.done` line per file (with `scanned / inserted / skippedDedup / parseErrors / elapsedMs / fromOffset / toOffset`), one `import.summary` at the end with the totals-before/totals-after/delta triple. That summary is the timing report the Jira description asks for.
- **`apps/core/package.json`** — added `db:import-jsonl` script (`bun run scripts/import-jsonl.ts`).

## Problems solved

- **Idempotence: PROVEN on real repo data.** Wiped `/tmp/gosleep-import-test.db`, ran migrate, then twice ran `db:import-jsonl`. Run 1 loaded **3668 events, 38 questions, 49 decisions, 383 heartbeat, 19 ingest_state rows in 79 ms**. Run 2's `import.summary` reports **`delta: {events:0, questions:0, decisions:0, heartbeat:0, ingest_state:0}`** and totals-before equals totals-after. That is the R30 acceptance criterion satisfied.
- **Crash-recovery: PROVEN via SIGKILL mid-flight.** Killed the importer with `timeout -s KILL 0.065` after 6 of 15 event files had committed. Partial state: 1857 events, 6 ingest_state rows, 0 heartbeat. Recovery run inserted the remaining 1811 events + 383 heartbeat + 49 decisions + 38 questions. **Final counts equal the golden set: 3668 / 38 / 49 / 383. Zero duplicates.** The kill-transaction-atomicity contract holds.
- **`--reset-offsets` dedup: PROVEN.** With a fully loaded DB, `--reset-offsets` re-reads every file from offset 0. Result: `events_inserted=0, events_skipped_dedup=3668; decisions_inserted=0, skipped=49; questions delta 0`. The event unique index and the decision PK do exactly the job R30 promises. (heartbeat +383, as documented; use `--reset-offsets` only after truncating `heartbeat` too.)
- **Question fold matches chronicler semantics.** A sampled queue+archive fold produced 38 folded qids with correct `applied` fields — e.g. q-2026-07-12-001 preserved its archive `applied` note including the git-reset re-application record. Queue-wins-on-collision confirmed by inspecting the `applied` field for qids present in both sources.
- **Timing: 79 ms end-to-end** for 4170 source lines across 18 files. Well within the "≈10-30 s on the whole historical volume" the target-arch predicts (we are 2 orders of magnitude below).
- **All gates green** on the branch after this commit: `bun x tsc -p apps/core --noEmit` rc 0; `bash tools/lab/smoke.sh` 551 PASS / 0 FAIL; `bash tools/lab/gate.sh --offline` — smoke + hooks-verify --offline + tsc + chronicler --no-poll all pass; `data/` still holds only `.gitkeep` + `.gitignore` (never committed the test DB — it lived under `/tmp`).

## Problems remaining

- **`--reset-offsets` duplicates heartbeat.** Because heartbeat has no natural PK in the source (ts+cycle+pane is close but not guaranteed unique), the offset cursor is its only dedup key. If an operator uses `--reset-offsets` they must first `DELETE FROM heartbeat`. Documented in the flag's help comment; enforced in no way by the code. A future task could add a `--truncate-heartbeat-first` companion flag, or a `INSERT ... ON CONFLICT (ts, cycle, coalesce(json_extract(extra, '$.pane'), ''))` upsert — either would be a schema change and belongs on its own ticket.
- **`decisions.last_event_seq` and `questions.last_event_seq` are left NULL by the importer.** The linkage to the events row that mutated each question/decision requires a join pass after the event ingest completes (we know the `ingested_from` line number, and events for the same qid can be found by `payload->>'qid'`). Deferred: this is a tail-indexer concern (GSL-263), not an import concern. Documented so future work does not silently paper over it.
- **`events.supersedes_seq` is always NULL from import.** The source `run_id`+`seq` are per-day counters — not comparable to our autoincrement PK. Preserving the source `supersedes` field inside `payload` (which we do — the whole record is stringified into `payload`) is the honest option; wiring it into `supersedes_seq` needs a two-pass import that resolves per-day source `seq` back to our autoincrement PK.
- **The importer runs synchronously to completion.** No progress spinner, no partial-summary log line every N files. The 79 ms wall-clock makes this a non-issue today; if the JSONL volume grows 100× (unlikely — historical data is bounded), a periodic `import.progress` line would be worth adding.

## Pitfalls & workarounds

- **Do NOT relocate `saveState` outside the transaction.** It sits inside each per-file `BEGIN...COMMIT` for a reason: crash between two `.exec` calls would leave inserts committed but cursor unwritten, and the next run would double-insert every heartbeat since the last successful COMMIT. The kill-recovery smoke covers this exact case.
- **Filename-based date parsing.** `deriveDay()` prefers `run_id` from the record, then falls back to the leading `YYYY-MM-DD` of `ts`, then to the filename. This tolerates historical event files that pre-date the `run_id` convention. When adding new sources, keep the filename `YYYY-MM-DD.jsonl` so the fallback works.
- **`streamLinesFromOffset` returns the byte length of the payload only; add 1 for the newline.** POSIX `\n` line terminators; CRLF would break the accounting (we do not use CRLF anywhere in the repo, but a future Windows import path would need to handle it explicitly).
- **The status enum in `questions` is unconstrained.** Real data includes `auto-resolved`, `answered-by-default`, `noted`, etc. — outside the four names in the schema comment. Left unconstrained on purpose so the import is lossless; the tail indexer (GSL-263) is the place to normalise if it becomes necessary.
- **Empty JSONL lines are silently skipped.** They are not `parseErrors`. This matters if a producer accidentally writes empty lines — we count them (scanned goes up) but do not insert them or fail. A future strict-mode flag could refuse them.

## What didn't make it

- **Wiring the importer into the engine boot path.** The importer stays a **one-shot script** per the Jira description. `bun run --cwd apps/core db:import-jsonl` is the entrypoint; `serve.ts` does not call it. Wiring it as an auto-run before first `Bun.serve()` belongs on a task that owns the "first-boot ceremony" — not GSL-262.
- **`--verify` / dry-run mode.** The importer either commits or throws. There is no "read-only counts preview" mode. Adding one is cheap (skip the INSERT statements, count only), but adds another code path to keep in sync; deferred as unnecessary today.
- **Bun test-runner coverage.** Round-trip smoke was verified by shell (see the kill test above). No `*.test.ts` yet — the test-runner task lands later in the epic; converting these into `bun test` cases will be part of that work.

## Technical reference

- **Commit SHA:** filled at commit time.
- **Files added:** `apps/core/scripts/import-jsonl.ts`.
- **Files modified:** `apps/core/package.json` (added `db:import-jsonl` script).
- **New npm script:** `bun run --cwd apps/core db:import-jsonl [-- --reset-offsets]`.
- **Verification (run):**
  - Typecheck: `bun x tsc -p apps/core --noEmit` — rc 0.
  - Full import (real repo JSONL):
    - `rm -f /tmp/gosleep-import-test.db* && GOSLEEP_DB_PATH=/tmp/gosleep-import-test.db bun run --cwd apps/core db:migrate && GOSLEEP_DB_PATH=/tmp/gosleep-import-test.db bun run --cwd apps/core db:import-jsonl` → **3668 events / 38 questions / 49 decisions / 383 heartbeat / 19 ingest_state, 79 ms**.
  - Idempotence: second immediate run reports `delta {events:0, questions:0, decisions:0, heartbeat:0, ingest_state:0}` and `totals_after == totals_before`. **20 ms.**
  - `--reset-offsets`: `events_skipped_dedup=3668, decisions_skipped_dedup=49, questions_delta=0` (heartbeat +383 documented limit).
  - Mid-flight kill (`timeout -s KILL 0.065`): partial state 1857 events / 6 ingest_state / 0 heartbeat. Recovery run: `events_inserted=1811, ...` → final 3668 / 38 / 49 / 383, zero duplicates.
  - Sample event: `{seq:1, day:'2026-07-12', ts:'2026-07-12T20:43:11Z', src:'hook:PostToolUse', ...}`. Sample question: q-2026-07-12-001 preserved its archive `applied` note verbatim (queue-wins fold confirmed).
  - `bash tools/lab/smoke.sh` — 551 PASS / 0 FAIL. `bash tools/lab/gate.sh --offline` — all four gates green.
- **Links:** Jira [GSL-262](https://ainstance-labs.atlassian.net/browse/GSL-262) · GitHub issue mirror `ainstance-labs/gosleep#272`.
