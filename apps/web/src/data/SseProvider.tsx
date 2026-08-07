// @gosleep/web — SSE provider (GSL-265).
//
// One persistent SSE subscription for the whole app. Every incoming event fans out to
// TanStack Query invalidations by type prefix:
//
//    question.*  → questions + bundle
//    task.*      → tasks + bundle
//    tasks.*     → tasks + bundle          (Delta 9 name)
//    skill.*     → skills + bundle
//    cost.*      → cost + bundle
//    (any)       → timeline + status + bundle       (always — timeline lists everything)
//
// A `rotate` frame (UTC-day change) invalidates every core query and shows a toast
// telling the owner "the day rolled over". A `superseded` frame is treated like a normal
// event — the underlying query decides whether to hide it.
//
// The component also exposes `isConnected` for the top bar's status pill.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { subscribe, type SseEventData } from "@gosleep/sdk";

import { getBearer } from "./auth";
import { sseBaseUrl } from "./client";
import { queryKeys } from "./queries";
import { useToast } from "../components/ui/Toast";

interface SseCtx {
  isConnected: boolean;
  lastEvent: SseEventData | null;
  events: SseEventData[]; // rolling ring buffer, newest last (cap 200)
}

const Ctx = createContext<SseCtx>({
  isConnected: false,
  lastEvent: null,
  events: [],
});

export function SseProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { push: pushToast } = useToast();
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SseEventData | null>(null);
  const [events, setEvents] = useState<SseEventData[]>([]);

  useEffect(() => {
    // React strict mode double-invokes effects (mount → cleanup → mount). We rely on the
    // returned dispose() closing the first stream cleanly and the second mount opening a
    // fresh one — no need for a "started" guard which, when combined with strict mode,
    // leaves the app permanently disconnected (first sub cleaned up, second call early-returned).
    const dispose = subscribe(
      {
        onOpen: () => setIsConnected(true),
        onError: () => setIsConnected(false),
        onEvent: (evt) => {
          setLastEvent(evt);
          setEvents((prev) => {
            const next = [...prev, evt];
            return next.length > 200 ? next.slice(next.length - 200) : next;
          });

          // Always keep timeline + status + bundle fresh — every event affects them.
          queryClient.invalidateQueries({ queryKey: ["core", "timeline"] });
          queryClient.invalidateQueries({ queryKey: queryKeys.status() });
          queryClient.invalidateQueries({ queryKey: queryKeys.bundle() });

          const type = evt.type;
          if (type.startsWith("question.")) {
            queryClient.invalidateQueries({ queryKey: ["core", "questions"] });
          } else if (type.startsWith("task.") || type.startsWith("tasks.")) {
            queryClient.invalidateQueries({ queryKey: ["core", "tasks"] });
          } else if (type.startsWith("skill.")) {
            queryClient.invalidateQueries({ queryKey: queryKeys.skills() });
          } else if (type.startsWith("cost.")) {
            queryClient.invalidateQueries({ queryKey: ["core", "cost"] });
          }
        },
        onRotate: (data) => {
          // UTC day rolled over — every projection is now day-derived; blow the cache.
          queryClient.invalidateQueries({ queryKey: ["core"] });
          pushToast({
            title: "Day rolled over",
            description: `UTC day is now ${data.new_day}.`,
            tone: "info",
          });
        },
      },
      { getBearer, baseUrl: sseBaseUrl },
    );
    return () => {
      dispose();
    };
  }, [queryClient, pushToast]);

  const value = useMemo<SseCtx>(
    () => ({ isConnected, lastEvent, events }),
    [isConnected, lastEvent, events],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSse(): SseCtx {
  return useContext(Ctx);
}
