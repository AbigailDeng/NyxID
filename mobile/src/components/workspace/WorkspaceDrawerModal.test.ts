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
  let closeRequests = 0;
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
  const harness = hookHarness<Element | null>({
    "../../lib/accessibility/workspaceFocus": { workspaceFocus: focus },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": {
      Platform: { OS: platform },
      Modal: "Modal",
      View: "View",
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
    "react-native-screens": { FullWindowOverlay: "FullWindowOverlay" },
  });
  const component = harness.load(
    fileURLToPath(new URL("./WorkspaceDrawerModal.tsx", import.meta.url)),
  ).WorkspaceDrawerModal as (props: {
    visible: boolean;
    onClose: () => void;
    onDismiss: () => void;
    initialFocusTarget: () => number | null;
    children: null;
  }) => Element | null;
  harness.mount(() =>
    component({
      visible,
      onClose: () => {
        closeRequests++;
      },
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
    modal: () => harness.value()?.props,
    isMounted: () =>
      platform === "ios"
        ? harness.value() !== null
        : harness.value()?.props.visible,
    dismissed: () => dismissed,
    closeRequests: () => closeRequests,
    setVisible: (next: boolean) => {
      visible = next;
      harness.render();
    },
    setOnDismiss: (next: () => void) => {
      onDismiss = next;
      harness.render();
    },
    show: () => {
      const host = harness.value();
      assert.ok(host);
      if (platform === "ios") host.props.children.props.onLayout();
      else host.props.onShow();
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

test("iOS uses a full-window host and hands navigation off only after its removal commit", async () => {
  const env = await setup("ios");
  assert.equal(env.dismissed(), 0);
  env.setVisible(true);
  assert.equal(env.harness.value()?.type, "FullWindowOverlay");
  env.show();
  env.finishAnimation();
  env.setVisible(false);
  assert.equal(env.isMounted(), true);
  assert.equal(env.dismissed(), 0);
  env.finishAnimation();
  assert.equal(env.harness.value(), null);
  assert.equal(env.dismissed(), 1);
  env.harness.render();
  assert.equal(env.dismissed(), 1);
});

test("iOS early close removes the host and ignores a retained layout callback", async () => {
  const env = await setup("ios", true);
  const lateLayout = env.harness.value()!.props.children.props.onLayout;
  assert.equal(env.animations.length, 0);
  env.setVisible(false);
  assert.equal(env.isMounted(), false);
  lateLayout();
  env.harness.flush();
  assert.equal(env.isMounted(), false);
  assert.equal(env.dismissed(), 1);
});

test("the completed dismissal reads the latest callback without repeating after rerenders", async () => {
  const env = await setup("ios", true);
  env.show();
  env.setVisible(false);
  let latestCalls = 0;
  env.setOnDismiss(() => {
    assert.equal(
      env.isMounted(),
      false,
      "handoff observes the removed native host",
    );
    latestCalls++;
  });
  env.finishAnimation();
  env.harness.render();
  assert.equal(latestCalls, 1);
  assert.equal(env.dismissed(), 0);
});

test("Android notifies only after mounted=false commits, including an early close", async () => {
  const env = await setup("android", true);
  env.show();
  env.setVisible(false);
  assert.equal(env.dismissed(), 0);
  assert.equal(env.modal()!.visible, true);
  env.finishAnimation();
  assert.equal(env.modal()!.visible, false);
  assert.equal(env.dismissed(), 1);
  assert.equal(env.modal()!.onDismiss, undefined);
  env.harness.render();
  assert.equal(env.dismissed(), 1);

  env.setVisible(true);
  env.setVisible(false);
  assert.equal(env.modal()!.visible, false);
  assert.equal(env.dismissed(), 2);
});

test("Android native Back and iOS accessibility Escape request the existing parent Close action", async () => {
  for (const platform of ["ios", "android"] as const) {
    const env = await setup(platform, true);
    env.show();
    if (platform === "android") env.modal()!.onRequestClose();
    else env.modal()!.children.props.onAccessibilityEscape();
    assert.equal(env.closeRequests(), 1);
    assert.equal(
      env.isMounted(),
      true,
      "parent controls the guarded closing lifecycle",
    );
    env.harness.unmount();
  }
});

test("reopening interrupts the close animation without releasing the current native host", async () => {
  const env = await setup("ios", true);
  env.show();
  env.setVisible(false);
  const closing = env.animations.at(-1)!;
  env.setVisible(true);
  assert.equal(closing.stopped, true);
  closing.complete();
  env.harness.flush();
  assert.equal(env.dismissed(), 0);
  assert.equal(env.isMounted(), true);
  env.setVisible(false);
  env.finishAnimation();
  assert.equal(env.dismissed(), 1);
});

test("menu focus ownership starts before presentation and ends only after host removal", async () => {
  const env = await setup("ios");
  env.focus.context("chat", false);
  env.focus.register(Symbol("chat header"), () => 10, true, "chat");
  const origin = env.focus.capture("chat");
  env.focus.context("chat", true);
  env.focus.restore(origin);
  env.focus.context("chat", false);
  env.setVisible(true);
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
  assert.equal(env.isMounted(), false);
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

test("reopening keeps focus ownership across interrupted dismissal and unmount releases it", async () => {
  const env = await setup("ios", true);
  env.focus.context("chat", false);
  env.focus.register(Symbol("chat header"), () => 10, true, "chat");
  env.show();
  env.setVisible(false);
  env.setVisible(true);
  env.focus.restore(env.focus.capture("chat"));
  env.flushFocus();
  assert.deepEqual(env.focused, []);
  env.harness.unmount();
  env.focus.restore(env.focus.capture("chat"));
  env.flushFocus();
  assert.deepEqual(env.focused, [10]);
});

test("each completed iOS menu cycle removes its window overlay without a UIKit Modal or nested AX owner", async () => {
  const env = await setup("ios");
  for (let cycle = 0; cycle < 3; cycle++) {
    assert.equal(env.harness.value(), null);
    env.setVisible(true);
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
      nodes(env.harness.value()!).some(
        (node) => node.type === "Modal" || node.props.accessibilityViewIsModal,
      ),
      false,
      "FullWindowOverlay owns isolation without a UIKit modal presenter",
    );
    env.setVisible(false);
    env.finishAnimation();
    assert.equal(env.harness.value(), null);
    assert.equal(env.dismissed(), cycle + 1);
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
      env.show();
      env.flushFocus();
      assert.deepEqual(env.focused, [100], "rerender cannot steal focus");
      env.setVisible(false);
      if (!reduced) env.finishAnimation();
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
