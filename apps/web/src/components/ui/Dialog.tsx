// @gosleep/web — Radix Dialog wrapper (GSL-268).
//
// A minimal modal dialog for the four write-action UI elements landing with GSL-268:
//   - Questions.tsx  → "Answer" prompt (question + text field + submit)
//   - Questions.tsx  → "Mark resolved" prompt
//   - Overview.tsx   → "Run tick" confirmation
//   - Timeline.tsx   → "Ack" confirmation
//
// Uses `@radix-ui/react-dialog` primitives so focus-trap, ESC-to-close, and scrim click are
// handled correctly out of the box. Styling is Tailwind tokens matching the rest of the shell.
//
// The `controlled` model: parent owns `open` + `onOpenChange`. Children are rendered inside
// the panel; the parent supplies title, description, and action buttons.

import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Rendered in the footer, right-aligned. Typical: Cancel + Confirm. */
  footer?: ReactNode;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={cn(
            "fixed inset-0 z-40 bg-black/40 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
          )}
        />
        <RadixDialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2",
            "surface rounded-lg shadow-xl outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
          )}
        >
          <div className="border-b border-[var(--color-border-subtle)] px-4 py-3">
            <RadixDialog.Title className="text-sm font-medium text-[var(--color-fg)]">
              {title}
            </RadixDialog.Title>
            {description !== undefined ? (
              <RadixDialog.Description className="text-secondary mt-1 text-xs">
                {description}
              </RadixDialog.Description>
            ) : null}
          </div>
          <div className="px-4 py-4 text-sm">{children}</div>
          {footer !== undefined ? (
            <div className="flex justify-end gap-2 border-t border-[var(--color-border-subtle)] px-4 py-3">
              {footer}
            </div>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
