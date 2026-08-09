# GSL-286 (T5) + partial GSL-266 — `POST /actions/skills/publish`

**Date:** 2026-08-10 · **Branch:** `GSL-174-skills-management`

Closes verifier ticket GSL-286 (CRITICAL — endpoint absent). GSL-266 stays In Progress because the umbrella also owns the Skills-screen Publish-button enable + the TouchID e2e; the endpoint half lands here.

## What landed

- New module `apps/core/src/actions/publish.ts` — `performPublish({skill, lesson, task, intentId})` spawns `bash tools/skills/publish.sh <skill>` with:
  - `GOSLEEP_WEB_TOKEN=<128-bit hex random nonce>` — opens publish.sh's owner-gate on the endpoint path.
  - `--yes` — skip the interactive TTY prompt (owner gate already passed).
  - `--lesson`, `--task` (optional), `--intent-id <server_intents.intent_id>` — propagate audit correlation into the CHANGELOG row (plan risk 3).
  - Passthrough envs: `GOSLEEP_SKILLS_BACKUPS_DIR`, `GOSLEEP_CHANGELOG_PATH`, `GOSLEEP_DB_PATH`.
- Ceiling: 60 s (override via `GOSLEEP_SKILLS_PUBLISH_TIMEOUT_MS`).
- Parses the CLI's final stdout line as the `{"event":"skills.publish.done", …}` payload → returns `{skill, task, commit, backup, ts, intent_id, publishSpawn:{rc,elapsedMs,stdout,stderr}, cliEvent}`.
- Mapping publish.sh exit codes → HTTP: 3 (owner-gate refused) → 403; 2 (usage) → 400; 1 (mid-flow) → 500. Wired through `httpStatusFromError` which grew a 403 branch.

- Route added to `apps/core/src/routes/actions.ts`:
  - `POST /actions/skills/publish` — Bearer + Origin (both from existing middleware) + Idempotency-Key + serialize + withTimeline. Payload validation: `skill` required and matches `^[a-z0-9][a-z0-9-]{0,63}$`, `lesson` optional string, `task` optional matching `^GSL-\d+$`.
  - Endpoint inventory header extended: nine POSTs → ten.
  - Smoke gate GSL-269 stays balanced: 10 POST routes, 10 `withTimeline<>` wraps.

- Schema (`packages/schema/src/index.ts`) — new `PublishSkillActionInput / …Result / …Response` z-objects.
- SDK (`packages/sdk/src/index.ts`) — new `coreClient.publishSkill(input, idempotencyKey)` method (mirrors `takeSnapshot`).

## Live-proof (scratch core on port 7333, sandbox HOME + scratch DB + scratch CHANGELOG + sandbox BACKUPS)

| Case | Request | Expected | Got |
|---|---|---|---|
| Positive | `POST /actions/skills/publish` `{skill:"handoff", lesson:"…", task:"GSL-286"}` with fresh `Idempotency-Key` | 200 OK, cached=false, cliEvent.event=`skills.publish.done`, publishSpawn.rc=0, backup path + commit + intent_id populated | Exact match |
| Idempotency replay | Same POST, same `Idempotency-Key` | 200 OK, cached=true, same intent_id + commit, no re-spawn | Exact match |
| Bad skill shape | `{skill:"BAD-name"}` | HTTP 400 | 400 |
| Missing skill | `{}` | HTTP 400 | 400 |
| No Bearer | POST without Authorization | HTTP 401 | 401 |

Side-effects verified in the sandbox:
- `handoff/SKILL.md` in `<sandbox>/home/.claude/skills/` = full 10 KB dev copy (rsync'd successfully).
- `<sandbox>/backups/handoff-20260809T232427Z/` = pre-rsync snapshot ("old prod skeleton" line).
- `<sandbox>/CHANGELOG.jsonl` = one valid published row keyed on the request's intent_id.
- Scratch DB `skills` row = `handoff sha-548fbf86 published owner-web`.
- Port 7333 released clean.
- Real `docs/skills/backups/` untouched (proven by ls after run).

## Design notes

- **Endpoint intent_id → CLI intent-id → CHANGELOG intent_id.** Threads a single audit correlation from the HTTP layer through the spawn env into the JSONL row. The production test-guard (T10) uses this key to correlate a filesystem mutation with a legitimate publish (plan risk 3).
- **Per-request nonce sized well above the 16-char floor.** `randomBytes(16).toString("hex")` yields 32 hex chars (128 bits); publish.sh's env-nonce gate accepts >=16 chars.
- **serialize + withTimeline.** Identical envelope to every other write endpoint (`answer`, `snapshot`, etc). Idempotency-Key replay returns the ORIGINAL result without re-spawning publish.sh — proven by T5.2.
- **CLI stdout parsing.** Reads the last non-empty stdout line matching `{"event":"skills.publish.done",…}`. Falls back to defaults if parse fails; the endpoint still returns 200 with `cliEvent: null` and the caller can inspect `publishSpawn.stdout` for the raw output.

## Gates

- `bun x tsc -p apps/core --noEmit` = 0.
- `bun x tsc -p packages/schema --noEmit` = 0.
- `bun x tsc -p packages/sdk --noEmit` = 0.
- Smoke gate GSL-269: 10 POSTs = 10 withTimeline wraps (verified inline before commit).

## Follow-ups

- T7 (Skills web screen) consumes `coreClient.publishSkill` via a new `usePublishSkill()` mutation hook; button will be visible but **disabled** with the TouchID-paused tooltip per `d-2026-08-09-001`.
- GSL-266 stays In Progress — the Skills-screen Publish-button enable + the TouchID e2e are its owner-gated deliverables.
- Optional v1.1: SSE emission of `skills.publish.started / .snapshotted / .published` (currently timeline learns about a publish through the tail indexer + the client mutation invalidation, which is enough for the interim).
