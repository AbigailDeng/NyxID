import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { hookHarness } from "../../features/assistant/assistantHookTestHarness";

type Element = { type: unknown; props: Record<string, any> };

async function setup(platform: "ios" | "android", initiallyVisible = false) {
  let visible = initiallyVisible;
  let dismissed = 0;
  let onDismiss = () => dismissed++;
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
  const jsx = (type: unknown, props: Record<string, unknown>): Element => ({
    type,
    props,
  });
  const harness = hookHarness<Element>({
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": {
      Platform: { OS: platform },
      Modal: "Modal",
      Pressable: "Pressable",
      useWindowDimensions: () => ({ width: 400 }),
      AccessibilityInfo: {
        addEventListener: () => ({ remove() {} }),
        isReduceMotionEnabled: async () => false,
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
    children: null;
  }) => Element;
  harness.mount(() =>
    component({ visible, onClose() {}, onDismiss, children: null }),
  );
  await harness.settle();
  return {
    harness,
    animations,
    modal: () => harness.value().props,
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
