/** The full answer remains in the transcript; this is a short live excerpt. */
export function maxSpeechWindow(text: string, maximum = 140): string {
  const limit = Number.isFinite(maximum) ? Math.max(60, Math.min(240, Math.floor(maximum))) : 140;
  const plain = text.replace(/\*\*|__|`/g, "").replace(/(?:^|\n)#{1,6}\s*/g, "").replace(/\s+/g, " ").trim();
  if (plain.length <= limit) return plain;
  const tail = plain.slice(-(limit - 2));
  // Prefer a sentence boundary when it leaves enough useful context.
  const boundary = tail.search(/[.!?]\s+(?=\S)/);
  if (boundary >= 0 && boundary < tail.length / 2) return tail.slice(boundary + 2);
  const space = tail.indexOf(" ");
  return `… ${space >= 0 && space < 24 ? tail.slice(space + 1) : tail}`;
}

/** Decorative text cadence, not generated audio or lip synchronisation. */
export function maxTextMouthLevel(character: string): number {
  if (!character || /\s|[.,!?;:]/.test(character)) return 0;
  return 0.32 + ((character.codePointAt(0) ?? 0) % 7) / 10;
}
