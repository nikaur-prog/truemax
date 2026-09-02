import { screenPublicLine } from "./publicContentSafety.js";

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
// "reel" is the default so a caller that does not name a cut still gets the
// generic visual-analysis framing.
export type CaptionKind = "reel" | "rundown" | "breakdown" | "verdict" | "beforeAfter";

export interface CaptionInput {
  platform: Platform;
  // "me", "", or a first name. Anything that is not "me"/"" is treated as a
  // name and used exactly as typed.
  who: string;
  // One optional line from the person. Collapsed to a single line, capped and
  // omitted if it contains a known public-risk phrase.
  description: string;
  overall: number;
  percentile: number;
  /** Which cut this is under. Defaults to the generic visual-analysis wording. */
  kind?: CaptionKind;
  /** The earlier score, when this is a before/after. */
  from?: number;
  /** The potential estimate, when the video showed one. Kept out of captions. */
  potential?: number;
}

export interface CaptionResult {
  caption: string;
  hashtags: string[];
  /** True when optional creator copy was omitted by the public-copy screen. */
  descriptionOmitted: boolean;
  // Caption and hashtags in one paste-ready block.
  full: string;
}

// Hashtags are fixed per platform rather than derived from the description:
// derived tags would make two people's captions drift apart in reach for
// reasons neither could see. TikTok rewards a short list; Instagram tolerates
// a longer one.
const TAGS: Record<Platform, string[]> = {
  tiktok: ["#truemax", "#facialanalysis", "#grooming", "#styleanalysis", "#selfcare"],
  instagram: [
    "#truemax",
    "#facialanalysis",
    "#facialproportions",
    "#grooming",
    "#styleanalysis",
    "#selfcare",
    "#selfimprovement",
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
  const standing = input.percentile >= 55 ? `, top ${Math.max(1, topShare)}%` : "";

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
          ? `A second one-photo analysis: ${score}${standing}.`
          : delta >= 0.05
            ? `Two scans: ${input.from!.toFixed(1)} → ${input.overall.toFixed(1)} out of 10. Compare the measurements, not just the number.`
            : delta <= -0.05
              ? `Two scans: ${input.from!.toFixed(1)} → ${input.overall.toFixed(1)} out of 10. Compare the measurements, not just the number.`
              : `Two scans: ${input.from!.toFixed(1)} → ${input.overall.toFixed(1)} out of 10. The difference is within normal photo-to-photo movement.`;
      break;
    }
    case "rundown":
      opening = firstPerson
        ? `A measured facial-proportion breakdown of my scan. ${score}${standing}.`
        : `A measured facial-proportion breakdown of ${name}. ${score}${standing}.`;
      break;
    case "breakdown":
      opening = `${subject === "I" ? "My one-photo facial-proportion analysis" : `${name}'s one-photo facial-proportion analysis`}: ${score}${standing}.`;
      break;
    case "verdict":
      opening = `One-photo facial-proportion result: ${score}${standing}.`;
      break;
    default:
      opening = firstPerson
        ? `A visual facial-proportion breakdown of my scan. ${score}${standing}.`
        : `A visual facial-proportion breakdown of ${name}. ${score}${standing}.`;
  }

  // Hashtags stay in the fixed tag block. Allowing them through this field
  // defeats the safety pass and makes the exact public copy unpredictable.
  const screened = /#[\p{L}\d_]+/u.test(input.description)
    ? { text: "", blocked: true }
    : screenPublicLine(input.description);
  const desc = screened.text;
  const lines = [opening];
  if (desc) lines.push(desc);
  // Potential estimates stay inside the analysis. Putting a best-case number
  // into the public caption turns an estimate into a transformation promise.
  if (input.kind === "rundown" || input.kind === "breakdown") {
    lines.push(firstPerson ? "What should I compare on the next scan?" : `Which public figure should we analyse after ${name}?`);
  } else if (input.kind === "beforeAfter") {
    lines.push("Which measurement should the next comparison focus on?");
  }
  lines.push("One-photo estimate; lighting and angle can change the result. Explore the analysis → truemax.app");

  const caption = lines.join("\n");
  const hashtags = TAGS[input.platform];
  return {
    caption,
    hashtags,
    descriptionOmitted: screened.blocked,
    full: `${caption}\n\n${hashtags.join(" ")}`,
  };
}
