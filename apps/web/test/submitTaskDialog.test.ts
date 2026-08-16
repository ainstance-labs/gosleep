// @gosleep/web — GSL-383 unit tests for the Submit-task dialog's client-side helpers.
//
// Two exported utilities land under test here — the dialog itself is React and lives
// under bun:test-hostile browser APIs (radix portals). What we CAN pin down without
// a DOM harness:
//   1. utf8Bytes: multibyte characters count as 2+ bytes; the 16 KB gate uses this to
//      decide whether the confirm button becomes enabled.
//   2. scanForSecretShapesClient: matches the server-side sweep so an owner who is
//      offline / rate-limited on the preview endpoint still sees the warning before
//      confirming.

import { describe, expect, test } from "bun:test";

import {
  scanForSecretShapesClient,
  utf8Bytes,
} from "../src/components/SubmitTaskDialog";

describe("utf8Bytes (GSL-383)", () => {
  test("ASCII string byte length equals char length", () => {
    expect(utf8Bytes("hello")).toBe(5);
    expect(utf8Bytes("hello world")).toBe(11);
  });

  test("multibyte characters count multiple bytes", () => {
    expect(utf8Bytes("Привет")).toBe(12); // Cyrillic, 2 bytes each
    expect(utf8Bytes("🌍")).toBe(4); // 4-byte emoji
  });

  test("empty string is 0 bytes", () => {
    expect(utf8Bytes("")).toBe(0);
  });
});

describe("scanForSecretShapesClient (GSL-383)", () => {
  test("clean body -> no warnings", () => {
    expect(scanForSecretShapesClient("run the migration and open a PR")).toEqual([]);
  });

  test("AWS AKIA-prefixed body -> warning", () => {
    const w = scanForSecretShapesClient("aws=AKIAIOSFODNN7EXAMPLE");
    expect(w.length).toBe(1);
    expect(w[0]).toContain("AWS");
  });

  test("Anthropic sk-ant- body -> warning", () => {
    const w = scanForSecretShapesClient("bearer sk-ant-api03-abcdefghij1234567890");
    expect(w.some((m) => m.includes("Anthropic"))).toBe(true);
  });

  test("GitHub ghp_ token -> warning", () => {
    const w = scanForSecretShapesClient("git remote set-url origin https://ghp_abcdefghij1234567890xy@…");
    expect(w.some((m) => m.includes("GitHub"))).toBe(true);
  });
});
