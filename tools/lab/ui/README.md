# `tools/lab/ui/` — the laboratory's view layer

TypeScript + Preact, **server-rendered once per chronicler pass**. Produces the static screens in
`docs/lab/site/`, which the owner opens from `file://` on a laptop or through the private GitHub repo
on a phone.

```
tools/lab/chronicler.py   (Python — the DATA layer: reads the tiers, folds, grades, counts)
        │
        └── docs/lab/render_bundle.json     ← the ONE contract (mirrored by src/types.ts)
                │
                └── tools/lab/ui/render.sh → build.mjs → src/render.tsx
                        │
                        └── {"index.html": "<!doctype html>…", …}  ← printed to stdout
                                │
                                └── Python writes each page via tools/lab/lab-write.sh (atomic)
```

## Four decisions, and why they are not negotiable

**1. Static generation, not a single-page app.** `file://` cannot `fetch()` a local JSON file — the
browser blocks it as a cross-origin request. So there is no client-side data loading and there never
can be: every number a page shows is inlined into that page at build time. This is not a stylistic
preference about frameworks; it is the only architecture the delivery target permits.

**2. The renderer writes nothing.** `build.mjs` reads stdin, prints `{filename: html}` to stdout, and
never touches the filesystem (`smoke.sh` asserts this). Python writes every byte through
`lab-write.sh`, which writes to a temp file and renames — so a reader always sees the whole old page
or the whole new one, never a prefix. A node process killed halfway through page five cannot corrupt
a dashboard it was never allowed to open.

**3. One renderer, not two.** The HTML used to be built in `chronicler.py`, and it drifted from
itself within a single phase: the staleness banner re-graded when you opened the page while the
sentence beneath it stayed frozen at build time, so a page could show a red **DEAD** banner over the
words *"Live — the laboratory is writing itself right now"* (REVIEW-gsl81 M1). That is what two
renderers of one truth produce. The Python view code is gone; this is the only renderer.

**4. No node is a degradation, not an outage.** The data layer is `python3` + stdlib and depends on
none of this. If node is missing, `npm install` was never run, or esbuild throws, the chronicler
still regenerates `status.json`, the event log and the morning digest — and then stamps a red banner
across the top of every page it could not rebuild, naming the last successful build. **A stale page
that admits it is stale is the product. A fresh-looking page full of yesterday is the failure.**

## Bootstrap (once per clone)

```bash
cd tools/lab/ui && npm install
```

Deps are **never installed automatically.** `npm install` reaches the network, and the chronicler
fires at cycle boundaries — sometimes at 03:00, on a laptop that may be tethered or offline. A
nightly job that quietly starts downloading is a nightly job that quietly hangs. Until you run it,
the pages say so, in red, with this command in them.

## Build

You do not normally run this by hand — `tools/lab/chronicler.sh` does:

```bash
bash tools/lab/chronicler.sh                 # data pass + render
bash tools/lab/chronicler.sh --dry-run       # renders (so failures still surface), writes nothing
```

Directly, for debugging a render:

```bash
bash tools/lab/ui/render.sh < docs/lab/render_bundle.json | jq -r '.pages["index.html"]' > /tmp/i.html
node tools/lab/ui/build.mjs  < docs/lab/render_bundle.json | jq .ok
npx tsc --noEmit             # from this directory — the types are checked, never emitted
```

`render.sh` **always exits 0 and always prints JSON**, either `{"ok":true,"pages":{…}}` or
`{"ok":false,"reason":"…"}`. `reason` is a closed vocabulary — `no-node`, `no-deps`, `build-failed`,
`bad-bundle` — and it lands in `status.json` under `ui`, in the event log, and on the banner.

## Layout

| Path | What it is |
|---|---|
| `src/types.ts` | The render-bundle contract. Mirrors `build_render_bundle()` in `chronicler.py`. |
| `src/page.tsx` | Page shell: doctype, inlined CSS, degrade anchor, data islands, inlined client JS. |
| `src/components.tsx` | Nav, staleness banner, events table — the parts every screen shares. |
| `src/screens/*.tsx` | One file per screen. PRD R5.2 wants seven; GSL-93 adds the missing four. |
| `src/client.ts` | The only code that runs in the owner's browser. Inlined into every page. |
| `src/theme.ts` | The whole stylesheet. Light + dark, phone width first. |
| `src/verdicts.ts` | The three staleness verdicts — one source, read by the server AND the client. |
| `build.mjs` | esbuild: compiles the renderer for node, the client bundle for the browser. |
| `render.sh` | Preflight + the closed `reason` vocabulary. The chronicler's only door in. |

## Rules that outlive this file

- **`docs/lab/site/` is DERIVED.** Never hand-edit it. The next pass overwrites it, and in the
  meantime a hand-edit is a lie with a `generated_at` stamp on it.
- **Numbers are computed in Python, once.** If a screen needs a count, add it to the bundle — do not
  work it out in TSX. A number the renderer derives for itself is a second opinion waiting to
  disagree with `status.json`.
- **Absence renders as absence.** No data for a value means the page says *unknown*, never a
  plausible default. An optimistic guess in a runway clock lengthens `min()` — and a dashboard that
  guesses long is one that tells the owner to go to sleep on evidence it does not have.
- **The client bundle is not minified.** It is a couple of KB, it ships inside a file the owner may
  well read, and `smoke.sh` asserts against its source.
