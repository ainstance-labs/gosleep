// @gosleep/web — Vite 7 config (GSL-265).
//
// Rev-3 addendum Delta 6 pins Vite 7 (Vite 8 / Rolldown deferred to v1.1). The dev server
// proxies /api → 127.0.0.1:7331 so the browser talks to Vite in dev and to gosleep-core in
// production; the client uses `window.location.origin` as its baseUrl so no config swap is
// needed between the two modes.

import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@gosleep/schema": path.resolve(__dirname, "../../packages/schema/src/index.ts"),
      "@gosleep/sdk": path.resolve(__dirname, "../../packages/sdk/src/index.ts"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5273,
    strictPort: false,
    proxy: {
      // Namespace every core call under /api/* so it does NOT collide with SPA routes like
      // /tasks or /questions (react-router 7 owns those in the browser). The rewrite strips
      // the /api prefix before forwarding, and changeOrigin: true replaces the outgoing Host
      // header to "127.0.0.1:7331" — required by core's requireLocalHost middleware.
      //
      // SSE lives under /api/events; the configure hook disables intermediary compression +
      // idle buffering so the stream reaches the browser unmutated.
      "/api": {
        target: "http://127.0.0.1:7331",
        changeOrigin: true,
        ws: false,
        rewrite: (p) => p.replace(/^\/api/, ""),
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes, req) => {
            if (typeof req.url === "string" && req.url.startsWith("/api/events")) {
              proxyRes.headers["cache-control"] = "no-cache, no-transform";
            }
          });
        },
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2022",
  },
});
