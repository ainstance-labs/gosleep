// @gosleep/web — TanStack Query hooks over CoreClient (GSL-265, GSL-268).
//
// One place to name every query key so the SSE provider can invalidate the right buckets
// on new events. Convention: `["core", "<endpoint>", …params]`. GSL-268 adds four mutation
// hooks that wrap the CoreClient's /actions/* POSTs — each mints a fresh Idempotency-Key per
// invocation so a double-clicked button becomes a server-side replay, not two spawns.

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import type {
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
  PublishSkillActionInput,
  PublishSkillActionResponse,
  QuestionsResponse,
  ResolveActionInput,
  ResolveActionResponse,
  SkillDiffResponse,
  SkillsResponse,
  SnapshotActionInput,
  SnapshotActionResponse,
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

import { coreClient } from "./client";

export const queryKeys = {
  version: () => ["core", "version"] as const,
  whoami: () => ["core", "whoami"] as const,
  status: () => ["core", "status"] as const,
  bundle: () => ["core", "bundle"] as const,
  questions: (status?: string) => ["core", "questions", status ?? "all"] as const,
  skills: () => ["core", "skills"] as const,
  skillDiff: (name: string) => ["core", "skills", "diff", name] as const,
  timeline: (limit?: number, type?: string, task?: string) =>
    ["core", "timeline", limit ?? 100, type ?? "", task ?? ""] as const,
  tasks: (epic?: string, status?: string) =>
    ["core", "tasks", epic ?? "", status ?? ""] as const,
  cost: (limit?: number) => ["core", "cost", limit ?? 60] as const,
  fleet: () => ["core", "fleet"] as const,
  manifest: () => ["core", "manifest"] as const,
} as const;

export function useVersion(): UseQueryResult<VersionResponse> {
  return useQuery({ queryKey: queryKeys.version(), queryFn: () => coreClient.version() });
}

export function useWhoami(): UseQueryResult<WhoamiResponse> {
  return useQuery({ queryKey: queryKeys.whoami(), queryFn: () => coreClient.whoami() });
}

export function useStatus(): UseQueryResult<StatusResponse> {
  return useQuery({
    queryKey: queryKeys.status(),
    queryFn: () => coreClient.status(),
    refetchInterval: 15_000,
  });
}

export function useBundle(): UseQueryResult<BundleResponse> {
  return useQuery({ queryKey: queryKeys.bundle(), queryFn: () => coreClient.bundle() });
}

export function useQuestions(status?: string): UseQueryResult<QuestionsResponse> {
  return useQuery({
    queryKey: queryKeys.questions(status),
    queryFn: () => coreClient.questions(status !== undefined ? { status } : undefined),
  });
}

export function useSkills(): UseQueryResult<SkillsResponse> {
  return useQuery({ queryKey: queryKeys.skills(), queryFn: () => coreClient.skills() });
}

// T6 (GSL-255) — full diff dump for the Skills-screen details drawer. Only fetches when a
// row is selected (enabled: name !== null) to avoid seven prefetches on mount.
export function useSkillDiff(name: string | null): UseQueryResult<SkillDiffResponse> {
  return useQuery({
    queryKey: queryKeys.skillDiff(name ?? "__none__"),
    queryFn: () => coreClient.skillDiff(name!),
    enabled: name !== null && name.length > 0,
  });
}

export function useTimeline(
  limit?: number,
  type?: string,
  task?: string,
): UseQueryResult<TimelineResponse> {
  return useQuery({
    queryKey: queryKeys.timeline(limit, type, task),
    queryFn: () =>
      coreClient.timeline({
        ...(limit !== undefined ? { limit } : {}),
        ...(type !== undefined && type.length > 0 ? { type } : {}),
        ...(task !== undefined && task.length > 0 ? { task } : {}),
      }),
  });
}

export function useTasks(epic?: string, status?: string): UseQueryResult<TasksResponse> {
  return useQuery({
    queryKey: queryKeys.tasks(epic, status),
    queryFn: () =>
      coreClient.tasks({
        ...(epic !== undefined && epic.length > 0 ? { epic } : {}),
        ...(status !== undefined && status.length > 0 ? { status } : {}),
      }),
  });
}

export function useCost(limit?: number): UseQueryResult<CostResponse> {
  return useQuery({
    queryKey: queryKeys.cost(limit),
    queryFn: () => coreClient.cost(limit !== undefined ? { limit } : undefined),
  });
}

export function useFleet(): UseQueryResult<FleetResponse> {
  return useQuery({ queryKey: queryKeys.fleet(), queryFn: () => coreClient.fleet() });
}

export function useManifest(): UseQueryResult<ManifestResponse> {
  return useQuery({
    queryKey: queryKeys.manifest(),
    queryFn: () => coreClient.manifest(),
    // Manifest edits are rare (owner-sovereign file) — poll every 5 min so a hot-edit lands
    // in the picker without a hard reload.
    refetchInterval: 5 * 60_000,
  });
}

// -----------------------------------------------------------------------------
// mutation hooks (GSL-268, GSL-314)
//
// GSL-314 (hotfix 2) — Idempotency-Key is now DERIVED from the mutation call, not minted
// fresh per invocation. QA run 04 minor#1: 5 rapid clicks on Allow generated 5 different
// UUIDs → 5 separate server intents → 4 wasted 409s + ledger pollution. With `stableKey`,
// the burst collapses to ONE key → server_intents replay returns the cached ok response
// for clicks 2..5 (see withTimeline.ts). A 2-second time bucket is baked in so a deliberate
// re-click after the window still gets a fresh intent.
//
// Key format: `web-<sessionNonce>-<action>-<inputHash>-<Math.round(Date.now()/2000)>`.
//   - sessionNonce: per-tab (crypto.randomUUID slice); prevents cross-tab collisions.
//   - action: hook name ("decide", "answer", "tick", …); keeps the ledger row greppable.
//   - inputHash: djb2 hex of stable-key-order JSON of the mutation input; deterministic.
//   - time bucket: 2 s ceiling on how long two identical calls collapse into one.
// The key is capped at 128 ASCII printable chars (withTimeline's resolveIntentId contract).
//
// Cache invalidation: on success we invalidate the primary query the action mutated. The
// SSE fan-out will land shortly (question.answered / question.resolved / ack event / tick
// ledger events, plus the new GSL-312 synthetic question.answered on permission decide) and
// re-invalidate more broadly through SseProvider — invalidating here too gives the owner
// immediate feedback without waiting for the SSE round-trip.
// -----------------------------------------------------------------------------

const SESSION_NONCE = (() => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().slice(0, 8);
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
})();

/** 2-second bucket keeps rapid-fire clicks collapsing while a deliberate re-click gets
 *  a fresh key. Exported for tests. */
export const IDEMPOTENCY_BUCKET_MS = 2000;

/** Stable JSON.stringify with sorted keys — same input yields the same hash regardless of
 *  property order at the call site. */
function stableSerialize(value: unknown): string {
  if (value === undefined) return "u";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableSerialize(v)}`).join(",")}}`;
}

/** djb2 — small, fast, deterministic, no crypto import required. Returns 8 hex chars. */
function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h * 33) ^ s.charCodeAt(i)) & 0xffffffff;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function stableIdempotencyKey(
  action: string,
  input: unknown,
  now: number = Date.now(),
): string {
  const bucket = Math.round(now / IDEMPOTENCY_BUCKET_MS);
  const hash = djb2Hex(stableSerialize(input));
  const raw = `web-${SESSION_NONCE}-${action}-${hash}-${bucket}`;
  // withTimeline.resolveIntentId trims + validates ASCII printable + ≤ 128 chars.
  return raw.length > 128 ? raw.slice(0, 128) : raw;
}

export function useAnswerQuestion(): UseMutationResult<
  AnswerActionResponse,
  Error,
  AnswerActionInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AnswerActionInput) =>
      coreClient.answerQuestion(input, stableIdempotencyKey("answer", input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["core", "questions"] });
      qc.invalidateQueries({ queryKey: queryKeys.bundle() });
    },
  });
}

export function useResolveQuestion(): UseMutationResult<
  ResolveActionResponse,
  Error,
  ResolveActionInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ResolveActionInput) =>
      coreClient.resolveQuestion(input, stableIdempotencyKey("resolve", input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["core", "questions"] });
      qc.invalidateQueries({ queryKey: queryKeys.bundle() });
    },
  });
}

export function useAckEvent(): UseMutationResult<AckActionResponse, Error, AckActionInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AckActionInput) =>
      coreClient.ackEvent(input, stableIdempotencyKey("ack", input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["core", "timeline"] });
    },
  });
}

export function useRunTick(): UseMutationResult<TickActionResponse, Error, TickActionInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TickActionInput) =>
      coreClient.runTick(input, stableIdempotencyKey("tick", input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.status() });
    },
  });
}

// GSL-277: apply a manifest rule as the answer. Provenance columns light up on the row.
export function useApplyManifest(): UseMutationResult<
  ApplyManifestActionResponse,
  Error,
  ApplyManifestActionInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ApplyManifestActionInput) =>
      coreClient.applyManifestToQuestion(
        input,
        stableIdempotencyKey("applyManifest", input),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["core", "questions"] });
      qc.invalidateQueries({ queryKey: queryKeys.bundle() });
    },
  });
}

// GSL-278: defer a question with (optional) auto-reopen timestamp.
export function useDeferQuestion(): UseMutationResult<
  DeferActionResponse,
  Error,
  DeferActionInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DeferActionInput) =>
      coreClient.deferQuestion(input, stableIdempotencyKey("defer", input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["core", "questions"] });
      qc.invalidateQueries({ queryKey: queryKeys.bundle() });
    },
  });
}

// GSL-279: force a Jira reconcile cycle (blocks until the cycle completes; usually <= 3 s).
export function useSyncTasks(): UseMutationResult<
  SyncTasksActionResponse,
  Error,
  SyncTasksActionInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SyncTasksActionInput) =>
      coreClient.syncTasks(input, stableIdempotencyKey("syncTasks", input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["core", "tasks"] });
      qc.invalidateQueries({ queryKey: queryKeys.bundle() });
    },
  });
}

// GSL-298: fire a manual DB snapshot. Success invalidates the status + timeline caches so
// the "Live pulse" tile on Overview shows the freshly-emitted `core.action.finished` line
// without waiting for the SSE round-trip.
export function useTakeSnapshot(): UseMutationResult<
  SnapshotActionResponse,
  Error,
  SnapshotActionInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SnapshotActionInput) =>
      coreClient.takeSnapshot(input, stableIdempotencyKey("snapshot", input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.status() });
      qc.invalidateQueries({ queryKey: ["core", "timeline"] });
    },
  });
}

// T5 (GSL-286 + GSL-266 partial): publish a single named skill via the web endpoint. The
// button on the Skills screen stays DISABLED with a tooltip pointing at the CLI while
// TouchID is paused (d-2026-08-09-001) — this hook exists so the wiring is in place for the
// moment the pause lifts (flipping one boolean on the button re-activates the flow).
export function usePublishSkill(): UseMutationResult<
  PublishSkillActionResponse,
  Error,
  PublishSkillActionInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PublishSkillActionInput) =>
      coreClient.publishSkill(input, stableIdempotencyKey("publishSkill", input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.skills() });
      qc.invalidateQueries({ queryKey: ["core", "skills", "diff"] });
      qc.invalidateQueries({ queryKey: ["core", "timeline"] });
    },
  });
}

// GSL-284: owner decides Allow/Deny on a permission-kind question row. The mutation
// invalidates the questions bucket so the row disappears from the open filter and shows
// with `answer_text='allow'|'deny'` under the answered filter within the next tick.
export function useDecidePermission(): UseMutationResult<
  DecidePermissionActionResponse,
  Error,
  DecidePermissionActionInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DecidePermissionActionInput) =>
      coreClient.decidePermission(input, stableIdempotencyKey("decide", input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["core", "questions"] });
      qc.invalidateQueries({ queryKey: queryKeys.bundle() });
    },
  });
}
