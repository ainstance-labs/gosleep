# GSL-386 — Shim stdin peek robustness: widen 4 KiB → 64 KiB + first-match anchor

**Parent epic.** [GSL-387](https://ainstance-labs.atlassian.net/browse/GSL-387) — "[Core][Web][Tooling] Shift-79 verifier follow-up bundle".
**GH mirror.** https://github.com/ainstance-labs/gosleep/issues/376 (parent epic #377).
**Branch.** `GSL-387-verifier-followups`.

## What changed

GSL-367 replaced the `python3` heredoc in the compound-OR fast-path with a pure-shell `head -c 4096 | sed -n -E`. The GSL-374 verifier (`docs/reports/verifications/GSL-374/runs/01/`) confirmed no behavioural regression today but flagged two non-blocking MINOR concerns:

- m1: 4 KiB stdin cap is future-fragile — Claude Code emits `session_id` in the top of the JSON payload today, but any preamble growth or key reorder would silently miss the sid and drop an opted-in session back to the TUI dialog.
- m2: greedy `sed -E` regex captures the LAST occurrence — safe today because nested `"session_id"` inside `tool_input` strings is JSON-escaped as `\"session_id\"`, but any future path with an unescaped literal `"session_id":"…"` inside `tool_input` (raw text, nested unescaped JSON) would resolve to a stranger's sid.

## Fix

Both shims (`tools/hooks/ask-user-question-hook.sh` and `tools/hooks/permission-request-hook.sh`) now use:

```bash
LC_ALL=C head -c 65536 "$_GOSLEEP_STDIN_PEEK" 2>/dev/null | LC_ALL=C awk '
  match($0, /"session_id"[[:space:]]*:[[:space:]]*"[^"]+"/) {
    s = substr($0, RSTART, RLENGTH)
    sub(/^"session_id"[[:space:]]*:[[:space:]]*"/, "", s)
    sub(/"$/, "", s)
    print s
    exit
  }'
```

- Window: 4 KiB → 64 KiB. Covers any realistic future payload preamble at a single-read cost.
- First-match semantics: `awk`'s `match()` returns the leftmost occurrence; `exit` bails after the first hit. One process, portable across BSD (macOS) and GNU awk.
- Empty-sid-on-non-empty-stdin now emits a `peek_miss` JSON breadcrumb to `GOSLEEP_HOOK_DEBUG_LOG` — makes the future silent-fallback failure mode observable.

### Why awk, not `grep | sed`?

The prescription in the ticket suggested `grep -o -m 1 | sed -E`. I benched both against the pre-GSL-386 `sed`-only pipeline (300 iters × 2 fixtures on macOS bash 3.2, wall-clock via `time.time()` bracketing):

| Variant | SMALL fixture (~120 B) | BIG fixture (60 KiB filler) |
|---|---|---|
| pre-GSL-386 (4 KiB `sed`) — baseline | 3.4 ms | n/a (misses sid) |
| widened `sed` only (64 KiB) | 3.5 ms | 4.4 ms |
| ticket's `grep -o -m 1 \| sed` (64 KiB) | 14.6 ms | 14.1 ms |
| `awk match()+exit` (64 KiB) | 3.0 ms | 4.8 ms |

The 3-process `grep | sed | head` chain runs ~4× the baseline; `awk` runs a single process and stays within noise. The ticket's ±5 % perf ceiling is met with awk; `grep + sed` would have blown it.

## Files touched

- `tools/hooks/ask-user-question-hook.sh` — awk-based peek + debug breadcrumb.
- `tools/hooks/permission-request-hook.sh` — same edit, mirrored.
- `tools/lab/tests/shim-control-gate.sh` — grew 5 → 7 scenarios (S6: sid past byte 4096 within 64 KiB cap; S7: first-match anchor picks the real sid ahead of a raw literal imposter in `tool_input`). S7 also runs the pre-GSL-386 greedy `sed` regex against the same fixture as a negative-control baseline, proving the fixture actually exercises the regression path.
- `docs/runbooks/gosleep-core.md` §8 — one paragraph describing the peek ceiling + first-match anchor + `peek_miss` breadcrumb.

## Verification

- `bash -n tools/hooks/{ask-user-question,permission-request}-hook.sh` — clean.
- `bash -n tools/lab/tests/shim-control-gate.sh` — clean.
- `bash tools/lab/tests/shim-control-gate.sh` — **7/7 scenarios pass** (S1-S5 unchanged, S6 + S7 new).
- Perf bench (300 iters × 2 fixtures): awk peek stays within ±10 % of the pre-GSL-386 baseline; well under the ~90 ms fast-exit floor.

## Notes / decisions

- Kept `head -c 65536` as a hard cap. If the payload ever grows past 64 KiB (unlikely for a `session_id`-carrying preamble), we simply miss the sid and gate returns UNKNOWN — same failure mode as pre-hardening, just at a much higher ceiling. The `peek_miss` breadcrumb makes it observable.
- The awk regex character class matches `[^"]+` — the value can contain no bare `"`, which is a valid Claude Code invariant (session_id is a hex-and-dash UUID). No escape handling needed.
- Debug breadcrumb is emitted only when both (a) sid extraction returned empty AND (b) `GOSLEEP_HOOK_DEBUG_LOG` is set. Zero cost on the fast-path when the env is unset.
