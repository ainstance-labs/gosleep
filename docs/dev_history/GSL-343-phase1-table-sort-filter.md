# GSL-343 — Table + sortable headers + Category / Date-range filters

**Epic:** GSL-340 [Test][E2E] Expense tracker table (run02)
**Wave:** shift-79 wave 6 (impl-wave6)
**Repo:** `ainstance-labs/gosleep-e2e-todo`
**Branch:** `GSL-340-expense-tracker`
**PR:** https://github.com/ainstance-labs/gosleep-e2e-todo/pull/14
**Commit:** `c384748 GSL-343 Build table with sorting and filtering`

## What landed

- `src/components/ExpenseTable.tsx` — controlled table component:
  - Columns: Date, Category, Amount, Merchant, Notes.
  - Click-to-sort on any header (`asc → desc → asc`), sort indicator (▲/▼) on the active column.
  - Category dropdown filter: `All` + unique values derived from the seed.
  - Date range filter: `from` and `to` `<input type="date">` inputs (independent — either side optional).
  - Filter + sort composed via `useMemo` so re-renders only re-compute when inputs change.
- Wired the component into `src/App.tsx` under the page title.

## Why

The three interaction primitives (sort, single-dimension filter, range filter) are exactly the surface an E2E table-verification suite exercises, and matching them one-for-one to the epic acceptance criteria keeps the fixture predictable.

## Verification

- `bunx tsc -p tsconfig.app.json --noEmit` — clean.
- Live check after the full epic: dev server on `127.0.0.1:7367` renders the table with Date-descending sort as the default and all filters populated (see screenshot in `.artifacts/expense-tracker.png`).
