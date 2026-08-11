// GSL-321 — unit tests for the transcript-derived model reader.
//
// Run 06 finding #3: Fleet showed `todo-workspace-47` as `claude-fable-5` (the value in
// `~/.claude/settings.json`) even though the session was launched with `claude --model
// haiku` and 62 assistant turns in the transcript were `claude-haiku-4-5-20251001`. These
// tests pin the new `resolveTranscriptModel` reader (transcript-first, latest assistant
// turn wins) and the `modelCache.get(session_id, cwd)` composition (transcript wins over
// settings hierarchy, null falls back to settings, and null of both = null → "unknown"
// in the panel).

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  modelCache,
  readTranscriptModelState,
  resolveTranscriptModel,
} from "../src/adapter/model-resolver.ts";

const SESSION_ID = "abcd-1234-5678-9999";
const CWD = "/tmp/gsl321-project";
const HOME = "/tmp/gsl321-home";
const TRANSCRIPT = "/tmp/gsl321-home/.claude/projects/x/session.jsonl";

function fakeFsList(files: Array<{ path: string; modified_at_epoch_ms: number }>) {
  return () => files;
}

function fakeRead(map: Record<string, string | null>) {
  return (p: string) => (p in map ? map[p] : null);
}

describe("resolveTranscriptModel (GSL-321)", () => {
  test("returns null for an empty session id", () => {
    expect(
      resolveTranscriptModel("", {
        listTranscripts: () => [],
        readFile: () => null,
      }),
    ).toBeNull();
  });

  test("returns null when the transcript listing is empty", () => {
    expect(
      resolveTranscriptModel(SESSION_ID, {
        listTranscripts: () => [],
        readFile: () => null,
      }),
    ).toBeNull();
  });

  test("extracts the model from a single assistant turn", () => {
    const raw = [
      '{"type":"user","message":{"content":"hi"}}',
      '{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"hey"}]}}',
    ].join("\n");
    const m = resolveTranscriptModel(SESSION_ID, {
      listTranscripts: fakeFsList([{ path: TRANSCRIPT, modified_at_epoch_ms: 1 }]),
      readFile: fakeRead({ [TRANSCRIPT]: raw }),
    });
    expect(m).toBe("claude-haiku-4-5-20251001");
  });

  test("returns the LATEST assistant turn's model (walks backwards)", () => {
    // Run 06 example: a session that started on haiku might have subagent turns as sonnet;
    // we want the LATEST model, which is what the next turn will use.
    const raw = [
      '{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001"}}',
      '{"type":"user","message":{"content":"ok"}}',
      '{"type":"assistant","message":{"model":"claude-sonnet-5-latest"}}',
    ].join("\n");
    const m = resolveTranscriptModel(SESSION_ID, {
      listTranscripts: fakeFsList([{ path: TRANSCRIPT, modified_at_epoch_ms: 1 }]),
      readFile: fakeRead({ [TRANSCRIPT]: raw }),
    });
    expect(m).toBe("claude-sonnet-5-latest");
  });

  test("prefers the newest transcript file when a session has multiple", () => {
    const older = "/tmp/gsl321-older.jsonl";
    const newer = "/tmp/gsl321-newer.jsonl";
    const m = resolveTranscriptModel(SESSION_ID, {
      listTranscripts: fakeFsList([
        { path: older, modified_at_epoch_ms: 100 },
        { path: newer, modified_at_epoch_ms: 200 },
      ]),
      readFile: fakeRead({
        [older]: '{"type":"assistant","message":{"model":"OLD-MODEL"}}',
        [newer]: '{"type":"assistant","message":{"model":"NEW-MODEL"}}',
      }),
    });
    expect(m).toBe("NEW-MODEL");
  });

  test("returns null when no assistant turn has landed yet", () => {
    // A very fresh session — user turn logged, but the assistant has not responded.
    const raw = '{"type":"user","message":{"content":"hi"}}';
    const m = resolveTranscriptModel(SESSION_ID, {
      listTranscripts: fakeFsList([{ path: TRANSCRIPT, modified_at_epoch_ms: 1 }]),
      readFile: fakeRead({ [TRANSCRIPT]: raw }),
    });
    expect(m).toBeNull();
  });

  test("survives a malformed JSONL line and keeps scanning", () => {
    const raw = [
      "not-json-at-all-!!!",
      '{"type":"assistant","message":{"model":"claude-haiku-4-5"}}',
    ].join("\n");
    const m = resolveTranscriptModel(SESSION_ID, {
      listTranscripts: fakeFsList([{ path: TRANSCRIPT, modified_at_epoch_ms: 1 }]),
      readFile: fakeRead({ [TRANSCRIPT]: raw }),
    });
    expect(m).toBe("claude-haiku-4-5");
  });

  test("ignores an assistant row that omits message.model", () => {
    const raw = [
      '{"type":"assistant","message":{"content":[{"type":"text"}]}}',
      '{"type":"assistant","message":{"model":"claude-real"}}',
    ].join("\n");
    const m = resolveTranscriptModel(SESSION_ID, {
      listTranscripts: fakeFsList([{ path: TRANSCRIPT, modified_at_epoch_ms: 1 }]),
      readFile: fakeRead({ [TRANSCRIPT]: raw }),
    });
    expect(m).toBe("claude-real");
  });
});

// GSL-321 boot-window race follow-up (run 07 finding). Direct coverage of the discriminated
// return: `found` when an assistant line is present, `starting` when a transcript file
// exists but no assistant line has landed yet (session mid-first-turn), `absent` when no
// transcript file matches the session_id at all.
describe("readTranscriptModelState (GSL-321 boot-window race)", () => {
  test("empty session id → absent", () => {
    expect(
      readTranscriptModelState("", {
        listTranscripts: () => [],
        readFile: () => null,
      }),
    ).toEqual({ kind: "absent" });
  });

  test("empty listing → absent", () => {
    expect(
      readTranscriptModelState(SESSION_ID, {
        listTranscripts: () => [],
        readFile: () => null,
      }),
    ).toEqual({ kind: "absent" });
  });

  test("transcript exists with an assistant line → found", () => {
    const raw = '{"type":"assistant","message":{"model":"claude-real"}}';
    expect(
      readTranscriptModelState(SESSION_ID, {
        listTranscripts: fakeFsList([{ path: TRANSCRIPT, modified_at_epoch_ms: 1 }]),
        readFile: fakeRead({ [TRANSCRIPT]: raw }),
      }),
    ).toEqual({ kind: "found", model: "claude-real" });
  });

  test("transcript exists but no assistant line yet → starting", () => {
    // Boot window — user turn was journaled but the first assistant response has not landed.
    const raw = '{"type":"user","message":{"content":"hi"}}';
    expect(
      readTranscriptModelState(SESSION_ID, {
        listTranscripts: fakeFsList([{ path: TRANSCRIPT, modified_at_epoch_ms: 1 }]),
        readFile: fakeRead({ [TRANSCRIPT]: raw }),
      }),
    ).toEqual({ kind: "starting" });
  });

  test("transcript file listed but unreadable → starting (NOT absent, NOT found)", () => {
    // A rotate/permission race: the listing saw the file but the reader returned null. The
    // session IS journaled; we treat this as `starting` so modelCache does not silently
    // fabricate a settings-hierarchy value.
    expect(
      readTranscriptModelState(SESSION_ID, {
        listTranscripts: fakeFsList([{ path: TRANSCRIPT, modified_at_epoch_ms: 1 }]),
        readFile: () => null,
      }),
    ).toEqual({ kind: "starting" });
  });
});

describe("modelCache composition — transcript-first, settings fallback (GSL-321)", () => {
  test("transcript hit wins over settings hierarchy", () => {
    modelCache.startTick();
    const settingsPath = join(HOME, ".claude", "settings.json");
    const m = modelCache.get(SESSION_ID, CWD, {
      home: HOME,
      listTranscripts: fakeFsList([{ path: TRANSCRIPT, modified_at_epoch_ms: 1 }]),
      readFile: fakeRead({
        [TRANSCRIPT]: '{"type":"assistant","message":{"model":"claude-haiku-4-5"}}',
        [settingsPath]: JSON.stringify({ model: "claude-fable-5" }),
      }),
    });
    expect(m).toBe("claude-haiku-4-5");
  });

  test("falls back to settings when the transcript has no assistant turn yet", () => {
    modelCache.startTick();
    const settingsPath = join(HOME, ".claude", "settings.json");
    const m = modelCache.get(SESSION_ID, CWD, {
      home: HOME,
      // Empty transcript listing → transcript reader returns null → settings resolver runs.
      listTranscripts: fakeFsList([]),
      readFile: fakeRead({
        [settingsPath]: JSON.stringify({ model: "claude-fable-5" }),
      }),
    });
    expect(m).toBe("claude-fable-5");
  });

  test("returns null when both sources fail (Fleet renders 'unknown')", () => {
    modelCache.startTick();
    const m = modelCache.get(SESSION_ID, CWD, {
      home: HOME,
      listTranscripts: fakeFsList([]),
      readFile: fakeRead({}),
    });
    expect(m).toBeNull();
  });

  // GSL-321 boot-window race follow-up (run 07 finding). Precedence bug: when a transcript
  // file EXISTED for a delegated `claude --model sonnet` session but no assistant line had
  // landed yet, the resolver fell through to the global settings hierarchy and reported the
  // shared default (e.g. "claude-fable-5[1m]") for the first several seconds. That violates
  // GSL-321's own design intent ("show 'unknown' rather than a wrong-but-confident value").
  // The fix distinguishes three states in the transcript reader — `found` / `starting` /
  // `absent` — and reserves the settings fallback for `absent` only.
  test("boot-window race: transcript exists but no assistant line yet → null, NOT settings fallback", () => {
    modelCache.startTick();
    const settingsPath = join(HOME, ".claude", "settings.json");
    const m = modelCache.get(SESSION_ID, CWD, {
      home: HOME,
      // Transcript file EXISTS (session_id is journaled) but the file contains only a user
      // turn — the first assistant response has not yet been written.
      listTranscripts: fakeFsList([{ path: TRANSCRIPT, modified_at_epoch_ms: 1 }]),
      readFile: fakeRead({
        [TRANSCRIPT]: '{"type":"user","message":{"content":"hi"}}',
        // The GLOBAL default is "wrong-but-confident" fable-5. Settings-fallback here would
        // reproduce the bug — the delegated `--model sonnet` session must NOT show fable-5.
        [settingsPath]: JSON.stringify({ model: "claude-fable-5" }),
      }),
    });
    expect(m).toBeNull();
  });

  test("boot-window race: empty transcript file (session just spawned) → null, NOT settings fallback", () => {
    modelCache.startTick();
    const settingsPath = join(HOME, ".claude", "settings.json");
    const m = modelCache.get(SESSION_ID, CWD, {
      home: HOME,
      listTranscripts: fakeFsList([{ path: TRANSCRIPT, modified_at_epoch_ms: 1 }]),
      readFile: fakeRead({
        [TRANSCRIPT]: "",
        [settingsPath]: JSON.stringify({ model: "claude-fable-5" }),
      }),
    });
    expect(m).toBeNull();
  });

  test("boot-window race: unreadable transcript file → null, NOT settings fallback", () => {
    // A transcript file matched the session_id in the listing, but the reader returned null
    // (permission error, race with rotation, etc). The session IS journaled, so settings-
    // fallback would still fabricate; safer to show "unknown".
    modelCache.startTick();
    const settingsPath = join(HOME, ".claude", "settings.json");
    const m = modelCache.get(SESSION_ID, CWD, {
      home: HOME,
      listTranscripts: fakeFsList([{ path: TRANSCRIPT, modified_at_epoch_ms: 1 }]),
      readFile: fakeRead({
        // TRANSCRIPT not in the map → fakeRead returns null → treated as unreadable.
        [settingsPath]: JSON.stringify({ model: "claude-fable-5" }),
      }),
    });
    expect(m).toBeNull();
  });

  test("cache key includes session_id — two sessions in the same cwd resolve independently", () => {
    modelCache.startTick();
    const t1 = "/tmp/gsl321-s1.jsonl";
    const t2 = "/tmp/gsl321-s2.jsonl";
    const opts1 = {
      home: HOME,
      listTranscripts: (sid: string) =>
        sid === "S1" ? [{ path: t1, modified_at_epoch_ms: 1 }] : [],
      readFile: fakeRead({
        [t1]: '{"type":"assistant","message":{"model":"model-for-s1"}}',
      }),
    };
    const opts2 = {
      home: HOME,
      listTranscripts: (sid: string) =>
        sid === "S2" ? [{ path: t2, modified_at_epoch_ms: 1 }] : [],
      readFile: fakeRead({
        [t2]: '{"type":"assistant","message":{"model":"model-for-s2"}}',
      }),
    };
    const m1 = modelCache.get("S1", CWD, opts1);
    const m2 = modelCache.get("S2", CWD, opts2);
    expect(m1).toBe("model-for-s1");
    expect(m2).toBe("model-for-s2");
  });
});

// GSL-331 (run 09 finding #6 — follow-up on GSL-321/325). GSL-325 fixed the "transcript
// exists but no assistant line yet" boot-window case (`starting`), but a fresh CLI session's
// transcript FILE is ABSENT for the first several seconds until Claude Code flushes its
// first assistant turn to disk. Under the pre-GSL-331 rule that meant `absent` →
// settings-hierarchy fallback → fabricated wrong-but-confident label (e.g. "Fable 5[1m]"
// for a delegated `claude --model sonnet` session). This suite pins the boot-window grace
// period: absent + fresh session ⇒ null (Fleet renders "unknown"), absent + old session ⇒
// settings fallback (unchanged pre-GSL-331 behavior).
describe("modelCache boot-window grace period (GSL-331)", () => {
  const NOW_MS = 1_800_000_000_000; // stable "now" so age arithmetic is deterministic.
  const clock = () => NOW_MS;

  test("absent transcript + fresh session (< 60 s old) → null, NOT settings fallback", () => {
    modelCache.startTick();
    const settingsPath = join(HOME, ".claude", "settings.json");
    const m = modelCache.get(SESSION_ID, CWD, {
      home: HOME,
      // No transcript file at all matches this session_id — the state the pre-GSL-331 code
      // classified as `absent` and fell back on.
      listTranscripts: fakeFsList([]),
      readFile: fakeRead({
        // Global settings default WOULD be returned by the fallback if we let it run — but
        // the session was launched with `--model sonnet`, so this label is a lie.
        [settingsPath]: JSON.stringify({ model: "claude-fable-5" }),
      }),
      startedAtEpochMs: NOW_MS - 5_000, // 5 s ago — well inside the default 60 s grace.
      now: clock,
    });
    expect(m).toBeNull();
  });

  test("absent transcript + old session (>= 60 s old) → settings fallback (pre-GSL-331 behavior)", () => {
    // Older sessions with a truly missing transcript are unlikely to be boot-window artefacts
    // — the settings hierarchy is the best guess we have. Preserved so a long-lived session
    // that never wrote a transcript (misconfigured provider, weird env) still gets a value.
    modelCache.startTick();
    const settingsPath = join(HOME, ".claude", "settings.json");
    const m = modelCache.get(SESSION_ID, CWD, {
      home: HOME,
      listTranscripts: fakeFsList([]),
      readFile: fakeRead({
        [settingsPath]: JSON.stringify({ model: "claude-fable-5" }),
      }),
      startedAtEpochMs: NOW_MS - 120_000, // 120 s ago — outside the 60 s window.
      now: clock,
    });
    expect(m).toBe("claude-fable-5");
  });

  test("absent transcript + no startedAtEpochMs → settings fallback (opt-in guard)", () => {
    // A caller that hasn't been updated to pass startedAtEpochMs must behave like the
    // pre-GSL-331 code — the grace period is opt-in. Keeps all pre-existing unit tests
    // valid without a bulk rewrite.
    modelCache.startTick();
    const settingsPath = join(HOME, ".claude", "settings.json");
    const m = modelCache.get(SESSION_ID, CWD, {
      home: HOME,
      listTranscripts: fakeFsList([]),
      readFile: fakeRead({
        [settingsPath]: JSON.stringify({ model: "claude-fable-5" }),
      }),
    });
    expect(m).toBe("claude-fable-5");
  });

  test("absent transcript + fresh session + explicit bootGraceMs override", () => {
    // Shrink the grace to 100 ms to exercise the boundary without waiting real seconds.
    modelCache.startTick();
    const settingsPath = join(HOME, ".claude", "settings.json");
    const inGrace = modelCache.get(SESSION_ID, CWD, {
      home: HOME,
      listTranscripts: fakeFsList([]),
      readFile: fakeRead({ [settingsPath]: JSON.stringify({ model: "claude-fable-5" }) }),
      startedAtEpochMs: NOW_MS - 50,
      bootGraceMs: 100,
      now: clock,
    });
    expect(inGrace).toBeNull();

    modelCache.startTick(); // fresh tick so the cache doesn't return the null we just set.
    const past = modelCache.get(SESSION_ID, CWD, {
      home: HOME,
      listTranscripts: fakeFsList([]),
      readFile: fakeRead({ [settingsPath]: JSON.stringify({ model: "claude-fable-5" }) }),
      startedAtEpochMs: NOW_MS - 200,
      bootGraceMs: 100,
      now: clock,
    });
    expect(past).toBe("claude-fable-5");
  });

  test("transcript FOUND wins even during the boot window (--model sonnet + assistant line already landed)", () => {
    // A session that DID land an assistant turn quickly should still resolve to the honest
    // per-session model; the grace period only affects the ABSENT branch.
    modelCache.startTick();
    const settingsPath = join(HOME, ".claude", "settings.json");
    const m = modelCache.get(SESSION_ID, CWD, {
      home: HOME,
      listTranscripts: fakeFsList([{ path: TRANSCRIPT, modified_at_epoch_ms: 1 }]),
      readFile: fakeRead({
        [TRANSCRIPT]: '{"type":"assistant","message":{"model":"claude-sonnet-5"}}',
        [settingsPath]: JSON.stringify({ model: "claude-fable-5" }),
      }),
      startedAtEpochMs: NOW_MS - 3_000,
      now: clock,
    });
    expect(m).toBe("claude-sonnet-5");
  });

  test("clock skew (startedAtEpochMs in the future) does not enable settings fallback prematurely", () => {
    // If somehow the roster's started_at drifts ahead of our clock (odd but not impossible
    // across launchd restarts / NTP corrections), we still treat the session as fresh and
    // skip the settings fallback. Belt-and-braces safety: the grace path also treats negative
    // age as "in grace" so we never fabricate a wrong-but-confident label on a skewed clock.
    modelCache.startTick();
    const settingsPath = join(HOME, ".claude", "settings.json");
    const m = modelCache.get(SESSION_ID, CWD, {
      home: HOME,
      listTranscripts: fakeFsList([]),
      readFile: fakeRead({ [settingsPath]: JSON.stringify({ model: "claude-fable-5" }) }),
      startedAtEpochMs: NOW_MS + 30_000, // "started 30 s in the future"
      now: clock,
    });
    // Design choice: unknown is safer than fabricated. If age is negative we still return
    // null — the settings fallback would otherwise mislabel a delegated session.
    expect(m).toBeNull();
  });
});
