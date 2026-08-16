# GSL-232 — synthetic proof for StopFailure + TeammateIdle hooks

**Parent epic.** [GSL-243](https://ainstance-labs.atlassian.net/browse/GSL-243).
**GH mirror.** https://github.com/ainstance-labs/gosleep/issues/232.
**Branch.** `GSL-243-systems-audit-tail`.

## What changed

Audit finding 59: of the 12+ hooks wired, only four had been proven end-to-end. `StopFailure` (quota exhaustion) and `TeammateIdle` (stalled worker) were on the "wired, not exercised" list — a real rate-limit and a real teammate-idle cannot be forced on demand.

`hooks-verify.sh` now has a new **section 2** that proves the HOOK LAYER's contract synthetically: it feeds the exact CC-documented stdin envelope for each hook and asserts the mapped event lands in `events/*.jsonl` with the expected type + data.

- `StopFailure(error_type=rate_limit)` → `api.failure` event with `src="hook:StopFailure"` and `data.error_type="rate_limit"`.
- `StopFailure(error_type=overloaded)` → same `api.failure` type (downstream counts them together).
- `TeammateIdle(agent_type=impl-wave4)` → `agent.idle` event with `src="hook:TeammateIdle"` and `data.agent_type="impl-wave4"`.

The section header is explicit about the contract this proves and does NOT prove: the LAYER, not that Claude Code will send the stdin. Section 2b keeps honesty on PreCompact/PostCompact/Notification/Subagent*/Task* — still no way to force a real fire from a harness.

## Files touched

- `tools/lab/hooks-verify.sh` — new section 2 (synthetic proof); old "wired, not exercised" note trimmed to section 2b.

## Verification

- `bash -n tools/lab/hooks-verify.sh` → clean.
- `bash tools/lab/hooks-verify.sh --offline` → **14 pass, 0 fail** (3 new PASS lines in section 2; the pre-existing offline PASS count was 11).
- Event trace stashed under `.artifacts/lab/verify/wired-lab/events/*.jsonl` (fixture path — this test does NOT pollute the live `docs/lab/events/*.jsonl` stream).

## Notes / decisions

- The `hooks-verify.log` receipt in `.artifacts/lab/hooks-verify.log` names each synthetic event line for the machine-readable audit trail (GSL-206 pattern).
- Overloaded is added as a second `error_type` case because it is the OTHER common quota-adjacent failure the ceiling hits. Both must land under `api.failure` for the Cost screen's counter to match reality.
