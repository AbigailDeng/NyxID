import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceFocusState } from "./workspaceFocusState";

function setup() {
  const focused: number[] = [];
  const scheduled: (() => void)[] = [];
  const state = createWorkspaceFocusState(
    (target) => focused.push(target),
    (callback) => scheduled.push(callback),
  );
  return {
    state,
    focused,
    flush: () => {
      while (scheduled.length) scheduled.shift()!();
    },
  };
}
test("dismissal resolves the invoking mounted control after the primary becomes active", () => {
  const { state, focused, flush } = setup();
  const menu = Symbol(),
    back = Symbol();
  state.context("chat", false);
  let tag: number | null = 10;
  state.register(menu, () => tag, true, "chat");
  state.invoked(menu);
  state.register(back, () => 20, true, "chat");
  const origin = state.capture("chat");
  state.context("chat", true);
  state.register(menu, () => tag, false, "chat");
  state.restore(origin);
  flush();
  assert.deepEqual(focused, []);
  state.context("chat", false);
  state.register(menu, () => tag, true, "chat");
  tag = 30;
  flush();
  assert.deepEqual(
    focused,
    [30],
    "read the current native handle rather than a stale layout tag",
  );
  state.register(menu, () => tag, true, "chat");
  flush();
  assert.deepEqual(focused, [30]);
});
test("a recreated primary header receives focus but auth and context replacements cancel restoration", () => {
  for (const nextScope of ["chat", "other-chat", undefined]) {
    const { state, focused, flush } = setup();
    const old = Symbol(),
      replacement = Symbol();
    state.context("chat", false);
    state.register(old, () => 10, true, "chat");
    const origin = state.capture("chat");
    state.context("chat", true);
    state.release(old);
    state.restore(origin);
    state.context(nextScope, false);
    state.register(replacement, () => 20, true, nextScope);
    flush();
    assert.deepEqual(focused, nextScope === "chat" ? [20] : []);
  }
});
test("a released view cannot receive a queued event and restoration never selects an inactive control", () => {
  const { state, focused, flush } = setup();
  const owner = Symbol(),
    inactive = Symbol();
  state.context("chat", false);
  state.register(owner, () => 10, true, "chat");
  const origin = state.capture("chat");
  state.restore(origin);
  state.release(owner);
  state.register(inactive, () => 20, false, "chat");
  flush();
  assert.deepEqual(focused, []);
  state.context("new-chat", false);
  state.register(Symbol(), () => 30, true, "new-chat");
  flush();
  assert.deepEqual(focused, []);
});
test("Close receives focus once per drawer and never after its view or drawer unmounts", () => {
  const { state, focused, flush } = setup();
  let tag: number | null = 10;
  state.focusDrawerOnce("sheet", () => tag);
  state.focusDrawerOnce("sheet", () => 20);
  flush();
  assert.deepEqual(focused, [20]);
  state.focusDrawerOnce("sheet", () => 20);
  flush();
  assert.deepEqual(focused, [20]);
  state.releaseDrawer("sheet");
  state.focusDrawerOnce("sheet", () => tag);
  tag = null;
  flush();
  assert.deepEqual(focused, [20]);
  state.focusDrawerOnce("cancelled", () => 40);
  state.releaseDrawer("cancelled");
  flush();
  assert.deepEqual(focused, [20]);
});

test("auth admission cancels a queued native event and rejects the old drawer origin even if route keys remain", () => {
  let epoch = 1;
  const focused: number[] = [];
  const scheduled: (() => void)[] = [];
  const state = createWorkspaceFocusState(
    (tag) => focused.push(tag),
    (callback) => scheduled.push(callback),
    () => epoch,
  );
  state.context("chat", false);
  state.register(Symbol(), () => 10, true, "chat");
  const origin = state.capture("chat");
  state.restore(origin);
  epoch++;
  while (scheduled.length) scheduled.shift()!();
  state.register(Symbol(), () => 20, true, "chat");
  state.restore(origin);
  while (scheduled.length) scheduled.shift()!();
  assert.deepEqual(focused, []);
});
