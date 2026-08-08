// @gosleep/web — theme provider (GSL-265).
//
// Three-way theme control: `system` (follow prefers-color-scheme), `light`, `dark`. The
// active choice is persisted to localStorage under `gosleep.theme` and stamped on
// <html data-theme=…> so the CSS `[data-theme="…"]` rules in globals.css can win over the
// `prefers-color-scheme` default.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

type Theme = "system" | "light" | "dark";

interface ThemeCtx {
  theme: Theme;
  effective: "light" | "dark";
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

const STORAGE_KEY = "gosleep.theme";

function readInitial(): Theme {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

function computeEffective(theme: Theme): "light" | "dark" {
  if (theme === "light" || theme === "dark") return theme;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitial);
  const [effective, setEffective] = useState<"light" | "dark">(() => computeEffective(theme));

  useEffect(() => {
    const html = document.documentElement;
    if (theme === "system") {
      html.removeAttribute("data-theme");
    } else {
      html.setAttribute("data-theme", theme);
    }
    setEffective(computeEffective(theme));
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setEffective(mq.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const eff = computeEffective(prev);
      return eff === "dark" ? "light" : "dark";
    });
  }, []);

  const value = useMemo<ThemeCtx>(
    () => ({ theme, effective, setTheme, toggle }),
    [theme, effective, setTheme, toggle],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (v === null) throw new Error("useTheme must be used inside <ThemeProvider>");
  return v;
}
