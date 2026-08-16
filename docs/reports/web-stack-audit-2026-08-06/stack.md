# Web Control-Plane Stack — Skeptical Audit

**Author:** shift 75 worker `audit-stack` (Sonnet 4.5, high effort)
**Date:** 2026-08-06
**Object under audit:** the target stack for the gosleep interactive web control plane, as decided in `docs/reports/web-harness-research-2026-08-03/target-architecture.md`
**Method:** fresh web research as of today (2026-08-06). For each layer I actively looked for reasons to CHANGE the choice; I confirm only if the evidence holds. No files were touched outside this report. No `git` mutations.
**Deliverable:** per-layer verdict table + risk register + explicit final answer.

Context reminder: this is a **local, single-user, always-on control plane on macOS** that supervises Claude Code agents. Owner quality bar: "world-class harness." One writer process, one browser tab typically, occasional mobile read.

---

## TL;DR — verdict per layer

| # | Layer | Verdict | One-line reason |
|---|---|---|---|
| 1 | **Bun 1.2+ runtime** as long-running daemon under launchd | **KEEP-WITH-CAVEAT** | Correct pick for cold-start / TS / bun:sqlite, but Bun.spawn RSS drifts on long-running processes and Bun's >72h track record is thinner than Node's — mitigate with launchd KeepAlive+ThrottleInterval, daily restart, and RSS watchdog. |
| 2 | **Hono 4.x + streamSSE** | **KEEP** | Right shape for us; Warren's "bare Bun.serve" costs ~800 LOC of infra we don't want to own. Hono streamSSE has known lifecycle sharp edges (infinite-loop pattern, no await-to-finish) — solvable inside our broadcaster. |
| 3 | **Drizzle ORM + drizzle-kit + bun:sqlite** | **KEEP** | 2026 consensus: Drizzle is the safe TypeScript + SQLite pick for Bun. Prisma still lacks first-class bun:sqlite. Kysely leaves migrations to us. |
| 4 | **SQLite WAL, one writer + JSONL tail-indexer during transition** | **KEEP-WITH-CAVEAT** | Correct model; the failure mode is not corruption (WAL protects that), it's *silent divergence* between JSONL truth and the SQLite mirror. Add integrity fences, but no design change. |
| 5 | **SSE for server→client (not WebSocket)** | **KEEP** | Confirmed by industry (WS→NDJSON/SSE migration is now the mainstream story) and by our reference repo Warren's own evolution (Overstory used WS → Warren dropped it). SSE beats NDJSON for us because `EventSource` gives free reconnect + `Last-Event-ID` in the browser. |
| 6 | **React 19 + Vite 6 + shadcn/ui + Tailwind v4 + TanStack Query v5 + react-router v7** | **CHANGE (Vite 6 → Vite 7)** and **KEEP** the rest | Vite 8 is stable since 2026-03 (Rolldown/Oxc), but is the wrong pin *today* for us — Vite 7 is boring, stable, familiar; ship on 7 and revisit 8 in v1.1. Other client libraries are current. |
| 7 | **Touch ID gate from a swiftc CLI binary (LocalAuthentication)** | **KEEP-WITH-CAVEAT** | Confirmed doable without an .app bundle, but **codesigning matters**: unsigned/adhoc-signed binaries hit inconsistent LAContext behavior in Tahoe. Ship the binary ad-hoc-signed with a stable identifier; owner keeps it in `bin/` under a stable path. |
| 8 | **Bearer token in macOS Keychain via `security` CLI** | **CHANGE (add Tahoe-aware fallback + explicit ACL)** | Same class of bug as the gh CLI silent-unauth exists here, **plus** a Tahoe 26.x regression where `security find-generic-password -w` hangs / returns 36 has been documented in the wild. Keep Keychain as primary, **require** explicit ACL binding to `gosleep-core`, and add a plaintext-0600 fallback gated by an explicit owner flag. Never silently degrade auth. |

**Explicit final answer at the end (§10). Short answer: change Vite 6 → 7 and harden the Keychain layer against the Tahoe/`gh`-class silent-unauth bug. Everything else holds.**

---

## 1. Bun 1.2+ as a long-running macOS daemon

**Claim in the target architecture:** Bun 1.2+ runs under launchd, binds `127.0.0.1:7331`, keeps `bun:sqlite` warm, spawns shell CLIs via `Bun.spawn`, and provides `fs.watch` for the JSONL tail-indexer.

**Fresh evidence, August 2026:**

- **Current stable is Bun 1.3.14** (released 2026-05-13); the 1.2 baseline in our doc is fine as a lower bound. Bun 1.3 improved SQLite and `child_process` compat; Wikipedia's Bun page and the Bun v1.3.14 blog confirm SQLite 3.53.0 in Bun's build, though there's an open report (issue #31247) that the bundled SQLite on macOS arm64 shipped 3.43.2 despite the announcement. Downstream this means: check what SQLite `bun:sqlite` reports at boot, log it, don't trust the release note alone.
- **Long-running memory track record is the honest weak spot.** The 2026 "Bun vs Node.js" community writeup states plainly: *"Bun is production-ready for most use cases in 2026, with 1.3 reaching ~98% npm compatibility… the primary caveats are long-running processes (72+ hours) where Node.js's V8 garbage collector is more proven."* Real reports back this up:
  - `oven-sh/bun#18488` — memory leak when streaming responses via `fetch` in Bun ≥ 1.1.27.
  - `oven-sh/bun#18608` — memory leak on file uploads (later versions).
  - `oven-sh/bun#21560` — **RSS in Bun-spawned child processes grows slowly, even when idle** (110 MB → 145 MB drift on Linux over time). Directly relevant to a daemon that spawns `publish.sh`, `lab-emit.sh`, `chronicler.sh` dozens of times per day.
  - `oven-sh/bun#30831` — `child_process.spawn` stdio piping fails with "TODO: stream.Readable stdio" in some paths; matters if we build "spawn X, pipe its stdout to another spawn Y" chains.
- **`fs.watch` on macOS is inherently loose.** Bun uses FSEvents under the hood, but the well-known Node caveats (`nodejs/node#52601` — "not possible to know when fs.watch has started on macOS") apply. For a *tail-indexer over JSONL files that get appended to and rotated daily*, `fs.watch` alone is not safe. The industry answer is a **hybrid: `fs.watch` for wake-up + poll+`stat` fallback every few seconds + read from `ingest_state.last_ingested_offset`**. This is exactly what `apps/core/src/indexer/tail.ts` should do — the design already stores offset per file, so the mitigation is a small addition, not a redesign.
- **launchd fit is good** — `KeepAlive={SuccessfulExit=false}` + `ThrottleInterval=10`, `RunAtLoad=true`, `StandardOutPath` + `StandardErrorPath` to `data/logs/`. The doc mentions `plist/com.gosleep.core.plist`; ensure `ThrottleInterval` is present (Apple's own launchd manpages and the "launchd Tutorial" reference call this out as a hard requirement — without it a crashing daemon takes down the login session).

**Is there any argument left for Node 22/24 LTS?** Honest answer:
- Pro-Node: >72h stability, `worker_threads` maturity, better memory profiling toolchain (V8 heapsnapshot / clinic.js), zero risk of shipping `bun:sqlite` version drift.
- Pro-Bun: native `bun:sqlite` (no compilation step), TypeScript-first (no ts-node/tsx), `bun build --compile` for a future single-binary, Warren precedent.
- **Net: Bun still wins for us.** But we should treat it as a supervised process, not a set-and-forget daemon. Concrete mitigation:
  - launchd auto-restart is already the plan.
  - **Add a nightly self-restart** at 04:00 local via a cron-style `bun run selfrestart` or a second launchd job — pre-emptive against slow RSS drift. This is standard practice for many production Node servers too.
  - **Prometheus-style `/metrics` endpoint (Warren has one)** exposing `process.memoryUsage().rss` so we can plot drift over weeks. Warren already ships this — copy the shape.
  - Emergency escape: the architecture doc already has `apps/core` as one Bun-workspace package. If Bun becomes untenable, porting to Node 24 LTS is a rewrite of `serve.ts` (Bun.serve → Hono's Node adapter, which Hono supports natively) and `bun:sqlite` → `better-sqlite3`. Both are 1-3 day migrations, not a rewrite.

**Verdict: KEEP-WITH-CAVEAT.**

**Evidence:**
- Bun v1.3 → v1.3.14 stability discussion — https://tech-insider.org/bun-vs-nodejs-2026/
- `oven-sh/bun#18488` streaming fetch memory leak — https://github.com/oven-sh/bun/issues/18488
- `oven-sh/bun#21560` Bun.spawn RSS drift — https://github.com/oven-sh/bun/issues/21560
- `nodejs/node#52601` macOS fs.watch semantics — https://github.com/nodejs/node/issues/52601
- launchd KeepAlive+ThrottleInterval guidance — https://www.launchd.info/
- Bun 1.3.14 SQLite version drift — https://github.com/oven-sh/bun/issues/31247

---

## 2. Hono 4.x + streamSSE

**Claim:** Hono is the standard 2026 Bun HTTP framework; `streamSSE` gives us server-push out of the box.

**Fresh evidence:**

- Hono 4.x remains the de-facto standard TypeScript HTTP framework (~38 M weekly npm downloads per the ecosystem writeups); the target architecture correctly notes the tradeoff vs. Warren's bare `Bun.serve` (Warren pays ~800 LOC of router + idempotency + bridge code for architectural purity; we don't want to).
- **However**, `streamSSE` has a well-documented lifecycle wart in the Hono issue tracker:
  - `honojs/hono#2050` — "streams immediately close the connection unless `sleep` is used" — the callback resolves too early → stream closes before events flush.
  - `honojs/hono#2319` — "streamSSE not working" — same root cause.
  - `honojs/hono#3540` — "IncompleteRead(0 bytes read, 2 more expected)" — a client-visible flavor of the same problem.
  - `honojs/hono#2993` — "stream should not be closed automatically" — the `finally` clause always closes the stream, so the *event loop inside the handler must never return before the client disconnects*.
- **Answer-Overflow / Discord threads** flag that middleware collecting HTTP timings returns immediately (before the stream completes), so **request-duration metrics per SSE connection are undefined by default**.

**What this means for us:** the target architecture's `sse/broadcaster.ts` cannot use a naive `for await` over events. It has to:
1. Keep the outer async function **blocked** for the life of the client connection (Promise that resolves only on disconnect).
2. Push events into the writer from an `EventEmitter` listener; unsubscribe in a `finally` that fires **only** when the writer detects a closed stream.
3. Emit a heartbeat comment (`: ping\n\n`) every 15-30 s so mid-boxes don't kill the connection and so we can detect a dead peer.
4. Track "in-flight connections" and cap per-client concurrency (already noted in Warren's `stream-limits.ts` — copy that shape).

None of this is a stack change; it's a broadcaster-level defensive pattern. Time cost: ~half a day. **Documenting it here so the implementer doesn't hit these three issues one-by-one in production.**

**Backpressure:** Hono forwards to the runtime's native `ReadableStream` backpressure. On Bun.serve, backpressure honestly works — the writer's `write()` returns a promise that resolves when the buffer drains. But naive `stream.writeSSE({...})` in a tight loop will *not* await drain; wrap in a `writeSSE + await stream.drain-equivalent` (or use `stream.sleep(0)` after each burst).

**Verdict: KEEP.** Hono is the right choice; the streamSSE sharp edges are known, small, and solvable at the broadcaster layer.

**Evidence:**
- `honojs/hono#2050` — https://github.com/honojs/hono/issues/2050
- `honojs/hono#2319` — https://github.com/honojs/hono/issues/2319
- `honojs/hono#3540` — https://github.com/honojs/hono/issues/3540
- `honojs/hono#2993` — https://github.com/honojs/hono/issues/2993
- Hono streaming docs — https://hono.dev/docs/helpers/streaming

---

## 3. Drizzle + drizzle-kit + bun:sqlite

**Claim:** Drizzle beats Prisma and Kysely for our shape.

**Fresh evidence (2026 comparisons):**

- Multiple mid-2026 writeups agree on the same verdict for the Bun+SQLite corner:
  - Prisma still lacks first-class `bun:sqlite` support; you can bolt it on through `@prisma/adapter-driver-adapters` but it isn't the paved path.
  - Drizzle has native `bun:sqlite` support, ~50 KB bundle vs. Prisma's ~500 KB+, and no separate Rust engine cold-start cost.
  - Kysely is a query builder, not an ORM, and does not include a migration generator — you'd assemble that yourself.
- Drizzle 1.0 is out and stable; drizzle-kit's `.sql` migrations + `snapshot.json` + `_journal.json` in git is the reproducibility story the target architecture wants (§4.2 already captures this correctly).
- **Migration pitfalls** worth flagging even though we keep the choice:
  - drizzle-kit forward-only; reverse migrations by hand (industry standard — Prisma & Rails are the same).
  - `snapshot.json` diffs can be noisy when unrelated schema files re-render — commit them explicitly, review before push.
  - SQLite `ALTER TABLE` is limited (no drop column pre-3.35, limited constraint changes) — drizzle-kit's fallback is "recreate table + copy," which is safe for us (one writer, small tables) but slow if events grows large. Batch large migrations behind a maintenance window.

- **Community 2026 verdict** (per the "Drizzle ORM v1 vs Prisma 6 vs Kysely 2026" and the "Drizzle vs Prisma 10x Faster Queries" pieces): Drizzle is the SQL-first Bun-native choice; Prisma remains the "big org, big Postgres" choice; Kysely is for teams that want raw query control without ORM abstractions.

- **Warren the reference uses Drizzle** — confirmed live from `drizzle.config.sqlite.ts` in the repo. We are on the same path they are.

**Verdict: KEEP.**

**Evidence:**
- Drizzle vs Prisma 2026 comparison — https://makerkit.dev/blog/tutorials/drizzle-vs-prisma
- Drizzle vs Prisma vs Kysely 2026 — https://pikvue.com/drizzle-vs-prisma-vs-kysely-2026-best-typescript-orm-compared/
- Drizzle ORM v1 vs Prisma 6 vs Kysely 2026 — https://www.pkgpulse.com/guides/drizzle-orm-v1-vs-prisma-6-vs-kysely-2026
- Warren live repo confirms Drizzle + SQLite/Postgres — https://github.com/jayminwest/warren

---

## 4. SQLite WAL — one writer + tail-indexer over JSONL

**Claim:** SQLite in WAL mode, `gosleep-core` is the single writer, and during the transition an in-process tail-indexer mirrors JSONL append events from `tools/lab/*.sh` into the SQLite tables. `sqlite3 .backup` for atomic snapshots.

**Fresh evidence:**

- **SQLite WAL corruption reality:** the canonical https://www.sqlite.org/howtocorrupt.html doc still applies — the biggest risk categories are (1) two writers via *distinct connections* stepping on the WAL, (2) opening the DB across an NFS/network mount, (3) killing the process during a checkpoint. Our design avoids all three (single writer, local disk, atomic `.backup` at snapshot time).
- **The 2026 "SQLite Concurrent Writes: WAL Mode and Lock Handling" writeup** confirms: WAL allows concurrent readers with one writer, and it correctly returns `SQLITE_BUSY` if a second writer sneaks in. Our tail-indexer runs *in the same process* as the HTTP writer, so there is exactly one process holding the DB — the safest topology.
- **The subtle risk in our design is not corruption; it's divergence.** During shifts 3-8 of the migration, `tools/lab/lab-log.sh` is still the *primary writer* to `docs/lab/events/*.jsonl`, and the tail-indexer mirrors those appends into SQLite. If the indexer lags, or if a file rotates on UTC-midnight and the tail closes at the wrong offset, we get:
  - Client shows an older event than the JSONL contains (visible-through-render_bundle vs. visible-through-HTTP).
  - Deduplication assumes `uq_events_ingested` catches replays, but if the indexer restarts from a stale `ingest_state.last_ingested_offset` and the file was truncated (edge case), we silently drop events.
- **Concrete mitigation, already partially in the doc:**
  - Store `last_sha256_prefix` of the first 4 KB of each file in `ingest_state` (already in schema). On mismatch → auto-rebuild.
  - **Add**: at every SIGHUP or nightly restart, run an "invariant check": for each JSONL file `<= yesterday`, count rows and compare to `SELECT COUNT(*) FROM events WHERE ingested_from LIKE 'jsonl:<file>%'`. Alert on mismatch. This is a 30-line health check; it's the difference between "we detect divergence in an hour" and "we detect it three weeks later when someone re-reads an old day."
  - Keep the transition period **short**. Every extra week of dual-write is another week when a `lab-log.sh` bug can write a malformed JSONL line that the indexer can't parse.
- **Pattern reference:** the OpenAI Codex `state_5.sqlite` corruption case (`openai/codex#21750`) shows the mature failure-mode response: quarantine the DB with a timestamp suffix, retry open, let migrations rebuild the schema, re-import from JSONL. Our design already supports this via `scripts/import-jsonl.ts` — worth wiring `scripts/quarantine-and-rebuild.ts` as a supported recovery command from day one.

**Verdict: KEEP-WITH-CAVEAT** — no design change, but add the divergence health check + the quarantine-and-rebuild script.

**Evidence:**
- SQLite How To Corrupt — https://www.sqlite.org/howtocorrupt.html
- SQLite in Production: WAL / concurrency — https://micrologics.org/blog/sqlite-in-production-optimizing-wal-mode-concurrency-and-vfs-layers-for-low-latency-app-servers
- 2026 SQLite Concurrent Writes writeup — https://adhdecode.com/articles/sqlite/sqlite-concurrent-writes-locking/
- Codex `state_5.sqlite` corruption case — https://github.com/openai/codex/issues/21750

---

## 5. SSE vs. WebSocket for this workload

**Claim:** Server → client via SSE `GET /events?since=seq` with `Last-Event-ID` + `event: rotate`; client → server via ordinary POST. Explicitly not WebSocket.

**Fresh evidence:**

- The 2026 "SSE vs WebSockets" ecosystem writeups (Ably, RxDB, WebSocket.org, DEV community, Timeplus) reach a clear consensus:
  - WebSocket wins for **bidirectional low-latency** apps (chat, editors, games).
  - SSE wins for **server-push over HTTP** — automatic reconnection built into `EventSource`, transparent to proxies and firewalls, no upgrade handshake, no sticky-session requirement, ~3 ms latency delta vs. WebSocket which is invisible for our workload.
  - The Ably piece explicitly frames the choice as "SSE is the simpler default; use WebSocket only when the bidirectional traffic is a first-class requirement."
- **The reference-repo evolution is the strongest external signal:** Overstory (WebSocket) → Warren (NDJSON over HTTP). The same author consciously downgraded from WS. That's a two-project vote from the person who best knows this problem shape.
- **Why SSE beats NDJSON for us** (the target architecture makes this choice, but I want to confirm it):
  - `EventSource` in the browser gives us **automatic reconnect + `Last-Event-ID` header** for free. NDJSON requires us to write our own reconnect loop in the client, and Warren does (`bridges.ts` + `bridge-reconnect.ts`).
  - SSE has a **named event type** (`event: rotate`) which cleanly models our UTC-day rotation. NDJSON forces us to encode event type in the payload.
  - Named events map naturally to TanStack Query `invalidateQueries` calls (see §6 below).
  - `text/event-stream` is a real MIME type with framing; NDJSON is convention-only.
- **The one honest downside of SSE:** browsers cap the number of concurrent SSE connections per origin at 6 (HTTP/1.1). We use one connection per browser tab — non-issue for our single-owner setup. If the owner ever opens 7 tabs simultaneously, the 7th blocks. Trivial mitigation: HTTP/2 (Bun.serve supports it) lifts this cap.
- **Client → server via POST**: correct. Any argument for WS's bidirectional path is defeated by the fact that our client-initiated actions are rare, imperative, and benefit from HTTP semantics (idempotency-key headers, retry, no framing questions).

**Verdict: KEEP.** SSE is the right choice, and the SSE-over-NDJSON reasoning is stronger than the target architecture spells out (browser-native reconnect + named events + Last-Event-ID come for free).

**Evidence:**
- Ably SSE vs WebSocket 2026 — https://ably.com/blog/websockets-vs-sse
- WebSocket.org WS vs SSE — https://websocket.org/comparisons/sse/
- RxDB comparative — https://rxdb.info/articles/websockets-sse-polling-webrtc-webtransport.html
- Warren live repo (NDJSON) — https://github.com/jayminwest/warren

---

## 6. Client currency: Vite 6 pin, React 19, Tailwind v4 + shadcn, TanStack Query v5

**Claim:** React 19 + Vite 6 + shadcn/ui + Tailwind v4 + TanStack Query v5 + react-router v7 + Recharts + Framer Motion + lucide-react.

**Fresh evidence:**

- **Vite:** Vite 7 became stable in mid-2025, Vite 8 became stable **2026-03-12** with Rolldown/Oxc replacing esbuild/Rollup. Latest stable is 8.0.9 (2026-04-20). Vite 8 has real breaking changes:
  - Node.js 20.19+ or 22.12+ required
  - `build.rollupOptions` renamed to `build.rolldownOptions`
  - `@vitejs/plugin-react` v6 uses Oxc, removes Babel from default path
  - CJS interop changes are the most common runtime breakage
  - The Vite team itself recommends the **two-step migration** (Vite 6 → 7 with `rolldown-vite` package → 8) for larger projects.
  - **Recommendation for us: pin Vite 7, not Vite 6, not Vite 8.** Vite 6 is 2 majors stale (unnecessary tech debt on day 1). Vite 8's Rolldown transition can leak into shadcn's build path and add churn we don't need on a v1. Vite 7 is boring and stable — that's what we want for a v1 that hasn't been running yet.
- **React:** stable is 19.2.6 (2026-05-06). No React 20. React 19 pin is correct.
- **Tailwind v4 + shadcn/ui:** shadcn's official docs at ui.shadcn.com/docs/tailwind-v4 confirm full v4 support. shadcn CLI initializes v4 projects directly. `@theme` directive, OKLCH colors, data-slot attributes — all landed and stable. **Confirmed KEEP.**
- **TanStack Query v5:** current, mature, `invalidateQueries` is the standard API. The clean pattern to pair with SSE:
  ```ts
  const es = new EventSource('/events');
  es.addEventListener('question.opened', () => queryClient.invalidateQueries({ queryKey: ['questions'] }));
  es.addEventListener('rotate', () => queryClient.invalidateQueries()); // full refresh at UTC midnight
  ```
  This is the pattern the ecosystem has settled on; no argument for changing.
- **react-router v7, Recharts (target says 3.8 — same major as Warren), Framer Motion, lucide-react:** all current mainstream, no red flags in 2026 writeups.
- **`Geist Sans/Mono`:** Vercel's Geist is now the default "developer-tools" typeface (Linear, Vercel, Mastra Studio, warp.dev). Aligns with owner's stated aesthetic (`ui-style-mastra-supabase.md`). Consider adding **Geist Mono** as the code-viewer font specifically for `timeline`, `events`, `diff` panels.

**Verdict: CHANGE Vite 6 → Vite 7.** Everything else: **KEEP.**

**Evidence:**
- Vite 8 announcement — https://vite.dev/blog/announcing-vite8
- Vite 7 migration & Vite 8 migration guides — https://vite.dev/guide/migration
- shadcn/ui Tailwind v4 docs — https://ui.shadcn.com/docs/tailwind-v4
- Tailwind v4 shadcn migration writeup — https://www.buildmvpfast.com/blog/tailwind-v4-shadcn-ui-migration-breaking-changes-guide-2026
- Vite 8 + Rolldown breakdown — https://www.pagespeedfix.com/blog/vite-8-rolldown-react-performance/
- TanStack Query v5 invalidation docs — https://tanstack.com/query/v5/docs/framework/react/guides/query-invalidation

---

## 7. Touch ID from a server-spawned swiftc binary (LocalAuthentication)

**Claim:** `bin/touchid-gate` compiled with `swiftc -framework LocalAuthentication -framework Security`, invoked from `publish.ts` inside `withTimeline`. Fallback to TTY confirmation if there's no biometric sensor.

**Fresh evidence:**

- **The pattern works.** The existing `keychain-fingerprint` project on GitHub (dss99911) is exactly this: Swift CLI compiled with LocalAuthentication, LAContext + `evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)`, returns exit code on user gesture. Multiple 2026 tutorials confirm the compile line: `swiftc -o touchid-gate main.swift -framework LocalAuthentication -framework Security` — that's it, no Xcode project required.
- **The gotcha is code signing.** An unsigned or ad-hoc-signed binary can succeed on the developer's own machine but Apple hardens Tahoe (macOS 26.x) around biometric-gated non-app processes. What has been reported:
  - Consumers of `LAContext.evaluatePolicy` from a non-.app binary see the biometric prompt render normally when the binary is Apple-Developer-signed or Developer-ID-signed.
  - Ad-hoc-signed CLI binaries can render the prompt but sometimes fail with `LAError.notInteractive` under nested-shell contexts (which is exactly what our `spawn` from Bun would be). Reports are inconsistent — no single canonical bug — but the *reliable* answer is: **sign the binary**.
  - No `Info.plist`, `usage description string`, or entitlements are required for LocalAuthentication itself in a non-Sandbox context.
- **Owner's Mac state:** unless the owner has an Apple Developer ID cert available, we ship the binary **ad-hoc-signed at build time**:
  ```
  swiftc -o bin/touchid-gate touchid-gate.swift -framework LocalAuthentication -framework Security
  codesign --sign - --identifier com.gosleep.touchid-gate --options=runtime bin/touchid-gate
  ```
  Then verify with `codesign -dv bin/touchid-gate` on install. If the owner has Developer ID: sign with it instead — much more robust.
- **The reliable fallback path:** the target architecture correctly names TTY-confirm as fallback (§7.3 variant 4). Key subtlety: write to `/dev/tty` of *the owner's login session*, not the daemon's controlling tty (which under launchd is `/dev/null`). Practically: `TERM_PROGRAM_TTY=$(who am i | awk '{print $2}')` at daemon-start time, cached, or the owner sets `GOSLEEP_OWNER_TTY=/dev/ttys002` explicitly. The Teleport RFD 0054 "passwordless-macos" is an example of how the same team hardened a similar CLI biometric flow.

**Verdict: KEEP-WITH-CAVEAT** — the design is correct; add the codesigning step to the install script so the biometric prompt is reliable on Tahoe.

**Evidence:**
- `keychain-fingerprint` reference — https://github.com/dss99911/keychain-fingerprint
- HackingWithSwift LAContext tutorial — https://www.hackingwithswift.com/read/28/4/touch-to-activate-touch-id-face-id-and-localauthentication
- Advanced Swift Face ID / Touch ID — https://www.advancedswift.com/face-id-touch-id-swift/
- Teleport passwordless-macos RFD 0054 — https://github.com/gravitational/teleport/blob/master/rfd/0054-passwordless-macos.md

---

## 8. Bearer token in macOS Keychain via `security` CLI

**Claim:** Token in Keychain under `gosleep.web-token`, retrieved via `security find-generic-password -w`, ACL-bound to the `gosleep-core` binary; TTY fallback if Keychain is not present.

**Fresh evidence — this is the layer that most needs hardening:**

- **The exact bug pattern from `gh` exists here.** `cli/cli#13317` — "`gh api` silently sends unauthenticated requests when keychain access fails." The chain:
  1. `gh`'s 3-second keychain-lookup timeout expires (macOS keychain agent slow to unlock).
  2. `gh` treats the failure as "no token" instead of "auth error."
  3. Requests go out with **no `Authorization` header**.
  4. On the wire, the server returns 401 → user sees "session expired" — silent auth downgrade.
  We must **never** treat "Keychain read failed" as "no token"; it's "auth failure, abort request."
- **Tahoe 26.x specific regression:** the "macOS Tahoe Broke Keychain CLI Reads" writeup on dev.to describes a live Tahoe 26.x behavior where `security find-generic-password -w` **hangs indefinitely** or returns exit code 36 (`errSecInteractionNotAllowed`). This appears to be a SecurityAgent integration regression in Tahoe; works fine on Sequoia 15.x. If the owner is on Tahoe (2026-08 is post-Tahoe GA), this bites us.
- **Another supporting data point:** `google-antigravity/antigravity-cli#85` — "agy continuously prompts for login on macOS due to a 1-second timeout in `keyringAuth`" — same class of bug, different tool. Short timeouts + async keychain unlock = silent failure.
- **ACL binding matters.** The 2026 Silverfort blog "Skipping the lock: a Claude Code CLI weakness lets any macOS process read stored credentials" describes what happens when a CLI creates a Keychain item **without passing access-control arguments**: the item inherits the *default* Keychain ACL, which — for items created without `SecAccessControl` — grants access to whichever process created it, but does not resist any process running under the same UID that goes through the standard Security APIs. This is exactly the owner's threat model (agent under the same UID must not be able to publish).
  **Fix:** when writing the token, use `security add-generic-password -T <path/to/gosleep-core>` **only** — this restricts the ACL to that one binary. Any other process (agent, curl, another Bun) hitting `security find-generic-password` triggers a Keychain-agent UI prompt. Combined with the Touch ID gate on high-blast actions, this is a real second barrier — not a theoretical one.
- **Concrete design change I propose:**

  1. **On install/setup**, provision the token with strict ACL:
     ```
     security add-generic-password \
       -a "$USER" -s gosleep.web-token \
       -w "$(openssl rand -hex 32)" \
       -T "$HOME/Library/gosleep-core/bin/gosleep-core" \
       -U
     ```
  2. **On read**, timeout with hard failure — never silently proceed:
     ```
     token=$(gtimeout 5 security find-generic-password -a "$USER" -s gosleep.web-token -w) \
       || die "keychain read failed — cannot serve requests without auth"
     ```
     (`gtimeout` = GNU coreutils; ship as an install dependency or use `perl -e 'alarm 5; exec @ARGV'` fallback.)
  3. **Tahoe-detection at boot**: `sw_vers -productVersion | awk -F. '{ if ($1>=26) print "tahoe" }'` → on Tahoe, log a WARN with a link to a known-issues page and *require* the operator to acknowledge with a one-time env var `GOSLEEP_TAHOE_KEYCHAIN_ACK=1`. This forces the operator to check whether the regression bit them before we start silently degrading.
  4. **Fallback path — explicit, not silent.** If the operator explicitly sets `GOSLEEP_TOKEN_PATH=/path/to/token`, read from a 0600 file. Never fall back to a plaintext file *silently* on Keychain failure. This is the exact defense against the `gh` class of bug.
  5. **Log every auth-source decision** to the daemon log: `auth: source=keychain read_ms=42 token_id=…` on every startup. Auditability for the owner.

**Verdict: CHANGE — add explicit Tahoe-aware fallback + strict ACL + hard-fail on read timeout.** The design should hold, but the target-architecture text as written could produce a `gh`-class silent-unauth in the field.

**Evidence:**
- `cli/cli#13317` gh silent unauth — https://github.com/cli/cli/issues/13317
- macOS Tahoe keychain CLI regression — https://dev.to/euda1mon1a/macos-tahoe-broke-keychain-cli-reads-novel-findings-from-an-ai-agent-deployment-2p3o
- `antigravity-cli#85` similar bug pattern — https://github.com/google-antigravity/antigravity-cli/issues/85
- Silverfort — Claude Code CLI weakness — https://www.silverfort.com/blog/skipping-the-lock-a-claude-code-cli-weakness-lets-any-macos-process-read-stored-credentials/
- Apple developer forums on Keychain ACL — https://developer.apple.com/forums/thread/116579

---

## 9. Reference-check — Warren, AutoSK, and the harness landscape

### 9.1. Warren (jayminwest/warren) — live repo confirmation

Fetched today (2026-08-06):

| Aspect | Live repo (README + code paths) | Our target-architecture text | Verdict |
|---|---|---|---|
| Runtime | Bun (1.1+) | Bun 1.2+ | ✓ our pin is a step up |
| HTTP | **Bare `Bun.serve` :8080** with hand-rolled router (`src/server/router.ts`, `handlers/*.ts`) | "Not Hono (as Warren)" | ✓ correctly quoted |
| ORM | **Drizzle** (`drizzle.config.sqlite.ts`, `drizzle.config.postgres.ts`) | "Drizzle, same as Warren" | ✓ correctly quoted |
| Storage | SQLite (`/data/warren.db`) default; Postgres optional | "Warren on SQLite, our decision same" | ✓ |
| Realtime | **NDJSON over HTTP**, `GET /runs/:id/events?follow=1`; `bridges.ts` + `bridge-reconnect.ts` for client-side | "Warren uses NDJSON, we use SSE" | ✓ correctly quoted; our SSE choice is a *deliberate divergence*, not a mis-quote |
| Client | React + Vite + shadcn (versions not pinned in README; source of the "React 18 + Vite 6 + Tailwind v4" claim in our target-architecture is Warren's `src/ui/package.json` snapshot from the 2026-08-03 findings — I did not re-verify per-file today but the shape holds) | "React 19 + Vite 6 + shadcn + Tailwind v4 + TanStack Query 5 + Recharts + react-router 7" | ⚠️ **Warren currently uses React 18, not 19** — we're moving one major ahead. Fine for us (React 19 is stable), just note it. |
| Auth | Single bearer `WARREN_API_TOKEN` env-var (no Keychain, no biometrics) | "Bearer from Keychain + Touch ID + TTY fallback" | ✓ Our layered auth is a clear step *above* Warren for a multi-agent single-UID host |
| Auditing | Pino structured JSON, Prometheus `/metrics`, `X-Request-ID` correlation | Pino to `data/logs/`; no metrics endpoint spec'd | 💡 **Missing in our design**: add `/metrics` endpoint. Cheap and matches Warren's shape. |

**Mis-quotes vs. Warren:** none material. The one to be aware of: Warren's UI React major is 18, not 19. Our React 19 pin remains fine but is a light divergence.

**One extra learning:** Warren ships `src/server/idempotency.ts` and a dedicated `runs.dispatch-idempotency.test.ts`. Our target architecture mentions idempotency but doesn't spec the header. **Recommend:** `Idempotency-Key: <uuid>` on all state-changing POSTs, TTL 24 h, dedup on `.artifacts/web/idempotency.jsonl` — spec this explicitly.

### 9.2. AutoSK / autoskd (wierdbytes/autosk)

Web search for "autosk 2026 architecture stack unix socket" returned no live repo hits *for me* today, only tangential daemon references. This does not disprove `findings/autosk-warren-ui.md` — that finding was drawn from a live repo read on 2026-08-03, three days ago — but it does say that **the repo's public discoverability is thin** and that our reference-repo dependency on autosk is fragile. Nothing to change; noting for awareness.

The findings note: JSON-RPC over Unix-socket, Bun/TypeScript autoskd, TUI+GUI+iOS-webview as thin clients, PKCE OAuth via `pi` for Claude subscription. Our design does not depend on autoskd at runtime — it's a shape reference — so the fragility is limited.

### 9.3. Harness landscape — 6 comparable OSS control planes

I scanned the 2026 landscape writeups (Augment Code, agentsroom.dev, nimbalyst.com) for **server + realtime choices** among coding-agent control planes.

| Product | Server model | Realtime transport | Storage | Anything that contradicts our stack? |
|---|---|---|---|---|
| **OpenHands** | Python (FastAPI, uvicorn), self-hostable up to Kubernetes | WebSocket + REST | Postgres / SQLite backend | Different stack (Python), no direct contradiction; they use WS because they're multi-user browser-front. |
| **vibe-kanban** | TS (Node) + web UI, kanban board | Polling + WS | SQLite | No contradiction; project's future is uncertain (Bloop shutdown 2026-01, community-maintained since). |
| **omnara** | Mobile-first "steer from phone"; API + phone client | Push notifications + HTTPS | Cloud | Different target (mobile-primary); not comparable directly. |
| **claudecodeui** | Node + React browser UI over Claude Code CLI | WebSocket | Filesystem-first | Uses WS for CLI ↔ browser; single-user local; **shape closest to ours**. Their WS choice is because they proxy raw stdio; SSE doesn't fit that shape. Our shape is different (structured events), so SSE remains the right pick. |
| **conductor.build** | Local Mac orchestrator, GUI | Not fully documented in public writeups | Local | Local Mac orchestrator; validates local-first path but no visible tech-stack red flags. |
| **happy** | Not commonly written up; couldn't find a canonical live source in 2026 writeups | — | — | Insufficient signal. |

**Cross-cutting signal:** the choice of realtime transport is driven by *what the control plane pushes*. Products that pipe raw stdio (claudecodeui, OpenHands terminal panes) go WS. Products that push **structured events** (Warren, our design, the industry trend the SSE writeups describe) go SSE / NDJSON. Our target workload is structured events → SSE is right.

**Nothing found in the 2026 landscape contradicts the target stack.** The one "hmm" is that WS is more common in multi-user browser harnesses (OpenHands, claudecodeui) because they need bidirectional stdio; our single-user + structured-events shape places us cleanly in the SSE-friendly quadrant.

**Evidence:**
- 9 Open-Source Agent Orchestrators — https://www.augmentcode.com/tools/open-source-agent-orchestrators
- 2026 multi-agent coding tools — https://agentsroom.dev/blog/best-multi-agent-coding-tools
- awesome-agent-orchestrators — https://github.com/andyrewlee/awesome-agent-orchestrators

---

## 10. Explicit final answer: would you change any layer?

**Yes — two changes, one addition, and several caveats. Everything else holds.**

### Change 1 (client): Vite 6 → **Vite 7**

Vite 6 is 2 majors stale on 2026-08-06 (7.3.0 stable Dec 2025, 8.0.9 stable Apr 2026). Pin to Vite 7 for v1: mature, boring, familiar bundler (esbuild + Rollup). Postpone Vite 8's Rolldown transition to v1.1 — the Rolldown-shaped churn is not worth carrying on a v1 that's still finding its shape.

**Cost:** one line change in `apps/web/package.json`. Two lines in `docs/reports/web-harness-research-2026-08-03/target-architecture.md` (§1 table + §6).

### Change 2 (security): Keychain layer — **explicit ACL + hard-fail read + Tahoe-aware fallback**

The target text as written could reproduce the `cli/cli#13317` silent-unauth bug and the Tahoe 26.x `security -w` hang. Specifically:

1. Provision with `security add-generic-password -T <gosleep-core-path>` (ACL bound to our binary).
2. Read with a 5-second `gtimeout` — hard-fail on timeout or Keychain error, never proceed unauthenticated.
3. On macOS 26.x (Tahoe) at boot, WARN loudly and require `GOSLEEP_TAHOE_KEYCHAIN_ACK=1` to proceed — the operator must confirm they know about the regression.
4. Add explicit `GOSLEEP_TOKEN_PATH=/path/to/token-file` fallback for environments where Keychain is unavailable. Never fall back silently.
5. Log the auth source, ACL binding, and read latency at startup.

**Cost:** one small module `src/security/keychain.ts` (100-150 lines), one install-script change, three lines of `sw_vers`-check.

### Addition (observability): `/metrics` endpoint (Prometheus exposition)

Warren has one; it costs almost nothing and gives us `process.memoryUsage().rss`, per-endpoint request counts, active SSE connections, indexer lag (jsonl-tail offset vs. file EOF). This is how we catch Bun's slow RSS drift before it becomes a launchd-restart cascade. Add to the target architecture spec.

### Caveats to fold into the target text (no design change, just implementation notes)

- **Bun daemon:** ThrottleInterval in the launchd plist. Nightly self-restart at 04:00 local. Log `bun:sqlite`'s reported SQLite version at boot (drift is a known thing).
- **Hono streamSSE:** the broadcaster must never let its outer async return before the client disconnects; heartbeat every 15-30 s.
- **Indexer:** `fs.watch` + poll fallback; daily invariant check counting JSONL lines vs. `SELECT COUNT(*) FROM events WHERE ingested_from LIKE 'jsonl:<file>%'`.
- **Touch ID binary:** ad-hoc codesign at build time (`codesign --sign - --identifier com.gosleep.touchid-gate`), verify at install.
- **Idempotency-Key header:** spec explicitly in `packages/schema`.

### What NOT to change

- **Bun as runtime** — right choice; supervise it, don't move to Node LTS.
- **Hono 4.x** — right choice; the sharp edges are in the broadcaster, not the framework.
- **Drizzle + drizzle-kit + bun:sqlite** — 2026 consensus lands here for our shape.
- **SQLite WAL + one writer** — right topology.
- **SSE for server→client, POST for client→server** — right transport. Do not add WebSocket.
- **React 19 + shadcn/ui + Tailwind v4 + TanStack Query v5 + react-router v7** — all current, all correct.
- **Monorepo Bun-workspaces, `apps/core`+`apps/web`+`packages/schema`+`packages/sdk`** — right layout.
- **Touch ID gate + TTY fallback** — right barrier; the caveat is in the codesigning, not the concept.

---

## 11. Risk register (top risks, severity × mitigation)

| # | Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|---|
| R1 | **Silent auth downgrade** from Keychain read failure (gh-class bug) | **High** — attacker can call `/actions/skills/publish` unauthenticated in a specific fault window | Medium (Tahoe regression is live) | Change 2 above: hard-fail on read timeout, explicit fallback, per-boot audit line. |
| R2 | **Tahoe `security -w` hang** blocking daemon startup | High — daemon never comes up on Tahoe | Medium (Tahoe GA is late 2025/early 2026) | Detect Tahoe at boot, warn + require `GOSLEEP_TAHOE_KEYCHAIN_ACK=1`, timebox the read call. |
| R3 | **Bun RSS drift** in a 24×7 daemon spawning child processes | Medium — user-visible memory pressure over weeks | Medium (documented in `oven-sh/bun#21560`) | launchd nightly restart at 04:00 local; `/metrics` RSS gauge; smoke-check RSS < 512 MB daily. |
| R4 | **Hono streamSSE early close** if broadcaster resolves too early | Medium — clients see "connection closed" immediately | Medium (well-known Hono gotcha) | Broadcaster returns a Promise that resolves only on stream close; heartbeat every 15-30 s; e2e test that reads for 60 s. |
| R5 | **JSONL ↔ SQLite divergence** during transition (indexer stale offset, file truncation) | Medium — user sees old data on some views, new on others | Low if we act; Medium if we don't | Daily invariant count check + auto-rebuild path; `uq_events_ingested` catches most replays already. |
| R6 | **Touch ID unreliability** on ad-hoc-signed CLI in Tahoe nested-shell contexts | Medium — user hits `LAError.notInteractive` and cannot publish | Low-Medium | Codesign the binary properly at build time; fallback to TTY confirm is already spec'd; document Developer-ID-cert path for owners who have one. |
| R7 | **Vite 8 (Rolldown) breaking changes** if we upgrade mid-v1 | Low if we pin Vite 7 now; Medium if we impulsively go to Vite 8 | Low (mitigated by choice) | Pin Vite 7 now (Change 1); revisit Vite 8 in v1.1 with a proper migration issue. |
| R8 | **`bun:sqlite` SQLite version drift** on arm64 (`oven-sh/bun#31247`) | Low — mostly latent, could bite CHECK constraint semantics | Low | Log `sqlite_version()` at boot; smoke asserts the expected minimum. |
| R9 | **`fs.watch` missed event** for a JSONL rotation at UTC-midnight | Low — recoverable via poll fallback | Medium (known macOS quirk) | Poll+`stat` fallback every 3 s; `event: rotate` on the SSE channel triggers full client refresh anyway. |
| R10 | **Warren's non-adoption of Hono** could indicate the author knows something we don't | Low — the ~800 LOC of Warren's server infra reads more like *chose austerity*, not *chose against Hono* | Low | Continue with Hono; if a specific Hono limitation bites us mid-build, port to bare `Bun.serve` is a 2-3 day refactor. |

---

## 12. What was NOT audited (out of scope, called out for honesty)

- Hono middleware for CORS and rate-limiting — these are trivial and can be reviewed at implementation time.
- Precise `launchd` plist contents — need to be finalized during the plist-writing task; today I only checked the shape (`KeepAlive`, `ThrottleInterval`).
- Precise Prometheus metrics names — should follow Warren's shape (`http_requests_total`, `http_request_duration_seconds`, `sse_active_connections`, `indexer_lag_bytes`) but not spec'd here.
- `packages/schema` zod v4 vs. v3 delta — worth a quick check when implementing; not audited today.
- Exact `snapshot.sh` schedule and retention policy for `data/snapshots/` — the target text says 30 days daily; that seems right, not audited further.

---

## 13. Bottom line

The 2026-08-03 target architecture is **fundamentally sound**. The stack decisions were made deliberately and hold up to fresh scrutiny. Two changes are worth making now — **Vite 7 instead of Vite 6**, and **Keychain layer hardened against the gh-class silent-unauth bug + Tahoe regression** — plus one addition (a `/metrics` endpoint copied from Warren's shape). The rest of the caveats are implementation notes, not stack changes.

I would ship this stack, with the two changes and the caveats above, and expect it to reach v1.0 without a fundamental rework of any layer.

---

## Sources cited (consolidated)

**Runtime & daemon (§1):**
- Bun 1.3 stability writeup: https://tech-insider.org/bun-vs-nodejs-2026/
- `oven-sh/bun#18488`: https://github.com/oven-sh/bun/issues/18488
- `oven-sh/bun#21560`: https://github.com/oven-sh/bun/issues/21560
- `oven-sh/bun#30831`: https://github.com/oven-sh/bun/issues/30831
- `oven-sh/bun#31247`: https://github.com/oven-sh/bun/issues/31247
- `nodejs/node#52601`: https://github.com/nodejs/node/issues/52601
- launchd tutorial: https://www.launchd.info/

**Hono streamSSE (§2):**
- `honojs/hono#2050`: https://github.com/honojs/hono/issues/2050
- `honojs/hono#2319`: https://github.com/honojs/hono/issues/2319
- `honojs/hono#2993`: https://github.com/honojs/hono/issues/2993
- `honojs/hono#3540`: https://github.com/honojs/hono/issues/3540
- Hono streaming docs: https://hono.dev/docs/helpers/streaming

**Drizzle + bun:sqlite (§3):**
- Drizzle vs Prisma 2026: https://makerkit.dev/blog/tutorials/drizzle-vs-prisma
- Drizzle vs Prisma vs Kysely 2026: https://pikvue.com/drizzle-vs-prisma-vs-kysely-2026-best-typescript-orm-compared/
- Drizzle ORM v1 vs Prisma 6 vs Kysely 2026: https://www.pkgpulse.com/guides/drizzle-orm-v1-vs-prisma-6-vs-kysely-2026

**SQLite WAL (§4):**
- SQLite How To Corrupt: https://www.sqlite.org/howtocorrupt.html
- SQLite in Production (Micrologics): https://micrologics.org/blog/sqlite-in-production-optimizing-wal-mode-concurrency-and-vfs-layers-for-low-latency-app-servers
- SQLite concurrent writes 2026 (ADHDecode): https://adhdecode.com/articles/sqlite/sqlite-concurrent-writes-locking/
- Codex `state_5.sqlite` corruption case: https://github.com/openai/codex/issues/21750

**SSE vs WebSocket (§5):**
- Ably 2026: https://ably.com/blog/websockets-vs-sse
- WebSocket.org WS vs SSE: https://websocket.org/comparisons/sse/
- RxDB comparative: https://rxdb.info/articles/websockets-sse-polling-webrtc-webtransport.html
- Getstream WS vs SSE: https://getstream.io/blog/websocket-sse/

**Client currency (§6):**
- Vite 8 announcement: https://vite.dev/blog/announcing-vite8
- Vite migration guide: https://vite.dev/guide/migration
- Vite 8 + Rolldown for React: https://www.pagespeedfix.com/blog/vite-8-rolldown-react-performance/
- shadcn Tailwind v4 docs: https://ui.shadcn.com/docs/tailwind-v4
- Tailwind v4 shadcn migration guide 2026: https://www.buildmvpfast.com/blog/tailwind-v4-shadcn-ui-migration-breaking-changes-guide-2026
- TanStack Query v5 invalidation: https://tanstack.com/query/v5/docs/framework/react/guides/query-invalidation

**Touch ID from CLI (§7):**
- keychain-fingerprint reference: https://github.com/dss99911/keychain-fingerprint
- HackingWithSwift LAContext: https://www.hackingwithswift.com/read/28/4/touch-to-activate-touch-id-face-id-and-localauthentication
- Advanced Swift Face ID/Touch ID: https://www.advancedswift.com/face-id-touch-id-swift/
- Teleport RFD 0054 passwordless-macos: https://github.com/gravitational/teleport/blob/master/rfd/0054-passwordless-macos.md

**Keychain `security` CLI (§8):**
- `cli/cli#13317` gh silent-unauth: https://github.com/cli/cli/issues/13317
- Tahoe Keychain regression writeup: https://dev.to/euda1mon1a/macos-tahoe-broke-keychain-cli-reads-novel-findings-from-an-ai-agent-deployment-2p3o
- `google-antigravity/antigravity-cli#85`: https://github.com/google-antigravity/antigravity-cli/issues/85
- Silverfort: Claude Code CLI weakness: https://www.silverfort.com/blog/skipping-the-lock-a-claude-code-cli-weakness-lets-any-macos-process-read-stored-credentials/
- Apple developer forums (Keychain ACL): https://developer.apple.com/forums/thread/116579

**Reference repos (§9):**
- Warren live: https://github.com/jayminwest/warren
- 9 Open-Source Agent Orchestrators 2026: https://www.augmentcode.com/tools/open-source-agent-orchestrators
- Best multi-agent coding tools 2026: https://agentsroom.dev/blog/best-multi-agent-coding-tools
- awesome-agent-orchestrators: https://github.com/andyrewlee/awesome-agent-orchestrators
