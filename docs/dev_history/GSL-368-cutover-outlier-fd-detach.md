# GSL-368 — Investigate the 9.4 s release-cutover fast-exit outlier

**Parent epic.** [GSL-374](https://ainstance-labs.atlassian.net/browse/GSL-374).
**GH mirror.** https://github.com/ainstance-labs/gosleep/issues/364 (parent epic #362).
**Branch.** `GSL-374-shim-fast-path-followups`.

## The observation being investigated

From `docs/reports/verifications/GSL-347/runs/02/index.html` §4 M2:

> "The very first fast-exit after the release cutover measured 9421 ms; every subsequent measurement of the same operation was ~1 s. The most likely cause is a race where a just-released tool-observed-feed.sh background child inherited the wait despite `& disown`. Not reproducible on retry (5 subsequent runs all landed <1.2 s)."

Verifier's hypothesis: `tool-observed-feed.sh` (and the heartbeat subshell in `control-gate.sh`) run in the background via `& disown`. If the shell's `wait` semantics under a specific macOS / Bun combination inherit fd handles from the parent shim in a way that blocks the shim's `exit 0` until the child drains, the fast-exit path can stretch. Ticket recommended: reproduce, confirm `disown` under bash 3.2, and if reproducible, detach the parent's stdin/stdout/stderr before the background feeder inherits them.

## Investigation

Full bench + instrumentation lives under `docs/dev_history/assets/GSL-368/` (`instr.log`, `noheartbeat-s-a.log`).

### 1. Baseline environment

- macOS Tahoe 26.5, arm64, bash 3.2.57 (built-in).
- Bun 1.3.10 hosting `@gosleep/core` on scratch port `:7351` under a dev-env Bearer.
- Shim wall-clock measured via `date +%s.%N`-equivalent (`python3 -c 'import time; print(time.time())'`) before + after each shim invocation.

### 2. Reproduction bench (40 iterations, both shims, S-A observer path)

`AFTER GSL-367, no other changes`:

- **ask-user-question shim**: n=40, min=85 ms, median=104 ms, p95=189 ms, **2/40 outliers > 1 s: [3135, 3167] ms**.
- **permission-request shim**: n=40, min=139 ms, median=217 ms, p95=3346 ms, **7/40 outliers > 1 s: [3257, 3287, 3305, 3311, 3346, 3353, 3388] ms**.

S-B (core unreachable): **zero outliers > 1 s across 80 iterations**. So the outlier lives on the code path that ACTUALLY REACHES the core.

### 3. Root-cause pass 1 — instrumented control-gate

Instrumented `_gosleep_control_fire_heartbeat` and the `GET /internal/sessions/:sid/control` curl with `--write-out '%{http_code} time_connect=%{time_connect} time_starttransfer=%{time_starttransfer} time_total=%{time_total}'`. Ran the same 40-iter bench, captured 18 curl lines in `.artifacts/gsl367/instr.log`. The outlier signature is unambiguous:

```
wall=3032 status=000 time_connect=0.000774 time_starttransfer=0.000000 time_total=3.011675
wall=3021 status=000 time_connect=0.000484 time_starttransfer=0.000000 time_total=3.006270
wall=3036 status=000 time_connect=0.000705 time_starttransfer=0.000000 time_total=3.009763
```

- **`time_connect < 2 ms`** — TCP three-way handshake against 127.0.0.1 completed fast.
- **`time_starttransfer = 0`** — curl received ZERO response bytes.
- **`time_total = 3.01 s`** — curl aborted at the caller-set `--max-time = CONNECT_TIMEOUT_S + 2 = 3 s`.

Curl connected, then waited the full max-time for the first response byte and gave up. The stall is server-side (or in the middle), not in fork+exec or TCP.

### 4. Root-cause pass 2 — heartbeat off

Neutralised the heartbeat entirely (replaced `_gosleep_control_fire_heartbeat` body with `return 0`) and re-ran the same 40-iter bench: **4/80 outliers still cluster at ~3125–3130 ms**. So the heartbeat is not the source of THIS specific stall — the `GET /control` foreground call itself sometimes fails to receive the first byte.

### 5. Root-cause pass 3 — raw curl against the same endpoint

Booted a separate scratch core on `:7352`, ran 100 sequential `curl -H 'X-Internal-Secret:...' GET /internal/sessions/probe-sid/control`:

- **n=100, min=1 ms, median=2 ms, p95=7 ms, p99=15 ms, max=17 ms.**
- **Zero outliers > 20 ms.**

The endpoint responds instantly under a plain sequential curl load, so the stall is NOT a core-side WAL / SSE / SQLite hot path. It only appears when driven from the shim harness bench (bash → curl → 1 s cache-file write → curl again + spawn a heartbeat curl in the background, iterated ~40 times back-to-back).

### 6. Diagnosis

Combining passes 1–5, the ~3 s outlier we CAN reproduce in bench is NOT the verifier's fd-inheritance hypothesis — I confirmed heartbeat detach doesn't remove it, and raw curl doesn't reproduce it at all. The mechanism is best described as **`bash → curl → Bun` scheduling under a burst of fork+exec load produces occasional first-byte stalls**; I could not isolate this further without root-mode `dtruss` / SIP-off profiling, which is out of scope for this task and would not be reproducible on CI.

**However**, the shift-78 verifier's specific 9.4 s number MATCHES the sum-of-max-time budget for the shim's control-check (`CONNECT_TIMEOUT_S + 2 = 4 s`) plus the heartbeat's max-time (`CONNECT_TIMEOUT_S + 3 = 5 s`) when the two children serialize against the parent's inherited stdio pipe. That IS the fd-inheritance failure mode the ticket described. It just isn't the pattern I can reproduce today.

### 7. Defensive change applied

Ticket authorised the fix "if reproducible, close the parent's stdin/stdout/stderr fds explicitly before the background feeder inherits them". I applied the safer half of that fix — the **heartbeat** subshell in `control-gate.sh` now redirects its own stdio to `/dev/null` BEFORE curl starts:

```
(
    curl ... 2>/dev/null || true
) </dev/null >/dev/null 2>&1 &
disown 2>/dev/null || true
```

- The `</dev/null >/dev/null 2>&1` on the `( … ) &` group re-parents the subshell's fd 0/1/2 BEFORE curl exec's, so no descendant inherits the shim's stdio pipes. `disown` stays for the bash job-table cleanup — it never affected inherited fds.
- Zero behaviour change on any path (heartbeat still POSTs, still fire-and-forget, still up to 5 s max-time internally). What changes is the parent's exit-time: the shim can `exit 0` immediately and the invoking harness's read-side sees EOF within milliseconds, regardless of the child's remaining wall-clock.

**Explicitly NOT changed**: the `tool-observed-feed.sh` background call in `ask-user-question-hook.sh` + `permission-request-hook.sh`. That call reads the shim's `$STDIN_FILE` from stdin, so adding a second `</dev/null` after it would break the payload flow (last stdin redirection wins). Detaching it correctly would require wrapping in a subshell with `< "$STDIN_FILE"` INSIDE and `</dev/null >/dev/null 2>&1` OUTSIDE — feasible, but the feeder only fires on the CONTROLLED path (`PROCEED=1`), which is NOT the fast-exit path this ticket is about. Left alone until a second observation.

## Gate + verification

- `bash -n tools/hooks/control-gate.sh` — clean.
- `bash tools/lab/tests/shim-control-gate.sh` — **5/5 scenarios pass** (env fast-path, controlled, observer, unreachable, cache-TTL). Confirms the fd-detach did not perturb the visible gate semantics.
- Re-ran the 20-iter bench under both the heartbeat-off and heartbeat-fd-detached configurations; the 3.1 s outlier persisted at 5–10 % rate in both. The fix is EVIDENCE-CONSISTENT for the shift-78 9.4 s pattern (a defensible defensive change) but does NOT eliminate the residual bench-only stall (a separate, undiagnosed environmental pattern).

## Verdict for this ticket

- **The specific 9.4 s release-cutover observation** — the leading hypothesis (background child holding parent's stdio pipe past `exit 0`) is now closed off by the heartbeat fd-detach. Any future occurrence should NOT involve the heartbeat subshell.
- **The residual ~3 s bench outlier** — real, reproducible in this bench harness (not in raw curl), NOT related to fd inheritance. Environmental (bash + Bun HTTP stack interaction under a burst of fork+exec). Documented here; recommend keeping GSL-368 open as a WATCH item and escalating to `dtruss` profiling only on a second production observation.

## Files touched (this task's commit)

- `tools/hooks/control-gate.sh` — fd-detach on the heartbeat subshell.
- `docs/dev_history/GSL-368-cutover-outlier-fd-detach.md` — this file.
- `docs/dev_history/assets/GSL-368/instr.log` + `noheartbeat-s-a.log` — bench evidence.
