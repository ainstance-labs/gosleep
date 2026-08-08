// @gosleep/runner-adapter — SessionAdapter interface (GSL-281 / rev-3 addendum Delta 10).
//
// Rev-3 addendum Delta 10 named a coverage gap (G11): "Rev 2 does not acknowledge R7"
// (Future-proofing — providers other than Claude Code later). This module carries the seam.
// Owner requirement R7 asks the harness to be provider-agnostic, but for v1 we ship ONE
// implementation (`claude-code.ts`) — the second provider adapter is a v2 task.
//
// The four seams the SessionAdapter interface isolates:
//
//   1. `listSessions()` — enumerate the live sessions the provider knows about. Today this
//      wraps `claude agents --json`; tomorrow a different provider (Codex CLI, an in-process
//      SDK, a socket to a runner daemon) supplies its own listing.
//
//   2. `installSessionHooks(ctx)` — write the provider-specific per-session hook fragments
//      (for Claude Code: `.claude/settings.json` with dual-write, AskUserQuestion, and
//      PermissionRequest matchers). v1 seed exposes the interface only — the concrete install
//      body is owned by GSL-267 per the Jira scope.
//
//   3. `deliverAnswer(input)` — the mechanism that pushes an owner's answer to the paused
//      session. For Claude Code the delivery is via an in-process EventEmitter (the question
//      notifier) that wakes the hook long-poll. For a hypothetical HTTP-based provider the
//      adapter would POST to a callback URL the runner exposes. Callers of this seam therefore
//      hand the adapter a mutation object; the adapter chooses the wire.
//
//   4. `readTranscript(sessionId)` — enumerate post-hoc transcript files for a session,
//      marked ENRICHMENT-ONLY per rev-3 addendum Delta 3. Never used by the tail indexer for
//      live SSE signal — a later enrichment worker consumes it lazily. For Claude Code this
//      scans `~/.claude/projects/**/{sessionId}*.jsonl`.
//
// All non-adapter code in `apps/core/` MUST import through the adapter, not the underlying
// CLI helpers. `grep -R 'claude agents' apps/core/src` returning 0 hits is the acceptance
// tripwire per the GSL-281 Jira description.

// -----------------------------------------------------------------------------
// listSessions
// -----------------------------------------------------------------------------

/**
 * Cross-provider summary of ONE live session. Fields are the intersection of what every
 * plausible provider exposes; provider-specific extras (model, context %, current tool)
 * arrive through the hook + shim layer, not this listing.
 */
export interface SessionSummary {
  /** Stable provider-native id (Claude Code UUID; a Codex adapter would use its own). */
  session_id: string;
  /** Human-readable label (harness convention: `gosleep-<cycle>`). */
  name: string;
  /** Provider-native session kind ('interactive' / 'background' / adapter-defined). */
  kind: string;
  pid: number | null;
  cwd: string;
  /** Provider-native status ('busy' / 'idle' / 'waiting' / adapter-defined). */
  status: string;
  /** First-observed timestamp in epoch ms. */
  started_at_epoch_ms: number;
}

export interface ListSessionsOptions {
  /** Cap per-call time (ms). Providers with slow enumeration must respect this. */
  timeoutMs?: number;
}

export interface ListSessionsResult {
  ok: boolean;
  sessions: SessionSummary[];
  elapsedMs: number;
  /** Empty when ok=true. Populated with a short machine-readable reason on failure:
   *  "timeout" | "exit=N" | "parse: <msg>" | "spawn: <msg>" | "not-implemented" | ... */
  reason: string;
}

// -----------------------------------------------------------------------------
// installSessionHooks
// -----------------------------------------------------------------------------

export interface InstallHooksContext {
  /** Absolute path of the target project directory (whose `.claude/` we write). */
  projectDir: string;
  /** Absolute URL of the running control-plane core. Hooks POST here. */
  coreUrl: string;
  /** Absolute path of the hook-script bundle (defaults to `<repo>/tools/hooks/`). */
  hookScriptDir: string;
}

export interface InstallHooksResult {
  ok: boolean;
  /** Absolute path of the settings file the adapter would (or did) write. */
  settingsPath: string;
  /** Human-readable list of installed hook matchers, e.g. ["PreToolUse{AskUserQuestion}"]. */
  hooks: string[];
  /** Empty on ok=true. On ok=false: why nothing was written. */
  reason: string;
}

// -----------------------------------------------------------------------------
// deliverAnswer
// -----------------------------------------------------------------------------

/**
 * The mutation payload the answer-delivery seam accepts. Mirrors the shape apps/core's
 * in-process question notifier consumes; kept here so the interface stands alone (a fresh
 * clone of the adapter package need not touch apps/core to compile).
 */
export interface QuestionMutation {
  qid: string;
  /** New questions.status value ('answered' | 'resolved' | 'auto-resolved' | ...). */
  status: string;
  answer_text: string | null;
  answered_at: string | null;
  answered_by: string | null;
}

export interface DeliverAnswerInput extends QuestionMutation {
  /** Optional provider session id the answer targets. `null` when the caller does not track
   *  which session originally asked (the notifier fans out by qid, not by session). */
  session_id?: string | null;
}

export interface DeliverAnswerResult {
  ok: boolean;
  /** Wire the adapter used:
   *   - `in-process-notifier` — EventEmitter (today's Claude Code adapter default).
   *   - `http` — POST to a runner-supplied callback URL.
   *   - `socket` — Unix / TCP socket the runner is listening on.
   *   - `noop` — the adapter had no delivery mechanism wired; the caller must fall back. */
  channel: "in-process-notifier" | "http" | "socket" | "noop";
  reason: string;
}

// -----------------------------------------------------------------------------
// readTranscript (enrichment-only — rev-3 addendum Delta 3)
// -----------------------------------------------------------------------------

export interface TranscriptEntry {
  /** Absolute path of the transcript file. */
  path: string;
  /** Session id the transcript belongs to (parsed from the filename). */
  session_id: string;
  size_bytes: number;
  modified_at_epoch_ms: number;
}

export interface ReadTranscriptResult {
  ok: boolean;
  session_id: string;
  entries: TranscriptEntry[];
  reason: string;
}

// -----------------------------------------------------------------------------
// SessionAdapter
// -----------------------------------------------------------------------------

export interface SessionAdapter {
  /** Machine-readable id ('claude-code'). */
  readonly id: string;
  /** Display name shown in logs, dashboards ('Claude Code CLI'). */
  readonly displayName: string;

  /** Enumerate live sessions the provider knows about. Never throws — a listing failure
   *  returns ok=false with a descriptive reason so the caller can log-and-continue. */
  listSessions(opts?: ListSessionsOptions): Promise<ListSessionsResult>;

  /** Install the provider-specific per-session hook fragments (Claude Code:
   *  `.claude/settings.json` matchers; a socket-based provider: config the runner reads).
   *  v1 seed exposes the seam; the concrete install body lands in GSL-267. */
  installSessionHooks(ctx: InstallHooksContext): Promise<InstallHooksResult>;

  /** Push an answer to the paused session. Synchronous by contract: today's implementation
   *  fires an in-process event; future providers may enqueue an HTTP POST (which they
   *  should still return synchronously — the caller does not await network I/O here). */
  deliverAnswer(input: DeliverAnswerInput): DeliverAnswerResult;

  /** Enumerate on-disk transcripts for a session. ENRICHMENT-ONLY per rev-3 addendum
   *  Delta 3 — never a live SSE signal path, never consumed by the tail indexer. */
  readTranscript(sessionId: string): ReadTranscriptResult;
}
