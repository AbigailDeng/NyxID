import assert from "node:assert/strict";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";
import { hookHarness } from "../../features/assistant/assistantHookTestHarness";
import {
  clampSidebarOffset,
  settleSidebarOpen,
  sidebarPushWidth,
  SIDEBAR_EDGE_WIDTH,
} from "./workspacePushState";

type Element = { type: unknown; props: Record<string, any> };
function elements(root: Element): Element[] {
  return [
    root,
    ...[root.props.children]
      .flat(Infinity)
      .flatMap((child) =>
        child && typeof child === "object" && "props" in child
          ? elements(child)
          : [],
      ),
  ];
}
function setup(reduced = false) {
  let props: Record<string, any>;
  const shared: { value: number }[] = [];
  let sharedCursor = 0;
  const springs: { target: number; complete: (done: boolean) => void }[] = [];
  const focus: unknown[][] = [];
  let hardwareBack: (() => boolean) | undefined;
  let dismissed = 0;
  let reveals = 0;
  const changes: boolean[] = [];
  let handlers: Record<string, any> = {};
  const settings: Record<string, any> = {};
  const child = {
    type: "ActualMountedNavigator",
    props: { key: "stable-chat" },
  };
  const sidebar = { type: "Sidebar", props: {} };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({
    type,
    props,
  });
  const pan = new Proxy(
    {},
    {
      get: (_, key: string) => (value: unknown) => {
        (key.startsWith("on") ? handlers : settings)[key] = value;
        return pan;
      },
    },
  );
  const harness = hookHarness<Element>({
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": {
      View: "View",
      Pressable: "Pressable",
      useWindowDimensions: () => ({ width: 402, height: 874 }),
      StyleSheet: {
        create: (styles: unknown) => styles,
        absoluteFill: {
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
        },
      },
      BackHandler: {
        addEventListener: (_: string, handler: () => boolean) => {
          hardwareBack = handler;
          return {
            remove: () => {
              if (hardwareBack === handler) hardwareBack = undefined;
            },
          };
        },
      },
    },
    "react-native-gesture-handler": {
      Gesture: {
        Pan: () => {
          handlers = {};
          return pan;
        },
      },
      GestureDetector: "GestureDetector",
    },
    "react-native-reanimated": {
      default: { View: "Animated.View" },
      useSharedValue: (value: number) => {
        const index = sharedCursor++;
        return (shared[index] ??= { value });
      },
      useAnimatedStyle: (read: () => unknown) => ({ read }),
      cancelAnimation() {},
      runOnJS: (callback: unknown) => callback,
      withSpring: (
        target: number,
        _config: unknown,
        complete: (done: boolean) => void,
      ) => {
        springs.push({ target, complete });
        return target;
      },
    },
    "../../lib/accessibility/useReducedMotion": {
      useReducedMotion: () => reduced,
    },
    "../../lib/accessibility/workspaceFocus": {
      workspaceFocus: {
        setModalActive: (owner: symbol, active: boolean) =>
          focus.push(["active", owner, active]),
        focusModalOnce: (owner: symbol, target: () => number | null) =>
          focus.push(["focus", owner, target()]),
      },
    },
    "../../theme/ThemeContext": {
      useTheme: () => ({
        colors: { sidebarBase: "#0C0C0E", bg: "#17171A", shadowColor: "#000" },
      }),
    },
    "./workspacePushState": {
      clampSidebarOffset,
      settleSidebarOpen,
      sidebarPushWidth,
      SIDEBAR_EDGE_WIDTH,
    },
  });
  const component = harness.load(
    fileURLToPath(new URL("./WorkspacePushShell.tsx", import.meta.url)),
  ).WorkspacePushShell as (props: any) => Element;
  props = {
    enabled: true,
    visible: false,
    presented: false,
    gestureEnabled: true,
    children: child,
    sidebar,
    onOpenChange: (open: boolean) => {
      changes.push(open);
      props.visible = open;
    },
    onRevealStart: () => {
      reveals++;
      props.presented = true;
    },
    onDismiss: () => {
      dismissed++;
      props.presented = false;
    },
    initialFocusTarget: () => 99,
  };
  harness.mount(() => {
    sharedCursor = 0;
    return component({ ...props });
  });
  const all = () => elements(harness.value());
  const find = (id: string) => all().find((node) => node.props.testID === id)!;
  const render = () => harness.render();
  const set = (next: Record<string, any>) => {
    Object.assign(props, next);
    render();
  };
  return {
    harness,
    all,
    find,
    set,
    render,
    shared,
    springs,
    focus,
    changes,
    child,
    sidebar,
    settings,
    handlers: () => handlers,
    offset: () => shared[0]!.value,
    style: () => find("workspace-content-slab").props.style[2].read(),
    lastComplete: (done = true) => springs.at(-1)!.complete(done),
    counts: () => ({ dismissed, reveals }),
    hardwareBack: () => hardwareBack?.(),
  };
}

test("the stationary base and full-width translated slab retain the actual navigator without a scrim or modal", () => {
  const x = setup();
  assert.equal(x.find("workspace-sidebar-base").props.style[1].width, 310);
  assert.equal(x.find("workspace-sidebar-base").props.pointerEvents, "none");
  assert.ok(x.all().includes(x.child));
  assert.ok(x.all().includes(x.sidebar));
  assert.equal(x.find("workspace-content-slab").props.style[0].flex, 1);
  assert.equal(
    x.all().filter((node) => /Modal|Overlay|Scrim/.test(String(node.type)))
      .length,
    0,
  );
  x.set({ visible: true, presented: true });
  assert.equal(x.style().transform[0].translateX, 310);
  assert.equal(x.style().borderTopLeftRadius, 16);
  assert.equal(
    x.find("workspace-sidebar-base").props.accessibilityElementsHidden,
    false,
  );
  assert.equal(
    x.find("workspace-sidebar-close-sliver").props.accessibilityLabel,
    "Close navigation",
  );
  assert.ok(x.all().includes(x.child));
  x.harness.unmount();
});

test("edge pan follows the finger, clamps travel and settles at the projected threshold", () => {
  const x = setup();
  assert.deepEqual([...x.settings.activeOffsetX], [-8, 8]);
  assert.deepEqual([...x.settings.failOffsetY], [-12, 12]);
  let failures = 0;
  x.handlers().onTouchesDown(
    { allTouches: [{ x: 25 }] },
    { fail: () => failures++ },
  );
  x.handlers().onTouchesDown(
    { allTouches: [{ x: 12 }] },
    { fail: () => failures++ },
  );
  assert.equal(failures, 1);
  x.handlers().onStart();
  x.render();
  x.handlers().onUpdate({ translationX: 155 });
  assert.equal(x.offset(), 155);
  x.handlers().onUpdate({ translationX: 600 });
  assert.equal(x.offset(), 310);
  x.handlers().onUpdate({ translationX: 155 });
  x.handlers().onEnd({ velocityX: 0 });
  x.render();
  assert.deepEqual(x.changes, [true]);
  x.lastComplete();
  assert.equal(x.focus.filter((event) => event[0] === "focus").length, 1);
  x.handlers().onStart();
  x.render();
  x.handlers().onUpdate({ translationX: -500 });
  assert.equal(x.offset(), 0);
  x.handlers().onEnd({ velocityX: -100 });
  x.render();
  assert.equal(x.counts().dismissed, 0);
  x.lastComplete();
  assert.equal(x.counts().dismissed, 1);
  x.harness.unmount();
});

test("gesture cancellation restores the previous endpoint and disabling reveal preserves the content", () => {
  const x = setup();
  x.set({ gestureEnabled: false });
  assert.equal(x.settings.enabled, false);
  x.set({ gestureEnabled: true });
  x.handlers().onStart();
  x.render();
  x.handlers().onUpdate({ translationX: 160 });
  x.handlers().onFinalize({}, false);
  x.render();
  assert.deepEqual(x.changes, [false]);
  x.lastComplete();
  assert.equal(x.counts().dismissed, 1);
  assert.ok(x.all().includes(x.child));
  x.harness.unmount();
});

test("sliver, Escape and Android Back request the same close; only settled current transitions dismiss", () => {
  const x = setup();
  x.set({ visible: true, presented: true });
  x.lastComplete();
  x.find("workspace-sidebar-close-sliver").props.onPress();
  x.render();
  const staleClose = x.springs.at(-1)!;
  assert.equal(x.counts().dismissed, 0);
  x.set({ visible: true });
  staleClose.complete(true);
  assert.equal(x.counts().dismissed, 0);
  x.harness.value().props.onAccessibilityEscape();
  x.render();
  x.lastComplete(false);
  assert.equal(x.counts().dismissed, 0);
  x.set({ visible: true });
  assert.equal(x.hardwareBack(), true);
  x.render();
  x.lastComplete();
  x.render();
  assert.equal(x.counts().dismissed, 1);
  assert.deepEqual(x.changes, [false, false, false]);
  assert.equal(x.hardwareBack(), undefined);
  assert.equal(
    x.find("workspace-sidebar-base").props.accessibilityElementsHidden,
    true,
  );
  x.harness.unmount();
});

test("sign-out and unmount fence old animation callbacks and release focus ownership", () => {
  for (const unmount of [false, true]) {
    const x = setup();
    x.set({ visible: true, presented: true });
    x.set({ visible: false });
    const pending = x.springs.at(-1)!;
    if (unmount) x.harness.unmount();
    else x.set({ enabled: false });
    pending.complete(true);
    assert.equal(x.counts().dismissed, 0);
    assert.equal(x.focus.filter((event) => event[0] === "focus").length, 0);
    assert.equal(x.focus.at(-1)![2], false);
    if (!unmount) {
      assert.equal(x.offset(), 0);
      x.harness.unmount();
    }
  }
});

test("reduced motion uses instant endpoints without a spring or interactive travel", async () => {
  const x = setup(true);
  x.handlers().onStart();
  x.render();
  x.handlers().onUpdate({ translationX: 180 });
  assert.equal(x.offset(), 0);
  x.handlers().onEnd({ translationX: 180, velocityX: 0 });
  x.render();
  assert.equal(x.offset(), 310);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(x.focus.filter((event) => event[0] === "focus").length, 1);
  x.find("workspace-sidebar-close-sliver").props.onPress();
  x.render();
  assert.equal(x.offset(), 0);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(x.counts().dismissed, 1);
  assert.equal(x.springs.length, 0);
  x.harness.unmount();
});
