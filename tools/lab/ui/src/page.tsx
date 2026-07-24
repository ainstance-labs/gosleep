import type { VNode } from "preact";
import { render } from "preact-render-to-string";
import type { RenderBundle } from "./types.js";
import { CSS } from "./theme.js";
import { VERDICTS } from "./verdicts.js";
import { Footer, Nav, PageControls, StaleBanner, type ScreenId } from "./components.js";

/**
 * Where Python injects the "UI build unavailable" banner when it could not run this renderer at all
 * (no node, no deps, esbuild blew up). Paired markers, not a single anchor, so the injection is
 * idempotent in BOTH directions: Python replaces whatever sits between them, and the next successful
 * render writes the empty pair back — the banner disappears exactly when it stops being true.
 *
 * Keep this string in sync with UI_DEGRADE_START/END in tools/lab/chronicler.py.
 */
export const DEGRADE_ANCHOR = "<!--UI-DEGRADE-START--><!--UI-DEGRADE-END-->";

/**
 * Inline data island. `</script>` inside a JSON string would close the tag early and turn the rest of
 * the page into script source — so escape `<`. (`<` is a legal JSON escape and parses back to
 * the same string, so no consumer notices.)
 */
function jsonIsland(id: string, value: unknown): string {
  const json = JSON.stringify(value).replace(/</g, "\\u003c");
  return `<script id="${id}" type="application/json">${json}</script>`;
}

export interface PageOpts {
  title: string;
  screen: ScreenId;
  bundle: RenderBundle;
  body: VNode;
  /** Extra data islands this screen's client code reads (timeline filters, etc.). */
  islands?: Record<string, unknown>;
  /** The bundled client script, already compiled to plain JS by esbuild. */
  clientJs: string;
}

export function renderPage(o: PageOpts): string {
  const shell = render(
    <>
      {/* GSL-109: title and nav are page CHROME and are grouped as chrome, so the eye crosses the
          band once and lands on the content. The nav itself is unchanged — see theme.ts on why its
          flex+wrap is load-bearing at 390px (GSL-100). */}
      <header class="masthead">
        <h1>{o.title}</h1>
        <Nav current={o.screen} />
        {/* GSL-209: the controls belong in the chrome band, with the nav — they act on the whole
            screen, not on any one section of it, and grouping them here is the same GSL-109 rule
            that put the title and the nav together: the eye crosses the band once. */}
        <PageControls />
      </header>
      <StaleBanner b={o.bundle} />
      <main>{o.body}</main>
      <Footer />
    </>,
  );

  const islands = Object.entries(o.islands ?? {})
    .map(([id, v]) => jsonIsland(id, v))
    .join("\n");

  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)} — gosleep lab</title>
<style>${CSS}</style>
${DEGRADE_ANCHOR}
${shell}
${jsonIsland("verdicts", VERDICTS)}
${islands}
<script>${o.clientJs}</script>
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
