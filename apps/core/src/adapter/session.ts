// @gosleep/core — SessionAdapter singleton (GSL-281 / rev-3 addendum Delta 10).
//
// The ONE place `apps/core/` constructs a runner-adapter instance. Every non-adapter file
// (workers, routes, actions) that needs to enumerate sessions, deliver answers, or read
// transcripts imports the adapter through THIS module — never through
// `@gosleep/runner-adapter#createClaudeCodeAdapter` directly. That keeps the eventual
// swap to a different provider a one-file change here.
//
// v1 wiring: the Claude Code adapter is the only provider. `deliverAnswer` routes through
// the in-process `questionNotifier` — the mechanism that wakes the hook long-poll GET
// `/internal/questions/:qid/answer-wait` (see `src/routes/internal.ts`). A future provider
// swap would replace `createClaudeCodeAdapter` here with the new factory.

import { createClaudeCodeAdapter, type SessionAdapter } from "@gosleep/runner-adapter";

import { questionNotifier } from "../questions/notifier.ts";

let cached: SessionAdapter | null = null;

/**
 * Return the process-wide SessionAdapter. Lazy so unit tests that mock modules do not pay
 * the CLI wrapper's construction cost when they never call `listSessions`.
 */
export function getSessionAdapter(): SessionAdapter {
  if (cached === null) {
    cached = createClaudeCodeAdapter({
      notify: (mutation) => questionNotifier.notify(mutation),
    });
  }
  return cached;
}

/**
 * Test-only: overwrite the cached adapter with a fake. Called from unit tests that want to
 * stub `listSessions` / `deliverAnswer` without pulling in the real CLI wrapper.
 */
export function __setSessionAdapterForTest(adapter: SessionAdapter | null): void {
  cached = adapter;
}
