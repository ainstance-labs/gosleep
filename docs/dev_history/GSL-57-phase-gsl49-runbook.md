# GSL-57 — Runbook: watchdog operations for the owner

**Epic:** GSL-49 — Watchdog над оркестратором (PRD Phase 1)
**Branch:** GSL-49-orchestrator-watchdog
**Phase:** GSL-49 — PRD Phase 1, task 7 «[Docs] Runbook установки watchdog» (+ .gitignore tail from GSL-55)

---

## Part 1 — Story

### What was done
Wrote the owner-facing operations runbook for the whole watchdog system at
`docs/runbooks/watchdog.md` (new `docs/runbooks/` directory — first runbook in the repo).
It documents watchdog.sh v0.4.0 exactly as shipped by GSL-52..56: component map, install
(render → **owner-executed** launchctl), three-level health check (launchd status → tick log
→ heartbeat freshness), how to read the ledger (per `tools/watchdog/LEDGER.md`), escalations
and the owner's response procedure, pause/uninstall, six troubleshooting cases, and an honest
limitations section. Written in Russian for the owner, plain language, every command
copy-pasteable with absolute or repo-relative paths.

### Problems solved
- **Real output, not imagined output.** Every safe command in the runbook was actually run:
  `install-watchdog.sh` in render-only mode into a scratch `.artifacts/` dir (output quoted
  verbatim), `smoke.sh` (52/52 pass — quoted), a synthetic `--dry-run` tick against a scratch
  state dir producing the real `DECISION=nudged` log line and the real `nudge` ledger JSON
  quoted in §3, the invalid-config exit-78 failure (quoted in §7.4), and the heartbeat
  freshness one-liners (`tail -1`, `stat -f %m` age arithmetic). `launchctl` was NEVER
  executed; `launchctl print` for a not-installed agent was run read-only to document its
  "Could not find service" answer as the expected pre-install response.
- **The launchctl boundary.** The PRD/GSL-52 invariant is that no script or agent installs
  anything — the runbook is where the actual `cp`/`bootstrap`/`kickstart`/`bootout` commands
  finally live, each marked «⚠️ выполняет ВЛАДЕЛЕЦ».
- **Pause without a pause feature.** v0.4.0 has no pause marker-file; instead of inventing
  one, §5 documents `launchctl bootout` as the pause mechanism, notes the marker's absence
  explicitly, and points at the `status:"quiesced"` heartbeat as the orchestrator-side
  "nothing to restart" state.
- **Escalation ≠ breakage.** §4/§7.3 frame budget exhaustion as the system's main safety
  feature working, give the diagnose-first procedure (log tail → ledger → reap snapshot →
  `tmux attach`), and only then the `restarts.history` reset — with a warning not to reset
  before understanding the cause.

### Problems remaining
The `.gitignore` tail requested with this task (`docs/handoff/.watchdog-*`) turned out to be
**already committed** by GSL-55 (48936de, verified with `git log -S`) — no change made, nothing
to do. F1-S1 live end-check remains open at the epic level; the runbook says so out loud (§8)
and instructs the owner to babysit the first real firing.

### Pitfalls & workarounds
- **A dry-run tick against a live install eats real markers/budget** (dry-run suppresses
  external actions but persists its own state — deliberate, for testable sequences). The
  runbook's diagnostic-tick recipe (§6) therefore ALWAYS overrides `WD_STATE_DIR`/`WD_LEDGER_FILE`
  to a scratch path, mirroring the NOTE in watchdog.conf.example.
- **No live heartbeat existed to demo against** (the current chain predates GSL-51 producers),
  so freshness commands were verified against a synthetic heartbeat in scratch; §2в documents
  what a missing file means instead of pretending one exists.

### What didn't make it
No changes to `tools/watchdog/` or `skill/` (docs-only task; the runbook documents as-is,
including v0.4.0's inline re-wake prompt). No install execution, no plist in
`~/Library/LaunchAgents`. No EN translation (owner-facing doc; code/comments stay EN).

---

## Part 2 — Technical reference

**Files changed:**
- `docs/runbooks/watchdog.md` — NEW (owner runbook, 8 sections: обзор/установка/проверка/
  ledger/эскалации/пауза/self-test/troubleshooting/ограничения).
- `docs/dev_history/GSL-57-phase-gsl49-runbook.md` + `README.md` index — this entry.
- `.gitignore` — NO change needed: `docs/handoff/.watchdog-*` already landed with GSL-55.

**Verified by running (all read-only / render-only / dry-run; zero launchctl):**
- `bash -n` on watchdog.sh, install-watchdog.sh, smoke.sh — clean.
- `tools/watchdog/install-watchdog.sh --out .artifacts/gsl57-tmp/...` — rendered, plutil-linted,
  printed instructions (quoted in runbook §1); scratch dir removed after.
- `tools/watchdog/smoke.sh` — 52 passed, 0 failed.
- Synthetic scratch ticks (`WD_TEST_MODE=1`, scratch `WD_STATE_DIR`/`WD_LEDGER_FILE`/heartbeat):
  `DECISION=ok`, `DECISION=nudged` + nudge ledger line, rate-limit line, exit-78 config failure —
  all quoted verbatim in the runbook.
- `launchctl print gui/$(id -u)/com.gosleep.watchdog` (read-only) → "Could not find service",
  documented as the expected not-installed answer.

**PRD acceptance (Phase 1, task 7):** covers `launchctl load` (bootstrap), проверка, деинсталляция
— §1/§2/§5; plus ledger reading, escalation response, troubleshooting, and the F1-S1 caveat the
PRD's end-check requires the owner to know about. macOS-sleep risk documented (§7.6) per the
phase's risk list.

**Links:** Jira [GSL-57](https://ainstance-labs.atlassian.net/browse/GSL-57) ·
GitHub [#65](https://github.com/ainstance-labs/gosleep/issues/65) · Epic
[GSL-49](https://ainstance-labs.atlassian.net/browse/GSL-49) / [#57](https://github.com/ainstance-labs/gosleep/issues/57)
