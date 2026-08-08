// @gosleep/web — Skeleton (GSL-265). Simple pulsing rect for loading states.

import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-[var(--color-sunken)]",
        className,
      )}
      {...rest}
    />
  );
}
