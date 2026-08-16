// GSL-399 (m-4) — permission card heading formatter.
//
// E2E run-02: the permission card renders `<CardTitle>{question.question}</CardTitle>`.
// The server-side `formatPermissionQuestion` in apps/core/src/routes/internal.ts joins the
// tool label and the params preview with `\n\n`, so the CardTitle H3 receives text like
// `Permission request: Bash\n\n{"command":"rm -rf /nonexistent-e2e"}` — the raw JSON blob
// leaks into the heading, even though the ToolInputPreview block below already renders the
// parsed COMMAND. The heading becomes unreadable and duplicates information.
//
// The `permissionCardHeading` helper below splits on the FIRST blank line so the CardTitle
// gets just the tool label; the rest goes into an accessory paragraph below the heading.

import { describe, expect, test } from "bun:test";

import {
  permissionCardHeading,
  permissionCardCaption,
} from "../src/lib/permissionCardHeading";

describe("permissionCardHeading — E2E run-02 m-4", () => {
  test("splits the tool label off a Bash permission summary", () => {
    // Red-first: this is exactly the run-02 case ("Permission request: Bash {…JSON…}").
    const summary =
      'Permission request: Bash\n\n{"command":"rm -rf /nonexistent-e2e"}';
    expect(permissionCardHeading(summary)).toBe("Permission request: Bash");
  });

  test("does not drop a heading that already has no body", () => {
    expect(permissionCardHeading("Permission request: Bash")).toBe(
      "Permission request: Bash",
    );
  });

  test("returns the whole string when no blank-line boundary exists", () => {
    // Older permission rows or non-permission rows should read verbatim; the helper is a
    // no-op when there's no `\n\n` split point.
    expect(permissionCardHeading("Custom BLOCKER question about X")).toBe(
      "Custom BLOCKER question about X",
    );
  });

  test("trims the trailing spaces on the heading", () => {
    // Server-side format uses `\n\n` but defensive-trim so a stray whitespace doesn't leak.
    expect(permissionCardHeading("Permission request: Edit   \n\nfile.ts")).toBe(
      "Permission request: Edit",
    );
  });
});

describe("permissionCardCaption — companion text below the heading", () => {
  test("returns the remainder joined by newline", () => {
    const summary =
      'Permission request: Bash\n\n{"command":"rm -rf /nonexistent-e2e"}';
    expect(permissionCardCaption(summary)).toBe(
      '{"command":"rm -rf /nonexistent-e2e"}',
    );
  });

  test("returns empty string when there is no body", () => {
    expect(permissionCardCaption("Permission request: Bash")).toBe("");
  });

  test("preserves multi-paragraph message + preview separated by blank lines", () => {
    const summary =
      "Permission request: Bash\n\nInstall the dependency.\n\n{\"command\":\"npm i x\"}";
    expect(permissionCardCaption(summary)).toBe(
      "Install the dependency.\n\n{\"command\":\"npm i x\"}",
    );
  });
});
