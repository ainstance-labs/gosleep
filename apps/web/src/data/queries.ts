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
  FleetResponse,
  ManifestResponse,
  QuestionsResponse,
  ResolveActionInput,
  ResolveActionResponse,
  SkillsResponse,
  StatusResponse,
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
// mutation hooks (GSL-268)
//
// Each hook mints a fresh Idempotency-Key per invocation via crypto.randomUUID(). A double
// click on the same button is protected at TWO layers: the button's `disabled={isPending}`
// prop below AND the server's persistent server_intents replay (see withTimeline.ts).
//
// Cache invalidation: on success we invalidate the primary query the action mutated. The
// SSE fan-out will land shortly (question.answered / question.resolved / ack event / tick
// ledger events) and re-invalidate more broadly through SseProvider — invalidating here too
// gives the owner immediate feedback without waiting for the SSE round-trip.
// -----------------------------------------------------------------------------

function newIdempotencyKey(): string {
  // crypto.randomUUID lands in every modern browser + Node/Bun. If a test harness stubs a
  // globalThis without crypto, fall back to timestamp+random — collisions are cosmetic (they
  // still de-dupe on the server if they happen to coincide).
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useAnswerQuestion(): UseMutationResult<
  AnswerActionResponse,
  Error,
  AnswerActionInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AnswerActionInput) =>
      coreClient.answerQuestion(input, newIdempotencyKey()),
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
      coreClient.resolveQuestion(input, newIdempotencyKey()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["core", "questions"] });
      qc.invalidateQueries({ queryKey: queryKeys.bundle() });
    },
  });
}

export function useAckEvent(): UseMutationResult<AckActionResponse, Error, AckActionInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AckActionInput) => coreClient.ackEvent(input, newIdempotencyKey()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["core", "timeline"] });
    },
  });
}

export function useRunTick(): UseMutationResult<TickActionResponse, Error, TickActionInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TickActionInput) => coreClient.runTick(input, newIdempotencyKey()),
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
      coreClient.applyManifestToQuestion(input, newIdempotencyKey()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["core", "questions"] });
      qc.invalidateQueries({ queryKey: queryKeys.bundle() });
    },
  });
}

