// @gosleep/web — small helper: renders skeletons / error / empty for a query result.
//
// GSL-314 (hotfix 2) — the 401 recovery hint used to hardcode `127.0.0.1:7331` even when the
// SPA was served from a different port (`GOSLEEP_CORE_PORT` override, or the scratch QA harness
// on :7344). We derive the origin from `window.location` at render time so the diagnostic always
// points at the port the panel is actually running on.

import type { ReactNode } from "react";
import { Card, CardBody } from "./ui/Card";
import { Skeleton } from "./ui/Skeleton";

interface Props<T> {
  isPending: boolean;
  error: unknown;
  data: T | undefined;
  isEmpty?: (data: T) => boolean;
  emptyMessage?: string;
  children: (data: T) => ReactNode;
  skeleton?: ReactNode;
}

/** Best-effort read of the running SPA's origin — falls back to the historical default so a
 *  stale test harness without `window` still shows a sensible hint. */
function coreOrigin(): string {
  if (typeof window !== "undefined" && window.location && window.location.origin.length > 0) {
    return window.location.origin;
  }
  return "http://127.0.0.1:7331";
}

export function QueryStatus<T>({
  isPending,
  error,
  data,
  isEmpty,
  emptyMessage = "Nothing yet.",
  children,
  skeleton,
}: Props<T>) {
  if (isPending) {
    return (
      <>
        {skeleton ?? (
          <Card>
            <CardBody>
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-4 w-52" />
              </div>
            </CardBody>
          </Card>
        )}
      </>
    );
  }
  if (error !== null && error !== undefined) {
    return (
      <Card>
        <CardBody>
          <p className="text-[var(--color-danger)] text-sm">
            {(error as Error).message ?? "Request failed"}
          </p>
          <p className="text-secondary mt-1 text-xs">
            Check that gosleep-core is running on{" "}
            <span className="mono">{coreOrigin()}</span> and the Bearer token in
            sessionStorage is current.
          </p>
        </CardBody>
      </Card>
    );
  }
  if (data === undefined) return null;
  if (isEmpty !== undefined && isEmpty(data)) {
    return (
      <Card>
        <CardBody>
          <p className="text-muted text-sm">{emptyMessage}</p>
        </CardBody>
      </Card>
    );
  }
  return <>{children(data)}</>;
}
