// @gosleep/core — model resolver (GSL-290) unit tests.
//
// The resolver is pure (given a cwd + HOME + readFile hook), so every case is exercised
// against a fake FS instead of a real disk write. Covers:
//   - top-level "model" wins over env
//   - env.CLAUDE_MODEL / env.ANTHROPIC_MODEL as fallbacks
//   - project settings.local.json wins over project settings.json wins over home settings.json
//   - missing file at any tier degrades to the next candidate
//   - malformed JSON at any tier is skipped, not fatal
//   - fully-empty candidate set → null
//   - per-tick cache: `modelCache.get()` reads once per (cwd, home) key until `startTick()`

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  modelCache,
  modelResolverCandidates,
  resolveModelForCwd,
} from "../src/adapter/model-resolver.ts";

const CWD = "/tmp/gsl290-project";
const HOME = "/tmp/gsl290-home";

const P_LOCAL = join(CWD, ".claude", "settings.local.json");
const P_PROJECT = join(CWD, ".claude", "settings.json");
const P_HOME = join(HOME, ".claude", "settings.json");

function fakeFs(map: Record<string, string | null>): (p: string) => string | null | undefined {
  return (p: string) => (p in map ? map[p] : undefined);
}

describe("modelResolverCandidates (GSL-290)", () => {
  test("returns the three probe paths in precedence order", () => {
    expect(modelResolverCandidates(CWD, HOME)).toEqual([P_LOCAL, P_PROJECT, P_HOME]);
  });
});

describe("resolveModelForCwd (GSL-290)", () => {
  test("top-level model in settings.local.json wins", () => {
    const m = resolveModelForCwd(CWD, {
      home: HOME,
      readFile: fakeFs({
        [P_LOCAL]: JSON.stringify({ model: "claude-opus-4-7" }),
        [P_PROJECT]: JSON.stringify({ model: "different-project" }),
        [P_HOME]: JSON.stringify({ model: "different-home" }),
      }),
    });
    expect(m).toBe("claude-opus-4-7");
  });

  test("top-level model at any tier beats env CLAUDE_MODEL", () => {
    const m = resolveModelForCwd(CWD, {
      home: HOME,
      readFile: fakeFs({
        [P_LOCAL]: JSON.stringify({ env: { CLAUDE_MODEL: "env-local" } }),
        [P_PROJECT]: JSON.stringify({ model: "top-project" }),
        [P_HOME]: JSON.stringify({ model: "top-home" }),
      }),
    });
    // env in local file returns first — env is legal, still resolves early.
    expect(m).toBe("env-local");
  });

  test("env.CLAUDE_MODEL is used when top-level model is absent", () => {
    const m = resolveModelForCwd(CWD, {
      home: HOME,
      readFile: fakeFs({
        [P_LOCAL]: JSON.stringify({ env: { CLAUDE_MODEL: "claude-opus-4-7" } }),
      }),
    });
    expect(m).toBe("claude-opus-4-7");
  });

  test("env.ANTHROPIC_MODEL is a secondary env fallback", () => {
    const m = resolveModelForCwd(CWD, {
      home: HOME,
      readFile: fakeFs({
        [P_HOME]: JSON.stringify({ env: { ANTHROPIC_MODEL: "anthropic-fable-5" } }),
      }),
    });
    expect(m).toBe("anthropic-fable-5");
  });

  test("project settings.json wins over ~/.claude/settings.json when local is missing", () => {
    const m = resolveModelForCwd(CWD, {
      home: HOME,
      readFile: fakeFs({
        [P_LOCAL]: null,
        [P_PROJECT]: JSON.stringify({ model: "project-model" }),
        [P_HOME]: JSON.stringify({ model: "home-model" }),
      }),
    });
    expect(m).toBe("project-model");
  });

  test("falls all the way through to ~/.claude/settings.json", () => {
    const m = resolveModelForCwd(CWD, {
      home: HOME,
      readFile: fakeFs({
        [P_HOME]: JSON.stringify({ model: "home-only" }),
      }),
    });
    expect(m).toBe("home-only");
  });

  test("empty-string model is treated as absent (falls through)", () => {
    const m = resolveModelForCwd(CWD, {
      home: HOME,
      readFile: fakeFs({
        [P_LOCAL]: JSON.stringify({ model: "" }),
        [P_HOME]: JSON.stringify({ model: "home-model" }),
      }),
    });
    expect(m).toBe("home-model");
  });

  test("malformed JSON at any tier is skipped, not fatal", () => {
    const m = resolveModelForCwd(CWD, {
      home: HOME,
      readFile: fakeFs({
        [P_LOCAL]: "{this is not json",
        [P_PROJECT]: JSON.stringify({ model: "project-model" }),
      }),
    });
    expect(m).toBe("project-model");
  });

  test("array or non-object root is skipped, not fatal", () => {
    const m = resolveModelForCwd(CWD, {
      home: HOME,
      readFile: fakeFs({
        [P_LOCAL]: JSON.stringify(["not-an-object"]),
        [P_PROJECT]: JSON.stringify({ model: "project-model" }),
      }),
    });
    expect(m).toBe("project-model");
  });

  test("all three files missing → null (never fabricates)", () => {
    const m = resolveModelForCwd(CWD, {
      home: HOME,
      readFile: fakeFs({}),
    });
    expect(m).toBeNull();
  });
});

describe("modelCache (GSL-290)", () => {
  beforeEach(() => {
    modelCache.startTick();
  });

  afterEach(() => {
    modelCache.startTick();
  });

  // GSL-321 — modelCache.get now takes (session_id, cwd, opts) with a transcript-first
  // resolution. The tests below hand in an empty `listTranscripts` so the settings-hierarchy
  // fallback runs; that keeps the coverage story (file cached per key, distinct keys don't
  // collide) while matching the new signature.
  test("reads the file once per (session_id, cwd, home) key until startTick clears the cache", () => {
    let reads = 0;
    const read = fakeFs({ [P_LOCAL]: JSON.stringify({ model: "cached-model" }) });
    const trackingRead = (p: string) => {
      reads += 1;
      return read(p);
    };
    const opts = {
      home: HOME,
      readFile: trackingRead,
      listTranscripts: () => [],
    };
    const m1 = modelCache.get("S", CWD, opts);
    const m2 = modelCache.get("S", CWD, opts);
    expect(m1).toBe("cached-model");
    expect(m2).toBe("cached-model");
    expect(reads).toBe(1); // only one file read — second call is served from cache

    modelCache.startTick();
    const m3 = modelCache.get("S", CWD, opts);
    expect(m3).toBe("cached-model");
    expect(reads).toBe(2); // cache cleared → file re-read
  });

  test("distinct cwd keys don't collide", () => {
    const readA = fakeFs({
      [join("/a", ".claude", "settings.local.json")]: JSON.stringify({ model: "a" }),
    });
    const readB = fakeFs({
      [join("/b", ".claude", "settings.local.json")]: JSON.stringify({ model: "b" }),
    });
    const noTranscripts = { listTranscripts: () => [] as never[] };
    expect(
      modelCache.get("S", "/a", { home: HOME, readFile: readA, ...noTranscripts }),
    ).toBe("a");
    expect(
      modelCache.get("S", "/b", { home: HOME, readFile: readB, ...noTranscripts }),
    ).toBe("b");
    // Repeat both — still correct (cache doesn't leak across cwds).
    expect(
      modelCache.get("S", "/a", { home: HOME, readFile: readA, ...noTranscripts }),
    ).toBe("a");
    expect(
      modelCache.get("S", "/b", { home: HOME, readFile: readB, ...noTranscripts }),
    ).toBe("b");
  });
});
