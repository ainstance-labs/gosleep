# GSL-288 — Wire TouchID .app gate into skills publish flow (default-off, opt-in)

**Task.** [GSL-288](https://ainstance-labs.atlassian.net/browse/GSL-288) — TouchID `.app`
bundle (`apps/core/bin/touchid-gate.app`) shipped signed + entitled under GSL-260 + GSL-264
but was never invoked at runtime. The missing invocation turned out to be a **deliberate
stub** — the physical-gesture layer had been priced-in as a design target for the future
but not activated. This task lands the wiring so activation is a one-line env-flag flip,
without turning it on today.

**Parent.** [GSL-174](https://ainstance-labs.atlassian.net/browse/GSL-174) — Skills
management system. Shipped as a standalone PR per the shift-79 triage plan
(`docs/reports/backlog-triage-2026-08-16/plan.md` Wave 1).

**Owner ruling (2026-08-16).** TouchID functionality is **deferred**; harness + web
program comes first. Reframing recorded on the Jira ticket:

- The missing runtime invocation was a deliberate stub, not a shipping bug.
- The task is no longer CRITICAL. `[CRITICAL]` dropped from the ticket summary.
- The wiring MAY land, but the real gate invocation MUST sit behind an opt-in flag
  (`GOSLEEP_TOUCHID=1`) that is DEFAULT OFF.
- With the flag off, publish behaviour is completely unchanged and daily flows are
  never blocked by biometrics.
- NO real biometric dialog fires anywhere in this task — mock-driven smoke coverage
  is the sole live-proof.

---

## Part 1 — what was done, what hurt, where the bodies are buried

### Original diagnosis (kept for context; the framing shifted per owner ruling)

Six pieces of the TouchID story shipped over the last two months and were correct in
isolation:

1. `apps/core/bin/touchid-gate.swift` — the LocalAuthentication Swift source (GSL-260).
2. `apps/core/bin/touchid-gate.entitlements.plist` — biometric entitlement (GSL-264).
3. `apps/core/bin/touchid-gate.Info.plist.tmpl` — `com.gosleep.touchid-gate` bundle id,
   `LSUIElement=true` (GSL-264).
4. `apps/core/scripts/build-touchid-gate.sh` — swiftc + codesign into the `.app` bundle.
5. `apps/core/install-deps.sh` — invokes the build script during `install-deps`.
6. `apps/core/bin/tty-confirm.sh` — §7.3 Priority 1 fallback for sensorless hosts.

But nothing in the runtime invoked (1). `grep -RIn 'touchid|TouchID'` across
`apps/core/src/**` returned exactly ONE hit — the comment at `routes/actions.ts:37`
noting TouchID is NOT required for the low-blast writes. The one high-blast write,
`POST /actions/skills/publish`, spawns `tools/skills/publish.sh` via
`apps/core/src/actions/publish.ts` with a per-request env-nonce + `--yes`; publish.sh's
owner-gate saw `have_env=1`, skipped the TTY-confirm block, and dropped straight into
rsync.

The TODO for this task lived at `tools/skills/publish.sh:237`, marked `TODO(GSL-288)`,
with the fix shape already sketched: `open -W -a "$REPO_ROOT/apps/core/bin/touchid-gate.app"`
+ exit-code case.

### What actually shipped (default-off)

One structural change in `tools/skills/publish.sh`: the entire TouchID block is wrapped
in `if [ "${GOSLEEP_TOUCHID:-0}" = "1" ]; then … fi`. With the flag OFF (the default),
the block prints one breadcrumb line —

```
publish:   touchid gate: OFF (stub; owner-deferred 2026-08-16; opt in with GOSLEEP_TOUCHID=1)
```

— and falls through to the pre-existing TTY-confirm block. Publish behaviour is
bit-identical to before this task landed: TTY prompt when interactive, silent proceed
when `--yes` was passed and either a TTY or env-nonce is present.

With the flag ON, the block activates. Ordering: after `verify-local` + DB preflight
(so a broken repo state or unmigrated DB refuses before biometric hardware is
touched), before the TTY-confirm block. Invocation is
`/usr/bin/open -W -a "$GATE_BIN" --args "$reason"` when GATE_BIN is a `.app` bundle
directory — the bundle identity is what LocalAuthentication attaches the biometric
entitlement to; a bare-Mach-O invocation would return `canEvaluatePolicy=false`, per
the Swift source's own warning. `open -W` propagates the app's exit status on
macOS 11+.

Exit-code map, matching the Swift source's declared contract:

- `0` → owner tapped TouchID / Face ID → the TTY-confirm block is **skipped** → straight
  to backup + rsync + CHANGELOG.
- `1` → owner cancelled or biometric failed → `exit 3` (owner-gate refused).
- `2` → sensor unavailable → fall back to the TTY-confirm block when a TTY is present;
  refuse hard (with a pointer to the fix) when spawned from the web endpoint (no TTY,
  no sensor).
- `3` → framework error → `exit 3`.

Neither the launchd plist (`apps/core/plist/com.gosleep.core.plist` only exports
`PATH`) nor the endpoint spawner (`apps/core/src/actions/publish.ts` only forwards
`GOSLEEP_SKILLS_BACKUPS_DIR`, `GOSLEEP_CHANGELOG_PATH`, `GOSLEEP_DB_PATH`) sets
`GOSLEEP_TOUCHID`. A production spawn today therefore enters the block with the flag
off. Turning the flag on later is a one-line env change in each of those two places,
plus building the `.app` bundle.

### The hermetic bypass — fail-closed against real production paths

`GOSLEEP_TOUCHID_BYPASS=1` skips the gate under opt-in, but the guard now
mirrors the GSL-254 production test-guard pattern: it refuses (`exit 3`) unless BOTH
`GOSLEEP_SKILLS_PROD_DIR` and `GOSLEEP_SKILLS_BACKUPS_DIR` resolve OUTSIDE the real
tree. The guard refuses against three explicit prod-path shapes:

- `PROD_DIR` unset or matching `$HOME/.claude/skills` / `$HOME/.claude/skills/*`.
- `BACKUPS_DIR` unset or matching `$HOME/.claude/skills` / `$HOME/.claude/skills/*`.
- `BACKUPS_DIR` matching `$REPO_ROOT/docs/skills/backups` / `$REPO_ROOT/docs/skills/backups/*`
  — the launchd default backups tree.

The double-condition (both variables must resolve outside real paths) makes the
bypass unreachable in production even if a caller sets both env vars pointing at the
real tree by mistake: the fail-closed guard fires before any mutation. The smoke
covers this with three refusal cases (D1 missing overrides, D3 real PROD_DIR, D4 real
BACKUPS_DIR) plus the acceptance case (D2 hermetic overrides).

### Proof (nine invariants + two mtime checks; no biometric anywhere)

New smoke `tools/skills/tests/touchid-gate-smoke.sh` against a mock binary that never
touches LocalAuthentication:

- **E1** default-off (no `GOSLEEP_TOUCHID`) → publish proceeds via pre-GSL-288
  owner-gate; the stub log line is present; no gate/bypass fingerprints fire.
- **C1** opt-in + mock rc=0 → publish proceeds; `touchid gate rc=0` logged.
- **C2** opt-in + mock rc=1 → publish refused (rc=3, "TouchID denied").
- **C3** opt-in + mock rc=2 + no TTY → publish refused (rc=3, "no owner-presence
  path available").
- **C4** opt-in + mock rc=3 → publish refused (rc=3, "TouchID framework error").
- **D1** opt-in + BYPASS=1 without hermetic overrides → refused ("refusing bypass").
- **D2** opt-in + BYPASS=1 with hermetic overrides → publish proceeds.
- **D3** opt-in + BYPASS=1 + `PROD_DIR=$HOME/.claude/skills` (real prod tree) →
  refused (fail-closed).
- **D4** opt-in + BYPASS=1 + `BACKUPS_DIR=$REPO_ROOT/docs/skills/backups` (real prod
  backups tree) → refused (fail-closed).

Plus:
- Real `$HOME/.claude/skills/handoff` mtime snapshot before + after all nine cases
  — unchanged.
- Real `$REPO_ROOT/docs/skills/backups` mtime snapshot before + after — unchanged.

### What did NOT change

- `apps/core/src/routes/actions.ts` line 37 comment stays as-is.
- `apps/core/src/actions/publish.ts` exit-code → HTTP-status mapping unchanged; the
  header comment was rewritten to reflect the default-off shape.
- The launchd plist stays unchanged (`GOSLEEP_TOUCHID` not exported).
- No end-user-visible behaviour on the current shipping build — publishing a skill
  today looks and behaves exactly as it did before this commit, because the flag is
  off in every code path that spawns publish.sh today.

### Gates run before commit

- `bun x tsc -p apps/core --noEmit` — clean.
- `bun test apps/core` — 350 pass / 0 fail / 936 expect() calls / 3.05 s / 36 files.
- `GOSLEEP_CORE_PORT=7346 bash tools/lab/tests/core-smoke.sh` (production port 7331
  untouched) — 102 pass / 0 fail.
- `bash tools/skills/tests/preflight-smoke.sh` — 5/5 PASS.
- `bash tools/skills/tests/prod-dir-override-smoke.sh` — 7/7 PASS.
- `bash tools/skills/tests/touchid-gate-smoke.sh` — 11/11 PASS (9 invariants + 2 real-tree
  mtime checks).

### Biometric-safety discipline

Every test uses the mock binary at `$WORK/mock-gate`; no code path fired a real
`LAContext` call. Per owner ruling on 2026-08-16, no clearance for a real-hardware run
is requested — the mock-based smoke + the fail-closed prod-path guard on the bypass
are the sufficient proof surface for this shift.

---

## Part 2 — short technical reference

### Files touched

| File | Change |
|---|---|
| `tools/skills/publish.sh` | Wrapped the entire TouchID block in `if GOSLEEP_TOUCHID=1`; added fail-closed guard against real `$HOME/.claude/skills` and `docs/skills/backups` even under opt-in bypass; kept the TTY-confirm block as the default owner-gate. |
| `apps/core/src/actions/publish.ts` | Header comment rewritten: "TouchID PAUSED" → "TouchID gate WIRED but SHIPS DEFAULT-OFF"; behavioural mapping unchanged. |
| `docs/runbooks/gosleep-core.md` | Section 10 rewritten: gate is DEFAULT-OFF; how to enable later (opt-in flag + build the `.app` + wire the plist); new fail-closed guard documented. |
| `tools/skills/tests/touchid-gate-smoke.sh` | New. Nine invariants + two mtime checks against a mock binary. |
| `docs/dev_history/GSL-288-phase7-touchid-gate-wiring.md` | This file. |
| `docs/dev_history/README.md` | Index line under `## Epic GSL-174`. |

### Feature flag

- `GOSLEEP_TOUCHID` — off (unset or `!= 1`) by default. Set to `1` to activate the
  gate in `publish.sh`. Neither the launchd plist nor the endpoint spawner sets it
  today; enabling is a deliberate future step.

### Exit-code contract when the gate IS active

```
touchid-gate → publish.sh                    publish.sh → endpoint (via performPublish)
  0 (biometric ok)  → proceed                  0 (published)         → HTTP 200
  1 (owner cancel)  → exit 3                   3 (owner refused)     → HTTP 403
  2 (no sensor)     → TTY fallback / exit 3    2 (usage error)       → HTTP 400
  3 (framework err) → exit 3                   1 (mid-flow failure)  → HTTP 500
```

### Test-only env overrides (opt-in only)

- `GOSLEEP_TOUCHID_GATE_BIN` — override the gate binary path (mock-friendly).
- `GOSLEEP_TOUCHID_BYPASS=1` — skip the gate. **Fail-closed** vs real prod: refuses
  unless BOTH `GOSLEEP_SKILLS_PROD_DIR` and `GOSLEEP_SKILLS_BACKUPS_DIR` resolve
  outside `$HOME/.claude/skills` AND outside `$REPO_ROOT/docs/skills/backups`.

### How to verify the wiring by hand (no biometric)

```bash
# Structural check — the wiring is present:
grep -n 'touchid gate' tools/skills/publish.sh

# Nine-invariant hermetic smoke (mock gate, never touches LAContext):
bash tools/skills/tests/touchid-gate-smoke.sh

# Default-off breadcrumb sanity check (no biometric; publish proceeds via env-nonce):
env GOSLEEP_WEB_TOKEN=abcdef1234567890abcdef1234567890 \
    GOSLEEP_SKILLS_PROD_DIR=/tmp/scratch-prod GOSLEEP_SKILLS_BACKUPS_DIR=/tmp/scratch-backups \
    GOSLEEP_DB_PATH=data/gosleep.db \
    bash tools/skills/publish.sh handoff --yes 2>&1 | grep -E 'touchid gate|refusing bypass'
# → "publish:   touchid gate: OFF (stub; owner-deferred 2026-08-16; opt in with GOSLEEP_TOUCHID=1)"
```

### How to enable the gate later (owner-deliberate future step)

1. `bash apps/core/scripts/build-touchid-gate.sh` — build the signed `.app`.
2. Add `GOSLEEP_TOUCHID=1` to `apps/core/plist/com.gosleep.core.plist`'s
   `EnvironmentVariables` dict AND to the env pass-through in
   `apps/core/src/actions/publish.ts`.
3. Reload launchd. From this point on, publish.sh invokes the real gate; a live-hardware
   acceptance is required as part of that enable task.

### Rollback

Single-commit revert reinstates the previous default-off shape (or, for the earlier
6914c2f, the fail-open shape). No filesystem state under `data/` is touched by this
change; the smoke's `.artifacts/touchid-gate-smoke/` scratch is git-ignored.
