# `docs/lab/site/` — DERIVED. Do not hand-edit.

Every file here is overwritten by `tools/lab/chronicler.sh` on its next pass. An edit you make by hand
survives exactly until then, and in the meantime it is a lie with a `generated_at` stamp on it.

This is the tasty-lunch-wiki rule (blueprint 05 §1.4-1), and it is the only reason a regenerated hub
does not rot: **nobody edits it, so nobody has to maintain it.** To change what the page says, change
what the chronicler *reads* — or change the renderer in `tools/lab/ui/`.

## How a page is built

```
docs/lab/{events,decisions,questions}/*  ->  tools/lab/chronicler.py   (Python: reads the world)
                                         ->  docs/lab/render_bundle.json   (schema gosleep.lab.render/7)
                                         ->  tools/lab/ui/  (TypeScript + Preact, server-rendered)
                                         ->  7 self-contained .html files here
```

The bundle is the only thing crossing the Python/TypeScript border. Bumping its schema means editing
four files in one commit — `chronicler.py`, `types.ts`, `render.tsx`, `smoke.sh` — never fewer.

If node is unavailable the pages are **NOT** regenerated: they stay exactly as they were, under a red
banner that says so. A stale page that admits it is stale is the product; a fresh-looking page full
of yesterday is the failure.

## The contract: self-contained, but not JavaScript-free

Open `index.html` from `file://`. Every page is self-contained — **no CDN, no web fonts, no external
stylesheet, no external script**. Measured 2026-07-20 with DevTools at `file://`: exactly **one**
network request per page (the HTML file itself) and **zero** console errors.

There IS JavaScript, and there is more of it than "a little". It is inlined in the page, and the rule
governing it is one sentence:

> **The client may only ever compute over data already inlined at build time. It must never make a
> network request of any kind.**

That is not a stylistic preference. `file://` cannot `fetch()` a sibling JSON file — CORS forbids it
— so a page that needed the network would simply be blank for the one reader it is written for.

Four things run when you open a page. Each exists because a *static* number would have been false in
the reassuring direction — the only direction that matters:

| What | Why it cannot be baked at build time |
|---|---|
| `regradeStaleness()` | A chronicler that died in the night would leave a page confidently reading "Live" forever. The banner re-grades fresh/stale/dead against **the reader's** clock, and never *softens* a verdict. |
| `tickCountdowns()` | "auto-applies in 2h" baked at 23:00 and read at 04:00 offers the owner two hours that were spent five hours ago. Deadlines are recomputed from the absolute instant in `data-auto-apply-at`. A countdown may never read a clock earlier than the build's. |
| `tickAges()` | The "last heard from" ages on Tasks/Fleet keep aging while the page is open, from `data-age-ts`. |
| `initFilters()` | Timeline and Library filter over a JSON index inlined beside the rows. The filter never hides silently: the page writes "36 of 107 shown — 71 hidden by the filter" in words, and reddens when it is hiding everything. Nothing is persisted — no `localStorage`, no hash — so every open starts from the full list. |

**With JS off, the build-time verdicts stand**, and they are honest for `generated_at`. Two details
of that degradation are deliberate:

- The filter bar ships with the `hidden` attribute and is revealed only *after* the island, the table
  and the count element have all been found. A `<select>` the reader can move that changes nothing is
  worse than no `<select>` at all — so with JS off there is no filter control on the page, and the
  full list stands.
- Severity is marked up **in the HTML**, not painted by script, because the incident row must be red
  in exactly the case where our JS did not run.

## How it is actually read on a phone (measured, not assumed)

The PRD said the owner would read these pages "from a phone, through the private GitHub repo".
Measured on 2026-07-20 against `ainstance-labs/gosleep` — that is **not** what GitHub does:

| Path | What GitHub actually returns |
|---|---|
| Contents API (`Accept: raw`) | `Content-Type: application/vnd.github.raw` + `X-Content-Type-Options: nosniff` + CSP `default-src 'none'` |
| `raw.githubusercontent.com` | `Content-Type: text/plain` + `nosniff` + CSP `sandbox` (a `.md` gets the same — raw serves everything as text) |
| GitHub Pages | Not enabled (404); org plan is `free`, and Pages for a **private** repo needs Enterprise Cloud |

`nosniff` is the decisive one **for these pages**: the file *is* HTML, and the browser is explicitly
**forbidden** to treat it as such. There is no URL on github.com that renders `.html` from this repo.

### The correction (GSL-108, 2026-07-20)

The sentence that used to close this section — *"GitHub is a transport for the bytes, not a viewer"* —
was wider than the evidence above, and it cost a phase. The measurements were of `.html` and of `raw`;
the conclusion was about GitHub. Re-measured against the same private repo, authenticated:

| Path | What GitHub actually returns |
|---|---|
| `.md` via Contents API (`Accept: html`) | `<article class="markdown-body">` — **rendered server-side** |
| `.html` via the same API | `<pre class="plain">&lt;!doctype html&gt;` — **escaped**, shown as source |
| a directory's `README.md` | rendered too (`GET /readme/<dir>`) |
| a directory with **no** `README.md` | `404` — the negative control, so the row above is not a default |

GitHub is **both**: a viewer for Markdown, a transport for everything else. `nosniff` never governed
Markdown, because Markdown is never handed to the browser to interpret — GitHub renders it to HTML on
its own servers and ships the result. The private repo was never the obstacle; the file extension was.

So the phone surface is Markdown, and it exists: **`docs/lab/mobile/README.md`**, regenerated from the
same `render_bundle.json` these seven screens render from, at a URL that carries no date and therefore
survives being bookmarked. Open the *directory* on a phone and GitHub renders it.

What remains true — and is the property this contract exists to protect — is that a page here is a
**single file with no dependencies**, so it renders completely once it reaches a phone by any means
that puts a file on it (download and open in Files, a git client, a sync folder). That is the desktop
and offline path. It is no longer the *only* path, and "the transport question is somebody else's
problem" is no longer an acceptable place to stop: it is what left `F5-S4c` open.

## Layout

Pages are a single fluid column with no breakpoints, verified at 390px (`GSL-100`). Two rules there
are load-bearing rather than cosmetic, and both are guarded in `smoke.sh`:

- **`nav` is a wrapping flex container.** The links are rendered adjacent with no whitespace between
  them, and inline boxes with no intervening white space have no soft-wrap opportunity at all — so
  before this rule the last two links sat off-screen, unreachable, on a phone.
- **`.mono` sets `overflow-wrap:anywhere`.** Monospace carries the unbreakable strings (raw JSON
  notes, shas, branch names); without it a card clips its own quote mid-token and the reader loses
  the rest of the sentence with nothing on screen to say so. Wide *tables* are exempt: they scroll
  inside `.wrap`, where the swipe is discoverable.
