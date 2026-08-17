# GSL-241 — resolve duplicate docs/ paths (adjudicated)

Epic: GSL-236 (systems-audit process tail).
Branch: `GSL-236-systems-audit-process-tail`.
Source-of-truth: `docs/reviews/system-audit-2026-07-24/SYNTHESIS.md`,
findings 77 (MAJOR) + 83.

## Adjudication table

| Half of the audit finding | Status entering this task | What this task did |
|---|---|---|
| `docs/dev_history/` vs legacy `docs/dev-history/` (hyphen) | `docs/dev-history/` already DELETED by owner directive 2026-07-26 per CLAUDE.md "Delivery conventions" | SKIP the deletion (already done); fix the live stale references only |
| `docs/report/` vs `docs/reports/` | Both present on disk; `docs/report/` tree still cited by tracked historical files under `docs/dev_history/` and `docs/handoff/` | Take the softer path per Jira acceptance ("legacy оставить с явной пометкой «исторический, не пополняется»") — add a LEGACY marker; update the live indexes so no ACTIVE reader is directed there |

Evidence gathered on entry:

- `test -d docs/dev-history` → MISSING (confirmed the CLAUDE.md 2026-07-26
  note is accurate on-disk).
- `docs/report/` present with 17 HTML + generator files.
- Tracked references to `docs/report/` in live docs: `README.md` (root),
  `docs/dev_history/README.md` (indirectly via prose about legacy), plus
  many historical files under `docs/dev_history/GSL-2..GSL-91-*`,
  `docs/handoff/02..05, 23`, `docs/prd/PRD-gosleep-evolution.md`, and one
  legacy prompt under `docs/prompts/`. Historical files are point-in-time
  records and are NOT edited (per PRD-maintenance rule about historical
  documents).
- Tracked references to `docs/dev-history/` in live docs: `CLAUDE.md` (the
  intentional "do not recreate" note — CORRECT, kept), `README.md` (STALE —
  fixed), `docs/dev_history/README.md` (STALE — fixed). Plus historical
  files (not touched).

## What landed

- `docs/report/LEGACY.md` — new marker file: names the directory as
  FROZEN, points active readers at `docs/reports/**` (per-report layout),
  `docs/reports/verifications/**` (per-run layout, GSL-239 standard), and
  the live control-plane at `http://127.0.0.1:7331`. Explains why the tree
  is kept (historical citations from tracked dev_history / handoff files
  would break if deleted) and forbids new content ("if a shift finds itself
  wanting to edit a file here, the shift is on the wrong path"). Also
  cross-references the sibling deletion (`docs/dev-history/`) so the two
  halves of finding 77 are tied together.
- `README.md` (repo root) — path table rewritten:
  - `docs/reports/` promoted as **Active** (with a pointer to the
    verifications standard).
  - `docs/report/` demoted to **LEGACY (frozen; do not add to)** with a
    pointer to `LEGACY.md`.
  - Stale `docs/dev-history/` row REMOVED; replaced by a note under the
    table naming the 2026-07-26 owner deletion and the "do not recreate"
    rule.
  - Missing rows for `docs/lessons-learned/`, `docs/adr/`, and
    `docs/process/` ADDED — the wave-4b sibling epics landed those in this
    branch and the root README should list them alongside their siblings.
- `docs/dev_history/README.md` — the stale note about `docs/dev-history/`
  (hyphen) rewritten to say the tree was deleted 2026-07-26 and must not
  be recreated. Points to CLAUDE.md.

## What is NOT done

- **The legacy prompt at `docs/prompts/1-run-fresh-agent.md`** still says
  "легаси TLM-история — в docs/dev-history/ (через дефис), не трогать" — a
  warning about a directory that no longer exists. The prompt itself is
  legacy and not the active fresh-agent brief today; touching it would edit
  a point-in-time artefact. Left as-is; a fresh worker starting from that
  prompt gets a warning about nothing, which is confusing but not
  dangerous.
- **The tracked historical dev_history / handoff files that reference
  `docs/report/`** — point-in-time records, not edited.
- **The `docs/report/` tree contents** — kept intact per audit's soft path
  guidance; deletion would break historical citations.
