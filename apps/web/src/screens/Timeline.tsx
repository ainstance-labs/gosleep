// @gosleep/web — Timeline screen (GSL-265).
//
// The event stream: filterable by type + task. Each row shows time, type, actor, task,
// and a truncated JSON payload. Clicking a row toggles a full-payload disclosure.

import { useMemo, useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { PageHeader } from "../components/PageHeader";
import { QueryStatus } from "../components/QueryStatus";
import { useTimeline } from "../data/queries";
import { Badge } from "../components/ui/Badge";
import { shortJson, timeOfDay } from "../lib/format";
import { cn } from "../lib/cn";

export function TimelineScreen() {
  const [type, setType] = useState<string>("");
  const [task, setTask] = useState<string>("");
  const [limit, setLimit] = useState<number>(200);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const timeline = useTimeline(limit, type, task);

  const typeChoices = useMemo(() => {
    const set = new Set<string>();
    for (const e of timeline.data?.events ?? []) set.add(e.type);
    return Array.from(set).sort();
  }, [timeline.data]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Timeline"
        subtitle="Every event the tail indexer has landed. Newest first, live-updated by SSE."
      />

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs text-[var(--color-fg-secondary)]">
            Type
            <select
              className="surface rounded-md px-2 py-1.5 text-sm"
              value={type}
              onChange={(e) => setType(e.currentTarget.value)}
            >
              <option value="">(any)</option>
              {typeChoices.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--color-fg-secondary)]">
            Task
            <input
              type="text"
              placeholder="GSL-263"
              className="surface rounded-md px-2 py-1.5 text-sm"
              value={task}
              onChange={(e) => setTask(e.currentTarget.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--color-fg-secondary)]">
            Limit
            <select
              className="surface rounded-md px-2 py-1.5 text-sm"
              value={limit}
              onChange={(e) => setLimit(Number(e.currentTarget.value))}
            >
              {[50, 100, 200, 500, 1000].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Badge tone="neutral">{timeline.data?.count ?? "…"} rows</Badge>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="p-0">
          <QueryStatus
            isPending={timeline.isPending}
            error={timeline.error}
            data={timeline.data}
            isEmpty={(d) => d.events.length === 0}
            emptyMessage="No events match the current filters."
          >
            {(d) => (
              <ul className="divide-y divide-[var(--color-border-subtle)]">
                {d.events.map((e) => {
                  const isOpen = expanded.has(e.seq);
                  return (
                    <li key={e.seq} className="px-4 py-2 text-sm">
                      <button
                        type="button"
                        onClick={() => {
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(e.seq)) next.delete(e.seq);
                            else next.add(e.seq);
                            return next;
                          });
                        }}
                        className={cn(
                          "grid w-full grid-cols-[80px_140px_1fr_160px] items-center gap-3 text-left",
                          "rounded-md hover:bg-[color-mix(in_oklab,var(--color-sunken),transparent_35%)]",
                          "px-2 py-1",
                        )}
                      >
                        <span className="mono text-muted text-xs">{timeOfDay(e.ts)}</span>
                        <Badge tone="neutral" className="w-fit">{e.type}</Badge>
                        <span className="text-secondary truncate text-xs">
                          <span className="mono">{e.actor}</span>
                          {e.task !== null ? (
                            <>
                              {" · "}
                              <span className="mono text-[var(--color-accent)]">{e.task}</span>
                            </>
                          ) : null}
                          {" · "}
                          <span className="text-muted">{shortJson(e.payload)}</span>
                        </span>
                        <span className="text-muted text-right text-xs">
                          <span className="mono">{e.src}</span> · seq{" "}
                          <span className="mono">{e.seq}</span>
                        </span>
                      </button>
                      {isOpen ? (
                        <pre className="sunken mono text-muted mt-2 max-h-64 overflow-auto rounded-md p-3 text-xs">
                          {JSON.stringify(e, null, 2)}
                        </pre>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </QueryStatus>
        </CardBody>
      </Card>
    </div>
  );
}
