export type PlanCategory = "product" | "nutrition" | "training" | "skin" | "grooming" | "habit" | "other";

export type PlanMemoryCommand =
  | { kind: "add"; title: string; normalizedTitle: string; category: PlanCategory }
  | { kind: "not_working"; title: string; normalizedTitle: string };

function cleanWords(value: string, limit: number): string {
  return value
    .replace(/[<>\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?,;:]+$/g, "")
    .trim()
    .slice(0, limit)
    .trim();
}

export function normalisePlanTitle(value: string): string {
  return cleanWords(value, 120).toLocaleLowerCase("en-US");
}

function categoryFor(title: string, explicitProduct: boolean): PlanCategory {
  if (explicitProduct || /\b(?:cleanser|cream|gel|moisturi[sz]er|serum|sunscreen|shampoo|conditioner)\b/i.test(title)) {
    return "product";
  }
  if (/\b(?:diet|meal|food|protein|calorie|hydration|water|sodium)\b/i.test(title)) return "nutrition";
  if (/\b(?:lift|training|workout|cardio|walk|exercise|gym)\b/i.test(title)) return "training";
  if (/\b(?:skin|acne|blemish|oil|dryness)\b/i.test(title)) return "skin";
  if (/\b(?:hair|beard|brow|groom|style)\b/i.test(title)) return "grooming";
  if (/\b(?:sleep|posture|routine|habit)\b/i.test(title)) return "habit";
  return "other";
}

/**
 * Only explicit, imperative plan language mutates memory. Max's reply is never
 * parsed, and an ordinary discussion such as “is retinol working?” cannot
 * silently change profile state.
 */
export function parsePlanMemoryCommand(input: string): PlanMemoryCommand | null {
  const text = cleanWords(input, 600);
  if (!text) return null;

  const addToPlan = text.match(/^add\s+(.+?)\s+to\s+(?:my\s+)?(?:current\s+)?plan$/i);
  const addProduct = text.match(/^add\s+(.+?)\s+product(?:\s+to\s+(?:my\s+)?(?:current\s+)?plan)?$/i);
  const added = addToPlan?.[1] ?? addProduct?.[1];
  if (added) {
    const title = cleanWords(added, 120);
    const normalizedTitle = normalisePlanTitle(title);
    if (title.length < 2 || !normalizedTitle) return null;
    return { kind: "add", title, normalizedTitle, category: categoryFor(title, Boolean(addProduct)) };
  }

  const stopped = text.match(
    /^(.+?)\s+(?:isn't|isnt|is not|hasn't been|hasnt been|has not been)\s+(?:currently\s+)?working(?:\s+for\s+me)?$/i,
  );
  if (stopped?.[1]) {
    const title = cleanWords(stopped[1], 120);
    const normalizedTitle = normalisePlanTitle(title);
    if (title.length < 2 || !normalizedTitle) return null;
    return { kind: "not_working", title, normalizedTitle };
  }
  return null;
}

export function conversationTitle(input: string): string {
  let title = cleanWords(input, 160)
    .replace(/^(?:(?:hey|hi)\s+)?(?:coach\s+)?max[,\s:!-]*/i, "")
    .replace(/^(?:hey|hi)[,\s:!-]*/i, "")
    .replace(/^(?:can you|could you|please|i want to|i'd like to)\s+/i, "")
    .trim();
  if (!title) return "New chat";
  title = title[0].toUpperCase() + title.slice(1);
  if (title.length <= 52) return title;
  const shortened = title.slice(0, 52);
  const boundary = shortened.lastIndexOf(" ");
  return `${(boundary >= 30 ? shortened.slice(0, boundary) : shortened).trim()}…`;
}
