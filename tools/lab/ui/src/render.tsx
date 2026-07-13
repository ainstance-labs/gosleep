// =============================================================================
// The SSG entry. A PURE FUNCTION: bundle in, {filename: html} out. It touches no file, creates no
// directory, and writes nothing.
//
// That is deliberate. Every byte the laboratory commits goes through tools/lab/lab-write.sh, which
// writes to a temp and renames — so a reader always sees the whole old file or the whole new one,
// never a prefix. A node process that dies halfway through page five must not be able to leave a
// half-written dashboard behind, and the cheapest way to guarantee that is to never give it the
// filesystem. Python takes this map and writes it, atomically, through the one tool that cannot tear
// a file. It also means --dry-run needs no cooperation from the renderer at all: Python simply does
// not write what it was handed.
// =============================================================================

import type { RenderBundle } from "./types.js";
import { renderPage } from "./page.js";
import { Overview } from "./screens/overview.js";
import { Timeline } from "./screens/timeline.js";
import { Library } from "./screens/library.js";

export function renderAll(b: RenderBundle, clientJs: string): Record<string, string> {
  if (b.schema !== "gosleep.lab.render/1") {
    // Fail loudly at build time. A screen reading a field the producer stopped emitting would
    // otherwise render a blank card, and a blank card at 03:00 looks exactly like "nothing happened".
    throw new Error(`render_bundle schema mismatch: got ${String(b.schema)}, want gosleep.lab.render/1`);
  }
  return {
    "index.html": renderPage({
      title: "Laboratory",
      screen: "index",
      bundle: b,
      body: <Overview b={b} />,
      clientJs,
    }),
    "timeline.html": renderPage({
      title: "Timeline",
      screen: "timeline",
      bundle: b,
      body: <Timeline b={b} />,
      clientJs,
    }),
    "library.html": renderPage({
      title: "Library",
      screen: "library",
      bundle: b,
      body: <Library b={b} />,
      clientJs,
    }),
  };
}
