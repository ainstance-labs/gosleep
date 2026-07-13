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

import type { VNode } from "preact";
import type { RenderBundle } from "./types.js";
import { renderPage } from "./page.js";
import { SCREENS, type ScreenId } from "./components.js";
import { Overview } from "./screens/overview.js";
import { Timeline } from "./screens/timeline.js";
import { Tasks } from "./screens/tasks.js";
import { Questions } from "./screens/questions.js";
import { Fleet } from "./screens/fleet.js";
import { Cost } from "./screens/cost.js";
import { Library } from "./screens/library.js";

const SCHEMA = "gosleep.lab.render/2";

/** One body per screen id. The nav is generated from SCREENS, so a screen listed there and missing
 *  here is a 404 — which is why the loop below builds from SCREENS and would throw on a gap. */
const BODIES: Record<ScreenId, (b: RenderBundle) => VNode> = {
  index: (b) => <Overview b={b} />,
  timeline: (b) => <Timeline b={b} />,
  tasks: (b) => <Tasks b={b} />,
  questions: (b) => <Questions b={b} />,
  fleet: (b) => <Fleet b={b} />,
  cost: (b) => <Cost b={b} />,
  library: (b) => <Library b={b} />,
};

const TITLES: Record<ScreenId, string> = {
  index: "Laboratory",
  timeline: "Timeline",
  tasks: "Tasks",
  questions: "Questions",
  fleet: "Fleet",
  cost: "Cost",
  library: "Library",
};

export function renderAll(b: RenderBundle, clientJs: string): Record<string, string> {
  if (b.schema !== SCHEMA) {
    // Fail loudly at build time. A screen reading a field the producer stopped emitting would
    // otherwise render a blank card, and a blank card at 03:00 looks exactly like "nothing happened".
    throw new Error(`render_bundle schema mismatch: got ${String(b.schema)}, want ${SCHEMA}`);
  }

  const pages: Record<string, string> = {};
  for (const s of SCREENS) {
    pages[s.file] = renderPage({
      title: TITLES[s.id],
      screen: s.id,
      bundle: b,
      body: BODIES[s.id](b),
      clientJs,
    });
  }
  return pages;
}
