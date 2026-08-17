# GSL-344 — Pagination (10 rows/page, Prev/Next, page indicator)

**Epic:** GSL-340 [Test][E2E] Expense tracker table (run02)
**Wave:** shift-79 wave 6 (impl-wave6)
**Repo:** `ainstance-labs/gosleep-e2e-todo`
**Branch:** `GSL-340-expense-tracker`
**PR:** https://github.com/ainstance-labs/gosleep-e2e-todo/pull/14
**Commit:** `8f0f948 GSL-344 Add pagination controls`

## What landed

Added client-side pagination to `src/components/ExpenseTable.tsx`:

- Fixed `PAGE_SIZE = 10`.
- `currentPage` React state; `totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))`.
- `Prev` and `Next` buttons with `disabled` at boundaries.
- Indicator: `Page N of M` plus a total-records label (`X records`).
- `currentPage` resets to `1` whenever the filter or sort inputs change (prevents rendering an empty page when the filter narrows the row set).

## Why

Deterministic pagination is what the E2E harness will assert against: 30 rows / 10 per page = exactly three pages, boundaries at row 10/20/30, and Prev/Next disabled at the first/last page.

## Verification

- `bunx tsc -p tsconfig.app.json --noEmit` — clean.
- Manual: dev server showed page 1 of 3 with 10 rows on load, Prev disabled; clicking Next advanced to page 2 (rows 11-20); page 3 (rows 21-30) had Next disabled.
