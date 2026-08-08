// @gosleep/channel — shape of the JSON-RPC notifications this plugin exchanges
// with Claude Code, per code.claude.com/docs/en/channels-reference.md (fetched
// 2026-08-07). Zod-first so the shim's parser rejects malformed payloads at
// the boundary and never propagates untrusted shapes deeper.

import { z } from "zod";

/** Inbound notification — Claude Code asks the channel to relay a permission decision. */
export const permissionRequestSchema = z.object({
  request_id: z.string().min(1, "request_id required"),
  tool_name: z.string().min(1, "tool_name required"),
  description: z.string().default(""),
  input_preview: z.string().default(""),
  // Optional session hint — Claude Code MAY include this so the channel can
  // route the decision back to the right session when multiple sessions
  // share a channel. Documented as optional in channels-reference.md.
  session_id: z.string().optional(),
});

export type PermissionRequest = z.infer<typeof permissionRequestSchema>;

/** Outbound notification — the channel replies with the owner's decision. */
export const permissionDecisionSchema = z.object({
  request_id: z.string().min(1),
  behavior: z.enum(["allow", "deny"]),
});

export type PermissionDecision = z.infer<typeof permissionDecisionSchema>;

/**
 * Owner-steer message queued in gosleep-core for delivery at the session's
 * NEXT turn boundary. Never mid-turn — that is the fundamental limit of
 * channels (channels-reference.md: "channel events queue into the session
 * … delivered together on the next turn").
 */
export const steerMessageSchema = z.object({
  session_id: z.string().min(1),
  message: z.string().min(1),
  // ISO timestamp the owner typed the message on the web UI, for provenance
  // in the timeline; the plugin does NOT need to enforce ordering — the core
  // drain endpoint already returns messages in queue order.
  queued_at: z.string().optional(),
});

export type SteerMessage = z.infer<typeof steerMessageSchema>;

/**
 * Response shape from POST /internal/permission-relay.
 * qid is the same qid the web UI's Questions screen already knows how to
 * render — see apps/core/src/routes/internal.ts § permissions.post.
 */
export const relayAckSchema = z.object({
  ok: z.boolean(),
  qid: z.string().optional(),
  error: z.string().optional(),
  opened_at: z.string().optional(),
});

export type RelayAck = z.infer<typeof relayAckSchema>;

/**
 * Response shape from GET /internal/permissions/:qid/decision-wait
 *   200 { ok: true, qid, behavior: "allow"|"deny", answered_at, answered_by? }
 *   204 { ok: true, qid, timeout: true }   — no decision within timeout_s
 *   404 { ok: false, error: "unknown qid" } — the caller lost the row
 */
export const decisionWaitSchema = z.object({
  ok: z.boolean(),
  qid: z.string().optional(),
  behavior: z.enum(["allow", "deny"]).optional(),
  answered_at: z.string().optional(),
  answered_by: z.string().optional(),
  timeout: z.boolean().optional(),
  error: z.string().optional(),
});

export type DecisionWait = z.infer<typeof decisionWaitSchema>;
