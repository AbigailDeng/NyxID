import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useChatLayout } from "./ChatLayoutContext";
import {
  chatLayoutBounds,
  offersChatWidth,
  type ChatLayout,
} from "./chatLayout";
import { useTheme } from "../../theme/ThemeContext";
import { fonts } from "../../theme/designTokens";

export function ChatDisplaySettings() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const { layout, update, reset } = useChatLayout();
  function control(key: keyof ChatLayout, label: string, step: number) {
    const [min, max] = chatLayoutBounds[key];
    return (
      <View style={styles.setting} key={key}>
        <Text style={{ color: colors.textPrimary, flex: 1 }}>{label}</Text>
        {([-1, 1] as const).map((direction) => {
          const disabled =
            direction < 0 ? layout[key] <= min : layout[key] >= max;
          return (
            <Pressable
              key={direction}
              accessibilityRole="button"
              accessibilityLabel={`${direction < 0 ? "Decrease" : "Increase"} ${label.toLowerCase()}`}
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() => update({ [key]: layout[key] + direction * step })}
              style={[
                styles.step,
                {
                  backgroundColor: colors.navActive,
                  opacity: disabled ? 0.4 : 1,
                },
              ]}
            >
              <Text style={{ color: colors.textPrimary, fontSize: 22 }}>
                {direction < 0 ? "−" : "+"}
              </Text>
            </Pressable>
          );
        })}
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.textSecondary, minWidth: 48 }}
        >
          {layout[key]} pt
        </Text>
      </View>
    );
  }
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: colors.textPrimary }]}
      >
        Display
      </Text>
      <Text style={{ color: colors.textSecondary }}>
        Chat layout is saved on this device and applies to every conversation.
      </Text>
      {offersChatWidth(width) &&
        control("columnWidth", "Chat column width", 40)}
      {control("composerMaxHeight", "Maximum composer height", 20)}
      <Text style={{ color: colors.textSecondary }}>
        The composer grows with your draft and fits the space above the
        keyboard.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reset chat layout"
        onPress={reset}
        style={[styles.reset, { borderColor: colors.textMuted }]}
      >
        <Text style={{ color: colors.textPrimary }}>Reset chat layout</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 20, gap: 16 },
  title: { fontFamily: fonts.bodySemi, fontSize: 16 },
  setting: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  step: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  reset: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  },
});
