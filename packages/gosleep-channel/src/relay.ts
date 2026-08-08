// @gosleep/channel — HTTP client for the gosleep-core /internal/permission-
// relay + /internal/permissions/:qid/decision-wait endpoints (GSL-282).
//
// Fail-open by design: any failure to reach core is treated as "core is off,
// let the local TUI/hook path handle this decision" — the same posture the
// existing GSL-284 hook shim takes. NEVER throw across the MCP boundary; the
// server should always be able to serve the notification even when core is
// unreachable.

import {
  permissionRelayUrl,
  permissionDecisionWaitUrl,
  internalSecret,
} from "./config.ts";
import {
  type PermissionRequest,
  type RelayAck,
  type DecisionWait,
  relayAckSchema,
  decisionWaitSchema,
} from "./types.ts";

/**
 * Minimal fetch signature the relay uses — call-only, no static properties.
 * Real callers pass the global `fetch`; tests pass a stub. Deliberately loose
 * so a stub does not have to synthesize the whole `typeof fetch` surface
 * (Bun's flavour adds `.preconnect` which is irrelevant to us).
 */
export type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface RelayResult {
  ok: boolean;
  qid?: string;
  /** true when the reason was "core unreachable / secret missing / etc" — safe to fall open. */
  failedOpen?: boolean;
  error?: string;
}

/**
 * Post a channel-originated PermissionRequest to gosleep-core. Returns the
 * qid the server minted (so the plugin can long-poll for a decision) or a
 * failedOpen flag when core is unreachable.
 */
export async function relayPermissionRequest(
  req: PermissionRequest,
  fetchFn: FetchFn = fetch,
): Promise<RelayResult> {
  const secret = internalSecret();
  if (secret === undefined) {
    // The docs are explicit: when core has no secret in its env, /internal/*
    // returns 503 and callers must fall open. Save the round trip.
    return { ok: false, failedOpen: true, error: "GOSLEEP_INTERNAL_SECRET unset" };
  }

  let res: Response;
  try {
    res = await fetchFn(permissionRelayUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gosleep-internal-secret": secret,
        // Match the app-wide requireLocalHost / requireLocalOrigin guard —
        // the request has to LOOK like it came from a local caller because
        // that is exactly what it is.
        host: "127.0.0.1:7331",
        origin: "http://127.0.0.1:7331",
      },
      body: JSON.stringify({
        session_id: req.session_id ?? "",
        tool_use_id: req.request_id, // reuse: same request_id doubles as the tool_use_id
        tool_input: {
          tool: req.tool_name,
          params: null,
          message: `${req.description}${req.description && req.input_preview ? "\n" : ""}${req.input_preview}`,
        },
      }),
    });
  } catch (err) {
    // Network error → core is likely off; fall open, do not surface as an error.
    return {
      ok: false,
      failedOpen: true,
      error: `network: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (res.status === 503) {
    return { ok: false, failedOpen: true, error: "core /internal off (503)" };
  }
  if (!res.ok) {
    return { ok: false, error: `core rejected: HTTP ${res.status}` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    return {
      ok: false,
      error: `bad JSON from core: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const parsed = relayAckSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: `relay ack schema: ${parsed.error.message}` };
  }
  const ack: RelayAck = parsed.data;
  if (!ack.ok) {
    return { ok: false, error: ack.error ?? "core returned ok=false" };
  }
  return { ok: true, qid: ack.qid };
}

/**
 * Long-poll gosleep-core for the owner's decision on a qid. Blocks up to
 * timeoutS seconds (default 600 to match the code.claude.com/docs/en/hooks.md
 * documented default; core caps at 1800 anyway). Returns:
 *   { behavior: "allow"|"deny" } — the owner clicked; deliver back on channel
 *   { timeout: true }           — nobody answered; the local dialog will win
 *   { failedOpen: true }        — core unreachable; the local dialog will win
 *   { error: "..." }            — protocol failure; log and give up
 */
export interface DecisionResult {
  behavior?: "allow" | "deny";
  answered_by?: string;
  timeout?: boolean;
  failedOpen?: boolean;
  error?: string;
}

export async function waitForDecision(
  qid: string,
  timeoutS = 600,
  fetchFn: FetchFn = fetch,
): Promise<DecisionResult> {
  const secret = internalSecret();
  if (secret === undefined) {
    return { failedOpen: true, error: "GOSLEEP_INTERNAL_SECRET unset" };
  }

  const url = `${permissionDecisionWaitUrl(qid)}?timeout_s=${timeoutS}`;
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "GET",
      headers: {
        "x-gosleep-internal-secret": secret,
        host: "127.0.0.1:7331",
        origin: "http://127.0.0.1:7331",
      },
    });
  } catch (err) {
    return {
      failedOpen: true,
      error: `network: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (res.status === 503) return { failedOpen: true, error: "core /internal off (503)" };
  if (res.status === 204) return { timeout: true };
  if (res.status === 404) return { error: "unknown qid" };
  if (!res.ok) return { error: `core rejected: HTTP ${res.status}` };

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    return { error: `bad JSON from core: ${err instanceof Error ? err.message : String(err)}` };
  }
  const parsed = decisionWaitSchema.safeParse(body);
  if (!parsed.success) {
    return { error: `decision wait schema: ${parsed.error.message}` };
  }
  const wait: DecisionWait = parsed.data;
  if (wait.timeout === true) return { timeout: true };
  if (wait.behavior === undefined) return { error: "core omitted behavior" };
  return { behavior: wait.behavior, answered_by: wait.answered_by };
}
