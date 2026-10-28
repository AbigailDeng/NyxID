import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import { fonts } from "../../theme/designTokens";
import { AssistantCopyButton } from "./AssistantCopyButton";
import { AssistantReplyFeedback } from "./AssistantReplyFeedback";
import { messageTime } from "./messageTime";
import type { FeedbackVote } from "./assistantFeedback";

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

/** Assistant: Copy, votes, time. Human: time, Copy. Crew agents keep time in attribution. */
export function AssistantMessageFooter({
  text,
  timestamp,
  user,
  feedback,
  disabled,
  onFeedback,
}: {
  text: string;
  timestamp?: string | number | null;
  user?: boolean;
  feedback?: { vote: FeedbackVote } | null;
  disabled?: boolean;
  onFeedback?: (vote?: FeedbackVote, comment?: string) => Promise<boolean>;
}) {
  const copy = <AssistantCopyButton text={text} />;
  const time = <AssistantMessageTime value={timestamp} />;
  return onFeedback && !user ? (
    <AssistantReplyFeedback
      feedback={feedback}
      disabled={disabled}
      onSave={onFeedback}
      beforeVotes={copy}
      afterVotes={time}
    />
  ) : (
    <View style={[styles.row, user && styles.userRow]}>
      {user ? time : copy}
      {user ? copy : time}
    </View>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  userRow: { justifyContent: "flex-end" },
  timeTarget: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  time: { fontFamily: fonts.bodyRegular, fontSize: 11 },
});
