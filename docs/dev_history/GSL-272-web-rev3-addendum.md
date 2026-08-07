# GSL-272 — Architecture rev-3 addendum for the interactive control plane

## What was done

I wrote a single English addendum, `docs/reports/web-harness-research-2026-08-03/target-architecture-rev3-addendum.md`, that carries the eleven deltas the stack audit produced against the target architecture (revision 2, agreed 2026-08-03). The addendum is deltas only — revision 2 stands as written except where a specific paragraph is explicitly replaced. Every delta cites the paragraph of record in `fable-final-verdict.md` or `coverage.md`, so the reader can trace each decision to its evidence without re-reading the five audit reports.

The eleven deltas the file carries are: (1) the v1 answer-delivery loop as a blocking `PreToolUse{AskUserQuestion}` hook with `allow`+`updatedInput` as the primary path and `deny`+`permissionDecisionReason` as the documented fallback; (2) channels rescoped to v1.1 behind the dev-flag; (3) transcript tail marked as enrichment-only; (4) TouchID gate as a signed `.app` bundle rather than a bare `swiftc` binary; (5) Keychain hardening (ACL `-T` binding, 5 s timeout → 503, Tahoe 26.x regression policy, per-boot auth-source audit line); (6) Vite 6 → Vite 7; (7) a Prometheus `/metrics` endpoint; (8) three schema additions (`agent_sessions` fleet table, manifest-rule provenance on `questions`, `defer` status + column); (9) a Jira reconciler worker plus `POST /actions/tasks/sync`; (10) a `SessionAdapter` seed interface isolating Claude-Code specifics; and (11) a note pointing at the new task that adds a deprecation banner to the stale research `index.html`.

## Problems solved

The stack audit produced five reports (`stack.md`, `integration.md`, `coverage.md`, `verify-core.md`, `verify-claims.md`) with contradictions between them, and the Fable-final adjudication settled where they conflicted. The problem was that every downstream task on GSL-250 would otherwise carry its own drift note — hard to keep consistent, easy for a later reader to miss. Consolidating the deltas into one addendum, referenced by every task extension comment, keeps the change surface small and legible.

The other problem the addendum solves is the `defer` question — verify-core had recommended a defer-based v1 path; `fable-final §1(a)` established that defer is print-mode only. The addendum drops it explicitly so no downstream task tries to build against a mode the runtime ignores.

## Problems remaining

The addendum documents the primary answer-loop path (`allow`+`updatedInput`) subject to the smoke-test result in GSL-274. If GSL-274 fails, the fallback (`deny`+`permissionDecisionReason`) is fully documented and production-safe — but semantically lossier. The design accommodates both; the choice is deferred until GSL-274 lands. No other unknowns remain.

## Pitfalls & workarounds

- The Tahoe 26.x `security` CLI regression (hangs, HEX-encoded binary passwords) needed a defence in the Keychain wrapper. Delta 5 encodes the concrete policy: detect macOS 26.x on start, floor the timeout to 5 s, keep the payload ASCII-only via a Base64 shim. A future engineer touching `apps/core/src/security/keychain.ts` must not remove these guards until Apple ships a fixed version.
- The TouchID gate must be a signed `.app` bundle — bare Mach-O binaries do not receive `LocalAuthentication` biometric entitlements. Delta 4 spells out the codesign incantation. Skipping this and shipping `swiftc`-only output silently disables biometrics.
- `SessionAdapter` is filed as a **seed** — one adapter in v1 (`claude-code.ts`), a `.md` sketch for OpenAI/Codex, not a second implementation. The point is the seam, not the second provider. A future contributor must not remove `packages/runner-adapter/` because "we only have one provider" — that removal loses the whole R7 owner requirement.

## What didn't make it

- I did not touch revision 2 of `target-architecture.md`. The owner may want a v3 rewrite later; today the addendum is the delta layer.
- I did not implement the deprecation banner on `index.html` — that is a separate task (Delta 11) so the change to `index.html` lives with the person actually editing that file.

## Technical reference

- Commit: (this file lands with the commit `GSL-272 [Docs][Web] Architecture rev-3 addendum` on branch `GSL-250-control-plane`).
- Files touched: `docs/reports/web-harness-research-2026-08-03/target-architecture-rev3-addendum.md` (new).
- Verified by running: nothing — this is a documentation artefact. Structural check: `grep -c '^## Delta' <file>` = 11.
- Links: Jira [GSL-272](https://ainstance-labs.atlassian.net/browse/GSL-272); parent epic [GSL-250](https://ainstance-labs.atlassian.net/browse/GSL-250); sibling doc task [GSL-273](https://ainstance-labs.atlassian.net/browse/GSL-273); linchpin smoke test [GSL-274](https://ainstance-labs.atlassian.net/browse/GSL-274); sources — `docs/reports/web-stack-audit-2026-08-06/fable-final-verdict.md` and `docs/reports/web-stack-audit-2026-08-06/coverage.md`.
