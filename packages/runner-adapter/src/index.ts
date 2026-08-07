// @gosleep/runner-adapter — barrel export.
//
// Kept intentionally thin: consumers import { listClaudeAgents, ClaudeAgent } from
// "@gosleep/runner-adapter" and never reach into subpaths. The single import surface is what
// lets a future non-claude runner replace this package without touching apps/core/.

export {
  listClaudeAgents,
  normaliseAgents,
  type ClaudeAgent,
  type ListAgentsOptions,
  type ListAgentsResult,
} from "./claude-code.ts";
