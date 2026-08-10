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
