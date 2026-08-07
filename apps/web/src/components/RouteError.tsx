// @gosleep/web — router error boundary (GSL-265).

import { useRouteError, isRouteErrorResponse } from "react-router-dom";
import { Card, CardBody, CardHeader, CardTitle } from "./ui/Card";

export function RouteError() {
  const err = useRouteError();
  const message = isRouteErrorResponse(err)
    ? `${err.status} ${err.statusText}`
    : err instanceof Error
      ? err.message
      : "Unknown routing error";
  return (
    <div className="mx-auto max-w-xl p-8">
      <Card>
        <CardHeader>
          <CardTitle>Something went wrong</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-secondary text-sm">{message}</p>
        </CardBody>
      </Card>
    </div>
  );
}
