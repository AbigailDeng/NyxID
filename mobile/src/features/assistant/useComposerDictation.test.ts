import assert from "node:assert/strict";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";
import { deferred, hookHarness } from "./assistantHookTestHarness";
import type { useComposerDictation } from "./useComposerDictation";

function setup({ available = true, installed = true } = {}) {
  let state = "active";
  let focused = true;
  let sheetOpen = false;
  let epoch = 1;
  const permissions = deferred<{ granted: boolean }>();
  const callbacks = new Map<string, Set<(event?: any) => void>>();
  const appListeners = new Set<(state: string) => void>();
  const events: string[] = [];
  const inserted: string[] = [];
  const props = {
    scope: "agent:chat:0",
    enabled: true,
    onInsert: (text: string) => inserted.push(text),
  };
  const speech = {
    isRecognitionAvailable: () => available,
    requestPermissionsAsync: () => {
      events.push("permission");
      return permissions.promise;
    },
    addListener: (name: string, callback: (event?: any) => void) => {
      const listeners = callbacks.get(name) ?? new Set();
      callbacks.set(name, listeners);
      listeners.add(callback);
      return { remove: () => listeners.delete(callback) };
    },
    start: (options: any) => {
      assert.equal(options.continuous, false);
      assert.equal(options.recordingOptions.persist, false);
      events.push("start");
    },
    stop: () => events.push("stop"),
    abort: () => events.push("abort"),
  };
  const h = hookHarness<ReturnType<typeof useComposerDictation>>({
    expo: { requireOptionalNativeModule: () => (installed ? speech : null) },
    "react-native": {
      AppState: {
        get currentState() {
          return state;
        },
        addEventListener: (_: string, callback: (state: string) => void) => {
          appListeners.add(callback);
          return { remove: () => appListeners.delete(callback) };
        },
      },
    },
    "@react-navigation/native": { useIsFocused: () => focused },
    "../../lib/auth/authEpoch": { getAuthEpoch: () => epoch },
    "../../lib/accessibility/workspaceAccessibility": {
      useWorkspaceAccessibility: () => ({ sheetOpen }),
    },
  });
  const module = h.load(
    fileURLToPath(new URL("./useComposerDictation.ts", import.meta.url)),
  );
  const hook = module.useComposerDictation as typeof useComposerDictation;
  h.mount(() => hook(props));
  const emit = (name: string, event?: any) => {
    for (const callback of [...(callbacks.get(name) ?? [])]) callback(event);
    h.flush();
  };
  return {
    h,
    props,
    events,
    inserted,
    permissions,
    emit,
    append: module.appendDictation as (draft: string, text: string) => string,
    result: (text: string, final = false) =>
      emit("result", { isFinal: final, results: [{ transcript: text }] }),
    begin: async () => {
      const starting = h.value().start();
      permissions.resolve({ granted: true });
      await starting;
      await h.settle();
    },
    change: (what: string) => {
      if (what === "account") epoch++;
      if (what === "chat") props.scope = "other:chat:1";
      if (what === "disabled") props.enabled = false;
      if (what === "focus") focused = false;
      if (what === "sheet") sheetOpen = true;
      h.render();
    },
    app: (next: string) => {
      state = next;
      for (const callback of [...appListeners]) callback(next);
      h.flush();
    },
  };
}

test("dictation reviews cumulative text and only inserts once on explicit acceptance", async () => {
  const x = setup();
  await x.begin();
  x.result("Hello");
  x.result("Hello world", true);
  assert.equal(x.h.value().text, "Hello world");
  assert.deepEqual(x.inserted, []);
  x.h.value().stop();
  assert.equal(x.events.at(-1), "stop");
  x.emit("end");
  assert.equal(x.h.value().phase, "review");
  const insert = x.h.value().insert;
  insert();
  insert();
  assert.deepEqual(x.inserted, ["Hello world"]);
  x.h.flush();
  assert.equal(x.h.value().phase, "idle");
  assert.equal(
    x.append("Existing draft", "Hello world"),
    "Existing draft Hello world",
  );
  assert.equal(
    x.append("Existing draft\n", "Hello world"),
    "Existing draft\nHello world",
  );
  assert.equal(x.append("", "Hello world"), "Hello world");
  x.h.unmount();
});

test("discard never inserts and releases the microphone before ignoring late native events", async () => {
  const x = setup();
  await x.begin();
  x.result("Discard me");
  x.h.value().discard();
  x.h.flush();
  x.result("Late result", true);
  x.emit("end");
  assert.deepEqual(x.events, ["permission", "start", "abort"]);
  assert.deepEqual(x.inserted, []);
  assert.equal(x.h.value().text, "");
  assert.equal(x.h.value().phase, "idle");
  x.h.unmount();
});

test("account, chat, access, focus and drawer changes cancel capture and obsolete review handlers", async () => {
  for (const change of ["account", "chat", "disabled", "focus", "sheet"]) {
    const x = setup();
    await x.begin();
    x.result("Old account words");
    x.change(change);
    x.result("Late words", true);
    x.emit("end");
    assert.equal(x.events.at(-1), "abort", change);
    assert.equal(x.h.value().phase, "idle", change);
    assert.deepEqual(x.inserted, [], change);
    x.h.unmount();

    const y = setup();
    await y.begin();
    y.result("Old review", true);
    y.emit("end");
    const insert = y.h.value().insert;
    y.change(change);
    insert();
    assert.deepEqual(y.inserted, [], change);
    y.h.unmount();
  }
});

test("pending permission cannot start capture after ownership changes or unmount", async () => {
  for (const change of [
    "account",
    "chat",
    "disabled",
    "focus",
    "sheet",
    "unmount",
  ]) {
    const x = setup();
    const starting = x.h.value().start();
    if (change === "unmount") x.h.unmount();
    else x.change(change);
    x.permissions.resolve({ granted: true });
    await starting;
    assert.deepEqual(x.events, ["permission"], change);
    assert.deepEqual(x.inserted, [], change);
    if (change !== "unmount") x.h.unmount();
  }
});

test("permission inactivity waits for foreground; background while recording aborts without insertion", async () => {
  const x = setup();
  const starting = x.h.value().start();
  x.app("inactive");
  x.permissions.resolve({ granted: true });
  await starting;
  await x.h.settle();
  assert.deepEqual(x.events, ["permission"]);
  x.app("active");
  assert.equal(x.events.at(-1), "start");
  x.result("Private words");
  x.app("background");
  assert.equal(x.events.at(-1), "abort");
  assert.equal(x.h.value().text, "");
  assert.deepEqual(x.inserted, []);
  x.h.unmount();
});

test("permission denial, absent runtime module and unavailable recognizer keep text entry usable", async () => {
  const denied = setup();
  const starting = denied.h.value().start();
  denied.permissions.resolve({ granted: false });
  await starting;
  await denied.h.settle();
  assert.match(denied.h.value().error!, /Settings/);
  assert.equal(denied.h.value().active, false);
  assert.deepEqual(denied.events, ["permission"]);
  denied.h.unmount();
  for (const options of [{ installed: false }, { available: false }]) {
    const x = setup(options);
    await x.h.value().start();
    await x.h.settle();
    assert.match(x.h.value().error!, /keyboard/);
    assert.equal(x.h.value().active, false);
    assert.deepEqual(x.events, []);
    x.h.unmount();
  }
});

test("recognizer errors and empty results release audio and never insert unreviewed text", async () => {
  const x = setup();
  await x.begin();
  x.result("Partial words");
  x.emit("error", {
    error: "network",
    message: "native details must stay private",
  });
  assert.equal(x.events.at(-1), "abort");
  assert.equal(x.h.value().text, "");
  assert.doesNotMatch(x.h.value().error!, /native details/);
  assert.deepEqual(x.inserted, []);
  x.h.unmount();
  const y = setup();
  await y.begin();
  y.emit("end");
  assert.match(y.h.value().error!, /No speech/);
  assert.equal(y.h.value().active, false);
  y.h.unmount();
});

test("unmount during listening releases capture and ignores its late results", async () => {
  const x = setup();
  await x.begin();
  x.h.unmount();
  assert.equal(x.events.at(-1), "abort");
  x.result("Late text", true);
  x.emit("end");
  assert.deepEqual(x.inserted, []);
});
