// @gosleep/web — Overview screen (GSL-265 read-only; GSL-268 "Run tick" button; GSL-298
// "Snapshot" button).
//
// Hero KPIs + live pulse + two interactive controls:
//   - "Run tick" fires POST /actions/tick with `carrier: "web"`. Fire-and-forget on the server
//     (tick.sh spawns detached); the button surfaces the intent_id in a toast, and the tick's
//     own ledger + child events arrive shortly via SSE.
//   - "Snapshot" fires POST /actions/snapshot with a `label` (owner-web is the default label,
//     so the file lands under `data/snapshots/manual-owner-web-<ts>.db` and is retained
//     indefinitely per snapshot.sh's manual-retention rule). Response body carries the path;
//     the toast description surfaces it so the operator can `open $(dirname …)` if they want.

import { useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { PageHeader } from "../components/PageHeader";
import { QueryStatus } from "../components/QueryStatus";
import { Dialog } from "../components/ui/Dialog";
import { Button } from "../components/ui/Button";
import { useToast } from "../components/ui/Toast";
import {
  useFleet,
  useRunTick,
  useStatus,
  useTakeSnapshot,
  useTimeline,
} from "../data/queries";
import { timeAgo, timeOfDay } from "../lib/format";
import { Badge } from "../components/ui/Badge";
import type { RunwayResult } from "@gosleep/schema";

function KpiTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardBody className="py-4">
        <div className="text-muted text-xs uppercase tracking-wide">{label}</div>
        <div className="mt-1 text-3xl font-medium tabular-nums text-[var(--color-fg)]">
          {value}
        </div>
        {hint !== undefined ? <div className="text-muted mt-1 text-xs">{hint}</div> : null}
      </CardBody>
    </Card>
  );
}

/**
 * Format the composite runway value. `null` renders as "—" (the honest "no data" state);
 * huge values (agents freshly booted) render as "> 24h" so the tile doesn't shout a
 * number the underlying extrapolation cannot support.
 */
function formatRunway(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 0) return "0h";
  if (hours >= 24) return "> 24h";
  if (hours >= 1) return `${hours.toFixed(1)}h`;
  const mins = Math.max(0, Math.round(hours * 60));
  return `${mins}m`;
}

/**
 * The Overview's first tile per PRD Phase 7 F7-S1 (GSL-289). Renders the composite runway,
 * the binding constraint's name + one-line per-clock read-out, and a muted "as of" ts.
 */
function RunwayTile({ runway }: { runway: RunwayResult | undefined }) {
  if (runway === undefined) {
    return (
      <Card className="md:col-span-2">
        <CardBody className="py-4">
          <div className="text-muted text-xs uppercase tracking-wide">Runway</div>
          <div className="mt-1 text-3xl font-medium tabular-nums text-[var(--color-fg)]">—</div>
          <div className="text-muted mt-1 text-xs">no data — server did not report runway</div>
        </CardBody>
      </Card>
    );
  }
  const bindingLabel =
    runway.binding === null ? "no binding constraint" : `binding: ${runway.binding}`;
  const clockLines = [
    runway.clocks.context.readout,
    runway.clocks.blockers.readout,
    runway.clocks.slots.readout,
  ].join(" · ");
  return (
    <Card className="md:col-span-2">
      <CardBody className="py-4">
        <div className="flex items-baseline justify-between">
          <div className="text-muted text-xs uppercase tracking-wide">Runway</div>
          <Badge tone={runway.hours_left === 0 ? "danger" : runway.hours_left === null ? "neutral" : "info"}>
            {bindingLabel}
          </Badge>
        </div>
        <div className="mt-1 text-3xl font-medium tabular-nums text-[var(--color-fg)]">
          {formatRunway(runway.hours_left)}
        </div>
        <div className="text-muted mt-2 mono text-xs">{clockLines}</div>
      </CardBody>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// GSL-319 — "Latest PR" surface. Run 06 finding #2: after `gh pr create` opened PR #3, no
// panel screen surfaced the URL. The panel's whole value proposition is "here is what your
// agent shipped" — and the shipped PR was invisible. This tile scans the live fleet for the
// newest `last_pr_url` and renders it as a clickable link so the reader can jump straight
// into the PR review.
// -----------------------------------------------------------------------------

interface PrObservation {
  url: string;
  session_name: string;
  observed_at: string | null;
}

/** Pick the freshest `last_pr_url` across all sessions (live or ended). Null when nothing
 *  has been observed yet — the Overview simply hides the tile in that state. */
export function pickLatestPr(
  sessions: Array<{
    name: string;
    last_pr_url?: string | null;
    last_pr_at?: string | null;
  }>,
): PrObservation | null {
  let best: PrObservation | null = null;
  for (const s of sessions) {
    const url = s.last_pr_url;
    if (typeof url !== "string" || url.length === 0) continue;
    const at = typeof s.last_pr_at === "string" ? s.last_pr_at : null;
    if (best === null) {
      best = { url, session_name: s.name, observed_at: at };
      continue;
    }
    const bestAt = best.observed_at ?? "";
    if ((at ?? "") > bestAt) {
      best = { url, session_name: s.name, observed_at: at };
    }
  }
  return best;
}

function LatestPrCard({ pr }: { pr: PrObservation | null }) {
  // GSL-328 — empty-state variant. Live-fire run 08 flagged that the tile
  // vanished entirely on a pristine Overview (no session had emitted
  // `last_pr_url` yet), so the operator could not tell if the surface was
  // missing or just quiet. Now the card is always present; when there is no
  // observation, the body renders a muted "No pull requests yet" line
  // consistent with the other Overview tiles (Runway / KPI) that keep their
  // frame when empty.
  if (pr === null) {
    return (
      <Card data-testid="latest-pr-card-empty">
        <CardHeader>
          <CardTitle>Latest PR</CardTitle>
          <span className="text-muted text-xs">no PRs observed yet</span>
        </CardHeader>
        <CardBody>
          <p className="text-muted text-sm">
            No pull requests yet. The card populates as soon as a fleet
            session runs <code className="mono">gh pr create</code> (or
            <code className="mono"> gh pr view &lt;url&gt;</code>).
          </p>
        </CardBody>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Latest PR</CardTitle>
        <span className="text-muted text-xs">
          {pr.observed_at !== null ? `observed ${timeAgo(pr.observed_at)}` : "just now"}
        </span>
      </CardHeader>
      <CardBody className="space-y-2">
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mono block break-all text-sm text-[var(--color-accent)] hover:underline"
          data-testid="latest-pr-link"
        >
          {pr.url}
        </a>
        <p className="text-muted text-xs">
          opened by <code className="mono">{pr.session_name}</code>
        </p>
      </CardBody>
    </Card>
  );
}

export function OverviewScreen() {
  const status = useStatus();
  const timeline = useTimeline(12);
  const fleet = useFleet();
  const tickMut = useRunTick();
  const snapshotMut = useTakeSnapshot();
  const { push: pushToast } = useToast();
  const [confirmTick, setConfirmTick] = useState(false);
  const [confirmSnapshot, setConfirmSnapshot] = useState(false);

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

  const takeSnapshot = async (): Promise<void> => {
    try {
      // GSL-298 — always tag owner-clicked snapshots as `manual` so retention is indefinite
      // (the launchd cron owns the `daily` slot with its own 30-day prune).
      const res = await snapshotMut.mutateAsync({ label: "owner-web" });
      const path = res.result?.path ?? "(path unavailable)";
      const cached = res.cached === true ? " (cached replay)" : "";
      pushToast({
        title: "Snapshot written",
        description: `${path}${cached}`,
        tone: "ok",
      });
      setConfirmSnapshot(false);
    } catch (err) {
      pushToast({
        title: "Snapshot failed",
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
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmSnapshot(true)}
              disabled={snapshotMut.isPending}
            >
              {snapshotMut.isPending ? "Snapshotting…" : "Snapshot"}
            </Button>
            <Button
              variant="solid"
              size="sm"
              onClick={() => setConfirmTick(true)}
              disabled={tickMut.isPending}
            >
              {tickMut.isPending ? "Ticking…" : "Run tick"}
            </Button>
          </div>
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
              {/* GSL-289 — first tile is the composite runway per PRD F7-S1. It spans two
                  cells so the readout line has room for all three clock read-outs. */}
              <RunwayTile runway={d.runway} />
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

      {/* GSL-319 — the "Latest PR" surface. GSL-328 (run 08 minor): always render
          the card so the surface is discoverable; `LatestPrCard` swaps to an
          empty-state variant when `pickLatestPr()` returns null. */}
      {(() => {
        const pr =
          fleet.data !== undefined ? pickLatestPr(fleet.data.sessions) : null;
        return <LatestPrCard pr={pr} />;
      })()}

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

      <Dialog
        open={confirmSnapshot}
        onOpenChange={setConfirmSnapshot}
        title="Take a snapshot"
        description="Runs apps/core/scripts/snapshot.sh (sqlite3 .backup, WAL-friendly and atomic) and writes a manual-labelled copy under data/snapshots/. Retained indefinitely."
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmSnapshot(false)}
              disabled={snapshotMut.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="solid"
              size="sm"
              onClick={() => void takeSnapshot()}
              disabled={snapshotMut.isPending}
            >
              {snapshotMut.isPending ? "Snapshotting…" : "Confirm"}
            </Button>
          </>
        }
      >
        <p className="text-secondary text-sm">
          The snapshot returns synchronously (usually under a second). The response body
          carries the file path — it is surfaced in the success toast so you can locate
          the file with <code className="mono">open $(dirname …)</code>.
        </p>
      </Dialog>
    </div>
  );
}
