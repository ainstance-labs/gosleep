// @gosleep/core — SPA browser-navigation guard (GSL-310) unit tests.
//
// The bug this fixes: a hard-reload of any client-side SPA route whose name also existed
// as a JSON API endpoint (`/fleet`, `/timeline`, `/questions`, `/tasks`, `/cost`) hit the
// Bearer-gated API route first, 401'd, and the SPA never booted. The guard runs BEFORE
// the read routes and short-circuits the request to `index.html` when the caller is a
// browser navigation (GET/HEAD + Accept prefers text/html).
//
// The functional core-smoke coverage lives in scenarios 8a-8c of core-smoke.sh (a browser-
// shaped GET returns index.html on /questions; the same path with `Accept: application/json`
// and no Bearer still 401s; with a valid Bearer still returns JSON).

import { describe, expect, test } from "bun:test";

import {
  acceptPrefersHtml,
  isClientRoutePath,
  isBrowserSpaNavigation,
} from "../src/routes/spaNavigation.ts";

describe("acceptPrefersHtml (GSL-310)", () => {
  test("browser-shaped header prefers HTML", () => {
    expect(
      acceptPrefersHtml(
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8",
      ),
    ).toBe(true);
  });

  test("SDK JSON call prefers API", () => {
    expect(acceptPrefersHtml("application/json")).toBe(false);
  });

  test("no header at all → API path (do NOT smash /questions from curl)", () => {
    expect(acceptPrefersHtml(null)).toBe(false);
  });

  test("wildcard-only Accept counts as API (backward compat)", () => {
    expect(acceptPrefersHtml("*/*")).toBe(false);
  });

  test("JSON appears BEFORE HTML → API wins", () => {
    expect(acceptPrefersHtml("application/json, text/html;q=0.5")).toBe(false);
  });

  test("case-insensitive match", () => {
    expect(acceptPrefersHtml("TEXT/HTML,application/xhtml+xml")).toBe(true);
  });
});

describe("isClientRoutePath (GSL-310)", () => {
  test("root is a client route (SPA overview)", () => {
    expect(isClientRoutePath("/")).toBe(true);
  });

  test.each([
    "/fleet",
    "/timeline",
    "/questions",
    "/tasks",
    "/cost",
    "/overview",
    "/skills",
  ])("exact collision path %s is a client route", (path) => {
    expect(isClientRoutePath(path)).toBe(true);
  });

  test.each(["/fleet/GSL-123", "/questions/q-abc", "/timeline/rotate/2026-08-10"])(
    "nested child of a collision path %s is a client route",
    (path) => {
      expect(isClientRoutePath(path)).toBe(true);
    },
  );

  test.each([
    "/status",
    "/version",
    "/whoami",
    "/healthz",
    "/actions/questions/answer",
    "/events",
    "/metrics",
    "/setup",
    "/manifest",
  ])("API-only path %s is NOT a client route", (path) => {
    expect(isClientRoutePath(path)).toBe(false);
  });

  test("prefix-lookalike does NOT match (e.g. /fleeting)", () => {
    expect(isClientRoutePath("/fleeting")).toBe(false);
    expect(isClientRoutePath("/costs")).toBe(false);
    expect(isClientRoutePath("/taskstatus")).toBe(false);
  });
});

describe("isBrowserSpaNavigation (GSL-310)", () => {
  function makeRequest(url: string, init?: RequestInit): Request {
    return new Request(url, init);
  }

  test("browser GET of /questions → true", () => {
    const req = makeRequest("http://127.0.0.1:7331/questions", {
      method: "GET",
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    expect(isBrowserSpaNavigation(req)).toBe(true);
  });

  test("SDK GET of /questions with Accept: application/json → false (API call)", () => {
    const req = makeRequest("http://127.0.0.1:7331/questions", {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    expect(isBrowserSpaNavigation(req)).toBe(false);
  });

  test("browser POST of /questions → false (mutations never SPA-fallback)", () => {
    const req = makeRequest("http://127.0.0.1:7331/questions", {
      method: "POST",
      headers: { Accept: "text/html" },
    });
    expect(isBrowserSpaNavigation(req)).toBe(false);
  });

  test("browser GET of API-only /status → false (no collision)", () => {
    const req = makeRequest("http://127.0.0.1:7331/status", {
      method: "GET",
      headers: { Accept: "text/html" },
    });
    expect(isBrowserSpaNavigation(req)).toBe(false);
  });

  test("browser GET of nested client route /fleet/GSL-1 → true", () => {
    const req = makeRequest("http://127.0.0.1:7331/fleet/GSL-1", {
      method: "GET",
      headers: { Accept: "text/html,*/*;q=0.8" },
    });
    expect(isBrowserSpaNavigation(req)).toBe(true);
  });

  test("HEAD of a client route also serves the shell (browser preflight)", () => {
    const req = makeRequest("http://127.0.0.1:7331/fleet", {
      method: "HEAD",
      headers: { Accept: "text/html" },
    });
    expect(isBrowserSpaNavigation(req)).toBe(true);
  });
});
