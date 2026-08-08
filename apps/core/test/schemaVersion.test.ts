// @gosleep/core — DB schema version resolver (GSL-294) unit tests.
//
// Coverage:
//   - deterministic (same on-disk files → same hash across two calls);
//   - a change to a migration file changes the hash;
//   - a change to the journal file changes the hash;
//   - missing drizzle dir → "unavailable" (never throws);
//   - env override wins over compute;
//   - full=true returns the 64-hex digest, default returns 16 hex chars.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  computeDbSchemaVersion,
  __resetDbSchemaVersionCache,
  getDbSchemaVersion,
} from "../src/db/schemaVersion.ts";

interface Scratch {
  drizzleDir: string;
  cleanup: () => void;
}

function makeScratchDrizzle(files: { journal: string; migrations: Record<string, string> }): Scratch {
  const root = mkdtempSync(join(tmpdir(), "gsl294-drizzle-"));
  const drizzleDir = join(root, "drizzle");
  mkdirSync(join(drizzleDir, "meta"), { recursive: true });
  writeFileSync(join(drizzleDir, "meta", "_journal.json"), files.journal);
  for (const [name, body] of Object.entries(files.migrations)) {
    writeFileSync(join(drizzleDir, name), body);
  }
  return {
    drizzleDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  __resetDbSchemaVersionCache();
});

describe("computeDbSchemaVersion (GSL-294)", () => {
  test("deterministic — same files, same hash across two calls", () => {
    const s = makeScratchDrizzle({
      journal: '{"version":"7","entries":[]}',
      migrations: { "0000_init.sql": "CREATE TABLE t (id INTEGER);" },
    });
    try {
      const a = computeDbSchemaVersion({ drizzleDir: s.drizzleDir });
      const b = computeDbSchemaVersion({ drizzleDir: s.drizzleDir });
      expect(a).toBe(b);
      expect(a.length).toBe(16); // default is short (16 hex)
    } finally {
      s.cleanup();
    }
  });

  test("full=true returns the 64-char digest", () => {
    const s = makeScratchDrizzle({
      journal: '{"version":"7","entries":[]}',
      migrations: { "0000_init.sql": "-- migration" },
    });
    try {
      const full = computeDbSchemaVersion({ drizzleDir: s.drizzleDir, full: true });
      expect(full.length).toBe(64);
      expect(/^[0-9a-f]+$/.test(full)).toBe(true);
    } finally {
      s.cleanup();
    }
  });

  test("changing a migration changes the hash", () => {
    const before = makeScratchDrizzle({
      journal: '{"version":"7","entries":[]}',
      migrations: { "0000_init.sql": "-- v1" },
    });
    const after = makeScratchDrizzle({
      journal: '{"version":"7","entries":[]}',
      migrations: { "0000_init.sql": "-- v2" }, // one byte different
    });
    try {
      expect(computeDbSchemaVersion({ drizzleDir: before.drizzleDir })).not.toBe(
        computeDbSchemaVersion({ drizzleDir: after.drizzleDir }),
      );
    } finally {
      before.cleanup();
      after.cleanup();
    }
  });

  test("changing the journal changes the hash", () => {
    const before = makeScratchDrizzle({
      journal: '{"version":"7","entries":[]}',
      migrations: { "0000_init.sql": "-- same" },
    });
    const after = makeScratchDrizzle({
      journal: '{"version":"7","entries":[{"tag":"new"}]}',
      migrations: { "0000_init.sql": "-- same" },
    });
    try {
      expect(computeDbSchemaVersion({ drizzleDir: before.drizzleDir })).not.toBe(
        computeDbSchemaVersion({ drizzleDir: after.drizzleDir }),
      );
    } finally {
      before.cleanup();
      after.cleanup();
    }
  });

  test("adding a migration changes the hash", () => {
    const before = makeScratchDrizzle({
      journal: '{"version":"7","entries":[]}',
      migrations: { "0000_init.sql": "-- v1" },
    });
    const after = makeScratchDrizzle({
      journal: '{"version":"7","entries":[]}',
      migrations: {
        "0000_init.sql": "-- v1",
        "0001_extend.sql": "-- v1.1",
      },
    });
    try {
      expect(computeDbSchemaVersion({ drizzleDir: before.drizzleDir })).not.toBe(
        computeDbSchemaVersion({ drizzleDir: after.drizzleDir }),
      );
    } finally {
      before.cleanup();
      after.cleanup();
    }
  });

  test("missing drizzle dir → 'unavailable' (never throws)", () => {
    expect(
      computeDbSchemaVersion({ drizzleDir: "/nope/definitely-not-here-12345" }),
    ).toBe("unavailable");
  });

  test("env override wins over compute", () => {
    const s = makeScratchDrizzle({
      journal: '{"version":"7","entries":[]}',
      migrations: { "0000_init.sql": "-- x" },
    });
    try {
      expect(
        computeDbSchemaVersion({
          drizzleDir: s.drizzleDir,
          envOverride: "custom-version-42",
        }),
      ).toBe("custom-version-42");
    } finally {
      s.cleanup();
    }
  });
});

describe("getDbSchemaVersion memo (GSL-294)", () => {
  test("memoises the first computation", () => {
    process.env.GOSLEEP_DB_SCHEMA_VERSION_OVERRIDE = "memoized-value";
    __resetDbSchemaVersionCache();
    expect(getDbSchemaVersion()).toBe("memoized-value");
    // Changing the env AFTER the memo should NOT change the returned value.
    process.env.GOSLEEP_DB_SCHEMA_VERSION_OVERRIDE = "different-now";
    expect(getDbSchemaVersion()).toBe("memoized-value");
  });
});
