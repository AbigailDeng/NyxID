import { useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { ThumbsDown, ThumbsUp } from "lucide-react-native";
import {
  ActionButton,
  Card,
  Field,
  Label,
} from "../../components/workspace/WorkspaceUI";
import { useTheme } from "../../theme/ThemeContext";
import {
  FEEDBACK_REASONS,
  feedbackComment,
  feedbackNoteLimit,
  type FeedbackVote,
} from "./assistantFeedback";

/** Mutation stays with the private/crew runtime, which fences account and thread changes. */
export function AssistantReplyFeedback({
  feedback,
  disabled,
  onSave,
  beforeVotes,
  afterVotes,
}: {
  beforeVotes?: ReactNode;
  afterVotes?: ReactNode;
  feedback?: { vote: FeedbackVote } | null;
  disabled?: boolean;
  onSave: (vote?: FeedbackVote, comment?: string) => Promise<boolean>;
}) {
  const { colors } = useTheme();
  const [vote, setVote] = useState(feedback?.vote);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [thanks, setThanks] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  useEffect(() => {
    if (!lock.current) setVote(feedback?.vote);
  }, [feedback?.vote]);
  async function save(next?: FeedbackVote, comment?: string) {
    if (disabled || lock.current) return false;
    lock.current = true;
    setPending(true);
    try {
      return await onSave(next, comment);
    } catch {
      return false;
    } finally {
      lock.current = false;
      if (mounted.current) setPending(false);
    }
  }
  async function toggle(next: FeedbackVote) {
    if (disabled || lock.current) return;
    const previous = vote;
    const selected = next === previous ? undefined : next;
    setVote(selected);
    setOpen(!!selected);
    setChosen([]);
    setNote("");
    setThanks(false);
    const saved = await save(selected);
    if (!mounted.current) return;
    setError(!saved);
    if (!saved) {
      setVote(previous);
      setOpen(false);
    }
  }
  return (
    <View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          flexWrap: "wrap",
        }}
      >
        {beforeVotes}
        <View
          accessibilityLabel="Reply feedback"
          style={{ flexDirection: "row", gap: 4 }}
        >
          {(["up", "down"] as const).map((next) => {
            const Icon = next === "up" ? ThumbsUp : ThumbsDown;
            return (
              <Pressable
                key={next}
                accessibilityRole="button"
                accessibilityLabel={next === "up" ? "Helpful" : "Not helpful"}
                accessibilityState={{
                  selected: vote === next,
                  disabled: !!disabled || pending,
                }}
                disabled={disabled || pending}
                style={{
                  width: 44,
                  height: 44,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: disabled || pending ? 0.4 : 1,
                }}
                onPress={() => void toggle(next)}
              >
                <Icon
                  size={16}
                  color={
                    vote === next
                      ? next === "up"
                        ? colors.successTone.text
                        : colors.dangerTone.text
                      : colors.textMuted
                  }
                />
              </Pressable>
            );
          })}
        </View>
        {afterVotes}
      </View>
      {error ? (
        <Label accessibilityRole="alert" style={{ color: colors.danger }}>
          Unable to save feedback. Try again.
        </Label>
      ) : null}
      {thanks ? (
        <Label accessibilityLiveRegion="polite" muted>
          Thanks for the feedback.
        </Label>
      ) : null}
      <Modal
        visible={open && !!vote}
        presentationStyle="pageSheet"
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            padding: 24,
            gap: 16,
            backgroundColor: colors.bg,
            flexGrow: 1,
          }}
        >
          <Label accessibilityRole="header">
            {vote === "up"
              ? "Give positive feedback"
              : "Give negative feedback"}
          </Label>
          <Label muted>
            {vote === "up"
              ? "What did you like about this reply? Choose any that apply."
              : "What went wrong with this reply? Choose any that apply."}
          </Label>
          <View
            accessibilityLabel="Reasons"
            style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
          >
            {vote &&
              FEEDBACK_REASONS[vote].map((reason) => (
                <Pressable
                  key={reason}
                  accessibilityRole="button"
                  accessibilityLabel={reason}
                  accessibilityState={{
                    selected: chosen.includes(reason),
                    disabled: pending,
                  }}
                  disabled={pending}
                  style={{ minHeight: 44, justifyContent: "center" }}
                  onPress={() =>
                    setChosen((old) =>
                      old.includes(reason)
                        ? old.filter((x) => x !== reason)
                        : [...old, reason],
                    )
                  }
                >
                  <Card
                    style={{
                      paddingVertical: 8,
                      backgroundColor: chosen.includes(reason)
                        ? colors.primaryTone.bg
                        : colors.card,
                    }}
                  >
                    <Label>{reason}</Label>
                  </Card>
                </Pressable>
              ))}
          </View>
          <Field
            label="Details (optional)"
            multiline
            value={note}
            editable={!pending}
            maxLength={vote ? feedbackNoteLimit(vote) : 0}
            onChangeText={setNote}
            placeholder={
              vote === "up"
                ? "What was satisfying about this reply?"
                : "What should the reply have done instead?"
            }
          />
          {error ? (
            <Label accessibilityRole="alert" style={{ color: colors.danger }}>
              Unable to save feedback. Try again.
            </Label>
          ) : null}
          <ActionButton
            label="Cancel"
            variant="secondary"
            onPress={() => setOpen(false)}
          />
          <ActionButton
            label="Submit"
            loading={pending}
            disabled={disabled || pending}
            onPress={() => {
              if (!vote || lock.current) return;
              const comment = feedbackComment(
                FEEDBACK_REASONS[vote].filter((reason) =>
                  chosen.includes(reason),
                ),
                note,
              );
              void (comment ? save(vote, comment) : Promise.resolve(true)).then(
                (saved) => {
                  if (!mounted.current) return;
                  setError(!saved);
                  if (saved) {
                    setOpen(false);
                    setThanks(true);
                  }
                },
              );
            }}
          />
        </ScrollView>
      </Modal>
    </View>
  );
}
