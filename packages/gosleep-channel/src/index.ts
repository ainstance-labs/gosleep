// @gosleep/channel — public entry (GSL-282).
//
// Re-exports the parts consumers (tests, other packages) may import. Do NOT
// export anything here that touches stdin/stdout — the bin entry
// (src/bin/gosleep-channel.ts) is the only place that talks to Claude Code.

export { channelsEnabled, permissionRelayUrl, permissionDecisionWaitUrl, steerDrainUrl } from "./config.ts";
export {
  permissionRequestSchema,
  permissionDecisionSchema,
  steerMessageSchema,
  relayAckSchema,
  decisionWaitSchema,
  type PermissionRequest,
  type PermissionDecision,
  type SteerMessage,
  type RelayAck,
  type DecisionWait,
} from "./types.ts";
export { relayPermissionRequest, waitForDecision } from "./relay.ts";
export { drainSteer } from "./steer.ts";
export { createServer, type JsonRpcRequest, type JsonRpcResponse } from "./server.ts";
