# Design tokens

Every color/spacing decision in `templates/styles.css` is a CSS custom property so
the theme swaps in one place and the markup is written against roles, not raw hex.
The palette is lifted from the `dataviz` skill's validated chrome + status scales, so
the report reads as one system in both themes. To retarget a brand, change the values
here and in `styles.css` together — the class structure never changes.

## Surfaces + ink

| Role (`--var`)      | Light      | Dark       | Use                                   |
|---------------------|------------|------------|---------------------------------------|
| `--bg`              | `#f7f7f5`  | `#0d0d0d`  | page plane                            |
| `--surface`         | `#ffffff`  | `#161615`  | cards                                 |
| `--surface-2`       | `#fbfbfa`  | `#1f1f1e`  | insets: code chips, thumbnails, tiles |
| `--text`            | `#0b0b0b`  | `#f4f4f1`  | primary ink                           |
| `--text-2`          | `#52514e`  | `#c3c2b7`  | secondary ink (body, refs)            |
| `--text-3`          | `#898781`  | `#898781`  | muted (meta, captions, labels)        |
| `--border`          | `rgba(11,11,11,.10)`  | `rgba(255,255,255,.10)` | hairlines |
| `--border-strong`   | `rgba(11,11,11,.16)`  | `rgba(255,255,255,.16)` | index box, emphasis |

`--text-3` is intentionally identical in both themes — it clears contrast on both the
light and dark surfaces (it is the dataviz "muted axis" ink).

## Accent (single)

| Role               | Light     | Dark      | Use                          |
|--------------------|-----------|-----------|------------------------------|
| `--accent`         | `#2a78d6` | `#3987e5` | links, jira chip, level pill, score ring, focus |
| `--accent-contrast`| `#ffffff` | `#0b0b0b` | text on the accent fill      |
| `--ring`           | `rgba(42,120,214,.40)` | `rgba(57,135,229,.50)` | focus ring |

One accent only. Do not introduce a second brand hue — severity carries all the other
color meaning.

## Severity (badges + tiles)

Same hue FAMILY in both themes (red / amber / neutral); only lightness + alpha shift
for the surface, so a badge never changes what it means when the theme flips. Each
severity has a soft background tint, a readable foreground, and a hairline border.

| Severity   | `--sev-*-bg` (light / dark)                         | `--sev-*-fg` (light / dark) |
|------------|-----------------------------------------------------|------------------------------|
| CRITICAL   | `rgba(208,59,59,.12)` / `rgba(230,103,103,.16)`     | `#b0231f` / `#ef9a9a`        |
| MAJOR      | `rgba(234,131,90,.16)` / `rgba(250,178,25,.14)`     | `#a2500f` / `#f2c14e`        |
| MINOR      | `rgba(11,11,11,.05)` / `rgba(255,255,255,.06)`      | `#52514e` / `#c3c2b7`        |

Driven by attribute: `.badge[data-severity="CRITICAL"]` etc. The `data-severity`
value is the UPPERCASE enum, and the visible badge text is that same constant
(`CRITICAL`) — identical in every language, never localized (SKILL.md section 9).
Color never carries severity alone — the term is always present beside it
(accessibility).

Mapping rationale (from dataviz status scale): CRITICAL→red `#d03b3b`/`#e66767`,
MAJOR→amber/serious `#fab219`/`#ec835a`, MINOR→neutral ink. On the light surface amber
sits below 3:1 as a fill, which is why MAJOR uses a soft tint + a darkened text
foreground rather than a saturated fill — the text foreground carries the contrast.

## Status accents (score ring band)

| Role        | Light     | Dark      | Band trigger (suggested) |
|-------------|-----------|-----------|--------------------------|
| `--good`    | `#0ca30c` | `#0ca30c` | score ≥ 80               |
| `--warning` | `#fab219` | `#fab219` | 40 ≤ score < 80          |
| `--critical`| `#d03b3b` | `#e66767` | score < 40               |

Set `data-band="good|warning|critical"` on `.score-ring` to color the donut arc. If
you omit `data-band`, the arc uses `--accent`.

## Shape, depth, motion

| Role        | Value                                                        |
|-------------|-------------------------------------------------------------|
| `--radius`  | `14px` (cards) · `--radius-sm` `9px` (tiles, thumbnails)     |
| `--shadow`  | light: `0 1px 2px rgba(11,11,11,.04), 0 4px 16px rgba(11,11,11,.06)` · dark: deeper, higher-alpha |
| `--maxw`    | `1080px` content column                                     |
| motion      | 0.15s ease on interactive states; 0.6s on the score arc; all disabled under `prefers-reduced-motion` |

## Typography

System sans only — no web fonts (offline guarantee):

```
--font: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
--mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
```

- Body 15px / 1.55. Section titles 12px uppercase, 0.08em tracking, muted.
- Finding titles ~16.5px, tight tracking (-0.01em).
- Numbers that must align (count tiles, finding index) use
  `font-variant-numeric: tabular-nums`.
- `--mono` only for identifiers: Jira keys, file:line refs, code, commit hashes.

## Retargeting checklist

1. Replace `--bg / --surface / --surface-2 / --text*` with the brand's neutrals (keep
   the light/dark contrast relationships).
2. Replace `--accent` (+ `--accent-contrast`, `--ring`) with the brand accent for both
   themes.
3. Keep severity in the red/amber/neutral families — those are semantic, not brand.
4. Re-check contrast on the actual surfaces (the `dataviz` skill ships
   `scripts/validate_palette.js`; its `contrast(a,b)` export checks a single pair).
5. Change values in `styles.css` and this file together; leave the class names alone.
