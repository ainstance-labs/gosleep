// @gosleep/web — entrypoint (GSL-265).
//
// Boots the React 19 root with:
//   1. QueryClientProvider (TanStack Query v5) — data cache used by every screen.
//   2. RouterProvider     — react-router 7 data-router with our screens.
//   3. ThemeProvider      — light/dark toggle stamped on <html data-theme=…> and mirrored
//                           with `prefers-color-scheme` (design-system §4).
//   4. SseProvider        — one persistent SSE stream shared across all screens; per
//                           event.type it invalidates the matching TanStack query keys.
//
// Bearer discovery is deferred to the client: we look in `sessionStorage['gosleep.token']`
// first, then the `?token=…` query on the first page load (setup redirect), then null.
// A missing token surfaces on every screen as an "Auth required" banner rather than
// silently 401'ing individual reads — matches rev-3 addendum Delta 5's fail-loud stance.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";

import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./theme/globals.css";

import { router } from "./router";
import { ThemeProvider } from "./theme/ThemeProvider";
import { SseProvider } from "./data/SseProvider";
import { ToastProvider, ToastViewport } from "./components/ui/Toast";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Freshness matters for a live control plane. The SSE stream still invalidates keys
      // reactively, but a manual refetch (window focus) should also produce a re-request.
      staleTime: 5_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

const rootEl = document.getElementById("root");
if (rootEl === null) throw new Error("#root element missing from index.html");

createRoot(rootEl).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <SseProvider>
            <RouterProvider router={router} />
          </SseProvider>
          <ToastViewport />
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
