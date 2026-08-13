// ---------------------------------------------------------------------------
// The caption, written the same way the verdicts are: from templates, not a
// model. Same inputs, same words, every time — a caption generator that
// rephrased itself would invite regenerate-until-flattering, and the product's
// one rule is that the numbers say what they say.
//
// Tone rules carried over from everywhere else words are produced:
//   - never demeaning. A caption is the most public sentence the app writes.
//   - "top X%" appears only when it is true and flattering-by-arithmetic;
//     a below-median face gets the score stated plainly, not dressed up and
//     not rubbed in.
//   - the address rides along, because the caption travels with the video.
// ---------------------------------------------------------------------------

export type Platform = "tiktok" | "instagram";

export interface CaptionInput {
  platform: Platform;
  // "me", "", or a first name. Anything that is not "me"/"" is treated as a
  // name and used exactly as typed.
  who: string;
  // One optional line from the person, e.g. "8 weeks of mewing". Collapsed to
  // a single line and capped, never invented.
  description: string;
  overall: number;
  percentile: number;
}

export interface CaptionResult {
  caption: string;
  hashtags: string[];
  // Caption and hashtags in one paste-ready block.
  full: string;
}

// Hashtags are fixed per platform rather than derived from the description:
// derived tags would make two people's captions drift apart in reach for
// reasons neither could see. TikTok rewards a short list; Instagram tolerates
// a longer one.
const TAGS: Record<Platform, string[]> = {
  tiktok: ["#truemax", "#faceanalysis", "#glowup", "#looksmaxxing", "#fyp"],
  instagram: [
    "#truemax",
    "#faceanalysis",
    "#facialsymmetry",
    "#glowup",
    "#selfimprovement",
    "#looksmaxxing",
    "#aesthetics",
    "#reels",
  ],
};

function oneLine(s: string, cap = 140): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > cap ? `${flat.slice(0, cap - 1).trimEnd()}…` : flat;
}

export function buildCaption(input: CaptionInput): CaptionResult {
  const firstPerson = !input.who.trim() || input.who.trim().toLowerCase() === "me";
  const name = oneLine(input.who, 40);
  const score = `${input.overall.toFixed(1)}/10`;
  // Only claim a percentile when it reads as standing, and round it so the
  // caption does not pretend to a precision the instrument does not have.
  const topShare = Math.round(100 - input.percentile);
  const standing = input.percentile >= 55 ? ` — top ${Math.max(1, topShare)}%` : "";

  const opening = firstPerson
    ? `I let the math rate my face. ${score}${standing}.`
    : `${name} let the math rate their face. ${score}${standing}.`;

  const desc = oneLine(input.description);
  const lines = [opening];
  if (desc) lines.push(desc);
  lines.push("Measured on-device, nothing uploaded → truemax.app");

  const caption = lines.join("\n");
  const hashtags = TAGS[input.platform];
  return { caption, hashtags, full: `${caption}\n\n${hashtags.join(" ")}` };
}
