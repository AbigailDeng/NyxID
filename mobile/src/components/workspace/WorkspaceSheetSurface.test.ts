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

function setup() {
  let handlers!: PanHandlers;
  let closeAttempts = 0;
  let allowedCloses = 0;
  let canClose = true;
  const springs: {
    toValue: number;
    useNativeDriver: boolean;
    started: boolean;
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
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": {
      View: "View",
      Pressable: "Pressable",
      Animated: {
        Value,
        View: "Animated.View",
        spring: (
          value: Value,
          config: { toValue: number; useNativeDriver: boolean },
        ) => {
          const entry = { ...config, started: false };
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
    "react-native-safe-area-context": { SafeAreaProvider: "SafeAreaProvider" },
    "../../theme/ThemeContext": {
      useTheme: () => ({
        colors: { bg: "white", overlayBg: "black", textMuted: "gray" },
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
    children: Element;
  }) => Element;
  harness.mount(() =>
    component({
      children: child,
      onClose: () => {
        closeAttempts++;
        if (canClose) allowedCloses++;
      },
    }),
  );
  const all = () => elements(harness.value());
  const panel = () => {
    const value = all().find((element) => element.type === "Animated.View");
    assert.ok(value);
    return value;
  };
  const offset = () => panel().props.style[1].transform[0].translateY as Value;
  const gesture = (dy: number, vy = 0, dx = 0): Gesture => ({ dx, dy, vy });
  return {
    harness,
    handlers: () => handlers,
    all,
    child,
    offset,
    springs,
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

test("distance or downward velocity asks guarded onClose exactly once for each released gesture", () => {
  for (const release of [
    { dy: 81, vy: 0 },
    { dy: 15, vy: 0.9 },
  ]) {
    const env = setup();
    env.handlers().onPanResponderMove(null, env.gesture(release.dy));
    env
      .handlers()
      .onPanResponderRelease(null, env.gesture(release.dy, release.vy));
    assert.deepEqual(env.counts(), { closeAttempts: 1, allowedCloses: 1 });
    assert.equal(env.offset().value, 0);
    assert.equal(env.springs.length, 1);
  }
  const boundary = setup();
  boundary.handlers().onPanResponderRelease(null, boundary.gesture(80, 0.8));
  assert.equal(boundary.counts().closeAttempts, 0);
});

test("a navigation guard rejecting a drag dismissal leaves the panel at rest and mounted", () => {
  const env = setup();
  env.blockClose();
  env.handlers().onPanResponderMove(null, env.gesture(150));
  env.handlers().onPanResponderRelease(null, env.gesture(150, 1));
  assert.deepEqual(env.counts(), { closeAttempts: 1, allowedCloses: 0 });
  assert.equal(env.offset().value, 0);
  assert.equal(env.all().includes(env.child), true);
});

test("the accessible backdrop delegates dismissal through the same guarded onClose", () => {
  const env = setup();
  assert.equal(env.backdrop().props.accessibilityRole, "button");
  env.blockClose();
  env.backdrop().props.onPress();
  assert.deepEqual(env.counts(), { closeAttempts: 1, allowedCloses: 0 });
  assert.equal(env.all().includes(env.child), true);
  assert.deepEqual(env.springs, []);
});
