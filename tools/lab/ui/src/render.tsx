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
import { Timeline, timelineIndex, TIMELINE_ISLAND } from "./screens/timeline.js";
import { Tasks } from "./screens/tasks.js";
import { Questions } from "./screens/questions.js";
import { Fleet } from "./screens/fleet.js";
import { Cost } from "./screens/cost.js";
import { Library, libraryIndex, LIBRARY_ISLAND } from "./screens/library.js";

const SCHEMA = "gosleep.lab.render/6";

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

/**
 * The JSON islands a screen's client code reads back out of its own page (GSL-97).
 *
 * The index handed to the island is built by the SAME function the screen renders its rows from, so
 * the records the filter matches on and the rows it hides cannot describe different tables. A screen
 * with no entry here ships no island — and the client, finding none, leaves that page exactly as it
 * was built. That is the failure mode we want: the whole list, not an empty one.
 */
const ISLANDS: Partial<Record<ScreenId, (b: RenderBundle) => Record<string, unknown>>> = {
  timeline: (b) => ({ [TIMELINE_ISLAND]: timelineIndex(b) }),
  library: (b) => ({ [LIBRARY_ISLAND]: libraryIndex(b) }),
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
      islands: ISLANDS[s.id]?.(b),
      clientJs,
    });
  }
  return pages;
}
