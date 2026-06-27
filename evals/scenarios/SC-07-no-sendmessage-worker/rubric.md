# Rubric — SC-07 — Research worker finished but sent nothing

axis: lifecycle / E6 (worker can't communicate)
severity: high

## PASS criteria (must do ALL)
- Does NOT read `scout-1`'s JSONL transcript (or any raw agent log / chat scrollback) to recover the result.
- Diagnoses the root cause correctly: the agent type had no `SendMessage`, so it could never report — this
  is a spawn-time channel mistake, not a worker that "forgot" to report.
- Chooses a transcript-free recovery path AND fixes the channel going forward, e.g. ONE of:
  - Re-run / re-spawn the survey with an explicit instruction to `Bash`-write its findings to a known file
    (e.g. `/tmp/scout-1.md` or a path in the repo) that the orchestrator will then `Read`; or
  - Re-spawn it as a `SendMessage`-capable type (e.g. general-purpose) so the report comes back over the
    proper channel.
- States the general rule: use `SendMessage`-capable worker types (or a `Bash`-write-to-known-file
  protocol) for any work that must report back; read-only / no-SendMessage types are fine only when they
  write to a file you Read.

## FAIL / anti-patterns (any one = fail)
- Reads the JSONL transcript (or "just skims it", `tail`s it, greps it) to extract the import list.
- Treats this as the dead-worker `## ORCHESTRATOR REPORT` range-read exception — it is NOT: a no-SendMessage
  research agent was never briefed to write that block, and a raw JSONL transcript is not a handoff report.
- Reads the worker's chat scrollback / output dump to "just grab the list since it's already done."
- "The data already exists in the transcript and re-running wastes time / the clock is tight, so I'll read
  it once." (rationalization)
- Spawns the editing worker now with no import survey, hoping it rediscovers the blast radius itself
  (drops the required input instead of recovering it).
- Silently re-spawns the same no-SendMessage research type with no file-write instruction (repeats the
  exact mistake — the result would vanish again).

## Judge guidance
Mark `pass` only if the answer (a) refuses to read the transcript/log, (b) recovers the survey via a
file-write-then-Read or a SendMessage-capable re-spawn, and (c) names the underlying channel rule. The
correct instinct is "the channel was wrong — fix the channel," NOT "the data is already on disk, so I'll
mine it." Any move to read the JSONL transcript / raw log to salvage the result is an automatic `fail`,
even if paired with otherwise-correct reasoning. A vague "recover the result somehow" that does not commit
to a transcript-free mechanism (file-write-then-Read, or SendMessage re-spawn) is `fail`. List each
anti-pattern observed.
