// @gosleep/web — screen-level page header (GSL-265).

import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-fg)]">
          {title}
        </h1>
        {subtitle !== undefined ? (
          <p className="text-secondary mt-1 text-sm">{subtitle}</p>
        ) : null}
      </div>
      {right !== undefined ? <div className="flex items-center gap-2">{right}</div> : null}
    </div>
  );
}
