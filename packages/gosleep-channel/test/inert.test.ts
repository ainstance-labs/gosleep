// @gosleep/channel — the "inert without the env flag" smoke test (GSL-282).
//
// This is the single most important guarantee the plugin makes: the bin
// entry must exit 0 immediately with no MCP handlers registered and no
// bytes on stdout when GOSLEEP_ENABLE_CHANNELS is not set. If this test
// ever regresses, an unsupervised worker session that happened to have
// --dangerously-load-development-channels in its command line would start
// participating in the channel loop invisibly.

import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "src", "bin", "gosleep-channel.ts");

describe("bin/gosleep-channel.ts — inert without env", () => {
  it("exits 0 without GOSLEEP_ENABLE_CHANNELS, writes nothing to stdout", () => {
    // A stdio MCP server registers by writing an initialize response frame
    // to stdout. Absence of any stdout bytes = zero handlers registered.
    // We pipe an initialize request in via stdin to give the server every
    // opportunity to reply — an inert exit means it never did.
    const initializeFrame = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });
    const res = spawnSync("bun", ["run", BIN], {
      input: `${initializeFrame}\n`,
      env: { ...process.env, GOSLEEP_ENABLE_CHANNELS: "" },
      encoding: "utf-8",
      timeout: 5_000,
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
    // stderr may carry the "plugin inert, exiting" one-liner and any Bun
    // banner text — just confirm the marker string is present so we know
    // the guard fired for the documented reason.
    expect(res.stderr).toContain("plugin inert");
  });

  it("exits 0 when GOSLEEP_ENABLE_CHANNELS=0", () => {
    const res = spawnSync("bun", ["run", BIN], {
      input: "",
      env: { ...process.env, GOSLEEP_ENABLE_CHANNELS: "0" },
      encoding: "utf-8",
      timeout: 5_000,
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
  });
});
