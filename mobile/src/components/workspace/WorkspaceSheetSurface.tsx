import { useMemo, useRef, type PropsWithChildren } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useTheme } from "../../theme/ThemeContext";

/** A shared pull-up surface keeps dragging and guarded dismissal consistent. */
export function WorkspaceSheetSurface({
  children,
  onClose,
}: PropsWithChildren<{ onClose: () => void }>) {
  const { colors } = useTheme();
  const offset = useRef(new Animated.Value(0)).current;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dy > 8 && gesture.dy > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) =>
          offset.setValue(Math.max(0, gesture.dy)),
        onPanResponderRelease: (_, gesture) => {
          Animated.spring(offset, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
          if (gesture.dy > 80 || gesture.vy > 0.8) onClose();
        },
        onPanResponderTerminate: () =>
          Animated.spring(offset, {
            toValue: 0,
            useNativeDriver: true,
          }).start(),
      }),
    [offset, onClose],
  );
  const content = (
    <SafeAreaProvider style={styles.fill}>
      <View {...pan.panHandlers} accessible={false} style={styles.handleArea}>
        <View style={[styles.handle, { backgroundColor: colors.textMuted }]} />
      </View>
      <View style={styles.fill}>{children}</View>
    </SafeAreaProvider>
  );
  return (
    <View style={styles.overlay}>
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlayBg }]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss drawer"
        onPress={onClose}
        style={styles.dismissArea}
      />
      <Animated.View
        style={[
          styles.panel,
          { backgroundColor: colors.bg, transform: [{ translateY: offset }] },
        ]}
      >
        {content}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { flex: 1, justifyContent: "flex-end" },
  dismissArea: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "8%",
    zIndex: 1,
  },
  panel: {
    height: "92%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
  },
  handleArea: {
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  handle: { width: 36, height: 4, borderRadius: 2, opacity: 0.45 },
});
