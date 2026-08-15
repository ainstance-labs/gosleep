# tools/e2e — live-fire scenario scripts

**Standalone package. NOT part of the Bun workspaces at the repo root.**

## Purpose

Playwright-driven end-to-end scenarios that drive the gosleep panel on
`http://127.0.0.1:7331` and verify the observed behaviour of the harness during
live-fire runs (see the E2E test fixture repo
`ainstance-labs/gosleep-e2e-todo` and the run-06 Epic `GSL-315`).

QA / verifier agents reuse this directory to script panel walkthroughs while a
separate dev-agent works through a test scenario in the throwaway repo.

## Why it is NOT in the root workspaces

The gosleep monorepo declares `workspaces: ["apps/*", "packages/*"]` in the root
`package.json`. This directory is deliberately outside that pattern:

- Playwright bundles ~275 MB of chromium binaries — pulling it into the shared
  `bun.lock` would slow every root `bun install` for zero benefit to the core
  server, web SPA, schema, or SDK packages.
- These scenarios are executable specs, not code the product depends on.
- Its own `package.json` + local `bun.lock` are BY DESIGN. Do not "fix" this
  layout by moving it under `apps/` or `packages/` and do not add
  `tools/e2e/*` to the root `workspaces` glob.

## Runtime finding

Verified 2026-08-10 (shift 76, e2e-prep worker):

- **Bun works.** `bun run smoke.mjs` under bun 1.3.10 successfully launched
  headless chromium, opened a `data:text/html,<h1>ok</h1>` URL, read the H1
  via `page.locator('h1').innerText()`, captured a screenshot, closed. No
  bun-side incompatibility observed.
- Node 24.13.1 is also installed and available (`node smoke.mjs` was NOT
  needed but would work if a future scenario hits a bun quirk).

## Install (once per fresh clone)

```bash
cd tools/e2e
bun install               # installs playwright to tools/e2e/node_modules
bunx playwright install chromium   # ~275 MB of chromium into ~/Library/Caches/ms-playwright
```

## Run

```bash
cd tools/e2e
bun run smoke.mjs         # baseline toolchain check (emits ./.smoke.png; delete after)
```

Add more scenarios as sibling `*.mjs` files. Keep them idempotent — a scenario
that leaves state in the running gosleep-core will break the next verification
run.

## Do NOT

- Add `tools/e2e/*` to the root `package.json` `workspaces` glob.
- Delete `tools/e2e/bun.lock`.
- Delete `tools/e2e/node_modules` and expect the root `bun install` to
  restore it — you must run `bun install` from inside `tools/e2e/`.
