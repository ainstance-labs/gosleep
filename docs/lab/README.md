# docs/lab — the machine-first laboratory layer

Data the orchestration chain writes for itself and the owner: typed question records, autonomous
decisions, morning digests. Introduced by PRD Phase 3 (epic GSL-72); Phase 4 mechanizes it
(events, chronicler, status.json, site) — layout blueprint: `docs/research/2026-07-07-orchestration/
05-lab-ui-mobile-autonomy.md` §3.3.

```
docs/lab/
  questions/queue.jsonl     # typed question buffer — append-only + patch records (GSL-75)
  decisions/manifest.md     # owner-sovereign decision manifest — the ONLY hand-edited file here (GSL-76)
  decisions/log.jsonl       # every autonomous decision / owner answer, append-only (GSL-77)
  digest/                   # morning digests YYYY-MM-DD-morning.md (GSL-78)
```

Rules (C8):
- **ORCHESTRATION-STATE.md + handoffs stay authoritative.** Everything here is either owner input
  (manifest) or derived/append-only records; on conflict, STATE + live git win.
- **Append-only JSONL is never rewritten** — corrections/status changes are new records
  (`{"re": <id>, ...}` patches). Non-append files are written atomically (same-dir temp + rename).
- **Live project data, committed** — like STATE and handoffs, these files are committed at ledger
  boundaries (they are the owner's phone-readable/answerable surface), never gitignored.
- Writes go through `tools/lab/lab-emit.sh` — never hand-append concurrently.
