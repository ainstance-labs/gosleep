// @gosleep/web — NotFound screen (GSL-295).
//
// Replaces the wildcard `<Navigate to="/overview" replace />` router entry that used to
// silently redirect any unknown path to Overview. The old behaviour hid the missing-Skills
// screen (a separate finding) and any future missing surface — an owner who typed `/skills`
// couldn't tell the panel was incomplete; they landed on Overview and assumed everything
// was there. This screen names the missing route and offers a way back.

import { useLocation, Link } from "react-router-dom";

import { PageHeader } from "../components/PageHeader";
import { Card, CardBody } from "../components/ui/Card";
import { cn } from "../lib/cn";

export function NotFoundScreen() {
  const location = useLocation();
  const path = location.pathname + location.search;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Route not found"
        subtitle="The URL did not match any client-side route in this build."
      />
      <Card>
        <CardBody className="space-y-3">
          <div>
            <div className="text-muted text-xs uppercase tracking-wide">Requested</div>
            <div className="mono mt-1 text-sm text-[var(--color-fg)] break-all">
              {path}
            </div>
          </div>
          <div>
            <div className="text-muted text-xs uppercase tracking-wide">What to check</div>
            <ul className="mt-1 list-inside list-disc text-sm text-[var(--color-fg-secondary)]">
              <li>
                The path may be a stale bookmark from an older build — the routes the
                sidebar shows are the ones this SPA knows about.
              </li>
              <li>
                A missing surface (e.g. <code className="mono">/skills</code> before the
                skills-management ticket lands) will land here rather than silently
                redirecting elsewhere.
              </li>
            </ul>
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            {/* Router links with button styling — Button component doesn't currently
                support asChild, so we compose the classes directly. */}
            <Link
              to="/overview"
              className={cn(
                "inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-medium transition-colors",
                "bg-[var(--color-accent)] text-[var(--color-accent-fg)] hover:bg-[var(--color-accent-hover)]",
              )}
            >
              Go to Overview
            </Link>
            {(["fleet", "timeline", "questions", "tasks", "cost"] as const).map((r) => (
              <Link
                key={r}
                to={`/${r}`}
                className={cn(
                  "inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-medium transition-colors",
                  "bg-transparent text-[var(--color-fg-secondary)] hover:bg-[var(--color-sunken)] hover:text-[var(--color-fg)]",
                )}
              >
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </Link>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
