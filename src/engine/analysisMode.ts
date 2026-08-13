import type { Report, Sex } from "./types.ts";

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
const DEFAULT: AnalysisMode = "full";

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

export type VerdictTone = "blunt" | "kind";

const TONE_KEY = "truemax.verdictTone";

// null means never asked. The caller uses that to decide whether to put the
// question up, so "asked and chose blunt" and "never asked" stay distinct.
export function loadVerdictTone(): VerdictTone | null {
  try {
    const raw = localStorage.getItem(TONE_KEY);
    return raw === "blunt" || raw === "kind" ? raw : null;
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
// Out of 100 because that is the scale this audience already reads — Umax and
// the PSL threads both use it — and switching scales between modes would make
// the same face look like two different results. The number is the percentile,
// which is the honest reading of "out of 100": it is where you sit among the
// reference population, not a mark out of a hundred possible points.
// ---------------------------------------------------------------------------

export interface BasicScore {
  label: string;
  value: number; // 0-100, a percentile
}

export function basicScores(report: Report): BasicScore[] {
  const pct = (key: string, fallback: number): number => {
    const region = report.regions.find((r) => r.region === key);
    return Math.round(region ? region.percentile : fallback);
  };
  // Dimorphism is the one pillar whose NAME depends on the reference
  // population. Calling a woman's score "masculinity" would be describing the
  // measurement backwards, and calling it "dimorphism" to dodge that is jargon
  // in a mode whose whole point is not being jargon.
  const dimorphism = report.sex === "female" ? "Femininity" : "Masculinity";
  return [
    { label: "Overall", value: Math.round(report.overallPercentile) },
    { label: "Sharpness", value: pillarPct(report, "Angularity") },
    { label: dimorphism, value: pillarPct(report, "Dimorphism") },
    { label: "Eyes", value: pct("eyes", 50) },
    { label: "Jaw", value: pct("jaw", 50) },
    { label: "Harmony", value: pillarPct(report, "Harmony") },
  ];
}

// Pillars are stored as 0-10 scores rather than percentiles, so this converts
// on the same scale the rest of the app uses rather than inventing one.
function pillarPct(report: Report, pillar: "Harmony" | "Angularity" | "Dimorphism" | "Features"): number {
  const score = report.pillars[pillar] ?? 5;
  return Math.max(1, Math.min(99, Math.round(score * 10)));
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
  // The same band, said without the sting. Only the bottom five rungs need one:
  // the top four are already good news and softening them would be talking down
  // to somebody who just got a good result.
  kind?: Record<Sex, string[]>;
  tone: Verdict["tone"];
  line: string;
}> = [
  {
    min: 0,
    words: { male: ["You're cooked"], female: ["You're cooked"] },
    kind: { male: ["Starting point"], female: ["Starting point"] },
    tone: "low",
    line: "Bottom of the reference set. Almost all of what is dragging it is grooming, body fat and lighting — none of it bone.",
  },
  {
    min: 12,
    words: { male: ["Chopped"], female: ["Chopped"] },
    kind: { male: ["Plenty to work with"], female: ["Plenty to work with"] },
    tone: "low",
    line: "Bottom fifth. The gap is real, and most of it is the part that moves without surgery.",
  },
  {
    min: 26,
    words: { male: ["Mildly chopped", "Rough"], female: ["Mildly chopped", "Rough"] },
    kind: { male: ["Coming along"], female: ["Coming along"] },
    tone: "low",
    line: "Below the middle. One or two numbers are doing the damage rather than all of them.",
  },
  {
    // The widest band in practice, so it carries the most alternates — this is
    // the rung most people will actually land on and screenshot.
    min: 40,
    words: { male: ["Mid", "NPC", "Background character"], female: ["Mid", "Girl next door"] },
    kind: { male: ["Right in the middle"], female: ["Right in the middle"] },
    tone: "mid",
    line: "Dead centre of the reference set. Which is where most faces are — that is what a middle means.",
  },
  {
    min: 52,
    words: { male: ["Aight", "Decent", "Solid"], female: ["Aight", "Cute", "Solid"] },
    kind: { male: ["Good base"], female: ["Good base"] },
    tone: "mid",
    line: "Just above the middle. Nothing is wrong; nothing is carrying you either.",
  },
  {
    min: 65,
    words: {
      male: ["Good looking", "Attractive", "Sharp"],
      female: ["Good looking", "Attractive", "Striking"],
    },
    tone: "high",
    line: "Top third. Measurably ahead of two out of three faces in the reference set.",
  },
  {
    min: 82,
    words: {
      male: ["Mogger", "Marlon level"],
      female: ["She-mogger", "Fine shyt"],
    },
    tone: "high",
    line: "Top fifth. Four out of five faces in the reference set measure below this.",
  },
  {
    min: 95,
    words: {
      male: ["Looksmaxxing final boss"],
      female: ["Certified baddie"],
    },
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
    tone: "peak",
    line: "Top one per cent. There is nothing above this — the scale ends here.",
  },
];

export function verdictFor(report: Report, tone?: VerdictTone): Verdict {
  return verdictForPercentile(report.overallPercentile, report.sex, tone);
}

// The percentile is the whole input. Exported separately because the MP4
// exporter has a percentile and no Report, and the alternative — a second copy
// of the bands over in the renderer — is precisely the drift this module exists
// to prevent. One ladder, one set of thresholds, every surface.
export function verdictForPercentile(
  percentile: number,
  sex: Sex = "male",
  tone: VerdictTone = "blunt",
): Verdict {
  // Walk down so the highest qualifying rung wins, and the array stays readable
  // in ascending order.
  const rung = [...LADDER].reverse().find((r) => percentile >= r.min) ?? LADDER[0];
  // Kind mode falls through to the blunt words wherever no softer version
  // exists, which is every rung that was already good news.
  const words = (tone === "kind" ? rung.kind?.[sex] : undefined) ?? rung.words[sex];
  // Derived from the percentile, never random. Pressing the button again must
  // not change your verdict; a result that moves when you re-roll it is not a
  // measurement and nobody believes it twice.
  const pick = words[Math.abs(Math.round(percentile * 10)) % words.length];
  return { word: pick, line: rung.line, tone: rung.tone };
}
