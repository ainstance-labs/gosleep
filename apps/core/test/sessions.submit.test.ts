// @gosleep/core — task-submission executor unit tests (GSL-380, observer mode phase C).
//
// Pins down the executor's contract for both preview and submit paths without ever
// shelling out to a real tmux (a stub `spawn` fn stands in). What the tests cover:
//
//   Body validation:
//     1. empty body rejected
//     2. body over 16 KB rejected (per R16.7)
//     3. body with a sub-0x20 non-Tab-non-Newline byte rejected (per R16 Q5)
//     4. body with Tab / Newline / multibyte UTF-8 accepted
//     5. trailing whitespace stripped, inner content preserved
//
//   Secret-shape scan:
//     6. AWS AKIA-prefixed string flagged
//     7. Anthropic sk-ant- prefix flagged
//     8. clean body yields no warnings
//
//   Prompt-boundary heuristic:
//     9. bash / zsh / claude / sh treated as prompt
//    10. unknown command treated as busy
//
//   Preview guards:
//    11. session-not-controlled → refusal (409, session-not-controlled)
//    12. shim-not-registered → refusal (409, shim-not-registered)
//    13. controlled + shim + valid body → preview with sha, byte-length, warnings, target
//
//   Executor path:
//    14. released_mid_submit — session flipped to observer between preview and confirm
//    15. pane_gone — pane_ref resolves to null at dispatch
//    16. not_at_prompt — framing='prompt-boundary' waits and times out
//    17. send_failed — tmux send-keys (body) returns non-zero
//    18. send_failed — tmux send-keys (Enter) fails after body already landed
//    19. delivered — happy path: two invocations, first is -l body, second is Enter
//    20. framing='none' — skips prompt-boundary wait
//    21. Body is never taken from request state — pane_ref resolves live via tmux_panes
//
// All 21 tests run against an in-memory scratch DB seeded per test. The `spawn` injection
// captures every argv array so we can assert the exact `tmux send-keys -t <ref> -l <body>`
// + `tmux send-keys -t <ref> Enter` shape (R16.9 no widening).

import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import * as schema from "../src/db/schema.ts";
import type { OpenedDb } from "../src/db/client.ts";
import type { SpawnResult } from "../src/actions/spawn.ts";
import {
  MAX_BODY_BYTES,
  PROMPT_BOUNDARY_WAIT_MS,
  commLooksLikeClaude,
  computeBodySha256,
  descendantCommsFromPsOutput,
  isPaneAtPrompt,
  isVersionShapedCommand,
  normaliseAndValidateBody,
  paneQualifiesAsPrompt,
  previewSubmission,
  resolvePaneRef,
  scanForSecretShapes,
  submitTask,
  waitForPromptBoundary,
} from "../src/sessions/submit.ts";

function bootScratchDb(): OpenedDb {
  const raw = new Database(":memory:");
  raw.exec("PRAGMA journal_mode = MEMORY;");
  raw.exec(`CREATE TABLE session_control (
    session_id TEXT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'observer',
    source TEXT NOT NULL DEFAULT 'runtime',
    activated_at TEXT,
    activated_by TEXT,
    deactivated_at TEXT,
    shim_registered INTEGER NOT NULL DEFAULT 0,
    last_heartbeat_at TEXT,
    last_heartbeat_pid INTEGER
  );`);
  raw.exec(`CREATE TABLE agent_sessions (
    session_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    pid INTEGER,
    model TEXT,
    cwd TEXT NOT NULL,
    cycle INTEGER,
    context_pct INTEGER,
    current_tool TEXT,
    current_intent TEXT,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    ended_at TEXT,
    last_pr_url TEXT,
    last_pr_at TEXT,
    project_slug TEXT,
    cwd_project_root TEXT,
    observed_only INTEGER NOT NULL DEFAULT 0
  );`);
  raw.exec(`CREATE TABLE tmux_panes (
    pane_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    session_name TEXT NOT NULL,
    window_id TEXT NOT NULL,
    pane_pid INTEGER NOT NULL,
    pane_current_path TEXT,
    pane_current_command TEXT,
    pane_title TEXT,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    misses INTEGER NOT NULL DEFAULT 0
  );`);
  const db = drizzle(raw, { schema });
  return { db, raw, path: ":memory:" };
}

/** Seed one controlled session pointing at one pane whose `pane_current_path` matches
 *  the session's `cwd_project_root`. The heuristic JOIN in resolvePaneRef fires. */
function seedControlledSessionAndPane(
  opened: OpenedDb,
  overrides: {
    session_id?: string;
    pane_id?: string;
    pane_current_command?: string | null;
    pane_current_path?: string | null;
    cwd_project_root?: string;
    shim_registered?: boolean;
    state?: "observer" | "controlled";
  } = {},
): { session_id: string; pane_id: string; pane_ref: string } {
  const session_id = overrides.session_id ?? "sess-1";
  const pane_id = overrides.pane_id ?? "%42";
  const cwd_project_root = overrides.cwd_project_root ?? "/repo/proj";
  const pane_current_path = overrides.pane_current_path === undefined
    ? cwd_project_root
    : overrides.pane_current_path;
  const pane_current_command =
    overrides.pane_current_command === undefined
      ? "bash"
      : overrides.pane_current_command;
  const shim = (overrides.shim_registered ?? true) ? 1 : 0;
  const state = overrides.state ?? "controlled";

  opened.raw
    .query(
      `INSERT INTO session_control (session_id, state, source, shim_registered, activated_at, activated_by)
       VALUES (?, ?, 'runtime', ?, '2026-08-16T00:00:00Z', 'owner-web')`,
    )
    .run(session_id, state, shim);
  opened.raw
    .query(
      `INSERT INTO agent_sessions (session_id, name, kind, cwd, cwd_project_root,
                                   status, started_at, updated_at)
       VALUES (?, ?, 'interactive', ?, ?, 'idle',
               '2026-08-16T00:00:00Z', '2026-08-16T00:00:00Z')`,
    )
    .run(session_id, `sess-name`, cwd_project_root, cwd_project_root);
  opened.raw
    .query(
      `INSERT INTO tmux_panes (pane_id, session_id, session_name, window_id, pane_pid,
                               pane_current_path, pane_current_command, pane_title,
                               first_seen, last_seen, misses)
       VALUES (?, 'tmux-1', 'gsl378-target', '@1', 9999,
               ?, ?, 'bash', '2026-08-16T00:00:00Z', '2026-08-16T00:00:00Z', 0)`,
    )
    .run(pane_id, pane_current_path, pane_current_command);
  return {
    session_id,
    pane_id,
    pane_ref: `gsl378-target:@1.${pane_id}`,
  };
}

function okSpawn(): SpawnResult {
  return { ok: true, code: 0, stdout: "", stderr: "", timedOut: false, elapsedMs: 5 };
}
function failSpawn(stderr: string): SpawnResult {
  return { ok: false, code: 1, stdout: "", stderr, timedOut: false, elapsedMs: 5 };
}

let opened: OpenedDb;
beforeEach(() => {
  opened = bootScratchDb();
});

describe("normaliseAndValidateBody — R16.7 + Q5", () => {
  test("empty body rejected", () => {
    const r = normaliseAndValidateBody("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("empty");
  });
  test("whitespace-only body rejected after trim", () => {
    const r = normaliseAndValidateBody("   \n   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("empty");
  });
  test("body over 16 KB rejected", () => {
    const r = normaliseAndValidateBody("x".repeat(MAX_BODY_BYTES + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("16384");
  });
  test("sub-0x20 non-Tab-non-Newline byte rejected", () => {
    const r = normaliseAndValidateBody("hello\x07world");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("U+0007");
  });
  test("DEL (0x7f) byte rejected", () => {
    const r = normaliseAndValidateBody("hello\x7fworld");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("U+007f");
  });
  test("body with Tab / Newline / multibyte UTF-8 accepted", () => {
    const body = "hello\tworld\nПривет 🌍";
    const r = normaliseAndValidateBody(body);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body).toBe(body);
  });
  test("trailing whitespace stripped, inner content preserved", () => {
    const r = normaliseAndValidateBody("hello\n  \n");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body).toBe("hello");
  });
});

describe("scanForSecretShapes — R16 Risk 3 (advisory)", () => {
  test("AWS AKIA-prefixed string flagged", () => {
    const w = scanForSecretShapes("token=AKIAIOSFODNN7EXAMPLE");
    expect(w.some((x) => x.code === "aws-access-key-id")).toBe(true);
  });
  test("Anthropic sk-ant- prefix flagged", () => {
    const w = scanForSecretShapes("Authorization: Bearer sk-ant-api03-abcdefghij1234567890");
    expect(w.some((x) => x.code === "anthropic-api-key")).toBe(true);
  });
  test("clean body yields no warnings", () => {
    const w = scanForSecretShapes("run the migration and open a PR");
    expect(w).toEqual([]);
  });
});

describe("isPaneAtPrompt — R16 Risk 1 heuristic", () => {
  test("bash / zsh / claude / sh treated as prompt", () => {
    for (const cmd of ["bash", "zsh", "claude", "sh", "fish"]) {
      expect(isPaneAtPrompt(cmd)).toBe(true);
    }
  });
  test("unknown command treated as busy", () => {
    for (const cmd of ["python", "vim", "less", "make", null, "", "  "]) {
      expect(isPaneAtPrompt(cmd)).toBe(false);
    }
  });
  test("node / bun treated as BUSY (verifier m3)", () => {
    // A Claude Code session spawns a `node` (or `bun`) subprocess to run a tool
    // and tmux reports that leaf command while the tool is still executing.
    // Landing a submission at that instant interleaves the body with tool output.
    // The safer default is "busy" — the prompt-boundary framing should keep
    // waiting until the leaf command is back to a real shell (or the claude CLI).
    for (const cmd of ["node", "bun", "NODE", "Bun", " node "]) {
      expect(isPaneAtPrompt(cmd)).toBe(false);
    }
  });
  test("version-shaped command alone is NOT enough — sync predicate stays strict (GSL-390)", () => {
    // Regression fence for E2E run-01 finding #2. A pane whose command reports as
    // "2.1.233" or "v2.1.233" must not be silently promoted to "at prompt" by the
    // pure-string sync predicate — the disambiguation happens in
    // paneQualifiesAsPrompt with a process-tree probe. Otherwise ANY tool that
    // happens to rename itself to a version string would be treated as claude.
    for (const cmd of ["2.1.233", "v2.1.233", "1.2", "1.0.0"]) {
      expect(isPaneAtPrompt(cmd)).toBe(false);
    }
  });
});

describe("isVersionShapedCommand — GSL-390 Claude Code 2.1.x pane_current_command", () => {
  test("matches semver-shape tags Claude Code renames itself to", () => {
    for (const cmd of [
      "2.1.233",
      "v2.1.233",
      "1.2",
      "1.0.0",
      "1.2.3.4",
      "2.1.233+build.5",
      "2.1.233-rc1",
    ]) {
      expect(isVersionShapedCommand(cmd)).toBe(true);
    }
  });
  test("rejects everything else (real commands + empty)", () => {
    for (const cmd of ["bash", "claude", "python", "node", "vim", "", null]) {
      expect(isVersionShapedCommand(cmd)).toBe(false);
    }
  });
});

describe("commLooksLikeClaude — GSL-390 process-tree comm match", () => {
  test("plain 'claude' comm accepted", () => {
    expect(commLooksLikeClaude("claude")).toBe(true);
  });
  test("path-with-basename accepted", () => {
    expect(commLooksLikeClaude("/usr/local/bin/claude")).toBe(true);
  });
  test("versioned / suffixed claude accepted", () => {
    expect(commLooksLikeClaude("claude-2.1.233")).toBe(true);
    expect(commLooksLikeClaude("claude helper")).toBe(true);
  });
  test("random comm rejected — no bare 'claude' substring match", () => {
    for (const c of ["", "bash", "python", "clangd", "claudeless"]) {
      expect(commLooksLikeClaude(c)).toBe(false);
    }
  });
});

describe("descendantCommsFromPsOutput — GSL-390 BFS walk", () => {
  const ps = [
    "  1     0 launchd",
    " 100     1 tmux: server",
    " 200   100 bash",
    " 300   200 node",
    " 400   200 claude",
    " 500   400 claude helper",
    " 600     1 unrelated",
  ].join("\n");
  test("walks descendants of a mid-tree pid AND includes the root's own comm", () => {
    const comms = descendantCommsFromPsOutput(ps, 100);
    expect(comms).toContain("tmux: server"); // root's own comm
    expect(comms).toContain("bash");
    expect(comms).toContain("node");
    expect(comms).toContain("claude");
    expect(comms).toContain("claude helper");
    expect(comms).not.toContain("unrelated");
    expect(comms).not.toContain("launchd");
  });
  test("returns just the root's own comm when it has no descendants", () => {
    const comms = descendantCommsFromPsOutput(ps, 600);
    expect(comms).toEqual(["unrelated"]);
  });
  test("returns [] for empty input", () => {
    expect(descendantCommsFromPsOutput("", 1)).toEqual([]);
  });
  test("returns [] when the root pid is not in the ps table (already gone)", () => {
    const comms = descendantCommsFromPsOutput(ps, 9999);
    expect(comms).toEqual([]);
  });
  test("GSL-390 live-leg — pane_pid IS the claude process itself (root's argv[0] is 'claude')", () => {
    // Real macOS Claude Code 2.1.x: the pane_pid IS the claude process, `ps -o comm=`
    // returns "claude", tmux reports pane_current_command="2.1.233" separately. Rooting
    // the walk at the pane_pid must include that "claude" comm in the results — that's
    // the very signal `paneQualifiesAsPrompt` needs to accept the pane.
    const psReal = [
      "  1     0 launchd",
      " 100     1 tmux: server",
      "200   100 claude",
      "300   200 node",
      "400   200 npm",
      "500   300 chrome-devtools-mcp",
    ].join("\n");
    const comms = descendantCommsFromPsOutput(psReal, 200);
    expect(comms[0]).toBe("claude");
    expect(comms).toContain("node");
    expect(comms).toContain("npm");
    expect(comms).toContain("chrome-devtools-mcp");
  });
});

describe("paneQualifiesAsPrompt — GSL-390 async predicate with process-tree probe", () => {
  test("known shell — accepts without probing (probe never called)", async () => {
    const { pane_ref } = seedControlledSessionAndPane(opened, { pane_current_command: "bash" });
    let probed = 0;
    const ok = await paneQualifiesAsPrompt(opened, pane_ref, {
      readDescendantComms: async () => { probed += 1; return []; },
    });
    expect(ok).toBe(true);
    expect(probed).toBe(0);
  });
  test("version-shaped + claude in process tree — ACCEPTED (real CC 2.1.233, run-01 M2)", async () => {
    const { pane_ref } = seedControlledSessionAndPane(opened, {
      pane_current_command: "2.1.233",
    });
    const ok = await paneQualifiesAsPrompt(opened, pane_ref, {
      readDescendantComms: async () => ["node", "claude"],
    });
    expect(ok).toBe(true);
  });
  test("version-shaped but NO claude in process tree — REJECTED (not blanket)", async () => {
    // The widening must not be blanket. A pane whose command happens to render as
    // "2.1.233" (some other tool) with no `claude` in its process tree stays
    // rejected — the probe is the gating step.
    const { pane_ref } = seedControlledSessionAndPane(opened, {
      pane_current_command: "2.1.233",
    });
    const ok = await paneQualifiesAsPrompt(opened, pane_ref, {
      readDescendantComms: async () => ["node", "python", "vim"],
    });
    expect(ok).toBe(false);
  });
  test("non-shell, non-version command — REJECTED without probing", async () => {
    const { pane_ref } = seedControlledSessionAndPane(opened, { pane_current_command: "python" });
    let probed = 0;
    const ok = await paneQualifiesAsPrompt(opened, pane_ref, {
      readDescendantComms: async () => { probed += 1; return ["claude"]; },
    });
    expect(ok).toBe(false);
    expect(probed).toBe(0);
  });
  test("submitTask happy path — default framing on a real CC 2.1.233 pane (E2E run-01 acceptance)", async () => {
    // Threads the fix all the way through the executor: framing='prompt-boundary'
    // (the dialog default) + pane_current_command='2.1.233' + a claude in the
    // process tree → delivered on the first attempt, no more not_at_prompt refusal.
    const { pane_ref } = seedControlledSessionAndPane(opened, { pane_current_command: "2.1.233" });
    const spawns: string[][] = [];
    const r = await submitTask(
      opened,
      { session_id: "sess-1", body: "hello CC", framing: "prompt-boundary" },
      {
        spawn: async (a) => { spawns.push(a); return okSpawn(); },
        // Use a real waitForPromptBoundary but shortcut the probe to "claude is present".
        waitForPromptBoundary: async (db, ref) =>
          paneQualifiesAsPrompt(db, ref, {
            readDescendantComms: async () => ["node", "claude"],
          }),
      },
    );
    expect(r.outcome).toBe("delivered");
    expect(r.pane_ref_at_dispatch).toBe(pane_ref);
    expect(spawns).toEqual([
      ["tmux", "send-keys", "-t", pane_ref, "-l", "hello CC"],
      ["tmux", "send-keys", "-t", pane_ref, "Enter"],
    ]);
  });
});

describe("resolvePaneRef — cwd-prefix heuristic (R16.4)", () => {
  test("matches pane whose current_path is under session cwd_project_root", () => {
    const { session_id, pane_ref } = seedControlledSessionAndPane(opened);
    expect(resolvePaneRef(opened, session_id)).toBe(pane_ref);
  });
  test("returns null when no pane matches (pane_gone)", () => {
    seedControlledSessionAndPane(opened, {
      pane_current_path: "/somewhere/else",
    });
    expect(resolvePaneRef(opened, "sess-1")).toBeNull();
  });
  test("empty-string cwd_project_root treated as NULL, does NOT match a foreign pane (verifier m4)", () => {
    // Seed the session with cwd_project_root='' and a pane whose pane_current_path
    // is a plain absolute path unrelated to the session. Without the
    // `length(a.cwd_project_root) > 0` guard, the heuristic JOIN would degrade to
    // `LIKE '/%'` and match the foreign pane. With the guard, resolvePaneRef must
    // return null (executor short-circuits to outcome='pane_gone').
    seedControlledSessionAndPane(opened, {
      cwd_project_root: "",
      pane_current_path: "/some/other/project/tree",
    });
    expect(resolvePaneRef(opened, "sess-1")).toBeNull();
  });
});

describe("previewSubmission — R16.1, R16.2, R16.3 guards", () => {
  test("session-not-controlled → 409 refusal", async () => {
    seedControlledSessionAndPane(opened, { state: "observer" });
    const r = await previewSubmission(opened, {
      session_id: "sess-1",
      body: "hi",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("session-not-controlled");
      expect(r.httpStatus).toBe(409);
    }
  });
  test("shim-not-registered → 409 refusal", async () => {
    seedControlledSessionAndPane(opened, { shim_registered: false });
    const r = await previewSubmission(opened, {
      session_id: "sess-1",
      body: "hi",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("shim-not-registered");
  });
  test("controlled + shim + valid body → preview with sha, byte-length, target", async () => {
    const { pane_ref } = seedControlledSessionAndPane(opened);
    const r = await previewSubmission(opened, {
      session_id: "sess-1",
      body: "run the migration",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resolved_target).toBe(pane_ref);
      expect(r.body_len).toBe(17);
      expect(r.body_sha256).toBe(await computeBodySha256("run the migration"));
      expect(r.framing).toBe("prompt-boundary");
      expect(r.warnings).toEqual([]);
    }
  });
});

describe("submitTask — the executor's outcomes (F16-S5, S6; R16.9)", () => {
  test("released_mid_submit — session flipped to observer between preview and confirm", async () => {
    seedControlledSessionAndPane(opened);
    // Simulate release-mid-submit by flipping state before submitTask reads it.
    opened.raw.query(`UPDATE session_control SET state='observer' WHERE session_id='sess-1'`).run();
    const spawns: string[][] = [];
    const r = await submitTask(
      opened,
      { session_id: "sess-1", body: "task" },
      { spawn: async (a) => { spawns.push(a); return okSpawn(); } },
    );
    expect(r.outcome).toBe("released_mid_submit");
    expect(spawns).toEqual([]);
  });

  test("pane_gone — pane_ref resolves to null at dispatch", async () => {
    seedControlledSessionAndPane(opened, { pane_current_path: "/somewhere/else" });
    const spawns: string[][] = [];
    const r = await submitTask(
      opened,
      { session_id: "sess-1", body: "task" },
      { spawn: async (a) => { spawns.push(a); return okSpawn(); } },
    );
    expect(r.outcome).toBe("pane_gone");
    expect(spawns).toEqual([]);
  });

  test("not_at_prompt — framing='prompt-boundary' times out", async () => {
    seedControlledSessionAndPane(opened, { pane_current_command: "vim" });
    const spawns: string[][] = [];
    const r = await submitTask(
      opened,
      { session_id: "sess-1", body: "task", framing: "prompt-boundary" },
      {
        spawn: async (a) => { spawns.push(a); return okSpawn(); },
        // Force the waiter to return false without sleeping in real time.
        waitForPromptBoundary: async () => false,
      },
    );
    expect(r.outcome).toBe("not_at_prompt");
    expect(spawns).toEqual([]);
  });

  test("send_failed — tmux send-keys (body) returns non-zero", async () => {
    seedControlledSessionAndPane(opened);
    const r = await submitTask(
      opened,
      { session_id: "sess-1", body: "task" },
      { spawn: async () => failSpawn("no server running") },
    );
    expect(r.outcome).toBe("send_failed");
    expect(r.error).toContain("no server running");
    expect(r.tmuxSendBody).not.toBeNull();
    expect(r.tmuxSendEnter).toBeNull();
  });

  test("send_failed — tmux send-keys (Enter) fails after body already landed", async () => {
    seedControlledSessionAndPane(opened);
    let call = 0;
    const r = await submitTask(
      opened,
      { session_id: "sess-1", body: "task" },
      {
        spawn: async () => {
          call += 1;
          return call === 1 ? okSpawn() : failSpawn("Enter blew up");
        },
      },
    );
    expect(r.outcome).toBe("send_failed");
    expect(r.error).toContain("Enter blew up");
    expect(r.error).toContain("already landed");
    expect(r.tmuxSendBody?.ok).toBe(true);
    expect(r.tmuxSendEnter?.ok).toBe(false);
  });

  test("delivered — happy path: -l body then Enter, R16.9 no widening", async () => {
    const { pane_ref } = seedControlledSessionAndPane(opened);
    const spawns: string[][] = [];
    const r = await submitTask(
      opened,
      { session_id: "sess-1", body: "hello world" },
      {
        spawn: async (a) => { spawns.push(a); return okSpawn(); },
      },
    );
    expect(r.outcome).toBe("delivered");
    expect(r.pane_ref_at_dispatch).toBe(pane_ref);
    expect(r.body_len).toBe(11);
    expect(spawns).toEqual([
      ["tmux", "send-keys", "-t", pane_ref, "-l", "hello world"],
      ["tmux", "send-keys", "-t", pane_ref, "Enter"],
    ]);
  });

  test("framing='none' skips the prompt-boundary wait", async () => {
    seedControlledSessionAndPane(opened, { pane_current_command: "python" });
    const spawns: string[][] = [];
    let waited = false;
    const r = await submitTask(
      opened,
      { session_id: "sess-1", body: "task", framing: "none" },
      {
        spawn: async (a) => { spawns.push(a); return okSpawn(); },
        waitForPromptBoundary: async () => { waited = true; return true; },
      },
    );
    expect(r.outcome).toBe("delivered");
    expect(waited).toBe(false);
    expect(spawns).toHaveLength(2);
  });

  test("body cannot be substituted by request state — resolvePaneRef is live", async () => {
    // Seed the session; then remove the matching pane row AFTER seed. The executor must
    // discover pane_ref is null (not use any cached/passed-in reference).
    seedControlledSessionAndPane(opened);
    opened.raw.query(`DELETE FROM tmux_panes WHERE pane_id='%42'`).run();
    const r = await submitTask(
      opened,
      { session_id: "sess-1", body: "task" },
      { spawn: async () => okSpawn() },
    );
    expect(r.outcome).toBe("pane_gone");
  });
});

describe("waitForPromptBoundary — polling / timeout deps", () => {
  test("returns true immediately when pane already at prompt (no sleep)", async () => {
    const { pane_ref } = seedControlledSessionAndPane(opened, { pane_current_command: "bash" });
    let slept = 0;
    const ok = await waitForPromptBoundary(opened, pane_ref, {
      sleep: async () => { slept += 1; },
      now: () => 0,
    });
    expect(ok).toBe(true);
    expect(slept).toBe(0);
  });

  test("returns true after a poll when pane arrives at prompt mid-wait", async () => {
    const { pane_ref, pane_id } = seedControlledSessionAndPane(opened, {
      pane_current_command: "python",
    });
    let t = 0;
    let flipped = false;
    const ok = await waitForPromptBoundary(opened, pane_ref, {
      waitMs: 2_000,
      pollMs: 100,
      now: () => t,
      sleep: async () => {
        t += 100;
        if (!flipped) {
          opened.raw.query(`UPDATE tmux_panes SET pane_current_command='bash' WHERE pane_id=?`).run(pane_id);
          flipped = true;
        }
      },
    });
    expect(ok).toBe(true);
  });

  test("times out after waitMs when the pane never returns to prompt", async () => {
    const { pane_ref } = seedControlledSessionAndPane(opened, {
      pane_current_command: "python",
    });
    let t = 0;
    const ok = await waitForPromptBoundary(opened, pane_ref, {
      waitMs: PROMPT_BOUNDARY_WAIT_MS,
      pollMs: 500,
      now: () => t,
      sleep: async () => { t += 500; },
    });
    expect(ok).toBe(false);
  });
});
