// @gosleep/channel — MCP JSON-RPC server (stdio transport) (GSL-282).
//
// Publishes the `claude/channel/permission` capability so Claude Code will
// route `notifications/claude/channel/permission_request` at this process
// over stdin. Every request is:
//   1. Validated against the channels-reference.md schema (types.ts).
//   2. POSTed to gosleep-core via relay.ts.
//   3. Waited on (long-poll) until the owner clicks or the timeout hits.
//   4. Answered back through the SAME channel with
//      notifications/claude/channel/permission {behavior}.
//
// If ANY step fails, the plugin emits nothing — Claude Code's built-in TUI
// dialog carries the decision, exactly as it would if this plugin were not
// loaded. Fail-open is the entire security model of the internal loop.
//
// KEEP THIS FILE SMALL. The ticket budget is ~200 LOC per the channels-
// reference sample. Anything beyond routing + relay wiring belongs in
// relay.ts / steer.ts / types.ts, not here.

import { permissionRequestSchema, type PermissionRequest } from "./types.ts";
import { relayPermissionRequest, waitForDecision } from "./relay.ts";
import { drainSteer } from "./steer.ts";

/** Log helper that ONLY writes to stderr — stdout is the MCP transport. */
function log(msg: string, extra: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), src: "gosleep-channel", msg, ...extra });
  process.stderr.write(`${line}\n`);
}

// -----------------------------------------------------------------------------
// JSON-RPC framing (stdio, newline-delimited per MCP spec)
// -----------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * The set of methods the plugin implements. `initialize` is the MCP
 * handshake; `notifications/claude/channel/permission_request` is the
 * inbound relay trigger. Anything else responds with method-not-found
 * (JSON-RPC code -32601), matching the reference server behaviour.
 */
export function createServer(
  emit: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
) {
  /**
   * Send an outbound JSON-RPC notification (no id, no response expected).
   * Used for `notifications/claude/channel/permission` — the answer to a
   * relayed request.
   */
  function notify(method: string, params: unknown): void {
    emit(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  /**
   * Handle one inbound JSON-RPC request. Returns the response (or null for
   * pure notifications). The MCP spec: a message without `id` is a
   * notification and must not receive a response.
   */
  async function handle(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    if (req.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id: req.id ?? null,
        result: {
          serverInfo: { name: "@gosleep/channel", version: "0.0.1" },
          capabilities: {
            // Publishes the permission-relay capability. Every channel that
            // relays PermissionRequest must set this exact key per
            // code.claude.com/docs/en/channels-reference.md.
            "claude/channel/permission": {},
          },
          protocolVersion: "2024-11-05",
        },
      };
    }

    if (req.method === "notifications/claude/channel/permission_request") {
      // Notifications never get a JSON-RPC response, only an outbound
      // notification with the decision.
      const parsed = permissionRequestSchema.safeParse(req.params);
      if (!parsed.success) {
        log("permission_request schema error", { error: parsed.error.message });
        return null;
      }
      const request: PermissionRequest = parsed.data;
      log("relaying", { request_id: request.request_id, tool: request.tool_name });

      const ack = await relayPermissionRequest(request);
      if (!ack.ok || ack.qid === undefined) {
        log("relay failed — falling open (local TUI/hook will handle)", { error: ack.error });
        return null;
      }

      const decision = await waitForDecision(ack.qid);
      if (decision.behavior !== undefined) {
        log("decision — emitting to channel", {
          request_id: request.request_id,
          behavior: decision.behavior,
        });
        notify("notifications/claude/channel/permission", {
          request_id: request.request_id,
          behavior: decision.behavior,
        });
      } else {
        log("decision unavailable — falling open", {
          request_id: request.request_id,
          timeout: decision.timeout,
          error: decision.error,
        });
      }
      return null;
    }

    if (req.method === "notifications/claude/channel/steer_drain") {
      // Owner-steer at turn boundaries. The MCP client calls this when a
      // Stop / SessionStart hook fires; we ask core for whatever the owner
      // has queued and hand it back as a batch of channel notifications the
      // session will pick up next turn (never mid-turn — that is the
      // fundamental limit of channels).
      const paramsObj: Record<string, unknown> = (
        typeof req.params === "object" && req.params !== null && !Array.isArray(req.params)
          ? (req.params as Record<string, unknown>)
          : {}
      );
      const sessionId = typeof paramsObj.session_id === "string" ? paramsObj.session_id : "";
      const drain = await drainSteer(sessionId);
      for (const msg of drain.messages) {
        notify("notifications/claude/channel/steer", {
          session_id: msg.session_id,
          message: msg.message,
          queued_at: msg.queued_at,
        });
      }
      return null;
    }

    if (req.id === undefined || req.id === null) return null; // ignore unknown notifications
    return {
      jsonrpc: "2.0",
      id: req.id,
      error: { code: -32601, message: `method not found: ${req.method}` },
    };
  }

  return { handle, notify };
}

/**
 * Wire the server to process.stdin (newline-delimited JSON-RPC framing).
 * Every line = one message. Malformed lines are logged to stderr and
 * skipped, never crashed on — a channel that crashes on a bad frame is
 * a channel that hard-kills the session on receipt of a stray byte.
 */
export async function runStdio(): Promise<void> {
  const server = createServer();
  const stdin = process.stdin;
  stdin.setEncoding("utf-8");

  let buf = "";
  stdin.on("data", (chunk: string) => {
    buf += chunk;
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl === -1) break;
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.length === 0) continue;
      let msg: JsonRpcRequest;
      try {
        msg = JSON.parse(line) as JsonRpcRequest;
      } catch (err) {
        log("bad JSON on stdin — skipping", { error: err instanceof Error ? err.message : String(err) });
        continue;
      }
      void server.handle(msg).then((res) => {
        if (res !== null) process.stdout.write(`${JSON.stringify(res)}\n`);
      });
    }
  });
  await new Promise<void>((resolve) => stdin.on("end", () => resolve()));
}
