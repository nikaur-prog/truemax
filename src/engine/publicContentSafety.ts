// ---------------------------------------------------------------------------
// Public-export copy safety.
//
// The analysis itself can explain difficult measurements in detail. A TikTok
// caption or a two-second hook cannot: moderation sees a few isolated words,
// usually beside a person's face, without the surrounding explanation. Keep
// this deliberately small and deterministic. It is not a general profanity
// filter; it catches the phrases this product can accidentally manufacture or
// invite through its creator fields.
// ---------------------------------------------------------------------------

const PUBLIC_RISK_PATTERNS: RegExp[] = [
  /\b(?:chopped|cooked|cracked|mogger|subhuman|incel|ugly|unattractive|hideous)\b/i,
  /\blooksmax(?:xing)?\b/i,
  /\b(?:mewing|jaw(?:line)?\s*(?:training|challenge))\b/i,
  /\b(?:rapid|extreme)\s+(?:weight|fat)\s+loss\b/i,
  /\b(?:starv(?:e|ing)|fasting)\b/i,
  /\bmake\s*me\s*(?:viral|famous)\b/i,
  /\bfell\s+off\b/i,
  /\b(?:fix|correct)\s+(?:my|your|their|his|her)\s+face\b/i,
  /\b(?:perfect|ideal)\s+face\b/i,
  /\brate\s+(?:my|your|their|his|her)\s+face\b/i,
  /\bget\s+(?:my|your|their|his|her)\s+rating\b/i,
  /\b(?:dangerous|extreme)\s+challenge\b/i,
];

export interface ScreenedPublicLine {
  text: string;
  blocked: boolean;
}

export function onePublicLine(value: string, cap: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > cap ? `${flat.slice(0, cap - 1).trimEnd()}…` : flat;
}

export function containsPublicRiskLanguage(value: string): boolean {
  return PUBLIC_RISK_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Collapse creator-written copy to one line and reject it as a whole when it
 * contains a known public-risk phrase. Dropping one optional line is safer and
 * more honest than rewriting what the creator meant into something else.
 */
export function screenPublicLine(value: string, cap = 140): ScreenedPublicLine {
  const text = onePublicLine(value, cap);
  return containsPublicRiskLanguage(text)
    ? { text: "", blocked: true }
    : { text, blocked: false };
}
