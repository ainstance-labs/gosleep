# GSL-277 — Manifest-rule provenance: questions.applied_by + applied_rule_ref + POST /actions/questions/apply-manifest + Questions badge

Phase 37 (web control plane, epic GSL-250). Branch: `GSL-250-control-plane`.

## What was done

Gave the owner a first-class way to answer a queue question "via the manifest" from the web, with provenance columns that record WHO decided (owner / manifest / orchestrator) AND which manifest rule was cited. Rev-3 addendum Delta 8.2. Owner requirement R1 sub-clause — «показ, что ответ дан по манифесту и какой именно» — is now real, no longer a nullable free-text field. Six ingredients:

1. **Schema** (shared migration with GSL-278 per Jira scope — `apps/core/drizzle/0002_manifest_defer.sql`):
   - `questions.applied_by TEXT` (enum by convention: `owner` / `manifest` / `orchestrator` / NULL).
   - `questions.applied_rule_ref TEXT` (e.g. `manifest §2.merge-strategy`).
   - `questions.defer_until TEXT` (lands in the same migration; used by GSL-278 which follows).

   All three columns are additive nullable per R28. The migration file has no leading comments — the runtime migrator's SQL splitter did not tolerate a comment-only chunk before the first `--> statement-breakpoint`. That surfaced on the first `core-smoke` run (integrity + snapshot OK, migration parse fail) and is now documented as a footgun in `drizzle/0002_*.sql`.
2. **Manifest parser** (`apps/core/src/manifest/parser.ts`, new):
   - `parseManifest(source)` — pure function taking a string, returning `{rules[], index, skipped}`.
   - Line format contract: `^-\s+§(\d+)\.([a-z0-9-]+)\s+—\s+.+`. Continuation lines (indented, non-blank, no new bullet) are absorbed into the rule body.
   - Skipped-lines counter: broken `- §` bullets and duplicate rule ids are tallied but NOT thrown. The manifest file is owner-sovereign and may be edited mid-thought; a partial parse is more honest than a hard fail.
   - Canonical rule id shape: `"manifest §N.bullet-key"` — matches the citation `lab-emit decision --rule` expects.
   - `parseManifestFromPath(path)` + `loadManifest(overrideLabDir?)` are the file-reading wrappers used by the endpoint.
3. **Fold updates** (`apps/core/src/indexer/process.ts`):
   - `FoldedQuestion` gains `applied_rule_ref` + `defer_until`; the base and patch loops read/write them additively.
   - `defer_until` follows explicit-clear semantics — a patch with `"defer_until": ""` erases the field on the fold (needed by GSL-278's reopen; harmless for GSL-277).
   - The UPSERT statement now writes all three new columns.
4. **`POST /actions/questions/apply-manifest`** (`apps/core/src/routes/actions.ts`):
   - Body: `{qid, rule_ref, answer?, by?}`. Bearer + serialize + withTimeline + idempotency-key.
   - Guard 1: question must exist + be `open`.
   - Guard 2: `rule_ref` must resolve against the CURRENTLY-parsed manifest (re-read on every call, so an owner edit lands without a restart).
   - Dual-write step 1: `bash lab-emit.sh answer --by manifest --channel manifest --answer <body>`. Provenance travels through the JSONL side too so a tail-indexer re-fold converges to `applied_by='manifest'` even if the direct UPDATE were to fail.
   - Dual-write step 2: `bash lab-emit.sh decision --re <qid> --decision <body> --rule <ref> --by orchestrator` (or `by=owner-web`). Non-fatal — a decision-log hiccup logs a WARN but does NOT roll back the already-answered question. This is what the manifest's preamble asks for (F3-S3 — «Каждое автономное решение обязано цитировать пункт манифеста»).
   - Dual-write step 3: direct UPDATE sets `status='answered', answer_text, answered_at, applied_by='manifest', applied_rule_ref=<canonical id>`.
   - Wakes the in-process `questionNotifier` so the PreToolUse long-poll releases at millisecond scale.
5. **Read routes**:
   - `/questions` and `/bundle` now surface `applied_by`, `applied_rule_ref`, `defer_until`. Same shape via zod on the wire (@gosleep/schema).
   - New `GET /manifest` (Bearer'd) parses the file on every call and returns `{path, bytes, mtime, count, skipped, rules[]}`. The web layer polls it every 5 min so an owner edit shows up in the picker.
6. **Web UI** (`apps/web/src/screens/Questions.tsx`):
   - `ProvenanceBadge` component next to the status chip on every card. Renders `applied by manifest · manifest §N.bullet` (accent tone) or `applied by owner|orchestrator` (ok/neutral). Hover title expands to the rule body when available.
   - New "Apply manifest" button on open questions. Opens a picker dialog (`useManifest()` supplies the rules); radio-selectable list of `{id, body, section_title}` + an optional answer-override textarea (defaults to the rule body). Submits to `POST /actions/questions/apply-manifest` via a new `useApplyManifest` mutation hook.
   - The answered row's Answer box also cites the rule id + body when `applied_by === 'manifest'`.

@gosleep/schema + @gosleep/sdk gained `ManifestRule` / `ManifestResponse` / `ApplyManifestActionInput|Result|Response` + the `applied_by` / `applied_rule_ref` / `defer_until` fields on `QuestionRow`. The SDK method is `client.applyManifestToQuestion(input, idempotencyKey)`.

## Problems solved

- **Migration-file leading comments broke drizzle-orm's SQL splitter.** First pass put a five-line explanation atop `0002_manifest_defer.sql`, before the first `--> statement-breakpoint`. The runtime migrator's `Failed to run the query` error pointed at the comment block. Fixed by moving the explanation into a `-- ` prefix on the ALTER statements' internal comments (drizzle-kit-generated files never carry pre-breakpoint text either — 0000/0001 both start with `CREATE TABLE`). Documented in the migration file itself.
- **`applied_by` was being folded but silently dropped on UPSERT.** The `foldQuestionRecords()` helper already tracked `applied_by` (from a stub landed with earlier work), but the UPSERT statement did not include the column — meaning even a JSONL patch carrying `"applied_by": "manifest"` would not survive a tail sweep. Fixed by extending the UPSERT to write all three new columns.
- **The endpoint's `answer` body vs. the rule body**: the caller may (optionally) override the answer text. Fall back to the rule body when absent — rules like `§2.merge-strategy — regular merge, never squash` are already terse enough to serve as the answer verbatim.
- **JSON serialisation with UTF-8 (§ sigil)** across bash → curl → the endpoint → SQLite → the projection: SQLite treats TEXT columns as BLOBs of bytes, curl passes bytes verbatim, and JSON escaping handles the `§` fine. The tests exercise this end-to-end (`manifest §2.merge-strategy` as an exact string match through /questions).

## Problems remaining

- **Automatic manifest matching on question arrival is deferred.** Jira acceptance names "a question with a manifest match auto-answers within 1 s of arrival" but the manifest's rules are principles, not typed matchers — matching an arbitrary question shape against §2.merge-strategy requires ML-shaped inference. The endpoint + provenance layer make the OWNER path work; the auto-match on arrival is filed as a queue candidate for the learning loop (Ф3). Reversible default: the owner picks the rule via web, provenance is recorded correctly.
- **/manifest fresh-read on every hit** is fine for the tiny file (< 10 KB) but not cache-friendly on 1k+ RPS. A file-mtime cache is trivial to add and can wait until the picker's load is measurable.

## Pitfalls & workarounds

- **The manifest file is OWNER-SOVEREIGN.** The parser reads it, never writes. The endpoint spawns `lab-emit decision --rule <id>` which appends to `docs/lab/decisions/log.jsonl` (append-only, agent-writable); no code path writes to `manifest.md` itself. This is asserted in the parser's module-level comment and in the endpoint's dual-write step 2 comment.
- **Continuation lines vs. new bullets.** Rules span multiple lines in the real manifest (see `§2.merge-strategy` which wraps to a second line). The parser only joins indented (leading-whitespace) continuation lines — a blank line or a new bullet ends the rule. That contract is pinned by a unit test.
- **Duplicate rule ids don't throw.** They increment a `skipped` counter and the LAST occurrence wins (matches typical "diff mid-thought" editing style). The `/manifest` endpoint surfaces `skipped` so the picker can flag "manifest looks inconsistent" if it ever grows above zero.

## What didn't make it

- **Automatic manifest matching on question arrival** — see "Problems remaining".
- **A file-mtime cache on `/manifest`** — deferred until the picker's traffic is measurable.
- **Manifest edit-in-place from the web** — off the table by design (owner-sovereign; the picker is read-only over the file).

## Technical reference

- **Commit:** GSL-277.
- **Files added:**
  - `apps/core/drizzle/0002_manifest_defer.sql`
  - `apps/core/src/manifest/parser.ts`
  - `apps/core/test/manifest.parser.test.ts`
- **Files changed:**
  - `apps/core/drizzle/meta/_journal.json` (idx=2 entry)
  - `apps/core/src/db/schema.ts` (three new nullable TEXT columns on `questions`)
  - `apps/core/src/indexer/process.ts` (fold + UPSERT extended)
  - `apps/core/src/routes/actions.ts` (apply-manifest endpoint + doApplyManifest)
  - `apps/core/src/routes/read.ts` (/manifest endpoint + provenance in /questions and /bundle)
  - `packages/schema/src/index.ts` (ManifestRule/ManifestResponse, ApplyManifest types, AppliedBy enum, provenance fields on QuestionRow)
  - `packages/sdk/src/index.ts` (`applyManifestToQuestion`, `manifest()`)
  - `apps/web/src/data/queries.ts` (`useApplyManifest`, `useManifest`)
  - `apps/web/src/screens/Questions.tsx` (ProvenanceBadge, Apply-manifest button + dialog)
  - `tools/lab/tests/core-smoke.sh` (fixture manifest seed + apply-manifest scenarios 28-33c)
- **Verified by running:**
  - `bun test apps/core/test/manifest.parser.test.ts` — 8 pass.
  - `bash tools/lab/tests/core-smoke.sh` — 46 scenarios pass (including apply-manifest end-to-end + idempotency-replay + DB provenance column check).
  - `bash tools/lab/gate.sh --offline` — green.
  - LIVE PROOF (isolated GOSLEEP_LAB_DIR + GOSLEEP_DB_PATH, real `docs/lab/decisions/manifest.md` copied read-only): fresh question → `POST /actions/questions/apply-manifest {rule_ref: "manifest §2.merge-strategy"}` → DB row `status=answered, applied_by=manifest, applied_rule_ref=manifest §2.merge-strategy` + `/questions` projection surfaces both fields + `decisions/log.jsonl` carries the rule citation. All 5 apply-manifest live-proof assertions pass in `tools/lab/tests/manifest-defer-live-proof.sh`.
- **Sources referenced:** `docs/reports/web-harness-research-2026-08-03/target-architecture-rev3-addendum.md` §Delta 8.2; `docs/reports/web-stack-audit-2026-08-06/coverage.md` §2 R1, §7 G2; `docs/prd/PRD-gosleep-evolution.md` Phase 3.
