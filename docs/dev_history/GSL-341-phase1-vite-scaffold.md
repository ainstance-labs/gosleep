# GSL-341 — Vite + React + TypeScript scaffold

**Epic:** GSL-340 [Test][E2E] Expense tracker table (run02)
**Wave:** shift-79 wave 6 (impl-wave6)
**Repo:** `ainstance-labs/gosleep-e2e-todo`
**Branch:** `GSL-340-expense-tracker`
**PR:** https://github.com/ainstance-labs/gosleep-e2e-todo/pull/14
**Commit:** `bd2807f GSL-341 Setup Vite React TypeScript project`

## What landed

Bootstrapped the fixture SPA with Vite 8, React 19, TypeScript 6:

- `package.json` (name `temp-app`, `type: module`, scripts `dev`/`build`/`lint`/`preview`).
- `vite.config.ts` — `@vitejs/plugin-react`.
- `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json` — split project references.
- `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/App.css` — minimal boot surface.
- `public/`, `src/assets/{vite.svg,react.svg}` — Vite defaults.
- Dev deps: `oxlint`, `@types/{node,react,react-dom}`, `@vitejs/plugin-react`, `typescript`, `vite`.

## Why

The Expense Tracker Table fixture (epic GSL-340) needs a hosting SPA that renders quickly, ships zero runtime dependencies beyond React, and works offline. Vite + React 19 + TypeScript matches the stated tech stack in the epic description and mirrors the toolchain used by earlier fixture rounds in this same repo.

## Verification

- `bun install` — 28 packages installed in ~1.3 s.
- `bunx tsc -p tsconfig.app.json --noEmit` — clean.
- No functional UI yet at this commit; the table appears in GSL-343.

## Notes

- Fixture repo `gosleep-e2e-todo` is a permanent throwaway; every run is expected to overwrite `main` eventually. Scaffold defaults were left intact so the diff against `main` is minimal.
- The `temp-app` package name is intentional — it is not shipped anywhere.
