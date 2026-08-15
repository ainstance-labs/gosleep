// @gosleep/web — application shell (GSL-265, GSL-313).
//
// A sidebar navigation on the left, a top bar with connection status + theme toggle on the
// right, an <Outlet/> for the current screen. Layout tokens use design-system §5 spacing.
//
// GSL-313 (hotfix 2) — responsive sidebar. Below the Tailwind `md` breakpoint (768 px) the
// 240 px sidebar becomes an off-canvas drawer that slides in from the left when a hamburger
// button in the top bar is pressed. The drawer closes on: hamburger toggle, nav-link click,
// backdrop click, and Escape. Desktop layout is byte-identical to the pre-hotfix design.

import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  ActivitySquare,
  BookText,
  Clock3,
  HelpCircle,
  ListChecks,
  Menu,
  Moon,
  Receipt,
  Sun,
  Users,
  Wifi,
  WifiOff,
  X,
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
  // T7 (GSL-255 + GSL-287) — Skills management system.
  { to: "/skills", label: "Skills", icon: BookText },
] as const;

export function AppShell() {
  const { effective, toggle } = useTheme();
  const { isConnected } = useSse();
  const status = useStatus();
  const version = useVersion();
  const whoami = useWhoami();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  // Auto-close the drawer on route change so a nav tap does not leave a stale overlay.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  // Lock body scroll while the drawer is open (below md — noop above md because the drawer
  // is hidden). Guarded by matchMedia so a desktop toggle from React strict-mode double-mount
  // never accidentally freezes the desktop scroll.
  useEffect(() => {
    if (!navOpen) return;
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 767px)");
    if (!mq.matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [navOpen]);

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[240px_1fr] bg-[var(--color-bg)] text-[var(--color-fg)]">
      {/* --- Backdrop (mobile only) ---------------------------------------- */}
      {navOpen ? (
        <button
          type="button"
          aria-label="close navigation"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-[color-mix(in_oklab,var(--color-bg),transparent_20%)] backdrop-blur-sm md:hidden"
        />
      ) : null}

      {/* --- Sidebar --------------------------------------------------------- */}
      <aside
        className={cn(
          // Desktop: static column, always visible.
          "md:static md:flex md:h-auto md:w-auto md:translate-x-0",
          // Mobile: fixed off-canvas drawer.
          "fixed inset-y-0 left-0 z-50 flex w-[260px] max-w-[85%] transform flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] transition-transform duration-200 ease-out",
          navOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
        aria-label="Primary navigation"
      >
        <div className="flex h-14 items-center gap-2 border-b border-[var(--color-border)] px-4">
          <span aria-hidden className="text-lg">🌙</span>
          <span className="text-sm font-medium tracking-tight">gosleep</span>
          <span className="text-muted text-xs">control plane</span>
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            aria-label="close navigation"
            className="text-secondary hover:text-fg ml-auto flex h-8 w-8 items-center justify-center rounded-md md:hidden"
          >
            <X size={16} strokeWidth={1.6} />
          </button>
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
        <header className="flex h-14 items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setNavOpen((v) => !v)}
              aria-label={navOpen ? "close navigation" : "open navigation"}
              aria-expanded={navOpen}
              className="text-secondary hover:text-fg -ml-1 flex h-8 w-8 items-center justify-center rounded-md md:hidden"
            >
              <Menu size={16} strokeWidth={1.6} />
            </button>
            <Badge tone={isConnected ? "ok" : "warn"}>
              {isConnected ? (
                <Wifi size={12} strokeWidth={2} />
              ) : (
                <WifiOff size={12} strokeWidth={2} />
              )}
              <span>{isConnected ? "live" : "reconnecting"}</span>
            </Badge>
            <span className="text-secondary hidden text-xs sm:inline">
              SSE stream · <span className="mono">Last-Event-ID</span> resume
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={toggle} aria-label="toggle theme">
              {effective === "dark" ? <Sun size={14} /> : <Moon size={14} />}
              <span className="hidden sm:inline">
                {effective === "dark" ? "Light" : "Dark"}
              </span>
            </Button>
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-x-hidden px-4 py-4 md:px-6 md:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
