import assert from "node:assert/strict";
import { URL, fileURLToPath } from "node:url";
import test from "node:test";
import { hookHarness } from "../../features/assistant/assistantHookTestHarness";

type Element = { type: unknown; props: Record<string, any> };
type Gesture = { dx: number; dy: number; vy: number };
type PanHandlers = {
  onMoveShouldSetPanResponder: (event: unknown, gesture: Gesture) => boolean;
  onPanResponderMove: (event: unknown, gesture: Gesture) => void;
  onPanResponderRelease: (event: unknown, gesture: Gesture) => void;
  onPanResponderTerminate: () => void;
};

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

function setup(
  reduced = false,
  dimensions = { width: 390, height: 844 },
  insetTop = 47,
  deferAnimation = false,
) {
  let handlers!: PanHandlers;
  let closeAttempts = 0;
  let allowedCloses = 0;
  let canClose = true;
  const springs: {
    toValue: number;
    useNativeDriver: boolean;
    started: boolean;
  }[] = [];
  const timings: {
    from: number;
    to: number;
    value: Value;
    complete: () => void;
  }[] = [];
  class Value {
    constructor(public value: number) {}
    setValue(next: number) {
      this.value = next;
    }
  }
  const child: Element = { type: "ChildNavigator", props: {} };
  const jsx = (type: unknown, props: Record<string, unknown>): Element => ({
    type,
    props,
  });
  const harness = hookHarness<Element>({
    "../../lib/accessibility/workspaceAccessibility": {
      useWorkspaceAccessibility: () => ({
        primaryKey: "chat",
        sheetOpen: true,
      }),
    },
    "../../lib/accessibility/workspaceFocus": {
      workspaceFocus: { capture() {}, restore() {} },
    },
    "../../lib/accessibility/useReducedMotion": {
      useReducedMotion: () => reduced,
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": {
      View: "View",
      useWindowDimensions: () => dimensions,
      BackHandler: { addEventListener: () => ({ remove() {} }) },
      AccessibilityInfo: { setAccessibilityFocus() {} },
      findNodeHandle: () => null,
      Pressable: "Pressable",
      Animated: {
        Value,
        timing: (value: Value, config: { toValue: number }) => ({
          start: (done?: (event: { finished: boolean }) => void) => {
            const complete = () => {
              value.setValue(config.toValue);
              done?.({ finished: true });
            };
            timings.push({
              from: value.value,
              to: config.toValue,
              value,
              complete,
            });
            if (!deferAnimation) complete();
          },
          stop() {},
        }),
        View: "Animated.View",
        spring: (
          value: Value,
          config: { toValue: number; useNativeDriver: boolean },
        ) => {
          const entry = {
            toValue: config.toValue,
            useNativeDriver: config.useNativeDriver,
            started: false,
          };
          springs.push(entry);
          return {
            start: () => {
              entry.started = true;
              value.setValue(config.toValue);
            },
          };
        },
      },
      PanResponder: {
        create: (next: PanHandlers) => {
          handlers = next;
          return { panHandlers: next };
        },
      },
      StyleSheet: {
        create: <T>(styles: T) => styles,
        absoluteFill: { position: "absolute" },
      },
    },
    "react-native-safe-area-context": {
      SafeAreaProvider: "SafeAreaProvider",
      useSafeAreaInsets: () => ({
        top: insetTop,
        bottom: 34,
        left: 0,
        right: 0,
      }),
    },
    "../../theme/ThemeContext": {
      SheetThemeProvider: "SheetThemeProvider",
      useTheme: () => ({
        colors: {
          bg: "#ffffff",
          sheetScrim: "rgba(0,0,0,0.42)",
          textMuted: "#746981",
        },
      }),
    },
    "@react-navigation/native": {
      useNavigation: () => ({
        goBack: () => {
          throw new Error("Surface must dismiss through guarded onClose");
        },
        dispatch: () => {
          throw new Error("Surface must dismiss through guarded onClose");
        },
      }),
    },
  });
  const component = harness.load(
    fileURLToPath(new URL("./WorkspaceSheetSurface.tsx", import.meta.url)),
  ).WorkspaceSheetSurface as (props: {
    onClose: () => void;
    canClose: () => Promise<boolean>;
    children: Element;
  }) => Element;
  harness.mount(() =>
    component({
      children: child,
      canClose: async () => {
        closeAttempts++;
        return canClose;
      },
      onClose: () => {
        allowedCloses++;
      },
    }),
  );
  const all = () => elements(harness.value());
  const panel = () => {
    const value = all().find(
      (element) => element.props.accessibilityLabel === "Workspace drawer",
    );
    assert.ok(value);
    return value;
  };
  const offset = () => panel().props.style[1].transform[0].translateY as Value;
  const gesture = (dy: number, vy = 0, dx = 0): Gesture => ({ dx, dy, vy });
  return {
    panel,
    harness,
    handlers: () => handlers,
    all,
    child,
    offset,
    springs,
    timings,
    gesture,
    counts: () => ({ closeAttempts, allowedCloses }),
    blockClose: () => {
      canClose = false;
    },
    backdrop: () => {
      const value = all().find(
        (element) => element.props.accessibilityLabel === "Dismiss drawer",
      );
      assert.ok(value);
      return value;
    },
  };
}

test("the handle claims a deliberate downward drag without claiming taps, horizontal, or upward movement", () => {
  const env = setup();
  const handlers = env.handlers();
  assert.equal("onStartShouldSetPanResponder" in handlers, false);
  for (const gesture of [
    env.gesture(0),
    env.gesture(8),
    env.gesture(-40),
    env.gesture(20, 0, 30),
    env.gesture(20, 0, -20),
  ]) {
    assert.equal(handlers.onMoveShouldSetPanResponder(null, gesture), false);
  }
  assert.equal(
    handlers.onMoveShouldSetPanResponder(null, env.gesture(20, 0, 4)),
    true,
  );
  assert.deepEqual(env.counts(), { closeAttempts: 0, allowedCloses: 0 });
});

test("the management scrim fades independently of the sliding panel and stays opaque when Close is blocked", async () => {
  const env = setup();
  const scrim = env
    .all()
    .find(
      (node) =>
        node.type === "Animated.View" && node.props.pointerEvents === "none",
    );
  assert.ok(scrim);
  const scrimStyle = scrim.props.style[1];
  assert.equal(
    scrimStyle.transform,
    undefined,
    "the background never translates with the sheet",
  );
  assert.equal(env.timings[0]?.from, 844);
  assert.equal(env.timings[0]?.to, 0);
  assert.equal(env.timings[1]?.from, 0);
  assert.equal(env.timings[1]?.to, 1);
  assert.equal(env.timings[1]?.value, scrimStyle.opacity);
  assert.notEqual(scrimStyle.opacity, env.offset());
  env.blockClose();
  env.backdrop().props.onPress();
  await env.harness.settle();
  assert.equal(scrimStyle.opacity.value, 1);
  assert.equal(
    env.timings.length,
    2,
    "a dirty or pending guard cannot fade out the background",
  );
  env.harness.unmount();

  const allowed = setup();
  allowed.backdrop().props.onPress();
  await allowed.harness.settle();
  assert.deepEqual(
    allowed.timings.slice(2).map(({ from, to }) => [from, to]),
    [
      [1, 0],
      [0, 844],
    ],
  );
  assert.deepEqual(allowed.counts(), { closeAttempts: 1, allowedCloses: 1 });
  allowed.harness.unmount();
});

test("an early Close retains the page until its slide finishes and a late animation cannot close an unmounted surface", async () => {
  const env = setup(false, { width: 390, height: 844 }, 47, true);
  env.backdrop().props.onPress();
  env.backdrop().props.onPress();
  await env.harness.settle();
  assert.deepEqual(env.counts(), { closeAttempts: 1, allowedCloses: 0 });
  const [fade, slide] = env.timings.slice(2);
  assert.ok(fade && slide);
  fade.complete();
  assert.equal(env.counts().allowedCloses, 0);
  slide.complete();
  assert.equal(env.counts().allowedCloses, 1);
  env.harness.unmount();

  const removed = setup(false, { width: 390, height: 844 }, 47, true);
  removed.backdrop().props.onPress();
  await removed.harness.settle();
  removed.harness.unmount();
  removed.timings.forEach((animation) => animation.complete());
  assert.equal(removed.counts().allowedCloses, 0);
});

test("gesture ownership is confined to the handle so nested pages keep their own scrolling", () => {
  const env = setup();
  const owners = env
    .all()
    .filter((element) => element.props.onMoveShouldSetPanResponder);
  assert.equal(owners.length, 1);
  assert.equal(owners[0]?.type, "View");
  assert.equal(owners[0]?.props.accessible, false);
  assert.equal(
    env.all().find((element) => element.type === "ChildNavigator"),
    env.child,
  );
  assert.equal("onMoveShouldSetPanResponder" in env.child.props, false);
});

test("a short drag springs back without asking to close the drawer", () => {
  const env = setup();
  env.handlers().onPanResponderMove(null, env.gesture(45));
  assert.equal(env.offset().value, 45);
  env.handlers().onPanResponderRelease(null, env.gesture(45, 0.2));
  assert.equal(env.offset().value, 0);
  assert.deepEqual(env.springs, [
    { toValue: 0, useNativeDriver: true, started: true },
  ]);
  assert.deepEqual(env.counts(), { closeAttempts: 0, allowedCloses: 0 });
});

test("a cancelled drag always springs back, including past the dismissal threshold", () => {
  const env = setup();
  env.handlers().onPanResponderMove(null, env.gesture(120));
  assert.equal(env.offset().value, 120);
  env.handlers().onPanResponderTerminate();
  assert.equal(env.offset().value, 0);
  assert.equal(env.springs.at(-1)?.started, true);
  assert.deepEqual(env.counts(), { closeAttempts: 0, allowedCloses: 0 });
  env.handlers().onPanResponderMove(null, env.gesture(-30));
  assert.equal(
    env.offset().value,
    0,
    "dragging back upward never moves the panel above its resting position",
  );
});

test("distance or downward velocity asks guarded onClose exactly once for each released gesture", async () => {
  for (const release of [
    { dy: 81, vy: 0 },
    { dy: 15, vy: 0.9 },
  ]) {
    const env = setup();
    env.handlers().onPanResponderMove(null, env.gesture(release.dy));
    env
      .handlers()
      .onPanResponderRelease(null, env.gesture(release.dy, release.vy));
    await env.harness.settle();
    assert.deepEqual(env.counts(), { closeAttempts: 1, allowedCloses: 1 });
    assert.equal(env.offset().value, 844);
    assert.equal(env.springs.length, 0);
  }
  const boundary = setup();
  boundary.handlers().onPanResponderRelease(null, boundary.gesture(80, 0.8));
  assert.equal(boundary.counts().closeAttempts, 0);
});

test("a navigation guard rejecting a drag dismissal leaves the panel at rest and mounted", async () => {
  const env = setup();
  env.blockClose();
  env.handlers().onPanResponderMove(null, env.gesture(150));
  env.handlers().onPanResponderRelease(null, env.gesture(150, 1));
  await env.harness.settle();
  assert.deepEqual(env.counts(), { closeAttempts: 1, allowedCloses: 0 });
  assert.equal(env.offset().value, 0);
  assert.equal(env.all().includes(env.child), true);
});

test("the accessible backdrop delegates dismissal through the same guarded onClose", async () => {
  const env = setup();
  assert.equal(env.backdrop().props.accessibilityRole, "button");
  env.blockClose();
  env.backdrop().props.onPress();
  await env.harness.settle();
  assert.deepEqual(env.counts(), { closeAttempts: 1, allowedCloses: 0 });
  assert.equal(env.all().includes(env.child), true);
  assert.equal(env.springs.length, 1);
});

test("drawer geometry clears the top safe area at small, large, short and wide native sizes", () => {
  for (const [width, height, top] of [
    [320, 568, 20],
    [390, 844, 47],
    [430, 932, 59],
    [640, 360, 24],
    [1024, 768, 24],
  ]) {
    const env = setup(false, { width: width!, height: height! }, top!);
    assert.equal(env.panel().props.style[1].height, height! - top! - 10);
    const handle = env
      .all()
      .find((node) => node.props.onMoveShouldSetPanResponder);
    assert.ok(handle);
    assert.equal(handle.props.style.height, 44);
    assert.equal(env.panel().props.style[0].borderTopLeftRadius, 24);
    env.harness.unmount();
  }
});
test("reduced motion dismisses without travelling or springing and accessibility escape shares the guard", async () => {
  const env = setup(true);
  env.handlers().onPanResponderMove(null, env.gesture(150));
  assert.equal(env.offset().value, 0);
  env.blockClose();
  env.all()[0]!.props.onAccessibilityEscape();
  await env.harness.settle();
  assert.deepEqual(env.counts(), { closeAttempts: 1, allowedCloses: 0 });
  assert.equal(env.springs.length, 0);
  assert.equal(env.all()[0]!.props.accessibilityViewIsModal, true);
});
