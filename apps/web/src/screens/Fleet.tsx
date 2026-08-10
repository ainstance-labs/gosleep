// @gosleep/web — Fleet screen (GSL-276 / rev-3 addendum Delta 8.1).
//
// One card per live Claude Code session. Owner requirement R4: "how many agents are running,
// what each is doing, what its context %". Reads via `useFleet()` (TanStack Query over
// GET /fleet); SseProvider invalidates the query on `agent_sessions.updated` SSE frames so
// the cards update within ~1 s of a hook shim POST or a fleet-poll tick.
//
// Sort: matches the server's default order (live first, then most-recently-updated). Ended
// rows fade to the bottom with a muted style so the owner can still see who wrapped up in
// the last hour without a filter dance.

import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { PageHeader } from "../components/PageHeader";
import { QueryStatus } from "../components/QueryStatus";
import { Badge } from "../components/ui/Badge";
import { useFleet } from "../data/queries";
import { formatModelLabel, timeAgo } from "../lib/format";
import { cn } from "../lib/cn";

type StatusTone = "info" | "ok" | "warn" | "neutral" | "danger" | "accent";
const STATUS_TONE: Record<string, StatusTone> = {
  busy: "ok",
  idle: "info",
  waiting: "warn",
  ended: "neutral",
  observed: "info",
  unknown: "neutral",
};

function ContextBar({ pct }: { pct: number | null | undefined }) {
  const value = typeof pct === "number" ? Math.max(0, Math.min(100, pct)) : null;
  // Colour the bar red past 80 %, amber past 60 %, otherwise the accent — matches the way the
  // owner reads the scalar heartbeat context on the current dashboard.
  const tone =
    value === null
      ? "neutral"
      : value >= 80
        ? "danger"
        : value >= 60
          ? "warn"
          : "accent";
  const fill =
    tone === "danger"
      ? "var(--color-danger)"
      : tone === "warn"
        ? "var(--color-warn, #d97706)"
        : "var(--color-accent)";
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-border-subtle)]">
        {value !== null ? (
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${value}%`, background: fill }}
          />
        ) : null}
      </div>
      <span
        className={cn(
          "mono tabular-nums text-xs",
          value === null ? "text-muted" : "text-[var(--color-fg-secondary)]",
        )}
      >
        {value === null ? "—" : `${value}%`}
      </span>
    </div>
  );
}

function shortSessionId(id: string): string {
  // UUIDs are long; the first 8 chars are unique enough to disambiguate at a glance while
  // keeping the card compact. The tooltip on hover exposes the full string.
  return id.slice(0, 8);
}

export function FleetScreen() {
  const fleet = useFleet();
  const totals = fleet.data?.totals;

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-6">
      <PageHeader
        title="Fleet"
        subtitle="Live Claude Code sessions on this host — per-agent status, context, and current tool."
        right={
          totals !== undefined ? (
            <>
              <Badge tone="info">{totals.agents_live} live</Badge>
              <Badge tone="ok">{totals.agents_busy} busy</Badge>
              <Badge tone="neutral">{totals.agents_total - totals.agents_live} ended</Badge>
            </>
          ) : null
        }
      />

      <QueryStatus
        isPending={fleet.isPending}
        error={fleet.error}
        data={fleet.data}
        isEmpty={(d) => d.sessions.length === 0}
        emptyMessage="No agents observed. The fleet-poll worker polls `claude agents --json` every 4 seconds — a live session should surface within a tick."
      >
        {(data) => (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.sessions.map((s) => {
              const isEnded = s.ended_at !== null && s.ended_at !== undefined;
              const tone = STATUS_TONE[s.status] ?? "neutral";
              return (
                <Card
                  key={s.session_id}
                  className={cn(isEnded ? "opacity-60" : undefined)}
                >
                  <CardHeader>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <CardTitle className="truncate text-base font-medium">
                          {s.name}
                        </CardTitle>
                        <Badge tone={tone}>{s.status}</Badge>
                        {s.kind !== "interactive" ? (
                          <Badge tone="neutral">{s.kind}</Badge>
                        ) : null}
                      </div>
                      <div className="text-muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                        <span className="mono" title={s.session_id}>
                          {shortSessionId(s.session_id)}
                        </span>
                        {s.pid !== null && s.pid !== undefined ? (
                          <span className="mono">pid {s.pid}</span>
                        ) : null}
                        {/* GSL-290 (settings hierarchy) + GSL-321 (transcript-first per
                            session). Renders an explicit "unknown" pill when neither source
                            produced a value; a wrong-but-confident value would be worse
                            (run 06 finding #3: a `--model haiku` session showed the global
                            `fable-5` because the transcript reader did not exist).
                            GSL-327: raw ids like `claude-fable-5` render as the friendly
                            marketing label; sentinels `unknown` / `starting` pass through;
                            the raw id stays available on hover via `title`. */}
                        <span
                          className="mono"
                          title={
                            s.model === null || s.model === undefined
                              ? "no assistant turn in the transcript yet, and no `model` in <cwd>/.claude/settings*.json or ~/.claude/settings.json"
                              : `raw model id: ${s.model} — read from the session transcript (falls back to Claude Code settings hierarchy)`
                          }
                        >
                          {s.model !== null && s.model !== undefined
                            ? formatModelLabel(s.model)
                            : "model unknown"}
                        </span>
                        {s.cycle !== null && s.cycle !== undefined ? (
                          <span>cycle {s.cycle}</span>
                        ) : null}
                      </div>
                    </div>
                  </CardHeader>
                  <CardBody className="space-y-3">
                    <div>
                      <div className="text-muted mb-1 text-xs uppercase tracking-wide">
                        Context
                      </div>
                      <ContextBar pct={s.context_pct} />
                    </div>
                    <div>
                      <div className="text-muted mb-0.5 text-xs uppercase tracking-wide">
                        Current tool
                      </div>
                      <div className="text-sm text-[var(--color-fg)]">
                        {s.current_tool ?? (
                          // GSL-290 — honest "unknown" state. The tool-observed shim
                          // (PreToolUse{tool-observed}, see runbook § 8) is the source;
                          // sessions started without it emit no observations. Tooltip
                          // names the mechanism so an operator knows what to install.
                          <span
                            className="text-muted"
                            title="no tool-observed observation yet — install the PreToolUse{tool-observed} shim to populate"
                          >
                            unknown
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted mb-0.5 text-xs uppercase tracking-wide">
                        Intent
                      </div>
                      <div className="text-sm text-[var(--color-fg-secondary)]">
                        {s.current_intent !== null && s.current_intent !== undefined ? (
                          s.current_intent
                        ) : (
                          <span
                            className="text-muted"
                            title="no intent observed yet — the tool-observed shim populates this when the agent supplies one"
                          >
                            unknown
                          </span>
                        )}
                      </div>
                    </div>
                    {/* GSL-319 — per-session PR chip. Populated by the extractor in
                        /internal/agents/tool-observed as soon as `gh pr create`
                        (or a later `gh pr view <URL>`) fires. Hidden when the session has
                        not touched a PR yet. */}
                    {s.last_pr_url !== null && s.last_pr_url !== undefined ? (
                      <div>
                        <div className="text-muted mb-0.5 text-xs uppercase tracking-wide">
                          Latest PR
                        </div>
                        <a
                          href={s.last_pr_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mono block break-all text-sm text-[var(--color-accent)] hover:underline"
                          data-testid="fleet-pr-link"
                          title={
                            s.last_pr_at !== null && s.last_pr_at !== undefined
                              ? `observed ${timeAgo(s.last_pr_at)}`
                              : "observed just now"
                          }
                        >
                          {s.last_pr_url}
                        </a>
                      </div>
                    ) : null}
                    <div className="text-muted flex items-center justify-between text-xs">
                      <span title={s.cwd}>
                        {s.cwd.split("/").slice(-2).join("/")}
                      </span>
                      <span className="mono">
                        {isEnded
                          ? `ended ${timeAgo(s.ended_at as string)}`
                          : `updated ${timeAgo(s.updated_at)}`}
                      </span>
                    </div>
                  </CardBody>
                </Card>
              );
            })}
          </div>
        )}
      </QueryStatus>
    </div>
  );
}
