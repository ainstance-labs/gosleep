// @gosleep/web — Radix Toast wrapper (GSL-265).
//
// Keep it small: a Provider that also exposes a `push()` helper via context so any
// component can trigger a toast without prop-drilling. Tone maps to token colors from
// globals.css.

import * as Radix from "@radix-ui/react-toast";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

type Tone = "info" | "ok" | "warn" | "danger";

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: Tone;
}

interface ToastCtx {
  push: (t: Omit<ToastItem, "id">) => void;
}

const Ctx = createContext<ToastCtx>({ push: () => undefined });

export function useToast(): ToastCtx {
  return useContext(Ctx);
}

let SEQ = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const item: ToastItem = { id: SEQ++, ...t };
    setItems((prev) => [...prev, item]);
    setTimeout(() => {
      setItems((prev) => prev.filter((x) => x.id !== item.id));
    }, 6_000);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <Radix.Provider swipeDirection="right" duration={6_000}>
      <Ctx.Provider value={value}>
        {children}
        {items.map((item) => (
          <Radix.Root
            key={item.id}
            className={cn(
              "surface pointer-events-auto grid grid-cols-[auto_1fr] items-start gap-3 rounded-lg px-4 py-3 shadow-lg",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
            )}
            duration={6_000}
          >
            <span
              aria-hidden
              className={cn(
                "mt-1 h-2 w-2 rounded-full",
                item.tone === "info" && "bg-[var(--color-info)]",
                item.tone === "ok" && "bg-[var(--color-ok)]",
                item.tone === "warn" && "bg-[var(--color-warn)]",
                item.tone === "danger" && "bg-[var(--color-danger)]",
              )}
            />
            <div>
              <Radix.Title className="text-sm font-medium text-[var(--color-fg)]">
                {item.title}
              </Radix.Title>
              {item.description !== undefined ? (
                <Radix.Description className="text-secondary mt-0.5 text-sm">
                  {item.description}
                </Radix.Description>
              ) : null}
            </div>
          </Radix.Root>
        ))}
      </Ctx.Provider>
    </Radix.Provider>
  );
}

export function ToastViewport() {
  return (
    <Radix.Viewport
      className={cn(
        "fixed bottom-4 right-4 z-50 flex w-96 max-w-full flex-col gap-2",
        "pointer-events-none outline-none",
      )}
    />
  );
}
