# GSL-26 — v2 SC-19: hard gate — never roll/handoff while a worker is alive

## Part 1 — Plain language

### What was done

Edited `skill/orchestrating-delivery-agents/SKILL.md` to add a HARD BLOCKING GATE preventing the
SC-19 anti-pattern: rolling over / starting a fresh orchestrator while a worker is still alive,
which orphans it.

Four concrete changes, all in the same file:

1. **Orchestrator self-monitoring section** — added a "HARD GATE" block immediately after the
   rolling description. States explicitly: "I'm low on context" does not override this rule.
   Explains what orphaning causes (orphan keeps running, may corrupt shared files, consume budget).
   Provides TWO concrete allowed sequences:
   - (A) Wait for COMPLETE `SendMessage` report → confirm terminated → THEN roll.
   - (B) Send `shutdown_request` → receive `approve:true` → confirm dead (pane gone / `TaskStop`
     success) → THEN roll.
   And an explicit "no roll now, deal later" prohibition plus `BLOCKED_ON_HUMAN` escalation path.

2. **Quick reference table** — added a row: "About to roll / compact / hand off to fresh
   orchestrator → HARD GATE: confirm EVERY worker TERMINATED first. Never roll with a live worker."

3. **Red flags — STOP** — added a bold entry quoting the rationalization: `"I'm low on context,
   I'll roll now."` with the hard block, correct sequences, and a verbatim example correct action:
   *"My context is at 73%. I have a live worker (cycle-13). I will wait for its COMPLETE report
   before rolling. I will NOT hand off yet."*

4. **Common mistakes** — added entry naming the anti-pattern and both valid sequences.

### Problems solved

SC-19 GREEN=0.0: the orchestrator rolled while cycle-13 was still alive and unterminated. The v1
skill text described a "clean boundary" but never said what "clean" meant precisely or what to do
when context pressure creates urgency. The "low on context" rationalization is compelling in the
moment — the fix is to name it explicitly as wrong, provide the correct sequences, and place the
gate prominently in all scannable sections.

### Problems remaining

None for this scenario specifically. The eval (GSL-29) will confirm.

### Pitfalls & workarounds

The self-monitoring section previously said "roll at a clean boundary (worker terminated, nothing
spawned)" — technically correct but buried in prose. The fix keeps the prose and adds a dedicated
HARD GATE block that an agent under pressure cannot miss.

### What didn't make it

Considered adding the gate to the Recovering section too, but the recover path is "after a crash"
(orchestrator already dead), not the "I'm about to roll" path. The gate is correctly placed in
self-monitoring; recovery is a separate scenario.

---

## Part 2 — Technical reference

**Commit:** this commit (GSL-26 v2 SC-19: hard gate — never roll/handoff while a worker is alive)

**Key files changed:**
- `skill/orchestrating-delivery-agents/SKILL.md` — self-monitoring section (HARD GATE block),
  Quick reference table (new rollover row), Red flags section, Common mistakes section.

**How verified:**
- Re-read all four changed locations — each names the anti-pattern, provides the correct sequences,
  and prohibits the "roll now" rationalization.
- `./install.sh` run after all four skill tasks are committed.
- `diff -r` confirms global copy identical to local.
