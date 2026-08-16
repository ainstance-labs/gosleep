# GSL-228 — risk-tier hard floor: money/comms/secrets/destructive → BLOCKER by code

**Parent epic.** [GSL-243](https://ainstance-labs.atlassian.net/browse/GSL-243).
**GH mirror.** https://github.com/ainstance-labs/gosleep/issues/228.
**Branch.** `GSL-243-systems-audit-tail`.

## What changed

Audit finding 86 (MAJOR): the queue trusted an AGENT'S CHOICE of tier. An agent that labelled "spend $500" as a `DECISION` got a two-hour deadline before the default fired — exactly the manifest §3 denylist territory the whole tiered scheme was supposed to keep out of autonomous hands.

The floor now lives in code. When a non-BLOCKER question mentions an action from any of four categories — **money** (spend beyond, purchase, subscription, invoice, refund), **external comms** (send/publish/announce to customer/user/external/public/press), **secrets** (rotate/share/publish/commit/expose a token|secret|credential|password|api-key), **destructive/production** (force-push, drop table, delete branch|tag|release, rm -rf, deploy to prod, destructive migration) — `lab-emit question` refuses with a message naming the category and the exact snippet that matched, and instructs the caller to reclassify as `--type BLOCKER`.

BLOCKER-typed questions are already tier 2 and bypass the check (BLOCKER == owner-only == no default, ever).

## Design choices

- **Scan surface = question + option labels only.** Rationale, default, impact, and task strings do NOT feed the check. `default_rationale: "no-force-push standing rule"` is CITING the rule that would be violated, not proposing to violate it. Scanning rationales tripped the smoke baseline on ID1 (line 65) during development and was rolled back before commit.
- **Verb-focused patterns.** `spend $500` matches, `budget 80% crossed` does not — manifest §5.warn-80 explicitly makes 80% an FYI. Any new false positive should tighten the pattern, not widen the escape hatch.
- **No env bypass.** The floor is un-bypassable at runtime. Tests prove refusal, no bypass needed.

## Files touched

- `tools/lab/lab-emit.sh` — `TIER2_PATTERNS`, `tier2_floor()`; enforcement wired into `cmd_question` after the BLOCKER-with-default check.
- `tools/lab/tests/lab-emit-tier2.sh` — new gate, 14/14 pass (9 refusals across all four categories, 2 BLOCKER bypasses, 3 negatives).

## Verification

- `bash tools/lab/tests/lab-emit-tier2.sh` → 14/14.
- `bash tools/lab/smoke.sh` → PASS=405 / FAIL=161 (unchanged).

## Notes / decisions

- The existing smoke test at line 99 ("force-push the epic branch?" DECISION with reversibility=low) still rejects — the tier-2 floor now fires the refusal instead of the reversibility check, but the exit code is unchanged (test asserts `>/dev/null 2>&1 && bad || ok`).
- Category names in the error are stable strings (`money`, `external_comms`, `secrets`, `destructive`) so downstream consumers can pattern-match them.
