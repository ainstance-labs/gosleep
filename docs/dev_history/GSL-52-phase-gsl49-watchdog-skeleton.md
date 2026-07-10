# GSL-52 — launchd plist + watchdog.sh (skeleton)

**Epic:** GSL-49 — Watchdog над оркестратором (PRD Phase 1)
**Branch:** GSL-49-orchestrator-watchdog
**Phase:** GSL-49 — PRD Phase 1, requirement R1.2 (mechanical watchdog, consumer side)

---

## Part 1 — Story

### What was done
The heartbeat protocol (GSL-51) now has its consumer: a mechanical, zero-LLM bash watchdog that a
launchd LaunchAgent runs every 2–5 minutes above the orchestrator. Each tick it reads durable state
only — heartbeat file mtime + last JSONL line — cross-checks it against tmux session liveness, and
acts per the contract already written into the skill: fresh heartbeat + dead session → re-wake via
the existing cold-start protocol (re-attach, never respawn workers); stale heartbeat + live session
→ ONE `send-keys` nudge, still stale after a grace → kill (explicit pane id only) + re-wake;
`context_pct` ≥ ceiling → "write handoff now", overdue → kill + re-wake from the handoff;
`status:"quiesced"` → never restart; `status:"rolling"` + fresh → wait for the successor. Every
action is recorded in an append-only watchdog ledger (JSONL). Shipping alongside: a launchd plist
template and an installer that ONLY renders the plist and prints the `launchctl` commands — loading
into the system is the owner's decision (runbook GSL-57).

### Problems solved
- **Testability without a live fleet:** all tmux probes go through injectable functions
  (`WD_TEST_MODE=1` + `WD_TEST_SESSION_ALIVE`/`WD_TEST_ORCH_PANE`), and all actions are dry-run
  aware. `smoke.sh` drives 11 decision scenarios (fresh/stale/missing/quiesced/rolling/high-ctx ×
  alive/dead) deterministically in `.artifacts/watchdog-smoke/` — 20/20 checks green.
- **Nested quoting for re-wake:** spawning `claude "<cold-start prompt>"` through tmux's `sh -c`
  is quoting hell; solved with a generated one-shot launcher script + prompt file in the state dir.
- **launchd's minimal PATH** (no homebrew tmux, no claude): the plist template carries an
  `EnvironmentVariables/PATH` placeholder that the renderer fills from the rendering shell's PATH.

### Problems remaining
- Restart budget/backoff (GSL-53), startup grace / zombie debounce / kill cooldown / mass-death /
  hardened single-flight (GSL-54), reap-before-kill (GSL-55) — the next three commits. Until GSL-54
  lands, a freshly started orchestrator with no heartbeat gets a *nudge* (never an instant kill —
  first response is always a nudge, so the Gastown #567 kill-a-fresh-session failure cannot happen
  even now), and the `rewake` path has no budget cap yet.
- The watchdog ledger default path `docs/handoff/.watchdog-ledger.jsonl` needs a `.gitignore`
  pattern (`docs/handoff/.watchdog-*`); .gitignore is outside this task's commit paths — flagged to
  the team-lead.

### Pitfalls & workarounds
- **`kill-pane` only by explicit id** (2026-07-07 lesson: `-a` killed a live fleet): `act_kill`
  refuses any target not matching `^%[0-9]+$`; smoke has a static grep gate that fails if any
  `kill-pane` invocation lacks `-t`.
- **Mis-armed watchdog is worse than none** (warren invariant): config is validated at startup and
  invalid values fail LOUDLY with exit 78 — verified by a smoke scenario.
- **Quiesced beats everything:** the `status:"quiesced"` check runs BEFORE liveness probes, so a
  deliberately-ended chain is never restarted even with a dead session (smoke-asserted).

### What didn't make it
No `launchctl` execution anywhere (by mandate — owner loads per runbook GSL-57). No LLM triage
(`claude -p`) — deliberately out per PRD (optional on-anomaly extension, 02 §9-C). No SKILL.md
edits — the contract was already written by GSL-51; this script only implements the consumer side.

---

## Part 2 — Technical reference

**Files added (all under `tools/watchdog/`):**
- `watchdog.sh` — the tick script: config (file > env > defaults, loud validation, exit 78),
  heartbeat read (`stat` mtime + `tail -1` field parse), tmux probes (has-session, pane resolve via
  window name → configured target), decision tree, actions (nudge / handoff request / kill /
  re-wake), ledger emit, markers (`nudge`, `handoff-request`, `last-started`) in
  `.artifacts/watchdog/`, basic mkdir single-flight lock.
- `com.gosleep.watchdog.plist.template` — launchd LaunchAgent (StartInterval `__INTERVAL__`,
  RunAtLoad, PATH env, logs to `.artifacts/watchdog/`), placeholders `__REPO_ROOT__/__INTERVAL__/__PATH__`.
- `install-watchdog.sh` — renders the plist to `.artifacts/watchdog/` (or `--out`/`--print`),
  `plutil -lint`s it, prints install/verify/uninstall `launchctl` instructions; installs NOTHING.
- `watchdog.conf.example` — every knob documented; real `watchdog.conf` is machine-local, uncommitted.
- `smoke.sh` — repeatable gate: static checks (bash -n, 0-LLM grep, kill-pane safety grep) + 11
  dry-run decision scenarios + side-effect asserts (ledger events, last-started marker, quiesced
  never restarted) + loud-config + plist render.

**Decisions (`DECISION=` line each tick):** `ok`, `ok_quiesced`, `waiting_successor`, `rewake`,
`nudged`, `waiting_nudge`, `kill_rewake`, `handoff_requested`, `waiting_handoff`.

**Defaults:** stale ≥ 900s; nudge grace 240s; ctx ceiling 80% (self-roll is ~70%, watchdog is the
backstop); handoff wait 600s; tick 180s (plist).

**Verified by running:**
- `bash tools/watchdog/smoke.sh` → 20/20 PASS (scenarios above); artifacts in
  `.artifacts/watchdog-smoke/` (gitignored). `bash -n` on all scripts; shellcheck not installed on
  this box (noted).
- `install-watchdog.sh --out ...` → rendered plist, zero placeholders left, `plutil -lint` OK,
  instructions printed, nothing written outside the repo.

**PRD acceptance (R1.2):** checks (1) tmux session exists (2) heartbeat age < threshold
(3) context% < ceiling — implemented; dead → re-wake via cold-start (re-attach prompt), stale →
nudge → kill+re-wake, ceiling → handoff → fresh orchestrator — implemented; 0 LLM calls —
grep-gated in smoke; offline-safe except re-wake (probes are local file+tmux only). F1-S1
end-to-end (≤2 ticks) pending a live-fleet run — the decision path is smoke-verified.

**Links:** Jira [GSL-52](https://ainstance-labs.atlassian.net/browse/GSL-52) ·
GitHub [#60](https://github.com/ainstance-labs/gosleep/issues/60) · Epic
[GSL-49](https://ainstance-labs.atlassian.net/browse/GSL-49) / [#57](https://github.com/ainstance-labs/gosleep/issues/57)

---

## Review fixes (2026-07-10, epic review C1/M1/M2 — `docs/reviews/REVIEW-gsl49.md`) → v0.5.0

- **C1 (CRITICAL) — identity-verified targeting.** Positional pane resolution (first pane of the
  window → `session:0.0` fallback) removed entirely: after the orchestrator dies, the first pane
  of its window is typically a live WORKER, and the old resolver would nudge/kill it. The target
  now comes ONLY from the heartbeat's own `pane` field (GSL-51 protocol extension), verified to
  exist in the session (`probe_pane_exists`). Anything less than `verified`
  (`no_field`/`invalid_field`/`not_found`) on a live session → new decision `identity_unverified`:
  `kill_refused reason=identity_unverified` in the ledger + escalation — no nudge, no kill, no
  re-wake on a guess. Startup grace still shields a just-(re)started session whose first
  pane-bearing heartbeat isn't written yet. `WD_ORCH_PANE_TARGET` deleted; `WD_ORCH_WINDOW_NAME`
  survives only to name the re-wake window.
- **M2 — kill verified, never re-wake after a failed kill.** `act_kill` now checks the kill rc AND
  re-lists to confirm the pane is gone; failure → `kill_failed` ledger event + escalation and the
  restart is ABORTED (a surviving pane + a fresh orchestrator = two live orchestrators).
- **M1 — re-wake brief consumed.** `build_rewake_prompt` extracts the BRIEF-START/END block from
  `references/re-wake-brief.md` (`WD_REWAKE_BRIEF`) and substitutes
  `{{PROJECT_DIR}}/{{REASON}}/{{RESTART_N}}/{{RESTART_BUDGET}}/{{TS}}`; the brief's REASON
  dictionary re-synced to the watchdog's actual reasons; inline fallback only when the template is
  missing (ledger event `rewake_brief_missing`).
- Verified: `bash tools/watchdog/smoke.sh` → **65 passed, 0 failed** (was 52; +6 scenarios /
  +7 asserts covering the three branches: worker-first-pane refuse, identity detail, grace shield,
  brief substitution + placeholder sweep + RESTART_N progression + fallback, kill-failure
  no-re-wake). LEDGER.md, watchdog.conf.example and runbook §§2–3/6/8 updated to match.
