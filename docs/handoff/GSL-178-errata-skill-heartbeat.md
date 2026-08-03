# GSL-178 errata: "Heartbeat protocol" deltas for the GLOBAL orchestrating-delivery-agents skill

**Status:** prepared by impl-178 (shift 74). **Applied by the orchestrator or the owner** to
`~/.claude/skills/orchestrating-delivery-agents/SKILL.md` — the global copy is authoritative
(inversion 2026-07-20), agents are forbidden to edit it; the local `skill/` is not touched either
(it lags the global, and editing a lagging copy is dead letter). The fork is filed as question
q-2026-07-28-007, default applied.

**Verified:** the "Heartbeat protocol" section in the local and global copies is byte-identical
(diff empty, 2026-07-28), so every "old" fragment below is valid for both; before applying, verify
`grep -cF` = 1 on each fragment.

Sources of truth on the repository side that these deltas sync the skill to:
the header of `tools/lab/heartbeat.sh` (pulse schema), `tools/watchdog/watchdog.sh` v0.6.x,
`tools/watchdog/watchdog.conf.example` (semantics of context_pct and thresholds),
`tools/watchdog/LEDGER.md`.

---

## Replacement 1 — semantics of context_pct (GSL-217; one phrase, identical across all sources)

Old fragment (in the Required list, starts around line ~218):

```
`context_pct` (your HONEST estimate —
  the watchdog compares it to the roll ceiling; a fabricated number defeats roll-at-~70%)
```

New:

```
`context_pct` (your HONEST estimate of the share of the context window CONSUMED so far,
  0-100 — "how much is spent", never "how much remains"; it freezes when work freezes,
  which is what powers the watchdog's frozen-progress detector (GSL-213). The watchdog
  RECORDS it on every tick and — until GSL-182 lands a real harness signal instead of
  this self-estimate — enforces nothing on it)
```

## Replacement 2 — example format line (GSL-212: fields session / session_id)

Old fragment (line ~217):

```
`{"ts":"2026-07-10T03:14:07Z","cycle":12,"context_pct":41,"open_workers":2,"status":"ok","pane":"%4"}`
```

New (including `cli` from GSL-219):

```
`{"ts":"2026-07-10T03:14:07Z","cycle":12,"context_pct":41,"open_workers":2,"status":"ok","pane":"%4","session":"gosleep-21","session_id":"a716426f-…","cli":"2.1.220"}`
```

## Replacement 3 — session/session_id in the Required list (GSL-212)

Old fragment (end of the `pane` description, line ~224):

```
watchdog refuses to act on a live session and escalates to the owner instead). Optional:
```

New:

```
watchdog refuses to act on a live session and escalates to the owner instead) ·
  `session` + `session_id` (the Claude Code session NAME and sessionId UUID exactly as
  `claude agents --json` reports them — the watchdog's LIFE identity since GSL-212: life is
  judged against the platform roster, and a declared identity absent from it while other live
  sessions run in this repo freezes every action (session_mismatch). NEVER type these by
  hand — the writer below derives them) ·
  `cli` (the Claude Code CLI version this line was written under, GSL-219 — the writer
  resolves it from the harness itself; the watchdog turns a change between consecutive
  lines into a cli_version_changed ledger event, so a 03:00 breaking update is on the
  record instead of invisible). Optional:
```

## Replacement 4 — the manual-write snippet → the writer tools/lab/heartbeat.sh (GSL-212)

Old fragment (bash block, lines ~238-240):

```
  hb="docs/handoff/.orchestrator-heartbeat"
  line='{"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","cycle":12,"context_pct":41,"open_workers":2,"status":"ok","pane":"'"${TMUX_PANE:-}"'"}'
  { [ -f "$hb" ] && tail -n 199 "$hb"; printf '%s\n' "$line"; } > "$hb.tmp" && mv "$hb.tmp" "$hb"
```

New:

```
  # GSL-212: use the writer — it derives session/session_id from `claude agents --json`
  # by this process's own $CLAUDE_CODE_SESSION_ID (identity is never typed by hand),
  # validates the fields, truncates the note, and does the atomic tail-199 append:
  tools/lab/heartbeat.sh --cycle 12 --context-pct 41 --open-workers 2 --status ok
```

## Replacement 5 — the HEARTBEAT_OK item that reads the breaker= line (GSL-214)

Old fragment (table "Pulse / wake-up tick begins", line ~946; `grep -cF` = 1):

```
inbox / census / progress probe / queue (`lab-emit.sh list --due` + line-count vs census) / clocks — all green
```

New:

```
inbox / census / progress probe / queue (`lab-emit.sh list --due` + line-count vs census) / breaker (`tools/lab/breaker-check.sh` — the STATE `breaker=` line exists, parses, and is not OPEN; rc 2 = deliberate STOP, rc 1 = the line is missing/malformed/tripped-but-closed — fix the line, not the checklist) / clocks — all green
```

## Replacement 6 — the verifier watchdog gets an executable form (GSL-218)

Old fragment (section "Verification watchdog", line ~141; `grep -cF` = 1):

```
So arm an EXTERNAL watchdog: a background watcher polling the verifier's
```

New:

```
So arm an EXTERNAL watchdog — it exists as `tools/lab/verifier-watch.sh` (start it right
  after spawning the verifier: `tools/lab/verifier-watch.sh --file <run-dir>/steps.log &`;
  on a stall it exits loudly and mirrors `verifier.stalled` into docs/lab/events/): a
  background watcher polling the verifier's
```

---

Delta GSL-219 (field `cli`) is already included in replacements 2 and 3 above. The remaining epic
delta — GSL-214 (the HEARTBEAT_OK item reading the `breaker=` line from STATE) — will be added
below by its own task.

The companion errata for the sovereign `docs/handoff/ORCHESTRATION-STATE.md` (lines `cli=` and
`breaker=`) — a separate file `docs/handoff/GSL-178-errata-orchestration-state.md` after the
GSL-195 template; inserted by the orchestrator.
