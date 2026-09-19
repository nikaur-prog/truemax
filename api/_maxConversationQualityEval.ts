import type { ConversationQualityCase } from "./_maxConversationQuality.fixtures.js";

export interface ConversationReplyReview {
  id: string;
  words: number;
  questions: number;
  mechanicalFlags: string[];
  humanReviewRequired: true;
  reviewCriteria: string[];
}

/** Cheap lint signals for actual captured replies. An unflagged reply still needs semantic review. */
export function reviewConversationReply(scenario: ConversationQualityCase, reply: string): ConversationReplyReview {
  const text = reply.trim();
  const words = text ? text.split(/\s+/u).length : 0;
  const questions = (text.match(/\?/g) ?? []).length;
  const mechanicalFlags: string[] = [];
  if (!text) mechanicalFlags.push("Empty response");
  if (words > scenario.maxWords) mechanicalFlags.push(`Over the case's ${scenario.maxWords}-word review limit`);
  if (questions > (scenario.maxQuestions ?? 1)) mechanicalFlags.push("More questions than the case calls for");
  if (/\u2014/u.test(text)) mechanicalFlags.push("Contains an em dash");
  if (/(?:^|\n)\s*(?:#{1,6}\s|\d+[.)]\s)|\*\*|```/u.test(text)) mechanicalFlags.push("Uses formatting the chat bubble does not render");
  if (/^(?:hey|hi|hello|great question|you(?:'ve| have) got this|let's crush it|absolutely[!,]|love (?:that|this))\b/i.test(text)) {
    mechanicalFlags.push("Starts with a greeting or stock encouragement rather than the answer");
  }
  if (/\b(?:bro|buddy|mate)\b/i.test(text)) mechanicalFlags.push("Uses an overfamiliar form of address");
  for (const check of scenario.flagPatterns ?? []) {
    if (check.pattern.test(text)) mechanicalFlags.push(check.reason);
  }
  return { id: scenario.id, words, questions, mechanicalFlags, humanReviewRequired: true, reviewCriteria: [...scenario.reviewCriteria] };
}
