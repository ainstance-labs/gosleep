# GSL-265 — Web client skeleton: React 19 + Vite 7 + Tailwind v4 + shadcn + 5 read-only screens

**Date:** 2026-08-07 · **Epic:** GSL-250 (interactive control plane) · **Branch:** `GSL-250-control-plane` · **Cycle:** 203 · **Shift:** 75 · **Worker:** impl-web-6 (Opus 4.7)

## What was done

Stood up the `apps/web` client on top of the already-live `gosleep-core` (GSL-260..264). It is a real,
runnable dashboard: the owner opens `http://127.0.0.1:5273` in dev (or the static build served under
`apps/web/dist` by a future step), sees a Vercel/Linear-class panel in Geist, and every screen shows
real data from `data/gosleep.db` — streamed live over SSE. Five screens work end-to-end:

- **Overview** — hero KPIs (events / questions / tasks / skills) + a live pulse strip of the latest
  12 events. `useStatus()` + `useTimeline(12)`; the SSE provider re-invalidates on every incoming
  event so the counts and the pulse strip stay a heartbeat behind the tail indexer.
- **Timeline** — the full event log with type + task filters and a per-row payload disclosure. The
  filter dropdown builds itself from the currently-loaded event types (no hard-coded vocabulary).
- **Questions (read-only)** — cards for the folded question queue, one status pill per state, the
  answer text in a green-tinted panel when present. The status filter row is a group of buttons; no
  write buttons — those are GSL-268's scope.
- **Tasks** — Jira-cache projection grouped by epic. Status pill per row, sync-age column. Empty
  state calls out that the Jira sync worker lands with GSL-279 (currently zero rows in the DB).
- **Cost** — v1 client-side roll-up of `cost.*` events by UTC day. Three tiles (total USD extracted,
  events observed, days spanned) + a Recharts area chart + a raw-events table. Handles the current
  "no cost events yet" case gracefully.

Two new shared packages sit under `packages/`:

- **`@gosleep/schema`** — zod schemas + inferred TS types for every v1 read endpoint the core exposes
  (`/status`, `/version`, `/whoami`, `/timeline`, `/questions`, `/skills`, `/tasks`, `/cost`,
  `/fleet`, `/bundle`) plus the two SSE data envelopes (`event: <type>` and `event: rotate`). No
  drizzle imports — this package is safely browser-consumable.
- **`@gosleep/sdk`** — `CoreClient` (typed fetch wrappers, `getBearer` pull-callback, schema
  validation at the boundary, `ApiError` / `SchemaError` types) plus a `subscribe()` function that
  opens `/events` via fetch + ReadableStream, parses SSE frames by hand, tracks `Last-Event-ID` for
  reconnect, handles the `rotate` frame separately, and reconnects with capped exponential backoff.

Design system tokens follow `docs/reports/web-harness-research-2026-08-03/design-system.md` verbatim:
soft light palette (fg `#26272b` on `#fafafa`, 13.5:1 AAA), soft dark palette (fg `#e4e5e8` on
`#0b0b0d`, 15.6:1 AAA), all muted variants ≥ AA. Geist Variable + Geist Mono are pulled in via
`@fontsource-variable/geist{,-mono}` and Vite inlines the woff2 subsets into the build (12 files,
~140 KB total).

## Problems solved

- **`fetch` Illegal invocation.** Assigning `this.fetchFn = options.fetch ?? fetch` inside CoreClient
  stripped the `this` binding — every call threw `Illegal invocation` on `window`. Fixed by
  explicitly binding to `window` (or `globalThis` off-DOM) unless the caller passes a custom fetch.
  Same fix in the SSE subscribe path.
- **SPA route names collide with core endpoint names.** react-router owns `/tasks` and `/questions`
  in the browser; the naive vite proxy that forwarded those paths to core hijacked SPA navigation
  and served raw JSON / 401 text. Fixed by namespacing every core call under `/api/*` — the SDK
  builds URLs off a `baseUrl` that is `${origin}/api` in dev and `${origin}` in prod, and the vite
  proxy strips the `/api` prefix while forwarding.
- **`requireLocalHost` 421 through vite proxy.** vite dev-server listens on :5273 but core's
  Host-header middleware only accepts `127.0.0.1:7331`. Fixed with `changeOrigin: true` on the proxy
  — the outgoing Host header now matches what core expects.
- **`EventSource` can't send `Authorization`.** WHATWG `EventSource` forbids custom headers, but
  core's SSE endpoint gates on Bearer. Rather than fork the server to accept a query-param token,
  the SDK implements a minimal SSE reader over `fetch` + `ReadableStream` + `TextDecoderStream` +
  a hand-rolled frame parser. `Last-Event-ID` header is set from the last frame's `id:` on
  reconnect, exponential backoff (250 ms → 8 s cap) on network drop.
- **React strict mode killed the persistent SSE.** The first `useEffect` invocation set up the
  subscription, then strict mode's cleanup pass torn it down, then the second invocation's `if
  (startedRef.current) return` early-exited without re-subscribing — the app stayed permanently
  "reconnecting". Fixed by removing the guard and letting strict-mode's normal dance work
  (subscribe → dispose → subscribe; the dispose is fast and idempotent).
- **`@types/node` mismatch broke `apps/core` typecheck.** apps/web pinned `@types/node@^22` but
  `bun-types@1.3.14` pulls `@types/node@^26` as a transitive; the flattened resolution left apps/core
  seeing whichever it hoisted first, and its `ChildProcess.on` calls broke. Aligned apps/web to
  `@types/node@^26` so both workspaces see the same TS types for `node:child_process`.
- **TextDecoderStream type mismatch.** `pipeThrough(new TextDecoderStream())` fails TS's
  `ReadableWritablePair<Uint8Array>` constraint because DOM's `TextDecoderStream.writable` is
  typed as `WritableStream<BufferSource>` (wider than `WritableStream<Uint8Array>`). Bridged via a
  narrow cast in one place, documented inline.

## Problems remaining

- **The prod path (SPA served by `gosleep-core`)** is not wired up yet — apps/core still returns
  404 for anything not in its route table. In dev, vite serves the SPA and proxies `/api/*` to core.
  Wiring core to serve `apps/web/dist` is a separate task (fits under GSL-269 polish, or its own
  slice); the SDK is already configured to use empty base URL in prod so no client change is needed.
- **Bearer setup UX** — right now the token has to be in `sessionStorage['gosleep.token']` (or on the
  URL as `?token=<…>` on first load). The polished setup flow that opens a Keychain-confirmation
  window (target-arch step 10) is GSL-269.
- **Bundle size warning** (858 KB JS pre-gzip / 251 KB gz). Recharts + Framer Motion are the big
  additions; code-splitting is a later concern.
- **Empty tasks + empty cost states.** The DB currently has no `tasks` rows (Jira sync worker is
  GSL-279) and no `cost.*` events; both screens render the friendly empty state today. When those
  populate, no client change is required.

## Pitfalls & workarounds

- **Never let `fetch` lose `this`.** Any time we hand `fetch` to a stored callable, bind it to
  its owning global. This is one of those bugs that only shows up in the browser, so unit tests
  that pass a fake `fetch` will hide it — the SDK's built-in default now bakes the bind in.
- **`Authorization` and `EventSource` are incompatible by design.** If a later task adds a second
  SSE stream, DO NOT try to use `EventSource` with `?token=<…>` — either reuse the fetch-based
  reader here or add a cookie-authenticated variant on the server.
- **vite proxy's Host rewrite is opt-in.** `changeOrigin` defaults to `false`; without it, every
  proxied call hits `requireLocalHost` and dies with 421. Any future proxy entries must set
  `changeOrigin: true` (and future host-check code in core must remember what "the client sees"
  looks like when a dev-server sits in front).
- **SPA route names must not collide with core endpoint names.** The `/api` prefix is now the
  contract — do not add `/questions` or `/tasks` back to the vite proxy at the root.
- **Strict-mode-safe effects.** The pattern here (no "started" guard, rely on the returned
  disposer) is the correct one for any long-lived subscription; the guard pattern is a footgun
  under React 18+ strict mode.
- **`@types/node` version drift.** When any workspace adds a `@types/node` pin, verify it does not
  fall behind what `bun-types` declares — mismatched TS versions of `node:child_process` types are
  a silent break. Repin all workspaces together.

## What didn't make it

- **The Skills screen** — the task description explicitly points at GSL-255 for that; not in scope.
- **The Fleet screen** — rev-3 addendum Delta 8.1 puts that behind the new `agent_sessions` table
  in GSL-276. The `useFleet()` hook + `/api/fleet` proxy entry are wired for when the projection
  fills; no new UI code needs to change.
- **Command palette / keyboard shortcuts.** Nice-to-have; deferred.
- **Skeleton animations on the KPI tiles.** Current pending states just show empty pills; the
  Skeleton component exists (`components/ui/Skeleton.tsx`) but the KPI tiles use `…` placeholders
  from the query state for compactness. Cheap upgrade later.

---

## Technical reference

**Commit:** _(landed as one commit — see git log for the SHA)_

**Key files touched (new):**

- `packages/schema/{package.json,tsconfig.json,src/index.ts}` — zod schemas + TS types for every
  v1 read response and the two SSE data envelopes.
- `packages/sdk/{package.json,tsconfig.json,src/index.ts}` — `CoreClient` (typed reads,
  Bearer-callback, schema validation) + `subscribe()` (fetch-based SSE, `Last-Event-ID` resume,
  exponential backoff, `rotate` handling).
- `apps/web/{package.json,tsconfig.json,vite.config.ts,index.html,postcss.config.js,bunfig.toml}`
  — Vite 7 + React 19 + Tailwind v4 + shadcn deps, `/api/*` proxy to `127.0.0.1:7331` with the
  `/api` prefix stripped and Host header rewritten.
- `apps/web/src/main.tsx` — mounts StrictMode → ThemeProvider → QueryClientProvider →
  ToastProvider → SseProvider → RouterProvider. TanStack Query configured with 5 s staleTime +
  refetchOnWindowFocus.
- `apps/web/src/router.tsx` — react-router 7 data-router with the five screens under a shared
  `AppShell` layout; `RouteError` boundary.
- `apps/web/src/theme/{globals.css,ThemeProvider.tsx}` — CSS variables palette + Geist wiring;
  `system` / `light` / `dark` theme provider that stamps `<html data-theme=…>` and follows
  `prefers-color-scheme` when in system mode.
- `apps/web/src/components/AppShell.tsx` + `components/ui/{Button,Badge,Card,Skeleton,Table,Toast}.tsx`
  + `components/{PageHeader,QueryStatus,RouteError}.tsx` — shell + shadcn-style primitives.
- `apps/web/src/data/{auth,client,queries,SseProvider}.ts{,x}` — Bearer discovery,
  CoreClient singleton, TanStack Query hooks per screen, SSE provider that fans events out to
  query invalidations by type prefix.
- `apps/web/src/screens/{Overview,Timeline,Questions,Tasks,Cost}.tsx` — the five read-only screens.
- `apps/web/src/lib/{cn,format}.ts` — className merge + timestamp formatters.

**Verified by running:**

- `bun install` at repo root — 360 packages, single root `bun.lock`, no per-package lockfiles.
- `bunx tsc -p apps/web --noEmit` → rc 0.
- `bunx tsc -p packages/schema --noEmit` → rc 0.
- `bunx tsc -p packages/sdk --noEmit` → rc 0.
- `bunx tsc -p apps/core --noEmit` → rc 0 (after aligning `@types/node` to `^26`).
- `bun run --filter='@gosleep/web' build` → clean; 858 KB JS (251 KB gz), 40 KB CSS (7.5 KB gz),
  12 Geist woff2 subsets inlined.
- `bash tools/lab/gate.sh --offline` → VERDICT green.
- `bash tools/lab/smoke.sh` → 551/551.
- `bash tools/lab/tests/core-smoke.sh` → 12/12; port 7331 clean after teardown.
- **Live-render evidence** (`.artifacts/gsl-265-evidence/` + `docs/dev_history/assets/gsl-265/`):
  10 screenshots captured against the live core against `data/gosleep.db` (3728 events, 38
  questions, 49 decisions imported from `docs/lab/*.jsonl`). Each screen validated in both light
  and dark themes.
- **SSE-live proof:** with the UI open, appended one FYI event to
  `docs/lab/events/2026-08-07.jsonl` (payload `{"proof":"GSL-265 SSE live push","task":"GSL-265"}`).
  The tail indexer picked it up within one poll (10 s cadence + fs.watch), the SSE broadcaster
  fanned it out, the SSE provider invalidated the timeline query, and the Live-pulse strip on
  Overview showed `21:49:12 fyi impl-web-6 · GSL-265 seq 3729` at the top — no reload. The Events
  count tile ticked 3728 → 3729. `.artifacts/gsl-265-evidence/06-overview-dark.png` captures the
  post-push state.
- **Ports clean after:** `lsof -i :7331` empty, `lsof -i :5273` empty.

**Deviations from the Jira description:**

- Vite pinned to **7** (per rev-3 addendum Delta 6), not 6 as the description text says.
- Client base URL is `/api/*` in dev, not `/*` — required to keep SPA routes and endpoint names
  from colliding. In prod (when core serves the SPA) the base is empty; contract preserved.
- `@types/node` in apps/web pinned to `^26` (not `^22`) to match the version `bun-types` resolves —
  keeps apps/core typecheck green after `bun install`.

**Links:**

- Jira: [GSL-265](https://ainstance-labs.atlassian.net/browse/GSL-265)
- GitHub Issue: [ainstance-labs/gosleep#275](https://github.com/ainstance-labs/gosleep/issues/275)
- Screenshots: `docs/dev_history/assets/gsl-265/*.png` (01..10, light + dark for each screen).
- Design sources: `docs/reports/web-harness-research-2026-08-03/{target-architecture.md §2+§6,
  target-architecture-rev3-addendum.md Delta 6, design-system.md §4-§8}`.
