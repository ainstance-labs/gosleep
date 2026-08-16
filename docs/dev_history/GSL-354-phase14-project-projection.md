# GSL-354 — Project projection + deterministic colour + hide-list opt-out

**Epic:** GSL-350 · **Branch:** `GSL-350-observer-mode-phase-a` · **Base:** `origin/main` @ `cc09415`.

`apps/core/src/observed/projects.ts` — rebuilds the project-level view on demand from the
joined `agent_sessions` rows. Emits `{project_slug, cwd_project_root, session_count,
observed_only_count, last_activity, hidden, pseudonym, colour_hsl}` per project. Rows sorted
by `last_activity` desc.

**Deterministic colour:** FNV-1a 32-bit hash of the display slug folded to a stable HSL hue
(saturation + lightness fixed so the palette lives in one design band). Two slugs never
collide unless their FNV-1a hashes do. Colour is applied to the render slug (i.e. to the
pseudonym for hidden slugs), so the same visual identity persists whether the panel shows
the real name or the pseudonym.

**Hide-list** (owner decision 2026-08-16, privacy = opt-out list is enough for v1):
- Reads optional `data/observed/hidden-projects.json` (env-overridable via
  `GOSLEEP_OBSERVED_HIDDEN` for tests).
- Hidden slugs render under a stable pseudonym (`project-b`, `project-c`, … — sorted
  alphabetically among hidden slugs).
- **Collectors still observe hidden projects.** The `observed_events` table stores the REAL
  slug. Hiding is a render-time projection, not a data-layer redaction. This preserves the
  raw record so a hide-list change reveals the real slug retroactively.

## Tests

`apps/core/test/observed.projects.test.ts` — 5 tests: colour determinism + distinctness,
empty hide file → empty hidden set, three-row fold with correct `observed_only_count`,
hidden slug → `pseudonym=project-b` + underlying event still carries the real slug,
`displayName` mapping.
