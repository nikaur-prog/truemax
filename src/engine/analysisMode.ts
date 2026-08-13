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

const LADDER: Array<{ min: number; word: string; tone: Verdict["tone"]; line: (s: Sex) => string }> = [
  {
    min: 0,
    word: "Chopped",
    tone: "low",
    line: () => "Bottom fifth of the reference set. Most of what is dragging it is grooming and body fat, and both move.",
  },
  {
    min: 20,
    word: "Aight",
    tone: "mid",
    line: () => "Below the middle, but nowhere near the bottom. Ordinary, which is where most faces live.",
  },
  {
    min: 50,
    word: "Fine",
    tone: "mid",
    line: () => "Above average. Nothing here is holding you back; the gap to the next rung is mostly upkeep.",
  },
  {
    min: 80,
    word: "Mogger",
    tone: "high",
    line: () => "Top fifth. You are measurably ahead of four out of five faces in the reference set.",
  },
  {
    min: 95,
    word: "TrueMax",
    tone: "peak",
    line: () => "Top five per cent. This is the end of the scale — there is no rung above it.",
  },
];

export function verdictFor(report: Report): Verdict {
  return verdictForPercentile(report.overallPercentile, report.sex);
}

// The percentile is the whole input. Exported separately because the MP4
// exporter has a percentile and no Report, and the alternative — a second copy
// of the bands over in the renderer — is precisely the drift this module exists
// to prevent. One ladder, one set of thresholds, every surface.
export function verdictForPercentile(percentile: number, sex: Sex = "male"): Verdict {
  // Walk down so the highest qualifying rung wins, and the array stays readable
  // in ascending order.
  const rung = [...LADDER].reverse().find((r) => percentile >= r.min) ?? LADDER[0];
  return { word: rung.word, line: rung.line(sex), tone: rung.tone };
}
