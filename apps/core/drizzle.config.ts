// @gosleep/core — drizzle-kit configuration (GSL-261).
//
// Points `drizzle-kit generate` at the workspace schema and writes migrations to `drizzle/`
// alongside this config. The generated tree is:
//
//   apps/core/drizzle/
//     0000_<slug>.sql               ← plain SQL, reviewed BY HAND before commit (R28)
//     meta/_journal.json            ← ordered ledger of applied migrations
//     meta/0000_snapshot.json       ← schema fingerprint drizzle-kit diffs against next time
//
// All three groups are committed to git — that is what makes migrations reproducible from a
// fresh clone. Runtime application (against `data/gosleep.db`) happens in `scripts/migrate.ts`;
// this config never touches a live database.

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // `verbose` echoes the generated SQL to stdout so `db:generate` is auditable in a PR diff
  // without spelunking through the file tree; `strict` refuses to generate a migration when
  // the schema and snapshot disagree in a way drizzle-kit cannot resolve — a red flag we want
  // surfaced loudly, not smoothed over.
  verbose: true,
  strict: true,
});
