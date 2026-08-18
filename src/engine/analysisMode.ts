import type { Report, Sex } from "./types.js";
import { aggregateScoreToPercentile } from "./scoring.js";

// ---------------------------------------------------------------------------
// How much of the analysis a person wants to see.
//
// The product had exactly one answer to that question — all of it — and that
// loses everybody who just wants a number. Three depths now, and the rule that
// makes them safe is that they are all PRESENTATION. Every mode reads the same
// measurements from the same engine and the same reference tables. Nothing here
// computes a score.
//
// That constraint is not stylistic. The moment a "simple" mode derives its own
// numbers, the app can show one person two different answers about one face,
// and the whole claim to be the honest one in this category is gone.
// ---------------------------------------------------------------------------

export type AnalysisMode = "verdict" | "basic" | "full";

export const ANALYSIS_MODES: Array<{ id: AnalysisMode; label: string; blurb: string }> = [
  { id: "verdict", label: "Verdict", blurb: "One line. Nothing else." },
  { id: "basic", label: "Basic", blurb: "A handful of scores out of 100." },
  { id: "full", label: "Full", blurb: "Every measurement, and the maths behind it." },
];

const KEY = "truemax.analysisMode";
// Basic, not full. Full is the honest maximum and the reason to trust the
// product, but forty-one measurements is not a first impression — it is a
// reference manual handed to somebody who wanted a number. Basic answers the
// question that was asked, and both other depths are one tap away on the same
// screen.
const DEFAULT: AnalysisMode = "basic";

export function loadAnalysisMode(): AnalysisMode {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === "verdict" || raw === "basic" || raw === "full" ? raw : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function saveAnalysisMode(mode: AnalysisMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // A browser with storage disabled still gets a working app, it just does
    // not remember the preference between visits.
  }
}

// ---------------------------------------------------------------------------
// How hard the verdict is allowed to hit.
//
// The verdict words are the audience's own vocabulary, and for most of this
// audience being called chopped by a face app is the joke they came for. For
// some of it, it is not, and there is no way to tell which from a photograph.
// So it is asked — once, the first time somebody chooses the verdict mode,
// wherever they choose it from.
//
// This is not only kindness. Someone who was asked and said "give it to me
// straight" has consented to the wording, which is the difference between a
// joke they opted into and an insult a product handed them unprompted. That
// distinction is the whole defence when an app-store reviewer or an angry
// parent reads the word "chopped" on a thirteen-year-old's screen.
//
// The NUMBER never changes. Both tones read the same percentile and the same
// measurements; only the label on it differs. A "supportive" mode that quietly
// inflated the score would be the same lie as a harsh one that deflated it.
// ---------------------------------------------------------------------------

// A third register, and the one the videos use.
//
// "Mogger" and "chopped" are the audience's own words and they are also the
// words that make a stranger scrolling past decide this is a red-pill account
// rather than a measurement tool. On a video that goes to people who never
// asked for it, the label has to be one a normal person would say out loud
// about somebody else's face: handsome, good-looking, nice-looking.
//
// It is a THIRD ladder rather than a rewrite of the other two. Both survive
// intact, the tests that pin them still pass, and going back to the slang is
// changing which constant is the default rather than restoring deleted words.
export type VerdictTone = "blunt" | "kind" | "polite";

/**
 * What a face is called when nobody has chosen otherwise.
 *
 * Polite, because the default is what the exported videos carry and a video is
 * seen by people who did not opt into anything. The slang ladders stay one
 * choice away for anyone who wants them.
 */
export const DEFAULT_VERDICT_TONE: VerdictTone = "polite";

const TONE_KEY = "truemax.verdictTone";

// null means never asked. The caller uses that to decide whether to put the
// question up, so "asked and chose blunt" and "never asked" stay distinct.
export function loadVerdictTone(): VerdictTone | null {
  try {
    const raw = localStorage.getItem(TONE_KEY);
    return raw === "blunt" || raw === "kind" || raw === "polite" ? raw : null;
  } catch {
    return null;
  }
}

export function saveVerdictTone(tone: VerdictTone): void {
  try {
    localStorage.setItem(TONE_KEY, tone);
  } catch {
    /* storage disabled: the app still works, it just asks again next visit */
  }
}

// ---------------------------------------------------------------------------
// Basic mode: a few headline numbers out of 100.
//
// Out of 100 because that is the scale this audience already reads. It is the
// SAME 0-10 measurement shown by Full, multiplied by ten. Population position
// is carried separately so a 7.1/10 cannot turn into 95/100 merely because it
// sits at the 95th percentile — that was one face receiving two different-looking
// answers from one report.
// ---------------------------------------------------------------------------

export interface BasicScore {
  label: string;
  value: number; // 0-100 score, exactly the Full score multiplied by ten
  percentile: number; // population position, for the rarity caption only
}

export function basicScores(report: Report): BasicScore[] {
  const regionScore = (key: string): BasicScore => {
    const region = report.regions.find((r) => r.region === key);
    return {
      label: key,
      value: Math.round((region?.score ?? 5) * 10),
      percentile: region?.percentile ?? 50,
    };
  };
  // Dimorphism is the one pillar whose NAME depends on the reference
  // population. Calling a woman's score "masculinity" would be describing the
  // measurement backwards, and calling it "dimorphism" to dodge that is jargon
  // in a mode whose whole point is not being jargon.
  const dimorphism = report.sex === "female" ? "Femininity" : "Masculinity";
  // Seven entries: the headline plus six panels. Six because five left the
  // grid with a hole in it, and because symmetry is the metric this audience
  // asks about most after the jaw — it belongs in the short list, not three
  // taps deep in the full breakdown.
  return [
    { label: "Overall", value: Math.round(report.overall * 10), percentile: report.overallPercentile },
    pillarScore(report, "Angularity", "Sharpness"),
    pillarScore(report, "Dimorphism", dimorphism),
    { ...regionScore("eyes"), label: "Eyes" },
    { ...regionScore("jaw"), label: "Jaw" },
    { ...regionScore("symmetry"), label: "Symmetry" },
    pillarScore(report, "Harmony", "Harmony"),
  ];
}

function pillarScore(
  report: Report,
  pillar: "Harmony" | "Angularity" | "Dimorphism" | "Features",
  label: string,
): BasicScore {
  const score = report.pillars[pillar] ?? 5;
  return { label, value: Math.round(score * 10), percentile: aggregateScoreToPercentile(score) };
}

// ---------------------------------------------------------------------------
// Verdict mode: the one-liner.
//
// This is the mode people open in front of their friends, and the reason it
// works is that the words are the audience's own — someone calling themselves
// "chopped" is using their vocabulary about themselves, which is a joke, not an
// insult delivered by software.
//
// The ladder stops at "chopped". There is no rung below it, and specifically no
// "subhuman": that word is not banter in this corner of the internet, it is the
// vocabulary of the part of it that talks people into hating themselves, and
// this app is used by thirteen-year-olds. Everything else about the mode is
// intact — the joke does not need a floor under the floor to land.
// ---------------------------------------------------------------------------

export interface Verdict {
  word: string;
  line: string;
  tone: "low" | "mid" | "high" | "peak";
  /**
   * The rung in plain English, as a noun phrase: "a very attractive male".
   *
   * The ladder's words are slang and jokes, which is what makes them worth
   * quoting and also what makes them unreadable to anybody outside the niche.
   * "Mogger" means nothing to a viewer who arrived from the For You page; "a
   * very attractive male" means the same thing to everyone. So the verdict is
   * said twice — once in the audience's vocabulary and once in English — and
   * the second half is what carries it to people who do not know the first.
   *
   * Not tone-dependent. The kind ladder already reads as plain English, and a
   * second plain-English phrase after it would just be the same sentence twice.
   */
  descriptor: string;
}

// Eight rungs, and where the words differ by reference population they differ,
// because "she-mogger" and "mogger" are not the same joke and neither is a
// translation of the other.
//
// Several rungs carry two words and alternate between them. That is the whole
// reason this mode gets re-run and re-screenshotted: two friends landing on the
// same band should not get the same line. The choice is derived from the
// percentile rather than randomised, so one face always gets one answer — a
// verdict that changes when you press the button again is a verdict nobody
// believes.
//
// There is still no rung below "You're cooked", and there is deliberately no
// "whale". Two independent reasons and either one is sufficient: this engine
// measures a FACE and cannot see body fat, so the word would be a fabrication
// dressed as a measurement; and a weight insult aimed at a thirteen-year-old is
// the one thing in this product that could do real damage. Everything else that
// was asked for is here.
const LADDER: Array<{
  min: number;
  words: Record<Sex, string[]>;
  // The same band, in plain English. Every rung carries one, including the good
  // ones — not because a compliment needs softening, but because the dialog
  // promises "no slang", and "Fine shyt" is slang whether or not it is a nice
  // thing to be called. Someone who asked for it civil asked for it civil all
  // the way up.
  kind: Record<Sex, string[]>;
  /**
   * The ordinary-English ladder, and the one the exports use by default.
   *
   * One word per rung rather than alternates: these are the words a person
   * actually says about a face, and there are not five synonyms for "handsome"
   * that a viewer would not read as the app straining. The variety the slang
   * ladder gets from alternates, this one gets from having nine rungs.
   */
  polite: Record<Sex, string[]>;
  // The rung in plain English, said out loud after the slang one. See Verdict.
  // Sex-specific because the phrase names the person, and one that named the
  // wrong one would be the single most obvious error the video could make.
  descriptor: Record<Sex, string>;
  tone: Verdict["tone"];
  line: string;
}> = [
  {
    min: 0,
    words: { male: ["You're cooked"], female: ["You're cooked"] },
    kind: { male: ["Starting point", "Early days"], female: ["Starting point", "Early days"] },
    // Not "an unattractive male". The bottom rung is the one place this product
    // could do real damage, and there is a difference between telling somebody
    // where they measure and telling them what they are. The rung below the
    // middle gets the same treatment for the same reason.
    // No polite word for the floor pretends the floor is not there. "Room to
    // grow" is what a person actually says to someone at the bottom of a scale
    // and it is not a euphemism — it is the honest reading of a face whose gap
    // is almost entirely the part that moves.
    polite: { male: ["Room to grow"], female: ["Room to grow"] },
    descriptor: { male: "a male with a long way to climb", female: "a female with a long way to climb" },
    tone: "low",
    line: "Bottom of the reference set. Almost all of what is dragging it is grooming, body fat and lighting — none of it bone.",
  },
  {
    min: 12,
    words: { male: ["Chopped", "Undercooked", "Raw"], female: ["Chopped", "Undercooked", "Raw"] },
    kind: {
      male: ["Plenty to work with", "Lots of upside"],
      female: ["Plenty to work with", "Lots of upside"],
    },
    polite: { male: ["Plain-looking"], female: ["Plain-looking"] },
    descriptor: { male: "a well below average male", female: "a well below average female" },
    tone: "low",
    line: "Bottom fifth. The gap is real, and most of it is the part that moves without surgery.",
  },
  {
    min: 26,
    words: {
      male: ["Mildly chopped", "Rough", "Half baked", "Unfinished"],
      female: ["Mildly chopped", "Rough", "Half baked", "Unfinished"],
    },
    kind: { male: ["Coming along", "On the way up"], female: ["Coming along", "On the way up"] },
    polite: { male: ["Ordinary-looking"], female: ["Ordinary-looking"] },
    descriptor: { male: "a below average male", female: "a below average female" },
    tone: "low",
    line: "Below the middle. One or two numbers are doing the damage rather than all of them.",
  },
  {
    // The widest band in practice, so it carries the most alternates — this is
    // the rung most people will actually land on and screenshot.
    min: 40,
    // Every one of these is a joke about being GENERIC, which is the honest
    // reading of the fortieth-to-fifty-second percentile — and the reason the
    // rung lands as banter rather than an insult. None of them says anything is
    // wrong with the face, because nothing is.
    words: {
      male: ["Mid", "NPC", "Background character", "Stock photo", "Default settings", "Extra", "Filler", "Beige"],
      female: [
        "Mid",
        "Girl next door",
        "NPC",
        "Stock photo",
        "Default settings",
        "Background character",
        "Extra",
        "Beige",
      ],
    },
    kind: {
      male: ["Right in the middle", "Middle of the pack", "Bang on average"],
      female: ["Right in the middle", "Middle of the pack", "Bang on average"],
    },
    polite: { male: ["Average-looking"], female: ["Average-looking"] },
    descriptor: { male: "a perfectly average male", female: "a perfectly average female" },
    tone: "mid",
    line: "Dead centre of the reference set. Which is where most faces are — that is what a middle means.",
  },
  {
    min: 52,
    words: {
      male: ["Aight", "Decent", "Solid", "Alright", "Not bad", "Passable", "Respectable"],
      female: ["Aight", "Cute", "Solid", "Alright", "Not bad", "Passable", "Respectable"],
    },
    kind: {
      male: ["Good base", "Solid footing", "Comfortably above average"],
      female: ["Good base", "Solid footing", "Comfortably above average"],
    },
    polite: { male: ["Nice-looking"], female: ["Nice-looking"] },
    descriptor: { male: "a slightly above average male", female: "a slightly above average female" },
    tone: "mid",
    line: "Just above the middle. Nothing is wrong; nothing is carrying you either.",
  },
  {
    min: 65,
    words: {
      male: ["Good looking", "Attractive", "Sharp", "Top tier", "Clean", "Chiselled"],
      female: ["Good looking", "Attractive", "Striking", "Top tier", "Clean", "Sculpted"],
    },
    kind: {
      male: ["Good looking", "Handsome", "Well put together"],
      female: ["Good looking", "Lovely", "Well put together"],
    },
    polite: { male: ["Good-looking"], female: ["Good-looking"] },
    descriptor: { male: "an attractive male", female: "an attractive female" },
    tone: "high",
    line: "Top third. Measurably ahead of two out of three faces in the reference set.",
  },
  {
    min: 82,
    words: {
      male: ["Mogger", "Marlon level"],
      female: ["She-mogger", "Fine shyt"],
    },
    kind: {
      male: ["Striking", "Turns heads", "Exceptional"],
      female: ["Striking", "Turns heads", "Exceptional"],
    },
    polite: { male: ["Great-looking"], female: ["Great-looking"] },
    descriptor: { male: "a very attractive male", female: "a very attractive female" },
    tone: "high",
    line: "Top fifth. Four out of five faces in the reference set measure below this.",
  },
  {
    min: 95,
    words: {
      male: ["Looksmaxxing final boss"],
      female: ["Certified baddie"],
    },
    // No word repeats across rungs, in either tone. Two people a fifteen-point
    // percentile apart reading the same label is the ladder failing at the one
    // job it has.
    kind: {
      male: ["Remarkable", "Genuinely rare"],
      female: ["Remarkable", "Genuinely rare"],
    },
    // The ladder switches families at the top two rungs, from "-looking" to the
    // classic gendered compliment. That switch is the signal: a viewer hears
    // handsome and knows it is not another notch on the same word.
    polite: { male: ["Handsome"], female: ["Beautiful"] },
    descriptor: { male: "an exceptionally attractive male", female: "an exceptionally attractive female" },
    tone: "peak",
    line: "Top five per cent of the reference set. One rung left, and almost nobody reaches it.",
  },
  {
    // The top one per cent, and deliberately its own rung rather than an
    // alternate of the one below. A ceiling that lands every twentieth scan is
    // not a ceiling — it is just the top band with a second name, and it makes
    // the rung under it worth less. Roughly an 8.0+ headline score.
    min: 99,
    words: { male: ["True Adam"], female: ["True Eve"] },
    kind: { male: ["One in a hundred"], female: ["One in a hundred"] },
    polite: { male: ["Very handsome"], female: ["Very beautiful"] },
    descriptor: { male: "a one in a hundred male", female: "a one in a hundred female" },
    tone: "peak",
    line: "Top one per cent. There is nothing above this — the scale ends here.",
  },
];

export function verdictFor(report: Report, tone: VerdictTone = DEFAULT_VERDICT_TONE): Verdict {
  return verdictForPercentile(report.overallPercentile, report.sex, tone);
}

// The percentile is the whole input. Exported separately because the MP4
// exporter has a percentile and no Report, and the alternative — a second copy
// of the bands over in the renderer — is precisely the drift this module exists
// to prevent. One ladder, one set of thresholds, every surface.
export function verdictForPercentile(
  percentile: number,
  sex: Sex = "male",
  // The product default, defined once. A per-function literal is how a page
  // and the video it exports end up calling one face two different things.
  tone: VerdictTone = DEFAULT_VERDICT_TONE,
): Verdict {
  // Walk down so the highest qualifying rung wins, and the array stays readable
  // in ascending order.
  const rung = [...LADDER].reverse().find((r) => percentile >= r.min) ?? LADDER[0];
  const words = tone === "kind" ? rung.kind[sex] : tone === "polite" ? rung.polite[sex] : rung.words[sex];
  // Derived from the percentile, never random. Pressing the button again must
  // not change your verdict; a result that moves when you re-roll it is not a
  // measurement and nobody believes it twice.
  const pick = words[Math.abs(Math.round(percentile * 10)) % words.length];
  return { word: pick, line: rung.line, tone: rung.tone, descriptor: rung.descriptor[sex] };
}
