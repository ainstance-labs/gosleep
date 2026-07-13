# `docs/lab/site/` — DERIVED. Do not hand-edit.

Every file here is overwritten by `tools/lab/chronicler.sh` on its next pass. An edit you make by hand
survives exactly until then, and in the meantime it is a lie with a `generated_at` stamp on it.

This is the tasty-lunch-wiki rule (blueprint 05 §1.4-1), and it is the only reason a regenerated hub
does not rot: **nobody edits it, so nobody has to maintain it.** To change what the page says, change
what the chronicler *reads* — or change the chronicler.

Open `index.html` from `file://` (it is self-contained: no CDN, no fonts, no JS). Every page carries
`generated_at` + max event age and grades itself fresh / stale / dead, so a chronicler that died in
the night produces a page that SAYS it died — never a confident-looking page full of yesterday.
