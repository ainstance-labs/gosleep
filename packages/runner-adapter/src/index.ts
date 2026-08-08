// @gosleep/runner-adapter — barrel export (GSL-276 base; GSL-281 SessionAdapter seed).
//
// Kept intentionally thin: consumers import { createClaudeCodeAdapter, SessionAdapter } from
// "@gosleep/runner-adapter" and never reach into subpaths. The single import surface is what
// lets a future non-claude runner replace this package without touching apps/core/.
//
// TWO tiers exported:
//   - HIGH-LEVEL (GSL-281): SessionAdapter interface + createClaudeCodeAdapter() factory.
//     Every non-adapter file in apps/core/ MUST talk to a provider through THIS surface.
//     `grep -R 'claude agents' apps/core/src` returning 0 hits is the acceptance tripwire.
//   - LOW-LEVEL: listClaudeAgents / normaliseAgents / ClaudeAgent — the shell wrapper and
//     row shape the CLI natively prints. Retained so existing unit tests
//     (apps/core/test/fleet.poll.test.ts) can keep importing the concrete row type; the
//     production wiring still goes through the SessionAdapter.

export {
  createClaudeCodeAdapter,
  listClaudeAgents,
  normaliseAgents,
  type ClaudeAgent,
  type CreateClaudeCodeAdapterOptions,
  type ListAgentsOptions,
  type ListAgentsResult,
} from "./claude-code.ts";

export type {
  DeliverAnswerInput,
  DeliverAnswerResult,
  InstallHooksContext,
  InstallHooksResult,
  ListSessionsOptions,
  ListSessionsResult,
  QuestionMutation,
  ReadTranscriptResult,
  SessionAdapter,
  SessionSummary,
  TranscriptEntry,
} from "./session-adapter.ts";
