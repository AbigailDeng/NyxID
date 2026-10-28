import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import { fonts } from "../../theme/designTokens";
import { AssistantCopyButton } from "./AssistantCopyButton";
import { messageTime } from "./messageTime";

export function AssistantMessageTime({
  value,
}: {
  value?: string | number | null;
}) {
  const { colors } = useTheme();
  const time = messageTime(value);
  if (!time) return null;
  return (
    <Pressable
      accessibilityRole="text"
      accessibilityLabel={time.label}
      accessibilityHint="Touch and hold for the full date and time"
      onLongPress={() => Alert.alert("Message sent", time.label)}
      style={styles.timeTarget}
    >
      <Text style={[styles.time, { color: colors.textMuted }]}>
        {time.short}
      </Text>
    </Pressable>
  );
}

/** Native replies intentionally offer Copy and date, without reply voting. */
export function AssistantMessageFooter({
  text,
  timestamp,
  user,
}: {
  text: string;
  timestamp?: string | number | null;
  user?: boolean;
}) {
  const copy = <AssistantCopyButton text={text} afterDate={user} />;
  const time = <AssistantMessageTime value={timestamp} />;
  return (
    <View style={[styles.row, user && styles.userRow]}>
      {user ? time : copy}
      {user ? copy : time}
    </View>
  );
}
const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  userRow: { justifyContent: "flex-end" },
  timeTarget: {
    justifyContent: "center",
  },
  time: { fontFamily: fonts.bodyRegular, fontSize: 11 },
});
