# GSL-55 — Route-through-reap на kill + формат watchdog-ledger

**Epic:** GSL-49 — Watchdog над оркестратором (PRD Phase 1)
**Branch:** GSL-49-orchestrator-watchdog
**Phase:** GSL-49 — PRD Phase 1, requirement R1.5 (route-through-reap)

---

## Part 1 — Story

### What was done
The watchdog can no longer kill silently. Every restart now routes through a **reap**: before any
`kill-pane` (and before any restart at all) the watchdog collects the dying component's state —
last 5 heartbeat lines, git branch + last 5 commits + dirty files, the tmux pane inventory, and the
condemned pane's last 60 captured lines — into a plain-text snapshot, and writes a `reap` line to
the ledger carrying the branch and HEAD SHA. Only then does the kill fire. Sessions that die and
take recorded workers with them produce `worker_died` records (count + how it was observed), both
in the mass-death branch and in the ordinary dead-session branch. `LEDGER.md` now specifies the
full ledger format: location, append-only discipline, per-event schema, a worked example, and the
ordering guarantee (`reap → kill → orchestrator_restarted`; gates fire before reap). "No silently
vanished work" — warren reap + overstory `worker_died` mail, mechanized.

### Problems solved
- **What survives snapshot cleanup:** `.artifacts/` is scratch, so the reap ledger line itself
  carries `branch` + `head` — the committed-work-is-safe proof outlives the snapshot file.
- **Reap vs gates ordering:** budget and cooldown gates run BEFORE reap — a budget-escalated or
  cooldown-deferred tick performs no kill, so it must not fabricate a reap record either
  (smoke-asserted both ways).
- **Killed-without-a-pane restarts** (dead session): nothing to capture from tmux, but git
  snapshot + heartbeat tail are still reaped, so even a plain re-wake is never an unrecorded event.

### Problems remaining
`worker_died` is observational (heartbeat `open_workers` vs dead session) — the watchdog kills only
the orchestrator, never workers, and can't attribute per-worker identity from a count. Per-worker
attribution arrives with Phase 4 T1 hooks (`SubagentStop`/`TeammateIdle` events). The re-woken
orchestrator is TOLD (in the re-wake prompt) to append a CORRECTION/restart note to STATE from the
ledger tail — making that a hard skill-side rule is epic task «Cold-start как точка re-wake»
(PRD Phase 1 task 6), outside this tooling scope.

### Pitfalls & workarounds
- `grep -c` prints `0` AND exits 1 on zero matches — an `$(grep -c … || echo 0)` fallback
  silently becomes `"0\n0"` once the file exists. A GSL-53-era smoke assert tripped on this the
  moment GSL-55 started writing `worker_died` into a previously-empty ledger; rewritten to
  `! grep -q`.
- `capture-pane` is skipped in test mode (no real pane exists) — the snapshot notes the skip
  explicitly instead of writing an empty section, so a post-mortem can tell "nothing captured"
  from "capture skipped".

### What didn't make it
No writing into `ORCHESTRATION-STATE.md` from the watchdog — deliberate: the watchdog is non-LLM
and STATE is the orchestrator's document (C8); the ledger is the watchdog's own durable record and
the cold-start prompt bridges the two. No snapshot rotation/GC — snapshots are tiny text files in
gitignored scratch; revisit if they ever matter.

---

## Part 2 — Technical reference

**Files changed:**
- `tools/watchdog/watchdog.sh` — v0.4.0: `reap()` (snapshot to `WD_STATE_DIR/reaps/<epoch>-<role>.txt`
  + `reap` ledger line with `role/target/reason/branch/head/snapshot`), wired into `do_restart`
  after budget+cooldown gates (kill path reaps the pane; kill-less restart reaps git+heartbeat);
  `worker_died` emission in mass-death (`count`, `observed=heartbeat_vs_tmux`) and dead-session
  (`observed=heartbeat_recorded`) branches; mass-death also reaps the session.
- `tools/watchdog/LEDGER.md` — NEW: format spec (location, append-only, common fields, 9 event
  types with schemas, example cycle, reap-snapshot contents, ordering guarantee).
- `tools/watchdog/smoke.sh` — 6 new asserts + `grep -c` assert fix.
- `.gitignore` — `docs/handoff/.watchdog-*` (ledger + any future watchdog runtime files beside the
  heartbeat; flagged at GSL-52, path clearance granted by the team-lead for this commit).

**Ledger events (full set):** `nudge · handoff_requested · reap · kill · kill_refused ·
orchestrator_restarted · worker_died · mass_death · escalation` — all with `ts/event/dry_run`.

**Verified by running** `bash tools/watchdog/smoke.sh` → 52/52 PASS, incl.:
- ledger line order `reap < kill < orchestrator_restarted` in the stale-after-nudge cycle;
- snapshot exists with heartbeat-tail + git-snapshot sections; reap line carries real
  `branch`/`head` of this repo;
- dead session → `worker_died(count=1)` + reap before restart; mass death → `worker_died(count=2)`;
- NO reap on budget-escalated or cooldown-deferred ticks.
- `bash -n` all three scripts; shellcheck unavailable on this box.

**PRD acceptance (R1.5):** перед kill собрано закоммиченное (branch+HEAD в ledger, снапшот на
диске) ✓; `worker_died`/`orchestrator_restarted` пишутся в ledger ✓; «запись о смерти в
STATE/таймлайне» — ledger = таймлайн-запись; перенос в STATE выполняет re-woken оркестратор по
re-wake prompt (жёсткое правило в скилле — задача 6 эпика); закоммиченная ветка не теряется —
kill не трогает git, а её имя/SHA зафиксированы до kill ✓.

**Links:** Jira [GSL-55](https://ainstance-labs.atlassian.net/browse/GSL-55) ·
GitHub [#63](https://github.com/ainstance-labs/gosleep/issues/63) · Epic
[GSL-49](https://ainstance-labs.atlassian.net/browse/GSL-49) / [#57](https://github.com/ainstance-labs/gosleep/issues/57)
