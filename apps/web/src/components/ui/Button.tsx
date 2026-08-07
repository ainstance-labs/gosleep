// @gosleep/web — Button (GSL-265). Read-only screens only need this for the theme toggle
// + the odd link-styled action; kept minimal on purpose.

import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Variant = "solid" | "ghost" | "outline";
type Size = "sm" | "md";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const VARIANT: Record<Variant, string> = {
  solid:
    "bg-[var(--color-accent)] text-[var(--color-accent-fg)] hover:bg-[var(--color-accent-hover)]",
  ghost:
    "bg-transparent text-[var(--color-fg-secondary)] hover:bg-[var(--color-sunken)] hover:text-[var(--color-fg)]",
  outline:
    "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-secondary)] hover:bg-[var(--color-sunken)] hover:text-[var(--color-fg)]",
};

const SIZE: Record<Size, string> = {
  sm: "h-7 px-2 text-xs rounded-md",
  md: "h-8 px-3 text-sm rounded-md",
};

export function Button({ variant = "outline", size = "md", className, ...rest }: Props) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center gap-1.5 font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]",
        "disabled:cursor-not-allowed disabled:opacity-60",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    />
  );
}
