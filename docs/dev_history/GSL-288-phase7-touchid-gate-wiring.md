# GSL-288 — Wire TouchID .app gate into skills publish flow

**Task.** [GSL-288](https://ainstance-labs.atlassian.net/browse/GSL-288) — CRITICAL: the
TouchID `.app` bundle (`apps/core/bin/touchid-gate.app`) shipped under GSL-260 + GSL-264
but was never invoked at runtime, leaving the target-architecture rev 2 §7.3 "Приоритет 1"
physical-gesture barrier architecturally absent from every live write path. Blocks
[GSL-266](https://ainstance-labs.atlassian.net/browse/GSL-266) (first web write button:
`POST /actions/skills/publish`).

**Parent.** [GSL-174](https://ainstance-labs.atlassian.net/browse/GSL-174) — Skills
management system. Shipped as a standalone PR per the shift-79 triage plan
(`docs/reports/backlog-triage-2026-08-16/plan.md` Wave 1) so verification can gate
the write button independently.

---

## Part 1 — what was done, what hurt, where the bodies are buried

### The gap

Six pieces of the TouchID story shipped over the last two months and were correct in
isolation:

1. `apps/core/bin/touchid-gate.swift` — the LocalAuthentication Swift source (GSL-260).
2. `apps/core/bin/touchid-gate.entitlements.plist` — `com.apple.security.developer.LocalAuthentication`
   entitlement (GSL-264).
3. `apps/core/bin/touchid-gate.Info.plist.tmpl` — `CFBundleIdentifier=com.gosleep.touchid-gate`,
   `LSUIElement=true` (GSL-264).
4. `apps/core/scripts/build-touchid-gate.sh` — swiftc + codesign into the `.app` bundle
   (GSL-264 per rev-3 addendum Delta 4).
5. `apps/core/install-deps.sh` — invokes the build script during `install-deps`
   (GSL-264 wiring).
6. `apps/core/bin/tty-confirm.sh` — §7.3 Priority 1 fallback for sensorless hosts
   (GSL-264).

But nothing in the runtime ever invoked (1). Grep for `touchid|TouchID` across
`apps/core/src/**` returned exactly ONE hit — the comment at
`apps/core/src/routes/actions.ts:37` explaining that TouchID is NOT required for the
low-blast writes. The one high-blast write, `POST /actions/skills/publish`, spawns
`tools/skills/publish.sh` (via `apps/core/src/actions/publish.ts`) with a per-request
env-nonce + `--yes`; publish.sh's owner-gate then saw `have_env=1`, skipped the
TTY-confirm block, and dropped straight into rsync. An agent under the owner's UID
holding the Bearer could publish without any physical proof of the owner's presence
— exactly the impossibility target-architecture §7.5 said the physical layer prevents.

The TODO for this task lived at `tools/skills/publish.sh:237`, marked `TODO(GSL-288)`,
with the fix shape already sketched: `open -W -a "$REPO_ROOT/apps/core/bin/touchid-gate.app"`
+ exit-code case.

### The fix

One block edit in `tools/skills/publish.sh` inserts the gate **after** the DB preflight
(GSL-254 M1) and **before** the TTY-confirm block. Ordering matters — every existing
hermetic smoke (`preflight-smoke.sh`, `prod-dir-override-smoke.sh`) fails at an earlier
gate and never reaches the biometric block, so no test infrastructure needed to move.

Exit-code map, matching the Swift source's declared contract:

- `0` → owner tapped TouchID / Face ID → the TTY-confirm block is **skipped** (asking
  the owner to type "yes" after a biometric gesture is noise, not defense) → straight
  to backup + rsync + CHANGELOG.
- `1` → owner cancelled or biometric failed → `exit 3` (owner-gate refused).
- `2` → sensor unavailable → fall back to the TTY-confirm block when a TTY is present;
  refuse hard (with a pointer to the fix) when spawned from the web endpoint (no TTY,
  no sensor).
- `3` → framework error → `exit 3`.

Invocation is via `/usr/bin/open -W -a "$GATE_BIN" --args "$GATE_REASON"` when
`GATE_BIN` is a `.app` bundle directory — the bundle identity is what LocalAuthentication
attaches the biometric entitlement to, so a bare-Mach-O invocation would return
`canEvaluatePolicy=false` (the Swift source explicitly warns about this).
`open -W` propagates the app's exit status on macOS 11+, so the case statement above
sees the real code.

### The test-only bypass

Hermetic tests need a way to exercise the flow on CI without biometric hardware. Two
env knobs cover that, both scoped to the test surface:

- `GOSLEEP_TOUCHID_GATE_BIN` — override the binary path. When it points at a bare
  executable (not a `.app` bundle dir), `gate_run` execs it directly. The new smoke
  (see below) writes a two-line mock at `$WORK/mock-gate` that reads its exit code from
  a sibling `mock-gate-rc` file; no LocalAuthentication call, ever.
- `GOSLEEP_TOUCHID_BYPASS=1` — skip the gate. **Refuses** unless BOTH
  `GOSLEEP_SKILLS_PROD_DIR` and `GOSLEEP_SKILLS_BACKUPS_DIR` are set AND point OUTSIDE
  `$HOME/.claude/skills`. This double-condition makes the bypass impossible to trip
  in a production spawn: neither the launchd plist (`apps/core/plist/com.gosleep.core.plist`
  only exports `PATH`) nor the endpoint spawner (`apps/core/src/actions/publish.ts` only
  forwards `GOSLEEP_SKILLS_BACKUPS_DIR`, `GOSLEEP_CHANGELOG_PATH`, `GOSLEEP_DB_PATH` —
  and pointed at the real tree in production) sets `GOSLEEP_SKILLS_PROD_DIR`. A production
  spawn attempting the bypass thus refuses with `exit 3` before touching the sensor.

### The proof

New smoke `tools/skills/tests/touchid-gate-smoke.sh` — six invariants over the four
exit codes plus both bypass-guard branches, all against the mock binary:

- **C1** mock rc=0 → publish proceeds (rc=0, override tree populated, "touchid gate rc=0" logged).
- **C2** mock rc=1 → publish refused (rc=3, no rsync, "TouchID denied" fingerprint).
- **C3** mock rc=2 + no TTY → publish refused (rc=3, "no owner-presence path available" fingerprint).
- **C4** mock rc=3 → publish refused (rc=3, "TouchID framework error" fingerprint).
- **D1** BYPASS=1 without hermetic overrides → refused (rc=3, "refusing bypass" fingerprint).
- **D2** BYPASS=1 WITH hermetic overrides → publish proceeded (rc=0, "TouchID gate skipped" fingerprint).

Plus the standing invariant that closes every publish.sh smoke: the real global tree
`$HOME/.claude/skills/handoff` mtime is snapshotted before + after and MUST match, so
a leaky override fails loud.

### What did NOT need to change

- **`apps/core/src/routes/actions.ts`** low-blast comment at line 37 stays as-is
  (correct — those writes are Priority 3, not high-blast).
- **`apps/core/src/actions/publish.ts`** exit-code → HTTP-status mapping already handled
  `exit 3 → 403` for the old TTY-timeout path; the same mapping now fires for physical
  refusals with no code change. Only the top-of-file comment was updated to note that
  the pause is lifted.
- **The launchd plist** — no new env vars needed; the gate binary path defaults to the
  in-repo `.app` bundle.
- **`apps/core/src/actions/spawn.ts`** — the generic spawn helper needed no changes.
  The gate lives inside `publish.sh`, not around it.
- **`docs/runbooks/gosleep-core.md`** §6.2 already documented TouchID troubleshooting
  from GSL-264; only §10 (Skills publishing) gained a new subsection describing the
  wiring, the exit-code contract, and the test-only overrides.

### Why not straight-into publish.ts

An earlier draft moved the gate invocation into `apps/core/src/actions/publish.ts` so the
Bearer-authenticated HTTP path could enforce it independently of the CLI. Rejected: the
`.app` must be invoked in a way that inherits the bundle identity (`open -W -a`), and
the CLI already had the exit-code + fallback plumbing wired for the tty-confirm case.
Putting the gate in `publish.sh` ensures it fires whether the caller is:

1. The web endpoint (env-nonce + `--yes`, no TTY).
2. An interactive owner (TTY + `--yes` or interactive `yes` typed).
3. A future channel (e.g. a background rotate cron) that spawns publish.sh directly.

The alternative (gate in publish.ts, no gate in publish.sh) would leave path 3 unguarded
the moment anyone new spawned the CLI. Defense in depth: the gate lives where the mutation
lives.

### Gates run before commit

- `bun x tsc -p apps/core --noEmit` — clean.
- `bun test apps/core` — 350 pass / 0 fail / 936 expect() calls / 5.04 s / 36 files.
- `bash tools/lab/tests/core-smoke.sh` (port 7346 override, production port 7331
  untouched) — 102 pass / 0 fail.
- `bash tools/skills/tests/preflight-smoke.sh` — 5/5 PASS (existing gates unaffected).
- `bash tools/skills/tests/prod-dir-override-smoke.sh` — 7/7 PASS.
- `bash tools/skills/tests/touchid-gate-smoke.sh` — 7/7 PASS (six invariants + real-tree
  mtime check).

### Biometric-safety discipline

Every test in this task uses a mock binary at `$WORK/mock-gate`; no code path fired a
real `LAContext` call. The orchestrator was notified before commit that no biometric
dialog was triggered by any automated step. A live-hardware TouchID acceptance run
(dialog rendered, owner taps, publish lands) is deliberately deferred to the independent
verification pass on the open PR — a live dialog would surprise the owner at the
machine, and this task's contract is to hold the PR open for that verification.

---

## Part 2 — short technical reference

### Files touched

| File | Change |
|---|---|
| `tools/skills/publish.sh` | Replaced the `interactive confirmation` TODO block with the TouchID gate (bypass guard + `gate_run` + exit-code case) followed by the existing TTY-confirm block gated on `GATE_RC=2` OR `GATE_BYPASS=1`. |
| `apps/core/src/actions/publish.ts` | Header comment updated: "TouchID PAUSED" → "TouchID WIRED (GSL-288)"; exit-3 mapping already carried the semantic. |
| `docs/runbooks/gosleep-core.md` | Section 10 gained a "TouchID physical-gesture gate (GSL-288 — WIRED 2026-08-16)" subsection with exit-code contract + env-override notes. |
| `tools/skills/tests/touchid-gate-smoke.sh` | New. Six invariants against a mock gate binary; asserts real-tree untouched. |
| `docs/dev_history/GSL-288-phase7-touchid-gate-wiring.md` | This file. |
| `docs/dev_history/README.md` | New index line under `## Epic GSL-174`. |

### Exit-code contract (unchanged from the Swift source; now enforced)

```
touchid-gate → publish.sh                    publish.sh → endpoint (via performPublish)
  0 (biometric ok)  → proceed                  0 (published)         → HTTP 200
  1 (owner cancel)  → exit 3                   3 (owner refused)     → HTTP 403
  2 (no sensor)     → TTY fallback / exit 3    2 (usage error)       → HTTP 400
  3 (framework err) → exit 3                   1 (mid-flow failure)  → HTTP 500
```

### Test-only env overrides (production spawn NEVER sets these)

- `GOSLEEP_TOUCHID_GATE_BIN` — override the gate binary path (mock-friendly).
- `GOSLEEP_TOUCHID_BYPASS=1` — skip the gate; refuses unless BOTH
  `GOSLEEP_SKILLS_PROD_DIR` and `GOSLEEP_SKILLS_BACKUPS_DIR` are set outside
  `$HOME/.claude/skills`.

### How to verify the fix by hand

```bash
# Structural check — the gate wiring is present:
grep -n 'touchid gate' tools/skills/publish.sh

# Hermetic smoke (mock gate, six exit-code invariants):
bash tools/skills/tests/touchid-gate-smoke.sh

# Real-hardware acceptance (WILL trigger a biometric dialog — owner must be present):
#   1. Ensure apps/core/bin/touchid-gate.app is built:
#        bash apps/core/scripts/build-touchid-gate.sh
#   2. Invoke publish.sh from an interactive shell:
#        bash tools/skills/publish.sh handoff --yes
#      → TouchID dialog appears; tap → publish proceeds. Cancel → publish exits 3.
```

### Rollback

Single-commit revert against this branch drops the gate wiring back to the TODO comment
and reinstates the old "TouchID PAUSED" text. No filesystem state under `data/` is
touched by this change; the smoke's `.artifacts/touchid-gate-smoke/` scratch is git-ignored.
