---
name: agentic-report-creator
description: Turn a structured findings payload (JSON) into a professional HTML dashboard report — Vercel/Linear aesthetic, light + dark themes, English primary with a Russian translation shell, screenshots in a keyboard-navigable lightbox, and integer-numbered items that each name their Jira ticket. Zero dependencies, vanilla HTML/CSS/JS, opens offline from file://. Use when any agent needs a shareable HTML dashboard report, отчёт как дашборд, professional report, audit report HTML, verifier findings report, deployment audit, incident post-mortem, migration report, English + Russian report, or lightbox screenshots. Not for Markdown or PDF output.
---

# agentic-report-creator

Render a JSON findings payload into a self-contained HTML dashboard report. Any
agent that produces structured findings — an auditor, a verifier, a deployment
checker, an incident post-mortem, a migration report — calls this skill to get a
polished, shareable HTML page instead of hand-rolling markup. The report is a
professional dashboard (Vercel/Linear-style), themed for light and dark, bilingual
(English primary + a Russian translation shell), with screenshots that open in a
keyboard-driven lightbox and items numbered with plain integers that each cite a
Jira ticket.

The output is a static folder you can open from `file://`, host on any static
server, or attach to a ticket. No build step, no framework, no CDN, no network.

## 1. What this skill is

A **renderer**, not an investigator. It takes a validated payload of findings that
some other skill produced and emits HTML. It does not decide what the findings are,
does not touch application code, and does not call any model at render time. Give it
a payload, it gives you `docs/reports/<slug>/index.html` (+ a `ru/` sibling + shared
`assets/`). The templates and CSS/JS live under `templates/`; this file tells the
invoker how to fill them.

## 2. When to invoke

Invoke when an agent has a set of findings/observations and wants a shareable,
professional HTML report:

- A verifier/auditor produced a numbered findings list (the `verifier-skeptic` skill
  is the first caller, but this skill is generic).
- A deployment audit, security review, incident post-mortem, or migration report
  needs a durable, richer-than-Markdown artifact with evidence screenshots.
- The owner asks for "an HTML dashboard report", "отчёт как дашборд", "a professional
  report", "report with screenshots", "English + Russian report".
- A previous flow wrote a Markdown report to a gitignored `docs/reviews/` path and it
  had to be pasted into Jira — this HTML dashboard is the chosen replacement.

Do NOT invoke when:

- The deliverable is Markdown or PDF (use the relevant doc/PDF skill instead).
- There are no structured findings yet — do the investigation first, then render.
- The caller wants a chat summary, not a file — just answer in chat.
- You need charts/graphs as the primary content — this is a findings report, not a
  BI dashboard; for data viz, load the `dataviz` skill (this skill borrows its
  palette but is not a charting tool).

## 3. Contract

### Input — the findings payload (JSON)

One object. `meta`, `verdict`, and `findings` are required; the rest are optional.
This schema matches what `verifier-skeptic` emits and is generic enough for any
report type. Full worked example: `references/example-payload.json`.

```jsonc
{
  "meta": {
    "title":     "Suppliers V4 — pixel-perfect audit",   // required
    "subtitle":  "shipped vs reference/prototype_v3",     // optional
    "epic":      "TLM-360",                               // optional (Jira epic key)
    "date":      "2026-07-15",                            // required (YYYY-MM-DD)
    "auditor":   "verifier-skeptic",                      // optional (who produced it)
    "shipped_at":"6b680ff",                               // optional (commit/build)
    "lang":      "en"                                     // optional, default "en"
  },
  "verdict": {
    "score":  73,                                         // optional 0..100
    "level":  "MINOR-POLISH",                             // required (free string)
    "band":   "warning",                                  // optional: good|warning|critical
    "counts": { "critical": 2, "major": 11, "minor": 7 } // required
  },
  "findings": [
    {
      "number":       1,                                  // required, plain integer, 1-based
      "jira":         "TLM-432",                          // required (ticket key; "" if none)
      "severity":     "CRITICAL",                         // required: CRITICAL|MAJOR|MINOR
      "area":         "Plan navigation",                  // required (short domain label)
      "lane":         "functionality",                    // optional: architecture|functionality|design
      "labels":       ["verifier", "functionality"],      // optional (informational)
      "title":        "Stage-nav shell absent",           // required (one line)
      "description":  "Markdown or plain text …",          // required (rendered as Markdown)
      "prototype_ref":"reference/…jsx (Sv4Plan)",         // optional (design source ref)
      "shipped_ref":  "src/…/page.tsx:55-78",             // optional (shipped code ref)
      "screenshots": [                                    // optional array
        { "caption": "Shipped — no rail", "src": "assets/plan-shipped-light.png" },
        { "caption": "Prototype — rail",  "src": "assets/plan-prototype-light.png" }
      ]
    }
  ],
  "architecture_notes": [                                 // optional array
    {
      "title": "Stage state lives in three places",
      "body":  "Markdown or plain text …",                 // optional
      "diagram_svg": "<svg …>…</svg>",                    // optional (preferred, inline)
      "diagram_mermaid": "graph LR; A-->B"                // optional (shown as code if no svg)
    }
  ],
  "translations": {                                       // optional (see section 9)
    "ru": {
      "meta.title": "Suppliers V4 — pixel-perfect аудит",
      "findings[1].title": "Отсутствует rail этапов 01–04",
      "findings[1].description": "…"
    }
  }
}
```

Field aliases (accept either; canonical is on the left): `description` = `description_md`;
`diagram_mermaid` = `mermaid`; `diagram_svg` = `svg`. Prefer the canonical names.

**Validate before rendering** (see section 11). Reject a payload missing
`meta.title`, `meta.date`, `verdict.level`, `verdict.counts`, or a non-empty
`findings` array. Reject any `findings[].number` that is not a positive integer, any
`severity` outside `CRITICAL|MAJOR|MINOR`, and any `findings[].jira` that is absent
(empty string is allowed only when the finding genuinely has no ticket yet).

### Output — filesystem layout

```
docs/reports/<slug>/
  index.html          English report (the primary)
  ru/
    index.html        Russian translation shell (shares ../assets)
  assets/
    styles.css        copied from templates/styles.css
    lightbox.js       copied from templates/lightbox.js
    <screenshot>.png  every findings[].screenshots[].src file
```

`<slug>` is kebab-case and stable, e.g. `audit-tlm-360-2026-07-15`. Screenshots are
referenced by BOTH `index.html` and `ru/index.html` via `{{ASSETS_PATH}}` — never
duplicated into `ru/`.

Do NOT write the report into a gitignored path (`docs/reviews/` on most projects is
gitignored). `docs/reports/` is the convention here; confirm it is not gitignored,
or deliver via `file://` path + Jira attachment. Never force-add.

## 4. Design principles

- **HTML, always.** Not Markdown, not PDF. Rich, interactive, shareable, offline.
- **Dashboard aesthetic.** Professional and calm — Vercel/Linear, not a Word doc or a
  blog post. Generous whitespace, a tight type scale, hairline borders, soft shadows,
  one accent color, restrained severity tints. Content over chrome.
- **Zero dependencies.** No React/Vue, no build step, no CDN scripts, no external
  fonts, no runtime `fetch`. System font stack only. Everything inlines or links a
  relative-path asset. The report must open from a local file and work fully offline.
- **Self-contained + relative.** Assets are either inlined or referenced by relative
  path within the report folder. Nothing points outside the folder.
- **Theme-aware.** Light and dark both look intentional; follow `prefers-color-scheme`
  and honor a manual override (section 7).
- **Evidence-first.** Every visual finding shows its screenshots; the lightbox makes
  them inspectable at full size (section 8).
- **Accessible.** Semantic landmarks, focus-visible rings, a focus-trapped modal,
  `prefers-reduced-motion` respected, severity never encoded by color alone (always a
  text label beside the tint).

The palette is borrowed from the `dataviz` skill's validated chrome + status scales
(neutral ink/surfaces, blue accent, red/amber/neutral severity) so it reads as one
system in both themes. Details: `references/design-tokens.md`.

## 5. Report structure

Sections render in this fixed order (mirrored in `templates/dashboard.html`):

1. **Header** (sticky) — report title + subtitle on the left; on the right the epic
   chip, the date, the language switch (`EN ⇄ RU`), and the theme toggle.
2. **Executive summary** — one hero card: a score donut (if `verdict.score` present),
   the level pill, and count tiles (`CRITICAL` / `MAJOR` / `MINOR` / Total) with an
   optional severity distribution bar. This is the at-a-glance verdict. The three
   severity labels are constants in every locale; only `Total` translates (section 9).
3. **Findings** — one card per finding, in `number` order. Each card: header line
   (number · Jira key · severity badge · area · lane), title, description, source
   refs (design/shipped), and a screenshot grid. This is the body of the report.
4. **Architecture notes** (optional) — cards with a title, prose, and an optional
   inline SVG diagram (or mermaid source shown as a code block). Omit the whole
   section if `architecture_notes` is empty.
5. **Footer** — generation metadata: who/what generated it, timestamp, audited build.

Exact HTML for the summary, finding, and architecture fragments:
`references/rendering.md`. A fully rendered live example: `references/demo.html`.

## 6. Numbering convention — HARD RULE

**Numbered items use plain integers only: 1, 2, 3, …** This is non-negotiable.

- NEVER letters (`A, B, C`). NEVER prefixed forms (`F1`, `#3`, `No.3`, `item-a`).
  NEVER Roman numerals. The visible index is a bare integer, rendered in
  `.finding-index`.
- **Every numbered item names its Jira ticket on the same header line.** The integer
  is only an ordering index; the Jira key (`.jira-chip`, e.g. `TLM-432`) is the
  semantic identifier and sits immediately beside the number. A number without its
  ticket beside it is a defect.
- The finding's `number` field drives the visible index, the card `id="finding-<n>"`,
  the lightbox group `data-lightbox-group="finding-<n>"`, and the translation keys
  `findings[<n>].*`. Keep them all equal to the same integer.
- If a finding truly has no ticket yet, show the number and an empty/placeholder chip —
  still never a letter. But findings from `verifier-skeptic` always carry a `verifier`
  ticket; expect a real key.

Russian, German, any language: the number and Jira key are identical across
languages — they are identifiers, never translated.

## 7. Theme system

Light is the default; dark is a full sibling. Resolution order (implemented in
`templates/styles.css`):

1. `:root` — light tokens.
2. `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` — dark tokens
   when the OS prefers dark AND the user has not forced light.
3. `:root[data-theme="dark"]` — dark tokens always (manual override wins).
4. `:root[data-theme="light"]` — light tokens always (manual override wins).

The manual toggle is a header button. A tiny inline script in the `<head>` (in
`dashboard.html`/`ru-shell.html`) reads `localStorage["arc-theme"]` and stamps
`data-theme` on `<html>` **before first paint** (no flash of the wrong theme), then
wires the button on `DOMContentLoaded` to flip and persist the choice. This is the
only inline theme JS; it has no dependency.

Every token is defined for both themes. Severity tints keep the same hue family
across themes (red / amber / neutral), adjusting lightness and alpha for the surface —
never a drastic hue change. Token tables: `references/design-tokens.md`.

## 8. Screenshots + lightbox

`templates/lightbox.js` (vanilla, ~140 lines, no globals) drives evidence viewing:

- Each thumbnail is `<img class="shot-img" data-lightbox-group="finding-<n>"
  data-caption="…" src="assets/…">`. All screenshots of one finding share that
  finding's group so navigation stays within the finding.
- Click a thumbnail → full-screen overlay showing that image, with a caption row and a
  counter (`2 / 4`).
- `←` / `→` on-screen buttons AND `ArrowLeft` / `ArrowRight` keys walk siblings within
  the same group (wrapping at the ends). Buttons hide when a group has one image.
- `Escape`, the `✕` button, or a click outside the image closes the overlay.
- Focus is trapped among the overlay controls while open and restored to the clicked
  thumbnail on close. Body scroll is locked while open.
- Optional `data-full="assets/…-hi.png"` on a thumbnail supplies a higher-res source
  for the overlay; it falls back to `src`.

The JS auto-initializes on load; the invoker only emits the markup. No configuration.

## 9. i18n workflow

English is authored directly from the payload. Russian is a **translation shell**
built at generation time — not runtime, not machine-translated.

- Two static files share one asset folder: `index.html` (English) and
  `ru/index.html` (Russian, from `templates/ru-shell.html`).
- The Russian file's UI chrome (section titles, buttons, count-tile prose) is
  Russian, baked into `ru-shell.html` — but NOT the classification terms, which stay
  English constants in every locale (see the hard rule below). The DATA strings come
  from `payload.translations.ru` keyed by path (`meta.title`, `findings[1].title`,
  `findings[1].description`, `findings[1].screenshots[0].caption`,
  `architecture_notes[0].title`, …).
- **Per-string English fallback.** For every translatable string,
  `ru = translations.ru[key] ?? english`. A missing key falls back to the English
  original so the ru/ page always renders in full — never a blank node. A
  half-translated report is fine.
- NO auto-translation. If `translations.ru` is absent entirely, `ru/index.html` still
  renders — every string falls back to English, giving a valid (all-English) page
  under Russian chrome. Populate real translations only from a human/translator.
- Identifiers (Jira keys, `data-severity` enums, file:line refs, finding numbers) are
  never translated.

### Severity terminology is NEVER translated — HARD RULE

> **Severity terminology is NEVER translated.** `CRITICAL / MAJOR / MINOR` are
> industry-standard classifications that stay in English in every locale. Same for
> lane labels (`architecture / functionality / design`) and status labels
> (`LANDED / PARTIAL / NOT-LANDED`). Translate free prose around them; keep the terms
> literal.

These are **terms of art, not words.** A reader scanning a Russian report for
`CRITICAL` must find `CRITICAL` — the same token the payload, the `data-severity`
attribute, the Jira label and the fix agent's JQL all use. Translating it to
`Критично` forks the vocabulary: the report says one thing, every machine-readable
surface says another, and the term stops being greppable across locales.

The rule, concretely:

- **Never emit** `Критично` / `Существенно` / `Незначительно`, or any other locale's
  rendering of a severity, lane, or status term. Not in the badge, not in a count
  tile, not in a heading, not in prose.
- **The visible term IS the constant.** Render `CRITICAL`, `MAJOR`, `MINOR` literally
  — the badge's text equals its own `data-severity` attribute, in every locale. That
  equality is the invariant to check (section 11, step 6). `styles.css` already
  applies `text-transform: uppercase` to `.badge`, `.lane-tag` and `.count-tile .k`,
  so the literal constant is exactly what the English report already renders: this
  rule changes the Russian shell, not the English design.
- **Lane labels** (`architecture`, `functionality`, `design`) and **status labels**
  (`LANDED`, `PARTIAL`, `NOT-LANDED`) follow the identical rule in `.lane-tag` and any
  status chip.
- **The `area` field is NOT a term** — it is a free-prose domain label
  (`"Plan navigation"`) and it DOES translate via `findings[N].area`.
- **Translate the prose around the term.** "2 CRITICAL findings block the release" →
  "2 findings уровня CRITICAL блокируют релиз". The sentence is Russian; the token is
  not. Count-tile prose that is not a term — `Total` → `Всего` — still translates.
- **A translation key that targets a term is ignored, not honored.** If a payload
  ships `translations.ru["findings[1].severity"]`, drop it and emit the constant. The
  resolver must not offer a path that can break this rule.

Full key convention, resolver pseudo-code, and how to add a third language:
`references/i18n-workflow.md`.

## 10. Templates reference

Everything under `templates/` is what you copy/fill. Slots are `{{DOUBLE_BRACE}}`.

| File            | Purpose                                                                 |
|-----------------|-------------------------------------------------------------------------|
| `dashboard.html`| English report skeleton. Slots: `{{LANG}}`, `{{TITLE}}`, `{{SUBTITLE}}`, `{{DATE}}`, `{{EPIC}}`, `{{ASSETS_PATH}}`, `{{SUMMARY_HTML}}`, `{{FINDINGS_HTML}}`, `{{ARCHITECTURE_HTML}}`, `{{AUDITOR}}`, `{{SHIPPED_AT}}`, `{{GENERATED_AT}}`. English chrome + language switch to `ru/index.html`. |
| `ru-shell.html` | Russian shell. Same slots; Russian chrome; `{{ASSETS_PATH}}` = `../assets/`; language switch to `../index.html`. |
| `styles.css`    | All design tokens (light + dark), cards, hero/score ring, findings, severity badges, screenshot grid, lightbox, responsive + print rules. Link it as `assets/styles.css` or inline it in a `<style>`. |
| `lightbox.js`   | Vanilla screenshot lightbox: click-to-open, `← →` keys/buttons, ESC / click-outside close, focus trap. Link it as `assets/lightbox.js` or inline it in a `<script>`. |

Slot substitution — either linked assets (default) or fully inlined. Minimal example:

```js
// 1. Build the three HTML strings (see references/rendering.md for exact markup).
const summaryHtml = renderSummary(payload);       // hero card
const findingsHtml = payload.findings.map(renderFinding).join("\n");
const archHtml = renderArchitecture(payload);     // "" if no notes

// 2. Read the skeleton and substitute slots (global replace per slot).
let html = read("templates/dashboard.html");
const slots = {
  LANG: payload.meta.lang || "en",
  TITLE: esc(payload.meta.title),
  SUBTITLE: esc(payload.meta.subtitle || ""),
  DATE: esc(payload.meta.date),
  EPIC: esc(payload.meta.epic || ""),
  ASSETS_PATH: "assets/",                          // "../assets/" for ru/index.html
  SUMMARY_HTML: summaryHtml,
  FINDINGS_HTML: findingsHtml,
  ARCHITECTURE_HTML: archHtml,
  AUDITOR: esc(payload.meta.auditor || "agentic-report-creator"),
  SHIPPED_AT: esc(payload.meta.shipped_at || "—"),
  GENERATED_AT: esc(generatedAtString),            // pass in; do not invent a clock
};
for (const [k, v] of Object.entries(slots)) html = html.split(`{{${k}}}`).join(v);
write(`docs/reports/${slug}/index.html`, html);
```

`esc()` escapes `& < > "` for values placed in HTML text/attributes. `SUMMARY_HTML`,
`FINDINGS_HTML`, `ARCHITECTURE_HTML` are already-built HTML — do not escape those, but
DO escape every data string while building them, and render `description` Markdown to
safe HTML (paragraphs, inline `code`, lists, links).

## 11. Generation procedure (for the invoking skill)

1. **Validate the payload.** Enforce required fields (section 3). Fail fast with a
   clear message if `findings` is empty, a `number` is not a positive integer, a
   `severity` is out of range, or `meta.title`/`meta.date`/`verdict` are missing.
   Deduplicate/So­rt findings by `number` ascending.
2. **Choose the slug + create the folder.** `docs/reports/<slug>/` with `assets/` and
   `ru/`. Slug is kebab-case and stable (e.g. `audit-<epic>-<date>`). Confirm the path
   is not gitignored.
3. **Write assets.** Copy `templates/styles.css` → `assets/styles.css` and
   `templates/lightbox.js` → `assets/lightbox.js`. Copy every
   `findings[].screenshots[].src` file into `assets/` and rewrite each `src` to the
   in-report relative path (`assets/<file>`). If a screenshot file is missing, drop
   that screenshot (do not emit a broken `<img>`) and note it.
4. **Render English `index.html`.** Build `SUMMARY_HTML`, `FINDINGS_HTML`,
   `ARCHITECTURE_HTML` from `references/rendering.md`; substitute slots in
   `dashboard.html` with `ASSETS_PATH="assets/"`; write
   `docs/reports/<slug>/index.html`.
5. **Render Russian `ru/index.html`.** Same finding/summary/arch builders, but resolve
   every translatable string through `translations.ru[key] ?? english` (section 9);
   substitute slots in `ru-shell.html` with `ASSETS_PATH="../assets/"`; write
   `docs/reports/<slug>/ru/index.html`. This step ALWAYS runs, even with no
   translations (all-English fallback under Russian chrome).
6. **Self-check.** Open both files (or read them back): valid HTML, no leftover
   `{{SLOT}}` markers, every finding shows an integer index with its Jira key beside
   it, screenshots resolve, the language switch and theme toggle are present. If you
   can drive a browser, verify the lightbox opens and `← →`/keys navigate, and
   toggle the theme once in each direction.
7. **Report back.** `SendMessage` to the caller with: the report path
   (`docs/reports/<slug>/index.html`), the counts by severity, and a one-line note on
   any dropped screenshots or missing translations. If Jira attachment is wanted, the
   caller (or `using-jira`) attaches the rendered files; this skill does not touch
   Jira.

Timestamps: this skill never fabricates a clock. The invoker passes `GENERATED_AT`
(and `meta.date`) as strings read from the shell (`date -u +"%Y-%m-%d %H:%M UTC"`).

## 12. Related skills

- `verifier-skeptic` — the first producer of payloads for this skill; emits numbered
  findings + Jira tickets and delegates HTML rendering here.
- `using-jira` — Jira key formats linked in findings, and the `ATLASSIAN_API_TOKEN`
  REST recipe if the caller wants to attach the rendered report to a ticket.
- `dataviz` — source of the validated color tokens (chrome + status scales) this
  report reuses; load it when a report needs actual charts.
- `orchestrating-delivery-agents` — the orchestration context that spawns report-
  producing workers; a worker's brief points it at this skill for the deliverable.
- `handoff` — a different durable artifact (resume-state Markdown), not a report;
  don't confuse the two.
```
