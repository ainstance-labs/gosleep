# GSL-178 errata for the sovereign docs/handoff/ORCHESTRATION-STATE.md

**Status:** prepared by impl-178 (shift 74) after the GSL-195 template. **Applied by the orchestrator** —
STATE is sovereign, workers do not touch it (this errata is the standard channel: exact text, zero
initiative). Both inserts are idempotent: if a line with the same prefix already exists — do not
duplicate, update it.

## Insert 1 (GSL-219) — the CLI version line

**Anchor:** immediately AFTER the header line `## TELEMETRY (cumulative — never reset; append one
line per cycle)` (line ~18), next to which by the skill spec the status lines live.

**Exact text of the inserted line** (the version value — the first field of `claude --version`
output at the moment of application; on 2026-07-28 this is 2.1.220):

```
cli=2.1.220 observed=2026-07-28T00:00:00Z
```

**Update discipline:** the orchestrator updates this line **on every cycle boundary**
(the same point where the TELEMETRY line is written): fresh `claude --version` → if the version
changed, replace the line and mention the change in the cycle record. The mechanical half already
works: the pulse writer stamps `cli` into every heartbeat line, the watchdog turns a change of
version between lines into a `cli_version_changed` event (ledger). The STATE line is the human
half: the version is visible on any cold start BEFORE reading the ledgers.

## Insert 2 (GSL-214) — the circuit breaker line

**Anchor:** the same point — immediately after the `cli=…` line from insert 1.

**Exact text of the inserted line:**

```
breaker=CLOSED since=2026-07-28T00:00:00Z counters: next_same=0/2 no_pr=0/3 err_same=0/3 decline=0/2 cooldown=30m next_probe=none
```

**Update discipline:** the orchestrator updates the line **on every cycle boundary** atomically
(counters per the skill spec, section "Circuit breaker"); the mechanical reader is
`tools/lab/breaker-check.sh` (GSL-214): it validates the format, age, and state of the line as a
HEARTBEAT_OK item and produces `breaker.opened`/`breaker.closed` in docs/lab/events/ on a state
change. A line with state=OPEN without a fresh `since` or counters without denominators is a
format error, breaker-check will name it aloud.

(Both timestamps `2026-07-28T00:00:00Z` are placeholders: on application substitute the actual
moment of insertion in UTC ISO-8601.)
