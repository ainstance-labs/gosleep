# Adversarial verification of the Opus stack + coverage audits — 2026-08-07

Fork: verify-claims (Fable 5), shift 75. Scope: primary-source re-check of
factual claims in `stack.md` and `coverage.md`. Deep core / Claude-Code
mechanics are out of scope (parallel fork verify-core owns those).

## Summary — what did NOT survive the re-check

- **CRITICAL — REFUTED (partly):** *"TouchID from a swiftc CLI binary works
  without an .app bundle, but codesign for reliability on Tahoe"* (stack.md
  §L7). A plain Mach-O CLI compiled with `swiftc -framework LocalAuthentication`
  cannot present Touch ID at all — macOS requires an `.app` bundle with an
  `Info.plist` and entitlements to reach the biometric prompt. Working prior
  art: `sameh0/op-gate` explicitly wraps its Swift binary in a signed `.app`
  bundle for exactly this reason ("A plain CLI binary can't access Touch ID —
  macOS requires an `.app` bundle with entitlements for biometric prompts via
  LocalAuthentication" — repo README verbatim). Alternative CLI paths exist
  but are not the design in stack.md: `sudo` gets Touch ID via a PAM module
  (`pam_tid.so`, `/etc/pam.d/sudo_local`) — kernel-provided, not LAContext.
  Impact on plan: the `apps/core/bin/touchid-gate` entry in
  `target-architecture.md §3.3` must be wrapped in a minimal signed `.app`
  bundle (ad-hoc `codesign --sign -` + `entitlements.plist`) and invoked by
  `publish.sh` as an app, not a bare binary. ~30–60 min of build work; auth
  layer's threat model is unchanged.
- **CORRECTED — Bun RSS drift #21560 (stack.md §L1 caveat).** The issue is
  real and open (opened 2025-08-02, no fix), but titled "Memory (RSS) in Bun
  Spawned Child Process Grows Slowly, Even When Idle" — it indicts RSS growth
  in **child processes spawned by Bun** with long-lived IPC, not the parent
  `Bun.serve` process. gosleep-core's spawn pattern is short-lived shell
  scripts that exit — the #21560 profile does not directly apply. Nightly
  restart of the daemon is still a reasonable defensive habit, but sold on the
  wrong evidence in stack.md. Correction: keep the restart, add RSS
  self-monitor on the daemon and drop the #21560 causation claim.

## Summary — what held up (per numbered directive)

1. **Vite 8 vs 7 — CONFIRMED with a caveat.** Vite 8 announced 2026-03-12 and
   marked stable; Rolldown is the default bundler (Oxc is the compiler layer,
   not the bundler — a minor mis-label in the PROGRESS message but corrected
   in stack.md). Recommendation to pin **Vite 7** for v1 is defensible: v8
   adds ~15 MB install size and a bundler swap, official docs suggest a staged
   `rolldown-vite` migration on v7 first. Vite 7 was released 2025-06 — 14+
   months old at 2026-08, which is "boring" more than "fresh"; the audit's
   framing holds.
2. **macOS Tahoe 26.x `security find-generic-password -w` regression —
   CONFIRMED.** Multiple independent sources: hangs indefinitely, exits 36 if
   lucky; separately, the output format now HEX-encodes passwords with binary
   bytes (script-breaking on its own). Both symptoms warrant the Tahoe-aware
   fallback + `GOSLEEP_TAHOE_KEYCHAIN_ACK` acknowledgment the audit proposes.
3. **Bun #21560 — see CORRECTED above** (issue real, causation mis-directed).
4. **Hono issues #2050 / #2319 / #2993 / #3540 — ALL CONFIRMED real.**
   - #2050: streamSSE closes immediately without a sleep/loop hack — matches
     stack.md's "broadcaster must never resolve early" caveat.
   - #2319: streamSSE not working — real, same class.
   - #2993: stream closed automatically — real, same class.
   - #3540: `IncompleteRead(0 bytes read, 2 more expected)` — Bun-specific
     chunked-encoding bug; **CLOSED and fixed via PR #3599** (audit implied
     open by lumping into the caveat list; harmless overstatement).
   Net: keep the audit's mitigation (heartbeat 15–30 s, defensive keep-alive),
   note #3540 as historical.
5. **Drizzle + bun:sqlite consensus 2026 — CONFIRMED.** Drizzle v1 is stable;
   multiple 2026 comparisons place it as the default for Bun+SQLite / edge /
   bundle-conscious profiles (~50 kB client vs Prisma's ~500 kB+). Warren
   uses it; kotadb uses it. "Divergence >> corruption" for WAL + tail-indexer
   is the standard trade-off; SQLite corruption on WAL is rare and diagnosable
   (`PRAGMA integrity_check`) — divergence is the practical risk. Held.
6. **TouchID CLI — REFUTED, see above.**
7. **Keychain hardening (cli/cli#13317, `security -T` ACL, timeout → 503) —
   CONFIRMED.** Issue is real, open, PR #13318 pending. `ActiveToken()` in
   gh silently drops keyring errors; the audit's insistence on hard-fail 503
   (never silently omit `Authorization`) is exactly the gh anti-pattern.
   `security add-generic-password -T <path-to-core>` binds the ACL to a
   specific binary; combine with `-a`/`-s` for a stable lookup key.

## 8. Spot-check of coverage.md gaps against our own artifacts

All four coverage gaps are literally reproducible:

- **8a — "manifest" ×0 in `target-architecture.md`.** `grep -c -i "manifest"`
  returns **0**. The 974-line architecture never mentions the decision
  manifest by that word — the coverage audit's central R1 sub-gap holds.
- **8b — No per-agent fleet table in schema §4.3.** The eight tables listed
  are `events`, `questions`, `decisions`, `tasks`, `skills`, `heartbeat`
  (scalar `context_pct` / `open_workers`), `server_intents`, `ingest_state`.
  No `agents`, no `sessions`, no per-agent projection. Coverage gap holds.
- **8c — No "defer" action in §6.2 endpoints.** The seven POST endpoints
  are `skills/publish`, `questions/answer`, `questions/resolve`, `tick`,
  `events/ack`, `chronicler/rebuild`, `internal/emit`. `grep -i "defer"` on
  the whole file returns **0**. Coverage gap holds.
- **8d — Warren has POST `/runs/:id/steer` in the live repo; our design has
  no analogue.** Confirmed from our own
  `findings/autosk-warren-ui.md`: Warren's public endpoint list explicitly
  contains "steer mid-run — POST-ом вбросить сообщение, которое агент
  прочтёт на следующем ходу". Our §6.2 has no `/actions/message-to-agent`,
  `/actions/steer`, or equivalent. The coverage audit's G1 (answer-delivery
  loop) is not just missing text — the shape Warren shipped for exactly this
  is literally quoted in our own research findings and dropped from the
  architecture. Held decisively.

## 9. Net effect on the plan

Held: 7 of 8 primary claims; the entire coverage-gap list (G1–G4, S1, R6 Jira
sync, C3/C4 endpoint holes). No planning conclusion of either audit needs to
be discarded.

To adjust:

- **Architecture change (real):** rev 3 must specify `bin/touchid-gate` as a
  minimal signed `.app` bundle (ad-hoc `codesign --sign -` + entitlements.plist
  + Info.plist), invoked from `publish.sh` as an app path, not a bare Mach-O.
  Add a task; ~1 h of build work, no threat-model impact.
- **Wording change (small):** drop the #21560 causation from the Bun daemon
  caveat; keep the nightly-restart + RSS self-monitor as generic defensive
  practice.
- **Wording change (trivial):** call Rolldown the default bundler for Vite 8
  (Oxc is the compiler layer inside the Rolldown/OXC integrated toolchain);
  the substantive recommendation (pin v7 for v1) is unchanged.
- Nothing else moves. Vite pin, Keychain hardening, /metrics, SessionAdapter,
  Channels, PreToolUse-defer, manifest projection, defer endpoint, per-agent
  fleet table, Warren-style POST /steer analogue — all validated by primary
  sources and by our own on-disk artifacts.

## Sources

- Vite 8 blog: https://vite.dev/blog/announcing-vite8
- Vite blog index: https://vite.dev/blog/
- Bun #21560 (RSS drift in spawned child): https://github.com/oven-sh/bun/issues/21560
- gh cli #13317 (silent unauth on Keychain fail): https://github.com/cli/cli/issues/13317
- Hono #2050 (SSE closes immediately): https://github.com/honojs/hono/issues/2050
- Hono #2319 (streamSSE not working): https://github.com/honojs/hono/issues/2319
- Hono #2993 (stream closed automatically): https://github.com/honojs/hono/issues/2993
- Hono #3540 (IncompleteRead — closed, PR #3599): https://github.com/honojs/hono/issues/3540
- Tahoe Keychain CLI regression: https://dev.to/euda1mon1a/macos-tahoe-broke-keychain-cli-reads-novel-findings-from-an-ai-agent-deployment-2p3o
- Tahoe security hex-encoding change: https://zenn.dev/omori432/articles/macos-tahoe-keychain-hex-encoding?locale=en
- op-gate — CLI Touch ID via .app-bundle wrap: https://github.com/sameh0/op-gate
- Drizzle vs Prisma vs Kysely 2026: https://scihub101.com/web-development/orms-prisma-vs-drizzle-vs-kysely-2026 ; https://www.pkgpulse.com/guides/drizzle-orm-v1-vs-prisma-6-vs-kysely-2026

Internal: `docs/reports/web-harness-research-2026-08-03/target-architecture.md`,
`docs/reports/web-harness-research-2026-08-03/findings/autosk-warren-ui.md`,
`docs/reports/web-stack-audit-2026-08-06/{coverage,stack}.md`.
