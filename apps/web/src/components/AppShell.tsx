// @gosleep/web — application shell (GSL-265).
//
// A sidebar navigation on the left, a top bar with connection status + theme toggle on the
// right, an <Outlet/> for the current screen. Layout tokens use design-system §5 spacing.

import { NavLink, Outlet } from "react-router-dom";
import {
  ActivitySquare,
  Clock3,
  HelpCircle,
  ListChecks,
  Moon,
  Receipt,
  Sun,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";

import { cn } from "../lib/cn";
import { useTheme } from "../theme/ThemeProvider";
import { useSse } from "../data/SseProvider";
import { useStatus, useVersion, useWhoami } from "../data/queries";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";

const NAV = [
  { to: "/overview", label: "Overview", icon: ActivitySquare },
  { to: "/fleet", label: "Fleet", icon: Users },
  { to: "/timeline", label: "Timeline", icon: Clock3 },
  { to: "/questions", label: "Questions", icon: HelpCircle },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
  { to: "/cost", label: "Cost", icon: Receipt },
] as const;

export function AppShell() {
  const { effective, toggle } = useTheme();
  const { isConnected } = useSse();
  const status = useStatus();
  const version = useVersion();
  const whoami = useWhoami();

  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr] bg-[var(--color-bg)] text-[var(--color-fg)]">
      {/* --- Sidebar --------------------------------------------------------- */}
      <aside className="flex flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex h-14 items-center gap-2 border-b border-[var(--color-border)] px-4">
          <span aria-hidden className="text-lg">🌙</span>
          <span className="text-sm font-medium tracking-tight">gosleep</span>
          <span className="text-muted text-xs">control plane</span>
        </div>

        <nav className="flex-1 px-2 py-3">
          <ul className="flex flex-col gap-0.5">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        "rowlink flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm",
                        isActive
                          ? "bg-[color-mix(in_oklab,var(--color-accent),transparent_88%)] text-[var(--color-accent)]"
                          : "text-[var(--color-fg-secondary)] hover:bg-[var(--color-sunken)] hover:text-[var(--color-fg)]",
                      )
                    }
                  >
                    <Icon size={16} strokeWidth={1.6} />
                    <span>{item.label}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-[var(--color-border-subtle)] px-4 py-3 text-xs text-[var(--color-fg-muted)]">
          <div className="flex items-center justify-between">
            <span>owner</span>
            <span className="mono">{whoami.data?.owner ?? "…"}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span>version</span>
            <span className="mono">{version.data?.server_version ?? "…"}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span>events</span>
            <span className="mono">{status.data?.counts.events ?? "…"}</span>
          </div>
        </div>
      </aside>

      {/* --- Main pane ------------------------------------------------------- */}
      <div className="flex min-w-0 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6">
          <div className="flex items-center gap-3">
            <Badge tone={isConnected ? "ok" : "warn"}>
              {isConnected ? (
                <Wifi size={12} strokeWidth={2} />
              ) : (
                <WifiOff size={12} strokeWidth={2} />
              )}
              <span>{isConnected ? "live" : "reconnecting"}</span>
            </Badge>
            <span className="text-secondary text-xs">
              SSE stream · <span className="mono">Last-Event-ID</span> resume
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={toggle} aria-label="toggle theme">
              {effective === "dark" ? <Sun size={14} /> : <Moon size={14} />}
              <span>{effective === "dark" ? "Light" : "Dark"}</span>
            </Button>
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-x-hidden px-6 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
