# Lessons learned — index

> **Data valid as of:** 2026-08-17.
> **Updated by:** wave4b (GSL-240, systems-audit process tail).
> **Scope:** durable home for lessons that survive the shift that bought them
> — the shift-73 audit found 77 (MAJOR) that three-to-four lessons had no
> home and lived only in orchestrator session memory. This directory closes
> that gap.

---

## What lives here

A lesson-learned entry names a **class of failure** the project ran into and
records what the project did about it, so a fresh agent (or a future you)
does not have to buy the lesson again. Each entry lives in its own file with
a slug filename:

```
docs/lessons-learned/LL-<NNNN>-<slug>.md
```

`NNNN` is a zero-padded serial (0001, 0002…), assigned at creation and never
reused.

## What a lesson entry contains (template)

```markdown
# LL-<NNNN> — <one-line lesson name>

> **Date bought:** YYYY-MM-DD.
> **Bought by:** <shift or handle> (<Jira key of the incident or the task
> that surfaced it>).
> **Cost:** <one line — time / tokens / lost data / repeated ask>.
> **Class:** <e.g. concurrency, orchestration, biometric-safety, data-loss>.
> **Related MEMORY entry:** <link to ~/.claude/.../memory/... file if any>.

## The pattern

<Concrete circumstance: what the shift was trying to do; what it did; what
happened as a result.>

## Why it happens

<Root cause in one paragraph. Not "someone forgot" — the underlying
condition.>

## What the project does about it now

<The mechanism / rule / gate that keeps this from recurring. Point at the
file, script, or check that owns the fix.>

## What still hurts

<Honest note on the residual: what the current fix does not cover,
conditions under which the lesson can still bite.>
```

## When to add an entry vs. when to just fix the skill

Adding a lesson here is right when the lesson generalises past any single
skill. If the lesson belongs INSIDE one of the seven owned skills
(`orchestrating-delivery-agents`, `handoff`, `delivery-workflow`,
`using-jira`, `writing-prds`, `remote-control`, `tmux-agents-orchestration`),
edit the skill directly per `skill/handoff/SKILL.md` Procedure step 7
(GSL-189, shift-closing skill-lessons checklist).

The lessons that belong HERE — not in a skill — are typically:

- Repo-wide policies too specific for any single skill (e.g. "no `git stash`
  in the shared tree").
- Cross-shift patterns that no one skill can prevent (e.g. "watch out when
  three sessions read the same DB").
- Machine-specific limits that a global skill would misrepresent (e.g. the
  ~3-teammate spawn cap).

The audit named this as the primary defect: three-to-four homeless lessons
kept re-appearing because they had no durable home. This directory is that
home.

## Relationship to other stores

- **Skills** (`skill/**` + `~/.claude/skills/**`) — general procedure and
  practice. Skills teach *how to do the thing right the first time*.
- **Lessons learned** (this directory) — *what to avoid* patterns that the
  project bought at cost. A lesson may point at the skill that prevents it,
  but the record of the class-of-failure lives here.
- **ADRs** (`docs/adr/`, GSL-240) — architectural / process *decisions* with
  context, options considered, and consequences. A lesson may motivate an
  ADR; an ADR then binds the project to a specific mitigation.
- **Session memory** (`~/.claude/.../memory/`, per-project) — private, live,
  per-agent notes. Anything durable that surfaces there should graduate to
  either a skill, a lesson-learned entry, or an ADR.

## Index

- [LL-0001 — No `git stash` / `git reset --hard` in the shared tree](LL-0001-no-git-stash-in-shared-tree.md)
