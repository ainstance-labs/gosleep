// @gosleep/web — SSE provider (GSL-265, GSL-309).
//
// One persistent SSE subscription for the whole app. Every incoming event fans out to
// TanStack Query invalidations by type prefix:
//
//    question.*         → questions
//    task.* / tasks.*   → tasks
//    skill.*            → skills
//    cost.*             → cost
//    agent_sessions.* / agent.* → fleet
//    (any)              → timeline           (timeline is the event feed itself)
//
// GSL-309 — SSE-driven `invalidateQueries` calls are BATCHED through a 250 ms coalescing
// window. A burst of 20 events in one second collapses to ONE invalidation per unique key.
// Without the batch, a fleet-poll worker emitting `agent_sessions.updated` every 4 s (plus
// permission / question / task events piggy-backing on the same stream) exhausted Chrome's
// per-origin socket pool (ERR_INSUFFICIENT_RESOURCES ×5087 in the run-01 report). The
// pre-fix code also invalidated `status` + `bundle` on EVERY event: `status` already
// refetches on a 15 s timer (owner does not need sub-second freshness for row counts) and
// `bundle` has no active subscribers in the current screen graph, so both were pure waste.
//
// A `rotate` frame (UTC-day change) invalidates every core query and shows a toast
// telling the owner "the day rolled over". A `superseded` frame is treated like a normal
// event — the underlying query decides whether to hide it.
//
// The component also exposes `isConnected` for the top bar's status pill.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { subscribe, type SseEventData } from "@gosleep/sdk";

import { getBearer } from "./auth";
import { sseBaseUrl } from "./client";
import { queryKeys } from "./queries";
import { useToast } from "../components/ui/Toast";

// -----------------------------------------------------------------------------
// GSL-309 — coalescing invalidator
//
// Buffers query-key roots inside a 250 ms window, then invalidates each unique root once.
// The 250 ms window is small enough that the owner perceives updates as live but large
// enough to collapse the 4 s fleet-poll cadence plus incidental question/task events into
// a single refetch cycle.
// -----------------------------------------------------------------------------

const COALESCE_WINDOW_MS = 250;

function createInvalidator(qc: QueryClient): {
  schedule: (root: string) => void;
  flush: () => void;
  dispose: () => void;
} {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flushNow = (): void => {
    timer = null;
    if (pending.size === 0) return;
    const roots = Array.from(pending);
    pending.clear();
    for (const root of roots) {
      qc.invalidateQueries({ queryKey: ["core", root] });
    }
  };

  return {
    schedule(root: string): void {
      pending.add(root);
      if (timer === null) {
        timer = setTimeout(flushNow, COALESCE_WINDOW_MS);
      }
    },
    flush(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      flushNow();
    },
    dispose(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending.clear();
    },
  };
}

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
  // GSL-309 — hold a ref to the coalescing invalidator so re-renders do not rebuild it.
  const invalidatorRef = useRef<ReturnType<typeof createInvalidator> | null>(null);

  useEffect(() => {
    // React strict mode double-invokes effects (mount → cleanup → mount). We rely on the
    // returned dispose() closing the first stream cleanly and the second mount opening a
    // fresh one — no need for a "started" guard which, when combined with strict mode,
    // leaves the app permanently disconnected (first sub cleaned up, second call early-returned).
    const invalidator = createInvalidator(queryClient);
    invalidatorRef.current = invalidator;

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

          // GSL-309 — batched invalidations. Every event bumps `timeline` (the event feed
          // itself); type-specific keys go into the same 250 ms window. `status` + `bundle`
          // are NOT invalidated per-event (status has a 15 s refetchInterval; bundle has no
          // active subscribers) — that removed ~85% of the socket churn responsible for
          // ERR_INSUFFICIENT_RESOURCES ×5087 in the run-01 QA report.
          invalidator.schedule("timeline");

          const type = evt.type;
          if (type.startsWith("question.")) {
            invalidator.schedule("questions");
          } else if (type === "task.submitted" || type === "task.submit.failed") {
            // GSL-382 -- task-submission timeline events. Invalidate the per-session
            // submissions drawer AND the fleet card (control_state may have flipped as
            // the reason for the failed submission). Timeline itself is already
            // invalidated above -- these events are visible on the Timeline row.
            invalidator.schedule("submissions");
            invalidator.schedule("fleet");
          } else if (type.startsWith("task.") || type.startsWith("tasks.")) {
            invalidator.schedule("tasks");
          } else if (type.startsWith("skill.")) {
            invalidator.schedule("skills");
          } else if (type.startsWith("cost.")) {
            invalidator.schedule("cost");
          } else if (type.startsWith("agent_sessions.") || type.startsWith("agent.")) {
            // GSL-276: fleet-poll worker + PreToolUse shim both emit
            // `agent_sessions.updated` (via the events broadcaster). The Fleet screen re-fetches
            // /fleet so cards land within a tick of any status/tool/context change.
            invalidator.schedule("fleet");
          } else if (type.startsWith("sessions.control.")) {
            // GSL-361 (observer mode phase B) — take/release-control + heartbeat env-locked
            // synthetics land under this prefix. Invalidate every projection that carries
            // control state so the pill + button flip within one coalesce window.
            invalidator.schedule("fleet");
            invalidator.schedule("sessions");
            invalidator.schedule("observed");
          } else if (type === "sessions.submissions.updated") {
            // GSL-381 (observer mode phase C) — synthetic submissions frame the endpoint
            // fires after every confirm. Panel invalidates the history drawer query so
            // the row appears within the coalesce window.
            invalidator.schedule("submissions");
          }
        },
        onRotate: (data) => {
          // UTC day rolled over — every projection is now day-derived; blow the cache.
          // Flush the coalescer first so a queued invalidation cannot race the full sweep.
          invalidator.flush();
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
      invalidator.dispose();
      invalidatorRef.current = null;
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
