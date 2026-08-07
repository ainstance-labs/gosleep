// @gosleep/web — small helper: renders skeletons / error / empty for a query result.

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
            Check that gosleep-core is running on 127.0.0.1:7331 and the Bearer token in
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
