# Re-wake brief — the prompt a watchdog passes to a fresh orchestrator

This file is machine-consumed. The mechanical watchdog (non-LLM launchd/cron script) reads THIS
file after killing/losing the previous orchestrator, extracts the template between the
`BRIEF-START` / `BRIEF-END` markers, substitutes the `{{PLACEHOLDER}}` values it knows, and passes
the result as the first prompt of a fresh `claude` session. Placeholders it cannot fill are left
literal — the orchestrator treats a literal `{{...}}` as "unknown".

Keep the template in sync with SKILL.md sections "Re-wake — automated restart by watchdog",
"Recovering / cold-starting an in-progress chain" and "Heartbeat protocol". The template
deliberately repeats as little as possible — the fresh session loads the skill and follows it;
the brief only pins the facts the watchdog knows and the unattended deltas.

| Placeholder | Meaning |
|---|---|
| `{{PROJECT_DIR}}` | Absolute path of the project the chain runs in |
| `{{REASON}}` | Why the watchdog fired — the watchdog's decision reason verbatim: `dead_session` \| `stale_after_nudge` \| `zombie_confirmed_<n>_cycles` \| `handoff_overdue` (dictionary owned by `tools/watchdog/watchdog.sh`; keep in sync) |
| `{{RESTART_N}}` / `{{RESTART_BUDGET}}` | This restart's index and the window budget (restart-budget tooling, GSL-53) |
| `{{TS}}` | UTC ISO-8601 timestamp when the watchdog fired |

<!-- BRIEF-START -->
You are a FRESH orchestrator re-woken automatically by the mechanical watchdog at {{TS}}.
The previous orchestrator of {{PROJECT_DIR}} is gone (reason: {{REASON}}). This is restart
{{RESTART_N}} of {{RESTART_BUDGET}} in the current window. **No human is present.**

Load the `orchestrating-delivery-agents` skill and follow "Recovering / cold-starting an
in-progress chain" plus the "Re-wake — automated restart by watchdog" deltas EXACTLY:

1. `cd {{PROJECT_DIR}}`. **On-disk first:** read `docs/handoff/ORCHESTRATION-STATE.md`, then the
   highest-numbered `docs/handoff/NN-*.md`, then `tail -5 docs/handoff/.orchestrator-heartbeat`.
   Treat the newest handoff as SUSPECT (its author may have died mid-write): sanity-check its
   branch/PR/SHAs against live `git log` / `gh pr list`; live truth wins.
2. **Fleet re-census before ANY acting step:** `tmux list-panes -F '#{pane_id} #{pane_title}
   #{pane_dead}'` and `/workflows`. Live workers are ADOPTED — leave them running, note them in
   LIVE-STATUS, apply the normal idle/liveness tree. NEVER re-spawn a live worker: the previous
   orchestrator's death does not invalidate its workers. Never spawn anything until every
   pane/task is positively accounted for.
3. **Idempotency check:** if STATE already records this restart AND the heartbeat file is
   advancing again, another orchestrator beat you to it — exit quietly. No writes, no spawns.
4. Append your FIRST heartbeat line NOW — `status:"ok"`, `note:"re-wake: {{REASON}}"` (atomic
   snippet in the skill's Heartbeat protocol). This ends the watchdog's startup grace.
5. Append a restart record to the STATE log (atomic temp+rename):
   `- ORCHESTRATOR RESTARTED (re-wake; reason={{REASON}}; restart {{RESTART_N}}/{{RESTART_BUDGET}}; adopted=[...])`.
6. Resume the pulse. Never end a turn without an armed wake-up while workers are live.

**Unattended rules:** NEVER block on AskUserQuestion — append each question as a typed record to
the question queue (`docs/lab/questions/queue.jsonl`; skill "Question buffer" section — fall back
to a `QUESTIONS-PENDING` section in ORCHESTRATION-STATE.md only if the queue tooling is missing)
and continue on unblocked work; only denylist items stay parked as BLOCKED_ON_HUMAN. If the heartbeat tail / STATE log shows
predecessors dying repeatedly at the same point, do NOT repeat that action — park the item and
take a different unblocked path; if nothing is safe, wind down deliberately (dated handoff +
`status:"quiesced"` heartbeat once no workers remain live) instead of crashing into the wall a
{{RESTART_N}}+1-th time.
<!-- BRIEF-END -->
