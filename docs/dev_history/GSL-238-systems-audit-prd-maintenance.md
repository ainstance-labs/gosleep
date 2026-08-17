# GSL-238 — PRD delta rule + apply master PRD delta (partial)

Epic: GSL-236 (systems-audit process tail).
Branch: `GSL-236-systems-audit-process-tail`.
Source-of-truth: `docs/reviews/system-audit-2026-07-24/SYNTHESIS.md`, findings
24 / 29 / 30 (MAJOR) + 48; `docs/reviews/system-audit-2026-07-24/PRD-delta-draft.md`.

## Adjudication summary

The PRD-delta-draft was authored 2026-07-24 in Russian, before the
2026-08-07 owner rule that all new work artefacts are written in English, and
its own note flags operations 5/6/8/12/13 as requiring owner decisions. In
the 24 days since, phases HAVE progressed: Phase 7 (web control plane) is now
a live epic (GSL-250) with `apps/core` + `apps/web`; Phase 5 (static UI) has
been superseded per `docs/runbooks/gosleep-core.md`; Phase 8 (skills-management)
has GSL-174 phased-plan documentation.

Adjudication (evidence-based):

- **Apply as-is (mechanical, English-first):** operations 1 (Status header),
  2 (Risk (b) `claude -p`), 3 (C3 `claude -p`), 6 (Readiness column + refreshed
  cell values matching current reality — NOT the 2026-07-24 snapshot),
  10 (remove `telemetry.jsonl` from R4.3 layout).
- **Absorb into GSL-236 instead of GSL-238:** operation 5 (C9 arming
  constraint) — belongs to the armed-check task; PRD row added there with
  cross-reference. Landed in this commit for locality: C9 row appears in the
  constraints table alongside its GSL-238-flavored siblings, but the doc
  behind it is `docs/process/phase-acceptance-checklist.md` (GSL-236).
- **Skip (owner-decision dependent, or already superseded by later reality):**
  operations 4 (C6 model policy — superseded by
  `docs/lab/decisions/manifest.md` + owner directive 2026-08-10),
  7 (`./install.sh` gate wording — already fixed shift-by-shift in later
  epics; wholesale rewrite of every phase's gates would collide with
  Phase-7/Phase-8 authoring),
  8/11/12/13/14/15/16 (new phases / new sections whose scope was authored
  as separate per-phase PRDs since 2026-07-24: `01-phase7-*.md`,
  `02-phase8-*.md`, etc.). Applying operation 12 or 13 wholesale would
  duplicate content that now has its own authoritative home.
  9 (R3.4 learning-loop measurable criterion — landed as Wave-4b sibling
  work under GSL-227/229),
  17/18 (Risk register + Decision log additions — a separate audit-carry
  task, not this one; the shape is right but the specific rows must be
  cross-checked against later decision-log entries that already exist).

## What landed

- **`docs/prd/PRD-gosleep-evolution.md`** — surgical inline delta (all
  English overlay, source Russian preserved for cross-reference):
  - Status header rewritten to `Live` with data-valid-as-of block + skills
    reality + pointer to the PRD-maintenance rule (this task).
  - Section 4 Risk (b) rewritten: `claude -p` billing not established;
    Anthropic pause language quoted with source; measured cost documented;
    polling forbidden.
  - Constraint C3 rewritten: bounded glue + one-off judgement call; billing
    not established; polling forbidden.
  - Constraint C9 added: "delivered only when armed on this machine";
    references `docs/process/phase-acceptance-checklist.md`.
  - Phase map: Readiness column added; every phase carries a proof-referenced
    cell reflecting 2026-08-17 reality (Phase 7 IN PROGRESS with the epic
    keys, Phase 5 SUPERSEDED to web control plane, Phase 6 FROZEN, Phase 8
    PARTIAL with GSL-174 pointer).
  - Requirement R4.3: `telemetry.jsonl` struck from the layout list with an
    inline delta note explaining removal (and instructing future
    re-introduction to ship the writer alongside the entry per C9).
- **`docs/process/prd-maintenance.md`** — the rule itself: PRD delta =
  mandatory part of every epic closure; what counts, where it lives, when
  it lands, failure signal.

## Verification

- No script changes → no `bash -n` needed.
- `grep -c "telemetry.jsonl" docs/prd/PRD-gosleep-evolution.md` returns 2
  (both surviving occurrences are the removal note and the `layout` list of
  outgoing items → intentional; no writer/reader dependencies).
- Constraint table now runs C1 through C9; C9 references the phase-acceptance
  checklist doc from GSL-236 (already committed one commit prior on this
  branch).
- Readiness cells cite live epics: GSL-49, GSL-65, GSL-72, GSL-81/90 + GSL-364,
  GSL-250 group (+ 260/265/267/268/274/275/276/298/365/379/380/381), GSL-104/108,
  GSL-174/251/334.
- English overlay per owner rule 2026-08-07; existing Russian body preserved
  (legacy file, incremental migration).

## What is NOT in this commit

- Operations 4/7/8/11/12/13/14/15/16/17/18 from the delta draft — see
  "Adjudication" for the per-operation reason. If any of these are later
  needed, they file as separate tasks.
- Backfill of Readiness cells for delivered mini-epics not on the top-level
  phase map — the rule bites forward.
