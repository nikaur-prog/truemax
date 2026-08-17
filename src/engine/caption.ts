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

// Which cut the caption is going under.
//
// The three exports make three different claims and a caption that ignores
// which one it is under is a caption that undersells two of them. The
// before/after is about a CHANGE and its headline is the delta; the rundown has
// already spent a minute making a case and its caption only has to be a reason
// to stop; the verdict cut is one word on screen and a caption longer than the
// video is a caption arguing with its own edit.
//
// "reel" is the default and is what every caller produced before this existed,
// so an omitted kind keeps the old wording exactly.
export type CaptionKind = "reel" | "rundown" | "breakdown" | "verdict" | "beforeAfter";

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
  /** Which cut this is under. Defaults to the original generic wording. */
  kind?: CaptionKind;
  /** The earlier score, when this is a before/after. */
  from?: number;
  /** The ceiling, when the video showed one. */
  potential?: number;
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

  const subject = firstPerson ? "I" : name;

  // The opening line, per cut. It is the only line most people read: the feed
  // truncates a caption after roughly the first line, so everything that has to
  // survive above the fold is here and nothing load-bearing is below it.
  //
  // Note what is NOT here. The verdict word is never quoted, on any cut. The
  // ladder holds "Chopped" and "You're cooked", the tone rule at the top of this
  // file says a caption is the most public sentence the app writes, and putting
  // a demeaning word under somebody's own face — where it outlives the video and
  // gets read by people who never watched it — is the one place that rule cannot
  // bend. The number says what it says without an adjective.
  let opening: string;
  switch (input.kind) {
    case "beforeAfter": {
      // The delta is the headline. A before/after captioned with only the new
      // score throws away the entire reason the video exists.
      const delta = input.from === undefined ? null : input.overall - input.from;
      opening =
        delta === null
          ? `${score}${standing} after.`
          : delta >= 0.05
            ? `${input.from!.toFixed(1)} → ${score}. Same face, same measurements, both times.`
            : delta <= -0.05
              ? `${input.from!.toFixed(1)} → ${score}. It went down, and that's worth posting too.`
              : `${input.from!.toFixed(1)} → ${score}. Barely moved, and that's the honest read.`;
      break;
    }
    case "rundown":
      opening = firstPerson
        ? `Every measurement on my face, read out. ${score}${standing}.`
        : `Every measurement on ${name}'s face, read out. ${score}${standing}.`;
      break;
    case "breakdown":
      opening = `${subject === "I" ? "Every region of my face scored" : `Every region of ${name}'s face scored`}. ${score}${standing}.`;
      break;
    case "verdict":
      // One word on screen, so one line here.
      opening = `${score}${standing}.`;
      break;
    default:
      opening = firstPerson
        ? `I let the math rate my face. ${score}${standing}.`
        : `${name} let the math rate their face. ${score}${standing}.`;
  }

  const desc = oneLine(input.description);
  const lines = [opening];
  if (desc) lines.push(desc);
  // The ceiling, when the cut showed one. It is the only forward-looking line
  // available and it is the reason somebody scans their own face rather than
  // watching another stranger's.
  if (input.potential !== undefined && input.potential > input.overall + 0.05) {
    lines.push(`Ceiling: ${input.potential.toFixed(1)} with everything soft fixed.`);
  }
  // Ends on a question, on the cuts long enough to have earned one. Every
  // breakdown that collects comments closes by asking for the next subject, and
  // it costs one line.
  if (input.kind === "rundown" || input.kind === "breakdown") {
    lines.push(firstPerson ? "Rate it honestly." : `Who should we measure after ${name}?`);
  } else if (input.kind === "beforeAfter") {
    lines.push(`What should ${firstPerson ? "I" : "they"} fix next?`);
  }
  lines.push("Measured on-device, nothing uploaded → truemax.app");

  const caption = lines.join("\n");
  const hashtags = TAGS[input.platform];
  return { caption, hashtags, full: `${caption}\n\n${hashtags.join(" ")}` };
}
