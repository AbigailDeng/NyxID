import { useWorkspaceAccessibility } from "../../lib/accessibility/workspaceAccessibility";
import { workspaceFocus } from "../../lib/accessibility/workspaceFocus";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type RefObject,
} from "react";
import {
  Animated,
  BackHandler,
  PanResponder,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useReducedMotion } from "../../lib/accessibility/useReducedMotion";
import { SheetThemeProvider, useTheme } from "../../theme/ThemeContext";
import { darkSheetColors, lightSheetColors } from "../../theme/mobileTheme";

export type WorkspaceSheetHandle = { dismiss: () => void };

/** Handle gestures never compete with form scrolling or text selection. */
export function WorkspaceSheetSurface({
  children,
  onClose,
  canClose,
  controller,
  canHandleHardwareBack,
}: PropsWithChildren<{
  onClose: () => void;
  canClose?: () => Promise<boolean>;
  canHandleHardwareBack?: () => boolean;
  controller?: RefObject<WorkspaceSheetHandle | null>;
}>) {
  const { colors, mode } = useTheme();
  const sheet = mode === "light" ? lightSheetColors : darkSheetColors;
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const offset = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const [interacting, setInteracting] = useState(true);
  const mounted = useRef(true);
  const { primaryKey } = useWorkspaceAccessibility();
  const [focusReturn] = useState(() => workspaceFocus.capture(primaryKey));
  const dismissed = useRef(false);
  const reset = useCallback(() => {
    if (reduced) offset.setValue(0);
    else
      Animated.spring(offset, {
        toValue: 0,
        useNativeDriver: true,
        overshootClamping: true,
      }).start();
  }, [offset, reduced]);
  const dismiss = useCallback(async () => {
    if (closing.current) return;
    closing.current = true;
    setInteracting(false);
    let allowed = false;
    try {
      allowed = canClose ? await canClose() : true;
    } catch {
      /* A failed guard keeps the editor mounted. */
    }
    if (!mounted.current) return;
    if (!allowed) {
      closing.current = false;
      setInteracting(true);
      reset();
      return;
    }
    if (reduced) {
      dismissed.current = true;
      onClose();
      return;
    }
    Animated.timing(offset, {
      toValue: height,
      duration: 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && mounted.current) {
        dismissed.current = true;
        onClose();
      }
    });
  }, [canClose, height, offset, onClose, reduced, reset]);
  useEffect(() => {
    if (controller) controller.current = { dismiss: () => void dismiss() };
    return () => {
      if (controller) controller.current = null;
    };
  }, [controller, dismiss]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (dismissed.current) workspaceFocus.restore(focusReturn);
    };
  }, []);
  // Register before passive child handlers so local form Back takes precedence.
  useLayoutEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (canHandleHardwareBack && !canHandleHardwareBack()) return false;
        void dismiss();
        return true;
      },
    );
    return () => subscription.remove();
  }, [canHandleHardwareBack, dismiss]);
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          !closing.current &&
          gesture.dy > 8 &&
          gesture.dy > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          if (!closing.current && !reduced)
            offset.setValue(Math.max(0, gesture.dy));
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 80 || gesture.vy > 0.8) void dismiss();
          else reset();
        },
        onPanResponderTerminate: reset,
      }),
    [dismiss, offset, reduced, reset],
  );
  const gap = insets.top + 10;
  return (
    <View
      style={styles.overlay}
      accessibilityViewIsModal
      onAccessibilityEscape={() => void dismiss()}
    >
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: colors.sheetScrim },
        ]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss drawer"
        onPress={() => void dismiss()}
        style={[styles.dismissArea, { height: gap }]}
      />
      <Animated.View
        pointerEvents={interacting ? "auto" : "none"}
        accessible={false}
        accessibilityLabel="Workspace drawer"
        style={[
          styles.panel,
          {
            height: Math.max(0, height - gap),
            backgroundColor: sheet.bg,
            shadowColor: colors.shadowColor,
            transform: [{ translateY: offset }],
          },
          mode === "light" && styles.lightLift,
        ]}
      >
        <View
          style={[
            styles.surface,
            { backgroundColor: sheet.bg, borderColor: colors.sheetEdge },
          ]}
        >
          <SafeAreaProvider
            style={styles.fill}
            initialMetrics={{
              frame: { x: 0, y: gap, width, height: Math.max(0, height - gap) },
              insets: {
                top: 0,
                left: insets.left,
                right: insets.right,
                bottom: insets.bottom,
              },
            }}
          >
            <SheetThemeProvider>
              <View
                {...pan.panHandlers}
                accessible={false}
                style={styles.handleArea}
              >
                <View
                  style={[
                    styles.handle,
                    { backgroundColor: sheet.textSecondary },
                  ]}
                />
              </View>
              <View style={styles.fill}>{children}</View>
            </SheetThemeProvider>
          </SafeAreaProvider>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { flex: 1, justifyContent: "flex-end" },
  dismissArea: { position: "absolute", top: 0, left: 0, right: 0 },
  // The outer panel carries the light-mode shadow, so only the inner surface clips.
  panel: { borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  lightLift: {
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 1,
    shadowRadius: 16,
    elevation: 16,
  },
  surface: {
    flex: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    overflow: "hidden",
  },
  handleArea: { height: 44, alignItems: "center", justifyContent: "center" },
  handle: { width: 36, height: 4, borderRadius: 2 },
});
