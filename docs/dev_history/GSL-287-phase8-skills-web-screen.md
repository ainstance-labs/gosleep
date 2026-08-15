# GSL-287 (T7) + closes rest of GSL-255 — Skills web screen

**Date:** 2026-08-10 · **Branch:** `GSL-174-skills-management`

Closes verifier ticket GSL-287 (CRITICAL — no Skills screen, only 6/7 promised screens). GSL-255 stays In Review across the two commits (T6 endpoint half + this screen half).

## What landed

- New `apps/web/src/screens/Skills.tsx` (~250 lines) — seven-skill list with per-row status badge, hashes, "View diff + history" button, and a Publish button.
- Router (`apps/web/src/router.tsx`) — new `{ path: "skills", element: <SkillsScreen /> }` child under `/` (right before the wildcard NotFound). `/skills` no longer falls through to NotFoundScreen (GSL-295's honest wildcard stays).
- AppShell (`apps/web/src/components/AppShell.tsx`) — new NAV entry `{ to: "/skills", label: "Skills", icon: BookText }` after Cost. Sidebar now shows all seven screens.
- Queries (`apps/web/src/data/queries.ts`):
  - `queryKeys.skillDiff(name)` new key.
  - `useSkillDiff(name | null)` — enabled only when a row is selected (drawer opens).
  - `usePublishSkill()` — TanStack mutation over `coreClient.publishSkill()`; on success invalidates the skills query, all skill-diff queries, and the timeline. Idempotency-Key freshly minted per invocation (browser-side dedupe against double-clicks + server-side replay via `withTimeline`).

## Behaviour

- **List view.** Each of the seven skills renders as a Card with:
  - Status badge: `clean` (ok) / `has changes` (warn) / `never published` (info) / `no development copy` (warn — used by production-only skills like `tmux-agents-orchestration` until stage 1).
  - Version (`sha-<8chars>` or `0.0.0`).
  - Last publish age (via `timeAgo`) + last-published-by (`owner-web` / `owner-cli`).
  - Local + prod hashes (short-form).
  - Two buttons: `View diff + history` (opens drawer, always enabled) and `Publish (paused)` (disabled with `title="TouchID paused (d-2026-08-09-001). Publish via CLI: bash tools/skills/publish.sh <name>"`).
- **Details drawer (dialog).** Full unified diff (mono, scrollable, 200 KB bounded per T6) + CHANGELOG history list. Loading + error + empty states all wired.
- **TouchID-paused banner** at the top of the screen: explicitly names the CLI equivalent and the decision key (`d-2026-08-09-001`), so an owner reading the panel first thing tomorrow morning knows exactly why the button is disabled and how to unblock.
- **SSE invalidation** already fires on `queryKeys.skills()` from the existing SseProvider — publish events flowing through the timeline will trigger a re-fetch without a hard reload once a publish lands.

## Design notes

- **Design language matches shipped screens.** Reuses `PageHeader` + `Card` + `Badge` + `Button` + `Dialog` + `QueryStatus` + `useToast`. Same Geist / var(--color-*) tokens. No new UI primitives; nothing introduced that wasn't already vetted by prior screens.
- **Wired-but-disabled Publish button.** The mutation hook is complete, the click handler function exists, the schema + SDK path all typecheck end-to-end. When `d-2026-08-09-001` lifts, the change is a one-line flip on the button's `disabled={true}` attribute (plus removing the `title` tooltip and calling `submitPublish(row)` from `onClick`). This is deliberate — leaving the mutation dead-referenced (`String(publish.isPending); typeof submitPublish`) so `tsc` catches any accidental hook-signature drift on the way.
- **Row union covers seven skills.** GET /skills was extended (T6) to union DB rows with `KNOWN_SKILLS`, so `tmux-agents-orchestration` (production-only until stage 1) still appears with a `no development copy` badge instead of vanishing.

## Gates

- `bun x tsc -p apps/web --noEmit` → 0.
- `bun run --filter='@gosleep/web' build` → ✓ built in 2.71 s, 2354 modules, no errors.

## Live browser check

Skipped tonight per the brief's context-budget guidance (one plain cheap subagent was allowed for this — not spent; owner's morning review is the browser check). Endpoint half (T6) was live-proven from `curl` in the T6 dev-history; the screen consumes exactly those two endpoints and the type contract is enforced at compile time.

## Follow-ups

- GSL-287 → In Review (closes on the epic PR merge).
- GSL-255 → In Review (both halves — T6 endpoint + T7 screen — now landed).
- GSL-266 continues awaiting the TouchID pause lift; when it lifts, one-line flip on `disabled` in Skills.tsx + a live browser proof completes the umbrella.
