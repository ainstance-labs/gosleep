# GSL-313 [Web] Responsive sidebar collapse at narrow viewports

**Date:** 2026-08-10 (shift 77 / epic GSL-311 hotfix 2).
**Branch:** `GSL-311-web-hotfix2` off `origin/main` @ dfe8448.
**Model:** Opus 4.7 (owner global pin).
**Depends on:** GSL-265 (AppShell), design system §5.
**Origin:** adversarial QA run `web-e2e-2026-08-10/runs/04` finding **#2 (MAJOR)**.

## Part 1 — the story

QA run 04 measured a 320×640 viewport on the panel and found
`document.documentElement.scrollWidth = 424` vs `clientWidth = 310` — a **114 px
horizontal scrollbar** on every screen. The content pane beside the fixed 240 px sidebar
was squeezed under 80 px; cards clipped under the sidebar; horizontal-swipe was required
to reach any button. The panel lives on 127.0.0.1 and the owner reaches it from a phone
during on-call — the phone view was broken.

**Root cause.** `apps/web/src/components/AppShell.tsx` used `grid-cols-[240px_1fr]`
unconditionally. Below the Tailwind `md` breakpoint (768 px), the fixed 240 px column
plus the content pane's inner padding overflowed the viewport.

**Fix.** Collapse the sidebar into an off-canvas drawer below `md`:

- Root grid is now `grid-cols-1 md:grid-cols-[240px_1fr]`.
- Sidebar renders as `fixed inset-y-0 left-0 z-50 w-[260px] max-w-[85%] transform`
  below `md` and reverts to `md:static md:translate-x-0` at and above.
- A hamburger button (Lucide `Menu`) lives in the top bar's left cluster with
  `md:hidden` — desktop never sees it.
- Backdrop `<button>` with `bg-[color-mix(in_oklab,var(--color-bg),transparent_20%)]
  backdrop-blur-sm md:hidden` catches clicks outside the drawer.
- The drawer auto-closes on: hamburger toggle, Escape, backdrop click, and any
  `useLocation()` pathname change (so a nav tap does not leave a stale overlay).
- `body.style.overflow = 'hidden'` is applied only when the drawer is open AND the
  viewport is under 768 px, so a strict-mode double-mount on desktop cannot freeze
  scroll.
- Content pane paddings drop from `px-6 py-6` to `px-4 py-4 md:px-6 md:py-6` so the
  content itself does not push the layout wider than the viewport on mobile.
- Header text `SSE stream · Last-Event-ID resume` and the theme-button label
  ("Light"/"Dark") switch to `hidden sm:inline` — the badges and icon-only theme toggle
  fit at 320 px without collision with the hamburger.

**Design system.** Uses only existing tokens (`--color-*`, `--radius-*`) and existing
primitives (`Button`, `Badge`, `cn`). No new dependency, no framer-motion animation — a
plain CSS `transition-transform duration-200 ease-out` matches the Mastra/Supabase
developer-tool aesthetic already established.

**Live proof.** Same CDP session as `GSL-312`. Measured
`document.documentElement.scrollWidth === clientWidth` across four viewports × six
routes:

| viewport   | routes measured                                              | overflow |
|------------|--------------------------------------------------------------|----------|
| 320×640    | /overview, /fleet, /timeline, /questions, /tasks, /cost      | 0 / 6    |
| 390×844    | /overview, /fleet, /timeline, /questions, /tasks, /cost      | 0 / 6    |
| 768×1024   | same                                                          | 0 / 6    |
| 1440×900   | same                                                          | 0 / 6    |

Screenshots under `assets/GSL-313/`:
- `viewport-320x640-{overview,questions}.png` — narrow, no scroll, hamburger visible.
- `viewport-320x640-nav-open.png` — hamburger tapped, drawer slid in, backdrop dimmed.
- `viewport-390x844-{overview,questions}.png` — iPhone width, comfortable.
- `viewport-768x1024-questions.png` — md breakpoint boundary, sidebar visible.
- `viewport-1440x900-questions.png` — desktop control, unchanged from pre-fix.

Full harness at `.artifacts/hotfix2-live/verify.ts` (see the M2 loop). Machine-readable
results dumped in `.artifacts/hotfix2-live/results.json`.

## Part 2 — technical reference

**Files changed:**
- `apps/web/src/components/AppShell.tsx` — grid, drawer, hamburger, backdrop, keyboard
  + click-outside handlers.

**Gates:**
- `bun x tsc -p apps/web --noEmit` — clean.
- `bun run --filter='@gosleep/web' build` — clean (dist rebuild).
- Live-proof `document.documentElement.scrollWidth === clientWidth` at 320, 390, 768,
  and 1440 on every screen.

**Non-goals kept out of this task:**
- No new UI-primitive for the drawer (Radix `Dialog` was rejected — a `fixed` panel is
  enough and keeps bundle size flat).
- No route-level responsive rework — every screen already uses `min-w-0` on flex/grid
  children, so the drawer alone is sufficient.
- No dark-mode-only styling — the design tokens already handle both themes; both were
  verified via CDP switching.
