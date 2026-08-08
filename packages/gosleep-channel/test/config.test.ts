// @gosleep/channel — env-guard tests (GSL-282). Proves the plugin's canonical
// "off unless BOTH switches on" behaviour is enforced at the config layer
// (the second half of the double guard from README § opt-in).

import { describe, it, expect } from "bun:test";
import {
  channelsEnabled,
  permissionRelayUrl,
  permissionDecisionWaitUrl,
  steerDrainUrl,
  CORE_BASE_URL,
} from "../src/config.ts";

describe("channelsEnabled", () => {
  it("defaults to false when GOSLEEP_ENABLE_CHANNELS is unset", () => {
    expect(channelsEnabled({})).toBe(false);
  });
  it("is false on empty string", () => {
    expect(channelsEnabled({ GOSLEEP_ENABLE_CHANNELS: "" })).toBe(false);
  });
  it('is false on "0"', () => {
    expect(channelsEnabled({ GOSLEEP_ENABLE_CHANNELS: "0" })).toBe(false);
  });
  it('is false on "false"', () => {
    expect(channelsEnabled({ GOSLEEP_ENABLE_CHANNELS: "false" })).toBe(false);
  });
  it('is true on "1"', () => {
    expect(channelsEnabled({ GOSLEEP_ENABLE_CHANNELS: "1" })).toBe(true);
  });
  it('is true on "true" (case-insensitive)', () => {
    expect(channelsEnabled({ GOSLEEP_ENABLE_CHANNELS: "TRUE" })).toBe(true);
  });
  it("is true on whitespace around a truthy value", () => {
    expect(channelsEnabled({ GOSLEEP_ENABLE_CHANNELS: "  1  " })).toBe(true);
  });
});

describe("URL builders point at 127.0.0.1:7331 only", () => {
  it("relay URL is the loopback core", () => {
    expect(permissionRelayUrl()).toBe("http://127.0.0.1:7331/internal/permission-relay");
  });
  it("decision-wait URL encodes the qid", () => {
    expect(permissionDecisionWaitUrl("p-2026-08-08-abc")).toBe(
      "http://127.0.0.1:7331/internal/permissions/p-2026-08-08-abc/decision-wait",
    );
    // Path-injection guard: an attacker-provided qid can't escape the segment.
    expect(permissionDecisionWaitUrl("../evil")).toBe(
      "http://127.0.0.1:7331/internal/permissions/..%2Fevil/decision-wait",
    );
  });
  it("steer-drain URL encodes the session id", () => {
    expect(steerDrainUrl("sess-1")).toBe("http://127.0.0.1:7331/internal/steer/sess-1/drain");
  });
  it("CORE_BASE_URL is hard-pinned to the loopback address", () => {
    expect(CORE_BASE_URL).toBe("http://127.0.0.1:7331");
  });
});
