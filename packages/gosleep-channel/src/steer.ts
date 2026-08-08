// @gosleep/channel — owner-steer drain (GSL-282, rev-3 addendum Delta 2 item 3).
//
// Channel events queue into a session and deliver together on the NEXT turn
// per code.claude.com/docs/en/channels-reference.md. This module hits the
// gosleep-core drain endpoint at turn boundaries (a Stop hook or SessionStart
// hook fires the call), pulls whatever the owner has typed in the web UI
// since the last drain, and hands it to the MCP layer to emit as one or
// more messages the session picks up next turn.
//
// Fail-open like relay.ts: any transport failure returns an empty result and
// logs; the session just continues without an owner nudge that cycle.

import { steerDrainUrl, internalSecret } from "./config.ts";
import { type SteerMessage, steerMessageSchema } from "./types.ts";
import type { FetchFn } from "./relay.ts";
import { z } from "zod";

const drainResponseSchema = z.object({
  ok: z.boolean(),
  messages: z.array(steerMessageSchema).default([]),
  error: z.string().optional(),
});

export interface DrainResult {
  messages: SteerMessage[];
  failedOpen?: boolean;
  error?: string;
}

export async function drainSteer(
  sessionId: string,
  fetchFn: FetchFn = fetch,
): Promise<DrainResult> {
  if (sessionId.length === 0) {
    return { messages: [], error: "session_id required" };
  }
  const secret = internalSecret();
  if (secret === undefined) {
    return { messages: [], failedOpen: true, error: "GOSLEEP_INTERNAL_SECRET unset" };
  }

  let res: Response;
  try {
    res = await fetchFn(steerDrainUrl(sessionId), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gosleep-internal-secret": secret,
        host: "127.0.0.1:7331",
        origin: "http://127.0.0.1:7331",
      },
      body: "{}",
    });
  } catch (err) {
    return {
      messages: [],
      failedOpen: true,
      error: `network: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (res.status === 503) return { messages: [], failedOpen: true, error: "core /internal off (503)" };
  if (res.status === 404) return { messages: [] }; // no queue yet, that's fine
  if (!res.ok) return { messages: [], error: `core rejected: HTTP ${res.status}` };

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    return { messages: [], error: `bad JSON from core: ${err instanceof Error ? err.message : String(err)}` };
  }
  const parsed = drainResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { messages: [], error: `drain schema: ${parsed.error.message}` };
  }
  if (!parsed.data.ok) {
    return { messages: [], error: parsed.data.error ?? "core returned ok=false" };
  }
  return { messages: parsed.data.messages };
}
