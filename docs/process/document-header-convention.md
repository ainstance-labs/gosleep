# Document header convention — data valid as of

> **Data valid as of:** 2026-08-17.
> **Updated by:** wave4b (GSL-237, systems-audit process tail).
> **Scope:** every document under `docs/reports/`, `docs/reviews/`,
> `docs/handoff/`, `docs/runbooks/`, `docs/process/` that makes a claim about
> the state of the system, plus every top-level standard README in those trees.

The shift-73 audit found 28 (MAJOR): five existing reports described the system
of two weeks ago and carried no freshness date, so a reader could not tell an
historical claim from a current one. This convention closes that gap by making
the freshness date a hard part of the document.

---

## The header

Every qualifying document opens with this block, immediately after the H1
title, before any other content:

```markdown
> **Data valid as of:** YYYY-MM-DD.
> **Updated by:** <handle-or-shift> (<Jira key of the change that produced this snapshot>).
> **Scope:** <one line naming what this document asserts>.
```

### Field rules

- **Data valid as of** — the date on which the claims in the body were true.
  UTC, ISO 8601. Not "when I hit save" — the day the underlying evidence was
  collected. When you update a document, update this date too if the claims
  moved with you.
- **Updated by** — the human-or-agent handle who did the update, plus the Jira
  key that produced this revision. This is the accountability line: readers
  jump from a stale-looking claim to the ticket that last stood behind it.
- **Scope** — one line so a reader can decide in five seconds whether this
  document is the right one to trust for their question. Not a marketing
  tagline; a factual "what this covers, what it does not".

## Which documents this applies to

**MUST carry the header:**

- Every file under `docs/reports/**` (verification runs, audits, incident
  reports, benchmark reports).
- Every file under `docs/reviews/**` (audit findings, plan reviews, retros).
- Every handoff file under `docs/handoff/**` and its README (a handoff already
  carries an ISO date in its filename — the header formalises the same date as
  a claim about system state, not just about when the shift ended).
- Every file under `docs/runbooks/**` (they encode "how the system is right
  now" — a runbook without a freshness date is a foot-gun).
- Every file under `docs/process/**` (this convention itself, and its
  siblings).
- Every top-level README of a standards directory (e.g.
  `docs/reports/verifications/README.md`).

**MAY omit the header** (structural or intentionally undated):

- `docs/dev_history/*` — each per-task file is already a point-in-time record
  keyed by a Jira task and its commit; the surrounding index (`README.md`)
  carries the header.
- `docs/prd/*` — PRDs carry their own `Status:` / delta history block per the
  PRD-maintenance rule (`docs/process/prd-maintenance.md`, GSL-238), which is
  the equivalent contract.
- `docs/design/*` — design specs list their revision history internally.

If a file that MUST carry the header does not, the review that ships it is
incomplete regardless of how good the body reads. Introducing a new report
without the header is a defect of the shift that produced it.

## Backfill — existing documents

Backfilling every legacy doc is out of scope for this task. The rule bites
forward: every new document under the "MUST carry" set below and every
material update to an existing one must include the header. When editing a
legacy file, add the header at the same time.

The five reports flagged by the audit finding 28 (MAJOR) are the priority
backfill target — the report-index README under each may itself be enough to
close the finding when the individual files are static snapshots.

## Rendering in HTML dashboards

Reports built with the `agentic-report-creator` skill are HTML, not Markdown.
The equivalent contract there is a byline block in the header of the dashboard
page carrying:

- data-valid-as-of date
- updated-by handle + Jira key
- scope

The skill's report template MAY be updated to make this block a required
render slot. That work is a follow-up (Jira-tracked separately if needed) and
NOT part of this task.

## Why this exists

The audit found reports that read as current on the day they were written and
never carried the date. Two weeks later they still read as current, and no
signal in the file itself said otherwise. The failure mode is "silent decay":
a document ages without any surface warning, and readers act on it as if fresh.
The header trades three lines of markup for a hard freshness signal that the
reader cannot miss and the writer cannot forget.
