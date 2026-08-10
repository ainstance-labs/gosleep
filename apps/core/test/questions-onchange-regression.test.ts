// @gosleep/core — Regression: Questions.tsx Answer-dialog textarea onChange (GSL-308).
//
// Origin: functional-QA run web-e2e-2026-08-10/runs/01 finding #1 (MAJOR).
//
// The pre-fix code in apps/web/src/screens/Questions.tsx passed React's SyntheticEvent
// through an ASYNC state-updater closure — a pattern React 19 explicitly documents may
// invoke outside the synchronous handler window. By the time the updater read
// `e.currentTarget.value`, the event object had been recycled and `e.currentTarget` was
// null → TypeError → router error boundary → entire /questions route blanked with
// "Something went wrong". Owner could not answer any blocker/decision until a full reload.
//
// The web workspace does not carry a React test runner (no vitest / no RTL) and adding one
// is well outside a hotfix scope. This regression models the semantic pattern in pure
// TypeScript, exercised under bun:test — the "before" pattern demonstrably throws when the
// event is nulled after the handler returns; the "after" pattern (capture-then-update)
// survives.

import { describe, expect, test } from "bun:test";

/** Minimal shape of the fragment of React.ChangeEvent this test cares about. */
interface MutableChangeEvent {
  currentTarget: { value: string } | null;
}

/**
 * Pre-fix pattern: read `e.currentTarget.value` INSIDE the updater. When React 19 (or a
 * shim that models the same lifecycle) recycles the event and nulls currentTarget before
 * the updater runs, this throws.
 */
function prefixOnChange(
  e: MutableChangeEvent,
  setState: (updater: (prev: { value: string } | null) => { value: string } | null) => void,
): void {
  setState((prev) => (prev === null ? prev : { ...prev, value: e.currentTarget!.value }));
}

/**
 * GSL-308 fix: capture `value` synchronously BEFORE the updater fires. Even if React
 * recycles the event after the handler returns, the local `v` is safe in the closure.
 */
function fixedOnChange(
  e: MutableChangeEvent,
  setState: (updater: (prev: { value: string } | null) => { value: string } | null) => void,
): void {
  const v = e.currentTarget!.value;
  setState((prev) => (prev === null ? prev : { ...prev, value: v }));
}

/**
 * Test double for React 19's async setState behavior. `.dispatch(handler, event)` invokes
 * the handler synchronously (so the handler can read the event) and then nulls the event's
 * currentTarget BEFORE the queued updater runs — matching the React 19 recycle window.
 */
function makeAsyncStateStore(initial: { value: string } | null): {
  set: (updater: (prev: { value: string } | null) => { value: string } | null) => void;
  flush: () => void;
  get: () => { value: string } | null;
} {
  let state = initial;
  const queue: Array<(prev: { value: string } | null) => { value: string } | null> = [];
  return {
    set(updater) {
      queue.push(updater);
    },
    flush() {
      while (queue.length > 0) {
        const updater = queue.shift()!;
        state = updater(state);
      }
    },
    get() {
      return state;
    },
  };
}

describe("Questions.tsx onChange regression (GSL-308)", () => {
  test("pre-fix pattern throws when the event is recycled before the updater runs", () => {
    const store = makeAsyncStateStore({ value: "" });
    const evt: MutableChangeEvent = { currentTarget: { value: "hello" } };
    // Simulate React 19: dispatch to the handler, then recycle the event, THEN flush the
    // queued updater. This is the exact ordering the QA harness surfaced under CDP.
    prefixOnChange(evt, store.set);
    evt.currentTarget = null;
    expect(() => store.flush()).toThrow(TypeError);
  });

  test("fix pattern survives the same recycled-event race", () => {
    const store = makeAsyncStateStore({ value: "" });
    const evt: MutableChangeEvent = { currentTarget: { value: "hello" } };
    fixedOnChange(evt, store.set);
    evt.currentTarget = null;
    // The captured `v` survives inside the closure — the updater does not touch the event.
    store.flush();
    expect(store.get()).toEqual({ value: "hello" });
  });

  test("fix pattern also survives when the updater is invoked synchronously (React 18 path)", () => {
    // The fix must not break the synchronous path — the captured local is still correct.
    const store = makeAsyncStateStore({ value: "" });
    const evt: MutableChangeEvent = { currentTarget: { value: "sync" } };
    fixedOnChange(evt, store.set);
    // Flush BEFORE recycling — the classic React 18 order.
    store.flush();
    expect(store.get()).toEqual({ value: "sync" });
  });

  test("fix pattern handles null-prev state without touching the event", () => {
    const store = makeAsyncStateStore(null);
    const evt: MutableChangeEvent = { currentTarget: { value: "typed" } };
    fixedOnChange(evt, store.set);
    evt.currentTarget = null;
    store.flush();
    // Dialog closed between keystroke and flush — updater sees null prev, keeps null, no throw.
    expect(store.get()).toBeNull();
  });
});
