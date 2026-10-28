import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import {
  BackHandler,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useReducedMotion } from "../../lib/accessibility/useReducedMotion";
import { workspaceFocus } from "../../lib/accessibility/workspaceFocus";
import { useTheme } from "../../theme/ThemeContext";
import {
  clampSidebarOffset,
  settleSidebarOpen,
  SIDEBAR_EDGE_WIDTH,
  sidebarPushWidth,
} from "./workspacePushState";

type Props = {
  enabled: boolean;
  visible: boolean;
  presented: boolean;
  gestureEnabled: boolean;
  onOpenChange: (open: boolean) => void;
  onRevealStart: () => void;
  onDismiss: () => void;
  initialFocusTarget: () => number | null;
  sidebar: ReactNode;
  children: ReactNode;
};

/** The sidebar stays still. The actual mounted content moves as one slab. */
export function WorkspacePushShell(props: Props) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const openWidth = sidebarPushWidth(width);
  const visible = props.visible;
  const reduced = useReducedMotion();
  const offset = useSharedValue(0);
  const dragOrigin = useSharedValue(0);
  const generation = useRef(0);
  const dragging = useRef(false);
  const mounted = useRef(true);
  const focusOwner = useRef(Symbol("navigation-sidebar")).current;
  const latest = useRef(props);
  latest.current = props;
  useLayoutEffect(() => {
    workspaceFocus.setModalActive(focusOwner, props.enabled && props.presented);
  }, [focusOwner, props.enabled, props.presented]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      cancelAnimation(offset);
      workspaceFocus.setModalActive(focusOwner, false);
    };
  }, [focusOwner, offset]);

  function finish(id: number, open: boolean) {
    const state = latest.current;
    if (
      !mounted.current ||
      id !== generation.current ||
      !state.enabled ||
      state.visible !== open
    )
      return;
    if (open) {
      workspaceFocus.focusModalOnce(focusOwner, () =>
        latest.current.visible ? latest.current.initialFocusTarget() : null,
      );
    } else if (state.presented) {
      workspaceFocus.setModalActive(focusOwner, false);
      state.onDismiss();
    }
  }
  function animate(open: boolean) {
    const id = ++generation.current;
    const target = open ? openWidth : 0;
    cancelAnimation(offset);
    if (reduced) {
      offset.value = target;
      // The controlled visibility/AX commit must precede focus or navigation.
      requestAnimationFrame(() => finish(id, open));
    } else {
      offset.value = withSpring(
        target,
        { stiffness: 300, damping: 30, mass: 0.8, overshootClamping: true },
        (done) => {
          if (done) runOnJS(finish)(id, open);
        },
      );
    }
  }
  useEffect(() => {
    if (!props.enabled) {
      generation.current++;
      cancelAnimation(offset);
      offset.value = 0;
      return;
    }
    if (!dragging.current) animate(props.visible);
  }, [props.visible, props.enabled, openWidth, reduced]);

  function revealStart() {
    if (
      !latest.current.enabled ||
      !(latest.current.visible || latest.current.gestureEnabled)
    )
      return;
    generation.current++;
    dragging.current = true;
    latest.current.onRevealStart();
  }
  function settle(open: boolean) {
    if (!mounted.current || !latest.current.enabled || !dragging.current)
      return;
    dragging.current = false;
    latest.current.onOpenChange(open);
    animate(open);
  }
  useEffect(() => {
    if (!props.enabled || !props.presented) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        latest.current.onOpenChange(false);
        return true;
      },
    );
    return () => subscription.remove();
  }, [props.enabled, props.presented]);

  const pan = Gesture.Pan()
    .enabled(props.enabled && (props.visible || props.gestureEnabled))
    .activeOffsetX([-8, 8])
    .failOffsetY([-12, 12])
    .onTouchesDown((event, manager) => {
      if (!visible && (event.allTouches[0]?.x ?? Infinity) > SIDEBAR_EDGE_WIDTH)
        manager.fail();
    })
    .onStart(() => {
      cancelAnimation(offset);
      dragOrigin.value = offset.value;
      runOnJS(revealStart)();
    })
    .onUpdate((event) => {
      if (!reduced)
        offset.value = clampSidebarOffset(
          dragOrigin.value + event.translationX,
          openWidth,
        );
    })
    .onEnd((event) => {
      const end = reduced
        ? clampSidebarOffset(dragOrigin.value + event.translationX, openWidth)
        : offset.value;
      runOnJS(settle)(settleSidebarOpen(end, event.velocityX, openWidth));
    })
    .onFinalize((_event, success) => {
      if (!success) runOnJS(settle)(visible);
    });
  const slabStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
    borderTopLeftRadius: offset.value > 0 ? 16 : 0,
    borderBottomLeftRadius: offset.value > 0 ? 16 : 0,
    shadowOpacity: offset.value > 0 ? 0.2 : 0,
  }));
  const clipStyle = useAnimatedStyle(() => ({
    borderTopLeftRadius: offset.value > 0 ? 16 : 0,
    borderBottomLeftRadius: offset.value > 0 ? 16 : 0,
  }));
  const active = props.enabled && props.presented;
  return (
    <View
      style={[styles.root, { backgroundColor: colors.sidebarBase }]}
      onAccessibilityEscape={() => {
        if (active) props.onOpenChange(false);
      }}
    >
      {props.enabled ? (
        <View
          testID="workspace-sidebar-base"
          accessible={false}
          accessibilityElementsHidden={!active}
          importantForAccessibility={active ? "auto" : "no-hide-descendants"}
          pointerEvents={active ? "auto" : "none"}
          style={[styles.sidebar, { width: openWidth }]}
        >
          {props.sidebar}
        </View>
      ) : null}
      <GestureDetector gesture={pan}>
        <Animated.View
          testID="workspace-content-slab"
          style={[
            styles.slab,
            { backgroundColor: colors.bg, shadowColor: colors.shadowColor },
            slabStyle,
          ]}
        >
          <Animated.View
            accessible={false}
            accessibilityElementsHidden={active}
            importantForAccessibility={active ? "no-hide-descendants" : "auto"}
            style={[styles.content, clipStyle]}
          >
            {props.children}
          </Animated.View>
          {active ? (
            <Pressable
              testID="workspace-sidebar-close-sliver"
              accessibilityRole="button"
              accessibilityLabel="Close navigation"
              onPress={() => props.onOpenChange(false)}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden" },
  sidebar: { position: "absolute", top: 0, bottom: 0, left: 0 },
  slab: {
    flex: 1,
    shadowOffset: { width: -3, height: 0 },
    shadowRadius: 12,
    elevation: 2,
  },
  content: { flex: 1, overflow: "hidden" },
});
