// @gosleep/core — manifest parser unit tests (GSL-277).
//
// Drives the parser through several realistic + adversarial inputs:
//   * The real docs/lab/decisions/manifest.md (integration-flavor sanity check).
//   * A minimal 3-section synthetic manifest (every rule shape).
//   * A duplicate rule id (the LAST occurrence wins; skipped counter increments).
//   * A bullet with §-sigil but broken form (counted as skipped).
//
// The parser is intentionally lenient — a partial parse of an owner-sovereign file is more
// honest than throwing. These tests pin that contract so a future edit does not silently drop
// rules the picker still needs to render.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseManifest, parseManifestFromPath } from "../src/manifest/parser.ts";

const REPO_ROOT = resolve(import.meta.dir, "../../..");

describe("parseManifest — synthetic inputs", () => {
  test("parses a two-section manifest and indexes by canonical id", () => {
    const src = [
      "# Manifest — test",
      "",
      "## 1. Always autonomous (never ask, always log)",
      "",
      "- §1.reversible-delivery — обратимая доставка: код, docs, gates.",
      "- §1.merge-green — мержить зелёные PR (owner 2026-06-29).",
      "",
      "## 2. Decide-by-default",
      "",
      "- §2.merge-strategy — стратегия слияния при развилке → regular merge, НИКОГДА squash",
      "  (конвенция 1-commit-per-task).",
      "- §2.model-policy — модель при неоднозначности → Fable 5 для содержательного.",
    ].join("\n");

    const p = parseManifest(src);
    expect(p.rules).toHaveLength(4);
    expect(p.skipped).toBe(0);
    expect(p.index.get("manifest §1.reversible-delivery")).toBeDefined();
    expect(p.index.get("manifest §2.merge-strategy")).toBeDefined();
    expect(p.index.get("manifest §2.merge-strategy")?.body).toMatch(/regular merge/);
    expect(p.index.get("manifest §2.merge-strategy")?.body).toMatch(/1-commit-per-task/); // continuation
    expect(p.index.get("manifest §1.reversible-delivery")?.section_title).toBe(
      "Always autonomous (never ask, always log)",
    );
  });

  test("returns rules in file order", () => {
    const src = [
      "## 1. A",
      "- §1.alpha — one.",
      "- §1.beta — two.",
      "",
      "## 2. B",
      "- §2.gamma — three.",
    ].join("\n");
    const p = parseManifest(src);
    expect(p.rules.map((r) => r.id)).toEqual([
      "manifest §1.alpha",
      "manifest §1.beta",
      "manifest §2.gamma",
    ]);
  });

  test("duplicate rule id increments `skipped`; last wins", () => {
    const src = [
      "## 1. A",
      "- §1.dup — first body.",
      "## 1. A2",
      "- §1.dup — second body.",
    ].join("\n");
    const p = parseManifest(src);
    expect(p.rules).toHaveLength(2);
    expect(p.skipped).toBe(1);
    expect(p.index.get("manifest §1.dup")?.body).toBe("second body.");
  });

  test("broken §-bullet is counted as skipped, not thrown", () => {
    const src = [
      "## 1. A",
      "- §1.good — real one.",
      "- §broken — no dot no section num", // does not match RULE_RE
    ].join("\n");
    const p = parseManifest(src);
    expect(p.rules).toHaveLength(1);
    expect(p.skipped).toBeGreaterThanOrEqual(1);
  });

  test("bullets without §-sigil are ignored (notes, not rules)", () => {
    const src = [
      "## 1. A",
      "- §1.real — I count.",
      "- Just a note bullet",
    ].join("\n");
    const p = parseManifest(src);
    expect(p.rules).toHaveLength(1);
    expect(p.skipped).toBe(0);
  });

  test("empty file returns empty rules", () => {
    const p = parseManifest("");
    expect(p.rules).toHaveLength(0);
    expect(p.skipped).toBe(0);
  });
});

describe("parseManifestFromPath — real manifest.md", () => {
  test("parses docs/lab/decisions/manifest.md with at least the seeded rules", () => {
    const path = resolve(REPO_ROOT, "docs/lab/decisions/manifest.md");
    const raw = readFileSync(path, "utf8");
    // Sanity: file present + has the sigil.
    expect(raw).toMatch(/§1\./);
    const parsed = parseManifestFromPath(path);
    // The seed v1 lists at least 10 rules across sections 1-6.
    expect(parsed.rules.length).toBeGreaterThanOrEqual(10);
    // Every rule has a well-formed id.
    for (const rule of parsed.rules) {
      expect(rule.id).toMatch(/^manifest §\d+\.[a-z0-9-]+$/);
    }
    // Known seed rule: §2.merge-strategy is a canonical citation.
    const merge = parsed.index.get("manifest §2.merge-strategy");
    expect(merge).toBeDefined();
    expect(merge?.body).toMatch(/regular merge/i);
  });
});
