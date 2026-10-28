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
  withTiming,
  Easing,
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
  /** A native Settings modal owns input without changing the sidebar endpoint. */
  obscured?: boolean;
  onOpenChange: (open: boolean) => void;
  onRevealStart: () => void;
  onEdgeBack?: () => void;
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
  const edgeBack = Boolean(props.onEdgeBack) && !visible;
  const reduced = useReducedMotion();
  const offset = useSharedValue(0);
  const dragOrigin = useSharedValue(0);
  const programmatic = useSharedValue(false);
  const dragActive = useSharedValue(false);
  const transition = useSharedValue(0);
  const endpoint = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  const dragging = useRef(false);
  const mounted = useRef(true);
  const focusOwner = useRef(Symbol("navigation-sidebar")).current;
  const latest = useRef(props);
  latest.current = props;
  useLayoutEffect(() => {
    workspaceFocus.setModalActive(
      focusOwner,
      props.enabled && props.presented && !props.obscured,
    );
  }, [focusOwner, props.enabled, props.presented, props.obscured]);
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
        latest.current.visible && !latest.current.obscured
          ? latest.current.initialFocusTarget()
          : null,
      );
    } else if (state.presented) {
      workspaceFocus.setModalActive(focusOwner, false);
      state.onDismiss();
    }
  }
  function animate(open: boolean, fingerRelease = false) {
    endpoint.current = `${open}:${openWidth}:${reduced}`;
    const id = ++generation.current;
    const target = open ? openWidth : 0;
    cancelAnimation(offset);
    transition.value = id;
    programmatic.value = !fingerRelease && !reduced;
    if (reduced) {
      offset.value = target;
      // The controlled visibility/AX commit must precede focus or navigation.
      requestAnimationFrame(() => finish(id, open));
    } else {
      const complete = (done?: boolean) => {
        "worklet";
        if (transition.value !== id) return;
        programmatic.value = false;
        if (done) runOnJS(finish)(id, open);
      };
      offset.value = fingerRelease
        ? withSpring(
            target,
            { stiffness: 300, damping: 30, mass: 0.8, overshootClamping: true },
            complete,
          )
        : withTiming(
            target,
            { duration: 300, easing: Easing.bezier(0.2, 0.8, 0.2, 1) },
            complete,
          );
    }
  }
  useEffect(() => {
    if (!props.enabled) {
      generation.current++;
      cancelAnimation(offset);
      offset.value = 0;
      programmatic.value = false;
      endpoint.current = undefined;
      return;
    }
    const next = `${props.visible}:${openWidth}:${reduced}`;
    if (!dragging.current && endpoint.current !== next) {
      if (!props.presented && !props.visible && offset.value === 0)
        endpoint.current = next;
      else animate(props.visible);
    }
  }, [props.visible, props.enabled, openWidth, reduced]);

  function revealStart() {
    if (
      !latest.current.enabled ||
      latest.current.obscured ||
      !(latest.current.visible || latest.current.gestureEnabled)
    )
      return;
    generation.current++;
    dragging.current = true;
    if (!latest.current.onEdgeBack || latest.current.visible)
      latest.current.onRevealStart();
  }
  function finishBack(translation: number, velocity: number) {
    if (!mounted.current || !dragging.current || !latest.current.enabled)
      return;
    dragging.current = false;
    if (translation > 40 || (translation > 8 && velocity > 500))
      latest.current.onEdgeBack?.();
  }
  function settle(open: boolean) {
    if (!mounted.current || !latest.current.enabled || !dragging.current)
      return;
    dragging.current = false;
    latest.current.onOpenChange(open);
    animate(open, true);
  }
  useEffect(() => {
    if (!props.enabled || !props.presented || props.obscured) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        latest.current.onOpenChange(false);
        return true;
      },
    );
    return () => subscription.remove();
  }, [props.enabled, props.presented, props.obscured]);

  // These detectors live on dedicated edge/sliver targets, never above a
  // transcript, code/table ScrollView or composer in the responder hierarchy.
  const pan = Gesture.Pan()
    .enabled(
      props.enabled &&
        !props.obscured &&
        (visible ? props.presented : props.gestureEnabled),
    )
    .activeOffsetX(visible ? -18 : 18)
    .failOffsetY([-10, 10])
    .onTouchesDown((_event, manager) => {
      if (programmatic.value) manager.fail();
    })
    .onStart(() => {
      if (programmatic.value) return;
      dragActive.value = true;
      cancelAnimation(offset);
      dragOrigin.value = offset.value;
      runOnJS(revealStart)();
    })
    .onUpdate((event) => {
      if (dragActive.value && !edgeBack && !reduced)
        offset.value = clampSidebarOffset(
          dragOrigin.value + event.translationX,
          openWidth,
        );
    })
    .onEnd((event) => {
      if (!dragActive.value) return;
      dragActive.value = false;
      if (edgeBack) {
        runOnJS(finishBack)(event.translationX, event.velocityX);
        return;
      }
      const end = reduced
        ? clampSidebarOffset(dragOrigin.value + event.translationX, openWidth)
        : offset.value;
      runOnJS(settle)(settleSidebarOpen(end, event.velocityX, openWidth));
    })
    .onFinalize((_event, success) => {
      if (!success && dragActive.value) {
        dragActive.value = false;
        if (edgeBack) runOnJS(finishBack)(0, 0);
        else runOnJS(settle)(visible);
      }
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
  const sidebarInteractive = active && !props.obscured;
  return (
    <View
      style={[styles.root, { backgroundColor: colors.sidebarBase }]}
      pointerEvents={props.obscured ? "none" : "auto"}
      accessibilityElementsHidden={Boolean(props.obscured)}
      importantForAccessibility={
        props.obscured ? "no-hide-descendants" : "auto"
      }
      onAccessibilityEscape={() => {
        if (sidebarInteractive) props.onOpenChange(false);
      }}
    >
      {props.enabled ? (
        <View
          testID="workspace-sidebar-base"
          accessible={false}
          accessibilityElementsHidden={!sidebarInteractive}
          importantForAccessibility={
            sidebarInteractive ? "auto" : "no-hide-descendants"
          }
          pointerEvents={sidebarInteractive ? "auto" : "none"}
          style={[styles.sidebar, { width: openWidth }]}
        >
          {props.sidebar}
        </View>
      ) : null}
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
        {props.enabled &&
        !props.obscured &&
        (active || props.gestureEnabled) ? (
          <GestureDetector gesture={pan}>
            <Pressable
              testID={
                active
                  ? "workspace-sidebar-close-sliver"
                  : "workspace-sidebar-reveal-edge"
              }
              accessible={active}
              accessibilityRole={active ? "button" : undefined}
              accessibilityLabel={active ? "Close navigation" : undefined}
              onPress={active ? () => props.onOpenChange(false) : undefined}
              style={active ? StyleSheet.absoluteFill : styles.edge}
            />
          </GestureDetector>
        ) : null}
      </Animated.View>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden" },
  edge: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: SIDEBAR_EDGE_WIDTH,
  },
  sidebar: { position: "absolute", top: 0, bottom: 0, left: 0 },
  slab: {
    flex: 1,
    shadowOffset: { width: -3, height: 0 },
    shadowRadius: 12,
    elevation: 2,
  },
  content: { flex: 1, overflow: "hidden" },
});
