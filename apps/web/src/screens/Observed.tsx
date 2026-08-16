// @gosleep/web — Observed screen (GSL-357 under GSL-350 phase 14).
//
// The observer-mode surface. Renders three regions:
//   1. Left rail: project list (colour swatch + session count + last-activity + hidden badge).
//   2. Main: session-card grid — one card per machine-wide Claude session, `observed_only`
//      cards muted with a "observer only — no control" badge, `work_topic_inferred`
//      surfaced with a clear "inferred" tag (owner decision 2026-08-16 depth = facts +
//      work-topic).
//   3. Right rail: collector inventory — name, source, cadence, last-tick, events-today,
//      write_attempts (red if > 0 — R14.1 empirical proof).
//
// Read strategy: TanStack Query hooks (useObservedSessions / …), 5-second refetch. A future
// task can wire the `observed.events` SSE topic for instant invalidation; the 5 s poll keeps
// the panel usable in the meantime.

import { useState } from "react";

import { Badge } from "../components/ui/Badge";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { ControlToggle } from "../components/ControlToggle";
import { PageHeader } from "../components/PageHeader";
import { QueryStatus } from "../components/QueryStatus";
import {
  useObservedCollectors,
  useObservedProjects,
  useObservedSessions,
  useObservedTmux,
} from "../data/queries";
import { cn } from "../lib/cn";
import { formatModelLabel, timeAgo } from "../lib/format";
import type { ObservedSessionRow } from "@gosleep/schema";

function ProjectRail({ selected, onSelect }: {
  selected: string | null;
  onSelect: (slug: string | null) => void;
}) {
  const projects = useObservedProjects();

  return (
    <aside className="w-full md:w-56 md:flex-shrink-0">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="text-muted text-xs font-medium uppercase tracking-wider">
          Projects
        </div>
        {projects.data ? (
          <Badge tone="neutral">{projects.data.count}</Badge>
        ) : null}
      </div>
      <QueryStatus
        isPending={projects.isPending}
        error={projects.error}
        data={projects.data}
        isEmpty={(d) => d.projects.length === 0}
        emptyMessage="No projects observed."
      >
        {(data) => (
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => onSelect(null)}
              className={cn(
                "w-full rounded-md px-2 py-1.5 text-left text-sm",
                selected === null
                  ? "bg-[var(--color-accent-subtle,rgba(59,130,246,0.12))] text-[var(--color-fg)]"
                  : "text-[var(--color-fg-secondary)] hover:bg-[var(--color-border-subtle)]",
              )}
            >
              All projects
            </button>
            {data.projects.map((p) => {
              const isActive = selected === p.project_slug;
              return (
                <button
                  key={p.project_slug}
                  type="button"
                  onClick={() => onSelect(p.project_slug)}
                  title={p.hidden ? `${p.display_name} (hidden: ${p.project_slug})` : p.cwd_project_root ?? p.project_slug}
                  className={cn(
                    "w-full rounded-md px-2 py-1.5 text-left text-sm",
                    isActive
                      ? "bg-[var(--color-accent-subtle,rgba(59,130,246,0.12))] text-[var(--color-fg)]"
                      : "text-[var(--color-fg-secondary)] hover:bg-[var(--color-border-subtle)]",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{ background: p.colour_hsl }}
                      />
                      <span className="truncate">{p.display_name}</span>
                      {p.hidden ? (
                        <Badge tone="neutral">hidden</Badge>
                      ) : null}
                    </div>
                    <span className="text-muted mono flex-shrink-0 text-xs">
                      {p.session_count}
                    </span>
                  </div>
                  <div className="text-muted mt-0.5 text-xs">
                    {p.last_activity !== null ? timeAgo(p.last_activity) : "—"}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </QueryStatus>
    </aside>
  );
}

function CollectorRail() {
  const collectors = useObservedCollectors();
  return (
    <aside className="w-full md:w-64 md:flex-shrink-0">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="text-muted text-xs font-medium uppercase tracking-wider">
          Collectors
        </div>
        {collectors.data ? (
          <Badge
            tone={collectors.data.write_attempts_total > 0 ? "danger" : "ok"}
          >
            writes {collectors.data.write_attempts_total}
          </Badge>
        ) : null}
      </div>
      <QueryStatus
        isPending={collectors.isPending}
        error={collectors.error}
        data={collectors.data}
        isEmpty={(d) => d.collectors.length === 0}
        emptyMessage="No collectors registered yet."
      >
        {(data) => (
          <div className="space-y-2">
            {data.collectors.map((c) => (
              <Card key={c.name} className={c.disabled ? "opacity-70" : undefined}>
                <CardBody className="space-y-1 py-2">
                  <div className="flex items-center justify-between">
                    <span className="mono text-sm">{c.name}</span>
                    <Badge tone={c.disabled ? "danger" : "info"}>
                      {c.source}
                    </Badge>
                  </div>
                  <div className="text-muted flex items-center justify-between text-xs">
                    <span>every {Math.round(c.cadence_ms / 1000)}s</span>
                    <span className="mono">
                      events {c.events_today}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted">
                      {c.last_tick_at !== null
                        ? `last ${timeAgo(c.last_tick_at)}`
                        : "no tick yet"}
                    </span>
                    <span
                      className={cn(
                        "mono",
                        c.write_attempts > 0
                          ? "text-[var(--color-danger)]"
                          : "text-muted",
                      )}
                      title="R14.1 — every write attempt outside the collector's whitelist is counted. Must stay at 0."
                    >
                      writes {c.write_attempts}
                    </span>
                  </div>
                  {c.last_error !== null ? (
                    <div
                      className="mono text-xs text-[var(--color-danger)]"
                      title={c.last_error}
                    >
                      {c.last_error.slice(0, 80)}
                      {c.last_error.length > 80 ? "…" : ""}
                    </div>
                  ) : null}
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </QueryStatus>
    </aside>
  );
}

export function ObservedScreen() {
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const sessions = useObservedSessions();
  const tmux = useObservedTmux();

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <PageHeader
        title="Observed"
        subtitle="Machine-wide passive observability: every tmux pane and every Claude session on the host, correlated by project. Read-only (R14.1)."
        right={
          <>
            {sessions.data ? (
              <Badge tone="info">{sessions.data.count} sessions</Badge>
            ) : null}
            {tmux.data ? (
              <Badge tone="neutral">{tmux.data.count} panes</Badge>
            ) : null}
          </>
        }
      />

      <div className="flex flex-col gap-6 md:flex-row">
        <ProjectRail selected={selectedProject} onSelect={setSelectedProject} />

        <main className="min-w-0 flex-1">
          <QueryStatus
            isPending={sessions.isPending}
            error={sessions.error}
            data={sessions.data}
            isEmpty={(d) => d.sessions.length === 0}
            emptyMessage="No Claude sessions detected on this host. tmux panes without a Claude process are also listed for context — check the Collectors panel to confirm the tmux map collector is ticking."
          >
            {(data) => {
              const filtered = selectedProject !== null
                ? data.sessions.filter((s) => s.project_slug === selectedProject)
                : data.sessions;
              if (filtered.length === 0) {
                return (
                  <div className="text-muted text-sm">
                    No sessions in project <span className="mono">{selectedProject}</span>.
                  </div>
                );
              }
              return (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
                  {filtered.map((s: ObservedSessionRow) => {
                    // GSL-396 (E2E run-02 M-1) — read the server-provided tmux_pane_ref
                    // directly. The pre-fix client-side `.find(p =>
                    // p.pane_current_path.startsWith(s.cwd_project_root))` glued a repo-root
                    // session to any deeper pane (fixture worktree, etc.). Attribution now
                    // lives in one place — apps/core/src/routes/paneRanking.ts — shared with
                    // /fleet so the two surfaces cannot disagree.
                    const tmuxPaneRef = s.tmux_pane_ref ?? null;
                    return (
                      <Card
                        key={s.session_id}
                        className={cn(s.observed_only ? "opacity-90" : undefined)}
                      >
                        <CardHeader>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <CardTitle className="truncate text-base font-medium">
                                {s.name}
                              </CardTitle>
                              <Badge
                                tone={
                                  s.status === "active"
                                    ? "ok"
                                    : s.status === "idle"
                                      ? "info"
                                      : "neutral"
                                }
                              >
                                {s.status}
                              </Badge>
                              {s.observed_only ? (
                                <Badge
                                  tone="warn"
                                  title="This session has no gosleep hook wired in its project — the panel can observe but cannot answer / decide / defer on it. Phase 15 will add runtime Take-control."
                                >
                                  observer only — no control
                                </Badge>
                              ) : null}
                            </div>
                            <div className="text-muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                              <span className="mono" title={s.session_id}>
                                {s.session_id.slice(0, 8)}
                              </span>
                              {s.project_slug !== null ? (
                                <span
                                  className="mono"
                                  title={s.cwd_project_root ?? undefined}
                                >
                                  {s.project_slug}
                                </span>
                              ) : null}
                              {s.model !== null ? (
                                <span className="mono">
                                  {formatModelLabel(s.model)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </CardHeader>
                        <CardBody className="space-y-2">
                          <div className="text-muted flex items-center justify-between text-xs">
                            <span title={s.cwd}>
                              {s.cwd.split("/").slice(-3).join("/")}
                            </span>
                            <span className="mono">
                              updated {timeAgo(s.updated_at)}
                            </span>
                          </div>
                          {tmuxPaneRef !== null ? (
                            <div className="text-muted flex items-center justify-between text-xs">
                              <span>tmux</span>
                              <span
                                className="mono"
                                data-testid="observed-tmux-pane-ref"
                              >
                                {tmuxPaneRef}
                                {s.attribution === "heuristic" ? (
                                  <span className="text-muted ml-1 text-[10px] uppercase">
                                    heuristic
                                  </span>
                                ) : null}
                              </span>
                            </div>
                          ) : null}
                          <div>
                            <div className="text-muted flex items-center gap-1 text-xs uppercase tracking-wide">
                              Work topic
                              <Badge tone="neutral" title="Heuristic — extracted from the transcript's last user message. Panel labels it 'inferred'; it is NOT ground truth (owner decision 2026-08-16, depth = facts + work-topic).">
                                inferred
                              </Badge>
                            </div>
                            <div
                              className="mt-1 text-sm text-[var(--color-fg-secondary)]"
                              data-testid="observed-work-topic"
                            >
                              {/* work_topic_inferred is populated by the enumerator on the
                                  server side; when null the enumerator has not seen a user
                                  turn yet or the transcript header is unreadable. */}
                              <span className="text-muted">
                                — surfaced from the transcript's last user turn
                              </span>
                            </div>
                          </div>
                          {/* GSL-361 (observer mode phase B) — per-session Take/Release
                              control toggle. Hidden on ended sessions; renders the pill +
                              button surface for observer / controlled / env-locked states.
                              Replaces the older "observer only — no control" static badge
                              on cards where the shim has registered (the shim's presence
                              means panel control is now possible; the pre-phase-B badge
                              is misleading in that state). */}
                          {s.ended_at === null ? (
                            <ControlToggle
                              sessionId={s.session_id}
                              state={s.control_state as "observer" | "controlled" | undefined}
                              source={s.control_source as "env" | "runtime" | "inherited" | null | undefined}
                              shimRegistered={s.shim_registered}
                              envLocked={s.env_locked}
                            />
                          ) : null}
                        </CardBody>
                      </Card>
                    );
                  })}
                </div>
              );
            }}
          </QueryStatus>
        </main>

        <CollectorRail />
      </div>
    </div>
  );
}
