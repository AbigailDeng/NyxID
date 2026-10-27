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
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { workspaceFocus } from "../../lib/accessibility/workspaceFocus";

export function WorkspaceDrawerModal({
  visible,
  onClose,
  onDismiss,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
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
  const [presentationId, setPresentationId] = useState(0);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const focusOwner = useRef(Symbol("navigation-modal")).current;

  useLayoutEffect(() => {
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
    // Reopening gets a new native modal/accessibility owner after full dismissal.
    setPresentationId((previous) => previous + 1);
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
    // Android has no native onDismiss event. Its Modal is removed in the
    // mounted=false commit, so wait for that commit before opening another.
    if (!mounted && Platform.OS !== "ios") notifyDismissed();
  }, [mounted, notifyDismissed]);

  useEffect(() => {
    if (!visible && !presented) {
      progress.setValue(0);
      setMounted(false);
      return;
    }
    if (!mounted || !presented || reduceMotion === null) return;

    let active = true;
    const finishClose = () => {
      if (active && !visibleRef.current) {
        setPresented(false);
        setMounted(false);
      }
    };
    if (reduceMotion) {
      progress.setValue(visible ? 1 : 0);
      finishClose();
      return;
    }

    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? 250 : 200,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) finishClose();
    });
    return () => {
      // A new visibility value may reverse a still-running native animation.
      active = false;
      animation.stop();
    };
  }, [mounted, presented, progress, reduceMotion, visible]);

  return (
    <Modal
      key={presentationId}
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      onDismiss={Platform.OS === "ios" ? notifyDismissed : undefined}
      onShow={() => {
        // Wait for the native modal to appear before starting the entrance.
        if (visibleRef.current) setPresented(true);
        else setMounted(false);
      }}
    >
      {/* A modal has its own native root, including its safe-area measurements. */}
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
