// @gosleep/web — TanStack Query hooks over CoreClient (GSL-265).
//
// One place to name every query key so the SSE provider can invalidate the right buckets
// on new events. Convention: `["core", "<endpoint>", …params]`.

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import type {
  BundleResponse,
  CostResponse,
  FleetResponse,
  QuestionsResponse,
  SkillsResponse,
  StatusResponse,
  TasksResponse,
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
