// @gosleep/core — one-shot invocation of `reconcileDeferred()` against a specified DB path.
//
// Used by the live-proof smoke (tools/lab/tests/manifest-defer-live-proof.sh) so the defer →
// auto-reopen transition can be forced deterministically instead of racing the worker's 10 s
// tick under a smoke budget. Not part of the production surface.
//
// Usage: bun run apps/core/scripts/force-defer-reopen.ts <db-path>

import { resolve } from "node:path";

import { openDatabase } from "../src/db/client.ts";
import { reconcileDeferred } from "../src/workers/defer-reopen.ts";

const dbArg = process.argv[2];
if (!dbArg) {
  console.error("usage: force-defer-reopen.ts <db-path>");
  process.exit(1);
}

const dbPath = resolve(dbArg);
const opened = openDatabase(dbPath);
const summary = await reconcileDeferred(opened);
console.log(JSON.stringify({ event: "force-defer-reopen.done", ...summary }));
opened.raw.close();
