# GSL-320 · phase 7 · Permission card shows the actual command / tool-input

## What was done

The permission cards on the panel's Questions screen now show the actual command (or file
path, or MCP tool arguments) that the owner is being asked to allow or deny. Before this
change the card read only `Permission request: Bash` with an Allow/Deny pair — the reader
had to trust the shim and click blindly, and during the live-fire run 06 six Bash cards
had to be denied via the raw DB because only the transcript exposed the actual command.

End-to-end wiring:

- The core endpoint `POST /internal/permissions/post` now correctly reads Claude Code's
  real `PermissionRequest` payload shape (`tool_input = {command: "…"}` for Bash), not just
  the old MCP-style `{params: {…}}` shape it was written against.
- The reconciled tool arguments are persisted as a new `tool_input` column on the
  `questions` table (migration `0003_permission_tool_input.sql`).
- `GET /questions` and `GET /bundle` expose the parsed `tool_input` object on every row.
- The web `QuestionsScreen` renders a monospace preview block above the Allow / Deny buttons
  for `kind='permission'` rows. The block label adapts to the shape ("Command", "File edit",
  "File write", "Tool arguments"), and long payloads are truncated at ~4 KB before storage
  and wrapped in a scrollable container in the UI.

## Problems solved

- **The wrong-shape trap.** The endpoint was expecting `tool_input.params` because the
  original wiring was against an MCP-style permission tool. Claude Code's native
  `PermissionRequest` event (wired in GSL-304) hands the tool's real arguments directly on
  `tool_input`, so `.params` was always `undefined` and the params preview always collapsed
  to an empty string. `flattenToolInput` now handles both shapes: if `.tool` or `.params` is
  present we take the MCP path (`params` wins); otherwise the whole `tool_input` IS the
  args, with the reserved metadata keys (`tool`, `message`) stripped.
- **Long payloads.** Edit / Write cards can carry a whole file body inside `content` or
  `new_string`. `encodeToolInputForStorage` caps the JSON at 4 KB and appends a `…` marker
  so the panel can hint truncation. The web preview additionally clamps to `max-h-64`
  with `overflow-auto` — a huge diff never blows out the card.

## Problems remaining

None known for this fix. Follow-ups tracked separately: `MINOR native-TUI permission
fallback` (finding #5 in run 06) is investigation-only; the hook-debug log gap is a
separate cheap logging fix; neither is in this task's scope.

## Pitfalls & workarounds

- Four existing tests (`internal.test.ts`, `actions.decidePermission.sse.test.ts`,
  `actions.applyManifest.defer.test.ts`, `metrics.test.ts`) build the `questions` table
  by hand with raw SQL rather than running migrations. The new `tool_input` column has to
  be added to all four so a fresh in-memory DB matches the migrated shape — a schema drift
  in a test setup file surfaces as an opaque `SQLiteError: table questions has no column
  named tool_input` at INSERT time, not at table-create time.
- `parseJsonSafe` is the read-side symmetric of `encodeToolInputForStorage`: the DB stores
  a JSON string, and the SPA renders a JS object. A bad JSON string degrades to the raw
  string rather than crashing the row — matches the pattern the rest of the file uses for
  `options`.

## What didn't make it

The two remaining run 06 fixes ship in sibling tasks in this epic:

- `GSL-321` (Fleet Model column reads the session's real model, not global settings).
- `GSL-319` (surface PR links on the panel).

Both live under branch `GSL-318-run06-fixes` in the epic PR.

---

## Technical reference

**Commit:** (filled at commit time)

**Key files:**

- `apps/core/drizzle/0003_permission_tool_input.sql` — new migration.
- `apps/core/drizzle/meta/_journal.json` — journal entry for migration 0003.
- `apps/core/src/db/schema.ts` — adds `questions.tool_input` column type.
- `apps/core/src/routes/internal.ts` — `flattenToolInput`, `encodeToolInputForStorage`,
  and the updated `POST /internal/permissions/post` INSERT.
- `apps/core/src/routes/read.ts` — surfaces `tool_input` on `/questions` and `/bundle`.
- `packages/schema/src/index.ts` — `QuestionRow.tool_input` field (zod).
- `apps/web/src/screens/Questions.tsx` — `formatToolInputLabel`, `formatToolInputBody`,
  and the new preview block on permission cards.
- `apps/core/test/permissions.tool-input.test.ts` — 11 unit tests pinning the reconciliation
  and the cap.

**Verified by running:**

- `bun run --filter='@gosleep/core' typecheck` — 0 errors.
- `bun run --filter='@gosleep/web' typecheck` — 0 errors.
- `bun test apps/core` — 241 tests / 621 expects, 0 failures.
- `bun run --filter='@gosleep/web' build` — clean; the new component code is included in
  the emitted `dist/assets/index-*.js`.

**Links:**

- Jira: [GSL-320](https://ainstance-labs.atlassian.net/browse/GSL-320) under epic
  [GSL-318](https://ainstance-labs.atlassian.net/browse/GSL-318).
- GH mirror: (filled at commit time).
- Run 06 finding: `docs/reports/verifications/web-e2e-2026-08-10/runs/06/index.html`
  finding #1.
