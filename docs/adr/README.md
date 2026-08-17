# Architecture Decision Records — index

> **Data valid as of:** 2026-08-17.
> **Updated by:** wave4b (GSL-240, systems-audit process tail).
> **Scope:** durable home for architectural and process DECISIONS with the
> context, options considered, and consequences. Established by the
> tasty-lunch reference the owner named; the shift-73 audit found 77
> (MAJOR) that the project had no equivalent and lost the rationale behind
> its own choices between shifts.

---

## What lives here

An ADR names a **decision the project made** — architectural, process, or
policy — and records why. Its purpose is not to prescribe the future but to
preserve the rationale: what was chosen, what was rejected, and under what
conditions the decision should be revisited.

Each ADR lives in its own file with a slug filename:

```
docs/adr/ADR-<NNNN>-<slug>.md
```

`NNNN` is a zero-padded serial (0001, 0002…), assigned at creation and never
reused. A superseded ADR is not deleted — it stays with a status line
pointing at the ADR that replaced it.

## What an ADR contains (template)

```markdown
# ADR-<NNNN> — <one-line decision name>

> **Status:** Accepted | Superseded by ADR-XXXX | Deprecated | Proposed.
> **Date:** YYYY-MM-DD.
> **Decided by:** <owner directive | shift consensus | audit synthesis>
>   (<pointer to decision record, if any>).
> **Related lesson:** LL-XXXX (if the decision codifies a lesson).

## Context

<Two-to-four paragraphs: what problem was in front of the project, what
constraints applied, what evidence was in hand.>

## Decision

<One paragraph: the actual thing chosen, stated declaratively.>

## Consequences

- **Positive.** <What becomes possible / cheaper / safer.>
- **Negative.** <What becomes harder / more expensive / risky.>
- **Neutral.** <Facts that follow but do not carry a value judgement.>

## Alternatives considered

<For each: what it was, why it was rejected. Two-to-three lines each.>

## When to revisit

<Named conditions under which this ADR should be re-opened. "When we hit
100k events per day", "when Anthropic's billing pause lifts", "if the
mobile phase unfreezes".>
```

## Difference between an ADR and a lesson

- **ADR** — a decision the project made. Future-facing. Codifies a *choice*.
- **Lesson learned** (`docs/lessons-learned/`) — a class of failure the
  project bought at cost. Past-facing. Codifies an *anti-pattern*.

A lesson can motivate an ADR ("we lost data to `git stash` in the shared
tree → ADR-000X: repository access policy in shared checkouts"). An ADR can
retire a lesson (the ADR's mechanism removes the class of failure). Both are
allowed to point at each other.

## Relationship to other stores

- **PRD** (`docs/prd/**`) — WHAT the project builds. When an epic closes,
  the PRD updates per `docs/process/prd-maintenance.md` (GSL-238).
- **Decision manifest** (`docs/lab/decisions/manifest.md`) — LIVE operating
  policy the orchestrator applies (models, thresholds, rules). This is
  authoritative for runtime; ADRs record how the manifest got there.
- **ORCHESTRATION-STATE** (`docs/handoff/ORCHESTRATION-STATE.md`) —
  point-in-time state, not a decision log. Standing rules there may be
  written up as ADRs; the state file itself is not an ADR store.
- **Lessons learned** (`docs/lessons-learned/`) — what to avoid.
- **Skills** (`skill/**` + `~/.claude/skills/**`) — how to do the work.

## Index

- [ADR-0001 — Adopt phase-acceptance checklist as the epic-closure gate](ADR-0001-adopt-phase-acceptance-checklist.md)
