// @gosleep/web — className merge helper (GSL-265).
// Standard shadcn-style utility: clsx for conditional composition, tailwind-merge to
// resolve Tailwind class conflicts (last-write-wins on the same token axis).

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
