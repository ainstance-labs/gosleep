#!/usr/bin/env bun
// @gosleep/channel — bin entry (GSL-282). This is the ONLY file that ties the
// plugin to a running Claude Code session's stdin/stdout. The env-guard
// short-circuits BEFORE any MCP handler registers, so a session that hasn't
// been opted in never sees a byte of channel traffic.
//
// Contract with Claude Code:
//   - Claude Code launches this bin when `--channels 'gosleep=@gosleep/channel'`
//     is passed and `--dangerously-load-development-channels` gate has been
//     accepted.
//   - We READ from stdin, WRITE JSON-RPC frames to stdout, LOG to stderr.
//   - We EXIT 0 immediately when GOSLEEP_ENABLE_CHANNELS is not set to a
//     truthy value; this is the env-side of the double guard documented in
//     README.md § "Enabling the plugin (opt-in, per session)".

import { channelsEnabled } from "../config.ts";
import { runStdio } from "../server.ts";

if (!channelsEnabled()) {
  // No env → no MCP loop. Print nothing to stdout (Claude Code interprets
  // stdout as JSON-RPC and a stray byte would poison the transport). A
  // one-line stderr note is fine for debugging.
  process.stderr.write(
    JSON.stringify({
      ts: new Date().toISOString(),
      src: "gosleep-channel",
      msg: "GOSLEEP_ENABLE_CHANNELS not set — plugin inert, exiting",
    }) + "\n",
  );
  process.exit(0);
}

await runStdio();
