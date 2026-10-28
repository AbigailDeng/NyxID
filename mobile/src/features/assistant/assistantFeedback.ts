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
