// @gosleep/web — permission card heading helpers (GSL-399, E2E run-02 m-4).
//
// `formatPermissionQuestion` in apps/core/src/routes/internal.ts composes a permission row's
// summary by joining the tool label, the optional message, and a bounded params preview with
// blank lines (`\n\n`). The panel then rendered the WHOLE string inside `<CardTitle>` — so the
// H3 heading ended up as
//
//   Permission request: Bash {"command":"rm -rf /nonexistent-e2e"}
//
// The tool_input JSON is redundant with the dedicated ToolInputPreview block that already
// renders the parsed COMMAND. Splitting client-side keeps the DB row byte-stable (any TUI /
// log consumer that reads `question.question` still sees the full text) while the heading
// stays clean.
//
// - permissionCardHeading(summary): first line before the first blank line, trimmed.
// - permissionCardCaption(summary): the remainder joined by newline, empty when there is none.
//
// The helpers are total — they never throw and always return a string. Pinned by
// apps/web/test/permissionCardHeading.test.ts.

const BLANK_LINE_RE = /\n\s*\n/;

export function permissionCardHeading(summary: string): string {
  const idx = summary.search(BLANK_LINE_RE);
  const head = idx >= 0 ? summary.slice(0, idx) : summary;
  return head.trimEnd();
}

export function permissionCardCaption(summary: string): string {
  const match = BLANK_LINE_RE.exec(summary);
  if (match === null || match.index === undefined) return "";
  return summary.slice(match.index + match[0].length).trimEnd();
}
