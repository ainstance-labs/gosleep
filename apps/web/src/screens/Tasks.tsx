// @gosleep/web — Tasks screen (GSL-265).
//
// Jira-cache projection grouped by epic. Uses `useTasks()` without filters; grouping runs in
// the client so a change in epic set does not force a refetch.

import { useMemo, useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { PageHeader } from "../components/PageHeader";
import { QueryStatus } from "../components/QueryStatus";
import { useTasks } from "../data/queries";
import { Badge } from "../components/ui/Badge";
import { TBody, TD, TH, THead, TR, Table } from "../components/ui/Table";
import { timeAgo } from "../lib/format";
import type { TaskRow } from "@gosleep/schema";

type Tone = "info" | "ok" | "warn" | "neutral" | "danger" | "accent";
const STATUS_TONE: Record<string, Tone> = {
  "To Do": "neutral",
  "In Progress": "info",
  "In Review": "warn",
  Done: "ok",
  Blocked: "danger",
};

export function TasksScreen() {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const t = useTasks(undefined, statusFilter.length > 0 ? statusFilter : undefined);

  const grouped = useMemo(() => {
    const map = new Map<string, TaskRow[]>();
    for (const row of t.data?.tasks ?? []) {
      const key = row.epic ?? "(no epic)";
      const bucket = map.get(key) ?? [];
      bucket.push(row);
      map.set(key, bucket);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [t.data]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tasks"
        subtitle="Cache of Jira issues, keyed on GSL-*. Live-refreshed by the Jira sync worker (GSL-279)."
        right={
          <select
            className="surface rounded-md px-2 py-1.5 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.currentTarget.value)}
          >
            <option value="">All statuses</option>
            <option value="To Do">To Do</option>
            <option value="In Progress">In Progress</option>
            <option value="In Review">In Review</option>
            <option value="Done">Done</option>
          </select>
        }
      />

      <QueryStatus
        isPending={t.isPending}
        error={t.error}
        data={t.data}
        isEmpty={(d) => d.tasks.length === 0}
        emptyMessage="No tasks cached yet. The Jira sync worker is scheduled for GSL-279."
      >
        {() => (
          <div className="space-y-4">
            {grouped.map(([epic, rows]) => (
              <Card key={epic}>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <CardTitle>{epic}</CardTitle>
                    <Badge tone="accent">{rows.length}</Badge>
                  </div>
                  <span className="text-muted text-xs">
                    {rows.filter((r) => r.status === "Done").length} done ·{" "}
                    {rows.filter((r) => r.status === "In Review").length} in review
                  </span>
                </CardHeader>
                <CardBody className="p-0">
                  <Table>
                    <THead>
                      <TR>
                        <TH className="w-24">Key</TH>
                        <TH>Title</TH>
                        <TH className="w-32">Status</TH>
                        <TH className="w-40">Synced</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {rows.map((row) => (
                        <TR key={row.key}>
                          <TD>
                            <span className="mono text-[var(--color-accent)]">
                              {row.key}
                            </span>
                          </TD>
                          <TD>{row.title}</TD>
                          <TD>
                            <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>
                              {row.status}
                            </Badge>
                          </TD>
                          <TD className="text-muted text-xs">
                            {row.last_synced_at !== null && row.last_synced_at !== undefined
                              ? timeAgo(row.last_synced_at)
                              : "never"}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </QueryStatus>
    </div>
  );
}
