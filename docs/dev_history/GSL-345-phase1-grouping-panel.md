# GSL-345 — Grouping panel widget

**Epic:** GSL-340 [Test][E2E] Expense tracker table (run02)
**Wave:** shift-79 wave 6 (impl-wave6)
**Repo:** `ainstance-labs/gosleep-e2e-todo`
**Branch:** `GSL-340-expense-tracker`
**PR:** https://github.com/ainstance-labs/gosleep-e2e-todo/pull/14
**Commit:** `3124da7 GSL-345 Implement grouping panel widget`

## What landed

- `src/components/GroupingPanel.tsx` — reads the currently filtered expense set, groups by `category`, sums `amount` per group, and renders a horizontal row of "Summary by Category" cards sorted by total descending.
- Wired into `src/App.tsx` **above** the `ExpenseTable`.
- The panel receives the same filtered rows the table renders (single source of truth) so its totals always reflect the active Category + Date-range filters.

## Why

The grouping widget is a common table-plugin surface (Retool, AG-Grid, Tabulator all ship one) and it's the piece that lets the E2E suite assert cross-widget consistency: "if I filter by Food, the panel should collapse to a single Food card whose total equals the sum of the visible rows".

## Verification

- `bunx tsc -p tsconfig.app.json --noEmit` — clean.
- Rendered totals with no filters applied: Shopping $850.00, Food $599.70, Healthcare $425.00, Utilities $410.00, Entertainment $405.00, Transportation $188.50 — matches the seed hand-total. See screenshot `.artifacts/expense-tracker.png`.
