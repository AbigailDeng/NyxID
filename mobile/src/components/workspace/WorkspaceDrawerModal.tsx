import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";
import { workspaceFocus } from "../../lib/accessibility/workspaceFocus";

export function WorkspaceDrawerModal({
  visible,
  onClose,
  onDismiss,
  initialFocusTarget,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  initialFocusTarget: () => number | null;
  children: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(width * 0.86, 360);
  const progress = useRef(new Animated.Value(0)).current;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const dismissalPending = useRef(visible);
  const [mounted, setMounted] = useState(visible);
  const [presented, setPresented] = useState(false);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const focusOwner = useRef(Symbol("navigation-modal")).current;
  const focusRevision = useRef(0);
  const focusTargetRef = useRef(initialFocusTarget);
  focusTargetRef.current = initialFocusTarget;

  useLayoutEffect(() => {
    focusRevision.current++;
    if (visible) workspaceFocus.setModalActive(focusOwner, true);
  }, [focusOwner, visible]);
  useLayoutEffect(
    () => () => workspaceFocus.setModalActive(focusOwner, false),
    [focusOwner],
  );

  const notifyDismissed = useCallback(() => {
    if (visibleRef.current || !dismissalPending.current) return;
    dismissalPending.current = false;
    workspaceFocus.setModalActive(focusOwner, false);
    onDismissRef.current?.();
  }, [focusOwner]);

  useEffect(() => {
    let active = true;
    let receivedChange = false;
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (enabled) => {
        if (!active) return;
        receivedChange = true;
        setReduceMotion(enabled);
      },
    );
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active && !receivedChange) setReduceMotion(enabled);
      })
      .catch(() => {
        if (active && !receivedChange) setReduceMotion(false);
      });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (visible) {
      dismissalPending.current = true;
      setMounted(true);
    }
  }, [visible]);

  useEffect(() => {
    // Both native hosts are removed in the mounted=false commit. Wait for
    // that commit before handing navigation to the next destination.
    if (!mounted) notifyDismissed();
  }, [mounted, notifyDismissed]);

  useEffect(() => {
    if (!visible && !presented) {
      progress.setValue(0);
      setMounted(false);
      return;
    }
    if (!mounted || !presented || reduceMotion === null) return;

    let active = true;
    const finishTransition = () => {
      if (!active) return;
      if (visibleRef.current) {
        const admittedRevision = focusRevision.current;
        workspaceFocus.focusModalOnce(focusOwner, () =>
          visibleRef.current && focusRevision.current === admittedRevision
            ? focusTargetRef.current()
            : null,
        );
      } else {
        setPresented(false);
        setMounted(false);
      }
    };
    if (reduceMotion) {
      progress.setValue(visible ? 1 : 0);
      finishTransition();
      return;
    }

    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? 250 : 200,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) finishTransition();
    });
    return () => {
      // A new visibility value may reverse a still-running native animation.
      active = false;
      animation.stop();
    };
  }, [focusOwner, mounted, presented, progress, reduceMotion, visible]);

  const onPresented = () => {
    if (visibleRef.current) setPresented(true);
    else setMounted(false);
  };
  const content = (
    <View
      collapsable={false}
      accessible={false}
      style={styles.root}
      onLayout={Platform.OS === "ios" ? onPresented : undefined}
      onAccessibilityEscape={onClose}
    >
      <SafeAreaProvider style={styles.root}>
        <Animated.View
          pointerEvents="none"
          style={[styles.backdrop, { opacity: progress }]}
        />
        <Pressable
          accessibilityLabel="Close navigation"
          accessibilityRole="button"
          disabled={!visible}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          accessible={false}
          pointerEvents={visible ? "auto" : "none"}
          style={[
            styles.panel,
            {
              width: panelWidth,
              transform: [
                {
                  translateX: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-panelWidth, 0],
                  }),
                },
              ],
            },
          ]}
        >
          {children}
        </Animated.View>
      </SafeAreaProvider>
    </View>
  );
  if (Platform.OS === "ios") {
    return mounted ? <FullWindowOverlay>{content}</FullWindowOverlay> : null;
  }
  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      onShow={onPresented}
    >
      {content}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  panel: { flex: 1 },
});
