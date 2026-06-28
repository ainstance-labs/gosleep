---
name: writing-prds
description: Use when turning a product idea, an initial prompt (dictated in chat or read from any file the owner names), or new owner wishes into a phase-structured PRD, or when evolving existing PRDs because scope grew or changed. Triggers - "write a PRD", "spec out this product", "turn this prompt into requirements", "we need a PRD for phase X", "add this to the product spec", "the requirements changed". Not for implementation planning, writing code, or creating Jira/GitHub artifacts.
---

# Writing PRDs

## Overview

A PRD here is **the durable contract for WHAT a product (or one phase of it) must do and HOW we
know it is done** — written so a delivery team picks it up later with zero memory of the
conversation that produced it. It lives in `docs/prd/`, sits downstream of architecture
(`docs/plan/`, `docs/adr/`), and never contradicts them. It is a document only: it lists
commit-sized tasks but creates no Jira or GitHub issues (the delivery process does that when a
phase starts).

**The one failure this skill exists to prevent: requirements get lost BETWEEN documents, not
inside them.** A real case (tasty-lunch, 2026): the initial prompt demanded a full product UI, the
PRD kept it, the roadmap silently dropped the page-assembly phase, and executors reinterpreted
"surfaces render, verified by running the app" as DTO integration tests — a finished backend
shipped with two placeholder pages. Nobody removed the requirement; it fell through a seam. Four
defenses, all mandatory below:

- (a) a **traceability matrix** — a per-phase slice in each PRD file, the **global map in
  `docs/prd/README.md`** — tying every source requirement to a phase and its acceptance criteria;
- (b) acceptance criteria **verifiable by running the product from the user's seat** — never
  "tests green";
- (c) a **mandatory adversarial skeptic pass** that re-reads the source prompt(s) hunting for
  anything dropped, watered down, or reinterpreted;
- (d) **every wish becomes a durable source file** — a wish that lives only in chat cannot be
  re-checked later.

## When to use

- An initial prompt — dictated right in the chat, or in ANY file/location the owner points at
  (never assume a particular folder; the source location is the owner's choice) — needs to become
  requirements — **CREATE mode**.
- New wishes arrive for a product that already has PRDs — in a prompt file or just in chat —
  **EVOLVE mode**.

Do NOT use for: a quick chat answer (just answer), planning the *implementation* of an
already-specified phase (that is the delivery/plan step), or anything that writes code.

## Two modes

**CREATE** — new product or initiative. Split it into phases where **1 phase = 1 epic = 1 PRD
file**. A product can be 10+ phases. Each phase is independently shippable and ordered so the
owner sees real value early: a thin vertical slice that runs end-to-end beats a horizontal layer
that does nothing until the last phase.

**EVOLVE** — new wishes for an existing product. First, **make the source durable**: if a wish
arrived in chat/dictation (an ephemeral source), capture it verbatim (owner's words, dated) in a
"Source requirements (verbatim)" appendix of the PRD file it drives — the PRD carries its own
source, so the skeptic pass and every future run can re-read it with no dependency on any
particular folder. (If the owner already keeps prompts in files, just reference that path AND
copy the relevant text into the appendix.) Then route each wish, checking in this order:

1. **Contradicts an existing PRD decision, plan, or ADR?** Surface the conflict to the owner in
   the clarify step (one batched question: keep the old decision, adopt the new wish, or merge —
   lead with your recommendation). On adopt/merge: edit the canon in place to ONE consistent story
   and add a `Supersedes:` note naming what changed and the source wish. Never keep both versions;
   never layer a contradicting note on an outdated doc. If the contradicted phase already shipped,
   the wish becomes a new phase that explicitly reverses or reworks it.
2. **Fits within an existing phase's scope?** Edit that PRD file in place; record it in the file's
   Decision log.
3. **Net-new scope?** Add a new phase file (next number), with an `Extends:` note where it builds
   on an earlier decision.

After routing, update the global matrix in `docs/prd/README.md` — every requirement of the new
source file gets a destination or an explicit deferral with a reason.

## Process (run in order)

1. **Orient (read, never assume).** Read the source prompt(s) and every existing `docs/prd/*`,
   relevant `docs/plan/*`, `docs/adr/*`, and `docs/dev_history/*`. Grep the codebase to ground
   claims; cite `path:line` where it sharpens a requirement. **If the code contradicts an existing
   PRD**, flag the drift before writing anything: either the PRD is stale (update it in place with
   a `Supersedes:` note) or the code is wrong (record it as a gap in Risks) — never write new
   requirements on top of unverified canon.
2. **Clarify (only real ambiguity).** When the prompt is genuinely ambiguous on something that
   changes the PRD, ask the owner **2-3 batched questions** via `AskUserQuestion` BEFORE writing —
   lead each with a recommended option; include any conflict surfaced by EVOLVE routing rule 1.
   Interrogate what matters: who is affected; current behavior vs target (quantified — "X becomes
   Y", never "improve X"); why now; what is out of scope FIRST; the smallest version that delivers
   the value; failure modes. Never ask what you can answer by reading the code. Do not interrogate
   when sensible defaults exist — pick, state, move on. If `AskUserQuestion` is unavailable, write
   the decisions you assumed into a dedicated **Assumptions** section instead of guessing
   silently. Record answers in the PRD's Decision log.
3. **Decompose into phases.** Derive phases from the work, not a template — vertical,
   independently shippable slices ordered by dependency and earliest owner-visible value; never
   horizontal layers ("Phase 1 = all models, Phase 2 = all APIs" ships nothing until the end and
   hides dropped work). For each phase, derive success goal-backward: **"what must be TRUE for the
   user when this phase completes?"** — 2-5 observable truths ("the chef builds a menu and sees it
   on the calendar"), not tasks ("build menu API").
4. **Write the file(s)** using the per-file structure below. One file per phase. For very large
   initiatives (10+ phases), write files in phase order and update the global matrix after each
   file, so an interrupted run resumes cleanly.
5. **Build the traceability matrices.** Walk every requirement in every source prompt; map each to
   a phase and to that phase's requirement IDs and acceptance criteria. The per-phase slice lives
   in the phase file; the **global source-to-phase matrix lives in `docs/prd/README.md`**. Any
   source requirement with no destination is an orphan — assign it or record an explicit deferral
   with a reason. Never finish with hidden orphans.
6. **One adversarial skeptic pass (mandatory).** Spawn exactly ONE cheap subagent (model `sonnet`,
   inline instructions, no skill calls) whose only job is to REFUTE: "Re-read the source
   prompt(s). What did they ask for that this PRD misses, drops, waters down, or reinterprets into
   something weaker? Where could a requirement be read two ways? Where is an acceptance criterion
   satisfiable without the user-visible thing actually working?" It returns Status (Approved |
   Issues Found) + a list of `[location]: gap — why it matters`. Only if the Agent tool is
   genuinely unavailable in this session may you run the same refute checklist yourself with fresh
   eyes — and you must say so in the report.
7. **Fix the gaps** it found, inline.
8. **Update the index.** Keep `docs/prd/README.md` current: one row per PRD (phase, slug, status,
   one-line summary) plus the global traceability matrix.
9. **Report** with a coverage summary: files written, phases, source requirements mapped vs
   deferred, skeptic verdict, and a one-line confidence call per phase (high/medium/low + why).

## Files and naming (new PRDs only)

- Path: `docs/prd/<NN>-phase<X>-<slug>.md` — `NN` is the next free number in the directory; `X` is
  the phase number; slug is short and kebab-case. Example: `02-phase10-billing-live.md`.
- Multi-phase output = one file per phase + keep `docs/prd/README.md` in sync.
- **Never rename a pre-existing PRD.** In EVOLVE mode, edit in place or add the next-numbered file.

## Per-file structure

Open with a one-line **Status banner**: `Draft | Approved for build | In delivery | Shipped |
Superseded by <file>`, plus the date. Then two halves, plain words first (mirrors the handoff
convention):

1. **Part 1 - Plain words.** Five short human sections, like explaining the phase to a teammate
   over coffee — no jargon walls, no tables: (1) What this phase is; (2) Why now; (3) What "done"
   looks like; (4) Risks; (5) Open decisions. A reader gets oriented in 30 seconds.
2. **Goals / Non-goals / Success criteria.** Goals as a short list; Non-goals as a table with a
   "why excluded" column (prevents creep and gives future phases something to point back to);
   then the phase's 2-5 goal-backward success criteria — observable user-truths from process
   step 3.
3. **Requirements / surfaces.** Each requirement gets: a short label + ID; a description;
   design/source references (prototype files, ADRs, existing use-cases — cite `path:line`);
   integration points (what backend/modules it wires to); and acceptance in the Current / Target /
   Acceptance shape — Current = what exists today, Target = "X becomes Y" (not "improve X"),
   Acceptance = a falsifiable pass/fail check per the acceptance rules below.
4. **Traceability matrix (this phase's slice).** A table: source requirement (file + line, or
   dated wish file) → this phase's requirement IDs → acceptance criteria. It must be complete —
   this is the seam-guard.
5. **Risks and remediations.** Known gaps/risks with evidence (cite code where audit-confirmed),
   severity, and whether handled this phase or deferred (with a reason).
6. **Delivery plan.** A list of **commit-sized tasks** (one commit each), task names starting with
   `[Tag][Tag]` markers; reference issue keys in UPPERCASE when they exist. List exact target
   files/modules so the delivery process can pick them up. Add a short sequencing paragraph (what
   unblocks what; the critical-path spine; designated trailing/cuttable tasks). **Create no Jira
   or GitHub issues here.**
7. **Quality gates + end-check.** The mechanical gates every commit must pass (types, lint, tests,
   build, project-specific checks), surface acceptance verified in the running app (not by an
   in-process harness), and ONE user-visible **end-check** that proves the phase is real (e.g.
   "the production deploy serves the real page; the placeholder copy no longer exists anywhere in
   the deployed app").
8. **Decision log.** Dated rows: source (prompt file / dated wish file / clarify answer) →
   decision → what it superseded, if anything. EVOLVE edits append here, so in-place editing keeps
   an audit trail while the file stays one consistent story.

Plain English throughout. NEVER use the section glyph character — write the word "section".

## Acceptance criteria that can't be gamed (the canonical rules)

The founding failure was an acceptance criterion ("verified by running the app") satisfied by DTO
tests. Defend against it:

- Phrase every criterion as something a person **observes in the running product**: a page
  renders, a button does the thing, the deployed URL shows real data. "Tests pass" is a gate, not
  an acceptance criterion.
- Each criterion resolves to PASS or FAIL. Ban "should feel good", "looks reasonable", "generally
  works" — those are not criteria.
- No placeholders, ever: "TBD", "handle edge cases", "improve performance" are PRD failures —
  quantify, pick a target, make it falsifiable.
- For UI, require the visible result in light and dark and at realistic widths if that matters.

## Scope boundary (hard rule)

The PRD is a **document**. It does not create epics, tasks, issues, or branches — the team's
delivery process does that when a phase actually starts. The delivery-plan section LISTS
commit-sized tasks so that process has something to pick up; it stops there.

## Quick reference

| Need | Do |
|---|---|
| New product | CREATE mode: decompose into vertical phases, one PRD file per phase (`<NN>-phase<X>-<slug>.md`) |
| Wish arrived in chat | Capture it verbatim in the target PRD's Source appendix FIRST, then evolve |
| Wish fits a phase | EVOLVE: edit that PRD in place + Decision log entry |
| Wish is new scope | EVOLVE: next-numbered phase file + `Extends:` note |
| Wish contradicts canon | Surface in the clarify questions; on adopt, edit canon in place + `Supersedes:` note — never keep both |
| Code contradicts a PRD | Flag drift in Orient: stale PRD → update in place; wrong code → Risks entry |
| Stop requirements leaking | Per-phase matrix in each file + global matrix in `docs/prd/README.md`; no hidden orphans |
| Prove a surface is done | Run-the-product acceptance criteria, plus one user-visible end-check |
| Phase success | 2-5 goal-backward observable truths: "what must be TRUE for the user" |
| Before finishing | ONE `sonnet` skeptic re-reads the SOURCE prompt(s) and refutes; fix every real gap |
| Ambiguous prompt | 2-3 batched `AskUserQuestion`s before writing; else an explicit Assumptions section |
| Index | Keep `docs/prd/README.md` current: rows (phase, slug, status, one-liner) + global matrix |
| Tasks | List commit-sized `[Tag][Tag]` tasks; create NO Jira/GitHub artifacts |
| Never | Rename existing PRDs; contradict the plan/ADRs; use the section glyph |

## Common mistakes

- **No traceability matrix, or a per-file matrix only.** Requirements fall through the seams
  between documents — exactly how the UI got dropped. The global matrix in `docs/prd/README.md` is
  what survives across sessions; keep it current.
- **Evolving from a chat wish without persisting it.** The skeptic cannot re-read a source that
  only existed in conversation, so the wish will dilute unnoticed. Capture it verbatim in the
  PRD's Source appendix first.
- **Acceptance criteria that compile instead of run.** "DTO test passes" is not "the page
  renders". Criteria a human confirms in the running product, plus the end-check.
- **Skipping the skeptic pass.** "I already re-read the prompt myself" is the rationalization that
  shipped placeholder pages. The refute pass is mandatory, not optional polish.
- **Silently resolving a conflict.** A wish that contradicts canon is an owner decision — surface
  it in the clarify questions; then edit to ONE consistent story with a `Supersedes:` note.
- **Writing from memory.** Read the prompt(s), the existing PRDs, the plan, the ADRs, the dev
  history, and the code first. A PRD built on recollection contradicts the canon.
- **Horizontal phases.** "All models, then all APIs, then all UI" ships nothing until the end and
  hides dropped work. Vertical, independently shippable slices, value early.
- **Creating Jira/GitHub artifacts.** Out of scope — list commit-sized tasks and stop.
- **Using the section glyph.** Write the word "section" everywhere — docs, headings, references.
