# GSL-203 — Errata for sovereign texts: the shift's standard gate no longer contains --no-poll

**Status: PREPARED, NOT APPLIED.** The sovereign carriers of the gate formula — worker briefs
(`docs/prompts/`) and `docs/handoff/ORCHESTRATION-STATE.md` — are edited only by the owner or the
shift orchestrator. This document is the exact replacement text, prepared by the epic GSL-176
executor for task GSL-203. The applier performs the replacement below wherever the briefs or STATE
dictate the gate formula, and nothing more.

## What happened and what was built

Audit finding 12 (MAJOR): the shift's standard gate lived in PROSE in the briefs and dictated
`bash tools/lab/chronicler.sh --no-poll` — the tracker cross-check was off by default, the tracker
was not polled for 11 days, 152 tasks out of 161 stood without a status while the gates were
green. GSL-223 already gave poll-fill a conventional feed
(`docs/lab/scratch/jira-poll.json`, an orchestrator dump on the cycle boundary), so polling in
the standard path is no longer blocked by anything.

Now the gate is code: **`tools/lab/gate.sh`** (one command = all four gates: smoke → hooks-verify
→ tsc → chronicler WITH polling; receipt `.artifacts/lab/gates/gate.json`). `--no-poll` remains
only behind an EXPLICIT offline mode: `gate.sh --offline` (and then the receipt and the verdict
directly say "these gates ran offline"). `--fast` — a between-commit warm-up (tsc+chronicler);
the full gate before a commit is mandatory.

## Replacement (gate formula in briefs and STATE)

Old block (in any writing, the essence — four commands with `--no-poll` on the chronicler):

```
bash tools/lab/smoke.sh                  # base N, FAIL=0
bash tools/lab/hooks-verify.sh           # M/M
(cd tools/lab/ui && npx tsc --noEmit)    # 0
bash tools/lab/chronicler.sh --no-poll   # 7 pages; or without --no-poll on a fresh dump
```

New block:

```
bash tools/lab/gate.sh                   # the standard gate as a whole: smoke (FAIL=0) + hooks-verify +
                                         # tsc (0) + chronicler WITH tracker polling (GSL-203).
                                         # Offline — only explicit: gate.sh --offline.
```

If the brief lists the gates separately (to explain baseline numbers) — replace the fourth line
with `bash tools/lab/chronicler.sh` WITHOUT `--no-poll`; remove the note "or without --no-poll on
a fresh dump" as obsolete: a fresh dump is now picked up always, and its absence is a loud
degradation in the report, not a reason to turn off polling.

## Why this is safe to apply

- poll-fill degrades loudly, does not fall: without the feed the Jira source is SKIPPED with a
  record in the report/status.json; git/gh branches always work. The gate does not redden from
  the dump's absence.
- Inside `tick.sh` the chronicler is still called with `--no-poll` — this is composition (step 1
  of the tick has just polled), not offline; in the tick's code this is explained by a comment.
- Smoke baseline at the moment of this errata: 545 (after GSL-198/199/200/201/202/203),
  hooks-verify 19.

## References

Jira GSL-203; GH #203; `tools/lab/gate.sh`; finding 12 — `docs/reviews/system-audit-2026-07-24/`
(SYNTHESIS, R1); the feed — GSL-223 (`docs/handoff/GSL-223-orchestrator-cycle-boundary-jira-dump.md`).
