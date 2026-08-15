# Pixel-perfect visual loop — runnable harness and field guide

Deep reference for lane 3 of `verifier-skeptic`. SKILL.md section 5 has the summary; this file has the
runnable `pixelmatch` harness, the nine-lens field guide, and the visual severity rubric.

## 1. The capture step (playwright-cli)

Both images MUST be captured at the same viewport and the same full-page flag, or `pixelmatch` throws
on a dimension mismatch. Standardize on one viewport per surface (1440×900 desktop, 390×844 mobile) and
capture shipped + prototype at exactly that size.

```bash
mkdir -p .artifacts/audit

# --- Shipped surface ---
playwright-cli -s=audit open --browser=chromium
playwright-cli -s=audit goto "http://localhost:3000/suppliers/plan"
playwright-cli -s=audit resize 1440 900
# Full-page capture through run-code (the plain screenshot command is viewport-only):
playwright-cli -s=audit run-code "async page => await page.screenshot({ path: '.artifacts/audit/plan-shipped-light.png', fullPage: true })"
# Dark theme — use the project's real switch (dataset.theme / a class / localStorage). Example:
playwright-cli -s=audit eval "document.documentElement.dataset.theme = 'dark'"
playwright-cli -s=audit run-code "async page => await page.screenshot({ path: '.artifacts/audit/plan-shipped-dark.png', fullPage: true })"

# --- Prototype counterpart (same viewport, file:// or Figma export) ---
playwright-cli -s=proto open --browser=chromium
playwright-cli -s=proto goto "file:///abs/path/reference/prototype_v3/suppliers-plan.html"
playwright-cli -s=proto resize 1440 900
playwright-cli -s=proto run-code "async page => await page.screenshot({ path: '.artifacts/audit/plan-prototype-light.png', fullPage: true })"
```

Reduce false positives before diffing: disable animations and mask genuinely dynamic regions
(timestamps, avatars, live counters) so they do not register as deltas.

```bash
# Freeze animations/transitions for a stable capture:
playwright-cli -s=audit run-code "async page => await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' })"
```

## 2. The diff step — pixelmatch (default for one-shot audits)

`pixelmatch` needs no committed baselines, runs in seconds, and writes a per-region diff PNG you attach
to the report as evidence. Write this script ad hoc in the project (or a scratch dir) and run it with
the project's Node. Dependencies: `pixelmatch` and `pngjs` (both tiny, zero-config).

```js
// visual-diff.mjs — usage: node visual-diff.mjs shipped.png prototype.png diff.png
import fs from "node:fs";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const [, , shippedPath, protoPath, diffPath] = process.argv;

const shipped = PNG.sync.read(fs.readFileSync(shippedPath));
const proto = PNG.sync.read(fs.readFileSync(protoPath));

if (shipped.width !== proto.width || shipped.height !== proto.height) {
  console.error(
    `DIMENSION MISMATCH: shipped ${shipped.width}x${shipped.height} vs proto ${proto.width}x${proto.height}. ` +
    `Re-capture both at the same viewport + fullPage flag.`,
  );
  process.exit(2);
}

const { width, height } = shipped;
const diff = new PNG({ width, height });

const diffPixels = pixelmatch(shipped.data, proto.data, diff.data, width, height, {
  threshold: 0.1,     // per-pixel YIQ tolerance; lower = stricter. 0.1 is a good adversarial default.
  includeAA: false,   // ignore anti-aliasing noise
  diffColor: [255, 0, 0],
});

fs.writeFileSync(diffPath, PNG.sync.write(diff));

const totalPixels = width * height;
const ratio = diffPixels / totalPixels;
console.log(JSON.stringify({
  shipped: shippedPath, proto: protoPath, diff: diffPath,
  diffPixels, totalPixels, ratio: Number(ratio.toFixed(5)),
}));
```

```bash
node visual-diff.mjs \
  .artifacts/audit/plan-shipped-light.png \
  .artifacts/audit/plan-prototype-light.png \
  .artifacts/audit/plan-diff-light.png
# => {"shipped":"...","proto":"...","diff":"...","diffPixels":18422,"totalPixels":1296000,"ratio":0.01422}
```

**Reading the output:** `diffPixels`/`ratio` is a TRIAGE SIGNAL telling you WHERE to look, never a
verdict by itself. Open the diff PNG (red pixels = deltas), find the region that lit up, then name the
specific lens and measure the delta by hand. A layout shift can throw a huge ratio for a tiny cause
(one wrong margin cascades); a critical colour-token error can be a low ratio. Always convert a
lit-up diff into a named, measured finding — do not file "ratio 0.014" as a finding.

## 3. Playwright toHaveScreenshot — only if baselines already exist

`toHaveScreenshot()` is the right tool for CI regression and the wrong tool for a one-shot audit: it
requires committed `.png` baselines and a test harness. Use it only when the project already has visual
baselines wired. If you do use it, the tuning that matters:

```js
await expect(page).toHaveScreenshot("plan.png", {
  maxDiffPixelRatio: 0.01,   // allow up to 1% of pixels to differ
  threshold: 0.2,            // per-pixel YIQ tolerance (default 0.2)
  animations: "disabled",
  mask: [page.locator("[data-testid=avatar]"), page.locator("time")],
});
```

For a fresh audit with no baselines, prefer the `pixelmatch` script above — it gives you the same
per-pixel comparison plus a diff artifact without committing anything to the repo.

## 4. Nine-lens field guide

Run every lens against the side-by-side (and again in dark mode). For each lens, the tell and how to
measure it:

1. **Component fidelity** — is the correct DS component used, or a hand-rolled look-alike? Tell:
   inspect the DOM (`playwright-cli -s=audit snapshot`) for the DS class/data-attr the prototype uses;
   a bespoke `<div>` where the DS `<Button>` should be is a finding even if it looks identical.
2. **Layout and structure** — columns, sections, grid, region order. Tell: overlay the two full-page
   shots; a shifted or missing region is the highest-ratio diff and usually the most important.
3. **Spacing and density** — paddings, gaps, gutters. Tell: measure with
   `eval "el => getComputedStyle(el).padding"` (or `.gap`, `.marginTop`) on the same element in both.
   Delta > ~4px is a finding.
4. **Typography** — size, weight, tracking, case, family, line-height. Tell:
   `eval "el => { const s = getComputedStyle(el); return [s.fontSize, s.fontWeight, s.letterSpacing, s.lineHeight, s.fontFamily, s.textTransform] }"` on both. Any mismatch is a finding; CAPS-vs-Title-Case is a common one.
5. **Colour and tokens** — fills, borders, state colours. Tell: read computed `color`/`backgroundColor`/
   `borderColor`, convert to a comparable space; perceptual delta > ~2% is a finding. Eyeballing colour
   is unreliable — measure it.
6. **Radius, elevation, shadows** — `eval` `borderRadius`, `boxShadow`. Any mismatch is a finding.
7. **State affordances** — hover, focus, active, disabled, empty, loading, error. Tell: drive each state
   (`playwright-cli hover`, focus via keyboard, load an empty dataset) and screenshot it. The happy-path
   capture never shows these, so this lens finds what a casual look misses.
8. **Motion** — transitions, easing, duration. Tell: `eval` `transitionDuration`/`transitionTimingFunction`;
   compare against the prototype's declared motion. Missing or wrong easing is a finding.
9. **Dark-theme parity** — repeat lenses 1-8 in dark mode. Dark is the single most common place a
   shipped surface silently diverges (a token that only got a light value, a hard-coded hex).

## 5. Visual severity rubric

Classify each visual finding so the fix agent can triage:

1. **CRITICAL** — the surface is unusable or unrecognizable versus the design: a whole region missing,
   text unreadable against its background, a broken layout at the target viewport, an interactive
   affordance invisible.
2. **MAJOR** — clearly wrong and user-noticeable: wrong DS component, wrong colour token, spacing off by
   enough to break rhythm, a state (empty/error) that renders wrong, dark-mode parity broken.
3. **MINOR** — measurable but subtle: a few px of spacing, a slightly-off radius, tracking, a motion
   easing mismatch. Still file it (over-report), just labeled MINOR.

Document the technique that produced each finding (`pixelmatch`, `playwright + manual`, `manual`) in the
finding's `technique` field so a reviewer can reproduce it.
