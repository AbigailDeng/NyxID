import assert from "node:assert/strict";
import { URL, fileURLToPath } from "node:url";
import test from "node:test";
import { hookHarness } from "../../features/assistant/assistantHookTestHarness";
import { createWorkspaceFocusState } from "../../lib/accessibility/workspaceFocusState";

type Element = { type: unknown; props: Record<string, any>; key?: unknown };

async function setup(
  platform: "ios" | "android",
  initiallyVisible = false,
  reduceMotion = false,
) {
  let visible = initiallyVisible;
  let dismissed = 0;
  let target: number | null = 90;
  let authEpoch = 0;
  let onDismiss: () => void = () => {
    dismissed++;
  };
  const focused: number[] = [];
  const scheduledFocus: (() => void)[] = [];
  const focus = createWorkspaceFocusState(
    (tag) => focused.push(tag),
    (callback) => scheduledFocus.push(callback),
    () => authEpoch,
  );
  const animations: {
    stopped: boolean;
    complete: (finished?: boolean) => void;
  }[] = [];
  class Value {
    constructor(public value: number) {}
    setValue(next: number) {
      this.value = next;
    }
    interpolate(config: unknown) {
      return config;
    }
  }
  const jsx = (
    type: unknown,
    props: Record<string, unknown>,
    key?: unknown,
  ): Element => ({
    type,
    props,
    key,
  });
  const harness = hookHarness<Element>({
    "../../lib/accessibility/workspaceFocus": { workspaceFocus: focus },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": {
      Platform: { OS: platform },
      Modal: "Modal",
      Pressable: "Pressable",
      useWindowDimensions: () => ({ width: 400 }),
      AccessibilityInfo: {
        addEventListener: () => ({ remove() {} }),
        isReduceMotionEnabled: async () => reduceMotion,
      },
      Animated: {
        Value,
        View: "Animated.View",
        timing: (_value: Value, _config: unknown) => {
          let callback: (result: { finished: boolean }) => void = () => {};
          const animation = {
            stopped: false,
            complete: (finished = true) => callback({ finished }),
          };
          animations.push(animation);
          return {
            start: (next: typeof callback) => {
              callback = next;
            },
            stop: () => {
              animation.stopped = true;
            },
          };
        },
      },
      Easing: { cubic: "cubic", out: (v: unknown) => v, in: (v: unknown) => v },
      StyleSheet: { create: <T>(styles: T) => styles },
    },
    "react-native-safe-area-context": { SafeAreaProvider: "SafeAreaProvider" },
  });
  const component = harness.load(
    fileURLToPath(new URL("./WorkspaceDrawerModal.tsx", import.meta.url)),
  ).WorkspaceDrawerModal as (props: {
    visible: boolean;
    onClose: () => void;
    onDismiss: () => void;
    initialFocusTarget: () => number | null;
    children: null;
  }) => Element;
  harness.mount(() =>
    component({
      visible,
      onClose() {},
      onDismiss,
      initialFocusTarget: () => target,
      children: null,
    }),
  );
  await harness.settle();
  return {
    focus,
    focused,
    changeAuth: () => authEpoch++,
    setFocusTarget: (next: number | null) => {
      target = next;
    },
    flushFocus: () => {
      while (scheduledFocus.length) scheduledFocus.shift()!();
    },
    harness,
    animations,
    modal: () => harness.value().props,
    modalKey: () => harness.value().key,
    dismissed: () => dismissed,
    setVisible: (next: boolean) => {
      visible = next;
      harness.render();
    },
    setOnDismiss: (next: () => void) => {
      onDismiss = next;
      harness.render();
    },
    show: () => {
      harness.value().props.onShow();
      harness.flush();
    },
    finishAnimation: () => {
      const animation = animations.at(-1);
      assert.ok(animation);
      animation.complete();
      harness.flush();
    },
  };
}

test("iOS waits for native dismissal after the closing animation and notifies once", async () => {
  const env = await setup("ios");
  assert.equal(env.dismissed(), 0);
  env.setVisible(true);
  env.show();
  env.finishAnimation();
  env.setVisible(false);
  assert.equal(env.modal().visible, true);
  assert.equal(env.dismissed(), 0);
  env.finishAnimation();
  assert.equal(env.modal().visible, false);
  assert.equal(env.dismissed(), 0);
  env.modal().onDismiss();
  env.modal().onDismiss();
  assert.equal(env.dismissed(), 1);
});

test("iOS early close before onShow still waits for native dismissal", async () => {
  const env = await setup("ios", true);
  assert.equal(env.animations.length, 0);
  env.setVisible(false);
  assert.equal(env.modal().visible, false);
  env.show();
  assert.equal(env.modal().visible, false);
  assert.equal(env.dismissed(), 0);
  env.modal().onDismiss();
  assert.equal(env.dismissed(), 1);
});

test("the completed dismissal reads the latest callback without repeating after rerenders", async () => {
  const env = await setup("ios", true);
  env.show();
  env.setVisible(false);
  env.finishAnimation();
  let latestCalls = 0;
  env.setOnDismiss(() => latestCalls++);
  env.modal().onDismiss();
  env.harness.render();
  env.modal().onDismiss();
  assert.equal(latestCalls, 1);
  assert.equal(env.dismissed(), 0);
});

test("Android notifies only after mounted=false commits, including an early close", async () => {
  const env = await setup("android", true);
  env.show();
  env.setVisible(false);
  assert.equal(env.dismissed(), 0);
  assert.equal(env.modal().visible, true);
  env.finishAnimation();
  assert.equal(env.modal().visible, false);
  assert.equal(env.dismissed(), 1);
  assert.equal(env.modal().onDismiss, undefined);
  env.harness.render();
  assert.equal(env.dismissed(), 1);

  env.setVisible(true);
  env.setVisible(false);
  assert.equal(env.modal().visible, false);
  assert.equal(env.dismissed(), 2);
});

test("reopening interrupts the close animation and ignores a stale native dismissal", async () => {
  const env = await setup("ios", true);
  env.show();
  env.setVisible(false);
  const closing = env.animations.at(-1)!;
  env.setVisible(true);
  assert.equal(closing.stopped, true);
  closing.complete();
  env.harness.flush();
  env.modal().onDismiss();
  assert.equal(env.dismissed(), 0);
  assert.equal(env.modal().visible, true);
  env.setVisible(false);
  env.finishAnimation();
  env.modal().onDismiss();
  assert.equal(env.dismissed(), 1);
});

test("menu focus ownership starts before presentation and ends only at native dismissal", async () => {
  const env = await setup("ios");
  env.focus.context("chat", false);
  env.focus.register(Symbol("chat header"), () => 10, true, "chat");
  const origin = env.focus.capture("chat");
  env.focus.context("chat", true);
  env.focus.restore(origin);
  env.focus.context("chat", false);
  env.setVisible(true); // Starts ownership before native onShow/entrance.
  env.flushFocus();
  assert.deepEqual(env.focused, []);
  env.show();
  env.finishAnimation();
  env.setVisible(false);
  env.focus.restore(origin);
  env.flushFocus();
  assert.deepEqual(
    env.focused,
    [],
    "closing animation still belongs to the menu",
  );
  env.finishAnimation();
  assert.equal(env.modal().visible, false);
  env.focus.restore(origin);
  env.flushFocus();
  assert.deepEqual(env.focused, [], "native modal has not dismissed yet");
  env.modal().onDismiss();
  env.flushFocus();
  assert.deepEqual(
    env.focused,
    [],
    "the cancelled sheet request stays cancelled",
  );
  env.focus.restore(env.focus.capture("chat"));
  env.flushFocus();
  assert.deepEqual(env.focused, [10]);
});

test("reopening keeps focus ownership across stale dismissal and unmount releases it", async () => {
  const env = await setup("ios", true);
  env.focus.context("chat", false);
  env.focus.register(Symbol("chat header"), () => 10, true, "chat");
  env.show();
  env.setVisible(false);
  env.setVisible(true);
  env.modal().onDismiss();
  env.focus.restore(env.focus.capture("chat"));
  env.flushFocus();
  assert.deepEqual(env.focused, []);
  env.harness.unmount();
  env.focus.restore(env.focus.capture("chat"));
  env.flushFocus();
  assert.deepEqual(env.focused, [10]);
});

test("each completed iOS menu cycle gets a fresh Modal owner with no nested modal accessibility owner", async () => {
  const env = await setup("ios");
  const keys = new Set<unknown>();
  for (let cycle = 0; cycle < 3; cycle++) {
    env.setVisible(true);
    const key = env.modalKey();
    assert.equal(
      keys.has(key),
      false,
      "a completed presentation must not reuse its Modal component",
    );
    keys.add(key);
    env.show();
    env.finishAnimation();
    const nodes = (root: Element): Element[] => [
      root,
      ...[root.props.children]
        .flat(Infinity)
        .flatMap((child) =>
          child && typeof child === "object" && "props" in child
            ? nodes(child)
            : [],
        ),
    ];
    assert.equal(
      nodes(env.harness.value()).some(
        (node) => node.props.accessibilityViewIsModal,
      ),
      false,
      "the native Modal owns isolation; no animated child claims modal ownership",
    );
    env.setVisible(false);
    env.finishAnimation();
    assert.equal(env.modalKey(), key, "do not remount before native onDismiss");
    env.modal().onDismiss();
    env.harness.flush();
    assert.notEqual(env.modalKey(), key);
    const nextKey = env.modalKey();
    env.modal().onDismiss();
    env.harness.flush();
    assert.equal(
      env.modalKey(),
      nextKey,
      "duplicate dismissals cannot retire the next owner",
    );
  }
  env.harness.unmount();
});

test("menu Close receives live focus once after native presentation and entrance, including reduced motion", async () => {
  for (const platform of ["ios", "android"] as const) {
    for (const reduced of [false, true]) {
      const env = await setup(platform, false, reduced);
      env.setVisible(true);
      env.flushFocus();
      assert.deepEqual(env.focused, [], "wait for native presentation");
      env.show();
      if (!reduced) {
        env.flushFocus();
        assert.deepEqual(env.focused, [], "wait for entrance completion");
        env.finishAnimation();
      }
      env.setFocusTarget(100);
      env.flushFocus();
      assert.deepEqual(
        env.focused,
        [100],
        "resolve the current mounted handle",
      );
      env.harness.render();
      env.flushFocus();
      assert.deepEqual(env.focused, [100], "rerender cannot steal focus");
      env.setVisible(false);
      if (!reduced) env.finishAnimation();
      if (platform === "ios") {
        env.modal().onDismiss();
        env.harness.flush();
      }
      env.setFocusTarget(110);
      env.setVisible(true);
      env.show();
      if (!reduced) env.finishAnimation();
      env.flushFocus();
      assert.deepEqual(
        env.focused,
        [100, 110],
        "a later presentation focuses its own control",
      );
      env.harness.unmount();
    }
  }
});

test("closing, unmounting or changing auth cancels queued menu presentation focus", async () => {
  for (const cancel of [
    "close",
    "unmount",
    "auth",
    "auth-before-entrance",
  ] as const) {
    const env = await setup("ios", true);
    env.show();
    if (cancel === "auth-before-entrance") env.changeAuth();
    env.finishAnimation();
    if (cancel === "close") env.setVisible(false);
    if (cancel === "unmount") env.harness.unmount();
    if (cancel === "auth") env.changeAuth();
    env.flushFocus();
    assert.deepEqual(env.focused, [], cancel);
    if (cancel !== "unmount") env.harness.unmount();
  }
});
