# GSL-342 — Expense data model + 30-row seed

**Epic:** GSL-340 [Test][E2E] Expense tracker table (run02)
**Wave:** shift-79 wave 6 (impl-wave6)
**Repo:** `ainstance-labs/gosleep-e2e-todo`
**Branch:** `GSL-340-expense-tracker`
**PR:** https://github.com/ainstance-labs/gosleep-e2e-todo/pull/14
**Commit:** `e41788c GSL-342 Implement expense data model and seed data`

## What landed

- `src/types/Expense.ts` — TypeScript interface with `id: string`, `date: string` (ISO `YYYY-MM-DD`), `category: string`, `amount: number`, `merchant: string`, `notes: string`.
- `src/data/expenses.ts` — 30 hand-curated seed records across six categories (Food, Shopping, Healthcare, Utilities, Entertainment, Transportation), covering merchants a real dashboard would surface (Subway, Nike Store, Dental Clinic, Gas Company, Museum Tickets, Chevron, …).

## Why

The fixture must be **deterministic** — no `Math.random()`, no `new Date()`, no network — so every E2E run compares against the same row set, filters, sums, and pagination boundaries. 30 rows is enough to force pagination (3 full pages at 10/page) while staying readable in a single scroll during manual QA.

## Verification

- `bunx tsc -p tsconfig.app.json --noEmit` — clean.
- Category totals (validated against the rendered grouping panel later):
  - Shopping $850.00, Food $599.70, Healthcare $425.00, Utilities $410.00, Entertainment $405.00, Transportation $188.50.

## Notes

- Dates span a realistic month range so the Date-range filter has meaningful behaviour to exercise.
- Category strings are the source of truth for the dropdown filter — no duplicated enum.
