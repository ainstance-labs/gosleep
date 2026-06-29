# GSL-27 — v2 SC-12: concrete TELEMETRY-in-STATE append step + example line

## Part 1 — Plain language

### What was done

Edited `skill/orchestrating-delivery-agents/SKILL.md` to make telemetry instrumentation a concrete,
mandatory, do-this-now step rather than an abstract principle.

Four concrete changes, all in the same file:

1. **STATE file section — TELEMETRY block description** — added a "MANDATORY STEP" block immediately
   after the TELEMETRY block description. States: after EVERY worker terminates, APPEND one structured
   line in EXACTLY this format:
   ```
   cycle=N worker=<name> model=<model> tokens_out=<N> tokens_in=<N> cache_read=<N> | running: cycles=N total_tokens=T
   ```
   Includes a verbatim example:
   ```
   cycle=13 worker=cycle-13 model=claude-sonnet-4-5 tokens_out=4821 tokens_in=12340 cache_read=58200 | running: cycles=13 total_tokens=421000
   ```
   Explicitly forbids "I'll tally later" and covers the partial case (worker didn't report tokens →
   write `tokens_out=unknown`).

2. **Cost & runaway control section** — replaced the abstract "tally each worker's TELEMETRY into
   the state file" with a concrete forward reference: "after EVERY worker terminates, APPEND one
   telemetry line … do this BEFORE spawning the next cycle; never defer."

3. **Quick reference table** — added a row: "Worker just terminated → APPEND telemetry line NOW
   (before spawning next cycle)" with the format inline.

4. **Common mistakes** — added entry: "Skipping the telemetry append after a worker terminates"
   naming the rationalization ("I'll tally it later") and repeating the format.

### Problems solved

SC-12 GREEN=0.25: agents do not instrument telemetry because the v1 skill described it abstractly
("tally tokens"). There was no step that said "do it NOW, in this format, before doing anything
else." The fix promotes telemetry from a background principle to a concrete checkpoint with a
mandatory format string and a verbatim example, placed in every scannable section.

### Problems remaining

None for this scenario specifically. The eval (GSL-29) will confirm.

### Pitfalls & workarounds

The format string uses pipe characters, which need escaping in Markdown table cells (used `\|`
in the Quick reference table row to avoid breaking the table). The STATE file section and Common
mistakes use fenced code blocks where pipes render fine.

### What didn't make it

A separate "TELEMETRY checklist" subsection was considered but would fragment the skill. The
mandatory step is correctly placed inside the TELEMETRY block description where an orchestrator
setting up STATE will read it.

---

## Part 2 — Technical reference

**Commit:** this commit (GSL-27 v2 SC-12: concrete TELEMETRY-in-STATE append step + example line)

**Key files changed:**
- `skill/orchestrating-delivery-agents/SKILL.md` — STATE file section (TELEMETRY block +
  MANDATORY STEP), Cost & runaway control section, Quick reference table (new row), Common mistakes.

**How verified:**
- Re-read all four changed locations — each provides the concrete format, the verbatim example,
  and the "do this BEFORE spawning next cycle" mandate.
- `./install.sh` run after all four skill tasks are committed.
- `diff -r` confirms global copy identical to local.
