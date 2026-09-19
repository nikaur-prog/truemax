import { maxReplyText } from "./maxReplyText.js";

// Shared by the server and chat UI. A transport-level failure is not a new
// coaching answer and must not become a successful local conversation turn.
export const MAX_REPLY_EMPTY = "No reply came through. Please try again.";
export const MAX_REPLY_UNAVAILABLE = "Max is unavailable right now. Please try again later.";
export const MAX_REPLY_INTERRUPTED = "That reply was interrupted. Ask me to continue or try again.";
export const MAX_REPLY_LIMIT = "I reached the reply limit there. Ask me to continue.";
export const MAX_REPLY_NOT_SAVED = "This reply could not be saved to your chat history. Please try again later.";

/** Only whole undelivered notices count as errors; useful partial replies stay. */
export function maxUndeliveredReply(text: string): string | null {
  const visible = maxReplyText(text).replace(/[\u200b-\u200f\u2060\ufeff]/gu, "").trim();
  if (visible === MAX_REPLY_EMPTY) return MAX_REPLY_EMPTY;
  if (visible === MAX_REPLY_UNAVAILABLE) return MAX_REPLY_UNAVAILABLE;
  return null;
}
