# `docs/lab/site/` — DERIVED. Do not hand-edit.

Every file here is overwritten by `tools/lab/chronicler.sh` on its next pass. An edit you make by hand
survives exactly until then, and in the meantime it is a lie with a `generated_at` stamp on it.

This is the tasty-lunch-wiki rule (blueprint 05 §1.4-1), and it is the only reason a regenerated hub
does not rot: **nobody edits it, so nobody has to maintain it.** To change what the page says, change
what the chronicler *reads* — or change the renderer in `tools/lab/ui/`.

Open `index.html` from `file://`. Each page is self-contained: no CDN, no fonts, no external script —
the data it needs is inlined at build time, because `file://` cannot `fetch()` a local JSON file.
There IS a little JavaScript, inlined: every page carries `generated_at` + max event age and RE-GRADES
itself fresh / stale / dead when you open it. A static file cannot age itself, so a chronicler that
died in the night would otherwise leave a page confidently reading "Live" forever. With JS off, the
build-time grade simply stands.

Built by `tools/lab/ui/` (TypeScript + Preact, server-rendered). If node is unavailable the pages are
NOT regenerated — they stay exactly as they were, under a red banner that says so. A stale page that
admits it is stale is the product; a fresh-looking page full of yesterday is the failure.
