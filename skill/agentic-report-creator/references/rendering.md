# Rendering reference — the exact HTML for each slot

The invoking skill builds three HTML strings and drops them into the template slots:
`{{SUMMARY_HTML}}`, `{{FINDINGS_HTML}}`, `{{ARCHITECTURE_HTML}}`. This file is the
canonical markup for each. Copy these shapes; the classes are already styled in
`templates/styles.css`. `references/demo.html` renders all of them live.

Escape any user/data string that goes into HTML text (`&` `<` `>` `"`), and render
the `description` field's Markdown to safe HTML (paragraphs, `code`, lists, links).

---

## 1. `{{SUMMARY_HTML}}` — executive summary (the hero card)

`--score` drives the donut; `data-band` picks its color (`good` ≥ 80, `warning`
40–79, `critical` < 40 — your call). The distribution bar segment widths are
percentages you compute from the counts. Omit the `.dist` block if you prefer.

```html
<div class="card hero">
  <div class="score-ring" style="--score: 73" data-band="warning">
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <circle class="track" cx="60" cy="60" r="52"></circle>
      <circle class="value" cx="60" cy="60" r="52"></circle>
    </svg>
    <div class="num"><b>73</b><span>/ 100</span></div>
  </div>
  <div>
    <h1>Suppliers V4 — pixel-perfect audit</h1>
    <p class="lead">Shipped <code>6b680ff</code> vs <code>reference/prototype_v3</code>.
       20 findings across architecture, functionality and design.</p>
    <div class="verdict-row">
      <span class="level-pill">MINOR-POLISH</span>
      <div class="counts">
        <div class="count-tile" data-severity="CRITICAL"><span class="n">2</span><span class="k">CRITICAL</span></div>
        <div class="count-tile" data-severity="MAJOR"><span class="n">11</span><span class="k">MAJOR</span></div>
        <div class="count-tile"><span class="n">7</span><span class="k">MINOR</span></div>
        <div class="count-tile"><span class="n">20</span><span class="k">Total</span></div>
      </div>
    </div>
    <div class="dist" role="img" aria-label="Severity distribution">
      <span class="seg-critical" style="width:10%"></span>
      <span class="seg-major" style="width:55%"></span>
      <span class="seg-minor" style="width:35%"></span>
    </div>
  </div>
</div>
```

Russian shell: translate `h1` and `.lead`. The severity `.k` labels stay the English
constants `CRITICAL` / `MAJOR` / `MINOR` — never `Критично` / `Существенно` /
`Незначительно` (see `i18n-workflow.md`). Only the non-term tile label translates:
`Total` → `Всего`. The count-tile `data-severity` attributes, the `.level-pill` text
(`verdict.level` is a term-like constant, e.g. `MINOR-POLISH`), and the `--score`
value never change between languages.

---

## 2. `{{FINDINGS_HTML}}` — one `.finding` card per finding

HARD RULE: `.finding-index` is a plain integer — `1`, `2`, `3`. Never `A`, never
`F1`. The Jira key sits right beside it in the same header line via `.jira-chip`.
The card `id="finding-1"` lets you deep-link and matches the lightbox group.

```html
<article class="card finding" id="finding-1">
  <div class="finding-head">
    <span class="finding-index">1</span>
    <span class="jira-chip">TLM-432</span>
    <span class="badge" data-severity="CRITICAL">CRITICAL</span>
    <span class="area-tag">Plan navigation</span>
    <span class="lane-tag">functionality</span>
  </div>
  <h3>Stage-nav shell absent from suppliers layout</h3>
  <div class="finding-body">
    <p>The prototype renders a persistent 01–04 stage rail across every Suppliers
       surface. The shipped layout drops it entirely…</p>
  </div>
  <div class="refs">
    <div class="ref-row"><span class="ref-k">Design</span><span class="ref-v">reference/prototype_v3/suppliers-v4.jsx (Sv4Plan)</span></div>
    <div class="ref-row"><span class="ref-k">Shipped</span><span class="ref-v">src/app/(app)/suppliers/plan/page.tsx:55-78</span></div>
  </div>
  <div class="shots">
    <figure class="shot">
      <img class="shot-img" src="assets/plan-shipped-light.png"
           alt="Shipped Plan header — no rail"
           data-lightbox-group="finding-1"
           data-caption="Shipped Plan header — no rail">
      <figcaption class="shot-cap">Shipped Plan header — no rail</figcaption>
    </figure>
    <figure class="shot">
      <img class="shot-img" src="assets/plan-prototype-light.png"
           alt="Prototype Plan header — 01–04 rail visible"
           data-lightbox-group="finding-1"
           data-caption="Prototype Plan header — 01–04 rail visible">
      <figcaption class="shot-cap">Prototype Plan header — 01–04 rail visible</figcaption>
    </figure>
  </div>
</article>
```

Rules:
- Every screenshot in ONE finding shares the same `data-lightbox-group="finding-<number>"`
  so the arrows walk only that finding's siblings.
- `data-caption` is what the lightbox shows; keep it equal to the visible `figcaption`.
- Screenshots optional: drop the whole `.shots` block if the finding has none.
- `.lane-tag` optional (`functionality` / `architecture` / `design`). Omit if absent.
  Like severity, a lane is a TERM — literal English in every locale.
- **Severity badge text IS the constant.** `.badge` text equals its own
  `data-severity` attribute — `CRITICAL`, not `Critical`, not `Критично` — in every
  locale. That equality is the invariant to check (SKILL.md section 11, step 6).
  `styles.css` uppercases `.badge` anyway, so the literal constant renders exactly as
  the English report always looked.
- `.area-tag` is NOT a term — it is free prose (`Plan navigation`) and DOES translate
  via `findings[N].area`.
- `assets/…` paths are relative to the HTML file. In `ru/index.html` prepend `../`
  (i.e. `../assets/…`) OR — simpler — reuse the same relative `assets/` string but
  set the `<base href="../">`. The renderer already knows `{{ASSETS_PATH}}`; use it.

---

## 3. `{{ARCHITECTURE_HTML}}` — optional architecture notes

Emit an empty string when there are no notes. Otherwise wrap the notes in a section:

```html
<section aria-labelledby="arch-h">
  <h2 class="section-title" id="arch-h">Architecture notes</h2>
  <article class="card arch-note">
    <h3>Stage state lives in three places instead of one</h3>
    <div class="arch-body">
      <p>The design implies a single source of truth for the active stage…</p>
    </div>
    <!-- Prefer an inline pre-rendered SVG (zero-dependency, always renders): -->
    <div class="diagram"><svg viewBox="0 0 320 80">…</svg></div>
    <!-- OR, if you only have mermaid source, show it as code (NO external lib): -->
    <pre>graph LR
  URL[URL segment] --> Ctx[React context]
  URL --> Store[Zustand store]</pre>
  </article>
</section>
```

The Russian shell uses the same section but title `Заметки по архитектуре` and
translated note titles/bodies where `translations.ru` supplies them.

Mermaid note: the report ships zero dependencies, so it does NOT bundle mermaid.js.
Either (a) pre-render the diagram to inline SVG at generation time and inline it in
`.diagram`, or (b) show the mermaid source in a `<pre>` as documentation. Never add
a CDN `<script>` for mermaid — it breaks the offline / file:// guarantee.
