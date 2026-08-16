// @gosleep/core — pid-tree correlation tests (GSL-350 M1 follow-up).
//
// Coverage:
//   1. walkAncestors terminates on process 1 (init) or missing parent.
//   2. resolveOwningPane returns the first ancestor in the panePids set.
//   3. Empty panePids or unresolvable pid → null (no crash).
//
// Uses real ps against the current shell's PID chain — cross-platform sanity check that
// doesn't require a live tmux server.

import { describe, expect, test } from "bun:test";

import {
  MAX_DEPTH,
  getParentPid,
  lsofPidsHoldingFile,
  resolveOwningPane,
  walkAncestors,
} from "../src/observed/pidtree.ts";

describe("pidtree correlation (M1)", () => {
  test("getParentPid returns a positive integer for the current process", () => {
    const ppid = getParentPid(process.pid);
    expect(ppid).not.toBeNull();
    expect(ppid).toBeGreaterThan(0);
    expect(ppid).not.toBe(process.pid);
  });

  test("getParentPid returns null for a nonsense pid", () => {
    expect(getParentPid(0)).toBeNull();
    expect(getParentPid(-1)).toBeNull();
    expect(getParentPid(999_999_999)).toBeNull();
  });

  test("walkAncestors chain includes self + at least one parent, bounded by MAX_DEPTH", () => {
    const chain = walkAncestors(process.pid);
    expect(chain[0]).toBe(process.pid);
    expect(chain.length).toBeGreaterThanOrEqual(2); // self + at least one parent
    expect(chain.length).toBeLessThanOrEqual(MAX_DEPTH);
    // No duplicates.
    const set = new Set(chain);
    expect(set.size).toBe(chain.length);
  });

  test("resolveOwningPane returns the first ancestor that matches panePids", () => {
    // Point the "pane" at our own parent — that ancestor must be resolved.
    const parentPid = getParentPid(process.pid)!;
    const panePids = new Set<number>([parentPid, 999_999_998]);
    const owning = resolveOwningPane(process.pid, panePids);
    expect(owning).toBe(parentPid);
  });

  test("resolveOwningPane returns null when no ancestor matches", () => {
    const panePids = new Set<number>([999_999_997, 999_999_998]);
    const owning = resolveOwningPane(process.pid, panePids);
    expect(owning).toBeNull();
  });

  test("resolveOwningPane on nonsense pid returns null", () => {
    expect(resolveOwningPane(-1, new Set([1234]))).toBeNull();
    expect(resolveOwningPane(0, new Set([1234]))).toBeNull();
  });

  test("lsofPidsHoldingFile on a nonexistent path returns [] (no throw)", () => {
    const pids = lsofPidsHoldingFile("/tmp/does-not-exist-gsl350-pidtree.tmp");
    expect(pids).toEqual([]);
  });
});
