# GSL-329 — PR chip `#N` friendly label (Overview + Fleet)

**Epic:** GSL-326 · **Branch:** `GSL-326-cosmetic-polish` · **Base:** `origin/main` @ `394cc6e`.

## Symptom (E2E run 08 minor)

Both the Latest-PR card (Overview) and the per-session PR chip (Fleet)
rendered the FULL URL as visible anchor text — e.g.
`https://github.com/ainstance-labs/gosleep-e2e-todo/pull/9999`. On a
small chip that reads as noise, and the convention on the rest of the
panel is the compact `#N`.

The click behaviour was already correct (FIX-C from run 07); only the
label needed to shrink.

## Fix

Pure `formatPrLabel(url)` in `apps/web/src/lib/format.ts`:

- Any URL containing `/pull/N` → `#N`. Regex matches the path shape, not
  the host, so github.com, GitHub Enterprise mirrors, forks, and even
  bare `/pull/N` paths all resolve.
- Query strings, fragments, trailing slashes, whitespace, `/pull/N/files`
  sub-paths, `http://` scheme — all tolerated.
- **Unparseable → `"PR"`, never the raw URL.** Bare hostname, empty
  string, `null`, `undefined`, `.../issues/42`, `.../pull/draft`,
  garbage — all render as `"PR"`. Rendering the raw URL on the fallback
  path would defeat the whole point of the fix.

Wired at both surfaces:

- **Overview** (`apps/web/src/screens/Overview.tsx`): `LatestPrCard`
  populated branch now emits `{formatPrLabel(pr.url)}` with `title={pr.url}`
  and `inline-block` layout (removes `block break-all` — the compact
  label doesn't need to wrap).
- **Fleet** (`apps/web/src/screens/Fleet.tsx`): per-session PR chip now
  emits `{formatPrLabel(s.last_pr_url)}`; `title` grew a `${url} — ` prefix
  in front of the existing "observed …" line so the URL stays hoverable.

`href` stays the full URL on both surfaces, so `target="_blank"` +
`rel="noopener noreferrer"` behaviour is unchanged.

## Tests

`apps/web/test/formatPrLabel.test.ts` — 22 test cases:

- 4 canonical GitHub URLs → `#N`.
- 6 URL variants (trailing slash, query, fragment, sub-path,
  `http://` scheme, whitespace) → `#N`.
- 2 non-GitHub mirrors (GHE-style host, bare `/pull/N`) → `#N`.
- 9 unparseable inputs (null, undefined, empty, whitespace, bare
  hostname, repo URL, issues URL, non-numeric slug, garbage) → `"PR"`.
- 1 explicit anti-regression assertion: fallback yields exactly `"PR"`,
  never the input.

## Gates run

- `bun x tsc -p apps/web --noEmit` — clean.
- `bun test apps/web` — 58 pass (28 GSL-327 + 22 new + 8 existing).
- `bun run --filter='@gosleep/web' build` — clean.

## Files touched

- `apps/web/src/lib/format.ts` — new `formatPrLabel` helper + block
  comment.
- `apps/web/src/screens/Overview.tsx` — import + `LatestPrCard`
  populated-branch anchor swap.
- `apps/web/src/screens/Fleet.tsx` — import + per-session PR chip anchor
  swap.
- `apps/web/test/formatPrLabel.test.ts` — new.
