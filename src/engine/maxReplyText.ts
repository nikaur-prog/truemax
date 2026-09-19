/** Presentation cleanup only. This is not a substitute for semantic reply review. */
export function maxReplyText(raw: string): string {
  return raw
    .replace(/\s*\u2014\s*/g, ", ")
    .replace(/\*\*|__|`/g, "")
    .replace(/\*([^*\n]{1,80})\*/g, "$1")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/^(\s*)[*•]\s+/gm, "$1- ");
}
