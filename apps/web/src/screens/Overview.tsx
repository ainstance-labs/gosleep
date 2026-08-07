// @gosleep/web — Overview screen (GSL-265 read-only; GSL-268 "Run tick" button).
//
// Hero KPIs + live pulse + one interactive control:
//   - "Run tick" fires POST /actions/tick with `carrier: "web"`. Fire-and-forget on the server
//     (tick.sh spawns detached); the button surfaces the intent_id in a toast, and the tick's
//     own ledger + child events arrive shortly via SSE.

import { useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { PageHeader } from "../components/PageHeader";
import { QueryStatus } from "../components/QueryStatus";
import { Dialog } from "../components/ui/Dialog";
import { Button } from "../components/ui/Button";
import { useToast } from "../components/ui/Toast";
import { useRunTick, useStatus, useTimeline } from "../data/queries";
import { timeAgo, timeOfDay } from "../lib/format";
import { Badge } from "../components/ui/Badge";

function KpiTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardBody className="py-4">
        <div className="text-muted text-xs uppercase tracking-wide">{label}</div>
        <div className="mt-1 text-3xl font-semibold tabular-nums text-[var(--color-fg)]">
          {value}
        </div>
        {hint !== undefined ? <div className="text-muted mt-1 text-xs">{hint}</div> : null}
      </CardBody>
    </Card>
  );
}

export function OverviewScreen() {
  const status = useStatus();
  const timeline = useTimeline(12);
  const tickMut = useRunTick();
  const { push: pushToast } = useToast();
  const [confirmTick, setConfirmTick] = useState(false);

  const runTick = async (): Promise<void> => {
    try {
      const res = await tickMut.mutateAsync({ carrier: "web" });
      pushToast({
        title: "Tick spawned",
        description: `intent_id=${res.intent_id}${res.cached === true ? " (cached replay)" : ""}`,
        tone: "ok",
      });
      setConfirmTick(false);
    } catch (err) {
      pushToast({
        title: "Tick failed",
        description: err instanceof Error ? err.message : String(err),
        tone: "danger",
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        subtitle="Live snapshot of the gosleep control plane. Updates streamed via SSE."
        right={
          <Button
            variant="solid"
            size="sm"
            onClick={() => setConfirmTick(true)}
            disabled={tickMut.isPending}
          >
            {tickMut.isPending ? "Ticking…" : "Run tick"}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <QueryStatus
          isPending={status.isPending}
          error={status.error}
          data={status.data}
        >
          {(d) => (
            <>
              <KpiTile
                label="Events"
                value={String(d.counts.events)}
                hint={
                  d.last_ingest_at !== null
                    ? `last ingest ${timeAgo(d.last_ingest_at)}`
                    : "no ingest yet"
                }
              />
              <KpiTile label="Questions" value={String(d.counts.questions)} />
              <KpiTile label="Tasks" value={String(d.counts.tasks)} />
              <KpiTile label="Skills" value={String(d.counts.skills)} />
            </>
          )}
        </QueryStatus>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Live pulse</CardTitle>
          <span className="text-muted text-xs">last 12 events</span>
        </CardHeader>
        <CardBody className="p-0">
          <QueryStatus
            isPending={timeline.isPending}
            error={timeline.error}
            data={timeline.data}
            isEmpty={(d) => d.events.length === 0}
            emptyMessage="No events in the log yet."
          >
            {(d) => (
              <ul className="divide-y divide-[var(--color-border-subtle)]">
                {d.events.map((e) => (
                  <li
                    key={e.seq}
                    className="grid grid-cols-[80px_100px_1fr_120px] items-center gap-3 px-4 py-2 text-sm"
                  >
                    <span className="mono text-muted text-xs">{timeOfDay(e.ts)}</span>
                    <Badge tone="neutral" className="w-fit">{e.type}</Badge>
                    <div className="min-w-0 text-[var(--color-fg-secondary)]">
                      <span className="mono text-xs">
                        {e.actor}
                        {e.task !== null ? ` · ${e.task}` : ""}
                      </span>
                    </div>
                    <span className="text-muted text-right text-xs">
                      seq&nbsp;<span className="mono">{e.seq}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </QueryStatus>
        </CardBody>
      </Card>

      <Dialog
        open={confirmTick}
        onOpenChange={setConfirmTick}
        title="Run tick"
        description="Spawns tools/lab/tick.sh --force --carrier web. The tick runs poll-fill, apply-due, chronicler, and one ledger line."
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmTick(false)}
              disabled={tickMut.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="solid"
              size="sm"
              onClick={() => void runTick()}
              disabled={tickMut.isPending}
            >
              {tickMut.isPending ? "Ticking…" : "Confirm"}
            </Button>
          </>
        }
      >
        <p className="text-secondary text-sm">
          The tick returns immediately with an <code className="mono">intent_id</code>. Its
          ledger entry + child events arrive on the timeline via SSE within a few seconds.
        </p>
      </Dialog>
    </div>
  );
}
