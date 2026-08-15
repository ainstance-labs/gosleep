# i18n workflow — English primary, Russian as a translation shell

The report is authored **once in English** and translated **once into Russian** at
generation time into two static files that share one asset folder:

```
docs/reports/<slug>/
  index.html        <- English (the primary; authored from the payload directly)
  ru/index.html     <- Russian (rendered from templates/ru-shell.html)
  assets/           <- shared screenshots + styles.css + lightbox.js (referenced by BOTH)
```

There is **no runtime translation** and **no auto-translation**. The Russian strings
come only from `payload.translations.ru`, which a human or an upstream translator
populates. Anything absent falls back to the English string, so the ru/ page always
renders fully — it is never broken by a missing key.

## Why build-time, not runtime

- Zero dependencies: no i18n library, no dictionary fetch, no `fetch()` at all.
- Works offline from `file://` — both files are complete on their own.
- A missing translation degrades to English inline, not to an empty node.
- Diff-friendly: reviewers can read the two HTML files side by side.

## Translation key convention

`translations.ru` is a flat map of dotted/bracketed paths into the payload:

| Key pattern                                   | Translates                                  |
|-----------------------------------------------|---------------------------------------------|
| `meta.title`                                  | report title (header + `<title>`)           |
| `meta.subtitle`                               | subtitle line                               |
| `verdict.level`                               | the level pill text                         |
| `verdict.summary`                             | the hero lead paragraph, if you use one     |
| `findings[N].title`                           | finding N's title (N = the finding number)  |
| `findings[N].area`                            | finding N's area tag                        |
| `findings[N].description`                     | finding N's body (Markdown allowed)         |
| `findings[N].screenshots[M].caption`          | caption of screenshot M (0-based) in N      |
| `architecture_notes[K].title`                 | architecture note K's title (0-based)       |
| `architecture_notes[K].body`                  | architecture note K's body                  |

`N` matches the finding's own `number` field (1-based, integer). `M` and `K` are
0-based array indices. UI chrome (section titles, button labels, the `Total` tile
label) is NOT in this map — it is baked into `templates/ru-shell.html` already. Only
data strings live in `translations.ru`.

Note what is **absent** from the table by design: there is no `findings[N].severity`
key and no `findings[N].lane` key. Those are terms, not data (see the next section) —
the resolver must not offer a path that can break the never-translate rule. If a
payload ships one anyway, **drop it and emit the constant**; do not honor it.

## Per-string fallback (the resolver)

For every translatable string, resolve in this order:

```
ru_value = translations.ru[key]  ??  english_value
```

Pseudo-code the renderer follows when building the ru/ findings HTML:

```
function t(payload, key, englishValue) {
  const dict = (payload.translations && payload.translations.ru) || {};
  const v = dict[key];
  return (v === undefined || v === null || v === "") ? englishValue : v;
}

// e.g. finding 1 title:
const ruTitle = t(payload, "findings[1].title", finding.title);
```

Never emit an empty string when a key is missing — always the English original. A
half-translated report is expected and acceptable; a blank card is a bug.

## Severity / lane / status terms — NEVER translated, in any language

These are **terms of art, not words.** They render as English constants in every
locale, identical to the enum the payload and the `data-severity` attribute carry:

| Kind     | The constants — literal in EVERY locale            |
|----------|----------------------------------------------------|
| Severity | `CRITICAL` · `MAJOR` · `MINOR`                      |
| Lane     | `architecture` · `functionality` · `design`        |
| Status   | `LANDED` · `PARTIAL` · `NOT-LANDED`                |

The visible term IS the constant: a badge's text equals its own `data-severity`
attribute in the Russian shell exactly as in the English one. `styles.css` already
uppercases `.badge`, `.lane-tag` and `.count-tile .k`, so this changes only the
Russian shell — the English design is untouched.

**Never emit** `Критично` / `Существенно` / `Незначительно` — not in a badge, not in
a count tile, not in a heading, not in prose. Translating a term forks the
vocabulary: the report says one thing while the payload, the `data-severity`
attribute, the Jira label and the fix agent's JQL all say another, and the term
stops being greppable across locales.

What DOES translate around them:

| Slot                        | Translates? | Russian                         |
|-----------------------------|-------------|---------------------------------|
| Count-tile `.k` = severity  | NO          | `CRITICAL` / `MAJOR` / `MINOR`  |
| Count-tile `.k` = `Total`   | yes         | `Всего` (not a term)            |
| `.badge` text               | NO          | `CRITICAL`                      |
| `.lane-tag` text            | NO          | `functionality`                 |
| `.area-tag` text            | yes         | free prose, via `findings[N].area` |
| Prose mentioning a term     | yes, around | "2 findings уровня CRITICAL блокируют релиз" |

The sentence is Russian; the token inside it is not.

## Adding a third language later

Copy `ru-shell.html` to e.g. `de-shell.html`, translate the chrome, add a
`translations.de` map with the same key convention, render to `<slug>/de/index.html`,
and add its link to every shell's language switch. The resolver and asset sharing are
unchanged. Keep English as the canonical fallback for every language.

The never-translate rule is **language-independent**: `CRITICAL` stays `CRITICAL` in
German, Spanish, and every locale added later — never `KRITISCH`, never `CRÍTICO`.
Only the chrome and the free prose around the terms get translated.

## What the invoker must NOT do

- Do NOT machine-translate to fill `translations.ru`. Leave the key absent -> English
  fallback. A wrong translation is worse than an honest English fallback.
- Do NOT duplicate screenshots or CSS/JS into `ru/`. Both files point at the same
  `assets/` via `{{ASSETS_PATH}}` (`../assets/` under ru/).
- Do NOT translate the Jira keys, `data-severity` enums, file:line refs, or the
  finding numbers — those are identifiers, identical across languages.
- Do NOT translate the severity / lane / status TERMS themselves (`CRITICAL`,
  `MAJOR`, `MINOR`, `architecture`, `functionality`, `design`, `LANDED`, `PARTIAL`,
  `NOT-LANDED`) — they are English constants in every locale. Translate the prose
  around them.
