export type FeedbackVote = "up" | "down";
export const FEEDBACK_REASONS = {
  up: ["Useful", "Accurate", "Easy to understand"],
  down: ["Not useful", "Not accurate", "Bad response", "Hard to understand"],
} as const;
export function feedbackComment(reasons: readonly string[], note: string) {
  const tags = reasons.join(", ");
  const text = note.trim();
  return tags && text ? `${tags} — ${text}` : tags || text;
}
export function feedbackNoteLimit(vote: FeedbackVote) {
  return 1000 - FEEDBACK_REASONS[vote].join(", ").length - " — ".length;
}

/** Replay/legacy renders have no first-party NyxAgent feedback scope. */
export function canReplyFeedback(
  message: {
    role: string;
    status: string;
    error_code?: string | null;
    text: string;
    continuation_of?: string | null;
  },
  conversationId?: string,
  replay = false,
) {
  return (
    !!conversationId?.match(/^nyxa-[a-fA-F0-9]{32}$/) &&
    !replay &&
    message.role === "assistant" &&
    message.status === "completed" &&
    !message.error_code &&
    !message.continuation_of &&
    !!message.text.trim()
  );
}
