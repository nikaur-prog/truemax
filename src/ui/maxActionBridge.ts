// The model writes advice; the product owns what can become a tracked action.
// This deliberately detects the person's request rather than parsing Max's
// prose. A generated sentence must never become profile state by accident.

const PLAN_REQUESTS = [
  /\b(?:make|build|create|give|write|put together)\s+(?:me\s+)?(?:a\s+)?(?:plan|routine|programme|program)\b/i,
  /\b(?:plan|routine|programme|program)\s+(?:for|around)\s+me\b/i,
  /\bwhat\s+should\s+i\s+do\b/i,
  /\bturn\s+(?:this|that|it)\s+into\s+(?:a\s+)?(?:plan|routine)\b/i,
  /^\s*yes[, ]+(?:do|make|build|create)\s+(?:that|it)\.?\s*$/i,
];

export function requestedActionPlan(question: string): boolean {
  const text = question.trim().slice(0, 600);
  return text.length > 0 && PLAN_REQUESTS.some((pattern) => pattern.test(text));
}
