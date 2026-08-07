// @gosleep/web — Badge / status pill (GSL-265).

import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Tone = "neutral" | "info" | "ok" | "warn" | "danger" | "accent";

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

const TONE: Record<Tone, string> = {
  neutral:
    "bg-[var(--color-sunken)] text-[var(--color-fg-secondary)] border-[var(--color-border)]",
  info:
    "bg-[var(--color-info-soft)] text-[var(--color-info)] border-[color-mix(in_oklab,var(--color-info),transparent_70%)]",
  ok:
    "bg-[var(--color-ok-soft)] text-[var(--color-ok)] border-[color-mix(in_oklab,var(--color-ok),transparent_70%)]",
  warn:
    "bg-[var(--color-warn-soft)] text-[var(--color-warn)] border-[color-mix(in_oklab,var(--color-warn),transparent_70%)]",
  danger:
    "bg-[var(--color-danger-soft)] text-[var(--color-danger)] border-[color-mix(in_oklab,var(--color-danger),transparent_70%)]",
  accent:
    "bg-[color-mix(in_oklab,var(--color-accent),transparent_88%)] text-[var(--color-accent)] border-[color-mix(in_oklab,var(--color-accent),transparent_70%)]",
};

export function Badge({ tone = "neutral", className, ...rest }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4",
        TONE[tone],
        className,
      )}
      {...rest}
    />
  );
}
