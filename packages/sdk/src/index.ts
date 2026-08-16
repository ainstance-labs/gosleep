// @gosleep/sdk — typed HTTP + SSE client over @gosleep/core (GSL-265).
//
// Design:
//   - Constructor accepts { baseUrl, getBearer } — getBearer is a pull-callback (not a raw
//     string) so a rotating token in sessionStorage does not need to remake the client.
//   - Every read method calls fetch() then z.parse() through the matching @gosleep/schema
//     validator. Server drift becomes a caught error at the SDK layer, not a NaN downstream.
//   - `subscribe(...)` opens an EventSource and returns a disposer. It handles reconnect
//     internally (browser does it natively) but re-registers our per-event handlers on each
//     construction. The browser sends Last-Event-ID for us — the server (see
//     apps/core/src/routes/events.ts) prefers that header over `?since=`.
//   - The `rotate` handler is broken out so the UI layer can invalidate queries + toast
//     without knowing anything about the underlying EventSource semantics.

import {
  AckActionInput,
  AckActionResponse,
  AnswerActionInput,
  AnswerActionResponse,
  ApplyManifestActionInput,
  ApplyManifestActionResponse,
  BundleResponse,
  CostResponse,
  DecidePermissionActionInput,
  DecidePermissionActionResponse,
  DeferActionInput,
  DeferActionResponse,
  FleetResponse,
  ManifestResponse,
  QuestionsResponse,
  ResolveActionInput,
  ResolveActionResponse,
  SkillsResponse,
  SkillDiffResponse,
  SnapshotActionInput,
  SnapshotActionResponse,
  PublishSkillActionInput,
  PublishSkillActionResponse,
  ObservedCollectorsResponse,
  ObservedEventsResponse,
  ObservedProjectsResponse,
  ObservedSessionsResponse,
  ObservedTmuxResponse,
  SseEventData,
  SseRotateData,
  StatusResponse,
  SyncTasksActionInput,
  SyncTasksActionResponse,
  TasksResponse,
  TickActionInput,
  TickActionResponse,
  TimelineResponse,
  VersionResponse,
  WhoamiResponse,
} from "@gosleep/schema";
import type {
  AckActionInput as AckActionInputT,
  AckActionResponse as AckActionResponseT,
  AnswerActionInput as AnswerActionInputT,
  AnswerActionResponse as AnswerActionResponseT,
  ApplyManifestActionInput as ApplyManifestActionInputT,
  ApplyManifestActionResponse as ApplyManifestActionResponseT,
  BundleResponse as BundleResponseT,
  CostResponse as CostResponseT,
  DecidePermissionActionInput as DecidePermissionActionInputT,
  DecidePermissionActionResponse as DecidePermissionActionResponseT,
  DeferActionInput as DeferActionInputT,
  DeferActionResponse as DeferActionResponseT,
  FleetResponse as FleetResponseT,
  ManifestResponse as ManifestResponseT,
  QuestionsResponse as QuestionsResponseT,
  ResolveActionInput as ResolveActionInputT,
  ResolveActionResponse as ResolveActionResponseT,
  SkillsResponse as SkillsResponseT,
  SkillDiffResponse as SkillDiffResponseT,
  SnapshotActionInput as SnapshotActionInputT,
  SnapshotActionResponse as SnapshotActionResponseT,
  PublishSkillActionInput as PublishSkillActionInputT,
  PublishSkillActionResponse as PublishSkillActionResponseT,
  ObservedCollectorsResponse as ObservedCollectorsResponseT,
  ObservedEventsResponse as ObservedEventsResponseT,
  ObservedProjectsResponse as ObservedProjectsResponseT,
  ObservedSessionsResponse as ObservedSessionsResponseT,
  ObservedTmuxResponse as ObservedTmuxResponseT,
  SseEventData as SseEventDataT,
  SseRotateData as SseRotateDataT,
  StatusResponse as StatusResponseT,
  SyncTasksActionInput as SyncTasksActionInputT,
  SyncTasksActionResponse as SyncTasksActionResponseT,
  TasksResponse as TasksResponseT,
  TickActionInput as TickActionInputT,
  TickActionResponse as TickActionResponseT,
  TimelineResponse as TimelineResponseT,
  VersionResponse as VersionResponseT,
  WhoamiResponse as WhoamiResponseT,
} from "@gosleep/schema";
import type { ZodType } from "zod";

// -----------------------------------------------------------------------------
// error types
// -----------------------------------------------------------------------------

/** Thrown when the server returned a non-2xx response. */
export class ApiError extends Error {
  override readonly name = "ApiError";
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body?: string,
  ) {
    super(`HTTP ${status} from ${url}`);
  }
}

/** Thrown when the JSON parsed but did not match the expected schema. */
export class SchemaError extends Error {
  override readonly name = "SchemaError";
  constructor(
    public readonly url: string,
    public override readonly cause: unknown,
  ) {
    super(`Response from ${url} failed schema validation`);
  }
}

// -----------------------------------------------------------------------------
// client options
// -----------------------------------------------------------------------------

export interface CoreClientOptions {
  /** Base URL of gosleep-core (default: window.location.origin — served by Vite proxy or by
   *  the launchd server). */
  baseUrl?: string;
  /** Pulled at every request — return `null` if no token is available yet.
   *  In the web app this reads sessionStorage; in tests, pass a constant. */
  getBearer: () => string | null;
  /** Optional fetch override (tests pass a mock). */
  fetch?: typeof fetch;
}

// -----------------------------------------------------------------------------
// CoreClient
// -----------------------------------------------------------------------------

export class CoreClient {
  private readonly baseUrl: string;
  private readonly getBearer: () => string | null;
  private readonly fetchFn: typeof fetch;

  constructor(options: CoreClientOptions) {
    // Trailing slash removed so path joins stay predictable. Default to the browser's
    // origin — in dev, Vite's proxy rewrites /api → 127.0.0.1:7331 (see apps/web/vite.config.ts).
    const base =
      options.baseUrl ??
      (typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:7331");
    this.baseUrl = base.replace(/\/+$/, "");
    this.getBearer = options.getBearer;
    // Bind fetch to its owning global. Assigning `fetch` to an instance property strips
    // its `this` and browsers throw `Illegal invocation` on the first call. Custom fetches
    // (test seams) are used as-is.
    if (options.fetch !== undefined) {
      this.fetchFn = options.fetch;
    } else if (typeof window !== "undefined") {
      this.fetchFn = fetch.bind(window);
    } else if (typeof globalThis !== "undefined") {
      this.fetchFn = fetch.bind(globalThis);
    } else {
      this.fetchFn = fetch;
    }
  }

  // ---- typed GET helpers ----------------------------------------------------

  private async get<T>(path: string, schema: ZodType<T>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    const token = this.getBearer();
    if (token !== null && token.length > 0) headers.Authorization = `Bearer ${token}`;
    const res = await this.fetchFn(url, { headers, credentials: "same-origin" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ApiError(res.status, url, body);
    }
    const json: unknown = await res.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new SchemaError(url, parsed.error);
    }
    return parsed.data;
  }

  // ---- v1 read endpoints ----------------------------------------------------

  version(): Promise<VersionResponseT> {
    return this.get("/version", VersionResponse);
  }
  whoami(): Promise<WhoamiResponseT> {
    return this.get("/whoami", WhoamiResponse);
  }
  status(): Promise<StatusResponseT> {
    return this.get("/status", StatusResponse);
  }
  bundle(): Promise<BundleResponseT> {
    return this.get("/bundle", BundleResponse);
  }
  questions(params?: { status?: string; limit?: number }): Promise<QuestionsResponseT> {
    const q = new URLSearchParams();
    if (params?.status !== undefined) q.set("status", params.status);
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    const qs = q.toString();
    return this.get(`/questions${qs.length > 0 ? `?${qs}` : ""}`, QuestionsResponse);
  }
  skills(): Promise<SkillsResponseT> {
    return this.get("/skills", SkillsResponse);
  }
  // T6 (GSL-255) — full diff dump for the Skills-screen details drawer.
  skillDiff(name: string): Promise<SkillDiffResponseT> {
    return this.get(`/skills/${encodeURIComponent(name)}/diff`, SkillDiffResponse);
  }
  timeline(params?: {
    limit?: number;
    type?: string;
    task?: string;
  }): Promise<TimelineResponseT> {
    const q = new URLSearchParams();
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    if (params?.type !== undefined) q.set("type", params.type);
    if (params?.task !== undefined) q.set("task", params.task);
    const qs = q.toString();
    return this.get(`/timeline${qs.length > 0 ? `?${qs}` : ""}`, TimelineResponse);
  }
  tasks(params?: { epic?: string; status?: string }): Promise<TasksResponseT> {
    const q = new URLSearchParams();
    if (params?.epic !== undefined) q.set("epic", params.epic);
    if (params?.status !== undefined) q.set("status", params.status);
    const qs = q.toString();
    return this.get(`/tasks${qs.length > 0 ? `?${qs}` : ""}`, TasksResponse);
  }
  cost(params?: { limit?: number }): Promise<CostResponseT> {
    const q = new URLSearchParams();
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    const qs = q.toString();
    return this.get(`/cost${qs.length > 0 ? `?${qs}` : ""}`, CostResponse);
  }
  fleet(): Promise<FleetResponseT> {
    return this.get("/fleet", FleetResponse);
  }
  manifest(): Promise<ManifestResponseT> {
    return this.get("/manifest", ManifestResponse);
  }

  // ---- observer-mode reads (GSL-355 under GSL-350 phase 14) -----------------

  observedTmux(): Promise<ObservedTmuxResponseT> {
    return this.get("/observed/tmux", ObservedTmuxResponse);
  }
  observedSessions(): Promise<ObservedSessionsResponseT> {
    return this.get("/observed/sessions", ObservedSessionsResponse);
  }
  observedProjects(): Promise<ObservedProjectsResponseT> {
    return this.get("/observed/projects", ObservedProjectsResponse);
  }
  observedEvents(params?: {
    since?: number;
    limit?: number;
    project?: string;
  }): Promise<ObservedEventsResponseT> {
    const q = new URLSearchParams();
    if (params?.since !== undefined) q.set("since", String(params.since));
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    if (params?.project !== undefined) q.set("project", params.project);
    const qs = q.toString();
    return this.get(
      `/observed/events${qs.length > 0 ? `?${qs}` : ""}`,
      ObservedEventsResponse,
    );
  }
  observedCollectors(): Promise<ObservedCollectorsResponseT> {
    return this.get("/observed/collectors", ObservedCollectorsResponse);
  }

  // ---- typed POST helper ----------------------------------------------------
  //
  // Every /actions/* POST reuses the same envelope: a JSON body, an Idempotency-Key header,
  // and a validated JSON response through `postAction`. Callers pass a fresh idempotency key
  // per user-intent (the UI mints a UUID per click) so a double-clicked button is a no-op
  // replay on the server, not two spawns.

  private async postAction<Input, Output>(
    path: string,
    input: Input,
    inputSchema: ZodType<Input>,
    outputSchema: ZodType<Output>,
    idempotencyKey: string,
  ): Promise<Output> {
    // Validate the input on the client too — a mis-typed field surfaces here as a caught
    // ZodError, not as a 400 from the server that we then have to reverse-engineer.
    const validatedInput = inputSchema.parse(input);
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Idempotency-Key": idempotencyKey,
    };
    const token = this.getBearer();
    if (token !== null && token.length > 0) headers.Authorization = `Bearer ${token}`;
    const res = await this.fetchFn(url, {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify(validatedInput),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ApiError(res.status, url, body);
    }
    const json: unknown = await res.json();
    const parsed = outputSchema.safeParse(json);
    if (!parsed.success) {
      throw new SchemaError(url, parsed.error);
    }
    return parsed.data;
  }

  // ---- v1 action endpoints (GSL-268) ---------------------------------------

  answerQuestion(
    input: AnswerActionInputT,
    idempotencyKey: string,
  ): Promise<AnswerActionResponseT> {
    return this.postAction(
      "/actions/questions/answer",
      input,
      AnswerActionInput,
      AnswerActionResponse,
      idempotencyKey,
    );
  }

  resolveQuestion(
    input: ResolveActionInputT,
    idempotencyKey: string,
  ): Promise<ResolveActionResponseT> {
    return this.postAction(
      "/actions/questions/resolve",
      input,
      ResolveActionInput,
      ResolveActionResponse,
      idempotencyKey,
    );
  }

  ackEvent(input: AckActionInputT, idempotencyKey: string): Promise<AckActionResponseT> {
    return this.postAction(
      "/actions/events/ack",
      input,
      AckActionInput,
      AckActionResponse,
      idempotencyKey,
    );
  }

  runTick(input: TickActionInputT, idempotencyKey: string): Promise<TickActionResponseT> {
    return this.postAction(
      "/actions/tick",
      input,
      TickActionInput,
      TickActionResponse,
      idempotencyKey,
    );
  }

  applyManifestToQuestion(
    input: ApplyManifestActionInputT,
    idempotencyKey: string,
  ): Promise<ApplyManifestActionResponseT> {
    return this.postAction(
      "/actions/questions/apply-manifest",
      input,
      ApplyManifestActionInput,
      ApplyManifestActionResponse,
      idempotencyKey,
    );
  }

  deferQuestion(
    input: DeferActionInputT,
    idempotencyKey: string,
  ): Promise<DeferActionResponseT> {
    return this.postAction(
      "/actions/questions/defer",
      input,
      DeferActionInput,
      DeferActionResponse,
      idempotencyKey,
    );
  }

  syncTasks(
    input: SyncTasksActionInputT,
    idempotencyKey: string,
  ): Promise<SyncTasksActionResponseT> {
    return this.postAction(
      "/actions/tasks/sync",
      input,
      SyncTasksActionInput,
      SyncTasksActionResponse,
      idempotencyKey,
    );
  }

  /** GSL-298: fire a manual DB snapshot (`snapshot.sh` under the hood). Returns the
   *  path + kind the script wrote. `label` omitted → daily; label present → manual (kept
   *  indefinitely per snapshot.sh retention). */
  takeSnapshot(
    input: SnapshotActionInputT,
    idempotencyKey: string,
  ): Promise<SnapshotActionResponseT> {
    return this.postAction(
      "/actions/snapshot",
      input,
      SnapshotActionInput,
      SnapshotActionResponse,
      idempotencyKey,
    );
  }

  /** T5 (GSL-286 + GSL-266 partial): publish a single named skill from dev → production.
   *  Spawns publish.sh with a per-request env-nonce so the CLI's owner-gate opens on the
   *  endpoint path. Returns the parsed skills.publish.done event. */
  publishSkill(
    input: PublishSkillActionInputT,
    idempotencyKey: string,
  ): Promise<PublishSkillActionResponseT> {
    return this.postAction(
      "/actions/skills/publish",
      input,
      PublishSkillActionInput,
      PublishSkillActionResponse,
      idempotencyKey,
    );
  }

  /** GSL-284: owner decides Allow/Deny on a permission-kind question row. */
  decidePermission(
    input: DecidePermissionActionInputT,
    idempotencyKey: string,
  ): Promise<DecidePermissionActionResponseT> {
    return this.postAction(
      "/actions/permissions/decide",
      input,
      DecidePermissionActionInput,
      DecidePermissionActionResponse,
      idempotencyKey,
    );
  }
}

// -----------------------------------------------------------------------------
// SSE subscribe — Last-Event-ID resume + rotate + typed frames.
//
// We DO NOT use the native `EventSource` API here — it forbids custom headers, which means
// the Bearer token would have to travel on the querystring. That is workable on loopback
// (server binds to 127.0.0.1) but it also foils the server's `requireBearer` middleware
// which reads only `Authorization: Bearer <…>`. Rather than fork the server to accept a
// query-param token, we implement a minimal SSE reader over fetch + ReadableStream:
//
//   1. fetch('/events', { headers: { Authorization, 'Last-Event-ID' } })
//   2. TextDecoderStream → line splitter → SSE frame parser (id/event/data blocks).
//   3. Manual reconnect with exponential backoff (250 ms → 8 s cap) on network drop.
//   4. On every complete frame we bump our own `lastEventId` — the resume header for the
//      next reconnect. This matches native EventSource semantics.
//
// The parser handles the exact frames the server emits (see apps/core/src/routes/events.ts):
//   id: <seq>\nevent: <type>\ndata: <json>\n\n           — typed event
//   event: rotate\ndata: {"new_day": "…"}\n\n            — UTC-day rotation
//   : keepalive <iso>\n\n                                — heartbeat comment (ignored)
// -----------------------------------------------------------------------------

export interface SseHandlers {
  /** Any typed event landing in the events table (fires on every message). */
  onEvent?: (evt: SseEventDataT) => void;
  /** UTC-day rotation — invalidate queries + toast in the UI. */
  onRotate?: (data: SseRotateDataT) => void;
  /** Connection state transitions. */
  onOpen?: () => void;
  onError?: (err: unknown) => void;
}

export interface SseSubscribeOptions {
  baseUrl?: string;
  /** Same seam as CoreClient — pulled at every reconnect. */
  getBearer: () => string | null;
  /** Initial `since=<seq>` on the FIRST connect only. Subsequent reconnects use the
   *  `Last-Event-ID` header populated from received frames. */
  since?: number;
  /** Optional fetch override (tests). */
  fetch?: typeof fetch;
}

interface SseFrame {
  id?: string;
  event?: string;
  data: string;
}

/** Split the incoming text stream into SSE frames (separated by "\n\n"). */
async function* readSseFrames(
  body: ReadableStream<Uint8Array>,
): AsyncIterableIterator<SseFrame> {
  // TextDecoderStream's lib.dom typing declares writable as WritableStream<BufferSource>,
  // which is wider than the ReadableStream<Uint8Array> input pipeThrough expects. The
  // runtime is fine; cast through unknown to bridge the type mismatch.
  const decoder = new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>;
  const reader = body.pipeThrough(decoder).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let sep = buffer.indexOf("\n\n");
    while (sep !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const frame: SseFrame = { data: "" };
      let dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.length === 0) continue;
        if (line.startsWith(":")) continue; // comment / keepalive
        const idx = line.indexOf(":");
        if (idx < 0) continue;
        const field = line.slice(0, idx);
        const rest = line.slice(idx + 1).replace(/^ /, "");
        if (field === "id") frame.id = rest;
        else if (field === "event") frame.event = rest;
        else if (field === "data") dataLines.push(rest);
      }
      frame.data = dataLines.join("\n");
      // A pure keepalive block (only a comment) produces an empty frame — skip it.
      if (frame.data.length > 0 || frame.event !== undefined || frame.id !== undefined) {
        yield frame;
      }
      sep = buffer.indexOf("\n\n");
    }
  }
}

/**
 * Open an SSE subscription. Returns a disposer that aborts the underlying fetch and stops
 * reconnecting. Safe to call multiple times.
 */
export function subscribe(handlers: SseHandlers, opts: SseSubscribeOptions): () => void {
  const base =
    opts.baseUrl ??
    (typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:7331");
  const url0 = `${base.replace(/\/+$/, "")}/events`;
  // Same illegal-invocation guard as CoreClient: bind fetch to its owning global unless
  // the caller passed a custom one.
  const fetchFn: typeof fetch =
    opts.fetch ??
    (typeof window !== "undefined"
      ? fetch.bind(window)
      : typeof globalThis !== "undefined"
        ? fetch.bind(globalThis)
        : fetch);

  let disposed = false;
  let controller: AbortController | null = null;
  let lastEventId: string | null =
    typeof opts.since === "number" && opts.since > 0 ? String(opts.since) : null;
  let backoff = 250;

  const emitEvent = (payload: string): void => {
    if (handlers.onEvent === undefined) return;
    try {
      const parsed = SseEventData.safeParse(JSON.parse(payload));
      if (parsed.success) handlers.onEvent(parsed.data);
    } catch {
      /* malformed frame — next `id:` will resync */
    }
  };

  const emitRotate = (payload: string): void => {
    if (handlers.onRotate === undefined) return;
    try {
      const parsed = SseRotateData.safeParse(JSON.parse(payload));
      if (parsed.success) handlers.onRotate(parsed.data);
    } catch {
      /* ignore */
    }
  };

  const loop = async (): Promise<void> => {
    while (!disposed) {
      controller = new AbortController();
      const headers: Record<string, string> = { Accept: "text/event-stream" };
      const token = opts.getBearer();
      if (token !== null && token.length > 0) headers.Authorization = `Bearer ${token}`;
      if (lastEventId !== null) headers["Last-Event-ID"] = lastEventId;
      const url =
        lastEventId === null && typeof opts.since === "number" && opts.since > 0
          ? `${url0}?since=${opts.since}`
          : url0;
      try {
        const res = await fetchFn(url, {
          headers,
          signal: controller.signal,
          credentials: "same-origin",
        });
        if (!res.ok || res.body === null) {
          throw new ApiError(res.status, url);
        }
        if (handlers.onOpen !== undefined) handlers.onOpen();
        backoff = 250; // reset on successful open
        for await (const frame of readSseFrames(res.body)) {
          if (disposed) return;
          if (frame.id !== undefined && frame.id.length > 0) lastEventId = frame.id;
          const kind = frame.event ?? "message";
          if (kind === "rotate") emitRotate(frame.data);
          else emitEvent(frame.data);
        }
      } catch (err) {
        if (disposed) return;
        if (handlers.onError !== undefined) handlers.onError(err);
      }
      // reconnect with capped exponential backoff
      if (disposed) return;
      await new Promise<void>((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 8_000);
    }
  };

  void loop();

  return (): void => {
    disposed = true;
    if (controller !== null) controller.abort();
  };
}

export type {
  AckActionInputT as AckActionInput,
  AckActionResponseT as AckActionResponse,
  AnswerActionInputT as AnswerActionInput,
  AnswerActionResponseT as AnswerActionResponse,
  ApplyManifestActionInputT as ApplyManifestActionInput,
  ApplyManifestActionResponseT as ApplyManifestActionResponse,
  BundleResponseT as BundleResponse,
  CostResponseT as CostResponse,
  DecidePermissionActionInputT as DecidePermissionActionInput,
  DecidePermissionActionResponseT as DecidePermissionActionResponse,
  DeferActionInputT as DeferActionInput,
  DeferActionResponseT as DeferActionResponse,
  FleetResponseT as FleetResponse,
  ManifestResponseT as ManifestResponse,
  QuestionsResponseT as QuestionsResponse,
  ResolveActionInputT as ResolveActionInput,
  ResolveActionResponseT as ResolveActionResponse,
  SkillsResponseT as SkillsResponse,
  SkillDiffResponseT as SkillDiffResponse,
  SnapshotActionInputT as SnapshotActionInput,
  PublishSkillActionInputT as PublishSkillActionInput,
  SnapshotActionResponseT as SnapshotActionResponse,
  PublishSkillActionResponseT as PublishSkillActionResponse,
  ObservedCollectorsResponseT as ObservedCollectorsResponse,
  ObservedEventsResponseT as ObservedEventsResponse,
  ObservedProjectsResponseT as ObservedProjectsResponse,
  ObservedSessionsResponseT as ObservedSessionsResponse,
  ObservedTmuxResponseT as ObservedTmuxResponse,
  SseEventDataT as SseEventData,
  SseRotateDataT as SseRotateData,
  StatusResponseT as StatusResponse,
  SyncTasksActionInputT as SyncTasksActionInput,
  SyncTasksActionResponseT as SyncTasksActionResponse,
  TasksResponseT as TasksResponse,
  TickActionInputT as TickActionInput,
  TickActionResponseT as TickActionResponse,
  TimelineResponseT as TimelineResponse,
  VersionResponseT as VersionResponse,
  WhoamiResponseT as WhoamiResponse,
};
