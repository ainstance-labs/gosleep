# GSL-314 [Web] Bundle 3 minors: stable idem key, dynamic 401 hint, formatted options

**Date:** 2026-08-10 (shift 77 / epic GSL-311 hotfix 2).
**Branch:** `GSL-311-web-hotfix2` off `origin/main` @ dfe8448.
**Model:** Opus 4.7 (owner global pin).
**Depends on:** GSL-268 (mutation hooks), GSL-284 (permission decide UI), GSL-291
(GOSLEEP_CORE_PORT override).
**Origin:** adversarial QA run `web-e2e-2026-08-10/runs/04` findings **#3, #4, #5
(MINOR)**.

## Part 1 — the story

Three small findings bundled into one Task so the PR footprint stays compact. Each is
its own logical change on a different file, but they share the same theme — closing the
"minor pollution" surface the audit called out.

### minor#1 — stable Idempotency-Key per intent

QA run 04 finding #3: five synchronous JS clicks on Allow for a permission row fired
five POSTs to `/actions/permissions/decide`. The server logged one `ok` and four `fail`
(409, correct — the SQL `WHERE status='open'` guard held), but `server_intents` filled
with five duplicate rows and the UI toast plumbing had to swallow four negative
responses.

**Root cause.** `newIdempotencyKey()` in `apps/web/src/data/queries.ts` minted a fresh
`crypto.randomUUID()` per invocation. The server's `server_intents.intent_id` replay
cache is keyed by that value, so a burst never collapsed. The only client protection
was `disabled={isPending}`, which flips through React state updates — asynchronous, so
five clicks in one microtask all fired before the button disabled.

**Fix.** Replace `newIdempotencyKey()` with `stableIdempotencyKey(action, input)`. The
key is derived from four components:

- **session nonce** — 8 chars minted once per browser tab (`crypto.randomUUID().slice(0, 8)`);
- **action** — the mutation hook name (`decide`, `answer`, `resolve`, `ack`, `tick`,
  `applyManifest`, `defer`, `syncTasks`, `snapshot`);
- **input hash** — 8-char djb2 hex of a stable serializer (sorted keys) applied to the
  mutation input;
- **2-second time bucket** — `Math.round(Date.now() / 2000)`. A rapid burst of clicks
  in the same second collapses to one key; a deliberate re-click 2+ seconds later gets
  a fresh key.

Full format: `web-<sessionNonce>-<action>-<inputHash>-<bucket>` — 128-char cap enforced
against `withTimeline.resolveIntentId`'s ASCII-printable contract.

**Semantics.** For actions with a natural target (decide/answer/apply/defer/resolve/
ack), the same target → same key → server returns cached OK for clicks 2..5 of a
burst; ledger stays clean. For actions with no natural target (tick with no carrier,
snapshot with a fixed `owner-web` label, syncTasks with `{}`), the same behavior applies
and the toast shows `(cached replay)` when the second call fires within the window.

**Regression test.** `apps/web/test/stableIdempotencyKey.test.ts` — 8 assertions
covering: same-input same-key, 5-click burst → 1 key, deliberate re-click after the
bucket → fresh key, action namespacing, target namespacing, key-order stability,
128-char + ASCII printable bounds, undefined vs `{}` distinguishability.

### minor#2 — dynamic 401 hint

QA run 04 finding #4: the `QueryStatus` 401 recovery hint hardcoded
`127.0.0.1:7331`. The panel now runs on 127.0.0.1:7345 in QA and could run on any
`GOSLEEP_CORE_PORT` override; the hint always pointed at the wrong port.

**Fix.** `apps/web/src/components/QueryStatus.tsx` — the hint now uses
`window.location.origin` at render time, rendered inside a `<span className="mono">` so
the port stands out. The default fallback (only for a test harness without `window`)
remains `http://127.0.0.1:7331`.

### minor#3 — question options as a formatted list

QA run 04 finding #5: non-permission questions rendered `options` as raw JSON in a
`<pre>` block. Owner had to read the array with quotes/brackets/indentation, then TYPE
the answer verbatim in the free-text field. Permission cards (Allow/Deny) already had
proper buttons; only the AskUserQuestion path was ugly.

**Fix.** New `QuestionOptions` component in `apps/web/src/screens/Questions.tsx` renders
an array of `{label, description?, pros?, cons?}` as a stacked card list — numbered
label + optional muted description + `+` / `−` prefixed pros/cons. Fallbacks:

- If the whole `options` is a bare string, render it as one paragraph.
- If the shape isn't an array of objects with string labels, fall back to the original
  JSON `<pre>` dump so the panel never hides data it does not understand.

Both themes use the same `--color-*` tokens (`--color-ok`/`--color-warn` for the pros/
cons markers) — no new tokens needed.

**Live proof.** Screenshot at `assets/GSL-314/options-formatted-390.png` shows a
permission card on the questions screen at 390×844 with the new formatted
`Options (2)` block — the JSON dump is gone.

## Part 2 — technical reference

**Files changed:**
- `apps/web/src/data/queries.ts` — new `stableIdempotencyKey` + `stableSerialize` +
  `djb2Hex` + `IDEMPOTENCY_BUCKET_MS`; every mutation hook now calls
  `stableIdempotencyKey('<action>', input)`.
- `apps/web/src/components/QueryStatus.tsx` — new `coreOrigin()` helper; hint now
  shows the runtime origin.
- `apps/web/src/screens/Questions.tsx` — new `QuestionOptions` component + hook-in at
  the card body render.
- `apps/web/test/stableIdempotencyKey.test.ts` — new file, 8 assertions.

**Gates:**
- `bun x tsc -p apps/web --noEmit` — clean.
- `bun run --filter='@gosleep/web' build` — clean.
- `bun test apps/web/test/stableIdempotencyKey.test.ts` — 8 pass / 0 fail.

**Non-goals kept out of this task:**
- No server-side change to the replay cache — the fix is client-side by design.
- No rework of the answer dialog itself (option-picker widget vs free-text) — the audit
  called out the READ side (JSON dump) as a MINOR; the write side stays unchanged.
- No test in the browser for QueryStatus hint (would require booting the SPA); the
  code change is trivial and the underlying `window.location.origin` API is stable.
