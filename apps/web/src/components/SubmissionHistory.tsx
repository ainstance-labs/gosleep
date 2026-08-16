// @gosleep/web — Per-session submission-history drawer (GSL-383, observer mode phase C).
//
// Shown INSIDE the Fleet / Observed card when the owner presses "History" — a compact
// list of the last N task submissions with outcome + timestamp + sha16 + bytes. Body
// itself never appears here (R16.6 keeps the body in the timeline event payload; the
// row-level UI surfaces the hash + length only).
//
// Refetches via TanStack Query invalidation on the SSE `sessions.submissions.updated` /
// `task.submitted` / `task.submit.failed` frames -- so a delivered submission from
// another tab or the same tab appears within the coalesce window (250 ms).

import type { SubmissionOutcome, TaskSubmissionRow } from "@gosleep/schema";
import { Badge } from "./ui/Badge";
import { QueryStatus } from "./QueryStatus";
import { useSubmissions } from "../data/queries";
import { timeAgo } from "../lib/format";

type BadgeTone = "neutral" | "info" | "ok" | "warn" | "danger" | "accent";

function toneForOutcome(outcome: string): BadgeTone {
  switch (outcome as SubmissionOutcome) {
    case "delivered":
      return "ok";
    case "pane_gone":
    case "released_mid_submit":
    case "not_at_prompt":
      return "warn";
    case "send_failed":
      return "danger";
    default:
      return "neutral";
  }
}

export interface SubmissionHistoryProps {
  sessionId: string;
  limit?: number;
}

export function SubmissionHistory({ sessionId, limit = 25 }: SubmissionHistoryProps) {
  const q = useSubmissions(sessionId, limit);
  return (
    <QueryStatus
      isPending={q.isPending}
      error={q.error}
      data={q.data}
      isEmpty={(d) => d.submissions.length === 0}
      emptyMessage="No submissions for this session yet."
    >
      {(data) => (
        <div className="space-y-1 text-[11px]" data-testid="submission-history">
          {data.submissions.length === 0 ? (
            <p className="text-muted">No submissions for this session yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border-subtle)]">
              {data.submissions.map((row: TaskSubmissionRow) => (
                <li
                  key={row.id}
                  className="grid grid-cols-[80px_130px_1fr_90px] items-center gap-2 py-1.5"
                >
                  <span className="text-muted mono">{timeAgo(row.ts)}</span>
                  <Badge tone={toneForOutcome(row.outcome)} className="w-fit">
                    {row.outcome}
                  </Badge>
                  <span className="text-secondary truncate">
                    <span className="mono">
                      {row.body_len.toLocaleString()} b · {row.framing}
                    </span>
                    {row.pane_ref_at_dispatch !== null ? (
                      <>
                        {" · "}
                        <span className="mono">{row.pane_ref_at_dispatch}</span>
                      </>
                    ) : null}
                    {row.error !== null ? (
                      <>
                        {" · "}
                        <span className="text-[var(--color-danger)]" title={row.error}>
                          {row.error.slice(0, 60)}
                          {row.error.length > 60 ? "…" : ""}
                        </span>
                      </>
                    ) : null}
                  </span>
                  <span
                    className="text-muted mono text-right text-[10px]"
                    title={row.body_sha256}
                  >
                    {row.body_sha256.slice(0, 10)}…
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </QueryStatus>
  );
}
