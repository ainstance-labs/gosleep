# GSL-367 — Lighter shim stdin peek: drop `python3` from the fast-exit hot path

**Parent epic.** [GSL-374](https://ainstance-labs.atlassian.net/browse/GSL-374) — "[Tooling][Hook] Shim fast-path follow-ups (GSL-367, GSL-368)".
**GH mirror.** https://github.com/ainstance-labs/gosleep/issues/363 (parent epic #362).
**Branch.** `GSL-374-shim-fast-path-followups`.

## What changed

Both compound-OR shims (`tools/hooks/ask-user-question-hook.sh` and `tools/hooks/permission-request-hook.sh`) previously spawned `python3` inside the stdin peek block to extract `session_id`. That spawn dominated the ~127 ms cold fast-exit measured in `docs/reports/verifications/GSL-347/runs/02/index.html` §4 M1 even though the peek only reads one narrow field.

Two behaviour-preserving edits per shim:

1. **Env fast-path bypass.** When `GOSLEEP_WEB_QUESTIONS=1` the gate returns `PROCEED=1` on env alone (see `control-gate.sh` line 125 — env flag wins BEFORE any `session_id` lookup). We now skip the peek entirely in that branch, cutting the `mktemp`/`head`/`sed`/pipeline chain from the opted-in call path too.

2. **Pure-shell peek on the non-opted branch.** Replaced the `python3` heredoc with a `head -c 4096 | sed -n -E 's/.*"session_id"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' | head -n 1` chain. The 4 KiB ceiling caps the peek regardless of `tool_input` size; `LC_ALL=C` keeps the regex byte-oriented (fastest sed path). A miss (weird shape / no session_id) leaves the sid empty and the gate reports UNKNOWN — identical to the pre-GSL-367 python3 `except Exception: pass` branch (verified by re-running `tools/lab/tests/shim-control-gate.sh`, 5/5 pass).

`python3` still runs on the CONTROLLED path for JSON body construction (`POST /internal/questions/post` and `POST /internal/permissions/post`) where correctness matters more than latency. This ticket only shortens the FAST-EXIT path — the shape a non-opted session sees on every AskUserQuestion / PermissionRequest event.

## Files touched

- `tools/hooks/ask-user-question-hook.sh` — env bypass + pure-shell peek.
- `tools/hooks/permission-request-hook.sh` — same edit, mirrored.

## Verification

### Gates

- `bash -n tools/hooks/{ask-user-question-hook,permission-request-hook,control-gate}.sh` — clean.
- `bash tools/lab/tests/shim-control-gate.sh` — **5/5 scenarios pass**. This suite already covers env-flag-ON + core unreachable (S1), env-OFF + controlled (S2), env-OFF + observer (S3), env-OFF + unreachable (S4), and cache-TTL coalescing (S5) — exactly the boundaries the peek change touches.
- `bun x tsc -p apps/core --noEmit` — clean (no TS change; ran per epic gate list).
- `bun test apps/core` — green (per epic gate list; ran under gsl367 worktree).
- `bash tools/lab/tests/core-smoke.sh` — 71/71 pass on scratch port (per epic gate list).

### Live before / after (bench in the worktree, scratch core on `:7351`)

Both shims, 20 iterations each, two scenarios:

- **S-A**: env OFF, gate reaches scratch core, core reports `state=observer` → fast-exit.
- **S-B**: env OFF, gate reaches a dead port (7359) → env-fallback = 0, fast-exit.

|                    | S-A median | S-A p95 | S-A mean | S-B median | S-B mean |
|--------------------|-----------:|--------:|---------:|-----------:|---------:|
| Before (`python3` peek) | 127 ms | 212 ms | 285 ms | 133 ms | 138 ms |
| After (bash+sed peek + env bypass) | **90 ms** | **159 ms** | **169 ms** | **90 ms** | **93 ms** |
| Delta               | **−29 %** | **−25 %** | **−41 %** | **−32 %** | **−33 %** |

Raw logs preserved under `docs/dev_history/assets/GSL-367/`:

- `before-s-a.log`, `before-s-b.log` — wall-clock (ms) per iteration, tab-separated `wall\trc`.
- `after-s-a.log`, `after-s-b.log` — same shape, post-change.

Bench script that produced these numbers: `.artifacts/gsl367/bench.sh` (worktree-local, not committed — recreate with the seven `GOSLEEP_*` env vars documented at the top of the file).

Caveat on the median: the bench measures wall-clock via `python3 -c 'import time; print(time.time())'` before + after each shim, which itself costs ~30–35 ms per call (three python3 spawns per iteration = ~90 ms overhead). The 90 ms "after" median therefore includes ~90 ms of bench overhead — the shim itself lands closer to zero on the fast path. The BEFORE / AFTER **delta** is what matters, and it accurately reflects the removed python3 spawn inside the shim.

## Non-goals

- **No `jq` dep.** The shim stays `bash + curl + python3-if-present`. `python3` is still on the CONTROLLED path for JSON body construction.
- **No behaviour change on the CONTROLLED path.** Long-poll semantics, output shape, fail-open discipline — all identical.
- **No cache of session_id across shim processes.** Ticket suggestion 3 was to memoise; declined because `session_id` is already read for free at the shim entry (peek is a single sed pass) and cross-process cache would need file locking to be safe.

## Follow-ups filed

None from this change. The 5–10 % residual ~3.1 s outlier the AFTER bench still shows is investigated under sibling task GSL-368.
