# Watchdog ledger — format (GSL-55, PRD Phase 1 R1.5)

The watchdog's durable record of everything it did and why — the "no silently vanished work"
guarantee (warren reap; overstory `worker_died` mail). A re-woken orchestrator reads the tail
during cold-start (the re-wake prompt points here) and appends a `CORRECTION`/restart note to
`ORCHESTRATION-STATE.md`; the Phase-4 chronicler may index it into the timeline later.

## Location & discipline

- **Path:** `docs/handoff/.watchdog-ledger.jsonl` by default (`WD_LEDGER_FILE`) — beside the
  heartbeat and the STATE file. Runtime artifact: gitignore as `docs/handoff/.watchdog-*`,
  never commit.
- **Append-only JSONL.** One JSON object per line. The file is NEVER truncated or rewritten
  (unlike the self-truncating heartbeat). A correction is a NEW line — never an edit.
- Writer: `watchdog.sh` only (single-flight-locked, so no interleaved writes). The orchestrator
  and workers have their own channels (STATE, handoffs); they do not write here.

## Line schema

Common fields on every line:

| field | type | meaning |
|---|---|---|
| `ts` | string | UTC ISO-8601, when the event was recorded |
| `event` | string | one of the event types below |
| `mode` | string | `observe` \| `armed` (GSL-212) — which mode produced the line; observational history is filtered on `mode:"observe"` |
| `dry_run` | 0/1 | 1 = produced by a `--dry-run`/test tick; ignore for history |

Event types and their extra fields:

| event | extra fields | emitted when |
|---|---|---|
| `nudge` | `target` (pane id), `reason`, `hb_age` | stale heartbeat, live session → one send-keys nudge |
| `quota_wait_expired` | `eta` (ISO from the heartbeat note), `overdue_secs`, `grace_secs` | a quiesced quota-wait heartbeat's reset ETA is > `WD_QUOTA_GRACE_SECS` in the past (GSL-65 review M1) → the quiesced shield drops and the normal decision tree runs on the SAME tick; its events (`nudge`/`kill`/`orchestrator_restarted`/`mass_death`…) follow this line |
| `handoff_requested` | `target`, `context_pct`, `ceiling` | context_pct ≥ ceiling → "write handoff now" |
| `reap` | `role` (`orchestrator`\|`session`), `target` (pane id or `session`), `reason`, `branch`, `head` (short SHA), `snapshot` (path) | ALWAYS before a kill and before any restart — state collected first |
| `kill` | `target` (explicit pane id), `reason` | force-kill of the orchestrator pane (post-reap, existence-verified afterwards) |
| `kill_refused` | `target`, `reason` (`not_explicit_pane_id` \| `identity_unverified`), `identity` (on identity refusals: `no_field` \| `invalid_field` \| `not_found`) | kill/nudge target failed a safety check: not an explicit `%N` id, OR the live session's heartbeat does not positively name an existing orchestrator pane (review C1) — no action taken, escalation follows |
| `kill_failed` | `target`, `reason` (`kill_pane_rc_<n>` \| `pane_survived_kill` \| `test_injected_failure`) | kill-pane failed or the pane survived it (review M2) — NO re-wake (a surviving pane + a fresh orchestrator = double dispatch); escalation follows |
| `orchestrator_restarted` | `reason`, `hb_age`, `open_workers`, `cycle` | re-wake spawned via the cold-start protocol |
| `rewake_brief_missing` | `path`, `fallback` | warning: the re-wake brief template was missing/markerless; the inline fallback prompt was used |
| `worker_died` | `count`, `reason` (`whole_session_gone`\|`session_gone`), `observed` | recorded workers lost with the session (observed from heartbeat vs tmux — the watchdog kills only the orchestrator, never workers) |
| `mass_death` | `open_workers`, `reason` | whole session gone with ≥ `WD_MASS_DEATH_WORKERS` recorded workers → escalation instead of blind restart |
| `escalation` | `reason`, `restarts_in_window`, `budget`, `window_secs` | restart budget exhausted or mass death — owner must intervene (in `observe` mode the escalation is ledger-only: the owner is NOT pinged) |
| `tick` | `decision`, `reason`, `class`, `class_reason`, `hb_age`, `hb_status`, `cycle`, `context_pct`, `open_workers`, `platform`, `platform_status`, `platform_match`, `sessions`, `repo_sessions`, `tmux_alive`, `frozen`, `frozen_ticks`, `frozen_span` | EVERY tick, both modes (GSL-212/220): the decision and its full basis — the observational run is readable from these lines alone. `class` (GSL-215): healthy \| slow \| stuck \| dead \| shielded \| unknown, false-negative bias, matrix in docs/runbooks/watchdog.md |
| `would_nudge` | `target`, `reason`, `hb_age` | observe mode: a nudge would have been sent (nothing was) |
| `would_request_handoff` | `target`, `context_pct`, `ceiling` | observe mode: "write handoff now" would have been sent |
| `would_kill` | `target`, `reason` | observe mode: the pane would have been force-killed (post-reap, safety gates already passed) |
| `would_rewake` | `reason`, `hb_age`, `open_workers`, `cycle`, `prompt` | observe mode: a replacement orchestrator would have been spawned; `prompt` points at the exact brief it would have received |
| `platform_unavailable` | `tmux_alive` | the roster (`claude agents --json`) could not be read — fail safe, no action taken (GSL-212) |
| `progress_frozen` | `cycle`, `context_pct`, `ticks`, `span_secs`, `threshold_ticks`, `threshold_span` | GSL-213: `cycle` AND `context_pct` immobile for ≥ `WD_FROZEN_TICKS` consecutive fresh-ok ticks spanning ≥ `WD_FROZEN_MIN_SPAN_SECS` — "alive but useless" observed. RECORD-ONLY (feeds classification); emitted once per episode; the per-tick `tick` line carries `frozen=1` while it lasts |
| `progress_resumed` | `cycle`, `context_pct` (or `reason=run_broken_by_*`) | the frozen episode ended: counters moved, or the run was broken by staleness / a declared stand-down |
| `session_mismatch` | `hb_session`, `hb_session_id`, `repo_sessions`, `tmux_alive` | the heartbeat's declared session is absent from the roster while live session(s) run in this repo — every action refused, escalation follows (audit F2 cure) |

Example (a stale-after-nudge kill cycle, then recovery):

```json
{"ts":"2026-07-10T03:12:04Z","event":"nudge","target":"%4","reason":"stale_heartbeat","hb_age":1043,"dry_run":0}
{"ts":"2026-07-10T03:17:11Z","event":"reap","role":"orchestrator","target":"%4","reason":"stale_after_nudge","branch":"GSL-49-orchestrator-watchdog","head":"322cf30","snapshot":"/…/.artifacts/watchdog/reaps/1783948631-orchestrator.txt","dry_run":0}
{"ts":"2026-07-10T03:17:11Z","event":"kill","target":"%4","reason":"stale_after_nudge","dry_run":0}
{"ts":"2026-07-10T03:17:13Z","event":"orchestrator_restarted","reason":"stale_after_nudge","hb_age":1350,"open_workers":2,"cycle":12,"dry_run":0}
```

## Reap snapshots

Each `reap` line points at a plain-text snapshot in `WD_STATE_DIR/reaps/<epoch>-<role>.txt`
containing: the last 5 heartbeat lines · git branch, last 5 commits, dirty files (first 20) ·
tmux pane inventory of the session · the killed pane's last 60 captured lines. Everything a
post-mortem (or the replacement orchestrator) needs to confirm no committed work was lost —
the branch and `head` survive in the ledger line even if snapshots are cleaned.

## Ordering guarantee

Within one tick: `reap` is ALWAYS written before its `kill`, and `kill` before
`orchestrator_restarted`. Budget/cooldown gates run before reap — a deferred or
budget-escalated tick produces no reap and no kill, only `escalation`.
A `kill_failed` (or `kill_refused`) aborts the restart: no `kill`, no
`orchestrator_restarted` follow — only an `escalation`.
